import React, { useEffect, useState } from "react";
import {
  Book, Files, Star, Tag as TagIcon, Trash2, Plus, StickyNote,
  SunMedium, MoonStar, ShieldCheck, Pencil, MoreHorizontal,
  Download, Upload, DatabaseBackup, ChevronDown, ChevronRight, Copy, FolderPlus,
} from "lucide-react";
import { useAppStore, Selection } from "../state/store";
import { useDismissablePopover } from "../hooks/useDismissablePopover";
import { client } from "../api/client";

function Item({ icon, label, count, active, onClick }: {
  icon: React.ReactNode; label: string; count?: number; active: boolean; onClick: () => void;
}) {
  return (
    <button data-menu-item className={active ? "active" : undefined} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}

export function Sidebar({ onImportClick, onImportEml, onSaveBackup, onRestoreBackup, onClipper, area, onArea }: {
  onImportClick?: () => void;
  onImportEml?: () => void;
  onSaveBackup?: () => void;
  onRestoreBackup?: () => void;
  onClipper?:()=>void;
  area?:'notes'|'tasks'|'calendar'; onArea?:(area:'notes'|'tasks'|'calendar')=>void;
}) {
  const { state, dispatch, refreshMeta, refreshNotes, openNote } = useAppStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [stacks, setStacks] = useState<Awaited<ReturnType<typeof client.listStacks>>>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [stackDialog, setStackDialog] = useState<{ action: "create" | "rename" | "duplicate"; id?: string; value: string } | null>(null);
  const morePopover = useDismissablePopover(moreOpen, () => setMoreOpen(false));
  const refreshStacks = async () => setStacks(await client.listStacks());
  useEffect(() => { void refreshStacks(); }, []);

  const stackAction = async (action: "create" | "rename" | "duplicate" | "delete", id?: string, existingName?: string) => {
    if (action === "delete") {
      if (!id) return;
      if (!window.confirm("Excluir esta pilha? Os cadernos serão mantidos e desvinculados.")) return;
      await client.deleteStack(id);
    } else {
      const initial = action === "duplicate" ? `${existingName ?? "Pilha"} (cópia)` : (action === "rename" ? existingName : "");
      setStackDialog({ action, id, value: initial ?? "" });
      return;
    }
    await refreshStacks(); await refreshMeta();
  };

  const submitStackDialog = async () => {
    const dialog = stackDialog;
    const name = dialog?.value.trim();
    if (!dialog || !name) return;
    const saved = dialog.action === "rename" && dialog.id
      ? await client.renameStack(dialog.id, name)
      : await client.createStack(name);
    if (!saved) { dispatch({ type: "error", message: `Já existe uma pilha com o nome "${name}".` }); return; }
    setStackDialog(null);
    await refreshStacks(); await refreshMeta();
  };

  const select = (selection: Selection) => {
    onArea?.('notes');
    dispatch({ type: "selection", selection });
    void openNote(null);
    void refreshNotes();
  };

  const createNotebook = async () => {
    const name = newName.trim();
    if (!name) return;
    const nb = await (await import("../api/client")).client.createNotebook(name);
    if (nb === null) {
      dispatch({ type: "error", message: `Já existe um caderno com o nome "${name}".` });
    } else {
      setNewName("");
      setCreating(false);
    }
    await refreshMeta();
  };

  const startRename = (id: number, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
  };

  const commitRename = async () => {
    const id = renamingId;
    const name = renameValue.trim();
    setRenamingId(null);
    if (!id || !name) return;
    const nb = await (await import("../api/client")).client.renameNotebook(id, name);
    if (nb === null) dispatch({ type: "error", message: `Não foi possível renomear: "${name}" já existe.` });
    await refreshMeta();
  };

  const removeNotebook = async (id: number) => {
    await (await import("../api/client")).client.deleteNotebook(id);
    if (state.selection.kind === "notebook" && state.selection.notebookId === id) {
      dispatch({ type: "selection", selection: { kind: "all" } });
    }
    await refreshMeta();
    await refreshNotes();
  };

  const renderNotebook = (nb: (typeof state.notebooks)[number]) => {
    const active = state.selection.kind === "notebook" && state.selection.notebookId === nb.id;
    return <div key={`nb-${nb.id}`} className="notebook-stack-row" style={{ position: "relative" }}>
      {renamingId === nb.id ? <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void commitRename(); if (e.key === "Escape") setRenamingId(null); }} onBlur={() => void commitRename()} style={{ width: "100%", padding: "4px 8px", fontSize: 12.5 }} /> : <Item icon={<Book size={15} />} label={nb.name} count={nb.noteCount} active={active} onClick={() => select({ kind: "notebook", notebookId: nb.id })} />}
      <select className="notebook-stack-select" aria-label={`Pilha de ${nb.name}`} title="Mover para pilha" value={nb.stackId ?? ""} onChange={async e => { await client.moveNotebookToStack(nb.id, e.target.value || null); await refreshMeta(); await refreshStacks(); }}><option value="">Sem pilha</option>{stacks.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      {active && <span style={{ position: "absolute", right: 24, top: 5, display: renamingId === nb.id ? "none" : "flex", gap: 2 }}><button className="icon" title="Renomear" style={{ padding: 3, color: "var(--text-faint)" }} onClick={() => startRename(nb.id, nb.name)}><Pencil size={12} /></button><button className="icon" title="Excluir caderno" style={{ padding: 3, color: "var(--text-faint)" }} onClick={() => void removeNotebook(nb.id)}><Trash2 size={12} /></button></span>}
    </div>;
  };

  return (
    <aside className="sidebar" aria-label="Navegação">
      <div className="brand">
        <StickyNote size={16} strokeWidth={1.8} />
        Caderno
      </div>

      <button className="new-note" onClick={async () => {
        onArea?.('notes');
        const c = (await import("../api/client")).client;
        const created = await c.createNote(
          state.selection.kind === "notebook" ? { notebookId: state.selection.notebookId } : {}
        );
        if (state.selection.kind === "trash") dispatch({ type: "selection", selection: { kind: "all" } });
        await refreshMeta();
        await refreshNotes();
        void openNote(created.id);
      }}>
        <Plus size={14} strokeWidth={2.2} /> Nova nota
      </button>

      <Item icon={<Files size={15} />} label="Notas" count={state.counts.all} active={state.selection.kind === "all"} onClick={() => select({ kind: "all" })} />
      <Item icon={<Files size={15} />} label="Tarefas" active={area==='tasks'} onClick={()=>onArea?.('tasks')} />
      <Item icon={<Book size={15} />} label="Calendário" active={area==='calendar'} onClick={()=>onArea?.('calendar')} />
      <Item icon={<Star size={15} />} label="Favoritas" count={state.counts.favorites} active={state.selection.kind === "favorites"} onClick={() => select({ kind: "favorites" })} />
      <Item icon={<Trash2 size={15} />} label="Lixeira" count={state.counts.trash} active={state.selection.kind === "trash"} onClick={() => select({ kind: "trash" })} />

      <div className="nav-section-label stack-section-heading"><span>Cadernos</span><button className="icon" title="Criar pilha" aria-label="Criar pilha" onClick={() => void stackAction("create")}><FolderPlus size={13} /></button></div>
      {creating ? (
        <div style={{ padding: "2px 8px" }}>
          <input
            autoFocus
            value={newName}
            placeholder="Nome do caderno"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void createNotebook(); if (e.key === "Escape") setCreating(false); }}
            onBlur={() => void createNotebook()}
            style={{ width: "100%", padding: "4px 8px", fontSize: 12.5 }}
          />
        </div>
      ) : (
        <button data-menu-item onClick={() => setCreating(true)}><Plus size={14} /> Criar caderno</button>
      )}

      {state.counts.unfiled > 0 && (
        <Item
          icon={<Book size={15} />}
          label="Sem caderno"
          count={state.counts.unfiled}
          active={state.selection.kind === "unfiled"}
          onClick={() => select({ kind: "unfiled" })}
        />
      )}
      {stacks.map(stack => <React.Fragment key={`stack-${stack.id}`}>
        <div className="stack-heading">
          <button className="stack-toggle" aria-label={`${collapsed[stack.id] ? "Expandir" : "Recolher"} ${stack.name}`} onClick={() => setCollapsed(v => ({ ...v, [stack.id]: !v[stack.id] }))}>{collapsed[stack.id] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<span>{stack.name}</span><small>{stack.notebookCount}</small></button>
          <button className="icon" title={`Duplicar pilha ${stack.name}`} aria-label={`Duplicar pilha ${stack.name}`} onClick={() => void stackAction("duplicate", stack.id, stack.name)}><Copy size={12} /></button>
          <button className="icon" title={`Renomear pilha ${stack.name}`} aria-label={`Renomear pilha ${stack.name}`} onClick={() => void stackAction("rename", stack.id, stack.name)}><Pencil size={12} /></button>
          <button className="icon" title={`Excluir pilha ${stack.name}`} aria-label={`Excluir pilha ${stack.name}`} onClick={() => void stackAction("delete", stack.id, stack.name)}><Trash2 size={12} /></button>
        </div>
        {!collapsed[stack.id] && state.notebooks.filter(nb => nb.stackId === stack.id).map(nb => renderNotebook(nb))}
      </React.Fragment>)}
      {state.notebooks.filter(nb => !nb.stackId || !stacks.some(s => s.id === nb.stackId)).map((nb) => renderNotebook(nb))}

      <div className="nav-section-label">Etiquetas</div>
      {state.tags.length === 0 && <span style={{ padding: "2px 10px", color: "var(--text-faint)", fontSize: 12 }}>Nenhuma etiqueta</span>}
      {state.tags.map((t) => (
        <Item
          key={`tag-${t.id}`}
          icon={<TagIcon size={15} />}
          label={t.name}
          count={t.noteCount}
          active={state.selection.kind === "tag" && state.selection.tagId === t.id}
          onClick={() => select({ kind: "tag", tagId: t.id })}
        />
      ))}

      <div className="sidebar-footer">
        <span className="pop-anchor" ref={morePopover.rootRef}>
          <button ref={morePopover.triggerRef} title="Mais ações" aria-label="Mais ações" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
            <MoreHorizontal size={14} />
          </button>
          {moreOpen && (
            <div className="menu-pop" role="menu">
              {onImportClick && (
                <button className="menu-row" role="menuitem" onClick={() => { setMoreOpen(false); onImportClick(); }}>
                  <Upload size={13} /> Importar Markdown
                </button>
              )}
              {onImportEml && <button className="menu-row" role="menuitem" onClick={() => { setMoreOpen(false); onImportEml(); }}><Upload size={13} /> Importar e-mail (.eml)</button>}
              {onClipper && <button className="menu-row" role="menuitem" onClick={()=>{setMoreOpen(false);onClipper();}}>Web Clipper</button>}
              {onSaveBackup && (
                <button className="menu-row" role="menuitem" onClick={() => { setMoreOpen(false); onSaveBackup(); }}>
                  <Download size={13} /> Salvar backup
                </button>
              )}
              {onRestoreBackup && (
                <button className="menu-row" role="menuitem" onClick={() => { setMoreOpen(false); onRestoreBackup(); }}>
                  <DatabaseBackup size={13} /> Restaurar backup
                </button>
              )}
            </div>
          )}
        </span>
        <span className="footer-local" title="Dados locais no SQLite do perfil do app">
          <ShieldCheck size={13} />
        </span>
        <span style={{ flex: 1 }} />
        <button
          title="Alternar tema"
          aria-label="Alternar tema"
          onClick={() => dispatch({ type: "theme", theme: state.theme === "light" ? "dark" : "light" })}
        >
          {state.theme === "light" ? <MoonStar size={14} /> : <SunMedium size={14} />}
        </button>
      </div>
      {stackDialog && <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setStackDialog(null); }}>
        <section className="modal stack-dialog" role="dialog" aria-modal="true" aria-labelledby="stack-dialog-title" onKeyDown={e => { if (e.key === "Escape") setStackDialog(null); }}>
          <h3 id="stack-dialog-title">{stackDialog.action === "rename" ? "Renomear pilha" : stackDialog.action === "duplicate" ? "Duplicar pilha" : "Criar pilha"}</h3>
          <label htmlFor="stack-name">Nome</label>
          <input id="stack-name" autoFocus value={stackDialog.value} maxLength={80} onChange={e => setStackDialog({ ...stackDialog, value: e.target.value })} onKeyDown={e => { if (e.key === "Enter") void submitStackDialog(); }} />
          <div className="row"><button onClick={() => setStackDialog(null)}>Cancelar</button><button className="primary" disabled={!stackDialog.value.trim()} onClick={() => void submitStackDialog()}>{stackDialog.action === "rename" ? "Salvar" : "Criar"}</button></div>
        </section>
      </div>}
    </aside>
  );
}
