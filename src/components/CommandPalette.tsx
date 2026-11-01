import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, FileText, Search, Terminal, X } from 'lucide-react';
import type { NoteMeta } from '../../shared/ipc';
import { client } from '../api/client';
import { useDialogFocus } from '../hooks/useDialogFocus';

export interface PaletteCommand { id:string; title:string; description:string; keywords?:string; run:()=>void|Promise<void> }
const fold=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function Excerpt({text,query}:{text:string;query:string}){
  const index=query?fold(text).indexOf(fold(query)):-1;
  return index<0?<>{text}</>:<>{text.slice(0,index)}<mark>{text.slice(index,index+query.length)}</mark>{text.slice(index+query.length)}</>;
}
export function CommandPalette({commands,onClose,onNote,initialQuery=''}:{commands:PaletteCommand[];onClose:()=>void;onNote:(id:string)=>void|Promise<void>;initialQuery?:string}){
  const [query,setQuery]=useState(()=>initialQuery.slice(0,200)),[tab,setTab]=useState<'all'|'notes'|'commands'>('all'),[notes,setNotes]=useState<NoteMeta[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[active,setActive]=useState(0);
  const root=useDialogFocus(true,onClose),list=useRef<HTMLDivElement>(null);
  const searchInput=useRef<HTMLInputElement>(null);
  useLayoutEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const background=document.getElementById('root');
    const wasInert=background?.inert??false;
    // The palette is portalled to body. Deferred focus from an editor/popover
    // must not move keyboard input back into the application behind it.
    if(background)background.inert=true;
    const keepFocus=()=>{if(root.current&&!root.current.contains(document.activeElement))searchInput.current?.focus({preventScroll:true})};
    document.addEventListener('focusin',keepFocus);
    window.addEventListener('focus',keepFocus);
    searchInput.current?.focus({preventScroll:true});
    return()=>{
      document.removeEventListener('focusin',keepFocus);
      window.removeEventListener('focus',keepFocus);
      if(background)background.inert=wasInert;
      if(previous?.isConnected)previous.focus({preventScroll:true});
    };
  },[root]);
  const term=query.replace(/^>/,'').trim(),commandsOnly=tab==='commands'||query.startsWith('>');
  const matching=tab==='notes'?[]:commands.filter(c=>!term||fold(`${c.title} ${c.description} ${c.keywords??''}`).includes(fold(term)));
  const rows=[...matching.map(command=>({id:command.id,title:command.title,detail:command.description,kind:'command' as const,run:command.run})),...(!commandsOnly?notes:[]).map(note=>({id:note.id,title:note.title||'Sem título',detail:`${note.matchSource?`${note.matchSource} · `:''}${note.matchSnippet||note.preview||'Nota sem conteúdo'}`,kind:'note' as const,run:()=>onNote(note.id)}))];
  useEffect(()=>{let alive=true;setActive(0);setError('');setNotes([]);if(commandsOnly){setLoading(false);return;}setLoading(true);const timer=setTimeout(()=>{const request=client.searchNotes(term,term?50:8);request.then(value=>{if(alive)setNotes(value)}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setLoading(false)});},term?120:0);return()=>{alive=false;clearTimeout(timer)}},[term,commandsOnly]);
  useEffect(()=>setActive(0),[tab]);
  useEffect(()=>{list.current?.querySelector(`[data-result-index="${active}"]`)?.scrollIntoView({block:'nearest'})},[active]);
  const choose=(run:()=>void|Promise<void>)=>{onClose();requestAnimationFrame(()=>{void Promise.resolve().then(run).catch(e=>window.dispatchEvent(new CustomEvent('caderno:command-error',{detail:e.message})))});};
  return createPortal(<div className="overlay command-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section ref={root} role="dialog" aria-modal="true" aria-labelledby="command-title" className="command-palette" onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setActive(i=>(i+(e.key==='ArrowDown'?1:-1)+Math.max(1,rows.length))%Math.max(1,rows.length));}if(e.key==='Enter'&&e.target instanceof HTMLInputElement){e.preventDefault();if(rows[active])choose(rows[active].run)}}}>
    <div className="command-search"><Search size={20}/><label className="sr-only" htmlFor="command-query" id="command-title">Pesquisar no Caderno</label><input ref={searchInput} id="command-query" value={query} maxLength={200} placeholder="Pesquisar palavras do título ou conteúdo…" autoComplete="off" onChange={e=>setQuery(e.target.value)} aria-controls="command-results" aria-activedescendant={rows[active]?`command-result-${active}`:undefined}/><button aria-label="Fechar busca geral" onClick={onClose}><X size={17}/></button></div>
    <nav className="command-tabs" aria-label="Buscar em">{([['all','Tudo'],['notes','Notas'],['commands','Comandos']] as const).map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);searchInput.current?.focus({preventScroll:true})}}>{label}</button>)}<span>Ctrl+K</span></nav>
    <div className="command-results" id="command-results" ref={list} aria-busy={loading}>
      {loading&&<p role="status">Pesquisando nas notas…</p>}{error&&<p role="alert">{error}</p>}
      {!loading&&!error&&rows.length===0&&<p>Nenhum resultado. Tente outra palavra do conteúdo.</p>}
      {rows.map((row,index)=><div key={`${row.kind}-${row.id}`}>
        {(index===0||rows[index-1].kind!==row.kind)&&<h4>{row.kind==='command'?'Comandos':term?'Notas encontradas':'Notas recentes'}</h4>}
        <button id={`command-result-${index}`} data-note-id={row.kind==='note'?row.id:undefined} data-result-index={index} className={`command-result ${active===index?'selected':''}`} onMouseMove={()=>setActive(index)} onFocus={()=>setActive(index)} onClick={()=>choose(row.run)}>{row.kind==='note'?<FileText size={18}/>:<Terminal size={18}/>}<span><strong>{row.title}</strong><small><Excerpt text={row.detail} query={row.kind==='note'?term:''}/></small></span><ArrowUpRight size={15}/></button>
      </div>)}
    </div><footer><span>↑ ↓ Navegar</span><span>↵ Abrir</span><span>Esc Fechar</span><span>Use &gt; para comandos</span></footer>
  </section></div>,document.body);
}
