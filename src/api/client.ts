/** Cliente tipado do renderer para a bridge Electron (contextIsolation on, nodeIntegration off). */
import {
  ChannelInputs,
  NoteFull,
  NoteMeta,
  Notebook,
  NotebookStack,
  NoteLinkTarget,
  SidebarCounts,
  Tag,
  Task,CalendarEvent,
  AttachmentJob,Transcript,TranscriptionJob,
} from "../../shared/ipc";
import type { AppMeta } from "../../shared/api";
import type { CadernoClient } from "./types";
import { hasDesktopBridge, WebClient } from "./webClient";

export class IpcChannelError extends Error {}

interface RendererBridge {
  invoke(channel: string, input: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
  onReminder?(listener:(kind:'click'|'fallback',value:string)=>void):()=>void;
}

function getBridge(): RendererBridge {
  const b = (window as unknown as { cadernoDesktop?: RendererBridge }).cadernoDesktop;
  if (!b) throw new IpcChannelError("Ponte desktop indisponível. Este adapter é para execução no Electron — no navegador use o adapter web dev (npm run dev:web).");
  return b;
}

export class DesktopClient implements CadernoClient {
  listTasks(filter:'today'|'upcoming'|'overdue'|'completed'|'all'):Promise<Task[]>{return this.call('tasks:list',{filter}) as Promise<Task[]>} createTask(x:{noteId:string;title:string;dueAt:number|null;reminderAt:number|null}):Promise<string>{return this.call('tasks:create',x) as Promise<string>} updateTask(x:{id:string;noteId?:string;title?:string;dueAt?:number|null;reminderAt?:number|null;done?:boolean}):Promise<boolean>{return this.call('tasks:update',x) as Promise<boolean>} deleteTask(id:string):Promise<boolean>{return this.call('tasks:delete',{id}) as Promise<boolean>}
  listEvents(startAt:number,endAt:number):Promise<CalendarEvent[]>{return this.call('events:list',{startAt,endAt}) as Promise<CalendarEvent[]>} createEvent(x:{noteId:string|null;title:string;description:string;startAt:number;endAt:number;timeZone:string;allDay:boolean}):Promise<string>{return this.call('events:create',x) as Promise<string>} updateEvent(x:{id:string;noteId?:string|null;title?:string;description?:string;startAt?:number;endAt?:number;timeZone?:string;allDay?:boolean}):Promise<boolean>{return this.call('events:update',x) as Promise<boolean>} deleteEvent(id:string):Promise<boolean>{return this.call('events:delete',{id}) as Promise<boolean>}
  private async call<K extends keyof ChannelInputs>(channel: K, input: ChannelInputs[K] | null): Promise<unknown> {
    const res = await getBridge().invoke(channel, input);
    if (!res.ok) throw new IpcChannelError(res.error);
    return res.data;
  }

  listNotes(input: ChannelInputs["notes:list"]): Promise<NoteMeta[]> {
    return this.call("notes:list", input) as Promise<NoteMeta[]>;
  }
  getNote(id: string): Promise<NoteFull | null> {
    return this.call("notes:get", { id }) as Promise<NoteFull | null>;
  }
  findNotes(query: string, limit = 20): Promise<NoteLinkTarget[]> { return this.call("notes:find", { query, limit }) as Promise<NoteLinkTarget[]>; }
  createNote(input: ChannelInputs["notes:create"]): Promise<NoteFull> {
    return this.call("notes:create", input) as Promise<NoteFull>;
  }
  updateNote(id: string, patch: { title?: string; contentHtml?: string }): Promise<NoteFull | null> {
    return this.call("notes:update", { id, ...patch }) as Promise<NoteFull | null>;
  }
  moveNote(id: string, notebookId: number | null): Promise<NoteFull | null> {
    return this.call("notes:move", { id, notebookId }) as Promise<NoteFull | null>;
  }
  setFavorite(id: string, value: boolean): Promise<NoteFull | null> {
    return this.call("notes:favorite", { id, value }) as Promise<NoteFull | null>;
  }
  setPinned(id: string, value: boolean): Promise<NoteFull | null> {
    return this.call("notes:pin", { id, value }) as Promise<NoteFull | null>;
  }
  deleteNote(id: string): Promise<NoteFull | null> {
    return this.call("notes:delete", { id }) as Promise<NoteFull | null>;
  }
  restoreNote(id: string): Promise<NoteFull | null> {
    return this.call("notes:restore", { id }) as Promise<NoteFull | null>;
  }
  purgeNote(id: string): Promise<boolean> {
    return this.call("notes:purge", { id }) as Promise<boolean>;
  }
  emptyTrash(): Promise<number> {
    return this.call("notes:emptyTrash", null) as Promise<number>;
  }
  listNotebooks(): Promise<Notebook[]> {
    return this.call("notebooks:list", null) as Promise<Notebook[]>;
  }
  createNotebook(name: string): Promise<Notebook | null> {
    return this.call("notebooks:create", { name }) as Promise<Notebook | null>;
  }
  renameNotebook(id: number, name: string): Promise<Notebook | null> {
    return this.call("notebooks:rename", { id, name }) as Promise<Notebook | null>;
  }
  deleteNotebook(id: number): Promise<boolean> {
    return this.call("notebooks:delete", { id }) as Promise<boolean>;
  }
  moveNotebookToStack(notebookId: number, stackId: string | null): Promise<boolean> { return this.call("notebooks:moveToStack", { notebookId, stackId }) as Promise<boolean>; }
  listStacks(): Promise<NotebookStack[]> { return this.call("stacks:list", null) as Promise<NotebookStack[]>; }
  createStack(name: string): Promise<NotebookStack | null> { return this.call("stacks:create", { name }) as Promise<NotebookStack | null>; }
  renameStack(id: string, name: string): Promise<NotebookStack | null> { return this.call("stacks:rename", { id, name }) as Promise<NotebookStack | null>; }
  deleteStack(id: string): Promise<boolean> { return this.call("stacks:delete", { id }) as Promise<boolean>; }
  listTags(): Promise<Tag[]> {
    return this.call("tags:list", null) as Promise<Tag[]>;
  }
  createTag(name: string): Promise<Tag | null> {
    return this.call("tags:create", { name }) as Promise<Tag | null>;
  }
  attachTag(noteId: string, tagId: number): Promise<boolean> {
    return this.call("tags:attach", { noteId, tagId }) as Promise<boolean>;
  }
  detachTag(noteId: string, tagId: number): Promise<boolean> {
    return this.call("tags:detach", { noteId, tagId }) as Promise<boolean>;
  }
  counts(): Promise<SidebarCounts> {
    return this.call("counts:get", null) as Promise<SidebarCounts>;
  }
  theme(): Promise<string | null> {
    return this.call("theme:get", null) as Promise<string | null>;
  }
  setTheme(value: "light" | "dark"): Promise<boolean> {
    return this.call("theme:set", { value }) as Promise<boolean>;
  }
  listAttachments(noteId: string): Promise<{ id: number; fileName: string; byteSize: number }[]> {
    return this.call("attachments:list", { noteId }) as Promise<{ id: number; fileName: string; byteSize: number }[]>;
  }
  listAttachmentJobs():Promise<AttachmentJob[]>{return this.call("attachments:jobs",null) as Promise<AttachmentJob[]>;}
  retryAttachmentJob(id:number):Promise<boolean>{return this.call("attachments:retry-job",{id}) as Promise<boolean>}
  cancelAttachmentJob(id:number):Promise<boolean>{return this.call("attachments:cancel-job",{id}) as Promise<boolean>}
  reindexAttachments():Promise<number>{return this.call("attachments:reindex",null) as Promise<number>}
  transcriptionConfig(){return this.call("transcription:config",null) as Promise<{runtimeConfigured:boolean;modelConfigured:boolean;ffmpegConfigured:boolean;runtime:string;ffmpeg:string}>} configureTranscription(x:{runtime:string;ffmpeg:string}){return this.call("transcription:configure",x) as Promise<{runtimeConfigured:boolean;modelConfigured:boolean;ffmpegConfigured:boolean;runtime:string;ffmpeg:string}>} listTranscriptionJobs(noteId:string){return this.call("transcription:jobs",{noteId}) as Promise<TranscriptionJob[]>} listTranscripts(noteId:string){return this.call("transcription:list",{noteId}) as Promise<Transcript[]>} startTranscription(noteId:string,attachmentId:number,language:"pt"|"auto"){return this.call("transcription:start",{noteId,attachmentId,language}) as Promise<string>} cancelTranscription(id:string){return this.call("transcription:cancel",{id}) as Promise<boolean>}
  saveAttachment(noteId: string, name: string, dataBase64: string): Promise<{ id: number }> {
    return this.call("attachments:save", { noteId, name, dataBase64 }) as Promise<{ id: number }>;
  }
  saveImage(noteId:string,name:string,dataBase64:string):Promise<{id:number;mime:string;sha256:string;storedName:string}>{return this.call("images:save",{noteId,name,dataBase64}) as Promise<{id:number;mime:string;sha256:string;storedName:string}>;}
  deleteAttachment(noteId: string, attachmentId: number): Promise<boolean> {
    return this.call("attachments:delete", { noteId, attachmentId }) as Promise<boolean>;
  }
  openAttachment(noteId: string, attachmentId: number): Promise<{ filePath: string; fileName: string } | null> {
    return this.call("attachments:open", { noteId, attachmentId }) as Promise<{ filePath: string; fileName: string } | null>;
  }
  exportMarkdown(noteId: string): Promise<{ canceled?: boolean; filePath?: string } | null> {
    return this.call("export:markdown", { noteId }) as Promise<{ canceled?: boolean; filePath?: string } | null>;
  }
  importMarkdown(items: { fileName: string; content: string }[], notebookId: number | null): Promise<{ created: number }> {
    return this.call("import:markdown", { items, notebookId }) as Promise<{ created: number }>;
  }
  importEml(notebookId:number|null){return this.call("import:eml",{notebookId}) as Promise<{canceled?:boolean;created:number;duplicates:number;attachments:number;errors:string[]}>;}
  saveBackup(): Promise<{ canceled?: boolean; filePath?: string } | null> {
    return this.call("backup:save", null) as Promise<{ canceled?: boolean; filePath?: string } | null>;
  }
  restoreBackup(): Promise<{ canceled?: boolean } | { ok: true; notes: number; notebooks: number; assets?:number; legacy?:boolean } | { ok: false; error: string }> {
    return this.call("backup:restore", null) as unknown as Promise<{ canceled?: boolean } | { ok: true; notes: number; notebooks: number; assets?:number; legacy?:boolean } | { ok: false; error: string }>;
  }
  meta(): Promise<AppMeta> {
    return this.call("app:meta", null) as Promise<AppMeta>;
  }
  clipperStatus():Promise<{enabled:boolean;paired:boolean;port:number|null}>{return this.call("clipper:status",null) as Promise<{enabled:boolean;paired:boolean;port:number|null}>}
  enableClipper():Promise<{port:number}>{return this.call("clipper:enable",null) as Promise<{port:number}>}
  pairClipper():Promise<{code:string;nonce:string;expiresAt:number}>{return this.call("clipper:pair",null) as Promise<{code:string;nonce:string;expiresAt:number}>}
  revokeClipper():Promise<boolean>{return this.call("clipper:revoke",null) as Promise<boolean>}
}

export const client: CadernoClient = hasDesktopBridge() ? new DesktopClient() : new WebClient();
