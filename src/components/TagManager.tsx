import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, Pencil, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { useAppStore } from "../state/store";
import { client } from "../api/client";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useTagRefresh } from "../hooks/useTagRefresh";
import { normalizeTagName, tagSearchKey } from "../../shared/tags";

export function TagManager({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useAppStore();
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useDialogFocus(true, () => { if (!busy) onClose(); });
  const refresh = useTagRefresh();
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const create = () => run(async () => {
    const tag = await client.createTag(normalizeTagName(newName));
    if (!tag) throw new Error("Já existe uma etiqueta com esse nome.");
    setNewName(""); setQuery("");
  });
  const rename = (id: number) => run(async () => {
    if (!await client.renameTag(id, normalizeTagName(name))) throw new Error("Já existe uma etiqueta com esse nome.");
    setEditing(null); setQuery("");
  });
  const remove = (id: number) => run(async () => {
    if (!await client.deleteTag(id)) throw new Error("Essa etiqueta já foi excluída.");
    if (state.selection.kind === "tag" && state.selection.tagId === id) { dispatch({ type: "selection", selection: { kind: "all" } }); await new Promise(requestAnimationFrame); }
    setDeleting(null);
  });
  const tags = state.tags.filter(tag => tagSearchKey(tag.name).includes(tagSearchKey(query)));
  return createPortal(<div className="overlay dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={root} className="modal tag-manager" role="dialog" aria-modal="true" aria-labelledby="tag-manager-title">
      <header className="dialog-heading"><span><h3 id="tag-manager-title">Gerenciar etiquetas</h3><p>Organize suas etiquetas. Renomear mantém os vínculos com as notas.</p></span><button aria-label="Fechar gestão de etiquetas" disabled={busy} onClick={onClose}><X size={17}/></button></header>
      <form className="tag-create-form" onSubmit={e => { e.preventDefault(); void create(); }}><label htmlFor="new-tag-name">Nova etiqueta</label><div><input id="new-tag-name" value={newName} maxLength={80} disabled={busy} placeholder="Ex.: Projetos, Financeiro, Ideias…" onChange={e => setNewName(e.target.value)}/><button className="primary" disabled={busy || !normalizeTagName(newName)}><Plus size={14}/> Criar etiqueta</button></div></form>
      <div className="manager-search"><Search size={15}/><input aria-label="Buscar etiquetas" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filtrar etiquetas…"/></div>
      <span className="manager-count" role="status">{busy ? "Atualizando etiquetas…" : `${tags.length} de ${state.tags.length} etiquetas`}</span>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="tag-manager-list" aria-label="Lista de etiquetas" aria-busy={busy}>
        {tags.map(tag => <article key={tag.id} className="tag-manager-row" aria-label={tag.name}>
          {deleting === tag.id ? <div className="tag-delete-confirm"><strong>Excluir “{tag.name}”?</strong><p>A etiqueta será removida das notas vinculadas. As notas e seus conteúdos serão mantidos.</p><div><button disabled={busy} onClick={() => setDeleting(null)}>Cancelar exclusão</button><button className="danger" disabled={busy} onClick={() => void remove(tag.id)}>Excluir etiqueta</button></div></div> : editing === tag.id ? <form className="tag-rename-form" onSubmit={e => { e.preventDefault(); void rename(tag.id); }}><input autoFocus aria-label={`Novo nome de ${tag.name}`} value={name} maxLength={80} disabled={busy} onChange={e => setName(e.target.value)} onKeyDown={e => { if(e.key === "Escape") { e.preventDefault(); setEditing(null); } }}/><button disabled={busy || !normalizeTagName(name)} aria-label="Salvar nome da etiqueta"><Check size={16}/></button><button type="button" disabled={busy} aria-label="Cancelar renomeação" onClick={() => setEditing(null)}><X size={16}/></button></form> : <><Tag size={16}/><span className="tag-manager-name"><strong title={tag.name}>{tag.name}</strong><small>{tag.noteCount} {tag.noteCount === 1 ? "nota vinculada" : "notas vinculadas"}</small></span><button aria-label={`Renomear ${tag.name}`} title="Renomear etiqueta" disabled={busy} onClick={() => { setEditing(tag.id); setName(tag.name); setError(""); }}><Pencil size={15}/></button><button aria-label={`Excluir ${tag.name}`} title="Excluir etiqueta" disabled={busy} onClick={() => { setDeleting(tag.id); setEditing(null); setError(""); }}><Trash2 size={15}/></button></>}
        </article>)}
        {tags.length === 0 && <p className="manager-empty">{state.tags.length ? "Nenhuma etiqueta corresponde à busca." : "Você ainda não criou etiquetas. Use o campo acima para começar."}</p>}
      </div>
      <footer className="row"><button onClick={onClose} disabled={busy}>Concluir</button></footer>
    </section>
  </div>, document.body);
}
