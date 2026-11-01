import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../electron/repo/db";
import { BackupRepo } from "../electron/repo/attachments";
import { NotebooksRepo, NotesRepo } from "../electron/repo/sqlite";
import type { ClipCommitInput } from "../electron/clipper-commit";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-clip-commit-"));
  const db = openDatabase({ database: path.join(root, "data.sqlite"), attachments: path.join(root, "assets") });
  cleanups.push(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { db, notes: new NotesRepo(db), notebooks: new NotebooksRepo(db), backup: new BackupRepo(db, path.join(root, "assets")), root };
}

function clip(patch: Partial<ClipCommitInput> = {}): ClipCommitInput {
  return {
    requestId: crypto.randomUUID(),
    notebookId: null,
    title: "Receita",
    contentHtml: "<p><strong>Fonte:</strong> exemplo</p><hr><p>Texto</p>",
    sourceUrl: "https://example.test/artigo?utm_source=boletim",
    canonicalUrl: "https://example.test/artigo",
    mode: "article",
    contentHash: "hash-artigo",
    confirmNew: false,
    appendToNoteId: null,
    tags: [],
    ...patch,
  };
}

describe("commit do Clipper", () => {
  it("grava nota, etiquetas e origem juntas e repete o mesmo requestId sem duplicar", () => {
    const { db, notes } = fresh();
    const input = clip({ tags: ["Ação", "ação", "Ideias"] });
    const first = notes.commitClip(input);
    const second = notes.commitClip(input);
    expect(second).toMatchObject({ idempotent: true, duplicate: false, noteId: first.noteId, title: "Receita" });
    expect(notes.list({ view: "all" })).toHaveLength(1);
    expect(notes.get(first.noteId)?.tags.map(tag => tag.name).sort()).toEqual(["Ação", "Ideias"]);
    expect(db.prepare("SELECT MAX(version) AS version FROM migration_log").get()).toEqual({ version: 16 });
    expect(db.prepare("SELECT request_id, canonical_url, mode FROM clipper_sources").get()).toMatchObject({ request_id: input.requestId, canonical_url: input.canonicalUrl, mode: "article" });
  });

  it("permite outra seleção e outra captura explícita, e ignora nota na lixeira", () => {
    const { notes } = fresh();
    const article = notes.commitClip(clip({ title: "Artigo" }));
    expect(notes.commitClip(clip({ title: "repetido" })).duplicate).toBe(true);
    const first = notes.commitClip(clip({ mode: "selection", contentHash: "trecho-a", title: "Trecho A" }));
    const second = notes.commitClip(clip({ mode: "selection", contentHash: "trecho-b", title: "Trecho B" }));
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(false);
    expect(notes.commitClip(clip({ mode: "selection", contentHash: "trecho-a", title: "de novo" })).duplicate).toBe(true);
    notes.softDelete(article.noteId);
    const afterTrash = notes.commitClip(clip({ title: "Depois da lixeira" }));
    expect(afterTrash.duplicate).toBe(false);
    expect(notes.findByClipSource("https://example.test/artigo?utm_source=boletim")?.title).toBe("Depois da lixeira");
    expect(notes.list({ view: "trash" }).map(note => note.id)).toEqual([article.noteId]);
    const again = notes.commitClip(clip({ confirmNew: true, title: "Outra mesmo assim" }));
    expect(again.duplicate).toBe(false);
    expect(notes.list({ view: "all" }).map(note => note.title).sort()).toEqual(["Depois da lixeira", "Outra mesmo assim", "Trecho A", "Trecho B"]);
  });

  it("reconhece captura antiga pela URL e desfaz nota se a origem não grava", () => {
    const { db, notes } = fresh();
    const legacy = notes.create({ title: "Antiga", contentHtml: "<p>antiga</p>" });
    notes.recordClipSource(legacy.id, "https://example.test/artigo", "Antiga");
    expect(notes.commitClip(clip()).duplicate).toBe(true);
    db.exec("CREATE TRIGGER clip_fail BEFORE INSERT ON clipper_sources WHEN NEW.source_title = 'force-fail' BEGIN SELECT RAISE(ABORT, 'forced'); END;");
    expect(() => notes.commitClip(clip({ title: "force-fail", sourceUrl: "https://example.test/outra", canonicalUrl: "https://example.test/outra" }))).toThrow(/forced/);
    expect(notes.get(legacy.id)?.title).toBe("Antiga");
    expect(notes.list({ view: "all" })).toHaveLength(1);
  });

  it("acrescenta sem apagar o texto anterior e recusa destino ausente ou na lixeira", () => {
    const { notes, notebooks } = fresh();
    const notebook = notebooks.create("Receitas")!;
    const other = notebooks.create("Trabalho")!;
    const target = notes.create({ notebookId: notebook.id, title: "Caderno de receita", contentHtml: "<p>antes</p>" });
    const homonym = notes.create({ notebookId: other.id, title: "Caderno de receita", contentHtml: "<p>outro</p>" });
    const appended = notes.commitClip(clip({ appendToNoteId: target.id, contentHtml: "<hr><p>trecho novo</p>", tags: ["Forno"] }));
    expect(appended).toMatchObject({ duplicate: false, noteId: target.id, title: "Caderno de receita" });
    expect(notes.get(target.id)?.contentHtml).toContain("antes");
    expect(notes.get(target.id)?.contentHtml).toContain("trecho novo");
    expect(notes.get(target.id)?.tags.map(tag => tag.name)).toEqual(["Forno"]);
    expect(() => notes.commitClip(clip({ appendToNoteId: crypto.randomUUID() }))).toThrow(/NOTE_NOT_FOUND/);
    notes.softDelete(homonym.id);
    expect(() => notes.commitClip(clip({ appendToNoteId: homonym.id }))).toThrow(/NOTE_TRASHED/);
    expect(() => notes.commitClip(clip({ notebookId: 999, sourceUrl: "https://example.test/nova", canonicalUrl: "https://example.test/nova" }))).toThrow(/NOTEBOOK_NOT_FOUND/);
    expect(notes.searchClipTitles("receita").map(item => item.notebook).sort()).toEqual(["Receitas"]);
    expect(notes.searchClipTitles("")).toEqual([]);
  });

  it("restaura fontes da mesma URL e mantém a idempotência no backup versão 9", () => {
    const { notes, backup } = fresh();
    const first=clip({ mode: "selection", contentHash: "um", title: "Um" });
    notes.commitClip(first);
    notes.commitClip(clip({ mode: "selection", contentHash: "dois", title: "Dois" }));
    const dump = backup.dump();
    expect(dump.schemaVersion).toBe(9);
    expect(dump.clipperSources).toHaveLength(2);
    const restored = fresh();
    expect(restored.backup.restore(JSON.stringify(dump)).ok).toBe(true);
    expect(restored.notes.list({ view: "all" })).toHaveLength(2);
    expect(restored.db.prepare("SELECT COUNT(*) AS count FROM clipper_sources").get()).toEqual({ count: 2 });
    expect(restored.notes.commitClip(first).idempotent).toBe(true);
    expect(restored.backup.restore(JSON.stringify(dump)).ok).toBe(true);
    expect(restored.db.prepare("SELECT COUNT(*) AS count FROM clipper_sources").get()).toEqual({ count: 2 });
    const legacy=JSON.parse(JSON.stringify(dump));
    legacy.clipperSources=legacy.clipperSources.map(({noteId,sourceUrl,sourceTitle,capturedAt}:NonNullable<typeof dump.clipperSources>[number])=>({noteId,sourceUrl,sourceTitle,capturedAt}));
    const oldRestore=fresh();
    expect(oldRestore.backup.restore(JSON.stringify(legacy)).ok).toBe(true);
    expect(oldRestore.db.prepare("SELECT COUNT(*) AS count FROM clipper_sources").get()).toEqual({ count: 2 });
  });
});
