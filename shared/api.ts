import {
  PdfListSchema, PdfSaveSchema,
  AttachTagInputSchema,
  CreateNoteInputSchema,
  CreateNotebookInputSchema,
  CreateTagInputSchema,
  RenameTagInputSchema, DeleteTagInputSchema, TagColorInputSchema,
  FindNotesInputSchema, MoveNoteFolderInputSchema, CreateFolderInputSchema, RenameFolderInputSchema, MoveFolderInputSchema,
  DetachTagInputSchema,
  FlagInputSchema,
  IdInputSchema,
  ImportMarkdownInputSchema,
  ImportEmlInputSchema,
  ListNotesQuerySchema,
  MoveNoteInputSchema,
  OpenFileDialogInputSchema,
  RenameNotebookInputSchema,
  SaveFileDialogInputSchema,
  SaveAttachmentInputSchema,
  SaveImageInputSchema,
  ThemeValueSchema,
  UpdateNoteInputSchema,
  TaskCreateSchema,TaskUpdateSchema,TaskListSchema,EventCreateSchema,EventUpdateSchema,EventRangeSchema,AttachmentJobActionSchema,
  TranscriptionQaTimeoutSchema,
  TemplateListSchema, TemplateFromNoteSchema, TemplateUpdateSchema, TemplateApplySchema,
  ExportBeginSchema, ExportFinishSchema, ExportTokenSchema, QaSaveDialogSchema,
} from "./ipc";
import { z } from "zod";

const ChannelSchemas: Record<string, unknown> = {
  "external:open": z.object({ url: z.string().max(2048) }),
  "tasks:list":TaskListSchema,"tasks:create":TaskCreateSchema,"tasks:update":TaskUpdateSchema,"tasks:delete":IdInputSchema,"tasks:reminder-due":null,
  "events:list":EventRangeSchema,"events:create":EventCreateSchema,"events:update":EventUpdateSchema,"events:delete":IdInputSchema,
  "notes:list": ListNotesQuerySchema,
  "notes:get": IdInputSchema,
  "notes:find": FindNotesInputSchema,
  "notes:backlinks": IdInputSchema, "notes:search": FindNotesInputSchema,
  "pdf:list":PdfListSchema,"pdf:save":PdfSaveSchema,"pdf:delete":IdInputSchema,
  "notes:create": CreateNoteInputSchema,
  "notes:update": UpdateNoteInputSchema,
  "notes:move": MoveNoteInputSchema,
  "notes:moveToFolder": MoveNoteFolderInputSchema,
  "notes:favorite": FlagInputSchema,
  "notes:pin": FlagInputSchema,
  "notes:delete": IdInputSchema,
  "notes:restore": IdInputSchema,
  "notes:purge": IdInputSchema,
  "notes:emptyTrash": null,
  "notebooks:list": null,
  "notebooks:create": CreateNotebookInputSchema,
  "notebooks:rename": RenameNotebookInputSchema,
  "notebooks:delete": z.object({ id: z.number().int() }),
  "folders:list": null,
  "folders:create": CreateFolderInputSchema,
  "folders:rename": RenameFolderInputSchema,
  "folders:move": MoveFolderInputSchema,
  "folders:delete": IdInputSchema,
  "tags:list": null,
  "tags:create": CreateTagInputSchema,
  "tags:rename": RenameTagInputSchema,
  "tags:setColor": TagColorInputSchema,
  "tags:delete": DeleteTagInputSchema,
  "tags:attach": AttachTagInputSchema,
  "tags:detach": DetachTagInputSchema,
  "counts:get": null,
  "theme:get": null,
  "theme:set": z.object({ value: ThemeValueSchema }),
  "attachments:list": z.object({ noteId: z.guid() }),
  "attachments:save": SaveAttachmentInputSchema,
  "images:save": SaveImageInputSchema,
  "attachments:delete": z.object({ noteId: z.guid(), attachmentId: z.number().int() }),
  "attachments:open": z.object({ noteId: z.guid(), attachmentId: z.number().int() }),
  "export:markdown": z.object({ noteId: z.guid() }),
  "import:markdown": ImportMarkdownInputSchema,
  "import:eml": ImportEmlInputSchema,
  "backup:save": null,
  "backup:restore": null,
  "dialog:save": SaveFileDialogInputSchema,
  "dialog:open": OpenFileDialogInputSchema,
  "app:meta": null,
  "startup:get": null, "startup:set": z.object({ enabled: z.boolean() }),
  "app:qa-ipc-counts": null,
  "clipper:status": null, "clipper:enable": null, "clipper:pair": null, "clipper:revoke": null,
  "raycast:status": null, "raycast:enable": null, "raycast:pair": null, "raycast:revoke": null,
  "attachments:jobs":null,"attachments:retry-job":AttachmentJobActionSchema,"attachments:cancel-job":AttachmentJobActionSchema,"attachments:reindex":null,
  "templates:list":TemplateListSchema,"templates:get":IdInputSchema,"templates:create-from-note":TemplateFromNoteSchema,"templates:update":TemplateUpdateSchema,"templates:delete":IdInputSchema,"templates:apply":TemplateApplySchema,"templates:restore-builtins":null,
  "export:begin":ExportBeginSchema,"export:finish":ExportFinishSchema,"export:abort":ExportTokenSchema,
  "app:qa-save-dialog":QaSaveDialogSchema,"app:qa-export-state":null,
  "transcription:config":null,"transcription:configure":z.object({runtime:z.string().max(1000),ffmpeg:z.string().max(1000)}),"transcription:qa-timeout":TranscriptionQaTimeoutSchema,"transcription:jobs":z.object({noteId:z.guid()}),"transcription:list":z.object({noteId:z.guid()}),"transcription:start":z.object({noteId:z.guid(),attachmentId:z.number().int().positive(),language:z.enum(["pt","auto"])}),"transcription:cancel":z.object({id:z.guid()}),
};

export interface AppMeta {
  name: string;
  version: string;
  userDataPath: string;
  platform: string;
}

/** Valida entrada por canal; reutilizável por main e testes. */
export function validateInput(channel: string, rawInput: unknown): { ok: true; data: unknown } | { ok: false; error: string } {
  const schema = ChannelSchemas[channel];
  if (schema === undefined) return { ok: false, error: `Canal desconhecido: ${channel}` };
  if (schema === null) {
    if (rawInput !== null && rawInput !== undefined) return { ok: false, error: `Canal ${channel} não aceita entrada` };
    return { ok: true, data: null };
  }
  const result = (schema as z.ZodType).safeParse(rawInput);
  if (!result.success) {
    return { ok: false, error: `Validação IPC falhou em ${channel}: ${result.error.issues.map(i => `${i.path.join(".") || "(raiz)"} ${i.message}`).join("; ")}` };
  }
  return { ok: true, data: result.data };
}
