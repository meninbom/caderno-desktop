import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import {
  NoteFull,
  NoteMeta,
  NoteView,
  Notebook,
  NoteFolder,
  SidebarCounts,
  SortOrder,
  Tag,
} from "../../shared/ipc";
import { client } from "../api/client";

export type Selection =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "trash" }
  | { kind: "unfiled" }
  | { kind: "notebook"; notebookId: number }
  | { kind: "folder"; notebookId: number; folderId: string }
  | { kind: "tag"; tagId: number };

export interface AppState {
  selection: Selection;
  notes: NoteMeta[];
  openNoteId: string | null;
  openNote: NoteFull | null;
  notebooks: Notebook[];
  folders: NoteFolder[];
  tags: Tag[];
  counts: SidebarCounts;
  theme: "light" | "dark";
  orderBy: SortOrder;
  search: string;
  saveState: "saved" | "saving" | "error";
  lastSavedAt: number | null;
  error: string | null;
  log: LogEntry[];
  initialized: boolean;
}

export interface LogEntry { id: number; at: number; level: "error" | "info"; message: string }
let logSeq = 0;
const appendLog = (log: LogEntry[], level: LogEntry["level"], message: string) => [{ id: ++logSeq, at: Date.now(), level, message }, ...log].slice(0, 100);

export type Action =
  | { type: "init"; theme: "light" | "dark" }
  | { type: "selection"; selection: Selection }
  | { type: "notes"; notes: NoteMeta[] }
  | { type: "openNote"; note: NoteFull | null; noteId: string | null }
  | { type: "notebooks"; notebooks: Notebook[] }
  | { type: "folders"; folders: NoteFolder[] }
  | { type: "tags"; tags: Tag[] }
  | { type: "counts"; counts: SidebarCounts }
  | { type: "theme"; theme: "light" | "dark" }
  | { type: "order"; order: SortOrder }
  | { type: "search"; value: string }
  | { type: "saveState"; state: "saved" | "saving" | "error"; at?: number }
  | { type: "error"; message: string | null }
  | { type: "log"; level: "error" | "info"; message: string }
  | { type: "clearLog" };

const initialState: AppState = {
  selection: { kind: "all" },
  notes: [],
  openNoteId: null,
  openNote: null,
  notebooks: [],
  folders: [],
  tags: [],
  counts: { all: 0, favorites: 0, trash: 0, unfiled: 0 },
  theme: "light",
  orderBy: "updated_desc",
  search: "",
  saveState: "saved",
  lastSavedAt: null,
  error: null,
  log: [],
  initialized: false,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "init":
      return { ...state, theme: action.theme, initialized: true };
    case "selection":
      return { ...state, selection: action.selection, search: "" };
    case "notes":
      return { ...state, notes: action.notes };
    case "openNote":
      return { ...state, openNote: action.note, openNoteId: action.noteId };
    case "notebooks":
      return { ...state, notebooks: action.notebooks };
    case "folders":
      return { ...state, folders: action.folders };
    case "tags":
      return { ...state, tags: action.tags };
    case "counts":
      return { ...state, counts: action.counts };
    case "theme":
      return { ...state, theme: action.theme };
    case "order":
      return { ...state, orderBy: action.order };
    case "search":
      return { ...state, search: action.value };
    case "saveState":
      return { ...state, saveState: action.state, lastSavedAt: action.state === "saved" ? (action.at ?? Date.now()) : state.lastSavedAt };
    case "error":
      return { ...state, error: action.message, log: action.message ? appendLog(state.log, "error", action.message) : state.log };
    case "log":
      return { ...state, log: appendLog(state.log, action.level, action.message) };
    case "clearLog":
      return { ...state, log: [] };
    default:
      return state;
  }
}

interface StoreApi {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  refreshNotes(): Promise<void>;
  refreshMeta(): Promise<void>;
  openNote(id: string | null): Promise<void>;
  saveNoteContent(id: string, patch: { title?: string; contentHtml?: string }): Promise<boolean>;
}

const StoreCtx = createContext<StoreApi | null>(null);

export function selectionToQuery(state: AppState) {
  const sel = state.selection;
  const base: { view: NoteView; notebookId?: number; tagId?: number; folderId?: string; query?: string; order?: SortOrder } =
    sel.kind === "all"
      ? { view: "all" }
      : sel.kind === "favorites"
        ? { view: "favorites" }
        : sel.kind === "trash"
          ? { view: "trash" }
          : sel.kind === "unfiled"
            ? { view: "unfiled" as NoteView }
            : sel.kind === "notebook"
              ? { view: "notebook", notebookId: sel.notebookId }
              : sel.kind === "folder"
                ? { view: "folder", notebookId: sel.notebookId, folderId: sel.folderId }
                : { view: "tag", tagId: sel.tagId };
  if (state.search.trim()) base.query = state.search.trim();
  base.order = state.orderBy;
  return base;
}

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const refreshMetaRef = useRef<() => Promise<void>>(async () => {});
  const refreshNotesRef = useRef<() => Promise<void>>(async () => {});

  refreshMetaRef.current = async () => {
    try {
      const [notebooks, tags, counts, folders] = await Promise.all([
        client.listNotebooks(),
        client.listTags(),
        client.counts(),
        client.listFolders(),
      ]);
      dispatch({ type: "notebooks", notebooks });
      dispatch({ type: "folders", folders });
      dispatch({ type: "tags", tags });
      dispatch({ type: "counts", counts });
    } catch (err) {
      dispatch({ type: "error", message: `${(err as Error).message}` });
    }
  };

  refreshNotesRef.current = async () => {
    try {
      const notes = await client.listNotes(selectionToQuery(stateRef.current));
      dispatch({ type: "notes", notes });
    } catch (err) {
      dispatch({ type: "error", message: `${(err as Error).message}` });
    }
  };

  const refreshNotes = useCallback(() => refreshNotesRef.current(), []);
  const refreshMeta = useCallback(() => refreshMetaRef.current(), []);

  useEffect(() => {
    const refresh = () => { void refreshNotesRef.current(); void refreshMetaRef.current(); };
    window.addEventListener('focus', refresh);
    const unsubscribe = window.cadernoDesktop?.onClipperCapture?.(refresh);
    const unsubscribeExternal = window.cadernoDesktop?.onExternalDataChange?.(() => {
      refresh();
      window.dispatchEvent(new Event('caderno:agenda-changed'));
    });
    return () => { window.removeEventListener('focus', refresh); unsubscribe?.(); unsubscribeExternal?.(); };
  }, []);

  useEffect(() => {
    if (!state.initialized) {
      client
        .theme()
        .then((t) => dispatch({ type: "init", theme: t === "dark" ? "dark" : "light" }))
        .catch(() => dispatch({ type: "init", theme: "light" }));
      void refreshMetaRef.current();
      return;
    }
  }, [state.initialized]);

  useEffect(() => {
    if (state.initialized) void refreshNotesRef.current();
  }, [state.selection, state.orderBy, state.search, state.initialized]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
    // Só persiste após a inicialização: evita gravar o tema padrão por cima do
    // tema salvo antes de `client.theme()` ter sido lido (corrige perda de tema).
    if (state.initialized) void client.setTheme(state.theme).catch(() => {});
  }, [state.theme, state.initialized]);

  const apiActions = useMemo(() => ({
    openNote: async (id: string | null) => {
      if (id === null) {
        dispatch({ type: "openNote", note: null, noteId: null });
        return;
      }
      const note = await client.getNote(id);
      dispatch({ type: "openNote", note, noteId: id });
    },
    saveNoteContent: async (id: string, patch: { title?: string; contentHtml?: string }): Promise<boolean> => {
      dispatch({ type: "saveState", state: "saving" });
      try {
        const updated = await client.updateNote(id, patch);
        if (updated) {
          dispatch({ type: "saveState", state: "saved", at: Date.now() });
          if (stateRef.current.openNoteId === id) {
            dispatch({ type: "openNote", note: updated as NoteFull, noteId: id });
          }
          return true;
        }
        dispatch({ type: "saveState", state: "error" });
        return false;
      } catch (err) {
        dispatch({ type: "saveState", state: "error" });
        dispatch({ type: "error", message: `${(err as Error).message}` });
        return false;
      }
    },
  }), []);

  // Manter a nota aberta em sincronia com o salvo do conteúdo
  const api = useMemo<StoreApi>(() => ({
    state,
    dispatch,
    refreshNotes,
    refreshMeta,
    openNote: apiActions.openNote,
    saveNoteContent: apiActions.saveNoteContent,
  }), [state, apiActions, refreshNotes, refreshMeta]);

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}

export function useAppStore(): StoreApi {
  const value = useContext(StoreCtx);
  if (!value) throw new Error("useAppStore precisa de AppStoreProvider");
  return value;
}
