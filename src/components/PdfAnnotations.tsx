import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PdfAnnotation } from '../../shared/ipc';
import { client } from '../api/client';

type Rect=PdfAnnotation['rect'];
type Draft={id?:string;kind:'highlight'|'comment';rect:Rect;comment:string};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
export function PdfAnnotations({storedName,page,inline,ready,onEditing,children,readOnly=false}:{storedName:string;page:number;inline:boolean;ready:boolean;onEditing:(value:boolean)=>void;children:ReactNode;readOnly?:boolean}){
  const [annotations,setAnnotations]=useState<PdfAnnotation[]>([]),[mode,setMode]=useState<'read'|'highlight'|'comment'>('read'),[draft,setDraft]=useState<Draft|null>(null),[drawing,setDrawing]=useState<Rect|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const start=useRef<{x:number;y:number}|null>(null);
  useEffect(()=>{let alive=true;setAnnotations([]);const refresh=()=>void client.listPdfAnnotations(storedName,page).then(value=>{if(alive){setAnnotations(value);setError('')}}).catch(e=>{if(alive)setError(e.message)});refresh();window.addEventListener('caderno:pdf-annotations-changed',refresh);return()=>{alive=false;window.removeEventListener('caderno:pdf-annotations-changed',refresh)}},[storedName,page]);
  useEffect(()=>{onEditing(!!draft||mode!=='read'||busy);return()=>onEditing(false)},[draft,mode,busy,onEditing]);
  const cancel=()=>{setDraft(null);setDrawing(null);setMode('read');setError('')};
  const changed=()=>window.dispatchEvent(new Event('caderno:pdf-annotations-changed'));
  const save=async()=>{if(!draft||busy)return;setBusy(true);try{await client.savePdfAnnotation({...draft,storedName,page});changed();cancel()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  const remove=async()=>{if(!draft?.id||busy)return;setBusy(true);try{if(!await client.deletePdfAnnotation(draft.id))throw new Error('Marcação não encontrada.');changed();cancel()}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
  const point=(event:React.PointerEvent<HTMLElement>)=>{const box=event.currentTarget.getBoundingClientRect();return{x:clamp((event.clientX-box.left)/box.width),y:clamp((event.clientY-box.top)/box.height)}};
  return <div className={`pdf-workspace ${inline?'inline':''}`}>
    <div className="pdf-scroll"><div className="pdf-page" style={{visibility:ready?'visible':'hidden'}}>{children}<div className={`pdf-annotation-layer ${mode!=='read'&&!draft?'drawing':''}`} aria-label="Marcações na página" onPointerDown={e=>{
      if(inline||readOnly||mode==='read'||draft||!ready)return;e.preventDefault();const p=point(e);start.current=p;e.currentTarget.setPointerCapture(e.pointerId);setDrawing({...p,width:.001,height:.001});
    }} onPointerMove={e=>{if(!start.current)return;const p=point(e),a=start.current;setDrawing({x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),width:Math.abs(a.x-p.x),height:Math.abs(a.y-p.y)})}} onPointerUp={e=>{
      if(!start.current)return;const p=point(e),a=start.current;start.current=null;setDrawing(null);if(mode==='comment')setDraft({kind:'comment',rect:{x:Math.min(p.x,.97),y:Math.min(p.y,.97),width:.03,height:.03},comment:''});else{const rect={x:Math.min(a.x,p.x),y:Math.min(a.y,p.y),width:Math.abs(a.x-p.x),height:Math.abs(a.y-p.y)};if(rect.width>.004&&rect.height>.004)setDraft({kind:'highlight',rect,comment:''})}
    }} onPointerCancel={()=>{start.current=null;setDrawing(null)}}>
      {annotations.filter(a=>a.id!==draft?.id).map(a=><button key={a.id} type="button" tabIndex={inline?-1:0} disabled={inline||readOnly||!!draft||mode!=='read'} className={`pdf-mark ${a.kind}`} data-annotation-id={a.id} aria-label={a.comment||'Destaque salvo'} title={a.comment||'Destaque salvo'} style={{left:`${a.rect.x*100}%`,top:`${a.rect.y*100}%`,width:`${a.rect.width*100}%`,height:`${a.rect.height*100}%`}} onClick={()=>{setDraft({id:a.id,kind:a.kind,rect:a.rect,comment:a.comment});setMode('read')}}>{a.kind==='comment'?'●':null}</button>)}
      {(draft?.rect||drawing)&&<div className={`pdf-mark draft ${draft?.kind??mode}`} style={{left:`${(draft?.rect??drawing)!.x*100}%`,top:`${(draft?.rect??drawing)!.y*100}%`,width:`${(draft?.rect??drawing)!.width*100}%`,height:`${(draft?.rect??drawing)!.height*100}%`}}/>}
    </div></div></div>
    {!inline&&<aside className="pdf-annotations-panel" aria-label="Anotações do PDF"><h3>Anotações <span>{annotations.length}</span></h3><small>Página {page} · arquivo original preservado{readOnly?' · somente leitura':''}</small>
      {readOnly?null:!draft?<><div className="pdf-tools"><button aria-pressed={mode==='highlight'} onClick={()=>setMode(mode==='highlight'?'read':'highlight')} disabled={!ready}>Destacar área</button><button aria-pressed={mode==='comment'} onClick={()=>setMode(mode==='comment'?'read':'comment')} disabled={!ready}>Comentar página</button></div><p className="pdf-instruction">{mode==='highlight'?'Arraste sobre a página para destacar uma área.':mode==='comment'?'Clique na página para posicionar o comentário.':'Selecione uma marcação para editar.'}</p>{mode!=='read'&&<button onClick={cancel}>Cancelar marcação</button>}</>:<div className="pdf-annotation-editor"><label htmlFor="pdf-comment">{draft.kind==='highlight'?'Comentário do destaque (opcional)':'Comentário'}</label><textarea id="pdf-comment" value={draft.comment} maxLength={4000} rows={4} placeholder="Escreva uma observação…" onChange={e=>setDraft({...draft,comment:e.target.value})}/><div><button disabled={busy} onClick={cancel}>Cancelar</button><button className="primary" disabled={busy} onClick={()=>void save()}>{busy?'Salvando…':'Salvar marcação'}</button></div>{draft.id&&<button className="danger" disabled={busy} onClick={()=>void remove()}>Excluir marcação</button>}</div>}
      {error&&<p role="alert">{error}</p>}
      <div className="pdf-annotation-list">{annotations.length===0?<p>Nenhuma marcação nesta página.</p>:annotations.map(a=><button key={a.id} disabled={readOnly||!!draft||mode!=='read'} onClick={()=>setDraft({id:a.id,kind:a.kind,rect:a.rect,comment:a.comment})}><strong>{a.kind==='highlight'?'Destaque':'Comentário'}</strong><span>{a.comment||'Sem comentário'}</span></button>)}</div>
    </aside>}
  </div>;
}
