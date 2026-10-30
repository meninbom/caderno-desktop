import type { ChannelInputs, PdfAnnotation, NoteTemplateMeta, NoteTemplateFull, TemplateSaveResult, ExportBeginReady, ExportFinishResult } from '../../shared/ipc';
import type {
  ListNotesQuery,
  NoteFull,
  NoteMeta,
  Notebook,
  NoteFolder,
  NoteLinkTarget,
  SidebarCounts,
  Tag,
  Task,CalendarEvent,AttachmentJob,Transcript,TranscriptionJob,
} from "../../shared/ipc";
import type { AppMeta } from "../../shared/api";

export interface AttachmentMeta {
  id: number;
  fileName: string;
  byteSize: number;
  mimeType?: string;
  storedName?: string;
}

export type BackupRestoreResult =
  | { ok: true; notes: number; notebooks: number; assets?:number; legacy?:boolean }
  | { ok: false; error: string };

/**
 * Interface comum entre o cliente Electron (IPC) e o adapter web de
 * desenvolvimento (localStorage). Ambos implementam exatamente este contrato,
 * mantendo a persistência desktop (SQLite) isolada do preview de navegador.
 */
export interface CadernoClient {
  openExternal(url: string): Promise<boolean>;
  listTasks(filter:'today'|'upcoming'|'overdue'|'completed'|'all',priority?:'all'|'low'|'normal'|'high'):Promise<Task[]>; createTask(x:ChannelInputs['tasks:create']):Promise<string>; updateTask(x:ChannelInputs['tasks:update']):Promise<boolean>; deleteTask(id:string):Promise<boolean>;
  listEvents(startAt:number,endAt:number):Promise<CalendarEvent[]>; createEvent(x:{noteId:string|null;title:string;description:string;startAt:number;endAt:number;timeZone:string;allDay:boolean}):Promise<string>; updateEvent(x:{id:string;noteId?:string|null;title?:string;description?:string;startAt?:number;endAt?:number;timeZone?:string;allDay?:boolean}):Promise<boolean>; deleteEvent(id:string):Promise<boolean>;
  listNotes(input: ListNotesQuery): Promise<NoteMeta[]>;
  getNote(id: string): Promise<NoteFull | null>;
  searchNotes(query:string,limit?:number):Promise<NoteMeta[]>;
  backlinks(id:string):Promise<NoteLinkTarget[]>;
  listPdfAnnotations(storedName:string,page:number):Promise<PdfAnnotation[]>;
  savePdfAnnotation(x:ChannelInputs['pdf:save']):Promise<string>;
  deletePdfAnnotation(id:string):Promise<boolean>;
  findNotes(query: string, limit?: number): Promise<NoteLinkTarget[]>;
  createNote(input: { notebookId?: number | null; folderId?: string | null; title?: string; contentHtml?: string }): Promise<NoteFull>;
  updateNote(id: string, patch: { title?: string; contentHtml?: string }): Promise<NoteFull | null>;
  moveNote(id: string, notebookId: number | null): Promise<NoteFull | null>;
  moveNoteToFolder(id: string, folderId: string | null): Promise<NoteFull | null>;
  setFavorite(id: string, value: boolean): Promise<NoteFull | null>;
  setPinned(id: string, value: boolean): Promise<NoteFull | null>;
  deleteNote(id: string): Promise<NoteFull | null>;
  restoreNote(id: string): Promise<NoteFull | null>;
  purgeNote(id: string): Promise<boolean>;
  emptyTrash(): Promise<number>;
  listNotebooks(): Promise<Notebook[]>;
  createNotebook(name: string): Promise<Notebook | null>;
  renameNotebook(id: number, name: string): Promise<Notebook | null>;
  deleteNotebook(id: number): Promise<boolean>;
  listFolders(): Promise<NoteFolder[]>;
  createFolder(notebookId: number, name: string): Promise<NoteFolder | null>;
  renameFolder(id: string, name: string): Promise<NoteFolder | null>;
  moveFolder(id: string, notebookId: number): Promise<NoteFolder | null>;
  deleteFolder(id: string): Promise<boolean>;
  listTags(): Promise<Tag[]>;
  createTag(name: string): Promise<Tag | null>;
  renameTag(id: number, name: string): Promise<Tag | null>;
  setTagColor(id: number, color: string | null): Promise<boolean>;
  deleteTag(id: number): Promise<boolean>;
  attachTag(noteId: string, tagId: number): Promise<boolean>;
  detachTag(noteId: string, tagId: number): Promise<boolean>;
  counts(): Promise<SidebarCounts>;
  theme(): Promise<string | null>;
  setTheme(value: "light" | "dark"): Promise<boolean>;
  listAttachments(noteId: string): Promise<AttachmentMeta[]>;
  listAttachmentJobs():Promise<AttachmentJob[]>; retryAttachmentJob(id:number):Promise<boolean>; cancelAttachmentJob(id:number):Promise<boolean>; reindexAttachments():Promise<number>;
  transcriptionConfig():Promise<{runtimeConfigured:boolean;modelConfigured:boolean;ffmpegConfigured:boolean;runtime:string;ffmpeg:string}>; configureTranscription(x:{runtime:string;ffmpeg:string}):Promise<{runtimeConfigured:boolean;modelConfigured:boolean;ffmpegConfigured:boolean;runtime:string;ffmpeg:string}>; listTranscriptionJobs(noteId:string):Promise<TranscriptionJob[]>; listTranscripts(noteId:string):Promise<Transcript[]>; startTranscription(noteId:string,attachmentId:number,language:"pt"|"auto"):Promise<string>; cancelTranscription(id:string):Promise<boolean>;
  saveAttachment(noteId: string, name: string, dataBase64: string): Promise<{ id: number }>;
  saveImage(noteId:string,name:string,dataBase64:string):Promise<{id:number;mime:string;sha256:string;storedName:string}>;
  deleteAttachment(noteId: string, attachmentId: number): Promise<boolean>;
  openAttachment(noteId: string, attachmentId: number): Promise<{ filePath: string; fileName: string } | null>;
  exportMarkdown(noteId: string): Promise<{ canceled?: boolean; filePath?: string } | null>;
  importMarkdown(items: { fileName: string; content: string }[], notebookId: number | null, folderId?: string | null): Promise<{ created: number }>;
  importEml(notebookId: number | null, folderId?: string | null): Promise<{canceled?:boolean;created:number;duplicates:number;attachments:number;errors:string[]}>;
  saveBackup(): Promise<{ canceled?: boolean; filePath?: string } | null>;
  restoreBackup(): Promise<{ canceled?: boolean } | BackupRestoreResult>;
  meta(): Promise<AppMeta>;
  clipperStatus():Promise<{enabled:boolean;paired:boolean;port:number|null}>;
  enableClipper():Promise<{port:number}>;
  pairClipper():Promise<{code:string;nonce:string;expiresAt:number}>;
  revokeClipper():Promise<boolean>;
  listTemplates(query?:string):Promise<NoteTemplateMeta[]>;
  getTemplate(id:string):Promise<NoteTemplateFull|null>;
  createTemplateFromNote(x:{noteId:string;name:string;description?:string;noteTitle?:string}):Promise<TemplateSaveResult>;
  updateTemplate(x:{id:string;name?:string;description?:string;noteTitle?:string}):Promise<NoteTemplateMeta|null>;
  deleteTemplate(id:string):Promise<boolean>;
  applyTemplate(id:string,notebookId?:number|null,folderId?:string|null):Promise<NoteFull|null>;
  restoreBuiltinTemplates():Promise<number>;
  exportBegin(noteId:string,format:'pdf'|'html'):Promise<{canceled:true}|ExportBeginReady>;
  exportFinish(x:ChannelInputs['export:finish']):Promise<ExportFinishResult>;
  exportAbort(token:string):Promise<boolean>;
}
