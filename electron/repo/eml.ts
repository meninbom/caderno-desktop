import { simpleParser } from "mailparser";
import sanitizeHtml from "sanitize-html";
import crypto from "node:crypto";

export interface ParsedEml {
  messageId: string | null; subject: string; from: string; to: string; date: number | null;
  html: string; text: string; key: string;
  attachments: { fileName: string; mimeType: string; content: Buffer }[];
}

export async function parseEml(input: Buffer, sourceName = "message.eml"): Promise<ParsedEml> {
  if (!input.length || input.length > 25 * 1024 * 1024) throw new Error(`${sourceName}: arquivo vazio ou acima de 25 MB.`);
  const wire = input.toString("latin1");
  if ((wire.match(/(?:^|\r?\n)Content-Type\s*:/gi) ?? []).length > 120) throw new Error(`${sourceName}: limite de partes MIME excedido.`);
  if ((wire.match(/multipart\s*\//gi) ?? []).length > 20) throw new Error(`${sourceName}: limite de aninhamento MIME excedido.`);
  const parsed = await simpleParser(input, { maxHtmlLengthToParse: 4 * 1024 * 1024, skipHtmlToText: true, skipTextToHtml: true });
  if ((parsed.attachments?.length ?? 0) > 100) throw new Error(`${sourceName}: limite de 100 anexos excedido.`);
  const files = (parsed.attachments ?? []).map(a => {
    const fileName = (a.filename || "anexo.bin").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "").slice(0, 160) || "anexo.bin";
    return { fileName, mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(a.contentType) ? a.contentType : "application/octet-stream", content: Buffer.from(a.content) };
  });
  if (files.some(a => a.content.length > 50 * 1024 * 1024) || files.reduce((n, a) => n + a.content.length, 0) > 100 * 1024 * 1024) throw new Error(`${sourceName}: anexos excedem os limites.`);
  const messageId = typeof parsed.messageId === "string" ? parsed.messageId.trim().slice(0, 998) : null;
  const fallback = crypto.createHash("sha256").update(input).digest("hex");
  const clean = parsed.html ? sanitizeHtml(parsed.html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "h3", "table", "thead", "tbody", "tr", "td", "th"]),
    allowedAttributes: { "*": ["style"], a: ["href", "name"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
    allowedSchemes: ["cid"], allowedSchemesByTag: { img: ["cid"] }, allowProtocolRelative: false,
    disallowedTagsMode: "discard",
  }) : "";
  const from = parsed.from?.text ?? "", to = parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).map(x => x.text).join(", ") : "";
  return { messageId, subject: String(parsed.subject ?? "").slice(0, 300), from: from.slice(0, 1000), to: to.slice(0, 1000), date: parsed.date?.getTime() ?? null, html: clean, text: String(parsed.text ?? "").slice(0, 2_000_000), key: messageId ? `mid:${messageId.toLowerCase()}` : `sha256:${fallback}`, attachments: files };
}

export function emlHtml(message: ParsedEml): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const body = message.html || `<pre>${esc(message.text)}</pre>`;
  return `<div data-eml-key="${esc(message.key)}"><p><strong>De:</strong> ${esc(message.from)}<br><strong>Para:</strong> ${esc(message.to)}<br><strong>Data:</strong> ${message.date ? new Date(message.date).toLocaleString("pt-BR") : "desconhecida"}</p><hr>${body}</div>`;
}
