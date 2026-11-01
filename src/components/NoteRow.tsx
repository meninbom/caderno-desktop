import {memo,type DragEvent} from "react";
import {Pin,Star} from "lucide-react";
import type {NoteMeta} from "../../shared/ipc";
const date=new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"short"}),time=new Intl.DateTimeFormat("pt-BR",{hour:"2-digit",minute:"2-digit"});
function formatDate(value:number){const d=new Date(value);return d.toDateString()===new Date().toDateString()?time.format(d):date.format(d);}
export const NoteRow=memo(function NoteRow({note:n,selected,dragging,inTrash,folderName,onOpen,onFavorite,onDragStart,onDragEnd,measure}:{note:NoteMeta;selected:boolean;dragging:boolean;inTrash:boolean;folderName?:string;onOpen:(note:NoteMeta)=>void;onFavorite:(note:NoteMeta)=>void;onDragStart:(note:NoteMeta,event:DragEvent<HTMLButtonElement>)=>void;onDragEnd:(event:DragEvent<HTMLButtonElement>)=>void;measure:(element:HTMLElement|null)=>void}){
  return <button ref={measure} data-note-id={n.id} type="button" className={`note-row ${selected?"selected":""} ${dragging?"is-dragging":""}`} draggable={!inTrash&&!n.deletedAt} onDragStart={event=>onDragStart(n,event)} onDragEnd={onDragEnd} onClick={()=>onOpen(n)}>
    <span className="row-title"><span className="tt">{n.title||<em style={{color:"var(--text-faint)",fontWeight:400}}>Sem título</em>}</span><span className="mark">{n.pinned&&<span className="pinned" title="Fixada"><Pin size={11}/></span>}{n.deletedAt&&<span title="Na lixeira">🗑</span>}</span></span>
    {n.matchSource&&<span className="row-meta">Anexo: {n.matchSource}</span>}
    {(n.matchSnippet||n.preview)&&<span className="row-preview">{n.matchSnippet||n.preview}</span>}
    <span className="row-meta"><span>{formatDate(n.updatedAt)}</span>{folderName&&<span className="meta-tag">{folderName}</span>}
      {n.tags.length>0&&<span className="meta-tags">{n.tags.slice(0,3).map(t=><span key={t.id} className="meta-tag" style={t.color?{"--tag-color":t.color} as React.CSSProperties:undefined}>{t.name}</span>)}{n.tags.length>3&&<span className="meta-tag meta-tag-overflow" title={n.tags.slice(3).map(t=>t.name).join(", ")}>+{n.tags.length-3}</span>}</span>}
      {n.favorited&&<span className="fav" onClick={event=>{event.stopPropagation();onFavorite(n);}} title="Remover favorito"><Star size={11} fill="currentColor"/></span>}
    </span>
  </button>;
});
