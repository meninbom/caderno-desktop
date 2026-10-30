export type NoteDrag = {
  kind: "note";
  id: string;
  notebookId: number | null;
  folderId: string | null;
};

export type FolderDrag = {
  kind: "folder";
  id: string;
  notebookId: number;
};

export type SidebarDrag = NoteDrag | FolderDrag;

export type DropTarget =
  | { kind: "notebook"; notebookId: number }
  | { kind: "folder"; folderId: string; notebookId: number };

const NOTE_MIME = "application/x-caderno-note";
const FOLDER_MIME = "application/x-caderno-folder";

let current: SidebarDrag | null = null;

export function beginSidebarDrag(drag: SidebarDrag, data: DataTransfer): void {
  current = drag;
  data.effectAllowed = "move";
  data.setData(drag.kind === "note" ? NOTE_MIME : FOLDER_MIME, drag.id);
  data.setData("text/plain", `${drag.kind}:${drag.id}`);
}

export function endSidebarDrag(): void {
  current = null;
}

export function readSidebarDrag(): SidebarDrag | null {
  return current;
}

/** Destino igual ao lugar atual é recusado (soltar vira no-op). Pasta só entra em outro caderno. */
export function canDrop(drag: SidebarDrag | null, target: DropTarget): boolean {
  if (!drag) return false;
  if (drag.kind === "note") {
    if (target.kind === "folder") return drag.folderId !== target.folderId;
    return !(drag.notebookId === target.notebookId && drag.folderId === null);
  }
  if (target.kind !== "notebook") return false;
  return drag.notebookId !== target.notebookId;
}
