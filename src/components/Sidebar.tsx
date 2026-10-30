import React, { useEffect, useRef, useState } from "react";
import {
  LayoutTemplate, Search, Book, Files, Star, Tag as TagIcon, Trash2, Plus,
  SunMedium, MoonStar, Settings, PanelLeftClose, ShieldCheck, Pencil, MoreHorizontal,
  Download, Upload, DatabaseBackup, ChevronDown, ChevronRight, Copy, Folder, FolderOpen, FolderPlus, FolderInput, Check, StickyNote,
} from "lucide-react";
import type { NoteMeta } from "../../shared/ipc";
import { useAppStore, Selection } from "../state/store";
import { useDismissablePopover } from "../hooks/useDismissablePopover";
import { client } from "../api/client";
import { TagManager } from "./TagManager";
import { beginSidebarDrag, canDrop, endSidebarDrag, readSidebarDrag, type DropTarget, type SidebarDrag } from "./sidebarDrag";

function Item({ icon, label, count, active, onClick, draggable, onDragStart, onDragEnd }: {
  icon: React.ReactNode; label: string; count?: number; active: boolean; onClick: () => void;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button type="button" data-menu-item className={active ? "active" : undefined} title={label} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick}>
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
  const [closedNotebooks, setClosedNotebooks] = useState<Record<number, boolean>>({});
  const [closedFolders, setClosedFolders] = useState<Record<string, boolean>>({});
  const [treeNotes, setTreeNotes] = useState<NoteMeta[]>([]);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragClick = useRef(false);
  const expandTimer = useRef<number | null>(null);
  const expandKey = useRef<string | null>(null);
  const [stackDialog, setStackDialog] = useState<{ action: "create" | "rename" | "duplicate"; id?: string; value: string } | null>(null);
  const [folderDialog, setFolderDialog] = useState<{ action: "create" | "rename"; notebookId: number; id?: string; value: string } | null>(null);
  const morePopover = useDismissablePopover(moreOpen, () => setMoreOpen(false));
  const refreshStacks = async () => setStacks(await client.listStacks());
  useEffect(() => { void refreshStacks(); }, []);
  useEffect(() => () => { if (expandTimer.current !== null) window.clearTimeout(expandTimer.current); }, []);
  const treeToken = [
    state.counts.all,
    state.counts.trash,
    state.notebooks.map(nb => `${nb.id}:${nb.noteCount}`).join(","),
    state.folders.map(folder => `${folder.id}:${folder.notebookId}:${folder.noteCount}:${folder.name}`).join(","),
    state.openNote ? `${state.openNote.id}:${state.openNote.title}:${state.openNote.updatedAt}:${state.openNote.folderId}:${state.openNote.notebookId}` : "",
  ].join("|");
  useEffect(() => {
    let cancel = false;
    void client.listNotes({ view: "all", order: "title_asc" }).then(notes => {
      if (!cancel) setTreeNotes(notes);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [treeToken]);

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
    setClosedNotebooks(v => ({ ...v, [dialog.notebookId]: false }));
    if (dialog.action === "create") setClosedFolders(v => ({ ...v, [saved.id]: false }));
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

  const clearExpand = () => {
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    expandTimer.current = null;
    expandKey.current = null;
  };
  const scheduleExpand = (key: string, run: () => void) => {
    if (expandKey.current === key) return;
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    expandKey.current = key;
    expandTimer.current = window.setTimeout(() => {
      expandTimer.current = null;
      expandKey.current = null;
      run();
    }, 600);
  };
  const finishDrag = (event: React.DragEvent<HTMLButtonElement>) => {
    event.currentTarget.classList.remove("is-dragging");
    setDraggingId(null);
    setDropKey(null);
    clearExpand();
    endSidebarDrag();
    window.setTimeout(() => { dragClick.current = false; }, 80);
  };
  const startNoteDrag = (event: React.DragEvent<HTMLButtonElement>, note: NoteMeta) => {
    dragClick.current = true;
    event.stopPropagation();
    beginSidebarDrag({ kind: "note", id: note.id, notebookId: note.notebookId, folderId: note.folderId }, event.dataTransfer);
    setDraggingId(note.id);
    event.currentTarget.classList.add("is-dragging");
  };
  const startFolderDrag = (event: React.DragEvent<HTMLButtonElement>, folderId: string, notebookId: number) => {
    dragClick.current = true;
    event.stopPropagation();
    beginSidebarDrag({ kind: "folder", id: folderId, notebookId }, event.dataTransfer);
    setDraggingId(folderId);
    event.currentTarget.classList.add("is-dragging");
  };
  const commitDrop = async (drag: SidebarDrag, target: DropTarget) => {
    try {
      if (drag.kind === "note") {
        const moved = target.kind === "folder"
          ? await client.moveNoteToFolder(drag.id, target.folderId)
          : drag.notebookId === target.notebookId
            ? await client.moveNoteToFolder(drag.id, null)
            : await client.moveNote(drag.id, target.notebookId);
        if (!moved) { dispatch({ type: "error", message: "Não foi possível mover a nota." }); return; }
        if (state.openNoteId === drag.id) await openNote(drag.id);
      } else {
        if (target.kind !== "notebook") return;
        const moved = await client.moveFolder(drag.id, target.notebookId);
        if (!moved) { dispatch({ type: "error", message: "Não foi possível mover a pasta. O caderno de destino já tem uma pasta com esse nome." }); return; }
        setClosedNotebooks(current => ({ ...current, [target.notebookId]: false }));
        if (state.selection.kind === "folder" && state.selection.folderId === drag.id && state.selection.notebookId !== target.notebookId) {
          dispatch({ type: "selection", selection: { kind: "folder", notebookId: target.notebookId, folderId: drag.id } });
        }
        if (state.openNote?.folderId === drag.id) await openNote(state.openNote.id);
      }
      await refreshMeta();
      await refreshNotes();
    } catch (err) {
      dispatch({ type: "error", message: (err as Error).message });
    }
  };
  const bindDrop = (key: string, target: DropTarget, expand?: () => void) => ({
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const drag = readSidebarDrag();
      if (!drag) return;
      if (expand) scheduleExpand(key, expand);
      if (!canDrop(drag, target)) {
        event.dataTransfer.dropEffect = "none";
        setDropKey(prev => prev === key ? null : prev);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropKey(prev => prev === key ? prev : key);
    },
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setDropKey(prev => prev === key ? null : prev);
      if (expandKey.current === key) clearExpand();
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const drag = readSidebarDrag();
      setDropKey(null);
      clearExpand();
      if (!drag || !canDrop(drag, target)) return;
      void commitDrop(drag, target);
    },
  });
  const openTreeNote = (note: NoteMeta) => {
    if (dragClick.current) { dragClick.current = false; return; }
    onArea?.("notes");
    const same = note.folderId
      ? state.selection.kind === "folder" && state.selection.folderId === note.folderId
      : note.notebookId
        ? state.selection.kind === "notebook" && state.selection.notebookId === note.notebookId
        : state.selection.kind === "unfiled";
    if (!same) {
      dispatch({
        type: "selection",
        selection: note.folderId && note.notebookId
          ? { kind: "folder", notebookId: note.notebookId, folderId: note.folderId }
          : note.notebookId
            ? { kind: "notebook", notebookId: note.notebookId }
            : { kind: "unfiled" },
      });
    }
    void openNote(note.id);
  };
  const renderTreeNote = (note: NoteMeta) => (
    <button
      key={note.id}
      type="button"
      className={`tree-note ${state.openNoteId === note.id ? "active" : ""} ${draggingId === note.id ? "is-dragging" : ""}`}
      draggable
      title={note.title || "Sem título"}
      onDragStart={event => startNoteDrag(event, note)}
      onDragEnd={finishDrag}
      onClick={() => openTreeNote(note)}
    >
      <StickyNote size={13} strokeWidth={1.8} />
      <span>{note.title || "Sem título"}</span>
    </button>
  );

  const renderNotebook = (nb: (typeof state.notebooks)[number]) => {
    const active = state.selection.kind === "notebook" && state.selection.notebookId === nb.id;
    const folders = state.folders.filter(folder => folder.notebookId === nb.id);
    const looseNotes = treeNotes.filter(note => note.notebookId === nb.id && !note.folderId);
    const notebookClosed = closedNotebooks[nb.id] === true;
    const hasChildren = folders.length > 0 || looseNotes.length > 0;
    return <div
      key={`nb-${nb.id}`}
      className={`notebook-block ${dropKey === `notebook:${nb.id}` ? "drop-target" : ""}`}
      {...bindDrop(`notebook:${nb.id}`, { kind: "notebook", notebookId: nb.id }, notebookClosed && hasChildren ? () => setClosedNotebooks(current => ({ ...current, [nb.id]: false })) : undefined)}
    >
      <div className={`notebook-stack-row tree-row ${active ? "active" : ""}`}>
      {hasChildren ? <button type="button" className="tree-chevron" aria-expanded={!notebookClosed} title={notebookClosed ? "Expandir" : "Recolher"} aria-label={`${notebookClosed ? "Expandir" : "Recolher"}${folders.length > 0 ? " pastas de" : ""} ${nb.name}`} onClick={() => setClosedNotebooks(current => ({ ...current, [nb.id]: !notebookClosed }))}>{notebookClosed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</button> : <span className="tree-chevron-spacer" aria-hidden="true" />}
      {renamingId === nb.id ? <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void commitRename(); if (e.key === "Escape") setRenamingId(null); }} onBlur={() => void commitRename()} style={{ width: "100%", padding: "4px 8px", fontSize: 12.5 }} /> : <Item icon={<Book size={15} />} label={nb.name} count={nb.noteCount} active={active} onClick={() => select({ kind: "notebook", notebookId: nb.id })} />}
      {renamingId !== nb.id && <span className="nb-actions">
        <button type="button" className="icon" title="Nova pasta" aria-label={`Nova pasta em ${nb.name}`} onClick={() => setFolderDialog({ action: "create", notebookId: nb.id, value: "" })}><FolderPlus size={13} /></button>
        <StackMenu notebookName={nb.name} stackId={nb.stackId ?? null} stacks={stacks} onMove={async id => { await client.moveNotebookToStack(nb.id, id); await refreshMeta(); await refreshStacks(); }} />
        <button type="button" className="icon" title="Renomear" aria-label={`Renomear ${nb.name}`} onClick={() => startRename(nb.id, nb.name)}><Pencil size={13} /></button>
        <button type="button" className="icon" title="Excluir caderno" aria-label={`Excluir ${nb.name}`} onClick={() => void removeNotebook(nb.id)}><Trash2 size={13} /></button>
      </span>}
      </div>
      {!notebookClosed && hasChildren && <div className="tree-children">
        {folders.map(folder => {
          const folderActive = state.selection.kind === "folder" && state.selection.folderId === folder.id;
          const notes = treeNotes.filter(note => note.folderId === folder.id);
          const folderOpen = closedFolders[folder.id] === false;
          return <div key={folder.id} className={`folder-block ${dropKey === `folder:${folder.id}` ? "drop-target" : ""}`} {...bindDrop(`folder:${folder.id}`, { kind: "folder", folderId: folder.id, notebookId: nb.id }, folderOpen ? undefined : () => setClosedFolders(current => ({ ...current, [folder.id]: false })))}>
            <div className={`folder-row tree-row ${folderActive ? "active" : ""} ${draggingId === folder.id ? "is-dragging" : ""}`}>
              <button type="button" className="tree-chevron" aria-expanded={folderOpen} title={folderOpen ? "Recolher pasta" : "Expandir pasta"} aria-label={`${folderOpen ? "Recolher" : "Expandir"} pasta ${folder.name}`} onClick={() => setClosedFolders(current => ({ ...current, [folder.id]: folderOpen }))}>{folderOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
              <Item
                icon={folderOpen ? <FolderOpen size={15} /> : <Folder size={15} />}
                label={folder.name}
                count={folder.noteCount}
                active={folderActive}
                draggable
                onDragStart={event => startFolderDrag(event, folder.id, nb.id)}
                onDragEnd={finishDrag}
                onClick={() => {
                  if (dragClick.current) { dragClick.current = false; return; }
                  setClosedFolders(current => ({ ...current, [folder.id]: false }));
                  select({ kind: "folder", notebookId: nb.id, folderId: folder.id });
                }}
              />
              <span className="nb-actions">
                <button type="button" className="icon" title="Renomear pasta" aria-label={`Renomear pasta ${folder.name}`} onClick={() => setFolderDialog({ action: "rename", notebookId: nb.id, id: folder.id, value: folder.name })}><Pencil size={13} /></button>
                <button type="button" className="icon" title="Excluir pasta" aria-label={`Excluir pasta ${folder.name}`} onClick={() => void removeFolder(folder.id, nb.id, folder.name)}><Trash2 size={13} /></button>
              </span>
            </div>
            {folderOpen && notes.length > 0 && <div className="tree-children">{notes.map(renderTreeNote)}</div>}
          </div>;
        })}
        {looseNotes.map(renderTreeNote)}
      </div>}
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
