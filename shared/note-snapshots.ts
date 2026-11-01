import type {NoteMeta} from "./ipc";
const fields = ["id","notebookId","folderId","title","favorited","pinned","createdAt","updatedAt","deletedAt","preview","matchSource","matchSourceKind","matchSnippet"] as const;
export function sameNote(a:NoteMeta,b:NoteMeta):boolean {
  return a===b || (fields.every(key=>a[key]===b[key]) && a.tags.length===b.tags.length && a.tags.every((tag,i)=>tag.id===b.tags[i].id&&tag.name===b.tags[i].name&&tag.color===b.tags[i].color));
}
/** Keep unchanged rows referentially stable so saves do not repaint an entire notebook. */
export function shareNoteSnapshot(previous:NoteMeta[],incoming:NoteMeta[]):NoteMeta[]{
  const byId=new Map(previous.map(note=>[note.id,note]));
  let identical=previous.length===incoming.length;
  const next=incoming.map((note,index)=>{const old=byId.get(note.id),value=old&&sameNote(old,note)?old:note;if(value!==previous[index])identical=false;return value;});
  return identical?previous:next;
}
