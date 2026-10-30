import { useEffect, useId, useRef, useState } from "react";
import { Check, FileText, Search, X } from "lucide-react";
import { client } from "../api/client";
import type { NoteLinkTarget } from "../../shared/ipc";

export function NotePicker({ value, onChange, excludeId, autoFocus = false, optional = false }: {
  value: { id: string; title: string } | null;
  onChange: (note: NoteLinkTarget | null) => void;
  excludeId?: string;
  autoFocus?: boolean;
  optional?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteLinkTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const [selectedTitle, setSelectedTitle] = useState("");
  useEffect(() => {
    let alive = true;
    setSelectedTitle("");
    if (value?.id && !value.title) void client.getNote(value.id).then(note => { if (alive) setSelectedTitle(note?.title || "Sem título"); }).catch(() => { if (alive) setSelectedTitle("Não foi possível carregar o título"); });
    return () => { alive = false; };
  }, [value?.id, value?.title]);
  useEffect(() => { document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, results, id]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(""); setResults([]); setActive(0);
    const timer = window.setTimeout(() => {
      const find = query.trim() ? client.findNotes(query, 30) : client.listNotes({ view: "all", order: "updated_desc" }).then(notes => notes.slice(0, 30));
      void find.then(notes => { if (alive) setResults(notes.filter(note => note.id !== excludeId)); }).catch(e => { if (alive) setError((e as Error).message); }).finally(() => { if (alive) setLoading(false); });
    }, 180);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query, excludeId]);
  const choose = (note: NoteLinkTarget) => { onChange(note); input.current?.focus(); };
  return <div className="note-picker">
    <label htmlFor={id}>Buscar nota{optional ? " (opcional)" : ""}</label>
    <div className="note-picker-search"><Search size={15}/><input ref={input} id={id} autoFocus={autoFocus} type="search" maxLength={200} value={query} placeholder="Título ou conteúdo da nota…" role="combobox" aria-autocomplete="list" aria-expanded={results.length > 0} aria-controls={`${id}-results`} aria-activedescendant={results[active] ? `${id}-${active}` : undefined} onChange={e => setQuery(e.target.value)} onKeyDown={e => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (results.length) setActive(i => Math.min(results.length - 1, i + 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); if (results.length) setActive(i => Math.max(0, i - 1)); }
      if (e.key === "Enter") { e.preventDefault(); if (results[active]) choose(results[active]); }
    }}/></div>
    <div className="note-picker-status" role="status">{loading ? "Buscando notas…" : error ? "Não foi possível buscar as notas." : `${results.length} ${results.length === 1 ? "nota encontrada" : "notas encontradas"}${results.length === 30 ? " · refine a busca" : ""}`}</div>
    {error && <p role="alert">{error}</p>}
    <div id={`${id}-results`} className="note-picker-results" role="listbox" aria-label="Notas encontradas" aria-busy={loading}>
      {results.map((note, index) => <button type="button" role="option" data-note-id={note.id} id={`${id}-${index}`} key={note.id} aria-selected={value?.id === note.id} className={active === index ? "keyboard-active" : undefined} onMouseEnter={() => setActive(index)} onClick={() => choose(note)}>
        <FileText size={16}/><span><strong>{note.title || "Sem título"}</strong><small>{note.preview.replace(/<[^>]*>/g, "").replace(/\s+/g, " ") || "Nota sem conteúdo"}</small></span>{value?.id === note.id && <Check size={16}/>}
      </button>)}
      {!loading && !error && results.length === 0 && <p className="note-picker-empty">Nenhuma nota encontrada. Tente outro título ou uma palavra do conteúdo.</p>}
    </div>
    {value && <div className="note-picker-selected"><Check size={15}/><span><small>Nota selecionada</small><strong>{value.title || selectedTitle || "Carregando título…"}</strong></span><button type="button" aria-label="Limpar nota selecionada" onClick={() => onChange(null)}><X size={14}/></button></div>}
  </div>;
}
