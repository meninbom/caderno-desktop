import React, { useEffect, useState } from "react";
import {
  LayoutTemplate, Search, Book, Files, Star, Tag as TagIcon, Trash2, Plus,
  SunMedium, MoonStar, Settings, PanelLeftClose, ShieldCheck, Pencil, MoreHorizontal,
  Download, Upload, DatabaseBackup, ChevronDown, ChevronRight, Copy, Folder, FolderPlus, FolderInput, Check,
} from "lucide-react";
import { useAppStore, Selection } from "../state/store";
import { useDismissablePopover } from "../hooks/useDismissablePopover";
import { client } from "../api/client";
import { TagManager } from "./TagManager";

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

type Stack = Awaited<ReturnType<typeof client.listStacks>>[number];

function StackMenu({ notebookName, stackId, stacks, onMove }: {
  notebookName: string; stackId: string | null; stacks: Stack[]; onMove: (stackId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const popover = useDismissablePopover(open, () => setOpen(false));
  const choices = [{ id: null as string | null, name: "Sem pilha" }, ...stacks.map(s => ({ id: s.id as string | null, name: s.name }))];
  return (
    <span className="pop-anchor nb-stack-anchor" ref={popover.rootRef}>
      <button ref={popover.triggerRef} className="icon" title="Mover para pilha" aria-label={`Pilha de ${notebookName}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}><FolderInput size={12} /></button>
      {open && (
        <div className="stack-menu" role="menu" aria-label={`Mover ${notebookName} para pilha`}>
          <div className="menu-label">Mover para pilha</div>
          {choices.map(c => (
            <button key={c.id ?? "none"} className="menu-row" role="menuitemradio" aria-checked={(stackId ?? null) === c.id} onClick={() => { setOpen(false); onMove(c.id); }}>
              <span className="menu-check">{(stackId ?? null) === c.id && <Check size={12} strokeWidth={2.2} />}</span>
              <span className="menu-text">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export function Sidebar({ onImportClick, onImportEml, onSaveBackup, onRestoreBackup, onClipper, area, onArea, onSettings, alerts, onCollapse, onCommand, onTemplates }: {
  onCommand?:()=>void; onTemplates?:()=>void;
  onImportClick?: () => void;
  onImportEml?: () => void;
  onSaveBackup?: () => void;
  onRestoreBackup?: () => void;
  onClipper?:()=>void;
  area?:'notes'|'tasks'|'calendar'|'settings'; onArea?:(area:'notes'|'tasks'|'calendar'|'settings')=>void;
  onSettings?:()=>void; alerts?:number; onCollapse?:()=>void;
}) {
  const { state, dispatch, refreshMeta, refreshNotes, openNote } = useAppStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [stacks, setStacks] = useState<Awaited<ReturnType<typeof client.listStacks>>>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Record<number, boolean>>({});
  const [stackDialog, setStackDialog] = useState<{ action: "create" | "rename" | "duplicate"; id?: string; value: string } | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ action: "create" | "rename"; notebookId: number; id?: string; value: string } | null>(null);
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

  const submitFolderDialog = async () => {
    const dialog = folderDialog;
    const name = dialog?.value.trim();
    if (!dialog || !name) return;
    const saved = dialog.action === "rename" && dialog.id
      ? await client.renameFolder(dialog.id, name)
      : await client.createFolder(dialog.notebookId, name);
    if (!saved) { dispatch({ type: "error", message: `Já existe uma pasta com o nome "${name}" neste caderno.` }); return; }
    setFolderDialog(null);
    setCollapsedFolders(v => ({ ...v, [dialog.notebookId]: false }));
    await refreshMeta();
  };

  const removeFolder = async (id: string, notebookId: number, name: string) => {
    if (!window.confirm(`Excluir a pasta "${name}"? As notas permanecem neste caderno.`)) return;
    await client.deleteFolder(id);
    if (state.selection.kind === "folder" && state.selection.folderId === id) {
      dispatch({ type: "selection", selection: { kind: "notebook", notebookId } });
    }
    await refreshMeta();
    await refreshNotes();
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
    if ((state.selection.kind === "notebook" || state.selection.kind === "folder") && state.selection.notebookId === id) {
      dispatch({ type: "selection", selection: { kind: "all" } });
    }
    await refreshMeta();
    await refreshNotes();
  };

  const renderNotebook = (nb: (typeof state.notebooks)[number]) => {
    const active = state.selection.kind === "notebook" && state.selection.notebookId === nb.id;
    const folders = state.folders.filter(folder => folder.notebookId === nb.id);
    const collapsedFolder = collapsedFolders[nb.id] === true;
    return <div key={`nb-${nb.id}`} className="notebook-block">
      <div className={`notebook-stack-row ${active ? "active" : ""}`}>
      {folders.length > 0 && <button className="icon folder-toggle" title={collapsedFolder ? "Expandir pastas" : "Recolher pastas"} aria-label={`${collapsedFolder ? "Expandir" : "Recolher"} pastas de ${nb.name}`} onClick={() => setCollapsedFolders(v => ({ ...v, [nb.id]: !collapsedFolder }))}>{collapsedFolder ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button>}
      {renamingId === nb.id ? <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void commitRename(); if (e.key === "Escape") setRenamingId(null); }} onBlur={() => void commitRename()} style={{ width: "100%", padding: "4px 8px", fontSize: 12.5 }} /> : <Item icon={<Book size={15} />} label={nb.name} count={nb.noteCount} active={active} onClick={() => select({ kind: "notebook", notebookId: nb.id })} />}
      {renamingId !== nb.id && <span className="nb-actions">
        <button className="icon" title="Nova pasta" aria-label={`Nova pasta em ${nb.name}`} onClick={() => setFolderDialog({ action: "create", notebookId: nb.id, value: "" })}><FolderPlus size={12} /></button>
        <StackMenu notebookName={nb.name} stackId={nb.stackId ?? null} stacks={stacks} onMove={async id => { await client.moveNotebookToStack(nb.id, id); await refreshMeta(); await refreshStacks(); }} />
        <button className="icon" title="Renomear" aria-label={`Renomear ${nb.name}`} onClick={() => startRename(nb.id, nb.name)}><Pencil size={12} /></button>
        <button className="icon" title="Excluir caderno" aria-label={`Excluir ${nb.name}`} onClick={() => void removeNotebook(nb.id)}><Trash2 size={12} /></button>
      </span>}
      </div>
      {!collapsedFolder && folders.length > 0 && <div className="folder-list">{folders.map(folder => {
        const folderActive = state.selection.kind === "folder" && state.selection.folderId === folder.id;
        return <div key={folder.id} className={`folder-row ${folderActive ? "active" : ""}`}>
          <Item icon={<Folder size={14} />} label={folder.name} count={folder.noteCount} active={folderActive} onClick={() => select({ kind: "folder", notebookId: nb.id, folderId: folder.id })} />
          <span className="nb-actions">
            <button className="icon" title="Renomear pasta" aria-label={`Renomear pasta ${folder.name}`} onClick={() => setFolderDialog({ action: "rename", notebookId: nb.id, id: folder.id, value: folder.name })}><Pencil size={12} /></button>
            <button className="icon" title="Excluir pasta" aria-label={`Excluir pasta ${folder.name}`} onClick={() => void removeFolder(folder.id, nb.id, folder.name)}><Trash2 size={12} /></button>
          </span>
        </div>;
      })}</div>}
    </div>;
  };

  return (
    <aside className="sidebar" aria-label="Navegação">
      <div className="brand">
        <img className="brand-icon" src="./caderno.png" width={24} height={24} alt="" />
        <span className="brand-name">Caderno</span>
        {onCollapse && <button className="pane-collapse" title="Recolher barra lateral (Ctrl+\)" aria-label="Recolher barra lateral" onClick={onCollapse}><PanelLeftClose size={14} /></button>}
      </div>

      <button className="new-note" onClick={async () => {
        try {
          if (area === 'notes' && state.openNote) {
            await new Promise<void>((resolve, reject) => window.dispatchEvent(new CustomEvent('caderno:flush-editor', { detail: { resolve, reject } })));
          }
        } catch (error) {
          dispatch({ type: 'error', message: `Não foi possível salvar a nota: ${(error as Error).message}` });
          return;
        }
        onArea?.('notes');
        const c = (await import("../api/client")).client;
        const created = await c.createNote(
          state.selection.kind === "folder"
            ? { notebookId: state.selection.notebookId, folderId: state.selection.folderId }
            : state.selection.kind === "notebook" ? { notebookId: state.selection.notebookId } : {}
        );
        if (state.selection.kind === "trash") dispatch({ type: "selection", selection: { kind: "all" } });
        await refreshMeta();
        await refreshNotes();
        void openNote(created.id);
      }}>
        <Plus size={14} strokeWidth={2.2} /> Nova nota
      </button>

      <button className="sidebar-search template-entry" onClick={onTemplates} aria-label="Nova nota a partir de modelo"><LayoutTemplate size={14}/><span>Nova a partir de modelo</span></button>
      <button className="sidebar-search" onClick={onCommand} aria-label="Pesquisar no Caderno"><Search size={14}/><span>Busca geral</span><kbd>Ctrl+K</kbd></button>
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

      <div className="nav-section-label tags-section-heading"><span>Etiquetas</span><button aria-label="Gerenciar etiquetas" title="Gerenciar etiquetas" onClick={() => setTagManagerOpen(true)}><Settings size={13}/></button></div>
      {state.tags.length === 0 && <span style={{ padding: "2px 10px", color: "var(--text-faint)", fontSize: 12 }}>Nenhuma etiqueta</span>}
      <div className="sidebar-tag-list" role="group" aria-label="Etiquetas">
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
      </div>

      {tagManagerOpen && <TagManager onClose={() => setTagManagerOpen(false)}/>}
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
        {onSettings && <button className="settings-btn" title="Configurações" aria-label="Configurações" aria-pressed={area === "settings"} onClick={onSettings}>
          <Settings size={14} />{!!alerts && <em className="alert-dot" aria-label={`${alerts} aviso(s)`} />}
        </button>}
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
      {folderDialog && <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) setFolderDialog(null); }}>
        <section className="modal stack-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" onKeyDown={e => { if (e.key === "Escape") setFolderDialog(null); }}>
          <h3 id="folder-dialog-title">{folderDialog.action === "rename" ? "Renomear pasta" : "Nova pasta"}</h3>
          <label htmlFor="folder-name">Nome</label>
          <input id="folder-name" autoFocus value={folderDialog.value} maxLength={120} onChange={e => setFolderDialog({ ...folderDialog, value: e.target.value })} onKeyDown={e => { if (e.key === "Enter") void submitFolderDialog(); }} />
          <div className="row"><button onClick={() => setFolderDialog(null)}>Cancelar</button><button className="primary" disabled={!folderDialog.value.trim()} onClick={() => void submitFolderDialog()}>{folderDialog.action === "rename" ? "Salvar" : "Criar"}</button></div>
        </section>
      </div>}
    </aside>
  );
}
