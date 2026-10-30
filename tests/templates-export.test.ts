import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { openDatabase } from "../electron/repo/db";
import { NotesRepo } from "../electron/repo/sqlite";
import { AttachmentsRepo, BackupRepo } from "../electron/repo/attachments";
import { PdfAnnotationsRepo } from "../electron/repo/pdf-annotations";
import { TemplatesRepo, BUILTIN_TEMPLATES } from "../electron/repo/templates";
import { buildExportHtml, writeFileAtomic, EXPORT_CSP, type ExportAssetSource } from "../electron/export-html";
import { collectAssetRefs, sanitizeNoteHtml } from "../electron/repo/note-html";
import { validateInput } from "../shared/api";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0).reverse()) c(); });
function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-templates-")), assets = path.join(root, "assets");
  const db = openDatabase({ database: path.join(root, "data.sqlite"), attachments: assets });
  cleanups.push(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, assets, db, notes: new NotesRepo(db), attachments: new AttachmentsRepo(db, assets), pdf: new PdfAnnotationsRepo(db), templates: new TemplatesRepo(db, assets), backup: new BackupRepo(db, assets) };
}
const png = fs.readFileSync(path.resolve("tests/fixtures/media/valid.png"));
const pdfBytes = fs.readFileSync(path.resolve("tests/fixtures/media/two-pages.pdf"));
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

function noteWithMedia(r: ReturnType<typeof fresh>) {
  const note = r.notes.create({ title: "Origem" });
  const image = r.attachments.saveImage(note.id, "foto.png", png);
  const pdf = r.attachments.save(note.id, "contrato.pdf", pdfBytes);
  r.pdf.save({ storedName: pdf.storedName, page: 2, kind: "highlight", rect: { x: .1, y: .2, width: .3, height: .05 }, comment: "Cláusula" });
  const html = `<h2>Pauta</h2><p><span style="font-family: Caveat, cursive">manuscrito</span></p><img src="caderno-asset://${image.storedName}" alt="Foto"><table><tbody><tr><th><p>A</p></th><td><p>B</p></td></tr></tbody></table><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>feito</p></div></li></ul><figure data-attachment-id="${pdf.id}" data-file-name="contrato.pdf" data-stored-name="${pdf.storedName}" data-mime-type="application/pdf" data-byte-size="${pdf.byteSize}" data-caderno-attachment="true"><figcaption>contrato.pdf</figcaption></figure><img src="caderno-asset://00000000-0000-4000-8000-000000000000.png" alt="Perdida">`;
  r.notes.update(note.id, { contentHtml: html });
  return { note, image, pdf };
}

describe("modelos de nota", () => {
  it("migração v12 cria modelos prontos com UUID e permite restaurar os que faltam", () => {
    const r = fresh();
    const list = r.templates.list();
    expect(list.map(t => t.builtinKey).sort()).toEqual(BUILTIN_TEMPLATES.map(t => t.key).sort());
    for (const t of list) expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.templates.list("reuniao")[0].name).toBe("Ata de reunião");
    r.templates.delete(list[0].id);
    expect(r.templates.restoreBuiltins()).toBe(1);
    expect(r.templates.restoreBuiltins()).toBe(0);
  });

  it("copia mídias para o modelo e cria nota nova com anexos próprios mesmo após apagar a origem", () => {
    const r = fresh(), { note, image, pdf } = noteWithMedia(r);
    const saved = r.templates.createFromNote(note.id, { name: "Com mídia", description: "teste" });
    expect(saved.copiedAssets).toBe(2);
    expect(saved.skippedAssets).toEqual([{ fileName: "Perdida", reason: "anexo não registrado" }]);
    const full = r.templates.get(saved.template.id)!;
    expect(full.previewHtml).toContain("data:image/png;base64,");
    expect(full.previewHtml).not.toContain("caderno-asset://");
    expect(full.assets.find(a => a.mimeType === "application/pdf")?.annotationCount).toBe(1);
    // Origem apagada definitivamente e arquivos originais removidos do disco.
    r.notes.purge(note.id);
    fs.rmSync(path.join(r.assets, image.storedName)); fs.rmSync(path.join(r.assets, pdf.storedName));
    const before = r.notes.list({ view: "all" }).length;
    const createdId = r.templates.apply(saved.template.id, null, new Date(2026, 9, 30));
    const created = r.notes.get(createdId)!;
    expect(r.notes.list({ view: "all" }).length).toBe(before + 1);
    expect(created.title).toBe("Origem");
    const own = r.attachments.list(createdId);
    expect(own).toHaveLength(2);
    const refs = collectAssetRefs(created.contentHtml);
    expect(refs.sort()).toEqual(own.map(a => a.storedName).sort());
    for (const a of own) { expect(r.attachments.media(a.storedName)).not.toBeNull(); expect(a.storedName).not.toBe(image.storedName); }
    const newPdf = own.find(a => a.mimeType === "application/pdf")!;
    expect(created.contentHtml).toContain(`data-attachment-id="${newPdf.id}"`);
    expect(r.pdf.listAll(newPdf.storedName)).toMatchObject([{ page: 2, comment: "Cláusula" }]);
    expect(sha(fs.readFileSync(path.join(r.assets, newPdf.storedName)))).toBe(sha(pdfBytes));
    expect(created.contentHtml).toContain("Caveat");
    expect(created.contentHtml).toContain('data-type="taskList"');
    expect(created.contentHtml).not.toContain("caderno-template-asset");
    expect(created.contentHtml).not.toContain("00000000-0000-4000-8000-000000000000");
    // Aplicar de novo gera outra nota independente.
    const second = r.templates.apply(saved.template.id, null);
    expect(second).not.toBe(createdId);
    expect(r.attachments.list(second).map(a => a.storedName)).not.toEqual(own.map(a => a.storedName));
  });

  it("substitui {{data}} e falha atomicamente sem deixar nota ou arquivos", () => {
    const r = fresh(), meeting = r.templates.list().find(t => t.builtinKey === "meeting")!;
    const id = r.templates.apply(meeting.id, null, new Date(2026, 9, 30));
    expect(r.notes.get(id)!.title).toBe("Reunião — 30/10/2026");
    expect(r.notes.get(id)!.contentHtml).toContain("30/10/2026");
    const { note } = noteWithMedia(r);
    const saved = r.templates.createFromNote(note.id, { name: "Quebrado" });
    r.db.prepare("UPDATE note_template_assets SET annotations='[{\"bad\":1}]' WHERE template_id=? AND mime_type='application/pdf'").run(saved.template.id);
    const notesBefore = (r.db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n;
    const filesBefore = fs.readdirSync(r.assets).sort();
    expect(() => r.templates.apply(saved.template.id, null)).toThrow();
    expect((r.db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n).toBe(notesBefore);
    expect(fs.readdirSync(r.assets).sort()).toEqual(filesBefore);
  });

  it("renomeia, exclui e valida nome pelo contrato IPC", () => {
    const r = fresh(), t = r.templates.list()[0];
    expect(r.templates.update(t.id, { name: "  Novo nome " })!.name).toBe("Novo nome");
    expect(validateInput("templates:update", { id: t.id, name: "   " }).ok).toBe(false);
    expect(validateInput("templates:apply", { id: "x" }).ok).toBe(false);
    expect(r.templates.delete(t.id)).toBe(true);
    expect(r.templates.get(t.id)).toBeNull();
  });

  it("backup v8 inclui modelos com mídia, restaura em outro perfil e rejeita modelo corrompido sem alterar nada", () => {
    const source = fresh(), { note } = noteWithMedia(source);
    const saved = source.templates.createFromNote(note.id, { name: "Portátil" });
    const payload = source.backup.dump();
    expect(payload.schemaVersion).toBe(8);
    expect(payload.templates!.find(t => t.id === saved.template.id)!.assets).toHaveLength(2);
    const target = fresh();
    const corrupt = structuredClone(payload); corrupt.templates!.find(t => t.id === saved.template.id)!.assets[0].sha256 = "0".repeat(64);
    const notesBefore = target.notes.list({ view: "all" }).length;
    const bad = target.backup.restore(JSON.stringify(corrupt));
    expect(bad.ok).toBe(false);
    expect(target.templates.get(saved.template.id)).toBeNull();
    expect(target.notes.list({ view: "all" }).length).toBe(notesBefore);
    const ok = target.backup.restore(JSON.stringify(payload));
    expect(ok).toMatchObject({ ok: true });
    expect(target.templates.list().filter(t => t.builtinKey).length).toBe(BUILTIN_TEMPLATES.length);
    const created = target.templates.apply(saved.template.id, null);
    expect(target.attachments.list(created)).toHaveLength(2);
    // Backups legados (v7) sem modelos continuam aceitos.
    const legacy = structuredClone(payload) as Record<string, unknown>; legacy.schemaVersion = 7; delete legacy.templates;
    expect(fresh().backup.restore(JSON.stringify(legacy))).toMatchObject({ ok: true });
  });
});

describe("exportação HTML/PDF", () => {
  function source(r: ReturnType<typeof fresh>): ExportAssetSource {
    return { media: n => r.attachments.media(n), fileName: n => r.attachments.exportInfo(n)?.fileName ?? null, annotations: n => r.pdf.listAll(n), attachmentText: n => r.attachments.exportInfo(n)?.text ?? null, transcript: n => r.attachments.exportInfo(n)?.transcript ?? null };
  }
  it("gera HTML autossuficiente sem caderno-asset, com CSP, imagens embutidas, PDF e marcações", () => {
    const r = fresh(), { note, pdf } = noteWithMedia(r);
    const linked = r.notes.create({ title: "Outra" });
    r.notes.update(note.id, { contentHtml: r.notes.get(note.id)!.contentHtml + `<p><a href="caderno-note://${linked.id}">vínculo</a> <a href="https://exemplo.com">site</a></p><script>alert(1)</script><img src="https://remoto/x.png"><p onclick="x()">clique</p>` });
    const n = r.notes.markdownOfNote(note.id)!;
    const pageUrl = `data:image/png;base64,${png.toString("base64")}`;
    const { html, warnings } = buildExportHtml({ note: { ...n, tags: [] }, format: "html", renders: new Map([[pdf.storedName, { totalPages: 2, pages: [{ page: 1, width: 10, height: 10, dataUrl: pageUrl }, { page: 2, width: 10, height: 10, dataUrl: pageUrl }] }]]), assets: source(r), fonts: { caveat: Buffer.from("font") }, appVersion: "test" });
    expect(html).toContain(`content="${EXPORT_CSP}"`);
    expect(html).not.toMatch(/caderno-(asset|note):\/\//);
    expect(html).not.toMatch(/<script|onclick|https:\/\/remoto/i);
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain('data-page="2"');
    expect(html).toContain('class="pdf-mark highlight"');
    expect(html).toContain("Cláusula");
    expect(html).toContain("Baixar PDF original");
    expect(html).toContain('@font-face{font-family:"Caveat"');
    expect(html).toContain('<input type="checkbox" checked="checked" disabled="disabled" />');
    expect(html).toContain("<table>");
    expect(html).toContain('href="https://exemplo.com"');
    expect(warnings.some(w => w.includes("Perdida"))).toBe(true);
  });
  it("no PDF representa vídeo de forma estática e lista marcações quando não há renderização", () => {
    const r = fresh(), note = r.notes.create({ title: "Mídia" });
    const video = r.attachments.save(note.id, "clipe.webm", fs.readFileSync(path.resolve("tests/fixtures/media/two-seconds.webm")));
    const pdf = r.attachments.save(note.id, "doc.pdf", pdfBytes);
    r.pdf.save({ storedName: pdf.storedName, page: 1, kind: "comment", rect: { x: .5, y: .5, width: .02, height: .02 }, comment: "Ver isto" });
    const fig = (a: typeof video, mime: string) => `<figure data-attachment-id="${a.id}" data-file-name="${a.fileName}" data-stored-name="${a.storedName}" data-mime-type="${mime}" data-byte-size="${a.byteSize}" data-caderno-attachment="true"><figcaption>${a.fileName}</figcaption></figure>`;
    r.notes.update(note.id, { contentHtml: fig(video, "video/webm") + fig(pdf, "application/pdf") });
    const n = r.notes.markdownOfNote(note.id)!;
    const { html } = buildExportHtml({ note: { ...n, tags: [] }, format: "pdf", renders: new Map(), assets: source(r), fonts: {}, appVersion: "t" });
    expect(html).not.toContain("<video");
    expect(html).toContain("clipe.webm");
    expect(html).toContain("Ver isto");
    expect(html).not.toContain("Baixar PDF original");
  });
  it("gravação atômica preserva o destino existente quando falha", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-atomic-")); cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const target = path.join(dir, "saida.pdf"); fs.writeFileSync(target, "antigo");
    fs.mkdirSync(`${target}.x.tmp`);
    expect(() => writeFileAtomic(target, "novo", "x")).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("antigo");
    writeFileAtomic(target, "novo", "y");
    expect(fs.readFileSync(target, "utf8")).toBe("novo");
    expect(fs.readdirSync(dir).filter(f => f.endsWith(".tmp") && f !== "saida.pdf.x.tmp")).toEqual([]);
  });
  it("sanitização mantém fontes, cores e alinhamento e remove estilos perigosos", () => {
    const out = sanitizeNoteHtml('<p style="text-align: center"><span style="font-family: &quot;DM Sans&quot;, sans-serif; color: #d64000; position: fixed">x</span></p><mark data-color="#fff176" style="background-color: #fff176; color: inherit">m</mark><p style="background-image:url(https://x)">y</p>');
    expect(out).toContain("text-align:center");
    expect(out).toContain("font-family");
    expect(out).toContain("color:#d64000");
    expect(out).not.toContain("position");
    expect(out).not.toContain("url(");
  });
  it("valida limites do contrato de finalização", () => {
    const token = crypto.randomUUID();
    expect(validateInput("export:finish", { token, renders: [{ storedName: "a", totalPages: 1, pages: [{ page: 1, width: 1, height: 1, dataUrl: "data:image/svg+xml;base64,AAAA" }] }] }).ok).toBe(false);
    expect(validateInput("export:finish", { token, renders: [{ storedName: "a", totalPages: 1, pages: [{ page: 1, width: 1, height: 1, dataUrl: "data:image/jpeg;base64,AAAA" }] }] }).ok).toBe(true);
    expect(validateInput("export:begin", { noteId: token, format: "docx" }).ok).toBe(false);
  });
});

void Database;
