import { nextOccurrence } from '../../shared/recurrence';
import { localDateTimeInZone } from '../../shared/zoned-time';
import type { ChannelInputs, Task } from '../../shared/ipc';
import Database from "better-sqlite3";
import { NoteFull, NoteMeta, ListNotesQuery, Notebook, Tag, SidebarCounts, SortOrder, NoteFolder, NoteLinkTarget, AttachmentJob } from "../../shared/ipc";
import { extractPreviewHtml, extractVisibleText } from "./db";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseSearchQuery, toFtsExpression } from "../../shared/search";
import { normalizeNotebookColor, normalizeNotebookDescription, normalizeNotebookIcon, normalizeNotebookLabels, parseStoredLabels, sanitizeNotebookCustomization, type CustomizeNotebookInput } from "../../shared/notebook-customization";
import {CustomizeNotebookInputSchema} from "../../shared/notebook-customization-schema";
import { normalizeTagName, tagKey } from "../../shared/tags";
import { commitClipCapture, listClipTags, searchClipTitles, type ClipCommitInput, type ClipCommitResult } from "../clipper-commit";

interface NoteRow {
  id: string;
  notebook_id: number | null;
  folder_id?: string | null;
  title: string;
  content_html: string;
  content_text: string;
  favorited: number;
  pinned: number;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

let uidCounter = 0;
export function uuid(): string {
  void uidCounter;
  return crypto.randomUUID();
}

const ORDER: Record<SortOrder, string> = {
  updated_desc: "pinned DESC, updated_at DESC",
  updated_asc: "updated_at ASC",
  created_desc: "created_at DESC",
  title_asc: "title COLLATE NOCASE ASC",
};

const META_COLS = `n.id, n.notebook_id, n.folder_id, n.title, n.favorited, n.pinned, n.deleted_at, n.created_at, n.updated_at, n.content_text`;

function tagsForNotes(db: Database.Database, ids: string[]): Map<string, { id: number; name: string; color: string | null }[]> {
  const out = new Map<string, { id: number; name: string; color: string | null }[]>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT nt.note_id, t.id, t.name, t.color FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
       WHERE nt.note_id IN (${placeholders}) ORDER BY t.name COLLATE NOCASE`
    )
    .all(...ids) as { note_id: string; id: number; name: string; color: string | null }[];
  for (const r of rows) {
    const list = out.get(r.note_id) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    out.set(r.note_id, list);
  }
  return out;
}

function toMeta(db: Database.Database, rows: NoteRow[]): NoteMeta[] {
  const tags = tagsForNotes(db, rows.map(r => r.id));
  return rows.map(r => ({
    id: r.id,
    notebookId: r.notebook_id,
    folderId: r.folder_id ?? null,
    title: r.title,
    favorited: r.favorited === 1,
    pinned: r.pinned === 1,
    tags: tags.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    preview: extractPreviewHtml(r.content_text),
  }));
}

export class NotesRepo {
  constructor(private db: Database.Database) {}

  list(q: ListNotesQuery): NoteMeta[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.view === "trash") {
      where.push("n.deleted_at IS NOT NULL");
    } else {
      where.push("n.deleted_at IS NULL");
    }
    if (q.view === "favorites") where.push("n.favorited = 1");
    if (q.view === "notebook" && q.notebookId !== undefined) {
      where.push("n.notebook_id = ?");
      params.push(q.notebookId);
    }
    if (q.view === "folder" && q.folderId) {
      where.push("n.folder_id = ?");
      params.push(q.folderId);
    }
    if (q.view === "unfiled") {
      where.push("n.notebook_id IS NULL");
    }
    if (q.view === "tag" && q.tagId !== undefined) {
      where.push("EXISTS (SELECT 1 FROM note_tags nt2 WHERE nt2.note_id = n.id AND nt2.tag_id = ?)");
      params.push(q.tagId);
    }
    if (q.query && q.query.trim()) {
      const parsed = parseSearchQuery(q.query);
      const expression = toFtsExpression(parsed.text);
      if (parsed.text && !expression) return [];
      if (expression) {
        if (parsed.type === "attachment") {
          where.push("n.id IN (SELECT note_id FROM attachment_text_fts WHERE attachment_text_fts MATCH ?)"); params.push(expression);
        } else if (parsed.type === "transcription") {
          where.push("n.id IN (SELECT note_id FROM attachment_text_fts WHERE attachment_text_fts MATCH ? AND source_kind='transcription')"); params.push(expression);
        } else if (parsed.type === "note") {
          where.push("n.id IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?)"); params.push(expression);
        } else {
          where.push("(n.id IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?) OR n.id IN (SELECT note_id FROM attachment_text_fts WHERE attachment_text_fts MATCH ?))"); params.push(expression, expression);
        }
      } else if (parsed.type === "attachment") {
        where.push("EXISTS (SELECT 1 FROM attachment_text_fts af WHERE af.note_id=n.id)");
      } else if (parsed.type === "transcription") {
        where.push("EXISTS (SELECT 1 FROM attachment_text_fts af WHERE af.note_id=n.id AND af.source_kind='transcription')");
      }
      if (parsed.notebook) {
        where.push("EXISTS (SELECT 1 FROM notebooks sn WHERE sn.id=n.notebook_id AND sn.name LIKE ? ESCAPE '\\' COLLATE NOCASE)");
        params.push(`%${parsed.notebook.replace(/[\\%_]/g, "\\$&")}%`);
      }
      for (const tag of parsed.tags) {
        where.push("EXISTS (SELECT 1 FROM note_tags st JOIN tags t ON t.id=st.tag_id WHERE st.note_id=n.id AND t.name LIKE ? ESCAPE '\\' COLLATE NOCASE)");
        params.push(`%${tag.replace(/[\\%_]/g, "\\$&")}%`);
      }
      if (parsed.before) { where.push("n.created_at < ?"); params.push(Date.parse(`${parsed.before}T00:00:00.000Z`)); }
      if (parsed.after) { where.push("n.created_at >= ?"); params.push(Date.parse(`${parsed.after}T00:00:00.000Z`)); }
    }
    const sql = `SELECT ${META_COLS} FROM notes n WHERE ${where.join(" AND ")} ORDER BY ${ORDER[q.order ?? "updated_desc"]}`;
    const rows = this.db.prepare(sql).all(...params) as unknown as NoteRow[];
    const results=toMeta(this.db, rows);
    if(q.query?.trim()) {
      const parsed=parseSearchQuery(q.query), expression=toFtsExpression(parsed.text);
      if(expression && parsed.type!=='note') for(const item of results){
        const kind=parsed.type==='transcription'?" AND source_kind='transcription'":"";
        const hit=this.db.prepare(`SELECT source_name AS sourceName,source_kind AS sourceKind,snippet(attachment_text_fts,4,'','', '…',14) AS snippet FROM attachment_text_fts WHERE attachment_text_fts MATCH ? AND note_id=?${kind} LIMIT 1`).get(expression,item.id) as {sourceName:string;sourceKind:"transcription"|"attachment"|"text"|"pdf"|"ocr";snippet:string}|undefined;
        if(hit){item.matchSource=hit.sourceName;item.matchSourceKind=hit.sourceKind==='transcription'?'transcription':'attachment';item.matchSnippet=hit.snippet;}
      }
    }
    return results;
  }

  get(id: string): NoteFull | null {
    const row = this.db.prepare(`SELECT n.* FROM notes n WHERE n.id = ?`).get(id) as NoteRow | undefined;
    if (!row) return null;
    const [meta] = toMeta(this.db, [row]);
    return { ...meta, contentHtml: row.content_html };
  }

  search(query:string,limit:number):NoteMeta[]{
    if(!query.trim())return toMeta(this.db,this.db.prepare(`SELECT ${META_COLS} FROM notes n WHERE n.deleted_at IS NULL ORDER BY ${ORDER.updated_desc} LIMIT ?`).all(limit) as NoteRow[]);
    const results=this.list({view:'all',query});
    const parsed=parseSearchQuery(query),expression=toFtsExpression(parsed.text);
    if(expression&&parsed.type!=='attachment'&&parsed.type!=='transcription'){
      const ranked=this.db.prepare("SELECT note_id AS id, bm25(notes_fts,0,8.0,1.0) AS rank FROM notes_fts WHERE notes_fts MATCH ?").all(expression) as {id:string;rank:number}[];
      const ranks=new Map(ranked.map(row=>[row.id,row.rank]));
      results.sort((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity));
    }
    const limited=results.slice(0,limit);
    if(expression)for(const item of limited){
      const hit=this.db.prepare("SELECT snippet(notes_fts,2,'','','…',14) AS text FROM notes_fts WHERE notes_fts MATCH ? AND note_id=? LIMIT 1").get(expression,item.id) as {text:string}|undefined;
      if(hit&&!item.matchSource)item.matchSnippet=hit.text;
    }
    return limited;
  }
  backlinks(id:string):NoteLinkTarget[]{
    const rows=this.db.prepare('SELECT id,title,content_html,content_text FROM notes WHERE deleted_at IS NULL AND id<>? AND content_html LIKE ? ORDER BY updated_at DESC').all(id,`%caderno-note://${id}%`) as {id:string;title:string;content_html:string;content_text:string}[];
    const href=new RegExp(`href\\s*=\\s*["']caderno-note://${id}["']`,'i');
    return rows.filter(r=>href.test(r.content_html)).map(r=>({id:r.id,title:r.title,preview:extractPreviewHtml(r.content_text)}));
  }

  find(query: string, limit: number): NoteLinkTarget[] {
    const expression = toFtsExpression(query.trim());
    if (!expression) return [];
    const rows = this.db.prepare(`SELECT n.id,n.title,n.content_text FROM notes n
      JOIN notes_fts ON notes_fts.note_id=n.id
      WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
      ORDER BY bm25(notes_fts,0,8.0,1.0),n.updated_at DESC LIMIT ?`)
      .all(expression, limit) as { id: string; title: string; content_text: string }[];
    return rows.map(r => ({ id: r.id, title: r.title || "Sem título", preview: extractPreviewHtml(r.content_text) }));
  }

  update(id: string, patch: { title?: string; contentHtml?: string }): NoteFull | null {
    const existing = this.db.prepare("SELECT id FROM notes WHERE id = ?").get(id);
    if (!existing) return null;
    const nextTitle = patch.title !== undefined ? patch.title : undefined;
    const nextHtml = patch.contentHtml !== undefined ? patch.contentHtml : undefined;
    const text = nextHtml !== undefined ? extractVisibleText(nextHtml) : undefined;
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE notes SET
           title = COALESCE(?, title),
           content_html = COALESCE(?, content_html),
           content_text = COALESCE(?, content_text),
           updated_at = ?
         WHERE id = ?`
      )
      .run(nextTitle ?? null, nextHtml ?? null, text ?? null, now, id);
    return this.get(id);
  }

  create(input: { notebookId?: number | null; folderId?: string | null; title?: string; contentHtml?: string }): NoteFull {
    const id = uuid();
    const now = Date.now();
    const placed = this.resolveFolder(input.notebookId ?? null, input.folderId ?? null);
    this.db
      .prepare(
        `INSERT INTO notes (id, notebook_id, folder_id, title, content_html, content_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        placed.notebookId,
        placed.folderId,
        input.title ?? "",
        input.contentHtml ?? "",
        input.contentHtml ? extractVisibleText(input.contentHtml) : "",
        now,
        now
      );
    const created = this.get(id);
    if (!created) throw new Error("Falha ao criar nota");
    return created;
  }

  findByClipSource(sourceUrl: string): { title: string } | null {
    return this.db.prepare("SELECT n.title FROM clipper_sources c JOIN notes n ON n.id=c.note_id WHERE c.source_url=? AND n.deleted_at IS NULL ORDER BY c.captured_at DESC LIMIT 1").get(sourceUrl) as { title: string } | null;
  }
  recordClipSource(noteId: string, sourceUrl: string, sourceTitle: string): void {
    this.db.prepare("INSERT INTO clipper_sources(source_key,note_id,source_url,source_title,captured_at) VALUES(?,?,?,?,?)").run(crypto.createHash("sha256").update(sourceUrl).digest("hex"), noteId, sourceUrl, sourceTitle, Date.now());
  }
  commitClip(input: ClipCommitInput): ClipCommitResult {
    return commitClipCapture(this.db, input);
  }
  listClipTags(): { id: number; name: string }[] {
    return listClipTags(this.db);
  }
  searchClipTitles(query: string): { id: string; title: string; notebook: string | null }[] {
    return searchClipTitles(this.db, query);
  }

  /** A pasta só permanece se pertencer ao caderno de destino. Sem caderno, a nota fica sem pasta. */
  private resolveFolder(notebookId: number | null, folderId: string | null): { notebookId: number | null; folderId: string | null } {
    if (!folderId) return { notebookId, folderId: null };
    const folder = this.db.prepare("SELECT notebook_id AS notebookId FROM note_folders WHERE id=?").get(folderId) as { notebookId: number } | undefined;
    if (!folder) throw new Error("Pasta não encontrada.");
    if (notebookId !== null && notebookId !== folder.notebookId) throw new Error("A pasta não pertence a este caderno.");
    return { notebookId: folder.notebookId, folderId };
  }

  move(id: string, notebookId: number | null): NoteFull | null {
    this.db.prepare(`UPDATE notes SET notebook_id=?, folder_id=CASE
        WHEN ? IS NULL THEN NULL
        WHEN EXISTS (SELECT 1 FROM note_folders f WHERE f.id=notes.folder_id AND f.notebook_id=?) THEN folder_id
        ELSE NULL END, updated_at=? WHERE id=?`).run(notebookId, notebookId, notebookId, Date.now(), id);
    return this.get(id);
  }

  moveToFolder(id: string, folderId: string | null): NoteFull | null {
    if (!this.db.prepare("SELECT 1 FROM notes WHERE id=?").get(id)) return null;
    if (folderId === null) {
      this.db.prepare("UPDATE notes SET folder_id=NULL, updated_at=? WHERE id=?").run(Date.now(), id);
      return this.get(id);
    }
    const folder = this.db.prepare("SELECT notebook_id AS notebookId FROM note_folders WHERE id=?").get(folderId) as { notebookId: number } | undefined;
    if (!folder) return null;
    this.db.prepare("UPDATE notes SET notebook_id=?, folder_id=?, updated_at=? WHERE id=?").run(folder.notebookId, folderId, Date.now(), id);
    return this.get(id);
  }

  setFlag(id: string, field: "favorited" | "pinned", value: boolean): NoteFull | null {
    this.db.prepare(`UPDATE notes SET ${field} = ? WHERE id = ?`).run(value ? 1 : 0, id);
    return this.get(id);
  }

  softDelete(id: string): NoteFull | null {
    this.db.prepare("UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(Date.now(), id);
    return this.get(id);
  }

  restore(id: string): NoteFull | null {
    this.db.prepare("UPDATE notes SET deleted_at = NULL WHERE id = ?").run(id);
    return this.get(id);
  }

  purge(id: string): boolean {
    const result = this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
    return result.changes > 0;
  }

  emptyTrash(): number {
    return this.db.prepare("DELETE FROM notes WHERE deleted_at IS NOT NULL").run().changes;
  }

  markdownOfNote(id: string): { title: string; contentHtml: string; contentText: string; tags: { id: number; name: string }[]; notebookName: string | null; createdAt: number; updatedAt: number } | null {
    const row = this.db.prepare("SELECT n.*, nb.name AS notebook_name FROM notes n LEFT JOIN notebooks nb ON nb.id = n.notebook_id WHERE n.id = ?").get(id) as (NoteRow & { notebook_name: string | null }) | undefined;
    if (!row) return null;
    const tags = tagsForNotes(this.db, [id]).get(id) ?? [];
    return {
      title: row.title,
      contentHtml: row.content_html,
      contentText: row.content_text,
      tags,
      notebookName: row.notebook_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class AttachmentJobsRepo {
  constructor(private db:Database.Database){}
  recover():void { this.db.prepare("UPDATE attachment_jobs SET status='queued',updated_at=?,error=NULL WHERE status IN ('running','cancel_requested')").run(Date.now()); }
  list():AttachmentJob[]{return this.db.prepare("SELECT j.id,j.attachment_id AS attachmentId,a.note_id AS noteId,a.file_name AS fileName,j.status,j.progress,j.checkpoint,j.total_pages AS totalPages,j.attempts,j.error FROM attachment_jobs j JOIN attachments a ON a.id=j.attachment_id WHERE j.status!='completed' OR j.updated_at>strftime('%s','now')*1000-86400000 ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,j.updated_at DESC LIMIT 100").all() as unknown as AttachmentJob[];}
  next():{id:number;attachmentId:number;fileName:string;storedName:string}|undefined{return this.db.transaction(()=>{const row=this.db.prepare("SELECT j.id,j.attachment_id AS attachmentId,a.file_name AS fileName,a.stored_name AS storedName FROM attachment_jobs j JOIN attachments a ON a.id=j.attachment_id WHERE j.status='queued' ORDER BY j.created_at,j.id LIMIT 1").get() as any;if(row)this.db.prepare("UPDATE attachment_jobs SET status='running',attempts=attempts+1,progress=1,updated_at=? WHERE id=?").run(Date.now(),row.id);return row;})();}
  complete(jobId:number,attachmentId:number,noteId:string,fileName:string,text:string,sourceKind:'text'|'pdf'|'ocr'='text'):void{this.db.transaction(()=>{this.db.prepare("INSERT INTO attachment_text(attachment_id,note_id,source_name,source_kind,content,extractor_version,indexed_at) VALUES(?,?,?,?,?,1,?) ON CONFLICT(attachment_id) DO UPDATE SET note_id=excluded.note_id,source_name=excluded.source_name,source_kind=excluded.source_kind,content=excluded.content,extractor_version=excluded.extractor_version,indexed_at=excluded.indexed_at").run(attachmentId,noteId,fileName,sourceKind,text,Date.now());this.db.prepare("UPDATE attachment_jobs SET status='completed',progress=100,checkpoint=total_pages,error=NULL,updated_at=? WHERE id=?").run(Date.now(),jobId);})();}
  fail(id:number,error:string):void{this.db.prepare("UPDATE attachment_jobs SET status='error',error=?,progress=0,updated_at=? WHERE id=? AND status!='cancel_requested'").run(error.slice(0,500),Date.now(),id);}
  progress(id:number,progress:number,checkpoint:number,totalPages=0):void{this.db.prepare("UPDATE attachment_jobs SET progress=?,checkpoint=?,total_pages=MAX(total_pages,?),updated_at=? WHERE id=? AND status='running'").run(Math.max(1,Math.min(99,progress)),checkpoint,totalPages,Date.now(),id);}
  cancel(id:number):boolean{return this.db.prepare("UPDATE attachment_jobs SET status='cancel_requested',updated_at=? WHERE id=? AND status IN ('queued','running')").run(Date.now(),id).changes>0;}
  retry(id:number):boolean{return this.db.transaction(()=>{const row=this.db.prepare("SELECT attachment_id FROM attachment_jobs WHERE id=?").get(id) as {attachment_id:number}|undefined;if(!row)return false;this.db.prepare("DELETE FROM attachment_text WHERE attachment_id=?").run(row.attachment_id);return this.db.prepare("UPDATE attachment_jobs SET status='queued',progress=0,checkpoint=0,total_pages=0,error=NULL,updated_at=? WHERE id=?").run(Date.now(),id).changes>0;})();}
  reindex():number{return this.db.transaction(()=>{this.db.prepare("DELETE FROM attachment_text").run();this.db.prepare("UPDATE attachment_jobs SET status='queued',progress=0,checkpoint=0,total_pages=0,error=NULL,updated_at=?").run(Date.now());return Number((this.db.prepare("SELECT COUNT(*) AS n FROM attachment_jobs WHERE status='queued'").get() as any).n);})();}
  getAttachment(id:number):{noteId:string;fileName:string;storedName:string}|undefined{return this.db.prepare("SELECT note_id AS noteId,file_name AS fileName,stored_name AS storedName FROM attachments WHERE id=?").get(id) as any;}
}

export interface TranscriptSegment { startMs:number; endMs:number; text:string }
export class TranscriptionsRepo {
  constructor(private db:Database.Database){}
  config(runtime:string,ffmpeg:string){const cli=path.join(runtime,"whisper-cli.exe"),model=path.join(runtime,"models","ggml-tiny.bin");return {runtimeConfigured:fs.existsSync(cli),modelConfigured:fs.existsSync(model)&&fs.statSync(model).size>50_000_000,ffmpegConfigured:fs.existsSync(ffmpeg),runtime,ffmpeg};}
  enqueue(noteId:string,attachmentId:number,language:"pt"|"auto"):string {const a=this.db.prepare("SELECT id FROM attachments WHERE id=? AND note_id=?").get(attachmentId,noteId);if(!a)throw new Error("Anexo de áudio não encontrado nesta nota.");const id=crypto.randomUUID(),now=Date.now();this.db.prepare("INSERT INTO transcription_jobs(id,attachment_id,note_id,status,progress,stage,language,created_at,updated_at) VALUES(?,?,?,'queued',0,'Na fila',?,?,?)").run(id,attachmentId,noteId,language,now,now);return id;}
  list(noteId:string){return this.db.prepare("SELECT id,attachment_id AS attachmentId,note_id AS noteId,status,progress,stage,language,error,created_at AS createdAt,updated_at AS updatedAt FROM transcription_jobs WHERE note_id=? ORDER BY created_at DESC LIMIT 20").all(noteId);}
  queued(){return this.db.prepare("SELECT j.id,j.attachment_id AS attachmentId,j.note_id AS noteId,j.language,a.file_name AS fileName,a.stored_name AS storedName FROM transcription_jobs j JOIN attachments a ON a.id=j.attachment_id WHERE j.status='queued' ORDER BY j.created_at LIMIT 1").get() as any;}
  progress(id:string,status:string,progress:number,stage:string){this.db.prepare("UPDATE transcription_jobs SET status=?,progress=?,stage=?,updated_at=? WHERE id=? AND status IN ('queued','converting','transcribing')").run(status,progress,stage,Date.now(),id);}
  complete(j:any,result:{text:string;segments:TranscriptSegment[];durationMs:number;language:string}){this.db.transaction(()=>{const transcriptId=crypto.randomUUID(),now=Date.now();this.db.prepare("INSERT INTO transcripts(id,attachment_id,note_id,model,language,duration_ms,text,created_at) VALUES(?,?,?,'whisper.cpp b5454 / tiny',?,?,?,?) ON CONFLICT(attachment_id) DO UPDATE SET note_id=excluded.note_id,model=excluded.model,language=excluded.language,duration_ms=excluded.duration_ms,text=excluded.text,created_at=excluded.created_at").run(transcriptId,j.attachmentId,j.noteId,result.language,result.durationMs,result.text,now);const current=this.db.prepare("SELECT id FROM transcripts WHERE attachment_id=?").get(j.attachmentId) as {id:string};this.db.prepare("DELETE FROM transcript_segments WHERE transcript_id=?").run(current.id);const add=this.db.prepare("INSERT INTO transcript_segments(transcript_id,start_ms,end_ms,text) VALUES(?,?,?,?)");for(const s of result.segments)add.run(current.id,s.startMs,s.endMs,s.text);this.db.prepare("INSERT INTO attachment_text(attachment_id,note_id,source_name,source_kind,content,extractor_version,indexed_at) VALUES(?,?,?,'transcription',?,1,?) ON CONFLICT(attachment_id) DO UPDATE SET note_id=excluded.note_id,source_name=excluded.source_name,source_kind='transcription',content=excluded.content,extractor_version=1,indexed_at=excluded.indexed_at").run(j.attachmentId,j.noteId,j.fileName,result.text,now);this.db.prepare("UPDATE transcription_jobs SET status='completed',progress=100,stage='Concluído',error=NULL,updated_at=? WHERE id=?").run(now,j.id);})();}
  settle(id:string,status:"failed"|"canceled",error?:string){this.db.prepare("UPDATE transcription_jobs SET status=?,progress=CASE WHEN ?='canceled' THEN progress ELSE 0 END,stage=?,error=?,updated_at=? WHERE id=?").run(status,status,status==="canceled"?"Cancelado":"Falha",error?.slice(0,500)??null,Date.now(),id);}
  cancel(id:string){return this.db.prepare("UPDATE transcription_jobs SET status='canceled',stage='Cancelado',updated_at=? WHERE id=? AND status IN ('queued','converting','transcribing')").run(Date.now(),id).changes>0;}
  recover():string[]{const active=this.db.prepare("SELECT id FROM transcription_jobs WHERE status IN ('converting','transcribing')").all() as {id:string}[];this.db.prepare("UPDATE transcription_jobs SET status='queued',stage='Retomado após reinício',updated_at=? WHERE status IN ('converting','transcribing')").run(Date.now());return active.map(j=>j.id);}
  get(noteId:string){const t=this.db.prepare("SELECT id,attachment_id AS attachmentId,model,language,duration_ms AS durationMs,text,created_at AS createdAt FROM transcripts WHERE note_id=? ORDER BY created_at DESC").all(noteId) as any[];return t.map(x=>({...x,segments:this.db.prepare("SELECT start_ms AS startMs,end_ms AS endMs,text FROM transcript_segments WHERE transcript_id=? ORDER BY start_ms").all(x.id)}));}
}

export class TasksRepo {
  constructor(private db: Database.Database) {}
  private columns=`t.id,t.note_id AS noteId,n.title AS noteTitle,t.title,t.is_done AS done,t.due_at AS dueAt,t.reminder_at AS reminderAt,t.reminder_state AS reminderState,t.created_at AS createdAt,t.updated_at AS updatedAt,t.recurrence,t.priority,t.time_zone AS timeZone`;
  list(filter:ChannelInputs['tasks:list']['filter'],now=Date.now(),priority='all'):Task[]{
    const d=new Date(now);d.setHours(0,0,0,0);const start=d.getTime(),next=new Date(d);next.setDate(next.getDate()+1);const end=next.getTime(),week=new Date(next);week.setDate(week.getDate()+7);
    let where='n.deleted_at IS NULL';const args:unknown[]=[];
    if(filter==='completed')where+=' AND t.is_done=1';
    if(filter==='today'){where+=' AND t.is_done=0 AND t.due_at>=? AND t.due_at<?';args.push(start,end);}
    if(filter==='upcoming'){where+=' AND t.is_done=0 AND t.due_at>=? AND t.due_at<?';args.push(end,week.getTime());}
    if(filter==='overdue'){where+=' AND t.is_done=0 AND t.due_at<?';args.push(start);}
    if(priority!=='all'){where+=' AND t.priority=?';args.push(priority);}
    return this.db.prepare(`SELECT ${this.columns} FROM tasks t JOIN notes n ON n.id=t.note_id WHERE ${where} ORDER BY t.is_done,CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,t.due_at IS NULL,t.due_at,t.created_at`).all(...args).map((r:any)=>({...r,done:!!r.done}));
  }
  create(x:ChannelInputs['tasks:create']):string{
    const id=uuid(),now=Date.now(),rule=x.recurrence??'none',zone=x.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone;
    if(rule!=='none'&&x.dueAt===null)throw new Error('Defina um prazo para repetir a tarefa.');
    const anchor=x.dueAt===null?null:localDateTimeInZone(x.dueAt,zone);
    this.db.prepare('INSERT INTO tasks(id,note_id,title,due_at,reminder_at,recurrence,priority,time_zone,recurrence_anchor,created_at,updated_at) SELECT ?,id,?,?,?,?,?,?,?,?,? FROM notes WHERE id=? AND deleted_at IS NULL').run(id,x.title,x.dueAt,x.reminderAt,rule,x.priority??'normal',zone,anchor,now,now,x.noteId);
    if(!this.db.prepare('SELECT 1 FROM tasks WHERE id=?').get(id))throw new Error('Nota não encontrada ou na lixeira');return id;
  }
  update(x:ChannelInputs['tasks:update'],now=Date.now()):boolean{return this.db.transaction(()=>{
    const old=this.db.prepare('SELECT * FROM tasks WHERE id=?').get(x.id) as any;if(!old)return false;
    const noteId=x.noteId??old.note_id;
    if(!this.db.prepare('SELECT 1 FROM notes WHERE id=? AND deleted_at IS NULL').get(noteId))throw new Error('Nota não encontrada ou na lixeira');
    const rule=x.recurrence??old.recurrence,due=x.dueAt===undefined?old.due_at:x.dueAt,zone=x.timeZone??old.time_zone,done=x.done===undefined?!!old.is_done:x.done;
    if(rule!=='none'&&due===null)throw new Error('Defina um prazo para repetir a tarefa.');
    const changed=due!==old.due_at||rule!==old.recurrence||zone!==old.time_zone;
    const anchor=due===null?null:changed||!old.recurrence_anchor?localDateTimeInZone(due,zone):old.recurrence_anchor;
    const reminder=x.reminderAt===undefined?old.reminder_at:x.reminderAt;
    this.db.prepare('UPDATE tasks SET note_id=?,title=?,due_at=?,reminder_at=?,is_done=?,reminder_state=?,recurrence=?,priority=?,time_zone=?,recurrence_anchor=?,updated_at=? WHERE id=?').run(noteId,x.title??old.title,due,reminder,done?1:0,x.reminderAt===undefined?old.reminder_state:'pending',rule,x.priority??old.priority,zone,anchor,now,x.id);
    if(done&&!old.is_done&&!old.recurrence_spawned&&rule!=='none'){
      const next=nextOccurrence(rule,anchor,due,now,zone);
      this.db.prepare("INSERT INTO tasks(id,note_id,title,due_at,reminder_at,recurrence,priority,time_zone,recurrence_anchor,recurrence_parent_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(uuid(),noteId,x.title??old.title,next,reminder===null?null:next+(reminder-due),rule,x.priority??old.priority,zone,anchor,x.id,now,now);
      this.db.prepare('UPDATE tasks SET recurrence_spawned=1 WHERE id=?').run(x.id);
    }
    return true;
  })();}
  delete(id:string):boolean{return this.db.prepare('DELETE FROM tasks WHERE id=?').run(id).changes>0;}
  deliverDue(now:number,limit=10):Task[]{return this.db.transaction(()=>{const rows=this.db.prepare("SELECT t.id FROM tasks t JOIN notes n ON n.id=t.note_id WHERE t.is_done=0 AND n.deleted_at IS NULL AND t.reminder_state='pending' AND t.reminder_at<=? ORDER BY t.reminder_at LIMIT ?").all(now,limit) as {id:string}[];return rows.map(r=>{this.db.prepare("UPDATE tasks SET reminder_state='delivered',updated_at=? WHERE id=?").run(now,r.id);const task=this.db.prepare(`SELECT ${this.columns} FROM tasks t JOIN notes n ON n.id=t.note_id WHERE t.id=?`).get(r.id) as Task;return {...task,done:!!task.done}});})();}
}

export class EventsRepo {
  constructor(private db:Database.Database){}
  list(startAt:number,endAt:number):import('../../shared/ipc').CalendarEvent[]{return this.db.prepare('SELECT e.id,e.note_id AS noteId,n.title AS noteTitle,e.title,e.description,e.start_at AS startAt,e.end_at AS endAt,e.time_zone AS timeZone,e.all_day AS allDay,e.created_at AS createdAt,e.updated_at AS updatedAt FROM calendar_events e LEFT JOIN notes n ON n.id=e.note_id WHERE e.start_at<=? AND e.end_at>=? ORDER BY e.start_at').all(endAt,startAt).map((r:any)=>({...r,allDay:!!r.allDay}));}
  create(x:{noteId:string|null;title:string;description:string;startAt:number;endAt:number;timeZone:string;allDay:boolean}):string{if(x.endAt<x.startAt)throw new Error('O fim deve ser igual ou posterior ao início');const id=uuid(),n=Date.now();this.db.prepare('INSERT INTO calendar_events(id,note_id,title,description,start_at,end_at,time_zone,all_day,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,x.noteId,x.title,x.description,x.startAt,x.endAt,x.timeZone,x.allDay?1:0,n,n);return id;}
  update(x:{id:string;noteId?:string|null;title?:string;description?:string;startAt?:number;endAt?:number;timeZone?:string;allDay?:boolean}):boolean{const e=this.db.prepare('SELECT start_at AS startAt,end_at AS endAt FROM calendar_events WHERE id=?').get(x.id) as {startAt:number;endAt:number}|undefined;if(!e)return false;const start=x.startAt??e.startAt,end=x.endAt??e.endAt;if(end<start)throw new Error('O fim deve ser igual ou posterior ao início');this.db.prepare('UPDATE calendar_events SET note_id=CASE WHEN ? THEN ? ELSE note_id END,title=COALESCE(?,title),description=COALESCE(?,description),start_at=?,end_at=?,time_zone=COALESCE(?,time_zone),all_day=COALESCE(?,all_day),updated_at=? WHERE id=?').run(x.noteId!==undefined?1:0,x.noteId??null,x.title??null,x.description??null,start,end,x.timeZone??null,x.allDay===undefined?null:x.allDay?1:0,Date.now(),x.id);return true;}
  delete(id:string):boolean{return this.db.prepare('DELETE FROM calendar_events WHERE id=?').run(id).changes>0;}
}

interface NotebookRow { id: number; name: string; createdAt: number; icon: string | null; color: string | null; description: string | null; labels: string | null; noteCount: number }
const NOTEBOOK_SELECT = `SELECT nb.id, nb.name, nb.created_at AS createdAt, nb.icon, nb.color, nb.description, nb.labels,
  (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.deleted_at IS NULL) AS noteCount FROM notebooks nb`;

/** Linha do banco -> Notebook; valores antigos/ausentes/corrompidos voltam ao padrão. */
function toNotebook(row: NotebookRow): Notebook {
  return {
    id: row.id, name: row.name, createdAt: row.createdAt, noteCount: row.noteCount,
    ...sanitizeNotebookCustomization({ icon: row.icon, color: row.color, description: row.description, labels: parseStoredLabels(row.labels) }),
  };
}

export class NotebooksRepo {
  constructor(private db: Database.Database) {}

  list(): Notebook[] {
    return (this.db.prepare(`${NOTEBOOK_SELECT} ORDER BY nb.name COLLATE NOCASE`).all() as unknown as NotebookRow[]).map(toNotebook);
  }

  get(id: number): Notebook | null {
    const row = this.db.prepare(`${NOTEBOOK_SELECT} WHERE nb.id = ?`).get(id) as NotebookRow | undefined;
    return row ? toNotebook(row) : null;
  }

  create(name: string): Notebook | null {
    try {
      const now = Date.now();
      const result = this.db
        .prepare("INSERT INTO notebooks (name, created_at, updated_at) VALUES (?, ?, ?)")
        .run(name, now, now);
      return this.get(Number(result.lastInsertRowid));
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE")) return null;
      throw err;
    }
  }

  rename(id: number, name: string): Notebook | null {
    try {
      this.db.prepare("UPDATE notebooks SET name = ?, updated_at = ? WHERE id = ?").run(name, Date.now(), id);
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE")) return null;
      throw err;
    }
    return this.get(id);
  }

  /**
   * Atualiza ícone, cor, descrição e etiquetas do caderno. Campos ausentes mantêm
   * o valor atual; `color: null` remove o acento. Retorna null se o caderno não existe.
   */
  customize(input: CustomizeNotebookInput): Notebook | null {
    const parsed = CustomizeNotebookInputSchema.parse(input);
    const sets: string[] = [], params: (string | number | null)[] = [];
    if (parsed.icon !== undefined) { sets.push("icon = ?"); params.push(normalizeNotebookIcon(parsed.icon)); }
    if (parsed.color !== undefined) { sets.push("color = ?"); params.push(parsed.color === null ? null : normalizeNotebookColor(parsed.color)); }
    if (parsed.description !== undefined) { sets.push("description = ?"); params.push(normalizeNotebookDescription(parsed.description)); }
    if (parsed.labels !== undefined) { sets.push("labels = ?"); params.push(JSON.stringify(normalizeNotebookLabels(parsed.labels))); }
    if (sets.length) {
      // As colunas vêm de uma lista fixa acima; os valores sempre são parâmetros.
      const changed = this.db.prepare(`UPDATE notebooks SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...params, Date.now(), parsed.id).changes;
      if (!changed) return null;
    }
    return this.get(parsed.id);
  }

  delete(id: number): boolean {
    return this.db.prepare("DELETE FROM notebooks WHERE id = ?").run(id).changes > 0;
  }
}

export class NoteFoldersRepo {
  constructor(private db: Database.Database) {}
  list(): NoteFolder[] {
    return this.db.prepare(`SELECT f.id, f.notebook_id AS notebookId, f.name, f.sort_order AS sortOrder, f.created_at AS createdAt, f.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM notes n WHERE n.folder_id=f.id AND n.deleted_at IS NULL) AS noteCount
      FROM note_folders f ORDER BY f.sort_order, f.name COLLATE NOCASE`).all() as unknown as NoteFolder[];
  }
  create(notebookId: number, name: string): NoteFolder | null {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) return null;
    const id = uuid(), now = Date.now();
    const sort = ((this.db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM note_folders WHERE notebook_id=?").get(notebookId) as { m: number } | undefined)?.m ?? -1) + 1;
    try { this.db.prepare("INSERT INTO note_folders(id,notebook_id,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, notebookId, trimmed, sort, now, now); }
    catch (e) {
      if (e instanceof Error && e.message.includes("UNIQUE")) return null;
      if (e instanceof Error && e.message.includes("FOREIGN KEY")) throw new Error("Caderno não encontrado.");
      throw e;
    }
    return this.list().find(x => x.id === id) ?? null;
  }
  rename(id: string, name: string): NoteFolder | null {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) return null;
    try {
      const n = this.db.prepare("UPDATE note_folders SET name=?, updated_at=? WHERE id=?").run(trimmed, Date.now(), id);
      if (!n.changes) return null;
    } catch (e) {
      if (e instanceof Error && e.message.includes("UNIQUE")) return null;
      throw e;
    }
    return this.list().find(x => x.id === id) ?? null;
  }
  delete(id: string): boolean { return this.db.prepare("DELETE FROM note_folders WHERE id=?").run(id).changes > 0; }
  /** Move a pasta para outro caderno e leva as notas junto. Nome repetido no destino não altera nada. */
  move(id: string, notebookId: number): NoteFolder | null {
    const folder = this.db.prepare("SELECT id, notebook_id AS notebookId FROM note_folders WHERE id=?").get(id) as { id: string; notebookId: number } | undefined;
    if (!folder) return null;
    if (folder.notebookId === notebookId) return this.list().find(item => item.id === id) ?? null;
    if (!this.db.prepare("SELECT 1 FROM notebooks WHERE id=?").get(notebookId)) throw new Error("Caderno não encontrado.");
    const sort = ((this.db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM note_folders WHERE notebook_id=?").get(notebookId) as { m: number } | undefined)?.m ?? -1) + 1;
    const now = Date.now();
    try {
      this.db.transaction(() => {
        this.db.prepare("UPDATE note_folders SET notebook_id=?, sort_order=?, updated_at=? WHERE id=?").run(notebookId, sort, now, id);
        this.db.prepare("UPDATE notes SET notebook_id=?, updated_at=? WHERE folder_id=?").run(notebookId, now, id);
      })();
    } catch (e) {
      if (e instanceof Error && e.message.includes("UNIQUE")) return null;
      throw e;
    }
    return this.list().find(item => item.id === id) ?? null;
  }
}

export class TagsRepo {
  constructor(private db: Database.Database) {}

  list(): Tag[] {
    return this.db
      .prepare(
        `SELECT t.id, t.name, t.color,
                (SELECT COUNT(*) FROM note_tags nt JOIN notes n ON n.id = nt.note_id
                 WHERE nt.tag_id = t.id AND n.deleted_at IS NULL) AS noteCount
         FROM tags t ORDER BY t.name COLLATE NOCASE`
      )
      .all() as unknown as Tag[];
  }

  setColor(id: number, color: string | null): boolean {
    if (color !== null && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Cor de etiqueta inválida.");
    return this.db.prepare("UPDATE tags SET color=? WHERE id=?").run(color, id).changes > 0;
  }

  create(name: string): Tag | null {
    name = normalizeTagName(name);
    if (!name || name.length > 80) throw new Error("Use um nome de etiqueta entre 1 e 80 caracteres.");
    if (this.hasName(name)) return null;
    try {
      const result = this.db.prepare("INSERT INTO tags (name) VALUES (?)").run(name);
      return { id: Number(result.lastInsertRowid), name, color: null, noteCount: 0 };
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE")) return null;
      throw err;
    }
  }

  private hasName(name: string, exceptId?: number): boolean {
    const rows = this.db.prepare("SELECT id, name FROM tags").all() as { id: number; name: string }[];
    return rows.some(row => row.id !== exceptId && tagKey(row.name) === tagKey(name));
  }

  rename(id: number, name: string): Tag | null {
    name = normalizeTagName(name);
    if (!name || name.length > 80) throw new Error("Use um nome de etiqueta entre 1 e 80 caracteres.");
    if (this.hasName(name, id)) return null;
    if (!this.db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name, id).changes) throw new Error("Etiqueta não encontrada.");
    return this.list().find(tag => tag.id === id) ?? null;
  }

  remove(id: number): boolean {
    return this.db.prepare("DELETE FROM tags WHERE id = ?").run(id).changes > 0;
  }

  attach(noteId: string, tagId: number): boolean {
    try {
      this.db.prepare("INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)").run(noteId, tagId);
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE")) return false;
      throw err;
    }
  }

  detach(noteId: string, tagId: number): boolean {
    return this.db.prepare("DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?").run(noteId, tagId).changes > 0;
  }
}

export class Meta {
  constructor(private db: Database.Database) {}
  get(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }
  set(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }
}

export class CountsRepo {
  constructor(private db: Database.Database) {}
  get(): SidebarCounts {
    const count = (sql: string, ...params: unknown[]) =>
      (this.db.prepare(sql).get(...params) as { c: number }).c;
    return {
      all: count("SELECT COUNT(*) AS c FROM notes WHERE deleted_at IS NULL"),
      favorites: count("SELECT COUNT(*) AS c FROM notes WHERE deleted_at IS NULL AND favorited = 1"),
      trash: count("SELECT COUNT(*) AS c FROM notes WHERE deleted_at IS NOT NULL"),
      unfiled: count("SELECT COUNT(*) AS c FROM notes WHERE deleted_at IS NULL AND notebook_id IS NULL"),
    };
  }
}
