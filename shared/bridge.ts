import { ChannelInputs } from "./ipc";
import { AppMeta } from "./api";

/** Contexto do renderer: preload expõe esta ponte mínima e tipada. */
export interface RendererBridge {
  onClipperCapture?(listener:()=>void):()=>void;
  onExternalDataChange?(listener:()=>void):()=>void;
  onOpenNote?(listener:(noteId:string)=>void):()=>void;
  invoke(channel: string, input: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
  onReminder?(listener:(kind:'click'|'fallback',value:string)=>void):()=>void;
  onTranscriptionJobsChanged?(listener:(noteId:string)=>void):()=>void;
}

declare global {
  interface Window {
    cadernoDesktop?: RendererBridge;
  }
}

/** Lista exaustiva dos canais válidos (espelha o contrato IPC). */
export type ChannelName = keyof ChannelInputs;

export const CHANNEL_NAMES: ChannelName[] = [
  "notes:list", "notes:get", "notes:create", "notes:update", "notes:move", "notes:moveToFolder",
  "notes:find", "notes:favorite", "notes:pin", "notes:delete", "notes:restore", "notes:purge",
  "notes:emptyTrash", "notebooks:list", "notebooks:create", "notebooks:rename",
  "notebooks:delete", "notebooks:moveToStack", "stacks:list", "stacks:create", "stacks:rename", "stacks:delete", "folders:list", "folders:create", "folders:rename", "folders:delete", "tags:list", "tags:create", "tags:attach", "tags:detach",
  "counts:get", "theme:get", "theme:set", "attachments:list", "attachments:save",
  "attachments:delete", "attachments:open", "export:markdown", "import:markdown",
  "backup:save", "backup:restore", "dialog:save", "dialog:open", "app:meta", "attachments:jobs", "attachments:retry-job", "attachments:cancel-job", "attachments:reindex",
  "raycast:status", "raycast:enable", "raycast:pair", "raycast:revoke",
  "startup:get", "startup:set",
];

export interface AppRootInfo {
  name: string;
  version: string;
}

export function describeApp(): AppRootInfo {
  return { name: "caderno", version: "0.2.0" };
}

export type { AppMeta };
