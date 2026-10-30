import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "../electron/repo/db";
import { BackupRepo } from "../electron/repo/attachments";
import { NoteFoldersRepo, NotebooksRepo, NotesRepo } from "../electron/repo/sqlite";
import { validateInput } from "../shared/api";
import { WebClient } from "../src/api/webClient";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-folders-"));
  const db = openDatabase({ database: path.join(root, "data.sqlite"), attachments: path.join(root, "assets") });
  cleanups.push(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { db, notes: new NotesRepo(db), notebooks: new NotebooksRepo(db), folders: new NoteFoldersRepo(db), backup: new BackupRepo(db, path.join(root, "assets")) };
}

const mem = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => void mem.clear(),
};
(globalThis as unknown as { localStorage: typeof localStorageMock }).localStorage = localStorageMock;

describe("pastas de notas", () => {
  it("migra um banco v12 sem apagar notas existentes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-folders-mig-"));
    const file = path.join(root, "caderno.sqlite");
    const assets = path.join(root, "attachments");
    fs.mkdirSync(assets);
    const legacy = new Database(file);
    legacy.exec(`CREATE TABLE migration_log(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO migration_log VALUES (12, 1);
      CREATE TABLE notebooks(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, color TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, stack_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE notes(id TEXT PRIMARY KEY, notebook_id INTEGER, title TEXT NOT NULL DEFAULT '', content_html TEXT NOT NULL DEFAULT '', content_text TEXT NOT NULL DEFAULT '', favorited INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE tags(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
      CREATE TABLE note_tags(note_id TEXT NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY(note_id, tag_id));
      INSERT INTO notebooks(id,name,created_at,updated_at) VALUES (1,'Pessoal',1,1);
      INSERT INTO notes(id,notebook_id,title,content_text,created_at,updated_at) VALUES ('11111111-1111-4111-8111-111111111111',1,'Antiga','oi',1,1);`);
    legacy.close();
    const db = openDatabase({ database: file, attachments: assets });
    cleanups.push(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
    const note = new NotesRepo(db).get("11111111-1111-4111-8111-111111111111");
    expect(note?.title).toBe("Antiga");
    expect(note?.notebookId).toBe(1);
    expect(note?.folderId).toBeNull();
    expect(db.prepare("SELECT MAX(version) AS version FROM migration_log").get()).toEqual({ version: 13 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='note_folders'").get()).toEqual({ name: "note_folders" });
  });

  it("cria, renomeia, lista e impede nome repetido no mesmo caderno", () => {
    const r = fresh();
    const a = r.notebooks.create("Pessoal")!;
    const b = r.notebooks.create("Trabalho")!;
    const recipes = r.folders.create(a.id, "Receitas")!;
    expect(r.folders.create(a.id, "receitas")).toBeNull();
    expect(r.folders.create(b.id, "Receitas")?.notebookId).toBe(b.id);
    expect(r.folders.rename(recipes.id, "  ")).toBeNull();
    expect(r.folders.rename(recipes.id, "Cozinha")?.name).toBe("Cozinha");
    expect(r.folders.list().map(folder => folder.name)).toEqual(["Cozinha", "Receitas"]);
    expect(() => r.folders.create(999, "Órfã")).toThrow(/Caderno não encontrado/);
  });

  it("excluir a pasta mantém a nota no caderno", () => {
    const r = fresh();
    const notebook = r.notebooks.create("Pessoal")!;
    const folder = r.folders.create(notebook.id, "Viagem")!;
    const note = r.notes.create({ notebookId: notebook.id, folderId: folder.id, title: "Roteiro", contentHtml: "<p>fica</p>" });
    expect(r.folders.delete(folder.id)).toBe(true);
    const kept = r.notes.get(note.id);
    expect(kept).toMatchObject({ title: "Roteiro", notebookId: notebook.id, folderId: null, preview: "fica" });
    expect(r.folders.list()).toHaveLength(0);
    expect(r.notes.list({ view: "notebook", notebookId: notebook.id }).map(item => item.id)).toEqual([note.id]);
  });

  it("move notas entre pastas e limpa a pasta ao trocar de caderno", () => {
    const r = fresh();
    const home = r.notebooks.create("Pessoal")!;
    const work = r.notebooks.create("Trabalho")!;
    const inbox = r.folders.create(home.id, "Entrada")!;
    const archive = r.folders.create(home.id, "Arquivo")!;
    const project = r.folders.create(work.id, "Projeto")!;
    const note = r.notes.create({ notebookId: home.id, folderId: inbox.id, title: "Mover" });
    expect(r.notes.list({ view: "folder", folderId: inbox.id })).toHaveLength(1);
    expect(r.notes.moveToFolder(note.id, archive.id)).toMatchObject({ notebookId: home.id, folderId: archive.id });
    expect(r.notes.list({ view: "folder", folderId: inbox.id })).toHaveLength(0);
    expect(r.notes.moveToFolder(note.id, null)).toMatchObject({ notebookId: home.id, folderId: null });
    expect(r.notes.moveToFolder(note.id, project.id)).toMatchObject({ notebookId: work.id, folderId: project.id });
    expect(r.notes.move(note.id, home.id)).toMatchObject({ notebookId: home.id, folderId: null });
    expect(r.notes.moveToFolder("00000000-0000-4000-8000-000000000000", inbox.id)).toBeNull();
    expect(() => r.notes.create({ notebookId: work.id, folderId: inbox.id })).toThrow(/não pertence/);
  });

  it("move a pasta para outro caderno e leva as notas", () => {
    const r = fresh();
    const home = r.notebooks.create("Pessoal")!;
    const work = r.notebooks.create("Trabalho")!;
    const recipes = r.folders.create(home.id, "Receitas")!;
    const clash = r.folders.create(work.id, "Receitas")!;
    const note = r.notes.create({ notebookId: home.id, folderId: recipes.id, title: "Bolo" });
    const trashed = r.notes.create({ notebookId: home.id, folderId: recipes.id, title: "Rascunho" });
    r.notes.softDelete(trashed.id);
    expect(r.folders.move(recipes.id, home.id)?.notebookId).toBe(home.id);
    expect(r.folders.move(recipes.id, work.id)).toBeNull();
    expect(r.notes.get(note.id)).toMatchObject({ notebookId: home.id, folderId: recipes.id });
    expect(r.folders.move("00000000-0000-4000-8000-000000000000", work.id)).toBeNull();
    r.folders.delete(clash.id);
    expect(r.folders.move(recipes.id, work.id)).toMatchObject({ notebookId: work.id, name: "Receitas" });
    expect(r.notes.get(note.id)).toMatchObject({ notebookId: work.id, folderId: recipes.id });
    expect(r.notes.get(trashed.id)).toMatchObject({ notebookId: work.id, folderId: recipes.id, deletedAt: expect.any(Number) });
    expect(() => r.folders.move(recipes.id, 999)).toThrow(/Caderno não encontrado/);
  });

  it("excluir o caderno remove as pastas e preserva as notas sem vínculo", () => {
    const r = fresh();
    const notebook = r.notebooks.create("Pessoal")!;
    const folder = r.folders.create(notebook.id, "Notas")!;
    const note = r.notes.create({ folderId: folder.id, title: "Solta" });
    expect(r.notebooks.delete(notebook.id)).toBe(true);
    expect(r.folders.list()).toHaveLength(0);
    expect(r.notes.get(note.id)).toMatchObject({ title: "Solta", notebookId: null, folderId: null });
  });

  it("backup v9 restaura pastas e um backup legado não apaga a organização local", () => {
    const source = fresh();
    const notebook = source.notebooks.create("Pessoal")!;
    const folder = source.folders.create(notebook.id, "Receitas")!;
    const note = source.notes.create({ notebookId: notebook.id, folderId: folder.id, title: "Bolo" });
    const dump = source.backup.dump();
    expect(dump.schemaVersion).toBe(9);
    expect(dump.folders).toEqual([expect.objectContaining({ id: folder.id, name: "Receitas", notebookId: notebook.id })]);
    expect(dump.notes.find(item => item.id === note.id)?.folderId).toBe(folder.id);

    const target = fresh();
    expect(target.backup.restore(JSON.stringify(dump))).toMatchObject({ ok: true });
    expect(target.folders.list().map(item => item.name)).toEqual(["Receitas"]);
    expect(target.notes.get(note.id)).toMatchObject({ title: "Bolo", folderId: folder.id });

    const broken = structuredClone(dump);
    broken.notes.find(item => item.id === note.id)!.folderId = target.folders.list()[0] ? "00000000-0000-4000-8000-000000000099" : null;
    broken.notes.find(item => item.id === note.id)!.folderId = "00000000-0000-4000-8000-000000000099";
    const before = target.notes.list({ view: "all" }).length;
    expect(target.backup.restore(JSON.stringify(broken)).ok).toBe(false);
    expect(target.notes.list({ view: "all" })).toHaveLength(before);
    expect(target.notes.get(note.id)?.folderId).toBe(folder.id);

    const legacy = structuredClone(dump) as { schemaVersion: number; folders?: unknown; notes: Array<{ folderId?: string | null }> };
    legacy.schemaVersion = 8;
    delete legacy.folders;
    for (const item of legacy.notes) delete item.folderId;
    const kept = fresh();
    const localNotebook = kept.notebooks.create("Pessoal")!;
    const localFolder = kept.folders.create(localNotebook.id, "Receitas")!;
    kept.notes.create({ notebookId: localNotebook.id, folderId: localFolder.id, title: "Outra" });
    kept.db.prepare("UPDATE notes SET id=? WHERE title='Outra'").run(note.id);
    expect(kept.backup.restore(JSON.stringify(legacy))).toMatchObject({ ok: true });
    expect(kept.notes.get(note.id)).toMatchObject({ title: "Bolo", folderId: localFolder.id, notebookId: localNotebook.id });

    const missing = structuredClone(dump) as { folders?: unknown };
    delete missing.folders;
    expect(fresh().backup.restore(JSON.stringify(missing))).toMatchObject({ ok: false, error: expect.stringMatching(/pastas ausentes/) });
  });

  it("valida o contrato IPC das pastas", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(validateInput("folders:list", null).ok).toBe(true);
    expect(validateInput("folders:create", { notebookId: 1, name: " Receitas " }).ok).toBe(true);
    expect(validateInput("folders:create", { notebookId: 1, name: "   " }).ok).toBe(false);
    expect(validateInput("folders:rename", { id, name: "Arquivo" }).ok).toBe(true);
    expect(validateInput("folders:move", { id, notebookId: 2 }).ok).toBe(true);
    expect(validateInput("folders:move", { id, notebookId: 0 }).ok).toBe(false);
    expect(validateInput("folders:delete", { id }).ok).toBe(true);
    expect(validateInput("notes:moveToFolder", { id, folderId: null }).ok).toBe(true);
    expect(validateInput("notes:moveToFolder", { id, folderId: id }).ok).toBe(true);
    expect(validateInput("notes:list", { view: "folder", folderId: id }).ok).toBe(true);
    expect(validateInput("notes:list", { view: "folder" }).ok).toBe(false);
    expect(validateInput("notes:create", { notebookId: 1, folderId: id }).ok).toBe(true);
  });
});

describe("pastas no preview web", () => {
  it("cria, renomeia, exclui sem apagar notas e move entre pastas", async () => {
    localStorageMock.clear();
    const client = new WebClient();
    const notebook = (await client.listNotebooks()).find(item => item.name === "Pessoal")!;
    const folder = await client.createFolder(notebook.id, "Mercado")!;
    const note = await client.createNote({ notebookId: notebook.id, folderId: folder.id, title: "Lista" });
    expect(await client.listNotes({ view: "folder", folderId: folder.id })).toEqual([expect.objectContaining({ id: note.id, folderId: folder.id })]);
    expect((await client.renameFolder(folder.id, "Compras"))?.name).toBe("Compras");
    expect(await client.createFolder(notebook.id, "compras")).toBeNull();
    const other = (await client.listNotebooks()).find(item => item.name === "Trabalho")!;
    const work = (await client.createFolder(other.id, "Compras"))!;
    expect(await client.moveNoteToFolder(note.id, work.id)).toMatchObject({ notebookId: other.id, folderId: work.id });
    const carried = await client.createFolder(notebook.id, "Levar");
    const carriedNote = await client.createNote({ notebookId: notebook.id, folderId: carried!.id, title: "Vai junto" });
    expect(await client.moveFolder(carried!.id, notebook.id)).toMatchObject({ notebookId: notebook.id });
    const clash = await client.createFolder(other.id, "Levar");
    expect(await client.moveFolder(carried!.id, other.id)).toBeNull();
    expect(await client.deleteFolder(clash!.id)).toBe(true);
    expect(await client.deleteFolder(work.id)).toBe(true);
    expect(await client.moveFolder(carried!.id, other.id)).toMatchObject({ notebookId: other.id, name: "Levar" });
    expect(await client.getNote(carriedNote.id)).toMatchObject({ notebookId: other.id, folderId: carried!.id });
    expect(await client.getNote(note.id)).toMatchObject({ title: "Lista", notebookId: other.id, folderId: null });
    expect((await client.listFolders()).some(item => item.id === work.id)).toBe(false);
  });
});
