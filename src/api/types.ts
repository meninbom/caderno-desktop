import type {
  ListNotesQuery,
  NoteFull,
  NoteMeta,
  Notebook,
  NotebookStack,
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
  listTasks(filter:'today'|'upcoming'|'overdue'|'completed'|'all'):Promise<Task[]>; createTask(x:{noteId:string;title:string;dueAt:number|null;reminderAt:number|null}):Promise<string>; updateTask(x:{id:string;noteId?:string;title?:string;dueAt?:number|null;reminderAt?:number|null;done?:boolean}):Promise<boolean>; deleteTask(id:string):Promise<boolean>;
  listEvents(startAt:number,endAt:number):Promise<CalendarEvent[]>; createEvent(x:{noteId:string|null;title:string;description:string;startAt:number;endAt:number;timeZone:string;allDay:boolean}):Promise<string>; updateEvent(x:{id:string;noteId?:string|null;title?:string;description?:string;startAt?:number;endAt?:number;timeZone?:string;allDay?:boolean}):Promise<boolean>; deleteEvent(id:string):Promise<boolean>;
  listNotes(input: ListNotesQuery): Promise<NoteMeta[]>;
  getNote(id: string): Promise<NoteFull | null>;
  findNotes(query: string, limit?: number): Promise<NoteLinkTarget[]>;
  createNote(input: { notebookId?: number | null; title?: string; contentHtml?: string }): Promise<NoteFull>;
  updateNote(id: string, patch: { title?: string; contentHtml?: string }): Promise<NoteFull | null>;
  moveNote(id: string, notebookId: number | null): Promise<NoteFull | null>;
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
  moveNotebookToStack(notebookId: number, stackId: string | null): Promise<boolean>;
  listStacks(): Promise<NotebookStack[]>;
  createStack(name: string): Promise<NotebookStack | null>;
  renameStack(id: string, name: string): Promise<NotebookStack | null>;
  deleteStack(id: string): Promise<boolean>;
  listTags(): Promise<Tag[]>;
  createTag(name: string): Promise<Tag | null>;
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
  importMarkdown(items: { fileName: string; content: string }[], notebookId: number | null): Promise<{ created: number }>;
  importEml(notebookId: number | null): Promise<{canceled?:boolean;created:number;duplicates:number;attachments:number;errors:string[]}>;
  saveBackup(): Promise<{ canceled?: boolean; filePath?: string } | null>;
  restoreBackup(): Promise<{ canceled?: boolean } | BackupRestoreResult>;
  meta(): Promise<AppMeta>;
  clipperStatus():Promise<{enabled:boolean;paired:boolean;port:number|null}>;
  enableClipper():Promise<{port:number}>;
  pairClipper():Promise<{code:string;nonce:string;expiresAt:number}>;
  revokeClipper():Promise<boolean>;
}
