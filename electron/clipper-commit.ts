import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { extractVisibleText } from "../shared/text";
import { normalizeTagName, tagKey } from "../shared/tags";

export interface ClipCommitInput {
  requestId: string;
  notebookId: number | null;
  title: string;
  contentHtml: string;
  sourceUrl: string;
  canonicalUrl: string;
  mode: string;
  contentHash: string;
  confirmNew: boolean;
  appendToNoteId: string | null;
  tags: string[];
}

export interface ClipCommitResult {
  duplicate: boolean;
  idempotent: boolean;
  trashed: boolean;
  title: string;
  noteId: string;
}

const ready = new WeakSet<Database.Database>();

/** Colunas aditivas, sem nova versão de migração: o backup v9 continua igual. */
export function ensureClipColumns(db: Database.Database): void {
  if (ready.has(db)) return;
  const names = new Set((db.prepare("PRAGMA table_info(clipper_sources)").all() as { name: string }[]).map(column => column.name));
  if (!names.has("request_id")) db.exec("ALTER TABLE clipper_sources ADD COLUMN request_id TEXT;");
  if (!names.has("content_hash")) db.exec("ALTER TABLE clipper_sources ADD COLUMN content_hash TEXT;");
  if (!names.has("mode")) db.exec("ALTER TABLE clipper_sources ADD COLUMN mode TEXT;");
  if (!names.has("canonical_url")) db.exec("ALTER TABLE clipper_sources ADD COLUMN canonical_url TEXT;");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_clipper_request ON clipper_sources(request_id) WHERE request_id IS NOT NULL;");
  ready.add(db);
}

function insertSource(db: Database.Database, input: ClipCommitInput, noteId: string, capturedAt: number): void {
  const sourceKey = crypto.createHash("sha256").update(`caderno-clip:${input.requestId}`).digest("hex");
  db.prepare(`INSERT INTO clipper_sources(source_key, note_id, source_url, source_title, captured_at, request_id, content_hash, mode, canonical_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sourceKey, noteId, input.sourceUrl, input.title, capturedAt, input.requestId, input.contentHash, input.mode, input.canonicalUrl);
}

function attachTags(db: Database.Database, noteId: string, names: string[]): void {
  const seen = new Set<string>();
  const byKey = new Map((db.prepare("SELECT id, name FROM tags").all() as { id: number; name: string }[]).map(row => [tagKey(row.name), row.id]));
  const insertTag = db.prepare("INSERT INTO tags (name) VALUES (?)");
  const attach = db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)");
  for (const raw of names) {
    const name = normalizeTagName(raw);
    if (!name || name.length > 80) continue;
    const key = tagKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 8) break;
    let id = byKey.get(key);
    if (!id) {
      try {
        id = Number(insertTag.run(name).lastInsertRowid);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("UNIQUE")) throw error;
        const found = (db.prepare("SELECT id, name FROM tags").all() as { id: number; name: string }[]).find(row => tagKey(row.name) === key);
        if (!found) throw error;
        id = found.id;
      }
      byKey.set(key, id);
    }
    attach.run(noteId, id);
  }
}

/**
 * Cria ou acrescenta a captura numa transação. O mesmo requestId devolve a nota
 * já gravada. Artigo, página e favorito da mesma URL canônica são duplicados
 * até haver confirmação explícita. Outra seleção, com outro hash, é uma nota nova.
 * Nota na lixeira não bloqueia. Falha no registro de origem desfaz a nota.
 */
export function commitClipCapture(db: Database.Database, input: ClipCommitInput): ClipCommitResult {
  ensureClipColumns(db);
  return db.transaction(() => {
    const prior = db.prepare(`SELECT c.note_id AS noteId, n.title AS title, n.deleted_at AS deletedAt
      FROM clipper_sources c JOIN notes n ON n.id = c.note_id WHERE c.request_id = ?`).get(input.requestId) as { noteId: string; title: string; deletedAt: number | null } | undefined;
    if (prior) return { duplicate: false, idempotent: true, trashed: prior.deletedAt !== null, title: prior.title, noteId: prior.noteId };

    if (input.notebookId !== null && !db.prepare("SELECT 1 FROM notebooks WHERE id = ?").get(input.notebookId)) throw new Error("NOTEBOOK_NOT_FOUND");

    if (input.appendToNoteId) {
      const target = db.prepare("SELECT id, title, content_html AS contentHtml, deleted_at AS deletedAt FROM notes WHERE id = ?").get(input.appendToNoteId) as { id: string; title: string; contentHtml: string; deletedAt: number | null } | undefined;
      if (!target) throw new Error("NOTE_NOT_FOUND");
      if (target.deletedAt !== null) throw new Error("NOTE_TRASHED");
      const next = `${target.contentHtml}${input.contentHtml}`;
      const now = Date.now();
      db.prepare("UPDATE notes SET content_html = ?, content_text = ?, updated_at = ? WHERE id = ?").run(next, extractVisibleText(next), now, target.id);
      insertSource(db, input, target.id, now);
      attachTags(db, target.id, input.tags);
      return { duplicate: false, idempotent: false, trashed: false, title: target.title, noteId: target.id };
    }

    if (!input.confirmNew) {
      const rows = db.prepare(`SELECT c.note_id AS noteId, n.title AS title, c.content_hash AS contentHash, c.mode AS mode
        FROM clipper_sources c JOIN notes n ON n.id = c.note_id
        WHERE n.deleted_at IS NULL AND (c.source_url = ? OR c.source_url = ? OR c.canonical_url = ? OR c.canonical_url = ?)`)
        .all(input.sourceUrl, input.canonicalUrl, input.sourceUrl, input.canonicalUrl) as { noteId: string; title: string; contentHash: string | null; mode: string | null }[];
      const match = input.mode === "selection" ? rows.find(row => row.contentHash === input.contentHash) : rows.find(row => row.mode !== "selection");
      if (match) return { duplicate: true, idempotent: false, trashed: false, title: match.title, noteId: match.noteId };
    }

    const now = Date.now();
    const noteId = crypto.randomUUID();
    db.prepare(`INSERT INTO notes (id, notebook_id, folder_id, title, content_html, content_text, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`).run(noteId, input.notebookId, input.title, input.contentHtml, extractVisibleText(input.contentHtml), now, now);
    insertSource(db, input, noteId, now);
    attachTags(db, noteId, input.tags);
    return { duplicate: false, idempotent: false, trashed: false, title: input.title, noteId };
  })();
}

export function listClipTags(db: Database.Database): { id: number; name: string }[] {
  return db.prepare("SELECT id, name FROM tags ORDER BY name COLLATE NOCASE").all() as { id: number; name: string }[];
}

export function searchClipTitles(db: Database.Database, query: string): { id: string; title: string; notebook: string | null }[] {
  const needle = query.trim().slice(0, 80);
  if (needle.length < 2) return [];
  const like = `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
  return db.prepare(`SELECT n.id AS id, n.title AS title, nb.name AS notebook
    FROM notes n LEFT JOIN notebooks nb ON nb.id = n.notebook_id
    WHERE n.deleted_at IS NULL AND (n.title LIKE ? ESCAPE '\\' OR n.id = ?)
    ORDER BY n.updated_at DESC LIMIT 8`).all(like, needle) as { id: string; title: string; notebook: string | null }[];
}
