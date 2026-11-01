import crypto from "node:crypto";
import sanitizeHtml from "sanitize-html";

/** Limite do corpo HTTP em bytes UTF-8. Igual ao da ponte e ao da extensão. */
export const MAX_CLIP_BYTES = 1_000_000;
export const CLIP_MODES = ["article", "selection", "page", "bookmark"] as const;
export type ClipMode = (typeof CLIP_MODES)[number];

const REQUEST_ID = /^[a-f0-9-]{36}$/i;
const TRACKING_PARAM = /^(?:utm_[a-z0-9_]+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|twclid|ttclid|gad_source|gad_campaignid|_ga|_gl|si)$/i;

export interface ClipRequest {
  requestId: string;
  title: string;
  text: string;
  html: string;
  sourceURL: string;
  sourceDate: string;
  sourceDateKind: string;
  mode: ClipMode;
  notebookId: number | null;
  comment: string;
  author: string;
  tags: string[];
  confirmNew: boolean;
  appendToNoteId: string | null;
}

export interface PreparedClip {
  title: string;
  contentHtml: string;
  bodyHtml: string;
  sourceUrl: string;
  canonicalUrl: string;
  contentHash: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

export function clipPayloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** Remove só parâmetros conhecidos de rastreamento. Mantém a query funcional e o fragmento. */
export function canonicalClipUrl(input: URL): string {
  const url = new URL(input.href);
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (!TRACKING_PARAM.test(key)) kept.append(key, value);
  }
  url.search = kept.toString();
  url.hostname = url.hostname.toLowerCase();
  return url.href;
}

export function parseClipRequest(input: unknown): { ok: true; value: ClipRequest } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "INVALID_CLIP" };
  const body = input as Record<string, unknown>;
  if (typeof body.requestId !== "string" || !REQUEST_ID.test(body.requestId)) return { ok: false, error: "INVALID_CLIP" };
  if (typeof body.title !== "string" || body.title.length > 300) return { ok: false, error: "INVALID_CLIP" };
  if (typeof body.text !== "string" || body.text.length > 600_000) return { ok: false, error: "INVALID_CLIP" };
  if (typeof body.html !== "string" || body.html.length > 600_000) return { ok: false, error: "INVALID_CLIP" };
  if (typeof body.sourceURL !== "string" || body.sourceURL.length > 4096) return { ok: false, error: "INVALID_SOURCE_URL" };
  if (typeof body.sourceDate !== "string" || body.sourceDate.length > 80) return { ok: false, error: "INVALID_CLIP" };
  if (body.sourceDateKind !== undefined && (typeof body.sourceDateKind !== "string" || body.sourceDateKind.length > 40)) return { ok: false, error: "INVALID_CLIP" };
  if (typeof body.mode !== "string" || !CLIP_MODES.includes(body.mode as ClipMode)) return { ok: false, error: "INVALID_CLIP" };
  if (!(body.notebookId === null || (typeof body.notebookId === "number" && Number.isSafeInteger(body.notebookId) && body.notebookId > 0))) return { ok: false, error: "INVALID_CLIP" };
  if (body.comment !== undefined && (typeof body.comment !== "string" || body.comment.length > 2_000)) return { ok: false, error: "COMMENT_TOO_LONG" };
  if (body.author !== undefined && (typeof body.author !== "string" || body.author.length > 200)) return { ok: false, error: "INVALID_CLIP" };
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 8 || body.tags.some(tag => typeof tag !== "string" || tag.length > 80))) return { ok: false, error: "INVALID_TAGS" };
  if (body.confirmNew !== undefined && typeof body.confirmNew !== "boolean") return { ok: false, error: "INVALID_CLIP" };
  if (body.appendToNoteId !== undefined && body.appendToNoteId !== null && (typeof body.appendToNoteId !== "string" || !REQUEST_ID.test(body.appendToNoteId))) return { ok: false, error: "INVALID_CLIP" };
  return {
    ok: true,
    value: {
      requestId: body.requestId,
      title: body.title,
      text: body.text,
      html: body.html,
      sourceURL: body.sourceURL,
      sourceDate: body.sourceDate,
      sourceDateKind: typeof body.sourceDateKind === "string" ? body.sourceDateKind : "",
      mode: body.mode as ClipMode,
      notebookId: body.notebookId,
      comment: typeof body.comment === "string" ? body.comment : "",
      author: typeof body.author === "string" ? body.author : "",
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [],
      confirmNew: body.confirmNew === true,
      appendToNoteId: typeof body.appendToNoteId === "string" ? body.appendToNoteId : null,
    },
  };
}

function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export function sanitizeClipHtml(html: string, baseUrl: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "strike", "code", "pre", "blockquote", "ul", "ol", "li", "a", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption"],
    allowedAttributes: {
      a: ["href", "title"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { a: ["http", "https", "mailto"] },
    allowProtocolRelative: false,
    enforceHtmlBoundary: false,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "noembed", "object", "embed", "svg", "math", "canvas"],
    transformTags: {
      a: (_tag, attrs) => {
        const raw = attrs.href ?? "";
        let href = "";
        if (raw) {
          try {
            const absolute = new URL(raw, baseUrl);
            if (absolute.protocol === "http:" || absolute.protocol === "https:" || absolute.protocol === "mailto:") href = absolute.href;
          } catch { /* href inválido sai sem endereço */ }
        }
        return { tagName: "a", attribs: href ? { href, rel: "noopener noreferrer", ...(attrs.title ? { title: attrs.title } : {}) } : {} };
      },
    },
  });
}

function sourceParagraph(sourceUrl: string, sourceDate: string, sourceDateKind: string, author: string, capturedAt: Date): string {
  const href = escapeHtml(sourceUrl);
  const when = escapeHtml(capturedAt.toISOString());
  const kind = sourceDateKind.trim() || "data da página";
  const date = sourceDate.trim() ? `${escapeHtml(kind)}: ${escapeHtml(sourceDate.trim())}` : "Data da página: não informada";
  const by = author.trim() ? `<br>Autor: ${escapeHtml(author.trim().slice(0, 200))}` : "";
  return `<p><strong>Fonte:</strong> <a href="${href}">${href}</a><br><small>${date} · Capturado: ${when}</small>${by}</p>`;
}

export function prepareClip(input: ClipRequest, now = new Date()): PreparedClip {
  let source: URL;
  try { source = new URL(input.sourceURL); } catch { throw new Error("INVALID_SOURCE_URL"); }
  if (!/^https?:$/.test(source.protocol) || source.username || source.password) throw new Error("INVALID_SOURCE_URL");
  const canonicalUrl = canonicalClipUrl(source);
  const sanitized = sanitizeClipHtml(input.html, source.href);
  const fallback = input.text.trim() ? `<p>${escapeHtml(input.text).replace(/\n/g, "<br>")}</p>` : "";
  const bodyHtml = visibleText(sanitized) ? sanitized : fallback;
  if (input.mode !== "bookmark" && !visibleText(bodyHtml)) throw new Error("EMPTY_CONTENT");
  const title = input.title.replace(/\u0000/g, "").trim().slice(0, 300) || source.hostname;
  const comment = input.comment.trim()
    ? `<blockquote><strong>Comentário</strong><br>${escapeHtml(input.comment.trim()).replace(/\n/g, "<br>")}</blockquote>`
    : "";
  const contentHtml = `${sourceParagraph(source.href, input.sourceDate, input.sourceDateKind, input.author, now)}${comment}<hr>${bodyHtml}`;
  return {
    title,
    contentHtml,
    bodyHtml,
    sourceUrl: source.href,
    canonicalUrl,
    contentHash: crypto.createHash("sha256").update(bodyHtml).digest("hex"),
  };
}

export function clipErrorStatus(error: unknown): { status: number; error: string } {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "INVALID_CLIP";
  if (code === "PAYLOAD_TOO_LARGE") return { status: 413, error: code };
  if (code === "NOTEBOOK_NOT_FOUND" || code === "NOTE_NOT_FOUND") return { status: 404, error: code };
  if (code === "NOTE_TRASHED") return { status: 409, error: code };
  return { status: 400, error: code };
}
