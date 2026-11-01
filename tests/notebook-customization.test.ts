import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDatabase } from "../electron/repo/db";
import { BackupRepo } from "../electron/repo/attachments";
import { NotebooksRepo, NotesRepo } from "../electron/repo/sqlite";
import { validateInput } from "../shared/api";
import { CHANNEL_NAMES } from "../shared/bridge";
import {
  DEFAULT_NOTEBOOK_CUSTOMIZATION, NOTEBOOK_COLOR_PRESETS, NOTEBOOK_ICON_PRESETS, NOTEBOOK_LABELS_MAX, collectNotebookLabels, contrastRatio,
  isDefaultNotebookCustomization, isValidNotebookIcon, normalizeNotebookDescription, normalizeNotebookEmoji, normalizeNotebookIcon,
  normalizeNotebookLabels, notebookMatchesFilter, parseNotebookIcon, parseStoredLabels, readableInk, sanitizeNotebookCustomization, shareNotebooks,
} from "../shared/notebook-customization";
import { WebClient } from "../src/api/webClient";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()?.(); });

function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-nb-custom-"));
  const files = { database: path.join(root, "data.sqlite"), attachments: path.join(root, "assets") };
  const db = openDatabase(files);
  cleanups.push(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, files, db, notes: new NotesRepo(db), notebooks: new NotebooksRepo(db), backup: new BackupRepo(db, files.attachments) };
}

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => void mem.clear(),
} as Storage;

describe("emoji e ícone seguros", () => {
  it("aceita um único emoji (incluindo sequências) e recusa texto/markup", () => {
    for (const ok of ["📓", "🙂", "✈️", "👨‍👩‍👧", "🇧🇷", "👍🏽", "1️⃣", " 📚 "]) expect(normalizeNotebookEmoji(ok), ok).toBe(ok.trim());
    for (const bad of ["", "a", "1", "#", "<b>", "<img src=x onerror=alert(1)>", "🙂🙂", "ab🙂", "\n", "javascript:", "x".repeat(40), 5, null]) expect(normalizeNotebookEmoji(bad as never), String(bad)).toBeNull();
    expect(normalizeNotebookEmoji(`🙂${String.fromCodePoint(0x202e)}`)).toBeNull();
  });

  it("valida presets e o formato emoji:", () => {
    for (const name of NOTEBOOK_ICON_PRESETS) expect(isValidNotebookIcon(name)).toBe(true);
    expect(isValidNotebookIcon("emoji:🌱")).toBe(true);
    for (const bad of ["", "unknown", "emoji:", "emoji:abc", "emoji:<script>", "<svg onload=1>", "javascript:alert(1)", "../book"]) expect(isValidNotebookIcon(bad), bad).toBe(false);
    expect(parseNotebookIcon("briefcase")).toEqual({ kind: "preset", name: "briefcase" });
    expect(parseNotebookIcon("emoji:🌱")).toEqual({ kind: "emoji", value: "🌱" });
    expect(parseNotebookIcon("emoji:<b>")).toEqual({ kind: "preset", name: "book" });
    expect(normalizeNotebookIcon(undefined)).toBe("book");
    expect(normalizeNotebookIcon(42)).toBe("book");
  });
});

describe("normalização de texto, etiquetas e cor", () => {
  it("limpa descrição e etiquetas sem confundir caixa/acento", () => {
    expect(normalizeNotebookDescription("  uma\n\tdescrição   curta ")).toBe("uma descrição curta");
    expect(normalizeNotebookDescription("x".repeat(500))).toHaveLength(140);
    expect(normalizeNotebookLabels(["#Trabalho", " trabalho ", "Ação", "acao", "", "   ", 4, "a".repeat(80)]))
      .toEqual(["Trabalho", "Ação", "a".repeat(32)]);
    expect(normalizeNotebookLabels(Array.from({ length: 40 }, (_, i) => `etiqueta ${i}`))).toHaveLength(NOTEBOOK_LABELS_MAX);
    expect(normalizeNotebookLabels("nope")).toEqual([]);
    expect(parseStoredLabels("não é json")).toEqual([]);
    expect(parseStoredLabels(JSON.stringify(["a", "A", "b"]))).toEqual(["a", "b"]);
  });

  it("sanitiza qualquer entrada para o padrão quando inválida", () => {
    expect(sanitizeNotebookCustomization({ icon: "x", color: "red", description: 3, labels: "no" })).toEqual(DEFAULT_NOTEBOOK_CUSTOMIZATION);
    expect(sanitizeNotebookCustomization({ icon: "star", color: "#ABCDEF" })).toMatchObject({ icon: "star", color: "#abcdef" });
    expect(isDefaultNotebookCustomization(DEFAULT_NOTEBOOK_CUSTOMIZATION)).toBe(true);
    expect(isDefaultNotebookCustomization({ icon: "star" })).toBe(false);
  });
});

describe("contraste", () => {
  it("escolhe tinta com contraste mínimo de 4,5:1 para toda cor sugerida e para extremos", () => {
    for (const color of [...NOTEBOOK_COLOR_PRESETS, "#000000", "#ffffff", "#808080", "#777777", "#ffff00", "#0000ff", "#7f7f7f"]) {
      expect(contrastRatio(color, readableInk(color)), color).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableInk("#ffff00")).toBe("#000000");
    expect(readableInk("#1e3a8a")).toBe("#ffffff");
  });
});

describe("filtro de cadernos", () => {
  const books = [
    { name: "Projetos 2026", description: "Roadmap do ano", labels: ["Trabalho", "Prioridade"] },
    { name: "Receitas", description: "", labels: ["Casa"] },
    { name: "Diário", labels: [] },
  ];
  it("encontra por nome, descrição e etiqueta (sem acento/caixa) e respeita #", () => {
    const names = (q: string) => books.filter(b => notebookMatchesFilter(b, q)).map(b => b.name);
    expect(names("")).toHaveLength(3);
    expect(names("diario")).toEqual(["Diário"]);
    expect(names("roadmap")).toEqual(["Projetos 2026"]);
    expect(names("trabalho")).toEqual(["Projetos 2026"]);
    expect(names("#casa")).toEqual(["Receitas"]);
    expect(names("#receitas")).toEqual([]);
    expect(names("#")).toEqual([]);
    expect(names("projetos #trabalho")).toEqual(["Projetos 2026"]);
    expect(names("projetos #casa")).toEqual([]);
  });
  it("conta etiquetas distintas por uso", () => {
    expect(collectNotebookLabels([{ labels: ["Casa", "Ação"] }, { labels: ["casa", "acao"] }, { labels: ["Zeta"] }, {}])).toEqual([
      { label: "Ação", count: 2 }, { label: "Casa", count: 2 }, { label: "Zeta", count: 1 },
    ].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")));
  });
});

describe("store: identidade estável", () => {
  const nb = (id: number, patch = {}) => ({ id, name: `N${id}`, createdAt: 1, noteCount: 0, icon: "book", color: null, description: "", labels: [] as string[], ...patch });
  it("reaproveita objetos inalterados e a lista inteira quando nada mudou", () => {
    const a = [nb(1), nb(2)];
    expect(shareNotebooks(a, [nb(1), nb(2)])).toBe(a);
    const b = shareNotebooks(a, [nb(1), nb(2, { color: "#112233" })]);
    expect(b).not.toBe(a);
    expect(b[0]).toBe(a[0]);
    expect(b[1]).not.toBe(a[1]);
    expect(shareNotebooks(a, [nb(2), nb(1)])).not.toBe(a);
    expect(shareNotebooks(a, [nb(1, { labels: ["x"] }), nb(2)])[1]).toBe(a[1]);
  });
});

describe("contrato IPC", () => {
  it("registra o canal e valida os campos", () => {
    expect(CHANNEL_NAMES).toContain("notebooks:customize");
    expect(validateInput("notebooks:customize", { id: 1, icon: "rocket", color: "#AABBCC", description: "ok", labels: ["a"] }).ok).toBe(true);
    expect(validateInput("notebooks:customize", { id: 1, icon: "emoji:🌱", color: null }).ok).toBe(true);
    expect(validateInput("notebooks:customize", { id: 1 }).ok).toBe(true);
    for (const bad of [
      { id: 0 }, { id: 1.5 }, { icon: "rocket" }, { id: 1, icon: "<img src=x onerror=1>" }, { id: 1, icon: "emoji:abc" }, { id: 1, color: "red" }, { id: 1, color: "#12345" },
      { id: 1, description: "x".repeat(141) }, { id: 1, labels: "a" }, { id: 1, labels: Array(30).fill("a") }, { id: 1, labels: [1] }, { id: 1, labels: ["a".repeat(80)] },
    ]) expect(validateInput("notebooks:customize", bad).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe("persistência de cadernos", () => {
  it("novo caderno nasce com o padrão e a lista expõe createdAt", () => {
    const r = fresh();
    const created = r.notebooks.create("Pessoal")!;
    expect(created).toMatchObject({ name: "Pessoal", noteCount: 0, icon: "book", color: null, description: "", labels: [] });
    expect(typeof created.createdAt).toBe("number");
    expect(r.notebooks.list()).toEqual([created]);
  });

  it("personaliza, persiste ao reabrir e preserva campos não enviados", () => {
    const r = fresh();
    const nb = r.notebooks.create("Projetos")!;
    r.notes.create({ notebookId: nb.id, title: "A" });
    const saved = r.notebooks.customize({ id: nb.id, icon: "rocket", color: "#3B82F6", description: "  Metas  do ano ", labels: ["Trabalho", "trabalho", "#2026"] })!;
    expect(saved).toMatchObject({ icon: "rocket", color: "#3b82f6", description: "Metas do ano", labels: ["Trabalho", "2026"], noteCount: 1 });
    expect(r.notebooks.customize({ id: nb.id, labels: ["Casa"] })).toMatchObject({ icon: "rocket", color: "#3b82f6", description: "Metas do ano", labels: ["Casa"] });
    expect(r.notebooks.customize({ id: nb.id, color: null })).toMatchObject({ icon: "rocket", color: null, labels: ["Casa"] });
    expect(r.notebooks.customize({ id: nb.id, icon: "emoji:🌱" })).toMatchObject({ icon: "emoji:🌱" });
    expect(r.notebooks.rename(nb.id, "Metas")).toMatchObject({ name: "Metas", icon: "emoji:🌱", labels: ["Casa"], noteCount: 1 });
    r.db.close();
    const reopened = openDatabase(r.files);
    cleanups.push(() => reopened.close());
    expect(new NotebooksRepo(reopened).list()).toEqual([expect.objectContaining({ name: "Metas", icon: "emoji:🌱", color: null, description: "Metas do ano", labels: ["Casa"] })]);
  });

  it("restaurar padrão limpa tudo; caderno inexistente devolve null; dados inválidos são recusados", () => {
    const r = fresh();
    const nb = r.notebooks.create("X")!;
    r.notebooks.customize({ id: nb.id, icon: "star", color: "#ff0000", description: "d", labels: ["a"] });
    expect(r.notebooks.customize({ id: nb.id, icon: "book", color: null, description: "", labels: [] })).toMatchObject(DEFAULT_NOTEBOOK_CUSTOMIZATION);
    expect(r.notebooks.customize({ id: 999, icon: "star" })).toBeNull();
    expect(() => r.notebooks.customize({ id: nb.id, icon: "<script>" })).toThrow();
    expect(() => r.notebooks.customize({ id: nb.id, color: "vermelho" })).toThrow();
    expect(r.notebooks.get(nb.id)).toMatchObject(DEFAULT_NOTEBOOK_CUSTOMIZATION);
  });

  it("SQL é parametrizado: valores com aspas/SQL ficam como texto", () => {
    const r = fresh();
    const nb = r.notebooks.create("S")!;
    const text = "x'); DROP TABLE notebooks;--";
    r.notebooks.customize({ id: nb.id, description: text, labels: [text.slice(0, 30)] });
    expect(r.db.prepare("SELECT COUNT(*) AS c FROM notebooks").get()).toEqual({ c: 1 });
    expect(r.notebooks.get(nb.id)?.description).toBe(text.slice(0, 140));
  });

  it("lê valores corrompidos no banco como padrão", () => {
    const r = fresh();
    const nb = r.notebooks.create("Corrompido")!;
    r.db.prepare("UPDATE notebooks SET icon='??', color='azul', description='', labels='{' WHERE id=?").run(nb.id);
    expect(r.notebooks.get(nb.id)).toMatchObject(DEFAULT_NOTEBOOK_CUSTOMIZATION);
  });

  it("excluir mantém o comportamento (notas ficam sem caderno)", () => {
    const r = fresh();
    const nb = r.notebooks.create("Z")!;
    const note = r.notes.create({ notebookId: nb.id, title: "n" });
    r.notebooks.customize({ id: nb.id, icon: "star" });
    expect(r.notebooks.delete(nb.id)).toBe(true);
    expect(r.notes.get(note.id)?.notebookId).toBeNull();
  });
});

describe("migração", () => {
  it("migra um banco v15 sem perder cadernos nem notas e aplica o padrão", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-nb-mig-"));
    const files = { database: path.join(root, "c.sqlite"), attachments: path.join(root, "a") };
    fs.mkdirSync(files.attachments);
    const first = openDatabase(files);
    new NotebooksRepo(first).create("Antigo");
    first.prepare("DELETE FROM migration_log WHERE version>=16").run();
    // Simula um banco anterior à v16: recria a tabela sem as colunas novas, mantendo `color` (existe desde a v1).
    first.exec(`PRAGMA foreign_keys=OFF; ALTER TABLE notebooks DROP COLUMN icon; ALTER TABLE notebooks DROP COLUMN description; ALTER TABLE notebooks DROP COLUMN labels; PRAGMA foreign_keys=ON;`);
    first.prepare("INSERT INTO notes(id,notebook_id,title,created_at,updated_at) VALUES('11111111-1111-4111-8111-111111111111',1,'Velha',1,1)").run();
    first.close();

    const db = openDatabase(files);
    cleanups.push(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
    expect(db.prepare("SELECT MAX(version) AS v FROM migration_log").get()).toEqual({ v: 16 });
    expect(new NotebooksRepo(db).list()).toEqual([expect.objectContaining({ name: "Antigo", icon: "book", color: null, description: "", labels: [], noteCount: 1 })]);
    expect(new NotesRepo(db).get("11111111-1111-4111-8111-111111111111")?.title).toBe("Velha");
    expect(fs.readdirSync(root).some(name => name.includes(".pre-v16-"))).toBe(true);
  });

  it("é idempotente quando as colunas já existem", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-nb-mig2-"));
    const files = { database: path.join(root, "c.sqlite"), attachments: path.join(root, "a") };
    const first = openDatabase(files);
    new NotebooksRepo(first).create("Já tem colunas");
    first.prepare("DELETE FROM migration_log WHERE version=16").run();
    first.close();
    const db = openDatabase(files);
    cleanups.push(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
    expect(new NotebooksRepo(db).list()).toHaveLength(1);
    const columns = (db.prepare("PRAGMA table_info(notebooks)").all() as { name: string }[]).map(c => c.name);
    expect(columns.filter(c => c === "icon")).toHaveLength(1);
  });
});

describe("backup e restauração", () => {
  it("o backup carrega ícone/cor/descrição/etiquetas e restaura em outro perfil", () => {
    const source = fresh();
    const nb = source.notebooks.create("Projetos")!;
    source.notebooks.create("Simples");
    source.notebooks.customize({ id: nb.id, icon: "emoji:🚀", color: "#7c3aed", description: "Metas", labels: ["Trabalho", "2026"] });
    source.notes.create({ notebookId: nb.id, title: "Plano" });
    const dump = source.backup.dump();
    expect(dump.schemaVersion).toBe(9);
    expect(dump.notebooks).toEqual(expect.arrayContaining([
      { id: nb.id, name: "Projetos", icon: "emoji:🚀", color: "#7c3aed", description: "Metas", labels: ["Trabalho", "2026"] },
      expect.objectContaining({ name: "Simples", icon: "book", color: null, labels: [] }),
    ]));

    const target = fresh();
    expect(target.backup.restore(JSON.stringify(dump))).toMatchObject({ ok: true, notebooks: 2 });
    expect(target.notebooks.list().find(n => n.name === "Projetos")).toMatchObject({ icon: "emoji:🚀", color: "#7c3aed", description: "Metas", labels: ["Trabalho", "2026"], noteCount: 1 });
    // Restaurar de novo não duplica nem altera.
    expect(target.backup.restore(JSON.stringify(dump))).toMatchObject({ ok: true, notebooks: 2 });
    expect(target.notebooks.list()).toHaveLength(2);
  });

  it("aceita backups antigos sem personalização", () => {
    const source = fresh();
    source.notebooks.create("Legado");
    const old = structuredClone(source.backup.dump()) as { schemaVersion: number; notebooks: Record<string, unknown>[] };
    old.schemaVersion = 8;
    old.notebooks = old.notebooks.map(({ id, name }) => ({ id, name }));
    const target = fresh();
    expect(target.backup.restore(JSON.stringify({ ...old, templates: [], folders: [] }))).toMatchObject({ ok: true });
    expect(target.notebooks.list()).toEqual([expect.objectContaining({ name: "Legado", ...DEFAULT_NOTEBOOK_CUSTOMIZATION })]);
  });

  it("não sobrescreve a personalização local; só preenche o que está no padrão", () => {
    const source = fresh();
    const a = source.notebooks.create("Mesmo")!;
    source.notebooks.customize({ id: a.id, icon: "rocket", color: "#ef4444", description: "do backup", labels: ["backup"] });
    const dump = source.backup.dump();

    const local = fresh();
    const b = local.notebooks.create("mesmo")!;
    local.notebooks.customize({ id: b.id, icon: "star", labels: ["local"] });
    expect(local.backup.restore(JSON.stringify(dump))).toMatchObject({ ok: true });
    expect(local.notebooks.list()).toEqual([expect.objectContaining({ name: "mesmo", icon: "star", color: "#ef4444", description: "do backup", labels: ["local"] })]);
  });

  it("normaliza valores desconhecidos e rejeita tipos inválidos sem alterar o perfil", () => {
    const source = fresh();
    source.notebooks.create("Futuro");
    const dump = structuredClone(source.backup.dump());
    (dump.notebooks[0] as Record<string, unknown>).icon = "ícone-de-uma-versão-futura";
    (dump.notebooks[0] as Record<string, unknown>).color = "não-é-cor";
    const target = fresh();
    expect(target.backup.restore(JSON.stringify(dump))).toMatchObject({ ok: true });
    expect(target.notebooks.list()[0]).toMatchObject({ icon: "book", color: null });

    for (const patch of [{ icon: 5 }, { color: 7 }, { description: {} }, { labels: "a" }, { labels: [1] }, { labels: Array(300).fill("a") }]) {
      const broken = structuredClone(dump);
      Object.assign(broken.notebooks[0], patch);
      const clean = fresh();
      const result = clean.backup.restore(JSON.stringify(broken));
      expect(result.ok, JSON.stringify(patch)).toBe(false);
      expect(clean.notebooks.list()).toHaveLength(0);
    }
  });
});

describe("adapter web de desenvolvimento", () => {
  it("customiza, persiste e salva a personalização", async () => {
    mem.clear();
    const client = new WebClient();
    const nb = (await client.listNotebooks())[0];
    expect(nb).toMatchObject(DEFAULT_NOTEBOOK_CUSTOMIZATION);
    const saved = await client.customizeNotebook({ id: nb.id, icon: "emoji:📚", color: "#22c55e", labels: ["Estudo", "estudo"] });
    expect(saved).toMatchObject({ icon: "emoji:📚", color: "#22c55e", labels: ["Estudo"] });
    expect(await client.customizeNotebook({ id: 9999, icon: "star" })).toBeNull();
    expect((await client.listNotebooks()).find(n => n.id === nb.id)).toMatchObject({ icon: "emoji:📚", labels: ["Estudo"] });
    expect((await client.renameNotebook(nb.id, "Renomeado"))).toMatchObject({ icon: "emoji:📚", color: "#22c55e" });
  });
});
