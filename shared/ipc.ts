/**
 * Contrato IPC compartilhado entre processo principal e renderer.
 * Todos os payloads são validados com Zod no processo principal.
 */
import { z } from "zod";

export const NoteView = z.enum(["all", "favorites", "trash", "notebook", "tag", "unfiled"]);
export type NoteView = z.infer<typeof NoteView>;

export const SortOrder = z.enum(["updated_desc", "updated_asc", "created_desc", "title_asc"]);
export type SortOrder = z.infer<typeof SortOrder>;

export interface NoteMeta {
  id: string;
  notebookId: number | null;
  title: string;
  favorited: boolean;
  pinned: boolean;
  tags: { id: number; name: string }[];
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  preview: string;
  matchSource?: string;
  matchSourceKind?: "transcription"|"attachment";
  matchSnippet?: string;
}
export interface AttachmentJob { id:number; attachmentId:number; noteId:string; fileName:string; status:'queued'|'running'|'completed'|'error'|'cancel_requested'; progress:number; checkpoint:number; totalPages:number; attempts:number; error:string|null }
export interface TranscriptionJob {id:string;attachmentId:number;noteId:string;status:'queued'|'converting'|'transcribing'|'completed'|'failed'|'canceled';progress:number;stage:string;language:string;error:string|null;createdAt:number;updatedAt:number}
export interface TranscriptSegment {startMs:number;endMs:number;text:string}
export interface Transcript {id:string;attachmentId:number;model:string;language:string;durationMs:number;text:string;createdAt:number;segments:TranscriptSegment[]}

export interface NoteFull extends NoteMeta {
  contentHtml: string;
}

export interface Notebook {
  id: number;
  name: string;
  createdAt: number;
  noteCount: number;
  stackId: string | null;
}

export interface NotebookStack { id: string; name: string; sortOrder: number; notebookCount: number; noteCount: number; createdAt: number; updatedAt: number }
export interface NoteLinkTarget { id: string; title: string; preview: string }
export interface Task { id:string; noteId:string; noteTitle:string; title:string; done:boolean; dueAt:number|null; reminderAt:number|null; reminderState:'pending'|'delivered'; createdAt:number; updatedAt:number }
export interface CalendarEvent { id:string; noteId:string|null; noteTitle:string|null; title:string; description:string; startAt:number; endAt:number; timeZone:string; allDay:boolean; createdAt:number; updatedAt:number }

export interface Tag {
  id: number;
  name: string;
  noteCount: number;
}

export interface ListNotesQuery {
  view: NoteView;
  notebookId?: number;
  tagId?: number;
  query?: string;
  order?: SortOrder;
}

export interface SidebarCounts {
  all: number;
  favorites: number;
  trash: number;
  unfiled: number;
}

// z.guid() preserves Zod 3's permissive UUID-like contract across the v4 migration.
const IdSchema = z.guid();

export const ListNotesQuerySchema = z.object({
  view: NoteView,
  notebookId: z.number().int().optional(),
  tagId: z.number().int().optional(),
  query: z.string().max(500).optional(),
  order: SortOrder.optional().default("updated_desc"),
});

export const CreateNoteInputSchema = z.object({
  notebookId: z.number().int().nullable().optional(),
  title: z.string().max(300).optional(),
  contentHtml: z.string().max(2_000_000).optional(),
});

export const UpdateNoteInputSchema = z.object({
  id: IdSchema,
  title: z.string().max(300).optional(),
  contentHtml: z.string().max(2_000_000).optional(),
});

export const IdInputSchema = z.object({ id: IdSchema });
export const MoveNoteInputSchema = z.object({ id: IdSchema, notebookId: z.number().int().nullable() });
export const FlagInputSchema = z.object({ id: IdSchema, value: z.boolean() });

export const CreateNotebookInputSchema = z.object({ name: z.string().min(1).max(120) });
export const RenameNotebookInputSchema = z.object({ id: z.number().int(), name: z.string().min(1).max(120) });
export const StackIdInputSchema = z.object({ id: IdSchema });
export const StackNameInputSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const RenameStackInputSchema = StackIdInputSchema.extend({ name: z.string().trim().min(1).max(120) });
export const MoveNotebookStackInputSchema = z.object({ notebookId: z.number().int().positive(), stackId: IdSchema.nullable() });
export const FindNotesInputSchema = z.object({ query: z.string().trim().max(200), limit: z.number().int().min(1).max(50).default(20) });
export const TaskCreateSchema=z.object({noteId:IdSchema,title:z.string().trim().min(1).max(300),dueAt:z.number().int().nullable(),reminderAt:z.number().int().nullable()});
export const TaskUpdateSchema=z.object({id:IdSchema,noteId:IdSchema.optional(),title:z.string().trim().min(1).max(300).optional(),dueAt:z.number().int().nullable().optional(),reminderAt:z.number().int().nullable().optional(),done:z.boolean().optional()});
export const TaskListSchema=z.object({filter:z.enum(['today','upcoming','overdue','completed','all'])});
export const EventCreateSchema=z.object({noteId:IdSchema.nullable(),title:z.string().trim().min(1).max(300),description:z.string().max(10000),startAt:z.number().int(),endAt:z.number().int(),timeZone:z.string().min(1).max(100),allDay:z.boolean()});
export const EventUpdateSchema=EventCreateSchema.partial().extend({id:IdSchema});
export const EventRangeSchema=z.object({startAt:z.number().int(),endAt:z.number().int()});
export const AttachmentJobActionSchema=z.object({id:z.number().int().positive()});
export const TranscriptionQaTimeoutSchema=z.object({milliseconds:z.number().int().positive().max(5000).nullable()});

export const AttachTagInputSchema = z.object({ noteId: IdSchema, tagId: z.number().int() });
export const DetachTagInputSchema = z.object({ noteId: IdSchema, tagId: z.number().int() });
export const CreateTagInputSchema = z.object({ name: z.string().min(1).max(80) });

export const SaveAttachmentInputSchema = z.object({ noteId: IdSchema, name: z.string().min(1).max(300), dataBase64: z.string().max(70_000_000) });
export const SaveImageInputSchema = z.object({ noteId:IdSchema, name:z.string().min(1).max(300), dataBase64:z.string().min(1).max(14_000_000) });

export const ImportMarkdownInputSchema = z.object({
  notebookId: z.number().int().nullable(),
  items: z.array(z.object({ fileName: z.string(), content: z.string().max(2_000_000) })).max(500),
});
export const ImportEmlInputSchema = z.object({ notebookId:z.number().int().nullable() });

export const RestoreInputSchema = z.object({ json: z.string().max(100_000_000) });
export const SaveFileDialogInputSchema = z.object({ title: z.string().min(1).max(200), defaultName: z.string().min(1).max(260) });
export const OpenFileDialogInputSchema = z.object({
  title: z.string().min(1).max(200),
  filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string().min(1)) })).min(1).max(5),
});

export const ThemeValueSchema = z.enum(["light", "dark"]);

/** Mapa canal -> payload de entrada (útil no lado do main para despacho tipado). */
export interface ChannelInputs {
  "tasks:list": z.infer<typeof TaskListSchema>; "tasks:create":z.infer<typeof TaskCreateSchema>; "tasks:update":z.infer<typeof TaskUpdateSchema>; "tasks:delete":z.infer<typeof IdInputSchema>; "tasks:reminder-due":null;
  "events:list":z.infer<typeof EventRangeSchema>; "events:create":z.infer<typeof EventCreateSchema>; "events:update":z.infer<typeof EventUpdateSchema>; "events:delete":z.infer<typeof IdInputSchema>;
  "notes:list": ListNotesQuery;
  "notes:get": { id: string };
  "notes:find": z.infer<typeof FindNotesInputSchema>;
  "notes:create": z.infer<typeof CreateNoteInputSchema>;
  "notes:update": z.infer<typeof UpdateNoteInputSchema>;
  "notes:move": z.infer<typeof MoveNoteInputSchema>;
  "notes:favorite": z.infer<typeof FlagInputSchema>;
  "notes:pin": z.infer<typeof FlagInputSchema>;
  "notes:delete": z.infer<typeof IdInputSchema>;
  "notes:restore": z.infer<typeof IdInputSchema>;
  "notes:purge": z.infer<typeof IdInputSchema>;
  "notes:emptyTrash": null;
  "notebooks:list": null;
  "notebooks:create": z.infer<typeof CreateNotebookInputSchema>;
  "notebooks:rename": z.infer<typeof RenameNotebookInputSchema>;
  "notebooks:delete": { id: number };
  "notebooks:moveToStack": z.infer<typeof MoveNotebookStackInputSchema>;
  "stacks:list": null;
  "stacks:create": z.infer<typeof StackNameInputSchema>;
  "stacks:rename": z.infer<typeof RenameStackInputSchema>;
  "stacks:delete": z.infer<typeof StackIdInputSchema>;
  "tags:list": null;
  "tags:create": z.infer<typeof CreateTagInputSchema>;
  "tags:attach": z.infer<typeof AttachTagInputSchema>;
  "tags:detach": z.infer<typeof DetachTagInputSchema>;
  "counts:get": null;
  "theme:get": null;
  "theme:set": { value: z.infer<typeof ThemeValueSchema> };
  "attachments:list": { noteId: string };
  "attachments:save": z.infer<typeof SaveAttachmentInputSchema>;
  "images:save": z.infer<typeof SaveImageInputSchema>;
  "attachments:delete": { noteId: string; attachmentId: number };
  "attachments:open": { noteId: string; attachmentId: number };
  "export:markdown": { noteId: string };
  "import:markdown": z.infer<typeof ImportMarkdownInputSchema>;
  "import:eml": z.infer<typeof ImportEmlInputSchema>;
  "backup:save": null;
  "backup:restore": null;
  "dialog:save": z.infer<typeof SaveFileDialogInputSchema>;
  "dialog:open": z.infer<typeof OpenFileDialogInputSchema>;
  "app:meta": null;
  "clipper:status":null; "clipper:enable":null; "clipper:pair":null; "clipper:revoke":null;
  "attachments:jobs": null; "attachments:retry-job":z.infer<typeof AttachmentJobActionSchema>; "attachments:cancel-job":z.infer<typeof AttachmentJobActionSchema>; "attachments:reindex":null;
  "transcription:config":null; "transcription:configure":{runtime:string;ffmpeg:string}; "transcription:qa-timeout":z.infer<typeof TranscriptionQaTimeoutSchema>; "transcription:jobs":{noteId:string}; "transcription:list":{noteId:string}; "transcription:start":{noteId:string;attachmentId:number;language:"pt"|"auto"}; "transcription:cancel":{id:string};
}
