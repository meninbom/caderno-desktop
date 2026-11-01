/**
 * Personalização de cadernos: ícone, cor de destaque, descrição curta e
 * "etiquetas do caderno".
 *
 * As etiquetas do caderno NÃO são as tags das notas (tabela `tags`): elas só
 * servem para agrupar/encontrar cadernos e vivem na própria linha do caderno.
 * Este módulo é puro (sem Node/DOM) para ser usado por main, renderer e testes.
 */

export const NOTEBOOK_DEFAULT_ICON = "book";
export const NOTEBOOK_DESCRIPTION_MAX = 140;
export const NOTEBOOK_LABEL_MAX = 32;
export const NOTEBOOK_LABELS_MAX = 12;

/** Ícones disponíveis (nomes estáveis; o renderer mapeia para lucide). */
export const NOTEBOOK_ICON_PRESETS = [
  "book", "briefcase", "home", "graduation-cap", "lightbulb", "code",
  "flask-conical", "heart", "star", "music", "camera", "plane",
  "shopping-cart", "wallet", "leaf", "rocket", "palette", "gamepad",
  "utensils", "dumbbell", "globe", "lock",
] as const;
export type NotebookIconPreset = (typeof NOTEBOOK_ICON_PRESETS)[number];

/** Cores sugeridas (todas aceitam tinta preta ou branca com contraste >= 4,5:1). */
export const NOTEBOOK_COLOR_PRESETS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#4f46e5", "#7c3aed", "#ec4899", "#64748b",
] as const;

export const NOTEBOOK_EMOJI_SUGGESTIONS = ["📓", "📚", "💡", "🎯", "🌱", "🧪", "🏠", "✈️"] as const;

export interface NotebookCustomization {
  /** Nome de preset ("briefcase") ou "emoji:<emoji>". */
  icon: string;
  /** #rrggbb em minúsculas ou null (sem acento). */
  color: string | null;
  description: string;
  labels: string[];
}

export const DEFAULT_NOTEBOOK_CUSTOMIZATION: Readonly<NotebookCustomization> = Object.freeze({
  icon: NOTEBOOK_DEFAULT_ICON, color: null, description: "", labels: [],
}) as NotebookCustomization;

export function defaultNotebookCustomization(): NotebookCustomization {
  return { icon: NOTEBOOK_DEFAULT_ICON, color: null, description: "", labels: [] };
}

const presetSet: ReadonlySet<string> = new Set(NOTEBOOK_ICON_PRESETS);
export const isNotebookIconPreset = (value: unknown): value is NotebookIconPreset => typeof value === "string" && presetSet.has(value);

// ---------------------------------------------------------------- emoji seguro
const EMOJI_CODE_POINT = /^[\p{Extended_Pictographic}\p{Emoji_Component}]$/u;
const KEYCAP = String.fromCodePoint(0x20e3);
const EMOJI_CORE = /\p{Extended_Pictographic}|\p{Regional_Indicator}{2}/u;

function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), part => part.segment);
  return Array.from(text);
}

/** Retorna um único emoji válido (um grafema) ou null. Nunca devolve markup. */
export function normalizeNotebookEmoji(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.normalize("NFC").trim();
  if (!value || value.length > 32) return null;
  if (graphemes(value).length !== 1) return null;
  for (const point of value) if (!EMOJI_CODE_POINT.test(point)) return null;
  return EMOJI_CORE.test(value) || value.includes(KEYCAP) ? value : null;
}

export type ParsedNotebookIcon = { kind: "preset"; name: NotebookIconPreset } | { kind: "emoji"; value: string };

export function isValidNotebookIcon(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (isNotebookIconPreset(value)) return true;
  return value.startsWith("emoji:") && normalizeNotebookEmoji(value.slice(6)) !== null;
}

export function parseNotebookIcon(value: unknown): ParsedNotebookIcon {
  if (isNotebookIconPreset(value)) return { kind: "preset", name: value };
  if (typeof value === "string" && value.startsWith("emoji:")) {
    const emoji = normalizeNotebookEmoji(value.slice(6));
    if (emoji) return { kind: "emoji", value: emoji };
  }
  return { kind: "preset", name: NOTEBOOK_DEFAULT_ICON };
}

/** Normalização tolerante (leitura do banco/backup antigo): inválido vira o ícone padrão. */
export function normalizeNotebookIcon(value: unknown): string {
  const parsed = parseNotebookIcon(value);
  return parsed.kind === "emoji" ? `emoji:${parsed.value}` : parsed.name;
}

export const notebookEmojiIcon = (emoji: string): string | null => {
  const clean = normalizeNotebookEmoji(emoji);
  return clean ? `emoji:${clean}` : null;
};

// ------------------------------------------------------------------- cor/texto
export function normalizeNotebookColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

const cp = (code: number) => String.fromCodePoint(code);
// C0/C1, separadores de linha/parágrafo, marcas de largura zero e controles bidirecionais.
const CONTROL_CHARS = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${cp(0x2028)}${cp(0x2029)}${cp(0x200b)}-${cp(0x200f)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0xfeff)}]`, "g");

export function normalizeNotebookDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, NOTEBOOK_DESCRIPTION_MAX);
}

export function normalizeNotebookLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().replace(/^#+\s*/, "").trim().slice(0, NOTEBOOK_LABEL_MAX).trim();
}

/** Chave de comparação/busca: minúsculas, sem acentos. */
export function notebookLabelKey(value: string): string {
  return normalizeNotebookLabel(value).toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
}

/** Limpa, remove duplicadas (sem diferenciar caixa/acento) e limita a quantidade. */
export function normalizeNotebookLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(), result: string[] = [];
  for (const item of value) {
    const label = normalizeNotebookLabel(item), key = notebookLabelKey(label);
    if (!label || seen.has(key)) continue;
    seen.add(key); result.push(label);
    if (result.length >= NOTEBOOK_LABELS_MAX) break;
  }
  return result;
}

/** Normaliza qualquer entrada desconhecida (banco, backup antigo) para um estado consistente. */
export function sanitizeNotebookCustomization(raw: { icon?: unknown; color?: unknown; description?: unknown; labels?: unknown } | null | undefined): NotebookCustomization {
  return {
    icon: normalizeNotebookIcon(raw?.icon),
    color: normalizeNotebookColor(raw?.color),
    description: normalizeNotebookDescription(raw?.description),
    labels: normalizeNotebookLabels(raw?.labels),
  };
}

export function parseStoredLabels(json: unknown): string[] {
  if (typeof json !== "string" || !json) return [];
  try { return normalizeNotebookLabels(JSON.parse(json)); } catch { return []; }
}

export function isDefaultNotebookCustomization(value: Partial<NotebookCustomization>): boolean {
  return (value.icon ?? NOTEBOOK_DEFAULT_ICON) === NOTEBOOK_DEFAULT_ICON && (value.color ?? null) === null
    && (value.description ?? "") === "" && (value.labels ?? []).length === 0;
}

export function sameNotebookCustomization(a: NotebookCustomization, b: NotebookCustomization): boolean {
  return a.icon === b.icon && a.color === b.color && a.description === b.description
    && a.labels.length === b.labels.length && a.labels.every((label, index) => label === b.labels[index]);
}

/** Campos ausentes preservam o valor atual; `color: null` remove o acento. */
export interface CustomizeNotebookInput {id:number;icon?:string;color?:string|null;description?:string;labels?:string[]}

// -------------------------------------------------------------------- contraste
function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
export function relativeLuminance(hex: string): number {
  const color = normalizeNotebookColor(hex) ?? "#000000";
  return 0.2126 * channel(parseInt(color.slice(1, 3), 16)) + 0.7152 * channel(parseInt(color.slice(3, 5), 16)) + 0.0722 * channel(parseInt(color.slice(5, 7), 16));
}
export function contrastRatio(a: string, b: string): number {
  const x = relativeLuminance(a), y = relativeLuminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Tinta (preto/branco) com maior contraste sobre a cor de destaque. */
export function readableInk(background: string): "#000000" | "#ffffff" {
  return contrastRatio(background, "#000000") >= contrastRatio(background, "#ffffff") ? "#000000" : "#ffffff";
}

// ----------------------------------------------------------------------- filtro
export interface NotebookLike { name: string; description?: string; labels?: string[] }

/** Chave de busca normalizada (minúsculas, sem acentos). */
export function notebookSearchKey(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "").trim();
}

/**
 * Cada termo (separado por espaço) precisa casar com nome, descrição ou alguma
 * etiqueta. Prefixo `#` restringe o termo às etiquetas do caderno.
 */
export function notebookMatchesFilter(notebook: NotebookLike, query: string): boolean {
  const terms = notebookSearchKey(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const name = notebookSearchKey(notebook.name), description = notebookSearchKey(notebook.description ?? ""), labels = (notebook.labels ?? []).map(notebookSearchKey);
  return terms.every(term => term.startsWith("#")
    ? term.length > 1 && labels.some(label => label.includes(term.slice(1)))
    : name.includes(term) || description.includes(term) || labels.some(label => label.includes(term)));
}

/** Etiquetas distintas com contagem de cadernos, mais usadas primeiro. */
export function collectNotebookLabels(notebooks: readonly { labels?: string[] }[]): { label: string; count: number }[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const notebook of notebooks) for (const label of notebook.labels ?? []) {
    const key = notebookLabelKey(label), found = map.get(key);
    if (found) found.count++; else map.set(key, { label, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));
}

/** Reaproveita a identidade de cadernos inalterados (evita re-render da árvore inteira). */
export function shareNotebooks<T extends { id: number; name: string; createdAt: number; noteCount: number } & NotebookCustomization>(previous: readonly T[], next: readonly T[]): readonly T[] {
  const byId = new Map(previous.map(item => [item.id, item]));
  let changed = previous.length !== next.length;
  const merged = next.map((item, index) => {
    const old = byId.get(item.id);
    const same = old && old.name === item.name && old.createdAt === item.createdAt && old.noteCount === item.noteCount && sameNotebookCustomization(old, item);
    if (!same || previous[index] !== old) changed = true;
    return same ? old : item;
  });
  return changed ? merged : previous;
}
