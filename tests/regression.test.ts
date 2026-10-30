/**
 * Testes de regressão para falhas reais encontradas na auditoria funcional da
 * UI (redesign 0.2.0). As falhas eram na camada de interface; aqui cravamos o
 * contrato de dados correspondente (independência título/conteúdo, persistência
 * de tema) no repositório e no adapter web, para evitar reintrodução.
 */
import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import { openDatabase } from "../electron/repo/db";
import { NotesRepo, Meta, uuid } from "../electron/repo/sqlite";
import { WebClient } from "../src/api/webClient";

/* ---- polyfill mínimo de localStorage para o WebClient em ambiente Node ---- */
const mem = new Map<string, string>();
const localStorageMock = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => void mem.clear(),
};
(globalThis as unknown as { localStorage: typeof localStorageMock }).localStorage = localStorageMock;
if (!(globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID) {
  (globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto = {
    randomUUID: () => `test-${Math.random().toString(36).slice(2)}-${Date.now()}`,
  };
}

describe("Regressão — independência título/conteúdo (bug: onUpdate sobrescrevia o título)", () => {
  it("WebClient usa prefixo apenas na última palavra da busca", async () => {
    localStorageMock.clear();
    const c = new WebClient();
    const hit = await c.createNote({ title: "Crie cadernos" });
    const nonHit = await c.createNote({ title: "Criação caderneta" });
    expect((await c.searchNotes("Crie cadern", 20)).map(note => note.id)).toContain(hit.id);
    expect((await c.searchNotes("Crie cadern", 20)).map(note => note.id)).not.toContain(nonHit.id);
  });

  it("WebClient.updateNote: conteúdo não altera título, título não altera conteúdo", async () => {
    localStorageMock.clear();
    const c = new WebClient();
    const n = await c.createNote({ title: "Título original", contentHtml: "<p>corpo original</p>" });

    await c.updateNote(n.id, { contentHtml: "<p>corpo novo</p>" });
    const afterBody = await c.getNote(n.id);
    expect(afterBody?.title).toBe("Título original");
    expect(afterBody?.contentHtml).toBe("<p>corpo novo</p>");

    await c.updateNote(n.id, { title: "Título novo" });
    const afterTitle = await c.getNote(n.id);
    expect(afterTitle?.title).toBe("Título novo");
    expect(afterTitle?.contentHtml).toBe("<p>corpo novo</p>");
  });

  it("NotesRepo.update: patchar título e conteúdo são independentes", () => {
    const db = openDatabase({ database: path.join(os.tmpdir(), `caderno-reg-${uuid()}.sqlite`), attachments: os.tmpdir() });
    const notes = new NotesRepo(db);
    const n = notes.create({ title: "T", contentHtml: "<p>c</p>" });
    notes.update(n.id, { title: "T2" });
    expect(notes.get(n.id)?.title).toBe("T2");
    expect(notes.get(n.id)?.contentHtml).toContain("c");
    notes.update(n.id, { contentHtml: "<p>c2</p>" });
    expect(notes.get(n.id)?.title).toBe("T2");
    expect(notes.get(n.id)?.contentHtml).toBe("<p>c2</p>");
    db.close();
  });
});

describe("Regressão — persistência de tema (bug: tema padrão sobrescrevia o salvo)", () => {
  it("WebClient: tema escuro persiste numa nova instância (simula restart)", async () => {
    localStorageMock.clear();
    const first = new WebClient();
    await first.setTheme("dark");
    // Nova instância lê o mesmo localStorage — equivale a reabrir o app.
    const second = new WebClient();
    expect(await second.theme()).toBe("dark");
  });

  it("Meta (SQLite): tema persiste após fechar e reabrir o banco", () => {
    const file = path.join(os.tmpdir(), `caderno-theme-${uuid()}.sqlite`);
    let db = openDatabase({ database: file, attachments: os.tmpdir() });
    new Meta(db).set("theme", "dark");
    db.close();

    db = openDatabase({ database: file, attachments: os.tmpdir() });
    expect(new Meta(db).get("theme")).toBe("dark");
    db.close();
  });
});
