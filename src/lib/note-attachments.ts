import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection, type EditorState, type Transaction } from "@tiptap/pm/state";

/** Limites espelham o backend (electron/repo/attachments.ts); validar antes evita ler/serializar o arquivo à toa. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_DROP = 20;

/** MIME usados por arrastes internos (notas/pastas da barra lateral); nunca são arquivos do sistema. */
const INTERNAL_DRAG_TYPES = ["application/x-caderno-note", "application/x-caderno-folder"];
const PREVIEW_MIME = /^(image\/(png|jpeg|webp)|application\/pdf|text\/html|video\/(webm|mp4|ogg)|audio\/(webm|mp4|ogg))$/;
const RISKY_EXTENSION = /\.(exe|msi|bat|cmd|com|scr|pif|lnk|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|jar|reg|dll|cpl|msc)$/i;
const INLINE_IMAGE_EXTENSION = /\.(png|jpe?g|webp)$/i;

export function canPreviewMime(mime: string | undefined | null): boolean { return PREVIEW_MIME.test(mime ?? ""); }
export function isRiskyToOpen(fileName: string): boolean { return RISKY_EXTENSION.test(fileName.trim()); }

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(".", ",") : Math.round(mb)} MB`;
}

/** Rótulo curto do tipo para o cartão de arquivo sem prévia. */
export function fileKindLabel(fileName: string): string {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1];
  return ext ? ext.toUpperCase() : "Arquivo";
}

type TypesSource = { types?: ReadonlyArray<string> | DOMStringList } | null | undefined;

/** Arrastar de arquivos do sistema (Explorer). Notas e pastas do app, mesmo com `Files` residual, ficam de fora. */
export function isExternalFileDrag(dt: TypesSource): boolean {
  if (!dt?.types) return false;
  const types = Array.from(dt.types as ArrayLike<string>);
  if (!types.includes("Files")) return false;
  return !types.some(type => INTERNAL_DRAG_TYPES.includes(type));
}

export interface DroppedEntry { file: File; directory: boolean }

/** Lê o DataTransfer de forma síncrona: itens deixam de existir assim que o handler do evento retorna. */
export function collectDropped(dt: DataTransfer): DroppedEntry[] {
  const out: DroppedEntry[] = [];
  const items = Array.from(dt.items ?? []).filter(item => item.kind === "file");
  if (items.length) {
    for (const item of items) {
      const file = item.getAsFile();
      if (!file) continue;
      let directory = false;
      try { directory = Boolean((item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }).webkitGetAsEntry?.()?.isDirectory); } catch { /* sem suporte: o tamanho 0 abaixo cobre pastas */ }
      out.push({ file, directory });
    }
    return out;
  }
  return Array.from(dt.files ?? []).map(file => ({ file, directory: false }));
}

export type DropMode = "image" | "file";
export interface DropPlan { accepted: { file: File; mode: DropMode }[]; rejected: { name: string; reason: string }[]; ignored: number }

/** PNG/JPEG/WebP viram imagem inline (10 MB); qualquer outro tipo vira anexo (50 MB). O backend decide o MIME pela extensão. */
export function planDrop(entries: DroppedEntry[], maxFiles = MAX_FILES_PER_DROP): DropPlan {
  const accepted: DropPlan["accepted"] = [];
  const rejected: DropPlan["rejected"] = [];
  let ignored = 0;
  for (const { file, directory } of entries) {
    if (accepted.length >= maxFiles) { ignored++; continue; }
    const name = file.name || "arquivo";
    if (directory) { rejected.push({ name, reason: "pastas não podem ser anexadas; solte os arquivos" }); continue; }
    if (file.size === 0) { rejected.push({ name, reason: "arquivo vazio ou inacessível" }); continue; }
    const image = INLINE_IMAGE_EXTENSION.test(name);
    if (image && file.size > MAX_IMAGE_BYTES) { rejected.push({ name, reason: "imagem acima de 10 MB" }); continue; }
    if (!image && file.size > MAX_ATTACHMENT_BYTES) { rejected.push({ name, reason: "arquivo acima de 50 MB" }); continue; }
    accepted.push({ file, mode: image ? "image" : "file" });
  }
  return { accepted, rejected, ignored };
}

/** Base64 nativo (FileReader) em vez de String.fromCharCode em blocos: não trava a UI em arquivos grandes. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Não foi possível ler o arquivo."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : "");
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Faixa de substituição para inserir blocos no ponto de queda. Dentro de um bloco de texto insere antes/depois dele
 * (nunca no meio da frase); um parágrafo vazio é substituído. `after` indica a metade inferior do bloco.
 */
export function blockInsertRange(doc: PMNode, pos: number, after: boolean): { from: number; to: number } {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  if ($pos.parent.inlineContent && $pos.depth > 0) {
    const from = $pos.before(), to = $pos.after();
    if ($pos.parent.content.size === 0 && !$pos.parent.type.spec.code) return { from, to };
    return after ? { from: to, to } : { from, to: from };
  }
  return { from: clamped, to: clamped };
}

/** Candidatos em ordem de preferência: faixa calculada, depois do bloco de nível superior, fim do documento. */
export function insertionCandidates(doc: PMNode, pos: number, after: boolean): { from: number; to: number }[] {
  const first = blockInsertRange(doc, pos, after);
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  const out = [first];
  if ($pos.depth >= 1) { const end = $pos.after(1), start = $pos.before(1); out.push(after ? { from: end, to: end } : { from: start, to: start }, { from: end, to: end }); }
  out.push({ from: doc.content.size, to: doc.content.size });
  return out.filter((range, index) => out.findIndex(other => other.from === range.from && other.to === range.to) === index);
}

export interface DropReport { saved: number; failed: { name: string; reason: string }[]; ignored: number; inserted: boolean; refusedInsert?: string }

/** Mensagem única de resultado; erros listam o nome do arquivo para o usuário saber o que não entrou. */
export function describeDropReport(report: DropReport): { kind: "ok" | "error"; text: string } {
  const parts: string[] = [];
  if (report.saved) parts.push(`${report.saved} arquivo${report.saved > 1 ? "s anexados" : " anexado"}`);
  if (report.saved && !report.inserted) parts.push(report.refusedInsert ?? "não entraram no texto (estão nos anexos da nota)");
  const failures = report.failed.slice(0, 3).map(item => `${item.name}: ${item.reason}`);
  if (report.failed.length > 3) failures.push(`e mais ${report.failed.length - 3}`);
  if (report.ignored) failures.push(`${report.ignored} acima do limite de ${MAX_FILES_PER_DROP} por vez`);
  const ok = parts.join(" — ");
  if (!failures.length) return { kind: "ok", text: `${ok}.` };
  return { kind: "error", text: `${ok ? `${ok}. ` : ""}Não anexado — ${failures.join("; ")}.` };
}

/**
 * Transação que insere os blocos no ponto de queda: tenta a faixa ideal e, se o schema recusar (p.ex. anexo como 1º filho
 * de um item de lista), recua para posições seguras. Garante um parágrafo depois quando o bloco fica no fim do documento.
 */
export function buildInsertTransaction(state: EditorState, nodes: PMNode[], pos: number, after: boolean): Transaction | null {
  if (!nodes.length) return null;
  const { schema, doc } = state;
  const size = nodes.reduce((sum, node) => sum + node.nodeSize, 0);
  for (const range of insertionCandidates(doc, pos, after)) {
    try {
      const needsTail = range.to >= doc.content.size;
      const tr = state.tr.replaceWith(range.from, range.to, needsTail ? [...nodes, schema.nodes.paragraph.create()] : nodes);
      if (!tr.docChanged) continue;
      const end = Math.min(range.from + size, tr.doc.content.size);
      return tr.setSelection(Selection.near(tr.doc.resolve(end), 1)).scrollIntoView();
    } catch { /* tenta a próxima posição */ }
  }
  return null;
}
