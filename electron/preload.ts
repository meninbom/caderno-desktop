import { contextBridge, ipcRenderer } from "electron";

const validChannels = new Set<string>([
  "notes:list", "notes:get", "notes:create", "notes:update", "notes:move", "notes:moveToFolder",
  "notes:backlinks","notes:search","pdf:list","pdf:save","pdf:delete",
  "notes:find", "notes:favorite", "notes:pin", "notes:delete", "notes:restore", "notes:purge",
  "notes:emptyTrash", "notebooks:list", "notebooks:create", "notebooks:rename",
  "notebooks:delete", "notebooks:moveToStack", "stacks:list", "stacks:create", "stacks:rename", "stacks:delete", "folders:list", "folders:create", "folders:rename", "folders:move", "folders:delete", "tags:list", "tags:create", "tags:rename", "tags:delete", "tags:attach", "tags:detach",
  "counts:get", "theme:get", "theme:set", "attachments:list", "attachments:save",
  "images:save",
  "tasks:list","tasks:create","tasks:update","tasks:delete","tasks:reminder-due","events:list","events:create","events:update","events:delete",
  "attachments:delete", "attachments:open", "export:markdown", "import:markdown", "import:eml",
  "backup:save", "backup:restore", "dialog:save", "dialog:open", "app:meta", "app:qa-ipc-counts", "attachments:jobs", "attachments:retry-job", "attachments:cancel-job", "attachments:reindex",
  "clipper:status", "clipper:enable", "clipper:pair", "clipper:revoke",
  "raycast:status", "raycast:enable", "raycast:pair", "raycast:revoke",
  "startup:get", "startup:set",
  "templates:list","templates:get","templates:create-from-note","templates:update","templates:delete","templates:apply","templates:restore-builtins",
  "export:begin","export:finish","export:abort","app:qa-save-dialog","app:qa-export-state",
  "transcription:config","transcription:configure","transcription:qa-timeout","transcription:jobs","transcription:list","transcription:start","transcription:cancel",
]);

const openNoteListeners = new Set<(noteId: string) => void>();
const pendingOpenNotes: string[] = [];
ipcRenderer.on("caderno:open-note", (_event, noteId: unknown) => {
  if (typeof noteId !== "string") return;
  if (openNoteListeners.size === 0) pendingOpenNotes.push(noteId);
  else for (const listener of openNoteListeners) listener(noteId);
});

contextBridge.exposeInMainWorld("cadernoDesktop", {
  onClipperCapture(listener:()=>void){const handler=()=>listener();ipcRenderer.on('clipper-note-created',handler);return()=>ipcRenderer.removeListener('clipper-note-created',handler);},
  onExternalDataChange(listener:()=>void){const handler=()=>listener();ipcRenderer.on('caderno-external-data-changed',handler);return()=>ipcRenderer.removeListener('caderno-external-data-changed',handler);},
  onOpenNote(listener:(noteId:string)=>void){openNoteListeners.add(listener);while(pendingOpenNotes.length)listener(pendingOpenNotes.shift()!);return()=>openNoteListeners.delete(listener);},
  invoke(channel: string, input: unknown) {
    if (!validChannels.has(channel)) {
      return Promise.resolve({ ok: false as const, error: `Canal não permitido: ${channel}` });
    }
    return ipcRenderer.invoke("ipc", channel, input);
  },
  onTranscriptionJobsChanged(listener:(noteId:string)=>void){const handler=(_event:Electron.IpcRendererEvent,noteId:string)=>listener(noteId);ipcRenderer.on('transcription-jobs-changed',handler);return()=>ipcRenderer.removeListener('transcription-jobs-changed',handler);},
  onReminder(listener:(kind:'click'|'fallback',value:string)=>void){
    const click=(_event:Electron.IpcRendererEvent,id:string)=>listener('click',id),fallback=(_event:Electron.IpcRendererEvent,title:string)=>listener('fallback',title);
    ipcRenderer.on('task-reminder-click',click);ipcRenderer.on('task-reminder-fallback',fallback);
    return ()=>{ipcRenderer.removeListener('task-reminder-click',click);ipcRenderer.removeListener('task-reminder-fallback',fallback)};
  },
});
