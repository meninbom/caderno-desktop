import React, { useMemo, useEffect, useState } from "react";
import { Star, Pin, StickyNote } from "lucide-react";
import { useAppStore } from "../state/store";
import { client } from "../api/client";

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

const VIEW_TITLES: Record<string, string> = {
  all: "Notas",
  favorites: "Favoritas",
  trash: "Lixeira",
  unfiled: "Sem caderno",
};

export function NoteList() {
  const { state, dispatch, openNote, refreshMeta, refreshNotes } = useAppStore();
  const selectionKey = state.selection.kind;
  const [jobs,setJobs]=useState<Awaited<ReturnType<typeof client.listAttachmentJobs>>>([]);
  const refreshJobs=async()=>{try{setJobs(await client.listAttachmentJobs())}catch{}};
  useEffect(()=>{void refreshJobs();const timer=window.setInterval(()=>void refreshJobs(),1200);return()=>window.clearInterval(timer)},[]);
  const updateFilter=(key:string,value:string)=>{const tokens=state.search.match(/(?:[^\s"]+|"(?:\\.|[^"])*")+/g)??[];const kept=tokens.filter(t=>!t.toLowerCase().startsWith(`${key}:`));if(value)kept.push(`${key}:${/[\s"]/.test(value)?`"${value.replace(/([\\"])/g,"\\$1")}"`:value}`);dispatch({type:"search",value:kept.join(" ")});};
  const filterValue=(key:string)=>{const m=new RegExp(`(?:^|\\s)${key}:(?:"((?:\\\\.|[^"])*)"|(\\S+))`,'i').exec(state.search);return(m?.[1]??m?.[2]??"").replace(/\\([\\"])/g,"$1")};

  const headerTitle = useMemo(() => {
    if (selectionKey === "notebook") {
      const nb = state.notebooks.find(x => x.id === (state.selection as { notebookId: number }).notebookId);
      return nb?.name ?? "Caderno";
    }
    if (selectionKey === "tag") {
      const t = state.tags.find(x => x.id === (state.selection as { tagId: number }).tagId);
      return `#${t?.name ?? ""}`;
    }
    return VIEW_TITLES[selectionKey] ?? "Notas";
  }, [state.notebooks, state.tags, state.selection, selectionKey]);

  const toggleFavorite = async (noteId: string, current: boolean) => {
    const updated = await client.setFavorite(noteId, !current);
    if (updated && state.openNoteId === noteId) {
      dispatch({ type: "openNote", note: updated, noteId });
    }
    await refreshMeta();
    await refreshNotes();
  };
  const openResult=async(n:typeof state.notes[number])=>{
    await openNote(n.id);
    if(!n.matchSource)return;
    if(n.matchSourceKind==="transcription"){
      const attachment=(await client.listAttachments(n.id)).find(a=>a.fileName===n.matchSource);
      if(attachment)window.setTimeout(()=>window.dispatchEvent(new CustomEvent("caderno:open-transcription",{detail:{noteId:n.id,attachmentId:attachment.id}})),0);
      return;
    }
    const attachment=(await client.listAttachments(n.id)).find(a=>a.fileName===n.matchSource);
    if(attachment&&(["application/pdf","text/html"].includes(attachment.mimeType??"")||attachment.mimeType?.startsWith("image/")||attachment.mimeType?.startsWith("video/")))
      window.setTimeout(()=>window.dispatchEvent(new CustomEvent("caderno:preview-attachment",{detail:{noteId:n.id,attachmentId:attachment.id}})),0);
  };

  return (
    <section className="notelist" aria-label="Lista de notas">
      <div className="notelist-header">
        <div className="title">
          <span>{headerTitle}</span>
          <span className="count">{state.notes.length}</span>
        </div>
        {selectionKey !== "trash" ? (
          <div className="notelist-actions">
            <select
              aria-label="Ordenar"
              value={state.orderBy}
              onChange={(e) => dispatch({ type: "order", order: e.target.value as typeof state.orderBy })}
            >
              <option value="updated_desc">Recentes</option>
              <option value="updated_asc">Antigas</option>
              <option value="created_desc">Criadas</option>
              <option value="title_asc">Título A–Z</option>
            </select>
          </div>
        ) : (
          <div className="notelist-actions">
            <button className="btn-trash" onClick={async () => {
              if (!window.confirm("Esvaziar a lixeira? Todas as notas serão excluídas definitivamente.")) return;
              await client.emptyTrash();
              if (state.openNote?.deletedAt) dispatch({ type: "openNote", note: null, noteId: null });
              await refreshMeta();
              await refreshNotes();
            }}>Esvaziar lixeira</button>
          </div>
        )}
        <div className="notelist-search">
          <input
            type="search"
            aria-label="Buscar notas"
            placeholder="Buscar notas…"
            value={state.search}
            onChange={(e) => dispatch({ type: "search", value: e.target.value })}
          />
          <details className="search-help">
            <summary aria-label="Ajuda da busca">Ajuda</summary>
            <p>Combine texto e filtros: <code>notebook:"Projetos pessoais" tag:ideias before:2026-12-31 after:2026-01-01 type:note</code></p>
            <p>Use aspas para valores com espaços. type:attachment pesquisa texto extraído. type:transcription ainda não tem fonte configurada.</p>
          </details>
          <div className="search-filters" aria-label="Filtros da busca">
            <select aria-label="Filtrar por caderno" value={filterValue("notebook")} onChange={e=>updateFilter("notebook",e.target.value)}><option value="">Todos cadernos</option>{state.notebooks.map(n=><option key={n.id} value={n.name}>{n.name}</option>)}</select>
            <select aria-label="Filtrar por etiqueta" value={filterValue("tag")} onChange={e=>updateFilter("tag",e.target.value)}><option value="">Todas etiquetas</option>{state.tags.map(t=><option key={t.id} value={t.name}>{t.name}</option>)}</select>
            <input aria-label="Criadas antes de" type="date" value={filterValue("before")} onChange={e=>updateFilter("before",e.target.value)} />
            <input aria-label="Criadas depois de" type="date" value={filterValue("after")} onChange={e=>updateFilter("after",e.target.value)} />
            <select aria-label="Tipo de resultado" value={filterValue("type")} onChange={e=>updateFilter("type",e.target.value)}><option value="">Notas e anexos</option><option value="note">Notas</option><option value="attachment">Anexos com texto</option><option value="transcription">Transcrições</option></select>
            {(filterValue("notebook")||filterValue("tag")||filterValue("before")||filterValue("after")||filterValue("type"))&&<button className="ghost" onClick={()=>{const tokens=(state.search.match(/(?:[^\s"]+|"(?:\\.|[^"])*")+/g)??[]).filter(t=>! /^(notebook|tag|before|after|type):/i.test(t));dispatch({type:"search",value:tokens.join(" ")})}}>Limpar filtros</button>}
          </div>
        </div>
        {jobs.length>0&&<div className="attachment-jobs" aria-label="Estado da indexação de anexos"><strong>Indexação local</strong>{jobs.slice(0,3).map(j=><div key={j.id}><span title={j.error??j.status}>{j.fileName}: {j.status==='running'?`processando ${j.progress}%${j.totalPages?` · página ${Math.min(j.checkpoint,j.totalPages)}/${j.totalPages}`:""}`:j.status}{j.status==='error'&&j.error?` — ${j.error}`:""}</span>{j.status==='error'&&<button onClick={async()=>{await client.retryAttachmentJob(j.id);await refreshJobs()}}>Tentar novamente</button>}{['queued','running'].includes(j.status)&&<button onClick={async()=>{await client.cancelAttachmentJob(j.id);await refreshJobs()}}>Cancelar</button>}</div>)}<button onClick={async()=>{await client.reindexAttachments();await refreshJobs()}}>Reindexar anexos</button></div>}
      </div>

      <div className="notes-scroll">
        {state.notes.length === 0 ? (
          <div className="empty-state">
            <StickyNote size={20} strokeWidth={1.6} />
            <span>
              {state.search
                ? filterValue("type")==="transcription" ? "Nenhuma transcrição indexada/configurada. Captura e transcrição pertencem à etapa 4." : filterValue("type")==="attachment" ? "Nenhum texto de anexo indexado corresponde à busca. Confira o estado da indexação acima." : "Nenhuma nota ou anexo corresponde à busca."
                : selectionKey === "trash"
                  ? "A lixeira está vazia."
                  : "Nenhuma nota por aqui ainda."}
            </span>
          </div>
        ) : (
          <div className="note-list-col">
            {state.notes.map((n) => (
              <button
                key={n.id}
                className={`note-row ${state.openNoteId === n.id ? "selected" : ""}`}
                onClick={() => void openResult(n)}
              >
                <span className="row-title">
                  <span className="tt">{n.title ? n.title : <em style={{ color: "var(--text-faint)", fontWeight: 400 }}>Sem título</em>}</span>
                  <span className="mark">
                    {n.pinned === true && <span className="pinned" title="Fixada"><Pin size={11} /></span>}
                    {n.deletedAt && <span title="Na lixeira">🗑</span>}
                  </span>
                </span>
                {n.matchSource&&<span className="row-meta">Anexo: {n.matchSource}</span>}
                {(n.matchSnippet||n.preview) && <span className="row-preview">{n.matchSnippet||n.preview}</span>}
                <span className="row-meta">
                  <span>{fmtDate(n.updatedAt)}</span>
                  {n.tags.length > 0 && (
                    <span className="meta-tags">
                      {n.tags.slice(0, 3).map((t) => (
                        <span key={`chip-${n.id}-${t.id}`} className="meta-tag">{t.name}</span>
                      ))}
                    </span>
                  )}
                  {n.favorited && (
                    <span className="fav" onClick={(e) => { e.stopPropagation(); void toggleFavorite(n.id, n.favorited); }} title="Remover favorito">
                      <Star size={11} fill="currentColor" />
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
