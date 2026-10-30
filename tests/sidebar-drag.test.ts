import { describe, expect, it } from "vitest";
import { canDrop, type SidebarDrag } from "../src/components/sidebarDrag";

const note = (patch: Partial<Extract<SidebarDrag, { kind: "note" }>> = {}): SidebarDrag => ({
  kind: "note",
  id: "11111111-1111-4111-8111-111111111111",
  notebookId: 1,
  folderId: null,
  ...patch,
});

describe("alvos de arrastar na barra lateral", () => {
  it("aceita nota em outra pasta, na raiz de outro caderno e na raiz do próprio caderno", () => {
    expect(canDrop(note({ folderId: "folder-a" }), { kind: "folder", folderId: "folder-b", notebookId: 1 })).toBe(true);
    expect(canDrop(note({ folderId: "folder-a" }), { kind: "notebook", notebookId: 1 })).toBe(true);
    expect(canDrop(note(), { kind: "notebook", notebookId: 2 })).toBe(true);
    expect(canDrop(note({ notebookId: null }), { kind: "folder", folderId: "folder-a", notebookId: 2 })).toBe(true);
  });

  it("recusa o lugar atual, pasta sobre pasta e pasta sobre o próprio caderno", () => {
    expect(canDrop(note({ folderId: "folder-a" }), { kind: "folder", folderId: "folder-a", notebookId: 1 })).toBe(false);
    expect(canDrop(note(), { kind: "notebook", notebookId: 1 })).toBe(false);
    expect(canDrop({ kind: "folder", id: "folder-a", notebookId: 1 }, { kind: "folder", folderId: "folder-b", notebookId: 2 })).toBe(false);
    expect(canDrop({ kind: "folder", id: "folder-a", notebookId: 1 }, { kind: "notebook", notebookId: 1 })).toBe(false);
    expect(canDrop({ kind: "folder", id: "folder-a", notebookId: 1 }, { kind: "notebook", notebookId: 2 })).toBe(true);
    expect(canDrop(null, { kind: "notebook", notebookId: 1 })).toBe(false);
  });
});
