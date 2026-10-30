import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import CodeBlock from "@tiptap/extension-code-block";
import Link from "@tiptap/extension-link";
import Color from "@tiptap/extension-color";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NoteTextStyle } from "../src/editor/fonts";
import { NoteHighlight } from "../src/editor/highlight";
import {
  DEFAULT_HIGHLIGHT, HIGHLIGHT_PALETTE, RECENT_LIMIT, RECENT_STORAGE_KEYS, TEXT_PALETTE, buildColorTransaction, canStyleSelection,
  captureSelection, colorName, loadRecentColors, normalizeHex, parseCssColor, pushRecentColor, readColors, readableInk, saveRecentColors,
} from "../src/editor/text-colors";
import { sanitizeNoteHtml } from "../electron/repo/note-html";
import type { ColorKind } from "../src/editor/text-colors";

// Mesmos marks de buildNoteExtensions.
const schema = getSchema([Document, Paragraph, Text, Bold, Code, CodeBlock, Link, NoteHighlight, NoteTextStyle, Color]);
const FONT = "Georgia, serif";

type Seg = { text: string; marks?: object[] };
const style = (attrs: Record<string, unknown>) => ({ type: "textStyle", attrs: { color: null, fontFamily: null, ...attrs } });
const bold = { type: "bold" };
const link = { type: "link", attrs: { href: "https://exemplo.com" } };
const make = (segs: Seg[]) => schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: segs.map(s => ({ type: "text", text: s.text, marks: s.marks ?? [] })) }] });
const stateAt = (doc: PMNode, from: number, to = from) => EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to) });

function apply(state: EditorState, kind: ColorKind, value: string | null) {
  const result = buildColorTransaction(state, captureSelection(state), kind, value);
  if (!result.ok) throw new Error(result.reason);
  return state.apply(result.tr);
}
function texts(doc: PMNode) {
  const out: { text: string; marks: Record<string, Record<string, unknown>> }[] = [];
  doc.descendants(node => { if (node.isText) out.push({ text: node.text!, marks: Object.fromEntries(node.marks.map(m => [m.type.name, m.attrs])) }); });
  return out;
}

describe("normalizeHex / parseCssColor", () => {
  it.each([["#D64000", "#d64000"], ["d64000", "#d64000"], ["  #1bd ", "#11bbdd"], ["ABC", "#aabbcc"]])("aceita %s", (input, expected) => expect(normalizeHex(input)).toBe(expected));
  it.each(["", "#", "#12", "#1234", "#12345", "#1234567", "#gggggg", "red", "#12 34 56", "rgb(1,2,3)", "##abc"])("recusa %j", input => expect(normalizeHex(input)).toBeNull());

  it("lê o rgb() que o navegador devolve ao reler style.color, mas não inventa alfa", () => {
    expect(parseCssColor("rgb(214, 64, 0)")).toBe("#d64000");
    expect(parseCssColor("rgba(255, 241, 118, 1)")).toBe("#fff176");
    expect(parseCssColor("rgba(255, 241, 118, 0.5)")).toBeNull();
    expect(parseCssColor("rgb(300, 0, 0)")).toBeNull();
    expect(parseCssColor("red")).toBeNull();
    expect(parseCssColor(null)).toBeNull();
  });
});

describe("paletas e nomes", () => {
  it("só tem hex válido, sem repetição dentro de cada tipo, e nomes em português", () => {
    for (const palette of [TEXT_PALETTE, HIGHLIGHT_PALETTE]) {
      const all = palette.flatMap(group => group.colors);
      expect(all.every(c => normalizeHex(c.value) === c.value && c.name.length > 1)).toBe(true);
      expect(new Set(all.map(c => c.value)).size).toBe(all.length);
    }
    expect(colorName("text", "rgb(220, 38, 38)")).toBe("Vermelho");
    expect(colorName("highlight", "#FFF176")).toBe("Amarelo");
    expect(colorName("text", "#123456")).toBeNull();
  });

  it("escolhe tinta legível para marca-texto claro e escuro", () => {
    expect(readableInk("#fff176")).toBe("#111111");
    expect(readableInk("#1e3a8a")).toBe("#ffffff");
  });
});

describe("cores recentes", () => {
  it("move repetidas para o topo, normaliza e limita a 8", () => {
    let list: string[] = [];
    for (const hex of ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777", "#888888", "#999999"]) list = pushRecentColor(list, hex);
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]).toBe("#999999");
    expect(list).not.toContain("#111111");
    expect(pushRecentColor(list, "444")).toEqual(["#444444", "#999999", "#888888", "#777777", "#666666", "#555555", "#333333", "#222222"]);
    expect(pushRecentColor(list, "não é cor")).toEqual(list);
  });

  it("usa chaves próprias por tipo, descarta lixo salvo e sobrevive a armazenamento quebrado", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    saveRecentColors("text", ["#d64000", "#2563eb"], storage);
    expect(RECENT_STORAGE_KEYS.text).not.toBe(RECENT_STORAGE_KEYS.highlight);
    expect(loadRecentColors("highlight", storage)).toEqual([]);
    data.set(RECENT_STORAGE_KEYS.highlight, JSON.stringify(["#FFF176", 7, "xyz", "#fff176", "bbf7d0"]));
    expect(loadRecentColors("highlight", storage)).toEqual(["#fff176", "#bbf7d0"]);
    data.set(RECENT_STORAGE_KEYS.text, "{quebrado");
    expect(loadRecentColors("text", storage)).toEqual([]);
    expect(loadRecentColors("text", { getItem: () => { throw new Error("bloqueado"); }, setItem: () => undefined })).toEqual([]);
    expect(() => saveRecentColors("text", ["#111111"], { getItem: () => null, setItem: () => { throw new Error("cheio"); } })).not.toThrow();
  });
});

describe("leitura da seleção", () => {
  const doc = make([
    { text: "Alpha ", marks: [style({ color: "#d64000" })] },
    { text: "Beta ", marks: [style({ color: "rgb(37, 99, 235)" })] },
    { text: "Gamma" },
  ]);

  it("cor única, inclusive quando o HTML guardou rgb() e hex da mesma cor", () => {
    expect(readColors(stateAt(doc, 1, 6), "text")).toEqual({ status: "single", value: "#d64000" });
    const same = make([{ text: "a", marks: [style({ color: "rgb(214, 64, 0)" })] }, { text: "b", marks: [style({ color: "#D64000" })] }]);
    expect(readColors(stateAt(same, 1, 3), "text")).toEqual({ status: "single", value: "#d64000" });
  });

  it("várias cores ou trecho sem cor vira estado misto, nunca uma cor única", () => {
    const mixed = readColors(stateAt(doc, 1, 12), "text");
    expect(mixed).toEqual({ status: "mixed", values: ["#d64000", "#2563eb"], hasUnstyled: false });
    const partial = readColors(stateAt(doc, 1, 17), "text");
    expect(partial).toMatchObject({ status: "mixed", hasUnstyled: true });
    expect(readColors(stateAt(doc, 12, 17), "text")).toEqual({ status: "none" });
  });

  it("cursor lê marks armazenados antes dos marks do texto, e fontFamily sozinha não conta como cor", () => {
    const fontOnly = make([{ text: "abc", marks: [style({ fontFamily: FONT })] }]);
    expect(readColors(stateAt(fontOnly, 2), "text")).toEqual({ status: "none" });
    const colored = stateAt(doc, 3);
    expect(readColors(colored, "text")).toEqual({ status: "single", value: "#d64000" });
    const stored = colored.apply(colored.tr.setStoredMarks([]));
    expect(readColors(stored, "text")).toEqual({ status: "none" });
  });

  it("marca-texto sem cor explícita aparece como padrão", () => {
    const plain = make([{ text: "abc", marks: [{ type: "highlight", attrs: { color: null } }] }]);
    expect(readColors(stateAt(plain, 1, 4), "highlight")).toEqual({ status: "single", value: DEFAULT_HIGHLIGHT });
  });
});

describe("aplicação sobre a seleção capturada", () => {
  const doc = make([
    { text: "Alpha ", marks: [style({ fontFamily: FONT })] },
    { text: "Beta ", marks: [bold, style({ color: "#2563eb", fontFamily: "Arial, sans-serif" })] },
    { text: "Gamma", marks: [link] },
  ]);

  it("mescla cor em trechos com fontes diferentes sem tocar em fonte, negrito nem link", () => {
    const next = apply(stateAt(doc, 1, 17), "text", "#D64000");
    const [alpha, beta, gamma] = texts(next.doc);
    expect(alpha.marks.textStyle).toMatchObject({ color: "#d64000", fontFamily: FONT });
    expect(beta.marks.textStyle).toMatchObject({ color: "#d64000", fontFamily: "Arial, sans-serif" });
    expect(beta.marks.bold).toBeDefined();
    expect(gamma.marks.textStyle).toMatchObject({ color: "#d64000", fontFamily: null });
    expect(gamma.marks.link).toMatchObject({ href: "https://exemplo.com" });
  });

  it("restaura a cor padrão: mantém a fonte e remove o textStyle que ficou vazio", () => {
    const colored = apply(stateAt(doc, 1, 17), "text", "#d64000");
    const reset = apply(stateAt(colored.doc, 1, 17), "text", null);
    const [alpha, beta, gamma] = texts(reset.doc);
    expect(alpha.marks.textStyle).toEqual({ color: null, fontFamily: FONT, fontSize: null });
    expect(beta.marks.textStyle).toEqual({ color: null, fontFamily: "Arial, sans-serif", fontSize: null });
    expect(gamma.marks.textStyle).toBeUndefined();
    expect(beta.marks.bold).toBeDefined();
  });

  it("aplica só ao trecho selecionado e permite várias cores na mesma nota", () => {
    const plain = make([{ text: "Alpha Beta Gamma" }]);
    let state = apply(stateAt(plain, 1, 6), "text", "#dc2626");
    state = apply(stateAt(state.doc, 7, 11), "text", "#2563eb");
    expect(texts(state.doc).map(t => [t.text, t.marks.textStyle?.color ?? null])).toEqual([["Alpha", "#dc2626"], [" ", null], ["Beta", "#2563eb"], [" Gamma", null]]);
    expect(readColors(stateAt(state.doc, 1, 17), "text")).toMatchObject({ status: "mixed", values: ["#dc2626", "#2563eb"], hasUnstyled: true });
  });

  it("restaura a seleção capturada explicitamente, mesmo se o estado atual perdeu a seleção", () => {
    const snapshotState = stateAt(doc, 3, 9);
    const snapshot = captureSelection(snapshotState);
    const moved = snapshotState.apply(snapshotState.tr.setSelection(TextSelection.create(doc, 15)));
    const result = buildColorTransaction(moved, snapshot, "text", "#16a34a");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([result.tr.selection.from, result.tr.selection.to]).toEqual([3, 9]);
      const green = texts(moved.apply(result.tr).doc).filter(t => t.marks.textStyle?.color === "#16a34a").map(t => t.text);
      expect(green).toEqual(["pha ", "Be"]);
    }
  });

  it("sem seleção só define marks armazenados, preservando a fonte do cursor, e não altera a nota", () => {
    const state = stateAt(doc, 3);
    const result = buildColorTransaction(state, captureSelection(state), "text", "#7c3aed");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tr.docChanged).toBe(false);
    const stored = result.tr.storedMarks?.find(m => m.type.name === "textStyle");
    expect(stored?.attrs).toMatchObject({ color: "#7c3aed", fontFamily: FONT });
    expect(readColors(state.apply(result.tr), "text")).toEqual({ status: "single", value: "#7c3aed" });
    // restaurar a cor do cursor sobra só a fonte; sem fonte, não sobra mark algum
    const afterReset = state.apply(result.tr);
    const reset = buildColorTransaction(afterReset, captureSelection(afterReset), "text", null);
    expect(reset.ok && reset.tr.storedMarks?.find(m => m.type.name === "textStyle")?.attrs).toMatchObject({ color: null, fontFamily: FONT });
    const bare = stateAt(make([{ text: "abc" }]), 2);
    const bareStored = apply(bare, "text", "#dc2626");
    const bareReset = buildColorTransaction(bareStored, captureSelection(bareStored), "text", null);
    expect(bareReset.ok && bareReset.tr.storedMarks?.some(m => m.type.name === "textStyle")).toBe(false);
  });

  it("cor no cursor não perde marks pendentes (negrito acionado antes de escolher a cor)", () => {
    const base = stateAt(make([{ text: "abc" }]), 2);
    const pending = base.apply(base.tr.addStoredMark(schema.marks.bold.create()));
    const next = apply(pending, "text", "#dc2626");
    expect(next.storedMarks?.map(m => m.type.name).sort()).toEqual(["bold", "textStyle"]);
    const highlighted = apply(next, "highlight", "#fff176");
    expect(highlighted.storedMarks?.map(m => m.type.name).sort()).toEqual(["bold", "highlight", "textStyle"]);
  });

  it("recusa aplicar se a nota mudou depois da captura, e recusa cor inválida", () => {
    const state = stateAt(doc, 1, 6);
    const snapshot = captureSelection(state);
    const edited = state.apply(state.tr.insertText("X", 1));
    expect(buildColorTransaction(edited, snapshot, "text", "#dc2626")).toEqual({ ok: false, reason: "doc-changed" });
    for (const bad of ["red", "#12", "", "javascript:alert(1)", "#ff0000; background:url(x)"]) {
      expect(buildColorTransaction(state, snapshot, "text", bad)).toEqual({ ok: false, reason: "invalid-color" });
    }
    expect(state.doc).toBe(snapshot.doc);
  });

  it("marca-texto: troca a cor, remove sem afetar cor do texto, e vale como mark armazenado no cursor", () => {
    let state = apply(stateAt(doc, 1, 17), "text", "#d64000");
    state = apply(stateAt(state.doc, 1, 12), "highlight", "#FFF176");
    state = apply(stateAt(state.doc, 7, 12), "highlight", "#bfdbfe");
    expect(texts(state.doc).map(t => t.marks.highlight?.color ?? null)).toEqual(["#fff176", "#bfdbfe", null]);
    expect(readColors(stateAt(state.doc, 1, 12), "highlight")).toMatchObject({ status: "mixed", values: ["#fff176", "#bfdbfe"] });
    const removed = apply(stateAt(state.doc, 1, 17), "highlight", null);
    expect(texts(removed.doc).every(t => !t.marks.highlight && t.marks.textStyle?.color === "#d64000")).toBe(true);

    const cursor = stateAt(doc, 3);
    const stored = apply(cursor, "highlight", "#fde047");
    expect(stored.storedMarks?.find(m => m.type.name === "highlight")?.attrs.color).toBe("#fde047");
    expect(stored.doc).toBe(cursor.doc);
  });

  it("não colore código inline nem bloco de código, e o seletor fica indisponível ali", () => {
    const inline = make([{ text: "const x", marks: [{ type: "code" }] }]);
    const state = stateAt(inline, 1, 8);
    expect(canStyleSelection(state, "text")).toBe(false);
    expect(texts(apply(state, "text", "#dc2626").doc)[0].marks.textStyle).toBeUndefined();

    const block = schema.nodeFromJSON({ type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "let a" }] }] });
    expect(canStyleSelection(stateAt(block, 1, 4), "text")).toBe(false);
    expect(canStyleSelection(stateAt(block, 2), "highlight")).toBe(false);
    expect(canStyleSelection(stateAt(doc, 1, 4), "text")).toBe(true);
    expect(canStyleSelection(stateAt(doc, 3), "highlight")).toBe(true);
  });
});

describe("marcação HTML gerada (base da exportação)", () => {
  const dom = (name: string, attrs: Record<string, unknown>) => {
    const mark = schema.marks[name].create(attrs);
    return (schema.marks[name].spec.toDOM as (m: typeof mark, inline: boolean) => [string, Record<string, string>, number])(mark, true);
  };

  it("cor e fonte saem no mesmo <span style>; marca-texto sai como <mark> com data-color e background-color", () => {
    const [tag, attrs] = dom("textStyle", { color: "#d64000", fontFamily: FONT });
    expect(tag).toBe("span");
    expect(attrs.style).toContain("color: #d64000");
    expect(attrs.style).toContain(`font-family: ${FONT}`);

    const [markTag, markAttrs] = dom("highlight", { color: "#1e3a8a" });
    expect(markTag).toBe("mark");
    expect(markAttrs["data-color"]).toBe("#1e3a8a");
    expect(markAttrs.style).toBe("background-color: #1e3a8a; color: #ffffff");
  });

  it("font-size é renderizado, lido do HTML e preservado pelo sanitizador", () => {
    const [tag, attrs] = dom("textStyle", { fontSize: "24px" });
    expect(tag).toBe("span");
    expect(attrs.style).toContain("font-size: 24px");
    const element = { style: { fontSize: "24px" } } as HTMLElement;
    const fontSize = NoteTextStyle.config.addAttributes?.call({ parent: () => ({}) } as never)?.fontSize;
    expect(fontSize?.parseHTML?.(element)).toBe("24px");
    expect(sanitizeNoteHtml('<p><span style="font-size: 24px">grande</span></p>')).toContain("font-size:24px");
    expect(sanitizeNoteHtml('<p><span style="font-size: 999px">fora</span></p>')).not.toContain("font-size");
  });

  it("o sanitizador da exportação mantém cor, fonte, fundo e data-color (hex e rgb() relido do navegador)", () => {
    const html = '<p><span style="color: #d64000; font-family: Georgia, serif"><mark data-color="#fff176" style="background-color: #fff176; color: inherit">a</mark></span> <span style="color: rgb(37, 99, 235)">b</span><mark data-color="rgb(187, 247, 208)" style="background-color: rgb(187, 247, 208); color: inherit">c</mark></p>';
    const out = sanitizeNoteHtml(html);
    expect(out).toContain("color:#d64000");
    expect(out).toContain("font-family:Georgia, serif");
    expect(out).toContain('data-color="#fff176"');
    expect(out).toContain("background-color:#fff176");
    expect(out).toContain("color:rgb(37, 99, 235)");
    expect(out).toContain("background-color:rgb(187, 247, 208)");
    expect(sanitizeNoteHtml('<span style="color: red; background: url(x)">z</span>')).not.toContain("url(");
  });

  it("o span de textStyle envolve o <mark> (premissa do CSS span[style*=color] > mark do seletor)", () => {
    const order = Object.keys(schema.marks);
    expect(order.indexOf("textStyle")).toBeLessThan(order.indexOf("highlight"));
  });
});
