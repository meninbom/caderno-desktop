/**
 * Monta um documento HTML autossuficiente para exportação (arquivo .html ou
 * fonte do PDF). Não há scripts, nem recursos remotos: imagens, fontes e
 * mídias permitidas viram data: URLs e a CSP bloqueia todo o resto.
 * Não importa electron para ser testável no Vitest.
 */
import fs from "node:fs";
import type { ExportFormat, PdfAnnotation } from "../shared/ipc";
import { NOTE_ASSET_SCHEME, attachmentKindLabel, escapeHtml, formatBytes, mapMedia, sanitizeNoteHtml } from "./repo/note-html";

export const EXPORT_EMBED_LIMITS = { imageBytes: 15 * 1024 * 1024, mediaBytes: 40 * 1024 * 1024, totalMediaBytes: 150 * 1024 * 1024, pdfDownloadBytes: 25 * 1024 * 1024, htmlBytes: 400 * 1024 * 1024, attachmentTextChars: 6000 } as const;
export const EXPORT_CSP = "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'; script-src 'none'";

export interface ExportAssetSource {
  /** Arquivo registrado e validado (realpath) ou null. */
  media(storedName: string): { filePath: string; mime: string; size: number } | null;
  fileName(storedName: string): string | null;
  annotations(storedName: string): PdfAnnotation[];
  attachmentText(storedName: string): string | null;
  transcript(storedName: string): string | null;
}
export interface PdfRender { totalPages: number; pages: { page: number; width: number; height: number; dataUrl: string }[]; error?: string }
export interface ExportNoteInput { title: string; contentHtml: string; notebookName: string | null; tags: string[]; createdAt: number; updatedAt: number }
export interface ExportFonts { dmSans?: Buffer; dmSansItalic?: Buffer; caveat?: Buffer }

const dateLabel = (ms: number) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(ms));

function baseCss(format: ExportFormat): string {
  return `
:root{color-scheme:light}
*{box-sizing:border-box}
html{background:#fff}
body{margin:0;color:#1f2328;background:#fff;font-family:"Segoe UI",system-ui,-apple-system,Arial,sans-serif;font-size:11pt;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
article{max-width:${format === "pdf" ? "none" : "820px"};margin:0 auto;padding:${format === "pdf" ? "0" : "40px 28px 64px"}}
.note-title{font-size:22pt;line-height:1.25;margin:0 0 6px;font-weight:700;overflow-wrap:anywhere}
.note-meta{margin:0 0 22px;padding-bottom:12px;border-bottom:1px solid #d0d7de;color:#57606a;font-size:9pt}
.note-meta span+span::before{content:" · "}
.note-content{overflow-wrap:anywhere}
.note-content p{margin:0 0 .65em}
.note-content h1{font-size:17pt;margin:1.3em 0 .45em;line-height:1.3}
.note-content h2{font-size:14pt;margin:1.2em 0 .4em;line-height:1.35}
.note-content h3{font-size:12pt;margin:1.1em 0 .35em}
h1,h2,h3,h4{break-after:avoid;page-break-after:avoid}
.note-content ul,.note-content ol{padding-left:22px;margin:0 0 10px}
.note-content ul[data-type=taskList]{list-style:none;padding-left:2px}
.note-content ul[data-type=taskList] li{display:flex;gap:8px;align-items:flex-start}
.note-content ul[data-type=taskList] li>label{flex:0 0 auto;margin-top:3px}
.note-content ul[data-type=taskList] li>div{flex:1;min-width:0}
.note-content ul[data-type=taskList] li[data-checked=true]>div{color:#6e7781;text-decoration:line-through}
.note-content input[type=checkbox]{width:13px;height:13px;margin:0;accent-color:#1b4ed8}
.note-content blockquote{border-left:3px solid #1b4ed8;margin:10px 0;padding:2px 14px;color:#57606a}
.note-content pre{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:10px 12px;font-family:Consolas,"Courier New",monospace;font-size:9.5pt;white-space:pre-wrap;overflow-wrap:anywhere}
.note-content code{font-family:Consolas,"Courier New",monospace;font-size:.92em}
.note-content a{color:#1b4ed8}
.note-content [data-internal-link]{color:#1b4ed8;text-decoration:underline dotted}
.note-content table{border-collapse:collapse;width:100%;table-layout:fixed;margin:12px 0}
.note-content th,.note-content td{border:1px solid #bcc3cc;padding:5px 7px;vertical-align:top;overflow-wrap:anywhere}
.note-content th{background:#eef1f4;font-weight:600}
.note-content th p,.note-content td p{margin:0}
.note-content thead{display:table-header-group}
.note-content tr{break-inside:avoid;page-break-inside:avoid}
.note-content img{display:block;max-width:100%;height:auto;border-radius:4px;margin:8px 0;break-inside:avoid;page-break-inside:avoid${format === "pdf" ? ";max-height:235mm;object-fit:contain" : ""}}
.note-content mark{padding:0 1px}
.note-content span[style*="color:"] mark{color:inherit!important}
.export-attachment{margin:16px 0;border:1px solid #d0d7de;border-radius:8px;padding:10px 12px;background:#fafbfc;font-size:9.5pt;line-height:1.5}
.export-attachment>header{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;margin-bottom:6px}
.export-attachment>header strong{font-size:10.5pt;overflow-wrap:anywhere}
.export-attachment>header span{color:#57606a}
.export-attachment.compact{break-inside:avoid;page-break-inside:avoid}
.export-attachment video,.export-attachment audio{width:100%;max-width:100%;margin:6px 0}
.export-attachment .download{display:inline-block;margin-top:4px}
.export-attachment .note{color:#57606a;margin:4px 0 0}
.export-attachment .excerpt{white-space:pre-wrap;max-height:none;background:#fff;border:1px solid #e1e4e8;border-radius:6px;padding:8px;margin:6px 0 0;font-size:9pt}
.pdf-page-export{position:relative;margin:10px 0;border:1px solid #d0d7de;background:#fff;break-inside:avoid;page-break-inside:avoid}
.pdf-page-export img{display:block;width:100%;height:auto;margin:0;border-radius:0;max-height:none}
.pdf-page-export .page-label{position:absolute;right:6px;bottom:6px;background:rgba(255,255,255,.9);border:1px solid #d0d7de;border-radius:4px;padding:0 5px;font-size:8pt;color:#57606a}
.pdf-mark{position:absolute;border-radius:2px}
.pdf-mark.highlight{background:rgba(255,213,0,.35);border:1px solid rgba(200,150,0,.8)}
.pdf-mark.comment{background:#1b4ed8;color:#fff;border-radius:50%;min-width:14px;min-height:14px;font-size:8px;line-height:14px;text-align:center}
.pdf-annotations{width:100%;border-collapse:collapse;margin:8px 0 0;font-size:9pt}
.pdf-annotations th,.pdf-annotations td{border:1px solid #d0d7de;padding:4px 6px;text-align:left;vertical-align:top}
.pdf-annotations th{background:#eef1f4}
.missing-asset{color:#8a5a00;background:#fff8e6;border:1px dashed #d4a72c;border-radius:6px;padding:6px 10px;font-size:9.5pt}
.export-footer{margin-top:28px;color:#6e7781;font-size:8pt;border-top:1px solid #e1e4e8;padding-top:8px}
@page{size:A4;margin:16mm 15mm 18mm}
@media print{article{padding:0}}
`;
}

function fontCss(html: string, fonts: ExportFonts): string {
  const out: string[] = [];
  if (/DM Sans/i.test(html) && fonts.dmSans) {
    out.push(`@font-face{font-family:"DM Sans";src:url(data:font/ttf;base64,${fonts.dmSans.toString("base64")}) format("truetype");font-style:normal;font-weight:100 1000}`);
    if (fonts.dmSansItalic) out.push(`@font-face{font-family:"DM Sans";src:url(data:font/ttf;base64,${fonts.dmSansItalic.toString("base64")}) format("truetype");font-style:italic;font-weight:100 1000}`);
  }
  if (/Caveat/i.test(html) && fonts.caveat) out.push(`@font-face{font-family:"Caveat";src:url(data:font/ttf;base64,${fonts.caveat.toString("base64")}) format("truetype");font-weight:400 700}`);
  return out.join("\n");
}

function readSafe(filePath: string, size: number, limit: number): Buffer | null {
  if (size > limit) return null;
  try { const data = fs.readFileSync(filePath); return data.length === size ? data : null; } catch { return null; }
}

export function buildExportHtml(input: { note: ExportNoteInput; format: ExportFormat; renders: Map<string, PdfRender>; assets: ExportAssetSource; fonts: ExportFonts; appVersion: string }): { html: string; warnings: string[] } {
  const { note, format, assets } = input;
  const warnings: string[] = [];
  let mediaBudget: number = EXPORT_EMBED_LIMITS.totalMediaBytes;
  const missing = (label: string) => `<p class="missing-asset">${escapeHtml(label)}</p>`;
  const clean = sanitizeNoteHtml(note.contentHtml, { internalLinks: "text" });

  const pdfBlock = (storedName: string, name: string, media: { filePath: string; size: number }) => {
    const render = input.renders.get(storedName);
    const annotations = assets.annotations(storedName).slice().sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
    const total = render?.totalPages ?? 0;
    const parts: string[] = [`<section class="export-attachment pdf-export" data-export-kind="pdf"><header><strong>${escapeHtml(name)}</strong><span>PDF · ${formatBytes(media.size)}${total ? ` · ${total} página(s)` : ""}${annotations.length ? ` · ${annotations.length} marcação(ões)` : ""}</span></header>`];
    if (render?.pages.length) {
      for (const page of render.pages) {
        const marks = annotations.filter(a => a.page === page.page).map((a, i) => `<div class="pdf-mark ${a.kind}" style="left:${(a.rect.x * 100).toFixed(3)}%;top:${(a.rect.y * 100).toFixed(3)}%;width:${(a.rect.width * 100).toFixed(3)}%;height:${(a.rect.height * 100).toFixed(3)}%" title="${escapeHtml(a.comment || "Destaque")}">${a.kind === "comment" ? i + 1 : ""}</div>`).join("");
        parts.push(`<div class="pdf-page-export" data-page="${page.page}"><img src="${page.dataUrl}" width="${page.width}" height="${page.height}" alt="${escapeHtml(`${name} — página ${page.page}`)}">${marks}<span class="page-label">Página ${page.page}</span></div>`);
      }
      if (total > render.pages.length) { const msg = `Páginas ${render.pages.length + 1}–${total} de “${name}” não foram incluídas (limite de páginas por exportação).`; parts.push(`<p class="note">${escapeHtml(msg)}</p>`); warnings.push(msg); }
    } else {
      const msg = render?.error ? `Não foi possível renderizar “${name}”: ${render.error}` : `Páginas de “${name}” não foram renderizadas.`;
      parts.push(`<p class="note">${escapeHtml(msg)}</p>`); warnings.push(msg);
      const text = assets.attachmentText(storedName);
      if (text) parts.push(`<div class="excerpt">${escapeHtml(text.slice(0, EXPORT_EMBED_LIMITS.attachmentTextChars))}</div>`);
    }
    if (annotations.length) {
      parts.push(`<table class="pdf-annotations"><thead><tr><th style="width:14%">Página</th><th style="width:18%">Tipo</th><th>Comentário</th></tr></thead><tbody>${annotations.map(a => `<tr><td>${a.page}</td><td>${a.kind === "highlight" ? "Destaque" : "Comentário"}</td><td>${escapeHtml(a.comment || "—")}</td></tr>`).join("")}</tbody></table>`);
    }
    if (format === "html") {
      const data = mediaBudget >= media.size ? readSafe(media.filePath, media.size, EXPORT_EMBED_LIMITS.pdfDownloadBytes) : null;
      if (data) { mediaBudget -= data.length; parts.push(`<a class="download" download="${escapeHtml(name)}" href="data:application/pdf;base64,${data.toString("base64")}">Baixar PDF original</a>`); }
      else parts.push(`<p class="note">PDF original não incorporado (acima de ${formatBytes(EXPORT_EMBED_LIMITS.pdfDownloadBytes)}).</p>`);
    }
    parts.push("</section>");
    return parts.join("");
  };

  const body = mapMedia(clean, ref => {
    if (ref.type === "image") {
      if (!ref.src.startsWith(NOTE_ASSET_SCHEME)) return ref.src.startsWith("data:image/") ? undefined : missing("[Imagem externa removida na exportação]");
      const storedName = ref.src.slice(NOTE_ASSET_SCHEME.length), media = assets.media(storedName), alt = ref.attrs.get("alt") ?? "";
      const data = media && media.mime.startsWith("image/") ? readSafe(media.filePath, media.size, EXPORT_EMBED_LIMITS.imageBytes) : null;
      if (!data || !media) { warnings.push(`Imagem indisponível: ${alt || storedName}`); return missing(`[Imagem indisponível${alt ? `: ${alt}` : ""}]`); }
      return `<img src="data:${media.mime};base64,${data.toString("base64")}" alt="${escapeHtml(alt)}"${ref.attrs.get("title") ? ` title="${escapeHtml(ref.attrs.get("title")!)}"` : ""}>`;
    }
    const storedName = ref.storedName, media = storedName ? assets.media(storedName) : null;
    const name = assets.fileName(storedName) ?? ref.attrs.get("data-file-name") ?? "Anexo";
    if (!media) { warnings.push(`Anexo indisponível: ${name}`); return missing(`[Anexo indisponível: ${name}]`); }
    const header = (extra = "") => `<header><strong>${escapeHtml(name)}</strong><span>${attachmentKindLabel(media.mime)} · ${formatBytes(media.size)}${extra}</span></header>`;
    if (media.mime === "application/pdf") return pdfBlock(storedName, name, media);
    if (media.mime.startsWith("image/")) {
      const data = readSafe(media.filePath, media.size, EXPORT_EMBED_LIMITS.imageBytes);
      return data ? `<figure class="export-attachment" data-export-kind="image">${header()}<img src="data:${media.mime};base64,${data.toString("base64")}" alt="${escapeHtml(name)}"></figure>` : missing(`[Imagem grande demais para exportar: ${name}]`);
    }
    if (media.mime.startsWith("video/") || media.mime.startsWith("audio/")) {
      const video = media.mime.startsWith("video/"), transcript = assets.transcript(storedName);
      const transcriptHtml = transcript ? `<p class="note"><strong>Transcrição local:</strong></p><div class="excerpt">${escapeHtml(transcript.slice(0, EXPORT_EMBED_LIMITS.attachmentTextChars * 3))}</div>` : "";
      if (format === "html") {
        const data = mediaBudget >= media.size ? readSafe(media.filePath, media.size, EXPORT_EMBED_LIMITS.mediaBytes) : null;
        if (data) { mediaBudget -= data.length; const src = `data:${media.mime};base64,${data.toString("base64")}`; return `<section class="export-attachment" data-export-kind="${video ? "video" : "audio"}">${header()}${video ? `<video controls preload="metadata" src="${src}"></video>` : `<audio controls preload="metadata" src="${src}"></audio>`}${transcriptHtml}</section>`; }
        warnings.push(`${video ? "Vídeo" : "Áudio"} não incorporado por tamanho: ${name}`);
        return `<section class="export-attachment compact" data-export-kind="${video ? "video" : "audio"}">${header()}<p class="note">Arquivo não incorporado (acima do limite de ${formatBytes(EXPORT_EMBED_LIMITS.mediaBytes)} por mídia ou ${formatBytes(EXPORT_EMBED_LIMITS.totalMediaBytes)} no total).</p>${transcriptHtml}</section>`;
      }
      return `<section class="export-attachment compact" data-export-kind="${video ? "video" : "audio"}">${header(" · disponível no arquivo original")}<p class="note">${video ? "▶ Vídeo" : "♪ Áudio"} incorporado na nota. A reprodução não é possível em PDF.</p>${transcriptHtml}</section>`;
    }
    if (media.mime === "text/html") {
      const text = assets.attachmentText(storedName);
      return `<section class="export-attachment compact" data-export-kind="html">${header()}<p class="note">Página HTML capturada. Scripts e recursos externos não são exportados${text ? "; texto extraído abaixo" : ""}.</p>${text ? `<div class="excerpt">${escapeHtml(text.slice(0, EXPORT_EMBED_LIMITS.attachmentTextChars))}</div>` : ""}</section>`;
    }
    return `<section class="export-attachment compact" data-export-kind="file">${header()}</section>`;
  });

  const meta = [note.notebookName ? `<span>Caderno: ${escapeHtml(note.notebookName)}</span>` : "", note.tags.length ? `<span>Etiquetas: ${escapeHtml(note.tags.join(", "))}</span>` : "", `<span>Criada em ${escapeHtml(dateLabel(note.createdAt))}</span>`, `<span>Atualizada em ${escapeHtml(dateLabel(note.updatedAt))}</span>`].filter(Boolean).join("");
  const title = note.title.trim() || "Sem título";
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="generator" content="Caderno ${escapeHtml(input.appVersion)}"><title>${escapeHtml(title)}</title>
<style>${baseCss(format)}${fontCss(clean, input.fonts)}</style></head>
<body class="caderno-export format-${format}"><article><header><h1 class="note-title">${escapeHtml(title)}</h1><p class="note-meta">${meta}</p></header><div class="note-content">${body}</div>${format === "html" ? `<footer class="export-footer">Exportado do Caderno ${escapeHtml(input.appVersion)} em ${escapeHtml(dateLabel(Date.now()))}. Arquivo autossuficiente: funciona offline.</footer>` : ""}</article></body></html>`;
  if (Buffer.byteLength(html, "utf8") > EXPORT_EMBED_LIMITS.htmlBytes) throw new Error(`O documento exportado ultrapassaria ${formatBytes(EXPORT_EMBED_LIMITS.htmlBytes)}.`);
  return { html, warnings };
}

/** Grava bytes atomicamente: arquivo temporário exclusivo + rename. Em falha o destino existente fica intacto. */
export function writeFileAtomic(filePath: string, data: string | Buffer, suffix: string): void {
  const temp = `${filePath}.${suffix}.tmp`;
  fs.writeFileSync(temp, data, { flag: "wx" });
  try { fs.renameSync(temp, filePath); } catch (error) { fs.rmSync(temp, { force: true }); throw error; }
}
