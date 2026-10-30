import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FilePlus2, Pencil, Trash2, X, Search, LayoutTemplate } from "lucide-react";
import type { NoteTemplateFull, NoteTemplateMeta, TemplateSaveResult } from "../../shared/ipc";
import { client } from "../api/client";
import { useDialogFocus } from "../hooks/useDialogFocus";

const PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const PREVIEW_CSS = "body{font:13px/1.55 'Segoe UI',system-ui,sans-serif;color:#27272a;background:#fff;margin:12px;overflow-wrap:anywhere}h1,h2,h3{margin:.8em 0 .3em}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #bbb;padding:4px 6px}th{background:#f1f1f3}ul[data-type=taskList]{list-style:none;padding-left:2px}ul[data-type=taskList] li{display:flex;gap:6px}img{max-width:100%;height:auto}blockquote{border-left:3px solid #1b4ed8;margin:8px 0;padding:0 12px;color:#555}.template-asset-card{border:1px solid #ccc;border-radius:6px;padding:8px;margin:8px 0}.template-asset-card span,.template-asset-card small{display:block;color:#666}";
const previewDoc = (html: string) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><style>${PREVIEW_CSS}</style></head><body>${html}</body></html>`;

export function TemplatePickerDialog({ notebookId, onClose, onCreated }: { notebookId: number | null; onClose: () => void; onCreated: (noteId: string) => void | Promise<void> }) {
  const root = useDialogFocus(true, onClose);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<NoteTemplateMeta[]>([]);
  const [selected, setSelected] = useState<NoteTemplateFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const selectedId = useRef<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try { setItems(await client.listTemplates(q)); setError(""); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(query), 150); return () => window.clearTimeout(timer); }, [query, load]);
  const select = async (id: string) => {
    selectedId.current = id; setConfirmDelete(null);
    try { const full = await client.getTemplate(id); if (selectedId.current === id) setSelected(full); } catch (e) { setError((e as Error).message); }
  };
  const create = async () => {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try {
      const note = await client.applyTemplate(selected.id, notebookId);
      if (!note) throw new Error("A nota não foi criada.");
      onClose();
      await onCreated(note.id);
    } catch (e) { setError(`Nota não criada; nada foi alterado: ${(e as Error).message}`); setBusy(false); }
  };
  const rename = async () => {
    if (!renaming || !renaming.name.trim()) return;
    try { await client.updateTemplate({ id: renaming.id, name: renaming.name }); setRenaming(null); await load(query); if (selected?.id === renaming.id) await select(renaming.id); } catch (e) { setError((e as Error).message); }
  };
  const remove = async (id: string) => {
    try { await client.deleteTemplate(id); setConfirmDelete(null); if (selected?.id === id) { setSelected(null); selectedId.current = null; } await load(query); } catch (e) { setError((e as Error).message); }
  };
  const doc = useMemo(() => selected ? previewDoc(selected.previewHtml) : "", [selected]);

  return <div className="overlay dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={root} className="modal template-modal" role="dialog" aria-modal="true" aria-labelledby="template-picker-title">
      <header className="dialog-heading"><span><h3 id="template-picker-title">Nova nota a partir de modelo</h3><p>Escolha um modelo, veja a prévia e crie uma nota nova. Nenhuma nota existente é alterada.</p></span><button aria-label="Fechar modelos" onClick={onClose}><X size={17} /></button></header>
      <div className="template-layout">
        <div className="template-list-col">
          <div className="note-picker-search"><Search size={15} /><input type="search" aria-label="Buscar modelos" placeholder="Buscar modelo…" value={query} maxLength={200} onChange={e => setQuery(e.target.value)} /></div>
          <div className="template-list" role="listbox" aria-label="Modelos" aria-busy={loading}>
            {items.map(t => <div key={t.id} className={`template-item${selected?.id === t.id ? " active" : ""}`}>
              {renaming?.id === t.id ? <form className="template-rename" onSubmit={e => { e.preventDefault(); void rename(); }}><input autoFocus aria-label="Novo nome do modelo" value={renaming.name} maxLength={120} onChange={e => setRenaming({ id: t.id, name: e.target.value })} /><button type="submit" aria-label="Confirmar nome"><Check size={14} /></button><button type="button" aria-label="Cancelar renomeação" onClick={() => setRenaming(null)}><X size={14} /></button></form>
                : <button type="button" role="option" aria-selected={selected?.id === t.id} data-template-id={t.id} className="template-pick" onClick={() => void select(t.id)}><LayoutTemplate size={15} /><span><strong>{t.name}</strong><small>{t.description || t.preview || "Modelo sem descrição"}{t.assetCount ? ` · ${t.assetCount} mídia(s)` : ""}{t.builtinKey ? " · pronto" : ""}</small></span></button>}
              {renaming?.id !== t.id && <span className="template-item-actions">
                <button type="button" aria-label={`Renomear ${t.name}`} title="Renomear" onClick={() => setRenaming({ id: t.id, name: t.name })}><Pencil size={13} /></button>
                {confirmDelete === t.id ? <button type="button" className="danger" aria-label={`Confirmar exclusão de ${t.name}`} onClick={() => void remove(t.id)}>Excluir?</button> : <button type="button" aria-label={`Excluir ${t.name}`} title="Excluir modelo" onClick={() => setConfirmDelete(t.id)}><Trash2 size={13} /></button>}
              </span>}
            </div>)}
            {!loading && items.length === 0 && <p className="note-picker-empty">Nenhum modelo encontrado.</p>}
          </div>
          <button type="button" className="template-restore" onClick={async () => { try { const n = await client.restoreBuiltinTemplates(); setError(n ? "" : "Todos os modelos prontos já estão disponíveis."); await load(query); } catch (e) { setError((e as Error).message); } }}>Restaurar modelos prontos</button>
        </div>
        <div className="template-preview-col">
          {selected ? <><div className="template-preview-head"><strong>{selected.name}</strong><small>Título da nota: “{selected.noteTitle || "Sem título"}”{selected.assets.length ? ` · ${selected.assets.length} mídia(s) serão copiadas para a nota nova` : ""}</small></div>
            <iframe className="template-preview" title={`Prévia do modelo ${selected.name}`} sandbox="" referrerPolicy="no-referrer" srcDoc={doc} /></>
            : <p className="template-preview-empty">Selecione um modelo para ver a prévia.</p>}
        </div>
      </div>
      {error && <p role="alert" className="template-error">{error}</p>}
      <div className="row"><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!selected || busy} onClick={() => void create()}><FilePlus2 size={14} /> {busy ? "Criando…" : "Criar nota"}</button></div>
    </section>
  </div>;
}

export function SaveTemplateDialog({ noteId, noteTitle, onClose, onSaved }: { noteId: string; noteTitle: string; onClose: () => void; onSaved: (result: TemplateSaveResult) => void }) {
  const root = useDialogFocus(true, onClose);
  const [name, setName] = useState(noteTitle.trim());
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState(noteTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim() || busy) { setError("Dê um nome ao modelo."); return; }
    setBusy(true); setError("");
    try {
      await new Promise<void>((resolve, reject) => window.dispatchEvent(new CustomEvent("caderno:flush-editor", { detail: { resolve, reject } })));
      onSaved(await client.createTemplateFromNote({ noteId, name, description, noteTitle: title }));
    } catch (e) { setError(`Modelo não salvo: ${(e as Error).message}`); setBusy(false); }
  };
  return <div className="overlay dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={root} className="modal" role="dialog" aria-modal="true" aria-labelledby="save-template-title">
      <header className="dialog-heading"><span><h3 id="save-template-title">Salvar como modelo</h3><p>O conteúdo atual, com imagens e anexos, é copiado para o modelo. A nota original não muda.</p></span><button aria-label="Fechar" onClick={onClose}><X size={17} /></button></header>
      <div className="dlg-field"><label htmlFor="template-name">Nome do modelo</label><input id="template-name" value={name} maxLength={120} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void save(); }} /></div>
      <div className="dlg-field"><label htmlFor="template-desc">Descrição (opcional)</label><input id="template-desc" value={description} maxLength={500} onChange={e => setDescription(e.target.value)} /></div>
      <div className="dlg-field"><label htmlFor="template-title">Título das notas criadas (use {"{{data}}"} para a data)</label><input id="template-title" value={title} maxLength={300} onChange={e => setTitle(e.target.value)} /></div>
      {error && <p role="alert" className="template-error">{error}</p>}
      <div className="row"><button onClick={onClose}>Cancelar</button><button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar modelo"}</button></div>
    </section>
  </div>;
}
