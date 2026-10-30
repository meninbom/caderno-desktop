/**
 * Modelos de nota. O conteúdo de um modelo é independente da nota de origem:
 * imagens e anexos incorporados são copiados (BLOB no SQLite) no momento do
 * salvamento e, ao aplicar, viram anexos novos pertencentes à nota criada.
 * Assim, apagar a nota original nunca quebra o modelo.
 */
import type Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { extractPreviewHtml, extractVisibleText } from "../../shared/text";
import type { NoteTemplateAsset, NoteTemplateFull, NoteTemplateMeta, PdfAnnotation, TemplateSaveResult } from "../../shared/ipc";
import { NOTE_ASSET_SCHEME, TEMPLATE_ASSET_SCHEME, escapeHtml, attachmentKindLabel, formatBytes, mapMedia, sanitizeNoteHtml, serializeAttributes, todayLabel } from "./note-html";

export const TEMPLATE_LIMITS = { assetsPerTemplate: 40, bytesPerTemplate: 120 * 1024 * 1024, imageBytes: 10 * 1024 * 1024, fileBytes: 50 * 1024 * 1024, totalBytes: 250 * 1024 * 1024, templates: 500 } as const;

export const BUILTIN_TEMPLATES: { key: string; name: string; description: string; noteTitle: string; contentHtml: string }[] = [
  {
    key: "meeting", name: "Ata de reunião", description: "Participantes, pauta, decisões e próximos passos com responsáveis.", noteTitle: "Reunião — {{data}}",
    contentHtml: '<h2>Informações</h2><table><tbody><tr><th><p>Data</p></th><td><p>{{data}}</p></td></tr><tr><th><p>Participantes</p></th><td><p></p></td></tr><tr><th><p>Local ou link</p></th><td><p></p></td></tr></tbody></table><h2>Pauta</h2><ol><li><p></p></li></ol><h2>Discussão</h2><p></p><h2>Decisões</h2><ul><li><p></p></li></ul><h2>Próximos passos</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Responsável — ação — prazo</p></li></ul>',
  },
  {
    key: "project", name: "Plano de projeto", description: "Objetivo, escopo, marcos, riscos e tarefas iniciais.", noteTitle: "Projeto: ",
    contentHtml: '<h2>Objetivo</h2><p>Qual resultado o projeto deve entregar?</p><h2>Escopo</h2><table><tbody><tr><th><p>Inclui</p></th><th><p>Não inclui</p></th></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table><h2>Marcos</h2><table><tbody><tr><th><p>Marco</p></th><th><p>Data</p></th><th><p>Status</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p>Planejado</p></td></tr></tbody></table><h2>Riscos</h2><ul><li><p>Risco — impacto — mitigação</p></li></ul><h2>Tarefas</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Definir equipe</p></li><li data-type="taskItem" data-checked="false"><p>Validar cronograma</p></li></ul>',
  },
  {
    key: "action-plan", name: "Plano de ação (5W2H)", description: "O quê, por quê, quem, onde, quando, como e quanto.", noteTitle: "Plano de ação — {{data}}",
    contentHtml: '<h2>Problema ou meta</h2><p></p><h2>Ações</h2><table><tbody><tr><th><p>O quê</p></th><th><p>Por quê</p></th><th><p>Quem</p></th><th><p>Onde</p></th><th><p>Quando</p></th><th><p>Como</p></th><th><p>Quanto</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table><h2>Acompanhamento</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Revisar andamento</p></li></ul>',
  },
  {
    key: "daily", name: "Diário de trabalho", description: "Prioridades do dia, anotações e aprendizados.", noteTitle: "Diário — {{data}}",
    contentHtml: '<h2>Prioridades de hoje</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li><li data-type="taskItem" data-checked="false"><p></p></li><li data-type="taskItem" data-checked="false"><p></p></li></ul><h2>Anotações</h2><p></p><h2>Aprendizados</h2><blockquote><p></p></blockquote>',
  },
];

export function seedBuiltinTemplates(db: Database.Database, now = Date.now(), onlyMissing = true): number {
  let inserted = 0;
  const insert = db.prepare("INSERT INTO note_templates(id,name,description,note_title,content_html,content_text,builtin_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
  for (const t of BUILTIN_TEMPLATES) {
    if (onlyMissing && db.prepare("SELECT 1 FROM note_templates WHERE builtin_key=?").get(t.key)) continue;
    insert.run(crypto.randomUUID(), t.name, t.description, t.noteTitle, t.contentHtml, extractVisibleText(t.contentHtml), t.key, now, now);
    inserted++;
  }
  return inserted;
}

interface TemplateRow { id: string; name: string; description: string; note_title: string; content_html: string; content_text: string; builtin_key: string | null; created_at: number; updated_at: number; asset_count?: number; asset_bytes?: number }
interface AssetRow { template_id: string; token: string; file_name: string; mime_type: string; kind: string; sha256: string; byte_size: number; data: Buffer; annotations: string }
type StoredAnnotation = Pick<PdfAnnotation, "page" | "kind" | "rect" | "comment">;

const AnnotationSchema = z.object({ page: z.number().int().min(1).max(5000), kind: z.enum(["highlight", "comment"]), rect: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }), comment: z.string().max(4000) });
const TOKEN_RE = /^[0-9a-f]{32}$/;
const STORED_RE = /^[0-9a-f-]{36}(?:\.(?:png|jpg|webp)|__[a-zA-Z0-9. _()[\]-]{1,160})$/i;

export interface BackupTemplate {
  id: string; name: string; description: string; noteTitle: string; contentHtml: string; builtinKey: string | null; createdAt: number; updatedAt: number;
  assets: { token: string; fileName: string; mimeType: string; kind: string; sha256: string; byteSize: number; dataBase64: string; annotations: StoredAnnotation[] }[];
}

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

function suffixFor(fileName: string): string {
  return (fileName.replace(/[^a-zA-Z0-9. _\-()[\]]/g, "_").slice(0, 160) || "anexo").toLowerCase().replace(/\s+/g, "-");
}
function storedNameFor(kind: string, mime: string, fileName: string): string {
  if (kind === "image") return `${crypto.randomUUID()}.${mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp"}`;
  return `${crypto.randomUUID()}__${suffixFor(fileName)}`;
}

export class TemplatesRepo {
  constructor(private db: Database.Database, private attachmentsDir: string) {}

  private meta(row: TemplateRow): NoteTemplateMeta {
    return { id: row.id, name: row.name, description: row.description, noteTitle: row.note_title, builtinKey: row.builtin_key, assetCount: Number(row.asset_count ?? 0), assetBytes: Number(row.asset_bytes ?? 0), preview: extractPreviewHtml(row.content_text), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private row(id: string): TemplateRow | undefined {
    return this.db.prepare("SELECT t.*,(SELECT COUNT(*) FROM note_template_assets a WHERE a.template_id=t.id) AS asset_count,(SELECT COALESCE(SUM(byte_size),0) FROM note_template_assets a WHERE a.template_id=t.id) AS asset_bytes FROM note_templates t WHERE t.id=?").get(id) as TemplateRow | undefined;
  }

  list(query = ""): NoteTemplateMeta[] {
    const rows = this.db.prepare("SELECT t.*,(SELECT COUNT(*) FROM note_template_assets a WHERE a.template_id=t.id) AS asset_count,(SELECT COALESCE(SUM(byte_size),0) FROM note_template_assets a WHERE a.template_id=t.id) AS asset_bytes FROM note_templates t ORDER BY t.builtin_key IS NOT NULL, t.updated_at DESC, t.name COLLATE NOCASE").all() as TemplateRow[];
    const terms = fold(query.trim()).split(/\s+/).filter(Boolean);
    return rows.filter(r => !terms.length || terms.every(term => fold(`${r.name} ${r.description} ${r.note_title} ${r.content_text}`).includes(term))).map(r => this.meta(r));
  }

  get(id: string): NoteTemplateFull | null {
    const row = this.row(id);
    if (!row) return null;
    const assets = this.db.prepare("SELECT * FROM note_template_assets WHERE template_id=? ORDER BY rowid").all(id) as AssetRow[];
    const byToken = new Map(assets.map(a => [a.token, a]));
    const clean = sanitizeNoteHtml(row.content_html, { internalLinks: "keep" });
    const previewHtml = mapMedia(clean, ref => {
      const token = ref.type === "image" ? (ref.src.startsWith(TEMPLATE_ASSET_SCHEME) ? ref.src.slice(TEMPLATE_ASSET_SCHEME.length) : "") : ref.storedName.startsWith(TEMPLATE_ASSET_SCHEME) ? ref.storedName.slice(TEMPLATE_ASSET_SCHEME.length) : "";
      const asset = byToken.get(token);
      if (!asset) return '<p class="template-missing-asset">[Mídia indisponível]</p>';
      if (asset.mime_type.startsWith("image/") && asset.byte_size <= TEMPLATE_LIMITS.imageBytes) {
        const alt = ref.type === "image" ? ref.attrs.get("alt") ?? asset.file_name : asset.file_name;
        return `<img src="data:${asset.mime_type};base64,${asset.data.toString("base64")}" alt="${escapeHtml(alt)}">`;
      }
      const annotations = (JSON.parse(asset.annotations) as unknown[]).length;
      return `<figure class="template-asset-card"><figcaption><strong>${escapeHtml(asset.file_name)}</strong><span>${attachmentKindLabel(asset.mime_type)} · ${formatBytes(asset.byte_size)}${annotations ? ` · ${annotations} marcação(ões)` : ""}</span><small>Será copiado como anexo novo da nota criada.</small></figcaption></figure>`;
    });
    const list: NoteTemplateAsset[] = assets.map(a => ({ token: a.token, fileName: a.file_name, mimeType: a.mime_type, kind: a.kind, byteSize: a.byte_size, annotationCount: (JSON.parse(a.annotations) as unknown[]).length }));
    return { ...this.meta(row), previewHtml, assets: list };
  }

  /** Lê um anexo registrado validando caminho real, tamanho e hash. */
  private readRegistered(storedName: string): { row: { id: number; file_name: string; mime_type: string; kind: string; sha256: string | null; byte_size: number }; data: Buffer } | { error: string } {
    if (!STORED_RE.test(storedName) || path.basename(storedName) !== storedName) return { error: "referência inválida" };
    const row = this.db.prepare("SELECT id,file_name,mime_type,kind,sha256,byte_size FROM attachments WHERE stored_name=?").get(storedName) as { id: number; file_name: string; mime_type: string; kind: string; sha256: string | null; byte_size: number } | undefined;
    if (!row) return { error: "anexo não registrado" };
    const limit = row.kind === "image" ? TEMPLATE_LIMITS.imageBytes : TEMPLATE_LIMITS.fileBytes;
    if (row.byte_size > limit) return { error: "arquivo acima do limite" };
    try {
      const root = fs.realpathSync(this.attachmentsDir), candidate = path.join(root, storedName);
      if (!fs.existsSync(candidate)) return { error: "arquivo ausente no disco" };
      const real = fs.realpathSync(candidate);
      if (path.dirname(real) !== root || !fs.statSync(real).isFile()) return { error: "caminho inválido" };
      const data = fs.readFileSync(real);
      if (data.length > limit) return { error: "arquivo acima do limite" };
      if (row.sha256 && crypto.createHash("sha256").update(data).digest("hex") !== row.sha256) return { error: "arquivo alterado ou corrompido" };
      return { row, data };
    } catch { return { error: "arquivo ilegível" }; }
  }

  createFromNote(noteId: string, input: { name: string; description?: string; noteTitle?: string }): TemplateSaveResult {
    const note = this.db.prepare("SELECT title,content_html FROM notes WHERE id=?").get(noteId) as { title: string; content_html: string } | undefined;
    if (!note) throw new Error("Nota não encontrada.");
    if ((this.db.prepare("SELECT COUNT(*) AS n FROM note_templates").get() as { n: number }).n >= TEMPLATE_LIMITS.templates) throw new Error(`Limite de ${TEMPLATE_LIMITS.templates} modelos atingido.`);
    const copied = new Map<string, { token: string; row: { id: number; file_name: string; mime_type: string; kind: string }; data: Buffer; annotations: StoredAnnotation[] }>();
    const skipped: TemplateSaveResult["skippedAssets"] = [];
    let total = 0;
    const take = (storedName: string, label: string): string | null => {
      const existing = copied.get(storedName);
      if (existing) return existing.token;
      const read = this.readRegistered(storedName);
      if ("error" in read) { skipped.push({ fileName: label || storedName, reason: read.error }); return null; }
      total += read.data.length;
      if (copied.size + 1 > TEMPLATE_LIMITS.assetsPerTemplate) throw new Error(`O modelo aceita até ${TEMPLATE_LIMITS.assetsPerTemplate} mídias incorporadas.`);
      if (total > TEMPLATE_LIMITS.bytesPerTemplate) throw new Error(`As mídias desta nota somam mais de ${formatBytes(TEMPLATE_LIMITS.bytesPerTemplate)}; o modelo não foi salvo.`);
      const annotations = read.row.mime_type === "application/pdf" ? (this.db.prepare("SELECT page,kind,rect,comment FROM pdf_annotations WHERE attachment_id=? ORDER BY page,created_at,id").all(read.row.id) as { page: number; kind: "highlight" | "comment"; rect: string; comment: string }[]).map(a => ({ page: a.page, kind: a.kind, rect: JSON.parse(a.rect), comment: a.comment })) : [];
      const token = crypto.randomBytes(16).toString("hex");
      copied.set(storedName, { token, row: read.row, data: read.data, annotations });
      return token;
    };
    const html = mapMedia(note.content_html, ref => {
      if (ref.type === "image") {
        if (!ref.src.startsWith(NOTE_ASSET_SCHEME)) return ref.src ? null : undefined;
        const token = take(ref.src.slice(NOTE_ASSET_SCHEME.length), ref.attrs.get("alt") ?? "");
        if (!token) return null;
        const attrs = new Map(ref.attrs); attrs.set("src", `${TEMPLATE_ASSET_SCHEME}${token}`); attrs.delete("data-asset-id");
        return `<img${serializeAttributes(attrs)}>`;
      }
      const token = take(ref.storedName, ref.attrs.get("data-file-name") ?? "");
      if (!token) return null;
      const asset = copied.get(ref.storedName)!;
      const attrs = new Map(ref.attrs); attrs.set("data-stored-name", `${TEMPLATE_ASSET_SCHEME}${token}`); attrs.set("data-attachment-id", "0");
      return `<figure${serializeAttributes(attrs)}><figcaption>${escapeHtml(asset.row.file_name)}</figcaption></figure>`;
    });
    const allTemplateBytes = Number((this.db.prepare("SELECT COALESCE(SUM(byte_size),0) AS n FROM note_template_assets").get() as { n: number }).n);
    if (allTemplateBytes + total > TEMPLATE_LIMITS.totalBytes) throw new Error(`Os modelos com mídia ultrapassariam ${formatBytes(TEMPLATE_LIMITS.totalBytes)} no total; exclua modelos antigos.`);
    const id = crypto.randomUUID(), now = Date.now();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO note_templates(id,name,description,note_title,content_html,content_text,builtin_key,created_at,updated_at) VALUES(?,?,?,?,?,?,NULL,?,?)").run(id, input.name.trim(), (input.description ?? "").trim(), input.noteTitle ?? note.title, html, extractVisibleText(html), now, now);
      const add = this.db.prepare("INSERT INTO note_template_assets(template_id,token,file_name,mime_type,kind,sha256,byte_size,data,annotations) VALUES(?,?,?,?,?,?,?,?,?)");
      for (const a of copied.values()) add.run(id, a.token, a.row.file_name, a.row.mime_type, a.row.kind === "image" ? "image" : "file", crypto.createHash("sha256").update(a.data).digest("hex"), a.data.length, a.data, JSON.stringify(a.annotations));
    })();
    return { template: this.meta(this.row(id)!), copiedAssets: copied.size, skippedAssets: skipped };
  }

  update(id: string, patch: { name?: string; description?: string; noteTitle?: string }): NoteTemplateMeta | null {
    if (!this.row(id)) return null;
    this.db.prepare("UPDATE note_templates SET name=COALESCE(?,name),description=COALESCE(?,description),note_title=COALESCE(?,note_title),updated_at=? WHERE id=?").run(patch.name?.trim() ?? null, patch.description?.trim() ?? null, patch.noteTitle ?? null, Date.now(), id);
    return this.meta(this.row(id)!);
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM note_templates WHERE id=?").run(id).changes > 0;
  }

  restoreBuiltins(): number {
    return this.db.transaction(() => seedBuiltinTemplates(this.db))();
  }

  /**
   * Cria uma nota nova a partir do modelo. Arquivos são gravados com nomes
   * novos antes da transação; se qualquer passo falhar, a transação desfaz o
   * banco e os arquivos recém-criados são removidos. Nada existente é tocado.
   */
  apply(id: string, notebookId: number | null, now = new Date()): string {
    const row = this.row(id);
    if (!row) throw new Error("Modelo não encontrado.");
    if (notebookId !== null && !this.db.prepare("SELECT 1 FROM notebooks WHERE id=?").get(notebookId)) notebookId = null;
    const assets = this.db.prepare("SELECT * FROM note_template_assets WHERE template_id=? ORDER BY rowid").all(id) as AssetRow[];
    const written: string[] = [];
    const planned = new Map<string, { asset: AssetRow; storedName: string; attachmentId?: number }>();
    try {
      fs.mkdirSync(this.attachmentsDir, { recursive: true });
      for (const asset of assets) {
        if (crypto.createHash("sha256").update(asset.data).digest("hex") !== asset.sha256) throw new Error(`Mídia do modelo corrompida: ${asset.file_name}`);
        const storedName = storedNameFor(asset.kind, asset.mime_type, asset.file_name);
        const dest = path.join(this.attachmentsDir, storedName), stage = `${dest}.${crypto.randomUUID()}.stage`;
        fs.writeFileSync(stage, asset.data, { flag: "wx" });
        try { fs.renameSync(stage, dest); } catch (error) { fs.rmSync(stage, { force: true }); throw error; }
        written.push(dest);
        planned.set(asset.token, { asset, storedName });
      }
      const date = todayLabel(now);
      const noteId = crypto.randomUUID(), stamp = now.getTime();
      this.db.transaction(() => {
        this.db.prepare("INSERT INTO notes(id,notebook_id,title,content_html,content_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(noteId, notebookId, row.note_title.replace(/\{\{data\}\}/g, date).slice(0, 300), "", "", stamp, stamp);
        const insert = this.db.prepare("INSERT INTO attachments(note_id,file_name,stored_name,byte_size,created_at,mime_type,sha256,kind) VALUES(?,?,?,?,?,?,?,?)");
        const annotate = this.db.prepare("INSERT INTO pdf_annotations(id,attachment_id,page,kind,rect,comment,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
        for (const item of planned.values()) {
          item.attachmentId = Number(insert.run(noteId, item.asset.file_name, item.storedName, item.asset.byte_size, stamp, item.asset.mime_type, item.asset.sha256, item.asset.kind).lastInsertRowid);
          for (const a of JSON.parse(item.asset.annotations) as unknown[]) {
            const parsed = AnnotationSchema.parse(a);
            annotate.run(crypto.randomUUID(), item.attachmentId, parsed.page, parsed.kind, JSON.stringify(parsed.rect), parsed.comment, stamp, stamp);
          }
        }
        const tokenOf = (value: string) => value.startsWith(TEMPLATE_ASSET_SCHEME) ? value.slice(TEMPLATE_ASSET_SCHEME.length) : null;
        const html = mapMedia(row.content_html, ref => {
          if (ref.type === "image") {
            if (ref.src.startsWith(NOTE_ASSET_SCHEME)) return null;
            const token = tokenOf(ref.src);
            if (token === null) return undefined;
            const item = planned.get(token);
            if (!item) return null;
            const attrs = new Map(ref.attrs); attrs.set("src", `${NOTE_ASSET_SCHEME}${item.storedName}`);
            return `<img${serializeAttributes(attrs)}>`;
          }
          const token = tokenOf(ref.storedName);
          const item = token ? planned.get(token) : undefined;
          if (!item) return null;
          const attrs = new Map(ref.attrs);
          attrs.set("data-stored-name", item.storedName); attrs.set("data-attachment-id", String(item.attachmentId)); attrs.set("data-file-name", item.asset.file_name); attrs.set("data-mime-type", item.asset.mime_type); attrs.set("data-byte-size", String(item.asset.byte_size));
          return `<figure${serializeAttributes(attrs)}><figcaption>${escapeHtml(item.asset.file_name)}</figcaption></figure>`;
        }).replace(/\{\{data\}\}/g, date);
        this.db.prepare("UPDATE notes SET content_html=?,content_text=? WHERE id=?").run(html, extractVisibleText(html), noteId);
      })();
      return noteId;
    } catch (error) {
      for (const file of written) fs.rmSync(file, { force: true });
      throw error;
    }
  }

  dumpForBackup(): BackupTemplate[] {
    const rows = this.db.prepare("SELECT * FROM note_templates ORDER BY created_at,id").all() as TemplateRow[];
    const assetStmt = this.db.prepare("SELECT * FROM note_template_assets WHERE template_id=? ORDER BY rowid");
    return rows.map(r => ({
      id: r.id, name: r.name, description: r.description, noteTitle: r.note_title, contentHtml: r.content_html, builtinKey: r.builtin_key, createdAt: r.created_at, updatedAt: r.updated_at,
      assets: (assetStmt.all(r.id) as AssetRow[]).map(a => ({ token: a.token, fileName: a.file_name, mimeType: a.mime_type, kind: a.kind, sha256: a.sha256, byteSize: a.byte_size, dataBase64: a.data.toString("base64"), annotations: JSON.parse(a.annotations) })),
    }));
  }
}

/** Valida modelos de um backup sem tocar no banco. Retorna dados decodificados ou um erro. */
export function validateBackupTemplates(value: unknown, inspectImage: (data: Buffer) => string): { ok: true; templates: (BackupTemplate & { decoded: Buffer[] })[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, templates: [] };
  if (!Array.isArray(value) || value.length > TEMPLATE_LIMITS.templates) return { ok: false, error: "lista de modelos inválida" };
  const ids = new Set<string>(), keys = new Set<string>();
  const out: (BackupTemplate & { decoded: Buffer[] })[] = [];
  let total = 0;
  for (const raw of value as BackupTemplate[]) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "modelo inválido" };
    if (typeof raw.id !== "string" || !z.guid().safeParse(raw.id).success || ids.has(raw.id)) return { ok: false, error: "modelo com id inválido ou duplicado" };
    if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 120 || typeof raw.description !== "string" || raw.description.length > 500 || typeof raw.noteTitle !== "string" || raw.noteTitle.length > 300 || typeof raw.contentHtml !== "string" || raw.contentHtml.length > 2_000_000) return { ok: false, error: `modelo “${String(raw.name).slice(0, 60)}” com campos inválidos` };
    if (raw.builtinKey !== null && (typeof raw.builtinKey !== "string" || raw.builtinKey.length > 60 || keys.has(raw.builtinKey))) return { ok: false, error: "chave de modelo pronto inválida" };
    if (!Number.isFinite(raw.createdAt) || !Number.isFinite(raw.updatedAt) || !Array.isArray(raw.assets) || raw.assets.length > TEMPLATE_LIMITS.assetsPerTemplate) return { ok: false, error: "modelo com metadados inválidos" };
    const tokens = new Set<string>(), decoded: Buffer[] = [];
    for (const a of raw.assets) {
      if (!a || typeof a.token !== "string" || !TOKEN_RE.test(a.token) || tokens.has(a.token) || typeof a.fileName !== "string" || !a.fileName || a.fileName.length > 300 || typeof a.mimeType !== "string" || !/^[-\w.+]+\/[-\w.+]+$/.test(a.mimeType) || !["image", "file"].includes(a.kind) || typeof a.dataBase64 !== "string" || typeof a.sha256 !== "string") return { ok: false, error: "mídia de modelo inválida" };
      const data = Buffer.from(a.dataBase64, "base64");
      if (data.toString("base64") !== a.dataBase64 || data.length !== a.byteSize || data.length > (a.kind === "image" ? TEMPLATE_LIMITS.imageBytes : TEMPLATE_LIMITS.fileBytes) || crypto.createHash("sha256").update(data).digest("hex") !== a.sha256) return { ok: false, error: `hash/bytes da mídia ${a.fileName.slice(0, 80)} do modelo não conferem` };
      if (a.kind === "image") { try { if (inspectImage(data) !== a.mimeType) return { ok: false, error: `MIME da imagem ${a.fileName.slice(0, 80)} do modelo não confere` }; } catch (e) { return { ok: false, error: String(e) }; } }
      if (!Array.isArray(a.annotations) || a.annotations.length > 10000 || a.annotations.some(x => !AnnotationSchema.safeParse(x).success)) return { ok: false, error: "marcações de PDF do modelo inválidas" };
      total += data.length;
      if (total > TEMPLATE_LIMITS.totalBytes) return { ok: false, error: "mídias de modelos acima do limite total" };
      tokens.add(a.token); decoded.push(data);
    }
    ids.add(raw.id); if (raw.builtinKey) keys.add(raw.builtinKey);
    out.push({ ...raw, decoded });
  }
  return { ok: true, templates: out };
}

/** Restaura modelos validados (dentro da transação do backup). */
export function restoreBackupTemplates(db: Database.Database, templates: (BackupTemplate & { decoded: Buffer[] })[]): number {
  let restored = 0;
  for (const t of templates) {
    if (t.builtinKey) {
      const local = db.prepare("SELECT id FROM note_templates WHERE builtin_key=?").get(t.builtinKey) as { id: string } | undefined;
      if (local && local.id !== t.id) continue; // o perfil já tem o próprio modelo pronto equivalente
    }
    db.prepare("INSERT INTO note_templates(id,name,description,note_title,content_html,content_text,builtin_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,note_title=excluded.note_title,content_html=excluded.content_html,content_text=excluded.content_text,builtin_key=excluded.builtin_key,created_at=excluded.created_at,updated_at=excluded.updated_at")
      .run(t.id, t.name.trim(), t.description, t.noteTitle, t.contentHtml, extractVisibleText(t.contentHtml), t.builtinKey, t.createdAt, t.updatedAt);
    db.prepare("DELETE FROM note_template_assets WHERE template_id=?").run(t.id);
    const add = db.prepare("INSERT INTO note_template_assets(template_id,token,file_name,mime_type,kind,sha256,byte_size,data,annotations) VALUES(?,?,?,?,?,?,?,?,?)");
    t.assets.forEach((a, i) => add.run(t.id, a.token, a.fileName, a.mimeType, a.kind, a.sha256, a.byteSize, t.decoded[i], JSON.stringify(a.annotations)));
    restored++;
  }
  return restored;
}
