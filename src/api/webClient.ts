/**
 * Adapter de desenvolvimento web. Persistência em localStorage APENAS para o
 * preview de navegador (`npm run dev:web` / `npm run preview`). O aplicativo
 * desktop usa SQLite via IPC — este arquivo nunca é usado no Electron.
 */
import type {
  ListNotesQuery,
  NoteFull,
  NoteMeta,
  Notebook,
  NoteFolder,
  NoteLinkTarget,
  SidebarCounts,
  SortOrder,
  Tag,
} from "../../shared/ipc";
import type { AppMeta } from "../../shared/api";
import {
  extractVisibleText,
  extractPreviewHtml,
  markdownFromNote,
  markdownHeadline,
  markdownToNoteHtml,
} from "../../shared/text";
import type { AttachmentMeta, BackupRestoreResult, CadernoClient } from "./types";
import { normalizeTagName, tagKey } from "../../shared/tags";
import { tokenizeSearchText } from "../../shared/search";

interface WebNote {
  id: string;
  notebookId: number | null;
  folderId?: string | null;
  title: string;
  contentHtml: string;
  contentText: string;
  favorited: boolean;
  pinned: boolean;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
interface WebNotebook { id: number; name: string; createdAt: number }
interface WebFolder { id: string; notebookId: number; name: string; sortOrder: number; createdAt: number; updatedAt: number }
interface WebTag { id: number; name: string; color?: string | null }
interface WebAttachment { id: number; noteId: string; fileName: string; byteSize: number; dataBase64: string; createdAt: number }

interface WebStore {
  seeded: boolean;
  theme: "light" | "dark";
  notes: WebNote[];
  notebooks: WebNotebook[];
  folders?: WebFolder[];
  tags: WebTag[];
  noteTags: { noteId: string; tagId: number }[];
  attachments: WebAttachment[];
}

const KEY = "caderno.web.preview.v1";

const ORDER: Record<SortOrder, (a: WebNote, b: WebNote) => number> = {
  updated_desc: (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt,
  updated_asc: (a, b) => a.updatedAt - b.updatedAt,
  created_desc: (a, b) => b.createdAt - a.createdAt,
  title_asc: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
};
const foldSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
const matchesSearchPrefix = (value: string, query: string) => {
  const words = tokenizeSearchText(foldSearch(value));
  const terms = tokenizeSearchText(foldSearch(query));
  return terms.length > 0 && terms.every((term,index) => words.some(word => index === terms.length - 1 ? word.startsWith(term) : word === term));
};

function seedStore(): WebStore {
  const now = Date.now();
  const nb1: WebNotebook = { id: 1, name: "Pessoal", createdAt: now };
  const nb2: WebNotebook = { id: 2, name: "Trabalho", createdAt: now };
  const welcome: WebNote = {
    id: crypto.randomUUID(), notebookId: 1, title: "Bem-vindo ao Caderno",
    contentHtml:
      "<h1>Bem-vindo</h1><p>Este é o seu primeiro passo. Crie cadernos, etiquete tudo e favorite o que mais importa.</p><ul><li>Crie <strong>cadernos</strong> na barra lateral</li><li>Use <strong>etiquetas</strong> para conectar assuntos entre cadernos</li><li>Tarefas rápidas viram <em>checklists</em></li></ul>",
    contentText: "", favorited: true, pinned: false, deletedAt: null, createdAt: now, updatedAt: now,
  };
  welcome.contentText = extractVisibleText(welcome.contentHtml);
  const market: WebNote = {
    id: crypto.randomUUID(), notebookId: 1, title: "Lista do mercado",
    contentHtml:
      '<ul data-type="taskList"><li data-checked="false"><p>Café</p></li><li data-checked="true"><p>Leite</p></li><li data-checked="false"><p>Pão integral</p></li></ul><p>Orçamento: <strong>R$ 120</strong></p>',
    contentText: "", favorited: false, pinned: false, deletedAt: null, createdAt: now, updatedAt: now,
  };
  market.contentText = extractVisibleText(market.contentHtml);
  const meeting: WebNote = {
    id: crypto.randomUUID(), notebookId: 2, title: "Roteiro da reunião",
    contentHtml:
      "<h2>Segunda-feira</h2><ul><li>Revisão das metas do trimestre</li><li>Onboarding de novos clientes</li></ul><blockquote>Ideias valem pouco sem execução.</blockquote>",
    contentText: "", favorited: false, pinned: true, deletedAt: null, createdAt: now, updatedAt: now,
  };
  meeting.contentText = extractVisibleText(meeting.contentHtml);
  return {
    seeded: true,
    theme: "light",
    notes: [welcome, market, meeting],
    notebooks: [nb1, nb2],
    folders: [],
    tags: [{ id: 1, name: "ideias", color: null }],
    noteTags: [{ noteId: meeting.id, tagId: 1 }],
    attachments: [],
  };
}

function download(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // Se o usuário fechar sem escolher, resolve null após foco perdido.
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

export class WebClient implements CadernoClient {
  async openExternal(_url: string): Promise<boolean> { return false; }
  async setTagColor(id: number, color: string | null): Promise<boolean> { const tag=this.store.tags.find(t=>t.id===id); if(!tag)return false; tag.color=color; this.persist(); return true; }
  async listTasks():Promise<import('../../shared/ipc').Task[]>{throw new Error('Tarefas locais disponíveis no app desktop.');} async createTask():Promise<string>{throw new Error('Tarefas locais disponíveis no app desktop.');} async updateTask():Promise<boolean>{throw new Error('Tarefas locais disponíveis no app desktop.');} async deleteTask():Promise<boolean>{throw new Error('Tarefas locais disponíveis no app desktop.');}
  async listEvents():Promise<import('../../shared/ipc').CalendarEvent[]>{throw new Error('Calendário local disponível no app desktop.');} async createEvent():Promise<string>{throw new Error('Calendário local disponível no app desktop.');} async updateEvent():Promise<boolean>{throw new Error('Calendário local disponível no app desktop.');} async deleteEvent():Promise<boolean>{throw new Error('Calendário local disponível no app desktop.');}
  private store: WebStore;

  constructor() {
    this.store = this.load();
  }

  private load(): WebStore {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as WebStore;
        if (Array.isArray(parsed.notes)) {
          if (!Array.isArray(parsed.folders)) parsed.folders = [];
          for (const note of parsed.notes) if (note.folderId === undefined) note.folderId = null;
          return parsed;
        }
      }
    } catch {
      /* segue para seed */
    }
    const seeded = seedStore();
    this.persist(seeded);
    return seeded;
  }

  private persist(s: WebStore = this.store): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* localStorage cheio/indisponível — o preview continua em memória */
    }
  }

  private noteMeta(n: WebNote): NoteMeta {
    const tags = this.store.noteTags
      .filter(nt => nt.noteId === n.id)
      .map(nt => this.store.tags.find(t => t.id === nt.tagId))
      .filter((t): t is WebTag => Boolean(t))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => ({ id: t.id, name: t.name, color: t.color ?? null }));
    return {
      id: n.id,
      notebookId: n.notebookId,
      folderId: n.folderId ?? null,
      title: n.title,
      favorited: n.favorited,
      pinned: n.pinned,
      tags,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      deletedAt: n.deletedAt,
      preview: extractPreviewHtml(n.contentText),
    };
  }

  private noteFull(n: WebNote): NoteFull {
    return { ...this.noteMeta(n), contentHtml: n.contentHtml };
  }

  async listNotes(q: ListNotesQuery): Promise<NoteMeta[]> {
    const term = (q.query ?? "").trim().toLowerCase();
    let list = this.store.notes.filter((n) => {
      if (q.view === "trash") {
        if (n.deletedAt === null) return false;
      } else if (n.deletedAt !== null) {
        return false;
      }
      if (q.view === "favorites" && !n.favorited) return false;
      if (q.view === "notebook" && n.notebookId !== q.notebookId) return false;
      if (q.view === "folder" && n.folderId !== q.folderId) return false;
      if (q.view === "unfiled" && n.notebookId !== null) return false;
      if (q.view === "tag" && !this.store.noteTags.some(nt => nt.noteId === n.id && nt.tagId === q.tagId)) return false;
      if (term && !matchesSearchPrefix(`${n.title} ${n.contentText}`, term)) return false;
      return true;
    });
    list = list.slice().sort(ORDER[q.order ?? "updated_desc"]);
    return list.map(n => this.noteMeta(n));
  }

  async getNote(id: string): Promise<NoteFull | null> {
    const n = this.store.notes.find(x => x.id === id);
    return n ? this.noteFull(n) : null;
  }
  async searchNotes(query:string,limit=50):Promise<NoteMeta[]>{return (await this.listNotes({view:'all',query})).slice(0,limit);}
  async backlinks(id:string):Promise<NoteLinkTarget[]>{const all=await this.listNotes({view:'all'});const result:NoteLinkTarget[]=[];for(const n of all){const note=await this.getNote(n.id);if(n.id!==id&&note?.contentHtml.includes(`caderno-note://${id}`))result.push({id:n.id,title:n.title,preview:n.preview});}return result;}
  async listPdfAnnotations():Promise<import('../../shared/ipc').PdfAnnotation[]>{return [];}
  async savePdfAnnotation():Promise<string>{throw new Error('Marcações de PDF disponíveis no app desktop.');}
  async deletePdfAnnotation():Promise<boolean>{throw new Error('Marcações de PDF disponíveis no app desktop.');}
  async findNotes(query: string, limit = 20): Promise<NoteLinkTarget[]> {
    const q=query.trim(); if(!q) return [];
    return this.store.notes.filter(n=>n.deletedAt===null && matchesSearchPrefix(`${n.title} ${n.contentText}`, q)).slice(0,limit).map(n=>({id:n.id,title:n.title||"Sem título",preview:extractPreviewHtml(n.contentText)}));
  }

  async createNote(input: { notebookId?: number | null; folderId?: string | null; title?: string; contentHtml?: string }): Promise<NoteFull> {
    const now = Date.now();
    const placed = this.resolveFolder(input.notebookId ?? null, input.folderId ?? null);
    const n: WebNote = {
      id: crypto.randomUUID(),
      notebookId: placed.notebookId,
      folderId: placed.folderId,
      title: input.title ?? "",
      contentHtml: input.contentHtml ?? "",
      contentText: extractVisibleText(input.contentHtml ?? ""),
      favorited: false,
      pinned: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.notes.push(n);
    this.persist();
    return this.noteFull(n);
  }

  async updateNote(id: string, patch: { title?: string; contentHtml?: string }): Promise<NoteFull | null> {
    const n = this.store.notes.find(x => x.id === id);
    if (!n) return null;
    if (patch.title !== undefined) n.title = patch.title;
    if (patch.contentHtml !== undefined) {
      n.contentHtml = patch.contentHtml;
      n.contentText = extractVisibleText(patch.contentHtml);
    }
    n.updatedAt = Date.now();
    this.persist();
    return this.noteFull(n);
  }

  private resolveFolder(notebookId: number | null, folderId: string | null): { notebookId: number | null; folderId: string | null } {
    if (!folderId) return { notebookId, folderId: null };
    const folder = (this.store.folders ?? []).find(item => item.id === folderId);
    if (!folder) throw new Error("Pasta não encontrada.");
    if (notebookId !== null && notebookId !== folder.notebookId) throw new Error("A pasta não pertence a este caderno.");
    return { notebookId: folder.notebookId, folderId };
  }

  async moveNote(id: string, notebookId: number | null): Promise<NoteFull | null> {
    const n = this.store.notes.find(x => x.id === id);
    if (!n) return null;
    const folder = (this.store.folders ?? []).find(item => item.id === n.folderId);
    if (notebookId === null || !folder || folder.notebookId !== notebookId) n.folderId = null;
    n.notebookId = notebookId;
    n.updatedAt = Date.now();
    this.persist();
    return this.noteFull(n);
  }

  async moveNoteToFolder(id: string, folderId: string | null): Promise<NoteFull | null> {
    const n = this.store.notes.find(x => x.id === id);
    if (!n) return null;
    if (folderId === null) n.folderId = null;
    else {
      const folder = (this.store.folders ?? []).find(item => item.id === folderId);
      if (!folder) return null;
      n.notebookId = folder.notebookId;
      n.folderId = folder.id;
    }
    n.updatedAt = Date.now();
    this.persist();
    return this.noteFull(n);
  }

  private setFlag(id: string, field: "favorited" | "pinned", value: boolean): Promise<NoteFull | null> {
    const n = this.store.notes.find(x => x.id === id);
    if (!n) return Promise.resolve(null);
    n[field] = value;
    this.persist();
    return Promise.resolve(this.noteFull(n));
  }
  setFavorite(id: string, value: boolean): Promise<NoteFull | null> { return this.setFlag(id, "favorited", value); }
  setPinned(id: string, value: boolean): Promise<NoteFull | null> { return this.setFlag(id, "pinned", value); }

  async deleteNote(id: string): Promise<NoteFull | null> {
    const n = this.store.notes.find(x => x.id === id);
    if (!n || n.deletedAt !== null) return n ? this.noteFull(n) : null;
    n.deletedAt = Date.now();
    this.persist();
    return this.noteFull(n);
  }

  async restoreNote(id: string): Promise<NoteFull | null> {
    const n = this.store.notes.find(x => x.id === id);
    if (!n) return null;
    n.deletedAt = null;
    this.persist();
    return this.noteFull(n);
  }

  async purgeNote(id: string): Promise<boolean> {
    const before = this.store.notes.length;
    this.store.notes = this.store.notes.filter(x => x.id !== id);
    this.store.noteTags = this.store.noteTags.filter(x => x.noteId !== id);
    this.store.attachments = this.store.attachments.filter(x => x.noteId !== id);
    this.persist();
    return this.store.notes.length < before;
  }

  async emptyTrash(): Promise<number> {
    const trash = this.store.notes.filter(n => n.deletedAt !== null);
    const ids = new Set(trash.map(n => n.id));
    this.store.notes = this.store.notes.filter(n => n.deletedAt === null);
    this.store.noteTags = this.store.noteTags.filter(x => !ids.has(x.noteId));
    this.store.attachments = this.store.attachments.filter(x => !ids.has(x.noteId));
    this.persist();
    return trash.length;
  }

  async listNotebooks(): Promise<Notebook[]> {
    return this.store.notebooks
      .map(nb => ({
        id: nb.id,
        name: nb.name,
        createdAt: nb.createdAt,
        noteCount: this.store.notes.filter(n => n.notebookId === nb.id && n.deletedAt === null).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private nextNotebookId(): number {
    return this.store.notebooks.reduce((m, n) => Math.max(m, n.id), 0) + 1;
  }

  async createNotebook(name: string): Promise<Notebook | null> {
    if (this.store.notebooks.some(nb => nb.name.toLowerCase() === name.toLowerCase())) return null;
    const nb: WebNotebook = { id: this.nextNotebookId(), name, createdAt: Date.now() };
    this.store.notebooks.push(nb);
    this.persist();
    return { id: nb.id, name: nb.name, createdAt: nb.createdAt, noteCount: 0 };
  }

  async renameNotebook(id: number, name: string): Promise<Notebook | null> {
    const nb = this.store.notebooks.find(x => x.id === id);
    if (!nb) return null;
    if (this.store.notebooks.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return null;
    nb.name = name;
    this.persist();
    const noteCount = this.store.notes.filter(n => n.notebookId === id && n.deletedAt === null).length;
      return { id: nb.id, name: nb.name, createdAt: nb.createdAt, noteCount };
  }
  async listFolders(): Promise<NoteFolder[]> {
    return (this.store.folders ?? []).map(folder => ({
      ...folder,
      noteCount: this.store.notes.filter(note => note.folderId === folder.id && note.deletedAt === null).length,
    })).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  async createFolder(notebookId: number, name: string): Promise<NoteFolder | null> {
    if (!this.store.notebooks.some(nb => nb.id === notebookId)) throw new Error("Caderno não encontrado.");
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) return null;
    if ((this.store.folders ?? []).some(folder => folder.notebookId === notebookId && folder.name.toLowerCase() === trimmed.toLowerCase())) return null;
    const now = Date.now();
    const folder: WebFolder = { id: crypto.randomUUID(), notebookId, name: trimmed, sortOrder: (this.store.folders ?? []).filter(item => item.notebookId === notebookId).length, createdAt: now, updatedAt: now };
    (this.store.folders ??= []).push(folder);
    this.persist();
    return (await this.listFolders()).find(item => item.id === folder.id) ?? null;
  }
  async renameFolder(id: string, name: string): Promise<NoteFolder | null> {
    const folder = (this.store.folders ?? []).find(item => item.id === id);
    const trimmed = name.trim();
    if (!folder || !trimmed || trimmed.length > 120 || (this.store.folders ?? []).some(item => item.id !== id && item.notebookId === folder.notebookId && item.name.toLowerCase() === trimmed.toLowerCase())) return null;
    folder.name = trimmed;
    folder.updatedAt = Date.now();
    this.persist();
    return (await this.listFolders()).find(item => item.id === id) ?? null;
  }
  async moveFolder(id: string, notebookId: number): Promise<NoteFolder | null> {
    const folder = (this.store.folders ?? []).find(item => item.id === id);
    if (!folder) return null;
    if (!this.store.notebooks.some(nb => nb.id === notebookId)) throw new Error("Caderno não encontrado.");
    if (folder.notebookId === notebookId) return (await this.listFolders()).find(item => item.id === id) ?? null;
    if ((this.store.folders ?? []).some(item => item.id !== id && item.notebookId === notebookId && item.name.toLowerCase() === folder.name.toLowerCase())) return null;
    const sort = (this.store.folders ?? []).filter(item => item.notebookId === notebookId).reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
    const now = Date.now();
    folder.notebookId = notebookId;
    folder.sortOrder = sort;
    folder.updatedAt = now;
    for (const note of this.store.notes) if (note.folderId === id) { note.notebookId = notebookId; note.updatedAt = now; }
    this.persist();
    return (await this.listFolders()).find(item => item.id === id) ?? null;
  }
  async deleteFolder(id: string): Promise<boolean> {
    const before = (this.store.folders ?? []).length;
    this.store.folders = (this.store.folders ?? []).filter(item => item.id !== id);
    for (const note of this.store.notes) if (note.folderId === id) note.folderId = null;
    this.persist();
    return this.store.folders.length < before;
  }

  async deleteNotebook(id: number): Promise<boolean> {
    const before = this.store.notebooks.length;
    this.store.notebooks = this.store.notebooks.filter(x => x.id !== id);
    this.store.folders = (this.store.folders ?? []).filter(folder => folder.notebookId !== id);
    for (const n of this.store.notes) if (n.notebookId === id) { n.notebookId = null; n.folderId = null; }
    this.persist();
    return this.store.notebooks.length < before;
  }

  async listTags(): Promise<Tag[]> {
    return this.store.tags
      .map(t => ({
        id: t.id,
        name: t.name,
        color: t.color ?? null,
        noteCount: this.store.noteTags.filter(nt => nt.tagId === t.id && this.store.notes.find(n => n.id === nt.noteId && n.deletedAt === null)).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private nextTagId(): number {
    return this.store.tags.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  }

  async createTag(name: string): Promise<Tag | null> {
    name = normalizeTagName(name);
    if (!name || name.length > 80) throw new Error("Use um nome de etiqueta entre 1 e 80 caracteres.");
    if (this.store.tags.some(t => tagKey(t.name) === tagKey(name))) return null;
    const t: WebTag = { id: this.nextTagId(), name };
    this.store.tags.push(t);
    this.persist();
    return { id: t.id, name: t.name, color: t.color ?? null, noteCount: 0 };
  }

  async attachTag(noteId: string, tagId: number): Promise<boolean> {
    if (this.store.noteTags.some(nt => nt.noteId === noteId && nt.tagId === tagId)) return false;
    this.store.noteTags.push({ noteId, tagId });
    this.persist();
    return true;
  }

  async renameTag(id: number, name: string): Promise<Tag | null> {
    name = normalizeTagName(name);
    if (!name || name.length > 80) throw new Error("Use um nome de etiqueta entre 1 e 80 caracteres.");
    if (this.store.tags.some(t => t.id !== id && tagKey(t.name) === tagKey(name))) return null;
    const tag = this.store.tags.find(t => t.id === id);
    if (!tag) throw new Error("Etiqueta não encontrada.");
    tag.name = name;
    this.persist();
    return (await this.listTags()).find(t => t.id === id) ?? null;
  }

  async deleteTag(id: number): Promise<boolean> {
    const before = this.store.tags.length;
    this.store.tags = this.store.tags.filter(t => t.id !== id);
    this.store.noteTags = this.store.noteTags.filter(t => t.tagId !== id);
    this.persist();
    return this.store.tags.length < before;
  }

  async detachTag(noteId: string, tagId: number): Promise<boolean> {
    const before = this.store.noteTags.length;
    this.store.noteTags = this.store.noteTags.filter(nt => !(nt.noteId === noteId && nt.tagId === tagId));
    this.persist();
    return this.store.noteTags.length < before;
  }

  async counts(): Promise<SidebarCounts> {
    const active = this.store.notes.filter(n => n.deletedAt === null);
    return {
      all: active.length,
      favorites: active.filter(n => n.favorited).length,
      trash: this.store.notes.filter(n => n.deletedAt !== null).length,
      unfiled: active.filter(n => n.notebookId === null).length,
    };
  }

  async theme(): Promise<string | null> {
    return this.store.theme;
  }
  async setTheme(value: "light" | "dark"): Promise<boolean> {
    this.store.theme = value;
    this.persist();
    return true;
  }

  async listAttachments(noteId: string): Promise<AttachmentMeta[]> {
    return this.store.attachments
      .filter(a => a.noteId === noteId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(a => ({ id: a.id, fileName: a.fileName, byteSize: a.byteSize }));
  }
  async listAttachmentJobs():Promise<import("../../shared/ipc").AttachmentJob[]>{return [];}
  async retryAttachmentJob(_id:number):Promise<boolean>{return false;}
  async cancelAttachmentJob(_id:number):Promise<boolean>{return false;}
  async reindexAttachments():Promise<number>{return 0;}

  private nextAttachmentId(): number {
    return this.store.attachments.reduce((m, a) => Math.max(m, a.id), 0) + 1;
  }

  async saveAttachment(noteId: string, name: string, dataBase64: string): Promise<{ id: number }> {
    const safe = name.replace(/[^a-zA-Z0-9. _\-()[\]{}]/g, "_").slice(0, 160) || "anexo";
    const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
    const byteSize = Math.floor((dataBase64.length * 3) / 4) - padding;
    const a: WebAttachment = { id: this.nextAttachmentId(), noteId, fileName: safe, byteSize, dataBase64, createdAt: Date.now() };
    this.store.attachments.push(a);
    this.persist();
    return { id: a.id };
  }

  async saveImage(_noteId:string,_name:string,_dataBase64:string):Promise<{id:number;mime:string;sha256:string;storedName:string}>{throw new Error("Imagens inline requerem o app desktop.");}

  async deleteAttachment(noteId: string, attachmentId: number): Promise<boolean> {
    const before = this.store.attachments.length;
    this.store.attachments = this.store.attachments.filter(a => !(a.noteId === noteId && a.id === attachmentId));
    this.persist();
    return this.store.attachments.length < before;
  }

  async openAttachment(noteId: string, attachmentId: number): Promise<{ filePath: string; fileName: string } | null> {
    const a = this.store.attachments.find(x => x.noteId === noteId && x.id === attachmentId);
    if (!a) return null;
    const mime = "application/octet-stream";
    download(a.fileName, atob(a.dataBase64), mime);
    return { filePath: "", fileName: a.fileName };
  }

  async exportMarkdown(noteId: string): Promise<{ canceled?: boolean; filePath?: string } | null> {
    const n = this.store.notes.find(x => x.id === noteId);
    if (!n) return null;
    const tags = this.store.noteTags
      .filter(nt => nt.noteId === n.id)
      .map(nt => this.store.tags.find(t => t.id === nt.tagId))
      .filter((t): t is WebTag => Boolean(t));
    const nb = this.store.notebooks.find(x => x.id === n.notebookId);
    const md = markdownFromNote({
      title: n.title,
      contentHtml: n.contentHtml,
      contentText: n.contentText,
      tags: tags.map(t => ({ name: t.name })),
      notebookName: nb?.name ?? null,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    });
    const filePath = `${(n.title || "sem-titulo").slice(0, 80).replace(/[\\/:*?"<>|]/g, "_")}.md`;
    download(filePath, md, "text/markdown");
    return { canceled: false, filePath };
  }

  async importMarkdown(items: { fileName: string; content: string }[], notebookId: number | null, folderId?: string | null): Promise<{ created: number }> {
    let created = 0;
    for (const item of items) {
      const html = markdownToNoteHtml(item.content);
      const title = markdownHeadline(item.content) ?? item.fileName.replace(/\.[^.]+$/, "");
      await this.createNote({ notebookId, folderId, title, contentHtml: html });
      created += 1;
    }
    return { created };
  }
  async importEml(_notebookId:number|null,_folderId?:string|null):Promise<{canceled?:boolean;created:number;duplicates:number;attachments:number;errors:string[]}>{throw new Error("A importação .eml requer o aplicativo desktop.");}

  async saveBackup(): Promise<{ canceled?: boolean; filePath?: string } | null> {
    const payload = {
      app: "caderno",
      schemaVersion: 1,
      exportedAt: Date.now(),
      notebooks: this.store.notebooks.map(nb => ({ id: nb.id, name: nb.name })),
      folders: (this.store.folders ?? []).map(folder => ({ ...folder })),
      notes: this.store.notes.map(n => ({
        id: n.id,
        notebookId: n.notebookId,
        folderId: n.folderId ?? null,
        title: n.title,
        contentHtml: n.contentHtml,
        favorited: n.favorited,
        pinned: n.pinned,
        deletedAt: n.deletedAt,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        tags: this.store.noteTags
          .filter(nt => nt.noteId === n.id)
          .map(nt => this.store.tags.find(t => t.id === nt.tagId)?.name)
          .filter((x): x is string => Boolean(x)),
      })),
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = `caderno-backup-${stamp}.json`;
    download(filePath, JSON.stringify(payload, null, 2), "application/json");
    return { canceled: false, filePath };
  }

  async restoreBackup(): Promise<{ canceled?: boolean } | BackupRestoreResult> {
    const file = await pickFile(".json,application/json");
    if (!file) return { canceled: true };
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return { ok: false, error: "JSON inválido" };
    }
    const p = parsed as {
      app?: unknown; schemaVersion?: unknown; notes?: unknown; notebooks?: unknown;
    };
    if (p.app !== "caderno" || !Array.isArray(p.notes) || !Array.isArray(p.notebooks)) {
      return { ok: false, error: "Backup inválido: estrutura inesperada" };
    }
    // Aplica de forma atômica em memória: monta novo store e só persiste se válido.
    const notes = (p.notes as Array<{
      id?: unknown; notebookId?: unknown; folderId?: unknown; title?: unknown; contentHtml?: unknown;
      favorited?: unknown; pinned?: unknown; deletedAt?: unknown; createdAt?: unknown; updatedAt?: unknown; tags?: unknown;
    }>);
    const notebooks = (p.notebooks as Array<{ id?: unknown; name?: unknown }>);
    for (const n of notes) {
      if (typeof n.id !== "string" || typeof n.title !== "string" || typeof n.contentHtml !== "string") {
        return { ok: false, error: "Backup inválido: nota malformada" };
      }
    }
    const next: WebStore = {
      seeded: true,
      theme: this.store.theme,
      notes: [],
      notebooks: [],
      folders: [],
      tags: [],
      noteTags: [],
      attachments: [],
    };
    const nbMap = new Map<number, number>();
    let nbSeq = 0;
    for (const nb of notebooks) {
      if (typeof nb.name !== "string") return { ok: false, error: "Backup inválido: caderno malformado" };
      nbSeq += 1;
      const id = nbSeq;
      nbMap.set(typeof nb.id === "number" ? nb.id : -1, id);
      next.notebooks.push({ id, name: nb.name, createdAt: Date.now() });
    }
    const folderMap = new Map<string, string>();
    const rawFolders = Array.isArray((p as { folders?: unknown }).folders) ? (p as { folders: Array<{ id?: unknown; notebookId?: unknown; name?: unknown; sortOrder?: unknown; createdAt?: unknown; updatedAt?: unknown }> }).folders : [];
    for (const folder of rawFolders) {
      if (typeof folder.name !== "string" || typeof folder.notebookId !== "number") continue;
      const notebookId = nbMap.get(folder.notebookId);
      if (!notebookId) continue;
      const id = typeof folder.id === "string" ? folder.id : crypto.randomUUID();
      next.folders!.push({ id, notebookId, name: folder.name, sortOrder: typeof folder.sortOrder === "number" ? folder.sortOrder : 0, createdAt: typeof folder.createdAt === "number" ? folder.createdAt : Date.now(), updatedAt: typeof folder.updatedAt === "number" ? folder.updatedAt : Date.now() });
      if (typeof folder.id === "string") folderMap.set(folder.id, id);
    }
    const tagMap = new Map<string, number>();
    let tagSeq = 0;
    const tagId = (name: string): number => {
      const existing = tagMap.get(name.toLowerCase());
      if (existing) return existing;
      tagSeq += 1;
      tagMap.set(name.toLowerCase(), tagSeq);
      next.tags.push({ id: tagSeq, name });
      return tagSeq;
    };
    for (const n of notes) {
      const notebookId = typeof n.notebookId === "number" ? (nbMap.get(n.notebookId) ?? null) : null;
      const note: WebNote = {
        id: n.id as string,
        notebookId,
        folderId: typeof n.folderId === "string" ? (folderMap.get(n.folderId) ?? null) : null,
        title: n.title as string,
        contentHtml: n.contentHtml as string,
        contentText: extractVisibleText(n.contentHtml as string),
        favorited: n.favorited === true,
        pinned: n.pinned === true,
        deletedAt: typeof n.deletedAt === "number" ? n.deletedAt : null,
        createdAt: typeof n.createdAt === "number" ? n.createdAt : Date.now(),
        updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : Date.now(),
      };
      next.notes.push(note);
      if (Array.isArray(n.tags)) {
        for (const t of n.tags) {
          if (typeof t === "string") next.noteTags.push({ noteId: note.id, tagId: tagId(t) });
        }
      }
    }
    this.store = next;
    this.persist();
    return { ok: true, notes: next.notes.length, notebooks: next.notebooks.length };
  }

  async meta(): Promise<AppMeta> {
    return { name: "caderno", version: "0.2.0", userDataPath: "(navegador/localStorage)", platform: "web" };
  }
  async clipperStatus(){return {enabled:false,paired:false,port:null};}
  async transcriptionConfig(){return {runtimeConfigured:false,modelConfigured:false,ffmpegConfigured:false,runtime:"",ffmpeg:""};} async configureTranscription(_x:{runtime:string;ffmpeg:string}):Promise<{runtimeConfigured:boolean;modelConfigured:boolean;ffmpegConfigured:boolean;runtime:string;ffmpeg:string}>{throw new Error("Transcrição local exige o app desktop.");} async listTranscriptionJobs(_noteId:string){return [];} async listTranscripts(_noteId:string){return [];} async startTranscription(_noteId:string,_attachmentId:number,_language:"pt"|"auto"):Promise<string>{throw new Error("Transcrição local exige o app desktop.");} async cancelTranscription(_id:string){return false;}
  async enableClipper():Promise<{port:number}>{throw new Error("O Web Clipper exige o app desktop.");}
  async pairClipper():Promise<{code:string;nonce:string;expiresAt:number}>{throw new Error("O Web Clipper exige o app desktop.");}
  async revokeClipper(){return true;}
  async listTemplates():Promise<import("../../shared/ipc").NoteTemplateMeta[]>{return [];}
  async getTemplate():Promise<import("../../shared/ipc").NoteTemplateFull|null>{return null;}
  async createTemplateFromNote():Promise<import("../../shared/ipc").TemplateSaveResult>{throw new Error("Modelos de nota exigem o app desktop.");}
  async updateTemplate():Promise<import("../../shared/ipc").NoteTemplateMeta|null>{throw new Error("Modelos de nota exigem o app desktop.");}
  async deleteTemplate():Promise<boolean>{throw new Error("Modelos de nota exigem o app desktop.");}
  async applyTemplate(_id?:string,_notebookId?:number|null,_folderId?:string|null):Promise<NoteFull|null>{throw new Error("Modelos de nota exigem o app desktop.");}
  async restoreBuiltinTemplates():Promise<number>{return 0;}
  async exportBegin():Promise<{canceled:true}|import("../../shared/ipc").ExportBeginReady>{throw new Error("A exportação em PDF/HTML exige o app desktop.");}
  async exportFinish():Promise<import("../../shared/ipc").ExportFinishResult>{throw new Error("A exportação em PDF/HTML exige o app desktop.");}
  async exportAbort():Promise<boolean>{return true;}
}

export function hasDesktopBridge(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { cadernoDesktop?: unknown }).cadernoDesktop);
}
