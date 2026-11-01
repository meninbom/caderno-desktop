import { describe, expect, it } from "vitest";
import { File } from "node:buffer";
import { getSchema, Node as TipNode } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Fragment, Slice } from "@tiptap/pm/model";
import { EditorState, NodeSelection } from "@tiptap/pm/state";
import {
  MAX_ATTACHMENT_BYTES, MAX_FILES_PER_DROP, MAX_IMAGE_BYTES, blockInsertRange, buildInsertTransaction, canPreviewMime, describeDropReport, fileKindLabel,
  formatBytes, insertionCandidates, isExternalFileDrag, isRiskyToOpen, planDrop,
} from "../src/lib/note-attachments";

const Attachment = TipNode.create({ name: "attachment", group: "block", atom: true, addAttributes() { return { id: { default: 0 } }; } });
const schema = getSchema([StarterKit, Image.configure({ inline: false }), Attachment]);
const p = (text?: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
const fakeFile = (name: string, size: number) => ({ name, size, type: "" }) as unknown as globalThis.File;

describe("isExternalFileDrag", () => {
  it("aceita arrastes de arquivos do sistema", () => { expect(isExternalFileDrag({ types: ["Files"] })).toBe(true); });
  it("ignora texto, blocos internos e ausência de dados", () => {
    expect(isExternalFileDrag({ types: ["text/plain"] })).toBe(false);
    expect(isExternalFileDrag({ types: [] })).toBe(false);
    expect(isExternalFileDrag(null)).toBe(false);
  });
  it("não captura notas ou pastas da barra lateral, mesmo se Files estiver presente", () => {
    expect(isExternalFileDrag({ types: ["Files", "application/x-caderno-note", "text/plain"] })).toBe(false);
    expect(isExternalFileDrag({ types: ["application/x-caderno-folder", "Files"] })).toBe(false);
  });
});

describe("planDrop", () => {
  it("imagens PNG/JPEG/WebP viram imagem inline e o resto vira anexo", () => {
    const plan = planDrop([
      { file: fakeFile("foto.PNG", 100), directory: false }, { file: fakeFile("a.jpeg", 100), directory: false }, { file: fakeFile("b.webp", 1), directory: false },
      { file: fakeFile("doc.pdf", 100), directory: false }, { file: fakeFile("planilha.xlsx", 100), directory: false }, { file: fakeFile("anim.gif", 100), directory: false },
    ]);
    expect(plan.accepted.map(item => item.mode)).toEqual(["image", "image", "image", "file", "file", "file"]);
    expect(plan.rejected).toEqual([]);
  });
  it("respeita os limites do backend: 10 MB para imagem e 50 MB para os demais", () => {
    const plan = planDrop([
      { file: fakeFile("grande.png", MAX_IMAGE_BYTES + 1), directory: false }, { file: fakeFile("limite.png", MAX_IMAGE_BYTES), directory: false },
      { file: fakeFile("video.mp4", MAX_ATTACHMENT_BYTES + 1), directory: false }, { file: fakeFile("ok.pdf", MAX_ATTACHMENT_BYTES), directory: false },
    ]);
    expect(plan.accepted.map(item => item.file.name)).toEqual(["limite.png", "ok.pdf"]);
    expect(plan.rejected.map(item => item.name)).toEqual(["grande.png", "video.mp4"]);
    expect(plan.rejected[0].reason).toMatch(/10 MB/);
    expect(plan.rejected[1].reason).toMatch(/50 MB/);
  });
  it("recusa pastas e arquivos vazios sem derrubar os demais", () => {
    const plan = planDrop([{ file: fakeFile("pasta", 0), directory: true }, { file: fakeFile("vazio.txt", 0), directory: false }, { file: fakeFile("ok.txt", 4), directory: false }]);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.rejected.map(item => item.name)).toEqual(["pasta", "vazio.txt"]);
  });
  it("limita a quantidade por queda e informa o excedente", () => {
    const entries = Array.from({ length: MAX_FILES_PER_DROP + 3 }, (_, index) => ({ file: fakeFile(`f${index}.txt`, 1), directory: false }));
    const plan = planDrop(entries);
    expect(plan.accepted).toHaveLength(MAX_FILES_PER_DROP);
    expect(plan.ignored).toBe(3);
  });
  it("funciona com File real do Node", () => {
    const plan = planDrop([{ file: new File(["abc"], "nota.md") as unknown as globalThis.File, directory: false }]);
    expect(plan.accepted[0]).toMatchObject({ mode: "file" });
  });
});

describe("blockInsertRange / insertionCandidates", () => {
  const doc = schema.nodes.doc.create(null, [p("primeiro"), p(), p("terceiro")]);
  // posições: p1 = 0..10 (conteúdo 1..9), p2 vazio = 10..12, p3 = 12..22
  it("dentro de texto insere antes ou depois do bloco, nunca no meio da frase", () => {
    expect(blockInsertRange(doc, 4, false)).toEqual({ from: 0, to: 0 });
    expect(blockInsertRange(doc, 4, true)).toEqual({ from: 10, to: 10 });
  });
  it("parágrafo vazio é substituído", () => { expect(blockInsertRange(doc, 11, true)).toEqual({ from: 10, to: 12 }); });
  it("entre blocos usa a posição exata e limita ao documento", () => {
    expect(blockInsertRange(doc, 10, true)).toEqual({ from: 10, to: 10 });
    expect(blockInsertRange(doc, 9999, true).from).toBeLessThanOrEqual(doc.content.size);
  });
  it("candidatos incluem recuo para o fim do documento sem duplicatas", () => {
    const candidates = insertionCandidates(doc, 4, true);
    expect(candidates[0]).toEqual({ from: 10, to: 10 });
    expect(candidates.at(-1)).toEqual({ from: doc.content.size, to: doc.content.size });
    expect(new Set(candidates.map(item => `${item.from}:${item.to}`)).size).toBe(candidates.length);
  });
  it("em lista, o recuo é um bloco de nível superior (anexo não cabe como 1º filho do item)", () => {
    const list = schema.nodes.doc.create(null, [schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, p("item")))]);
    const nodes = Fragment.from([schema.nodes.attachment.create({ id: 1 })]);
    const fits = (range: { from: number; to: number }) => { try { list.replace(range.from, range.to, new Slice(nodes, 0, 0)).check(); return true; } catch { return false; } };
    const candidates = insertionCandidates(list, 4, false);
    expect(fits(candidates[0])).toBe(false);
    expect(candidates.slice(1).some(fits)).toBe(true);
  });
});

describe("buildInsertTransaction", () => {
  const att = (id: number) => schema.nodes.attachment.create({ id });
  const names = (state: EditorState) => state.doc.children.map(node => node.type.name + (node.type.name === "attachment" ? `#${node.attrs.id}` : ""));
  const stateOf = (...blocks: ReturnType<typeof p>[]) => EditorState.create({ schema, doc: schema.nodes.doc.create(null, blocks) });

  it("insere vários blocos na ordem, depois do parágrafo da queda, em uma única transação", () => {
    const state = stateOf(p("um"), p("dois"));
    const tr = buildInsertTransaction(state, [att(1), att(2)], 2, true)!;
    expect(tr.steps).toHaveLength(1);
    expect(names(state.apply(tr))).toEqual(["paragraph", "attachment#1", "attachment#2", "paragraph"]);
  });
  it("antes do bloco quando a queda está na metade superior", () => {
    const state = stateOf(p("um"), p("dois"));
    expect(names(state.apply(buildInsertTransaction(state, [att(1)], 2, false)!))).toEqual(["attachment#1", "paragraph", "paragraph"]);
  });
  it("substitui parágrafo vazio e mantém um parágrafo final editável", () => {
    const state = stateOf(p("um"), p());
    const next = state.apply(buildInsertTransaction(state, [att(1)], 5, true)!);
    expect(names(next)).toEqual(["paragraph", "attachment#1", "paragraph"]);
    expect(next.selection.$from.parent.type.name).toBe("paragraph");
  });
  it("no fim do documento sempre sobra parágrafo para continuar digitando", () => {
    const state = stateOf(p("um"));
    const next = state.apply(buildInsertTransaction(state, [att(1)], 2, true)!);
    expect(next.doc.lastChild!.type.name).toBe("paragraph");
    expect(next.selection instanceof NodeSelection).toBe(false);
  });
  it("em item de lista o schema continua válido e o anexo entra no documento", () => {
    const list = schema.nodes.bulletList.create(null, schema.nodes.listItem.create(null, p("item")));
    const state = stateOf(list as never, p("fim"));
    const next = state.apply(buildInsertTransaction(state, [att(1)], 4, false)!);
    next.doc.check();
    expect(JSON.stringify(next.doc.toJSON())).toContain('"attachment"');
    expect(next.doc.lastChild!.textContent).toBe("fim");
  });
  it("sem nós não há transação", () => { expect(buildInsertTransaction(stateOf(p("x")), [], 1, true)).toBeNull(); });
  it("posição fora do documento é limitada e ainda insere", () => {
    const state = stateOf(p("x"));
    expect(names(state.apply(buildInsertTransaction(state, [att(9)], 9999, true)!))).toContain("attachment#9");
  });
});

describe("textos", () => {
  it("formatBytes e rótulos", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5,0 MB");
    expect(formatBytes(30 * 1024 * 1024)).toBe("30 MB");
    expect(fileKindLabel("Relatório final.DOCX")).toBe("DOCX");
    expect(fileKindLabel("LEIAME")).toBe("Arquivo");
  });
  it("canPreviewMime acompanha os tipos servidos pelo protocolo de mídia", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/html", "video/webm", "video/mp4", "video/ogg", "audio/webm", "audio/mp4", "audio/ogg"]) expect(canPreviewMime(mime)).toBe(true);
    for (const mime of ["image/svg+xml", "image/gif", "application/octet-stream", "text/plain", "", undefined]) expect(canPreviewMime(mime)).toBe(false);
  });
  it("isRiskyToOpen marca executáveis e scripts", () => {
    for (const name of ["setup.exe", "run.BAT", "x.ps1", "a.js", "atalho.lnk"]) expect(isRiskyToOpen(name)).toBe(true);
    for (const name of ["foto.png", "doc.pdf", "tabela.xlsx", "exe.txt"]) expect(isRiskyToOpen(name)).toBe(false);
  });
  it("describeDropReport diferencia sucesso, sucesso parcial e falha total", () => {
    expect(describeDropReport({ saved: 1, failed: [], ignored: 0, inserted: true })).toEqual({ kind: "ok", text: "1 arquivo anexado." });
    expect(describeDropReport({ saved: 3, failed: [], ignored: 0, inserted: true }).text).toBe("3 arquivos anexados.");
    const partial = describeDropReport({ saved: 1, failed: [{ name: "a.png", reason: "imagem acima de 10 MB" }], ignored: 2, inserted: true });
    expect(partial.kind).toBe("error");
    expect(partial.text).toContain("a.png: imagem acima de 10 MB");
    expect(partial.text).toContain("2 acima do limite");
    expect(describeDropReport({ saved: 0, failed: [{ name: "x", reason: "arquivo vazio" }], ignored: 0, inserted: false }).text).toMatch(/^Não anexado — x: arquivo vazio\.$/);
    expect(describeDropReport({ saved: 2, failed: [], ignored: 0, inserted: false, refusedInsert: "não entraram no texto" }).text).toContain("não entraram no texto");
  });
});
