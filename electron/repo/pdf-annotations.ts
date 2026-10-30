import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { PdfSaveSchema, type ChannelInputs, type PdfAnnotation } from '../../shared/ipc';

export class PdfAnnotationsRepo {
  constructor(private db: Database.Database) {}
  private attachment(storedName: string, writing = false): number {
    const row = this.db.prepare(`SELECT a.id FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.stored_name=? AND a.mime_type='application/pdf' ${writing ? 'AND n.deleted_at IS NULL' : ''}`).get(storedName) as { id: number } | undefined;
    if (!row) throw new Error('PDF não encontrado ou indisponível nesta nota.');
    return row.id;
  }
  list(storedName: string, page: number): PdfAnnotation[] {
    return this.db.prepare('SELECT id,page,kind,rect,comment,created_at AS createdAt,updated_at AS updatedAt FROM pdf_annotations WHERE attachment_id=? AND page=? ORDER BY created_at,id').all(this.attachment(storedName), page).map((r: any) => ({ ...r, storedName, rect: JSON.parse(r.rect) }));
  }
  /** Todas as marcações do PDF (todas as páginas), para exportação. */
  listAll(storedName: string): PdfAnnotation[] {
    const row = this.db.prepare("SELECT id FROM attachments WHERE stored_name=? AND mime_type='application/pdf'").get(storedName) as { id: number } | undefined;
    if (!row) return [];
    return this.db.prepare('SELECT id,page,kind,rect,comment,created_at AS createdAt,updated_at AS updatedAt FROM pdf_annotations WHERE attachment_id=? ORDER BY page,created_at,id').all(row.id).map((r: any) => ({ ...r, storedName, rect: JSON.parse(r.rect) }));
  }
  save(input: ChannelInputs['pdf:save']): string {
    const x = PdfSaveSchema.parse(input), attachmentId = this.attachment(x.storedName, true), id = x.id ?? randomUUID(), now = Date.now();
    if (x.id && !this.db.prepare('SELECT 1 FROM pdf_annotations WHERE id=? AND attachment_id=? AND page=?').get(id, attachmentId, x.page)) throw new Error('Marcação não encontrada nesta página.');
    this.db.prepare('INSERT INTO pdf_annotations(id,attachment_id,page,kind,rect,comment,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET rect=excluded.rect,comment=excluded.comment,updated_at=excluded.updated_at').run(id, attachmentId, x.page, x.kind, JSON.stringify(x.rect), x.comment, now, now);
    return id;
  }
  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM pdf_annotations WHERE id=? AND attachment_id IN (SELECT a.id FROM attachments a JOIN notes n ON n.id=a.note_id WHERE n.deleted_at IS NULL)').run(id).changes > 0;
  }
}
