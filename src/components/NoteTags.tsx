import { useEffect, useState } from "react";
import { Check, Plus, Settings2, Tag, X } from "lucide-react";
import { useAppStore } from "../state/store";
import { client } from "../api/client";
import { useDismissablePopover } from "../hooks/useDismissablePopover";
import { useTagRefresh } from "../hooks/useTagRefresh";
import { normalizeTagName, tagKey, tagSearchKey } from "../../shared/tags";
import { TagManager } from "./TagManager";

export function NoteTags() {
  const { state } = useAppStore();
  const note = state.openNote!;
  const [open, setOpen] = useState(false), [manager, setManager] = useState(false);
  const [query, setQuery] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const popover = useDismissablePopover(open, () => setOpen(false));
  const refresh = useTagRefresh();
  useEffect(() => { setOpen(false); setQuery(""); setError(""); }, [note.id]);
  const attached = new Set(note.tags.map(tag => tag.id));
  const filtered = state.tags.filter(tag => tagSearchKey(tag.name).includes(tagSearchKey(query))).sort((a,b) => Number(attached.has(b.id)) - Number(attached.has(a.id)) || a.name.localeCompare(b.name));
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); await refresh(); } catch(e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const toggle = (id: number) => run(() => attached.has(id) ? client.detachTag(note.id,id) : client.attachTag(note.id,id));
  const create = () => run(async () => {
    const name = normalizeTagName(query);
    if (!name) return;
    const tag = state.tags.find(tag => tagKey(tag.name) === tagKey(name)) ?? state.tags.find(tag => tagSearchKey(tag.name) === tagSearchKey(name)) ?? await client.createTag(name);
    if (!tag) throw new Error("Essa etiqueta já existe. Atualize a busca e selecione-a na lista.");
    if (!attached.has(tag.id)) await client.attachTag(note.id, tag.id);
    setQuery("");
  });
  return <span className="pop-anchor" ref={popover.rootRef}>
    <button ref={popover.triggerRef} className={attached.size ? "active" : undefined} title="Etiquetas" aria-label="Etiquetas" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setQuery(""); setError(""); setOpen(v => !v); }}><Tag size={13}/>{attached.size || null}</button>
    {open && <div className="menu-pop tag-pop" role="dialog" aria-label="Etiquetas da nota">
      <header><strong>Etiquetas da nota</strong><small>Marque quantas precisar.</small></header>
      {note.tags.length > 0 && <div className="tag-list">{note.tags.map(tag => <span className="tag-chip" key={tag.id}><span title={tag.name}>{tag.name}</span><button disabled={busy} aria-label={`Remover etiqueta ${tag.name} desta nota`} onClick={() => void toggle(tag.id)}><X size={11}/></button></span>)}</div>}
      <input autoFocus type="search" aria-label="Buscar ou criar etiqueta" maxLength={80} value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar ou criar etiqueta…" onKeyDown={e => { if(e.key === "Enter") { e.preventDefault(); void create(); } }}/>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="tag-options" role="group" aria-label="Etiquetas disponíveis">{filtered.map(tag => <button className="tag-option" role="checkbox" aria-checked={attached.has(tag.id)} disabled={busy} key={tag.id} onClick={() => void toggle(tag.id)}><span className="tag-option-check">{attached.has(tag.id) && <Check size={12}/>}</span><span title={tag.name}>{tag.name}</span><small>{tag.noteCount}</small></button>)}
        {!filtered.length && <p className="manager-empty">{query ? "Nenhuma etiqueta encontrada." : "Crie sua primeira etiqueta abaixo."}</p>}
      </div>
      {normalizeTagName(query) && !state.tags.some(tag => tagSearchKey(tag.name) === tagSearchKey(query)) && <button className="tag-create-inline" disabled={busy} onClick={() => void create()}><Plus size={14}/><span>Criar “{normalizeTagName(query)}”</span></button>}
      <button className="tag-manage-link" onClick={() => { setOpen(false); setManager(true); }}><Settings2 size={13}/> Gerenciar todas as etiquetas</button>
    </div>}
    {manager && <TagManager onClose={() => { setManager(false); requestAnimationFrame(() => popover.triggerRef.current?.focus()); }}/>} 
  </span>;
}
