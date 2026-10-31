import React, { useMemo, useEffect, useRef, useState } from "react";
import { Star, Pin, StickyNote, Search, SlidersHorizontal, ChevronDown, X, PanelRightClose } from "lucide-react";
import { useAppStore } from "../state/store";
import { client } from "../api/client";
import { beginSidebarDrag, endSidebarDrag } from "./sidebarDrag";

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

const FILTER_KEYS = ["notebook", "tag", "after", "before", "type"] as const;
type FilterKey = typeof FILTER_KEYS[number];
const FILTER_LABELS: Record<FilterKey, string> = { notebook: "Caderno", tag: "Etiqueta", after: "Depois de", before: "Antes de", type: "Tipo" };
const TYPE_OPTIONS = [
  { value: "", label: "Tudo" },
  { value: "note", label: "Notas" },
  { value: "attachment", label: "Anexos" },
  { value: "transcription", label: "Transcrições" },
];

function fmtFilterValue(key: FilterKey, value: string): string {
  if (key === "type") return TYPE_OPTIONS.find(o => o.value === value)?.label ?? value;
  if (key === "after" || key === "before") return value.split("-").reverse().join("/");
  return value;
}

const VIEW_TITLES: Record<string, string> = {
  all: "Notas",
  favorites: "Favoritas",
  trash: "Lixeira",
  unfiled: "Sem caderno",
};

export function NoteList({ onCollapse }: { onCollapse?: () => void } = {}) {
  const { state, dispatch, openNote, refreshMeta, refreshNotes } = useAppStore();
  const selectionKey = state.selection.kind;
  const updateFilter=(key:string,value:string)=>{const tokens=state.search.match(/(?:[^\s"]+|"(?:\\.|[^"])*")+/g)??[];const kept=tokens.filter(t=>!t.toLowerCase().startsWith(`${key}:`));if(value)kept.push(`${key}:${/[\s"]/.test(value)?`"${value.replace(/([\\"])/g,"\\$1")}"`:value}`);dispatch({type:"search",value:kept.join(" ")});};
  const filterValue=(key:string)=>{const m=new RegExp(`(?:^|\\s)${key}:(?:"((?:\\\\.|[^"])*)"|(\\S+))`,'i').exec(state.search);return(m?.[1]??m?.[2]??"").replace(/\\([\\"])/g,"$1")};

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const dragClick = useRef(false);
  const activeFilters = FILTER_KEYS.map(key => ({ key, value: filterValue(key) })).filter(f => f.value);
  const clearFilters = () => {
    const tokens = (state.search.match(/(?:[^\s"]+|"(?:\\.|[^"])*")+/g) ?? []).filter(t => !/^(notebook|tag|before|after|type):/i.test(t));
    dispatch({ type: "search", value: tokens.join(" ") });
  };

  const headerTitle = useMemo(() => {
    if (selectionKey === "notebook") {
      const nb = state.notebooks.find(x => x.id === (state.selection as { notebookId: number }).notebookId);
      return nb?.name ?? "Caderno";
    }
    if (selectionKey === "folder") {
      const sel = state.selection as { notebookId: number; folderId: string };
      const nb = state.notebooks.find(x => x.id === sel.notebookId);
      const folder = state.folders.find(x => x.id === sel.folderId);
      return `${nb?.name ?? "Caderno"} / ${folder?.name ?? "Pasta"}`;
    }
    if (selectionKey === "tag") {
      const t = state.tags.find(x => x.id === (state.selection as { tagId: number }).tagId);
      return `#${t?.name ?? ""}`;
    }
    return VIEW_TITLES[selectionKey] ?? "Notas";
  }, [state.notebooks, state.folders, state.tags, state.selection, selectionKey]);

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
          <span className="notelist-title-text">{headerTitle}</span>
          <span className="count">{state.notes.length}</span>
          {onCollapse && <button className="pane-collapse" title="Recolher lista de notas (Ctrl+Alt+\)" aria-label="Recolher lista de notas" onClick={onCollapse}><PanelRightClose size={14} /></button>}
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
          <div className="search-row">
            <div className="search-field">
              <Search size={13} strokeWidth={1.8} aria-hidden="true" />
              <input
                type="search"
                aria-label="Buscar notas"
                placeholder="Buscar notas…"
                value={state.search}
                onChange={(e) => dispatch({ type: "search", value: e.target.value })}
              />
            </div>
            <button
              type="button"
              className={`filters-toggle ${filtersOpen ? "open" : ""} ${activeFilters.length ? "active" : ""}`}
              aria-expanded={filtersOpen}
              aria-controls="note-filters"
              aria-label={activeFilters.length ? `Filtros (${activeFilters.length} ativos)` : "Filtros"}
              title="Filtros"
              onClick={() => setFiltersOpen(o => !o)}
            >
              <SlidersHorizontal size={14} strokeWidth={1.8} />
              {activeFilters.length > 0 && <span className="filters-badge">{activeFilters.length}</span>}
            </button>
          </div>
          {!filtersOpen && activeFilters.length > 0 && (
            <div className="filter-chips" aria-label="Filtros ativos">
              {activeFilters.map(f => (
                <span key={f.key} className="filter-chip">
                  <span className="chip-label">{FILTER_LABELS[f.key]}: {fmtFilterValue(f.key, f.value)}</span>
                  <button type="button" aria-label={`Remover filtro ${FILTER_LABELS[f.key]}`} onClick={() => updateFilter(f.key, "")}><X size={10} strokeWidth={2} /></button>
                </span>
              ))}
              <button type="button" className="chips-clear" onClick={clearFilters}>Limpar</button>
            </div>
          )}
          {filtersOpen && (
            <div id="note-filters" className="filter-panel" role="group" aria-label="Filtros da busca">
              <label className="filter-field">
                <span>Caderno</span>
                <span className="select-wrap">
                  <select aria-label="Filtrar por caderno" value={filterValue("notebook")} onChange={e=>updateFilter("notebook",e.target.value)}><option value="">Todos</option>{state.notebooks.map(n=><option key={n.id} value={n.name}>{n.name}</option>)}</select>
                  <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
                </span>
              </label>
              <label className="filter-field">
                <span>Etiqueta</span>
                <span className="select-wrap">
                  <select aria-label="Filtrar por etiqueta" value={filterValue("tag")} onChange={e=>updateFilter("tag",e.target.value)}><option value="">Todas</option>{state.tags.map(t=><option key={t.id} value={t.name}>{t.name}</option>)}</select>
                  <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
                </span>
              </label>
              <label className="filter-field">
                <span>Criada depois de</span>
                <input aria-label="Criadas depois de" type="date" value={filterValue("after")} onChange={e=>updateFilter("after",e.target.value)} />
              </label>
              <label className="filter-field">
                <span>Criada antes de</span>
                <input aria-label="Criadas antes de" type="date" value={filterValue("before")} onChange={e=>updateFilter("before",e.target.value)} />
              </label>
              <div className="filter-field wide">
                <span id="filter-type-label">Tipo de resultado</span>
                <div className="segmented" role="radiogroup" aria-labelledby="filter-type-label">
                  {TYPE_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={filterValue("type") === o.value}
                      className={filterValue("type") === o.value ? "on" : ""}
                      onClick={() => updateFilter("type", o.value)}
                    >{o.label}</button>
                  ))}
                </div>
              </div>
              <div className="filter-footer">
                <details className="search-help">
                  <summary aria-label="Ajuda da busca">Dicas de busca</summary>
                  <p>Combine texto e filtros: <code>notebook:"Projetos pessoais" tag:ideias before:2026-12-31 after:2026-01-01 type:note</code></p>
                  <p>Use aspas para valores com espaços. type:attachment pesquisa texto extraído. type:transcription ainda não tem fonte configurada.</p>
                </details>
                {activeFilters.length > 0 && <button type="button" className="clear-filters" onClick={clearFilters}>Limpar filtros</button>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="notes-scroll">
        {state.notes.length === 0 ? (
          <div className="empty-state">
            <StickyNote size={20} strokeWidth={1.6} />
            <span>
              {state.search
                ? filterValue("type")==="transcription" ? "Nenhuma transcrição indexada/configurada. Captura e transcrição pertencem à etapa 4." : filterValue("type")==="attachment" ? "Nenhum texto de anexo indexado corresponde à busca. Confira o estado da indexação em Configurações." : "Nenhuma nota ou anexo corresponde à busca."
                : selectionKey === "trash"
                  ? "A lixeira está vazia."
                  : selectionKey === "folder"
                    ? "Nenhuma nota nesta pasta."
                    : "Nenhuma nota por aqui ainda."}
            </span>
          </div>
        ) : (
          <div className="note-list-col">
            {state.notes.map((n) => (
              <button
                key={n.id}
                className={`note-row ${state.openNoteId === n.id ? "selected" : ""} ${draggingNoteId === n.id ? "is-dragging" : ""}`}
                draggable={selectionKey !== "trash" && !n.deletedAt}
                onDragStart={(event) => {
                  if (selectionKey === "trash" || n.deletedAt) { event.preventDefault(); return; }
                  dragClick.current = true;
                  beginSidebarDrag({ kind: "note", id: n.id, notebookId: n.notebookId, folderId: n.folderId }, event.dataTransfer);
                  setDraggingNoteId(n.id);
                  event.currentTarget.classList.add("is-dragging");
                }}
                onDragEnd={(event) => {
                  event.currentTarget.classList.remove("is-dragging");
                  setDraggingNoteId(null);
                  endSidebarDrag();
                  window.setTimeout(() => { dragClick.current = false; }, 80);
                }}
                onClick={() => { if (dragClick.current) { dragClick.current = false; return; } void openResult(n); }}
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
                  {n.folderId && state.selection.kind !== "folder" && <span className="meta-tag">{state.folders.find(folder => folder.id === n.folderId)?.name}</span>}
                  {n.tags.length > 0 && (
                    <span className="meta-tags">
                      {n.tags.slice(0, 3).map((t) => (
                        <span key={`chip-${n.id}-${t.id}`} className="meta-tag" style={t.color ? { "--tag-color": t.color } as React.CSSProperties : undefined}>{t.name}</span>
                      ))}
                      {n.tags.length > 3 && <span className="meta-tag meta-tag-overflow" title={n.tags.slice(3).map(tag => tag.name).join(", ")}>+{n.tags.length - 3}</span>}
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
