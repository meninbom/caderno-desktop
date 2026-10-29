/**
 * Funções puras de texto/markdown compartilhadas entre o processo principal
 * (Electron/SQLite) e o renderer (adapter web de desenvolvimento). Sem
 * dependências de Node ou do banco.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function extractPreviewHtml(contentHtml: string, max = 160): string {
  const text = contentHtml
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

export function extractVisibleText(contentHtml: string): string {
  return contentHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function noteTextForSearch(contentHtml: string): string {
  return extractVisibleText(contentHtml);
}

function inline(md: string): string {
  let out = escapeHtml(md);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

/** Conversor Markdown mínimo em HTML aceito pelo editor TipTap. */
export function markdownToNoteHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inUl = false;
  let inOl = false;
  let inCode = false;
  let codeLines: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      html.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const closeList = (): void => {
    if (inUl) { html.push("</ul>"); inUl = false; }
    if (inOl) { html.push("</ol>"); inOl = false; }
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith("```")) {
      flushParagraph();
      closeList();
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const check = trimmed.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (check) {
      flushParagraph();
      if (!inUl) { html.push('<ul data-type="taskList">'); inUl = true; }
      html.push(`<li data-checked="${check[1] !== " " ? "true" : "false"}"><p>${inline(check[2])}</p></li>`);
      continue;
    }
    const bullet = trimmed.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (!inUl) { html.push("<ul>"); inUl = true; }
      html.push(`<li><p>${inline(bullet[1])}</p></li>`);
      continue;
    }
    const ordered = trimmed.match(/^\s*\d+\.\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (!inOl) { html.push("<ol>"); inOl = true; }
      html.push(`<li><p>${inline(ordered[1])}</p></li>`);
      continue;
    }
    if (trimmed === "") {
      flushParagraph();
      closeList();
      continue;
    }
    if (inUl || inOl) { flushParagraph(); closeList(); }
    paragraph.push(trimmed);
  }
  if (inCode) codeLines.forEach(() => undefined);
  flushParagraph();
  closeList();
  if (codeLines.length > 0) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return html.join("");
}

export interface MarkdownNote {
  title: string;
  contentHtml: string;
  contentText: string;
  tags: { name: string }[];
  notebookName: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Converte nota (texto visível + título) para Markdown durante exportação. */
export function markdownFromNote(note: MarkdownNote): string {
  const meta: string[] = [];
  if (note.notebookName) meta.push(`Caderno: ${note.notebookName}`);
  if (note.tags.length > 0) meta.push(`Etiquetas: ${note.tags.map(t => t.name).join(", ")}`);
  const front =
    meta.length > 0
      ? `<div>${escapeHtml(meta.join(" · "))}</div>\n`
      : "";
  const body = note.contentHtml
    .replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_m, inner: string) =>
      inner
        .split(/<br\s*\/?>|<\/p>/)
        .map(p => p.replace(/<[^>]*>/g, "").trim())
        .filter(Boolean)
        .map(p => `> ${p}`)
        .join("\n")
    )
    .replace(/<li data-checked="true"><p>([\s\S]*?)<\/p><\/li>/g, "- [x] $1")
    .replace(/<li data-checked="false"><p>([\s\S]*?)<\/p><\/li>/g, "- [ ] $1")
    .replace(/<ul[^>]*>\s*<li>/g, "- ")
    .replace(/<\/li>\s*<li>/g, "\n- ")
    .replace(/<\/li>\s*<\/ul>/g, "")
    .replace(/<ol[^>]*>\s*<li>/g, "1. ")
    .replace(/<\/li>\s*<li>/g, "\n1. ")
    .replace(/<\/li>\s*<\/ol>/g, "")
    .replace(/<h1>([\s\S]*?)<\/h1>/g, "# $1\n")
    .replace(/<h2>([\s\S]*?)<\/h2>/g, "## $1\n")
    .replace(/<h3>([\s\S]*?)<\/h3>/g, "### $1\n")
    .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, "```\n$1\n```\n")
    .replace(/<strong>([\s\S]*?)<\/strong>/g, "**$1**")
    .replace(/<em>([\s\S]*?)<\/em>/g, "*$1*")
    .replace(/<code>([\s\S]*?)<\/code>/g, "`$1`")
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, "[$2]($1)")
    .replace(/<p>([\s\S]*?)<\/p>/g, "$1\n\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const titleLine = note.title ? `# ${note.title}\n\n` : "";
  return `${titleLine}${front}${body}\n`.replace(/\n{3,}/g, "\n\n");
}

export function markdownHeadline(md: string): string | null {
  const heading = md.match(/^\s*#\s+(.+)$/m);
  return heading ? heading[1].trim().slice(0, 300) : null;
}
