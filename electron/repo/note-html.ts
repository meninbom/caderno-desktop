/**
 * Utilitários de HTML de nota usados por modelos e exportação.
 * O HTML vem do TipTap (atributos sempre entre aspas), mas tudo que sai daqui
 * para outra superfície (prévia de modelo, HTML/PDF exportado) passa por
 * sanitize-html com lista de permissões fechada.
 */
import sanitizeHtml from "sanitize-html";

export const TEMPLATE_ASSET_SCHEME = "caderno-template-asset://";
export const NOTE_ASSET_SCHEME = "caderno-asset://";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_m, code: string) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "nbsp") return " ";
    const n = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
  });
}

export function parseAttributes(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ""));
  return out;
}

export function serializeAttributes(attrs: Map<string, string>): string {
  return [...attrs].map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join("");
}

export type MediaRef =
  | { type: "image"; src: string; attrs: Map<string, string>; raw: string }
  | { type: "attachment"; storedName: string; attrs: Map<string, string>; raw: string };

const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*)`;
const MEDIA_RE = new RegExp(`<figure\\b${ATTRS}>([\\s\\S]*?)<\\/figure\\s*>|<img\\b${ATTRS}\\/?>`, "gi");

/**
 * Percorre imagens e blocos de anexo do HTML e permite substituir cada um.
 * Retornar `null` remove o elemento; retornar `undefined` mantém o original.
 */
export function mapMedia(html: string, fn: (ref: MediaRef) => string | null | undefined): string {
  return html.replace(MEDIA_RE, (raw, figureAttrs: string | undefined, figureInner: string | undefined, imgAttrs: string | undefined) => {
    if (figureAttrs !== undefined) {
      const attrs = parseAttributes(figureAttrs);
      if (!attrs.has("data-caderno-attachment")) return `<figure${figureAttrs}>${mapMedia(figureInner ?? "", fn)}</figure>`;
      const result = fn({ type: "attachment", storedName: attrs.get("data-stored-name") ?? "", attrs, raw });
      return result === undefined ? raw : result ?? "";
    }
    const attrs = parseAttributes(imgAttrs ?? "");
    const result = fn({ type: "image", src: attrs.get("src") ?? "", attrs, raw });
    return result === undefined ? raw : result ?? "";
  });
}

/** Nomes internos referenciados (imagens caderno-asset:// e blocos de anexo), sem duplicatas. */
export function collectAssetRefs(html: string): string[] {
  const names = new Set<string>();
  mapMedia(html, ref => {
    if (ref.type === "image" && ref.src.startsWith(NOTE_ASSET_SCHEME)) names.add(ref.src.slice(NOTE_ASSET_SCHEME.length));
    if (ref.type === "attachment" && ref.storedName) names.add(ref.storedName);
    return undefined;
  });
  return [...names];
}

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+\s*)?\)$/i, /^[a-z]{3,20}$/i];
const STYLE_RULES: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": {
    color: COLOR,
    "background-color": COLOR,
    "font-family": [/^[\w\s"',.-]{1,200}$/],
    "text-align": [/^(left|right|center|justify)$/],
    "min-width": [/^\d{1,5}(\.\d+)?px$/],
    width: [/^\d{1,5}(\.\d+)?(px|%)$/],
  },
};

/**
 * Sanitiza HTML de nota para exibição fora do editor. Mantém formatação do
 * TipTap (títulos, listas, checklists, tabelas, fontes, cores) e as
 * referências internas de mídia para que o chamador as resolva.
 */
export function sanitizeNoteHtml(html: string, options: { internalLinks: "keep" | "text" } = { internalLinks: "text" }): string {
  return sanitizeHtml(html, {
    allowedTags: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "strike", "del", "code", "pre", "blockquote", "ul", "ol", "li", "a", "span", "mark", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col", "img", "figure", "figcaption", "label", "input", "div", "sub", "sup"],
    allowedAttributes: {
      a: ["href", "title", "rel"],
      span: ["style", "data-internal-link", "title"],
      img: ["src", "alt", "title", "width", "height"],
      figure: ["data-caderno-attachment", "data-attachment-id", "data-file-name", "data-stored-name", "data-mime-type", "data-byte-size"],
      th: ["colspan", "rowspan", "colwidth", "style"], td: ["colspan", "rowspan", "colwidth", "style"],
      col: ["style", "span"], table: ["style"],
      ul: ["data-type"], ol: ["start"], li: ["data-type", "data-checked"],
      input: ["type", "checked", "disabled"],
      mark: ["data-color", "style"],
      "*": ["style"],
    },
    allowedStyles: STYLE_RULES,
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["caderno-asset", "caderno-template-asset", "data"], a: ["http", "https", "mailto", "caderno-note"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    exclusiveFilter: frame => frame.tag === "input" && frame.attribs.type !== "checkbox",
    transformTags: {
      a: (tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag => {
        const href = attribs.href ?? "";
        if (href.startsWith("caderno-note://") && options.internalLinks === "text") return { tagName: "span", attribs: { "data-internal-link": "true", title: "Link interno do Caderno (disponível apenas no aplicativo)" } };
        return { tagName, attribs: { ...attribs, rel: "noopener noreferrer" } };
      },
      input: (_tag, attribs) => ({ tagName: "input", attribs: { type: "checkbox", ...(attribs.checked !== undefined ? { checked: "checked" } : {}), disabled: "disabled" } }),
    },
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function attachmentKindLabel(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Imagem";
  if (mime.startsWith("video/")) return "Vídeo";
  if (mime.startsWith("audio/")) return "Áudio";
  if (mime === "text/html") return "Página HTML";
  return "Arquivo";
}

/** Data local dd/mm/aaaa para o marcador {{data}} dos modelos. */
export function todayLabel(now = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(now);
}
