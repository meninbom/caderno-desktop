import { Selection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Mark, MarkType, Node as PMNode } from "@tiptap/pm/model";

/**
 * Lógica pura (sem DOM/React) do seletor de cor do texto e marca-texto.
 *
 * Cor do texto vive no mark `textStyle` (atributo `color`, junto de `fontFamily`);
 * marca-texto vive no mark `highlight` (atributo `color`, multicolor).
 * Tudo aqui opera sobre `EditorState` do ProseMirror para ser testável em Node.
 */

export type ColorKind = "text" | "highlight";

/** Marca-texto sem cor explícita (`<mark>` simples): aparece como "padrão" no seletor. */
export const DEFAULT_HIGHLIGHT = "default";

const MARK_NAME: Record<ColorKind, string> = { text: "textStyle", highlight: "highlight" };

/* ------------------------------------------------------------------ cores */

/** Aceita `#abc`, `abc`, `#AABBCC`, `aabbcc` (com espaços nas pontas). Devolve `#rrggbb` minúsculo ou null. */
export function normalizeHex(input: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  return `#${digits.length === 3 ? [...digits].map(c => c + c).join("") : digits}`;
}

/**
 * Converte o que o HTML guardado pode conter (`#rrggbb`, `#rgb`, `rgb(r, g, b)` — o navegador
 * devolve `rgb()` ao reler `style.color` — ou `rgba` opaco) para `#rrggbb`. Qualquer outra coisa → null.
 */
export function parseCssColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.startsWith("#")) return normalizeHex(text);
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(text);
  if (!rgb) return null;
  const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
  const channels = [rgb[1], rgb[2], rgb[3]].map(Number);
  if (!(alpha >= 1) || channels.some(c => c > 255)) return null;
  return `#${channels.map(c => c.toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Tinta legível (escura ou clara) sobre um fundo `#rrggbb`. */
export function readableInk(background: string): string {
  const bg = normalizeHex(background) ?? "#ffffff";
  return contrastRatio(bg, "#111111") >= contrastRatio(bg, "#ffffff") ? "#111111" : "#ffffff";
}

/* ---------------------------------------------------------------- paletas */

export interface PaletteColor { name: string; value: string }
export interface PaletteGroup { label: string; colors: PaletteColor[] }

export const TEXT_PALETTE: PaletteGroup[] = [
  { label: "Neutras", colors: [
    { name: "Preto", value: "#111111" }, { name: "Grafite", value: "#4b5563" }, { name: "Cinza", value: "#6b7280" },
    { name: "Cinza-claro", value: "#9ca3af" }, { name: "Branco", value: "#ffffff" },
  ] },
  { label: "Vivas", colors: [
    { name: "Vermelho", value: "#dc2626" }, { name: "Laranja", value: "#ea580c" }, { name: "Amarelo", value: "#ca8a04" }, { name: "Verde", value: "#16a34a" },
    { name: "Turquesa", value: "#0d9488" }, { name: "Azul", value: "#2563eb" }, { name: "Roxo", value: "#7c3aed" }, { name: "Rosa", value: "#db2777" },
  ] },
  { label: "Escuras", colors: [
    { name: "Vinho", value: "#991b1b" }, { name: "Marrom", value: "#9a3412" }, { name: "Ocre", value: "#854d0e" }, { name: "Verde-floresta", value: "#166534" },
    { name: "Verde-petróleo", value: "#115e59" }, { name: "Azul-marinho", value: "#1e3a8a" }, { name: "Violeta-escuro", value: "#5b21b6" }, { name: "Ameixa", value: "#9d174d" },
  ] },
  { label: "Suaves", colors: [
    { name: "Salmão", value: "#f87171" }, { name: "Pêssego", value: "#fb923c" }, { name: "Dourado", value: "#facc15" }, { name: "Menta", value: "#4ade80" },
    { name: "Água", value: "#2dd4bf" }, { name: "Céu", value: "#60a5fa" }, { name: "Lavanda", value: "#a78bfa" }, { name: "Rosa-claro", value: "#f472b6" },
  ] },
];

export const HIGHLIGHT_PALETTE: PaletteGroup[] = [
  { label: "Clássicos", colors: [
    { name: "Amarelo", value: "#fff176" }, { name: "Verde", value: "#bbf7d0" }, { name: "Azul", value: "#bfdbfe" }, { name: "Rosa", value: "#fbcfe8" },
    { name: "Laranja", value: "#fed7aa" }, { name: "Lilás", value: "#ddd6fe" }, { name: "Vermelho", value: "#fecaca" }, { name: "Cinza", value: "#e5e7eb" },
  ] },
  { label: "Intensos", colors: [
    { name: "Amarelo-vivo", value: "#fde047" }, { name: "Verde-vivo", value: "#86efac" }, { name: "Ciano", value: "#67e8f9" }, { name: "Rosa-vivo", value: "#f9a8d4" },
    { name: "Laranja-vivo", value: "#fdba74" }, { name: "Violeta", value: "#c4b5fd" }, { name: "Coral", value: "#fca5a5" }, { name: "Cinza-médio", value: "#cbd5e1" },
  ] },
];

export function paletteFor(kind: ColorKind): PaletteGroup[] {
  return kind === "text" ? TEXT_PALETTE : HIGHLIGHT_PALETTE;
}

/** Nome em português da cor, se ela vier da paleta; senão null (cor personalizada). */
export function colorName(kind: ColorKind, value: string): string | null {
  const hex = parseCssColor(value);
  if (!hex) return null;
  for (const group of paletteFor(kind)) {
    const found = group.colors.find(color => color.value === hex);
    if (found) return found.name;
  }
  return null;
}

/* ------------------------------------------------------- cores recentes */

export const RECENT_LIMIT = 8;
export const RECENT_STORAGE_KEYS: Record<ColorKind, string> = {
  text: "caderno.editor.recentTextColors.v1",
  highlight: "caderno.editor.recentHighlightColors.v1",
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** Coloca `value` no topo, sem duplicatas, no máximo `RECENT_LIMIT`. Entradas inválidas são descartadas. */
export function pushRecentColor(list: readonly string[], value: string): string[] {
  const hex = normalizeHex(value);
  const rest = list.map(normalizeHex).filter((item): item is string => item !== null && item !== hex);
  return (hex ? [hex, ...rest] : rest).slice(0, RECENT_LIMIT);
}

export function loadRecentColors(kind: ColorKind, storage: StorageLike | null = defaultStorage()): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(RECENT_STORAGE_KEYS[kind]) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.reduceRight<string[]>((list, item) => typeof item === "string" ? pushRecentColor(list, item) : list, []);
  } catch { return []; }
}

export function saveRecentColors(kind: ColorKind, list: readonly string[], storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(RECENT_STORAGE_KEYS[kind], JSON.stringify(list.slice(0, RECENT_LIMIT))); } catch { /* armazenamento indisponível */ }
}

/* ------------------------------------------------- leitura da seleção */

export type ColorReading =
  | { status: "none" }
  | { status: "single"; value: string }
  | { status: "mixed"; values: string[]; hasUnstyled: boolean };

/** Valor de cor presente num conjunto de marks: "" = sem cor; hex normalizado; ou o texto bruto se não for hex/rgb. */
function colorOfMarks(marks: readonly Mark[], kind: ColorKind): string {
  const mark = marks.find(m => m.type.name === MARK_NAME[kind]);
  if (!mark) return "";
  const raw = mark.attrs.color;
  if (typeof raw !== "string" || !raw.trim()) return kind === "highlight" ? DEFAULT_HIGHLIGHT : "";
  return parseCssColor(raw) ?? raw.trim().toLowerCase();
}

export function readColors(state: EditorState, kind: ColorKind): ColorReading {
  const { selection } = state;
  const found = new Set<string>();
  if (selection.empty) {
    found.add(colorOfMarks(state.storedMarks ?? selection.$from.marks(), kind));
  } else {
    for (const { $from, $to } of selection.ranges) {
      state.doc.nodesBetween($from.pos, $to.pos, node => {
        if (node.isText) found.add(colorOfMarks(node.marks, kind));
      });
    }
  }
  const hasUnstyled = found.delete("");
  const values = [...found];
  if (values.length === 0) return { status: "none" };
  if (values.length === 1 && !hasUnstyled) return { status: "single", value: values[0] };
  return { status: "mixed", values, hasUnstyled };
}

/** Há onde aplicar? Falso em bloco de código, em código inline e em seleção sem texto (ex.: só uma imagem). */
export function canStyleSelection(state: EditorState, kind: ColorKind): boolean {
  const type = state.schema.marks[MARK_NAME[kind]];
  if (!type) return false;
  const { selection } = state;
  if (selection.empty) {
    const marks = state.storedMarks ?? selection.$from.marks();
    return selection.$from.parent.type.allowsMarkType(type) && (!!type.isInSet(marks) || !marks.some(m => m.type.excludes(type)));
  }
  let ok = false;
  for (const { $from, $to } of selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, _pos, parent) => {
      if (ok) return false;
      if (node.isText && parent?.type.allowsMarkType(type) && (!!type.isInSet(node.marks) || !node.marks.some(m => m.type.excludes(type)))) ok = true;
      return !ok;
    });
  }
  return ok;
}

/* ----------------------------------------------- captura e aplicação */

/** Instantâneo da seleção no momento em que o popup abre; o foco pode sair do editor depois. */
export interface SelectionSnapshot {
  doc: PMNode;
  selection: Record<string, unknown>;
  empty: boolean;
}

export function captureSelection(state: EditorState): SelectionSnapshot {
  return { doc: state.doc, selection: state.selection.toJSON() as Record<string, unknown>, empty: state.selection.empty };
}

export type ApplyResult =
  | { ok: true; tr: Transaction }
  | { ok: false; reason: "doc-changed" | "invalid-color" | "unsupported" };

const isEmptyAttrs = (attrs: Record<string, unknown>) => Object.values(attrs).every(v => v == null || v === "");

/**
 * Monta a transação que aplica `value` (hex) ou remove a cor (`null`) no instantâneo.
 * - Seleção com texto: preserva os demais atributos de `textStyle` (fontFamily) por trecho e todos os outros marks.
 * - Cursor sem seleção: só define marks armazenados (próximas letras).
 * - Se o documento mudou desde a captura, recusa em vez de aplicar um intervalo antigo.
 */
export function buildColorTransaction(state: EditorState, snapshot: SelectionSnapshot, kind: ColorKind, value: string | null): ApplyResult {
  const hex = value === null ? null : normalizeHex(value);
  if (value !== null && !hex) return { ok: false, reason: "invalid-color" };
  if (state.doc !== snapshot.doc) return { ok: false, reason: "doc-changed" };
  const type: MarkType | undefined = state.schema.marks[MARK_NAME[kind]];
  if (!type) return { ok: false, reason: "unsupported" };

  let selection: Selection;
  try { selection = Selection.fromJSON(state.doc, snapshot.selection); } catch { return { ok: false, reason: "doc-changed" }; }
  const tr = state.tr.setSelection(selection);

  if (selection.empty) {
    // setSelection zera os marks armazenados: recalcula o conjunto inteiro (negrito pendente etc. continua valendo).
    const current = state.storedMarks ?? selection.$from.marks();
    if (kind === "highlight") {
      tr.setStoredMarks(hex ? type.create({ color: hex }).addToSet(current) : type.removeFromSet(current));
    } else {
      const attrs = { ...(current.find(m => m.type === type)?.attrs ?? {}), color: hex };
      tr.setStoredMarks(isEmptyAttrs(attrs) ? type.removeFromSet(current) : type.create(attrs).addToSet(current));
    }
    return { ok: true, tr };
  }

  for (const { $from, $to } of selection.ranges) {
    const from = $from.pos, to = $to.pos;
    if (kind === "highlight") {
      if (hex) tr.addMark(from, to, type.create({ color: hex })); else tr.removeMark(from, to, type);
      continue;
    }
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      const start = Math.max(pos, from), end = Math.min(pos + node.nodeSize, to);
      if (start >= end) return;
      const old = node.marks.find(m => m.type === type);
      const attrs = { ...(old?.attrs ?? {}), color: hex };
      if (isEmptyAttrs(attrs)) { if (old) tr.removeMark(start, end, old); }
      else if (!old || old.attrs.color !== hex) tr.addMark(start, end, type.create(attrs));
    });
  }
  return { ok: true, tr };
}
