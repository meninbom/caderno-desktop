import { useEffect, useState } from 'react';
import { ArrowUpRight, Link2 } from 'lucide-react';
import type { NoteLinkTarget } from '../../shared/ipc';
import { client } from '../api/client';

export function NoteBacklinks({id,revision,onOpen}:{id:string;revision:unknown;onOpen:(id:string)=>void|Promise<void>}){
  const [notes,setNotes]=useState<NoteLinkTarget[]>([]),[error,setError]=useState('');
  useEffect(()=>{let alive=true;const refresh=()=>{void client.backlinks(id).then(value=>{if(alive){setNotes(value);setError('')}}).catch(e=>{if(alive)setError(e.message)})};refresh();window.addEventListener('focus',refresh);return()=>{alive=false;window.removeEventListener('focus',refresh)}},[id,revision]);
  return <details className="note-backlinks"><summary><Link2 size={14}/><span>Referências a esta nota</span><span className="count">{notes.length}</span></summary>{error?<p role="alert">{error}</p>:notes.length===0?<p>Notas que criarem um link para esta aparecerão aqui.</p>:<div>{notes.map(note=><button key={note.id} data-backlink-id={note.id} onClick={()=>{void Promise.resolve(onOpen(note.id)).catch(e=>setError(e.message))}}><span><strong>{note.title||'Sem título'}</strong><small>{note.preview}</small></span><ArrowUpRight size={15}/></button>)}</div>}</details>;
}
