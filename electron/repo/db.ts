import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { seedBuiltinTemplates } from "./templates";

export interface RepositoryFiles {
  database: string;
  attachments: string;
}

const MIGRATIONS = [
  {
    version: 1,
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notebooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          color TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          notebook_id INTEGER REFERENCES notebooks(id) ON DELETE SET NULL,
          title TEXT NOT NULL DEFAULT '',
          content_html TEXT NOT NULL DEFAULT '',
          content_text TEXT NOT NULL DEFAULT '',
          favorited INTEGER NOT NULL DEFAULT 0,
          pinned INTEGER NOT NULL DEFAULT 0,
          deleted_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id);
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE
        );
        CREATE TABLE IF NOT EXISTS note_tags (
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (note_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          file_name TEXT NOT NULL,
          stored_name TEXT NOT NULL,
          byte_size INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE notebook_stacks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL COLLATE NOCASE UNIQUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        ALTER TABLE notebooks ADD COLUMN stack_id TEXT REFERENCES notebook_stacks(id) ON DELETE SET NULL;
        ALTER TABLE notebooks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX idx_notebooks_stack_order ON notebooks(stack_id, sort_order, name COLLATE NOCASE);
      `);
    },
  },
  {
    version: 3,
    up(db: Database.Database): void {
      db.exec(`ALTER TABLE attachments ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'application/octet-stream';
        ALTER TABLE attachments ADD COLUMN sha256 TEXT;
        ALTER TABLE attachments ADD COLUMN kind TEXT NOT NULL DEFAULT 'file';
        CREATE INDEX idx_attachments_note_kind ON attachments(note_id,kind);`);
    },
  },
  {
    version: 4,
    up(db: Database.Database): void {
      db.exec(`CREATE TABLE tasks (
        id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
        is_done INTEGER NOT NULL DEFAULT 0 CHECK(is_done IN (0,1)), due_at INTEGER,
        reminder_at INTEGER, reminder_state TEXT NOT NULL DEFAULT 'pending' CHECK(reminder_state IN ('pending','delivered')),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_tasks_due ON tasks(is_done,due_at);
      CREATE INDEX idx_tasks_reminder ON tasks(reminder_state,reminder_at);
      CREATE TABLE calendar_events (
        id TEXT PRIMARY KEY, note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
        title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300), description TEXT NOT NULL DEFAULT '',
        start_at INTEGER NOT NULL, end_at INTEGER NOT NULL CHECK(end_at>=start_at), time_zone TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0 CHECK(all_day IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_events_range ON calendar_events(start_at,end_at);`);
    },
  },
  {
    version: 5,
    up(db: Database.Database): void {
      db.exec(`
        CREATE VIRTUAL TABLE notes_fts USING fts5(note_id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');
        INSERT INTO notes_fts(note_id,title,body) SELECT id,title,content_text FROM notes;
        CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(note_id,title,body) VALUES(new.id,new.title,new.content_text);
        END;
        CREATE TRIGGER notes_fts_update AFTER UPDATE OF title,content_text ON notes BEGIN
          DELETE FROM notes_fts WHERE note_id=old.id;
          INSERT INTO notes_fts(note_id,title,body) VALUES(new.id,new.title,new.content_text);
        END;
        CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
          DELETE FROM notes_fts WHERE note_id=old.id;
        END;
        CREATE INDEX idx_notes_created ON notes(created_at);
      `);
    },
  },
  {
    version: 6,
    up(db: Database.Database): void {
      db.exec(`
        CREATE TABLE attachment_text (
          attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
          note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          source_name TEXT NOT NULL, source_kind TEXT NOT NULL CHECK(source_kind IN ('text','pdf','ocr','transcription')),
          content TEXT NOT NULL, extractor_version INTEGER NOT NULL, indexed_at INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE attachment_text_fts USING fts5(attachment_id UNINDEXED,note_id UNINDEXED,source_name UNINDEXED,source_kind UNINDEXED,content,tokenize='unicode61 remove_diacritics 2');
        CREATE TRIGGER attachment_text_ai AFTER INSERT ON attachment_text BEGIN INSERT INTO attachment_text_fts VALUES(new.attachment_id,new.note_id,new.source_name,new.source_kind,new.content); END;
        CREATE TRIGGER attachment_text_ad AFTER DELETE ON attachment_text BEGIN DELETE FROM attachment_text_fts WHERE attachment_id=old.attachment_id; END;
        CREATE TRIGGER attachment_text_au AFTER UPDATE ON attachment_text BEGIN DELETE FROM attachment_text_fts WHERE attachment_id=old.attachment_id; INSERT INTO attachment_text_fts VALUES(new.attachment_id,new.note_id,new.source_name,new.source_kind,new.content); END;
        CREATE TABLE attachment_jobs (
          id INTEGER PRIMARY KEY, attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
          extractor_version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','completed','error','cancel_requested')),
          progress INTEGER NOT NULL DEFAULT 0, checkpoint INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
          error TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000), updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
          UNIQUE(attachment_id,extractor_version)
        );
        CREATE INDEX idx_attachment_jobs_status ON attachment_jobs(status,created_at);
        CREATE TRIGGER attachments_job_ai AFTER INSERT ON attachments BEGIN
          INSERT OR IGNORE INTO attachment_jobs(attachment_id,extractor_version,status)
          SELECT new.id,1,'queued' WHERE lower(new.file_name) GLOB '*.txt' OR lower(new.file_name) GLOB '*.md' OR lower(new.file_name) GLOB '*.html' OR lower(new.file_name) GLOB '*.htm' OR lower(new.file_name) GLOB '*.pdf' OR lower(new.file_name) GLOB '*.png' OR lower(new.file_name) GLOB '*.jpg' OR lower(new.file_name) GLOB '*.jpeg';
        END;
        CREATE TRIGGER attachments_job_ad AFTER DELETE ON attachments BEGIN DELETE FROM attachment_text WHERE attachment_id=old.id; DELETE FROM attachment_jobs WHERE attachment_id=old.id; END;
        INSERT OR IGNORE INTO attachment_jobs(attachment_id,extractor_version,status,created_at,updated_at)
          SELECT id,1,'queued',created_at,created_at FROM attachments WHERE lower(file_name) GLOB '*.txt' OR lower(file_name) GLOB '*.md' OR lower(file_name) GLOB '*.html' OR lower(file_name) GLOB '*.htm' OR lower(file_name) GLOB '*.pdf' OR lower(file_name) GLOB '*.png' OR lower(file_name) GLOB '*.jpg' OR lower(file_name) GLOB '*.jpeg';
      `);
    },
  },
  {
    version: 7,
    up(db: Database.Database): void {
      db.exec("ALTER TABLE attachment_jobs ADD COLUMN total_pages INTEGER NOT NULL DEFAULT 0;");
    },
  },
  {
    version: 8,
    up(db: Database.Database): void {
      db.exec(`CREATE TABLE eml_imports(message_key TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,imported_at INTEGER NOT NULL);`);
    },
  },
  { version: 9, up(db: Database.Database): void {
    db.exec(`CREATE TABLE clipper_sources(source_key TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,source_url TEXT NOT NULL,source_title TEXT NOT NULL,captured_at INTEGER NOT NULL);`);
    db.exec(`CREATE INDEX idx_clipper_sources_note ON clipper_sources(note_id);`);
  } },
  { version: 10, up(db: Database.Database): void {
    db.exec(`CREATE TABLE transcripts (id TEXT PRIMARY KEY, attachment_id INTEGER NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, model TEXT NOT NULL, language TEXT NOT NULL, duration_ms INTEGER NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX idx_transcripts_note ON transcripts(note_id);
      CREATE TABLE transcript_segments (id INTEGER PRIMARY KEY, transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, text TEXT NOT NULL);
      CREATE INDEX idx_transcript_segments_parent ON transcript_segments(transcript_id,start_ms);
      CREATE TABLE transcription_jobs (id TEXT PRIMARY KEY, attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, status TEXT NOT NULL CHECK(status IN ('queued','converting','transcribing','completed','failed','canceled')), progress INTEGER NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'queued', language TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX idx_transcription_jobs_status ON transcription_jobs(status,created_at);`);
  } },
  { version:11, up(db:Database.Database):void {
    db.exec(`ALTER TABLE tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','daily','weekly','monthly'));
      ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high'));
      ALTER TABLE tasks ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';
      ALTER TABLE tasks ADD COLUMN recurrence_anchor TEXT;
      ALTER TABLE tasks ADD COLUMN recurrence_spawned INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN recurrence_parent_id TEXT;
      CREATE UNIQUE INDEX idx_task_occurrence_parent ON tasks(recurrence_parent_id) WHERE recurrence_parent_id IS NOT NULL;
      CREATE TABLE pdf_annotations(id TEXT PRIMARY KEY,attachment_id INTEGER NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,page INTEGER NOT NULL CHECK(page>0),kind TEXT NOT NULL CHECK(kind IN ('highlight','comment')),rect TEXT NOT NULL,comment TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE INDEX idx_pdf_annotations_page ON pdf_annotations(attachment_id,page);`);
    db.prepare("UPDATE tasks SET time_zone=?").run(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } },
  { version:12, up(db:Database.Database):void {
    // Modelos de nota: mídias incorporadas ficam em BLOB para que o modelo não
    // dependa da nota (ou do arquivo) de origem.
    db.exec(`CREATE TABLE note_templates(id TEXT PRIMARY KEY,name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),description TEXT NOT NULL DEFAULT '',note_title TEXT NOT NULL DEFAULT '',content_html TEXT NOT NULL DEFAULT '',content_text TEXT NOT NULL DEFAULT '',builtin_key TEXT UNIQUE,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE note_template_assets(template_id TEXT NOT NULL REFERENCES note_templates(id) ON DELETE CASCADE,token TEXT NOT NULL,file_name TEXT NOT NULL,mime_type TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('image','file')),sha256 TEXT NOT NULL,byte_size INTEGER NOT NULL,data BLOB NOT NULL,annotations TEXT NOT NULL DEFAULT '[]',PRIMARY KEY(template_id,token));`);
    seedBuiltinTemplates(db);
  } },
  { version: 13, up(db: Database.Database): void {
    // Pastas pertencem a um caderno. Excluir a pasta desvincula as notas (SET NULL)
    // e as mantém no mesmo caderno. Excluir o caderno remove as pastas.
    db.exec(`CREATE TABLE note_folders (
        id TEXT PRIMARY KEY,
        notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (notebook_id, name)
      );
      ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES note_folders(id) ON DELETE SET NULL;
      CREATE INDEX idx_notes_folder ON notes(folder_id);
      CREATE INDEX idx_note_folders_notebook ON note_folders(notebook_id, sort_order, name COLLATE NOCASE);`);
  } },
  { version: 14, up(db: Database.Database): void {
    const columns = db.prepare("PRAGMA table_info(tags)").all() as { name: string }[];
    if (!columns.some(column => column.name === "color")) db.exec("ALTER TABLE tags ADD COLUMN color TEXT;");
  } },
  { version: 15, up(db: Database.Database): void {
    // Remove as associações ativas, mantendo notebooks e tabelas legadas intactos.
    const notebookColumns = db.prepare("PRAGMA table_info(notebooks)").all() as { name: string }[];
    if (notebookColumns.some(column => column.name === "stack_id")) db.exec("UPDATE notebooks SET stack_id=NULL WHERE stack_id IS NOT NULL;");
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notebook_stacks'").get()) db.exec("DELETE FROM notebook_stacks;");
  } },
  { version: 16, up(db: Database.Database): void {
    // Personalização de cadernos (aditiva): `color` já existe desde a v1 e estava sem uso.
    // `labels` guarda um array JSON de etiquetas do caderno (distintas das tags das notas).
    const columns = new Set((db.prepare("PRAGMA table_info(notebooks)").all() as { name: string }[]).map(column => column.name));
    if (!columns.has("color")) db.exec("ALTER TABLE notebooks ADD COLUMN color TEXT;");
    if (!columns.has("icon")) db.exec("ALTER TABLE notebooks ADD COLUMN icon TEXT NOT NULL DEFAULT 'book';");
    if (!columns.has("description")) db.exec("ALTER TABLE notebooks ADD COLUMN description TEXT NOT NULL DEFAULT '';");
    if (!columns.has("labels")) db.exec("ALTER TABLE notebooks ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';");
  } },
];

export function preparePaths(files: RepositoryFiles): void {
  fs.mkdirSync(path.dirname(files.database), { recursive: true });
  fs.mkdirSync(files.attachments, { recursive: true });
}

export function openDatabase(files: RepositoryFiles): Database.Database {
  preparePaths(files);
  const db = new Database(files.database);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  // Migration v2 is the first product schema change. VACUUM INTO takes a
  // transactionally consistent snapshot even when WAL contains committed rows.
  const hasV1 = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='migration_log'").get();
  const version = hasV1 ? Number((db.prepare("SELECT COALESCE(MAX(version),0) AS v FROM migration_log").get() as { v: number }).v) : 0;
  let snapshot: string | null = null;
  let attachmentSnapshot: string | null = null;
  // Snapshot the database through SQLite (includes committed WAL pages) and
  // attachments before any additive migration. Cleanup remains a later policy.
  if (version > 0 && version < MIGRATIONS[MIGRATIONS.length - 1].version) {
    const stamp = Date.now();
    snapshot = `${files.database}.pre-v${version + 1}-${stamp}.sqlite`;
    attachmentSnapshot = `${files.attachments}.pre-v${version + 1}-${stamp}`;
    try {
      db.prepare("VACUUM INTO ?").run(snapshot);
      fs.cpSync(files.attachments, attachmentSnapshot, { recursive: true, errorOnExist: true });
    } catch (error) {
      db.close();
      if (snapshot && fs.existsSync(snapshot)) fs.rmSync(snapshot, { force: true });
      throw new Error(`Snapshot pré-migração falhou; migração cancelada: ${String(error)}`);
    }
  }
  try {
    migrate(db);
  } catch (error) {
    db.close();
    if (snapshot && attachmentSnapshot) {
      // A failed migration may leave a WAL/SHM beside the restored snapshot.
      // Remove only after close so stale WAL pages cannot override the snapshot.
      fs.rmSync(`${files.database}-wal`, { force: true });
      fs.rmSync(`${files.database}-shm`, { force: true });
      fs.copyFileSync(snapshot, files.database);
      fs.rmSync(files.attachments, { recursive: true, force: true });
      fs.cpSync(attachmentSnapshot, files.attachments, { recursive: true });
    }
    throw error;
  }
  return db;
}

export function migrate(db: Database.Database): void {
  const applied = db
    .prepare(
      "CREATE TABLE IF NOT EXISTS migration_log (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)"
    );
  applied.run();
  const maxRow = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM migration_log").get() as { version: number };
  let current = maxRow.version;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO migration_log (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        Date.now()
      );
      current = migration.version;
    });
    apply();
  }
}

export { extractPreviewHtml, extractVisibleText } from "../../shared/text";
