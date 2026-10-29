import { app, BrowserWindow, dialog, ipcMain, shell, protocol, nativeImage, Notification, utilityProcess } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import { Readable } from "node:stream";
import { openDatabase } from "./repo/db";
import { CountsRepo, Meta, NotebooksRepo, NotesRepo, TagsRepo, NotebookStacksRepo, TasksRepo, EventsRepo, AttachmentJobsRepo } from "./repo/sqlite";
import { AttachmentsRepo, BackupRepo, inspectRaster } from "./repo/attachments";
import { TranscriptionsRepo } from "./repo/sqlite";

protocol.registerSchemesAsPrivileged([{ scheme: "caderno-asset", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);
import { ListNotesQuery } from "../shared/ipc";
import { validateInput } from "../shared/api";
import { markdownFromNote, markdownToNoteHtml, markdownHeadline } from "./repo/markdown";
import {LocalReminderScheduler} from './reminders';
import { parseEml } from "./repo/eml";
import { ClipperBridge } from "./clipper-bridge";

const isDev = process.env.CADERNO_DEV === "1";

function isTrustedRendererUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    if (isDev) return url.protocol === "http:" && url.hostname === "localhost" && url.port === "5173" && url.pathname === "/";
    return url.protocol === "file:" && path.resolve(fileURLToPath(url)) === path.resolve(__dirname, "../dist/index.html");
  } catch { return false; }
}

function safeExternalUrl(raw: string): boolean {
  try { const url = new URL(raw); return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password; }
  catch { return false; }
}

// Small lifecycle log in the active profile makes unexpected Electron/renderer
// exits diagnosable after the parent process has already gone away.
function lifecycle(event: string, details: unknown = {}): void {
  try {
    const dir = app.getPath("userData");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "lifecycle.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, details })}\n`, "utf8");
  } catch (error) { console.error("lifecycle log write failed", error); }
}
process.on("uncaughtExceptionMonitor", error => lifecycle("uncaughtException", { name: error.name, message: error.message, stack: error.stack }));
process.on("exit", code => lifecycle("process-exit", { code, runningAttachmentJobId, jobStopping }));
app.on("child-process-gone", (_event, details) => lifecycle("child-process-gone", details));
app.whenReady().then(() => {
  const ses = require("electron").session.defaultSession as Electron.Session;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = details.requestingUrl ?? "";
    const trusted = Boolean(mainWindow && contents.id === mainWindow.webContents.id && (origin.startsWith("file://") || (isDev && /^https?:\/\/localhost:5173\//.test(origin))));
    callback(trusted && permission === "media" && ((details as Electron.MediaAccessPermissionRequest).mediaTypes ?? []).includes("audio"));
  });
});

// Isolamento de QA: redireciona o userData para um perfil temporário, sem
// nunca tocar o banco real do usuário (%APPDATA%\caderno).
if (process.env.CADERNO_USER_DATA) {
  app.setPath("userData", process.env.CADERNO_USER_DATA);
}

let repos: {
  notes: NotesRepo;
  notebooks: NotebooksRepo;
  stacks: NotebookStacksRepo;
  tags: TagsRepo;
  counts: CountsRepo;
  meta: Meta;
  attachments: AttachmentsRepo;
  backup: BackupRepo;
  tasks: TasksRepo;
  events: EventsRepo;
  attachmentJobs: AttachmentJobsRepo;
};
const qaIpcCounts: Record<string, number> = {};
let mainWindow: BrowserWindow | null = null;
let jobWorker: Electron.UtilityProcess | null = null;
let jobBusy = false;
let runningAttachmentJobId: number | null = null;
let jobTimer: ReturnType<typeof setInterval> | null = null;
let jobStopping = false;
let quitAfterAttachmentWorker = false;
let clipperBridge: ClipperBridge | null = null;
let transcriptionRepo:TranscriptionsRepo|null=null,transcriptionWorker:Electron.UtilityProcess|null=null,transcriptionBusy=false,transcriptionTimer:ReturnType<typeof setInterval>|null=null,transcriptionStopping=false;
let transcriptionTestTimeout:number|null=null;
let transcriptionConfig:{runtime:string;ffmpeg:string}|null=null;
let clipperStopping=false;
function getTranscriptionConfig(){if(transcriptionConfig)return transcriptionConfig;const local=process.env.LOCALAPPDATA??app.getPath("userData");const candidates=(process.env.PATH??"").split(path.delimiter).map(x=>path.join(x,"ffmpeg.exe"));const ffmpeg=candidates.find(fs.existsSync)??"ffmpeg.exe";return transcriptionConfig={runtime:path.join(local,"Caderno Tools","transcription","whisper.cpp-b5454"),ffmpeg};}
function runNextTranscription(){if(transcriptionBusy||transcriptionStopping||!transcriptionRepo||!repos)return;const job=transcriptionRepo.queued();if(!job)return;transcriptionBusy=true;try{const a=repos.attachments.open(job.noteId,job.attachmentId);if(!a)throw new Error("Anexo não encontrado.");const cfg=getTranscriptionConfig(),runtime=path.resolve(cfg.runtime),jobDir=path.join(runtime,"jobs",job.id.replace(/-/g,""));
 const worker=utilityProcess.fork(path.join(__dirname,"transcription-worker.cjs"),[],{serviceName:"Caderno Transcrição Local",stdio:"ignore"});transcriptionWorker=worker;let settled=false;lifecycle("transcription-worker-start",{jobId:job.id,workerPath:path.join(__dirname,"transcription-worker.cjs")});
 worker.on("message",(message:unknown)=>{if(transcriptionWorker!==worker)return;const m=message as any;if(m.status==="ready"){lifecycle("transcription-worker-ready",{jobId:job.id});return;}if(m.status==="converting"||m.status==="transcribing"){transcriptionRepo?.progress(job.id,m.status,m.progress,m.stage);mainWindow?.webContents.send("transcription-jobs-changed",job.noteId);return;}if(m.status==="idle"){worker.kill();return;}settled=true;try{if(m.status==="completed")transcriptionRepo?.complete(job,m);else transcriptionRepo?.settle(job.id,m.status==="canceled"?"canceled":"failed",m.error);}catch(e){transcriptionRepo?.settle(job.id,"failed","Falha ao salvar a transcrição local.");lifecycle("transcription-save-failed",{jobId:job.id,message:e instanceof Error?e.message:String(e)});}});
  worker.once("error",(type)=>{lifecycle("transcription-worker-error",{jobId:job.id,type});transcriptionRepo?.settle(job.id,"failed",`Worker local falhou: ${type}.`);});worker.once("exit",code=>{lifecycle("transcription-worker-exit",{jobId:job.id,code,resultHandled:settled,stopping:transcriptionStopping});if(transcriptionWorker!==worker)return;if(!settled&&!transcriptionStopping)transcriptionRepo?.settle(job.id,"failed",`Worker de transcrição encerrou (código ${code}).`);transcriptionWorker=null;transcriptionBusy=false;if(!transcriptionStopping){mainWindow?.webContents.send("transcription-jobs-changed",job.noteId);setImmediate(runNextTranscription);}});
  worker.postMessage({id:job.id,audioPath:a.filePath,fileName:job.fileName,jobDir,runtime,ffmpeg:cfg.ffmpeg,language:job.language,...(transcriptionTestTimeout?{timeout:transcriptionTestTimeout}:{})});}catch(error){transcriptionRepo.settle(job.id,"failed",error instanceof Error?error.message:String(error));transcriptionBusy=false;lifecycle("transcription-start-failed",{jobId:job.id,message:error instanceof Error?error.message:String(error)});}}

function runNextAttachmentJob(): void {
  if(jobBusy||jobStopping||!repos)return;
  const job=repos.attachmentJobs.next(); if(!job)return;
  jobBusy=true;
  const attachment=repos.attachmentJobs.getAttachment(job.attachmentId);
  if(!attachment){repos.attachmentJobs.fail(job.id,"Registro de anexo ausente.");jobBusy=false;runningAttachmentJobId=null;return;}
  runningAttachmentJobId=job.id;
  const worker=utilityProcess.fork(path.join(__dirname,"attachment-worker.cjs"), [], { serviceName: "Caderno Attachment OCR", stdio: "ignore" }); jobWorker=worker;
  const filePath=path.join(app.getPath("userData"),"attachments",attachment.storedName);
  let resultHandled = false;
  worker.on("message",(message:unknown)=>{
    if (jobWorker !== worker) return;
    const result=message as {ok:boolean;text?:string;error?:string;canceled?:boolean;sourceKind?:'text'|'pdf'|'ocr';progress?:number;checkpoint?:number;totalPages?:number};
    if(result.progress!==undefined){if(!jobStopping){repos.attachmentJobs.progress(job.id,result.progress,result.checkpoint??0,result.totalPages??0);mainWindow?.webContents.send("attachment-jobs-changed");}return;}
    try {
      resultHandled = true;
      if(result.canceled) return;
      const current=repos.attachmentJobs.list().find(x=>x.id===job.id);
      if(current?.status==="cancel_requested") return;
      if(result.ok) repos.attachmentJobs.complete(job.id,job.attachmentId,attachment.noteId,attachment.fileName,result.text??"",result.sourceKind);
      else repos.attachmentJobs.fail(job.id,result.error??"Falha na extração local.");
    } catch(error) {
      lifecycle("attachment-job-settle-error", { jobId: job.id, message: error instanceof Error ? error.message : String(error) });
      repos.attachmentJobs.fail(job.id, "Falha ao salvar o resultado da extração.");
    }
  });
  worker.once("error",(type,location,report)=>{lifecycle("attachment-worker-error", { jobId: job.id, type, location, report: report.slice(0, 4000) });if(jobWorker===worker)repos.attachmentJobs.fail(job.id,`Worker de extração falhou: ${type}.`);});
  worker.once("exit",code=>{
    lifecycle("attachment-worker-exit", { jobId: job.id, code, stopping: jobStopping, resultHandled });
    if(jobWorker!==worker)return;
    if(!resultHandled&&!jobStopping)repos.attachmentJobs.fail(job.id,`Worker de extração encerrou inesperadamente (código ${code}).`);
    jobWorker=null;jobBusy=false;runningAttachmentJobId=null;
    if(!jobStopping){mainWindow?.webContents.send("attachment-jobs-changed");setImmediate(runNextAttachmentJob);}
    else if(quitAfterAttachmentWorker){quitAfterAttachmentWorker=false;app.quit();}
  });
  worker.postMessage({id:job.id,filePath,fileName:job.fileName});
}

function titleBarOverlayOptions(theme: string | null) {
  const dark = theme === "dark";
  return {
    color: dark ? "#0a0a0a" : "#fcfcfc",
    symbolColor: dark ? "#f5f5f5" : "#27272a",
    height: 40,
  };
}

async function captureWindow(win: BrowserWindow): Promise<Buffer> {
  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  console.log("capturePage bytes:", png.length);
  if (png.length > 0) return png;
  await win.webContents.debugger.attach("1.3");
  const shot = await win.webContents.debugger.sendCommand("Page.captureScreenshot", { format: "png" });
  await win.webContents.debugger.detach();
  return Buffer.from(shot.data, "base64");
}

function createWindow(): BrowserWindow {
  const captureMode = Boolean(process.env.CADERNO_CAPTURE);
  const winWidth = Number(process.env.CADERNO_WINDOW_WIDTH) || 1200;
  const winHeight = Number(process.env.CADERNO_WINDOW_HEIGHT) || 780;
  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 900,
    minHeight: 560,
    title: "Caderno",
    titleBarStyle: process.platform === "win32" ? "hidden" : "default",
    ...(process.platform === "win32" ? { titleBarOverlay: titleBarOverlayOptions(repos.meta.get("theme")) } : {}),
    backgroundColor: "#ffffff",
    show: !captureMode,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: captureMode,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow = win;
  const webContentsId = win.webContents.id;
  win.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    if (safeExternalUrl(url)) void shell.openExternal(url).catch(error => lifecycle("external-link-open-failed", { message: String(error) }));
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (safeExternalUrl(url)) void shell.openExternal(url).catch(error => lifecycle("external-link-open-failed", { message: String(error) }));
    return { action: "deny" };
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  if (captureMode) {
    // Em captura, mantemos a janela fora da tela do usuário e capturamos pelo compositor
    win.setBounds({ x: 0, y: 0, width: winWidth, height: winHeight });
    setTimeout(() => win.showInactive(), 800);
  }

  win.webContents.on("render-process-gone", (_e, details) => lifecycle("render-process-gone", details));
  win.webContents.on("destroyed", () => lifecycle("webContents-destroyed", { id: webContentsId }));
  win.on("closed", () => lifecycle("window-closed", { id: webContentsId }));
  if (process.env.CADERNO_DEBUG === "1") {
    win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
    win.webContents.on("did-fail-load", (_e, code, desc, url) => {
      console.log(`[did-fail-load] ${code} ${desc} ${url}`);
    });
    win.webContents.on("preload-error", (_e, preloadPath, err) => {
      console.log(`[preload-error] ${preloadPath}: ${err}`);
    });
    win.webContents.on("render-process-gone", (_e, details) => {
      console.log(`[render-process-gone] ${JSON.stringify(details)}`);
    });
  }

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Evidência de QA: captura a janela Electron real em PNG quando CADERNO_CAPTURE é definido.
  const capturePath = process.env.CADERNO_CAPTURE;
  if (capturePath) {
    win.webContents.on("did-finish-load", () => {
      const automations: Promise<void>[] = [];
      if (process.env.CADERNO_THEME === "dark") {
        automations.push(
          win.webContents.executeJavaScript(`(async () => {
            for (let i = 0; i < 40; i++) {
              const btn = [...document.querySelectorAll("button")].find(b => b.title === "Alternar tema");
              if (btn) break;
              await new Promise(r => setTimeout(r, 100));
            }
            const btn = [...document.querySelectorAll("button")].find(b => b.title === "Alternar tema");
            if (!btn) return "no-button";
            for (let i = 0; i < 20; i++) {
              btn.click();
              await new Promise(r => setTimeout(r, 150));
              if (document.documentElement.getAttribute("data-theme") === "dark") return "dark-applied";
            }
            return "clicked-but-light:" + document.documentElement.getAttribute("data-theme");
          })()`, true).then(r => console.log("[qa] theme:", r))
        );
      }
      if (process.env.CADERNO_OPEN_FIRST === "1") {
        automations.push(
          win.webContents.executeJavaScript(`(async () => {
            for (let i = 0; i < 40; i++) {
              const rows = document.querySelectorAll(".note-row");
              if (rows.length) { rows[0].click(); return "clicked"; }
              await new Promise(r => setTimeout(r, 100));
            }
            return "no-rows";
          })()`, true).then(r => console.log("[qa] open-first:", r))
        );
      }
      Promise.allSettled(automations).then(() => {});
      setTimeout(async () => {
        const withSuffix = process.env.CADERNO_CAPTURE_SUFFIX;
        const out = withSuffix ? capturePath.replace(/\.png$/, `-${withSuffix}.png`) : capturePath;
        try {
          const png = await captureWindow(win);
          if (png.length === 0) throw new Error("captura vazia");
          await fs.promises.writeFile(out, png);
          console.log(`Capture salvo: ${out}`);
        } catch (err) {
          console.error("Falha na captura:", err);
        } finally {
          app.exit(0);
        }
      }, 3200);
    });
  }
  return win;
}

type Handler = (input: any) => Promise<unknown> | unknown;

function registerHandlers(): void {
  const handlers: Record<string, Handler> = {
    "transcription:config":()=>{const c=getTranscriptionConfig();return transcriptionRepo?.config(path.resolve(c.runtime),path.resolve(c.ffmpeg));},
    "transcription:qa-timeout":(x)=>{if(process.env.CADERNO_QA_IPC!=="1")throw new Error("Canal disponível somente no perfil de QA.");transcriptionTestTimeout=x.milliseconds===null?null:x.milliseconds;return true;},
    "transcription:configure":(x)=>{const cfg={runtime:path.resolve(x.runtime),ffmpeg:path.resolve(x.ffmpeg)};transcriptionConfig=cfg;fs.writeFileSync(path.join(app.getPath("userData"),"transcription-config.json"),JSON.stringify(cfg),"utf8");return transcriptionRepo?.config(cfg.runtime,cfg.ffmpeg);},
    "transcription:jobs":(x)=>transcriptionRepo?.list(x.noteId)??[],"transcription:list":(x)=>transcriptionRepo?.get(x.noteId)??[],
    "transcription:start":(x)=>{const j=transcriptionRepo!.enqueue(x.noteId,x.attachmentId,x.language);runNextTranscription();return j;},
    "transcription:cancel":(x)=>{const ok=transcriptionRepo!.cancel(x.id);if(ok&&transcriptionBusy)transcriptionWorker?.postMessage({id:x.id,cancel:true});return ok;},
    "attachments:jobs":()=>repos.attachmentJobs.list(),
    "attachments:retry-job":({id})=>{const ok=repos.attachmentJobs.retry(id);runNextAttachmentJob();return ok;},
    "attachments:cancel-job":({id})=>{const ok=repos.attachmentJobs.cancel(id);if(ok&&runningAttachmentJobId===id)jobWorker?.postMessage({id,cancel:true});mainWindow?.webContents.send("attachment-jobs-changed");return ok;},
    "attachments:reindex":()=>repos.attachmentJobs.reindex(),
    "tasks:list":(x)=>repos.tasks.list(x.filter),"tasks:create":(x)=>repos.tasks.create(x),"tasks:update":(x)=>repos.tasks.update(x),"tasks:delete":(x)=>repos.tasks.delete(x.id),"tasks:reminder-due":()=>repos.tasks.deliverDue(Date.now(),10),
    "events:list":(x)=>repos.events.list(x.startAt,x.endAt),"events:create":(x)=>repos.events.create(x),"events:update":(x)=>repos.events.update(x),"events:delete":(x)=>repos.events.delete(x.id),
    "notes:list": (input: ListNotesQuery) => repos.notes.list(input),
    "notes:get": (input: { id: string }) => repos.notes.get(input.id),
    "notes:find": (input: { query: string; limit: number }) => repos.notes.find(input.query, input.limit),
    "notes:create": (input) => repos.notes.create(input),
    "notes:update": async (input) => {
      const delay = process.env.CADERNO_QA_UPDATE_DELAY_MS === "1" ? 180 : 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return repos.notes.update(input.id, input);
    },
    "notes:move": (input) => repos.notes.move(input.id, input.notebookId),
    "notes:favorite": (input) => repos.notes.setFlag(input.id, "favorited", input.value),
    "notes:pin": (input) => repos.notes.setFlag(input.id, "pinned", input.value),
    "notes:delete": (input) => repos.notes.softDelete(input.id),
    "notes:restore": (input) => repos.notes.restore(input.id),
    "notes:purge": (input) => repos.notes.purge(input.id),
    "notes:emptyTrash": () => repos.notes.emptyTrash(),
    "notebooks:list": () => repos.notebooks.list(),
    "notebooks:create": (input) => repos.notebooks.create(input.name),
    "notebooks:rename": (input) => repos.notebooks.rename(input.id, input.name),
    "notebooks:delete": (input) => repos.notebooks.delete(input.id),
    "notebooks:moveToStack": (input) => repos.notebooks.moveToStack(input.notebookId, input.stackId),
    "stacks:list": () => repos.stacks.list(),
    "stacks:create": (input) => repos.stacks.create(input.name.trim()),
    "stacks:rename": (input) => repos.stacks.rename(input.id, input.name.trim()),
    "stacks:delete": (input) => repos.stacks.delete(input.id),
    "tags:list": () => repos.tags.list(),
    "tags:create": (input) => repos.tags.create(input.name),
    "tags:attach": (input) => repos.tags.attach(input.noteId, input.tagId),
    "tags:detach": (input) => repos.tags.detach(input.noteId, input.tagId),
    "counts:get": () => repos.counts.get(),
    "theme:get": () => repos.meta.get("theme"),
    "theme:set": (input) => {
      repos.meta.set("theme", input.value);
      if (process.platform === "win32") mainWindow?.setTitleBarOverlay(titleBarOverlayOptions(input.value));
      return true;
    },
    "attachments:list": (input) => repos.attachments.list(input.noteId),
    "attachments:save": (input) => {
      const buffer = Buffer.from(input.dataBase64, "base64");
      return repos.attachments.save(input.noteId, input.name, buffer);
    },
    "images:save": (input) => {
      const data=Buffer.from(input.dataBase64,"base64");
      if(data.toString("base64")!==input.dataBase64) throw new Error("Imagem codificada inválida");
      const decoded=nativeImage.createFromBuffer(data);if(decoded.isEmpty()||decoded.getSize().width*decoded.getSize().height>40_000_000)throw new Error("Imagem não pôde ser decodificada ou excede 40 MP");
      return repos.attachments.saveImage(input.noteId,input.name,data);
    },
    "attachments:delete": (input) => repos.attachments.remove(input.noteId, input.attachmentId),
    "attachments:open": async (input) => {
      const found = repos.attachments.open(input.noteId, input.attachmentId);
      if (!found) return null;
      if (!fs.existsSync(found.filePath)) throw new Error(`Arquivo de anexo ausente: ${found.fileName}`);
      const error = await shell.openPath(found.filePath);
      if (error) throw new Error(`Não foi possível abrir o anexo: ${error}`);
      return found;
    },
    "export:markdown": async (input) => {
      const note = repos.notes.markdownOfNote(input.noteId);
      if (!note) return null;
      const result = await dialog.showSaveDialog({
        title: "Exportar nota em Markdown",
        defaultPath: `${(note.title || "sem-titulo").slice(0, 80).replace(/[\\/:*?"<>|]/g, "_")}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const md = markdownFromNote(note);
      fs.writeFileSync(result.filePath, md, "utf8");
      return { canceled: false, filePath: result.filePath };
    },
    "import:markdown": async (input) => {
      let created = 0;
      for (const item of input.items) {
        const html = markdownToNoteHtml(item.content);
        const titleFromContent = markdownHeadline(item.content) ?? item.fileName.replace(/\.[^.]+$/, "");
        repos.notes.create({ notebookId: input.notebookId ?? null, title: titleFromContent, contentHtml: html });
        created += 1;
      }
      return { created };
    },
    "import:eml": async (input) => {
      const pick = await dialog.showOpenDialog({ title: "Importar e-mail (.eml)", properties: ["openFile", "multiSelections"], filters: [{ name: "E-mail", extensions: ["eml"] }] });
      if (pick.canceled || !pick.filePaths.length) return { canceled: true };
      const messages: any[] = [], errors: string[] = []; let created = 0, duplicates = 0, attachments = 0;
      for (const filePath of pick.filePaths) {
        try {
          if (typeof filePath !== "string" || !filePath) throw new Error("Caminho de arquivo inválido.");
          const stat = fs.statSync(filePath); if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error("Arquivo acima de 25 MB ou inválido.");
          const parsed = await parseEml(fs.readFileSync(filePath), path.basename(filePath));
          const result = repos.attachments.importEml(input.notebookId, parsed);
          if (result.duplicate) duplicates++; else { created++; attachments += result.attachmentCount; }
        } catch (error) { errors.push(`${typeof filePath === "string" ? path.basename(filePath) : "arquivo"}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      mainWindow?.webContents.send("attachments-jobs-changed");
      return { created, duplicates, attachments, errors };
    },
    "backup:save": async () => {
      const payload = repos.backup.dump();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const result = await dialog.showSaveDialog({
        title: "Salvar backup",
        defaultPath: `caderno-backup-${stamp}.json`,
        filters: [{ name: "Backup Caderno", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const json=JSON.stringify(payload);
      if(Buffer.byteLength(json,"utf8")>500*1024*1024) throw new Error("Backup ultrapassa 500 MB");
      const temp=`${result.filePath}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temp,json,{flag:"wx"});
      try{fs.renameSync(temp,result.filePath);}catch(err){fs.rmSync(temp,{force:true});throw err;}
      return { canceled: false, filePath: result.filePath };
    },
    "backup:restore": async () => {
      const result = await dialog.showOpenDialog({
        title: "Restaurar backup",
        properties: ["openFile"],
        filters: [{ name: "Backup Caderno", extensions: ["json"] }],
      });
      if (result.canceled || result.filePaths.length === 0) return { canceled: true };
      if(fs.statSync(result.filePaths[0]).size>500*1024*1024) return {ok:false,error:"Backup ultrapassa 500 MB; nada foi alterado"};
      const json = fs.readFileSync(result.filePaths[0], "utf8");
      let parsed: any;try{parsed=JSON.parse(json);}catch{return {ok:false,error:"Backup inválido: JSON corrompido; nada foi alterado"};}
      if(Array.isArray(parsed?.attachments)) for(const asset of parsed.attachments){if(asset?.kind!=="image")continue;const bytes=Buffer.from(String(asset.dataBase64??""),"base64");const decoded=nativeImage.createFromBuffer(bytes);if(decoded.isEmpty()||decoded.getSize().width*decoded.getSize().height>40_000_000)return {ok:false,error:`Imagem corrompida no backup (${String(asset.fileName).slice(0,100)}); nada foi alterado`};}
      return repos.backup.restore(json);
    },
    "dialog:save": async (input) => {
      const result = await dialog.showSaveDialog({ title: input.title, defaultPath: input.defaultName });
      if (result.canceled || !result.filePath) return { canceled: true, filePath: null };
      return { canceled: false, filePath: result.filePath };
    },
    "dialog:open": async (input) => {
      const result = await dialog.showOpenDialog({ title: input.title, properties: ["openFile", "multiSelections"], filters: input.filters });
      if (result.canceled || result.filePaths.length === 0) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: result.filePaths };
    },
    "app:meta": () => ({ name: "caderno", version: app.getVersion(), userDataPath: app.getPath("userData"), platform: process.platform }),
    "clipper:status": () => clipperBridge?.status() ?? { enabled: false, paired: false, port: null },
    "clipper:enable": () => clipperBridge!.enable(),
    "clipper:pair": () => clipperBridge!.startPairing(),
    "clipper:revoke": async () => { await clipperBridge?.revoke(); return true; },
    "app:qa-ipc-counts": () => process.env.CADERNO_QA_IPC === "1" ? { ...qaIpcCounts } : null,
  };

  ipcMain.handle("ipc", async (event, channel: string, rawInput: unknown) => {
    if (event.sender.id !== mainWindow?.webContents.id || !event.senderFrame || event.senderFrame.parent !== null || !isTrustedRendererUrl(event.senderFrame.url))
      return { ok: false, error: "Origem IPC não autorizada." };
    if (process.env.CADERNO_QA_IPC === "1") qaIpcCounts[channel] = (qaIpcCounts[channel] ?? 0) + 1;
    const validated = validateInput(channel, rawInput);
    if (!validated.ok) return { ok: false, error: validated.error };
    const handler = handlers[channel];
    if (!handler) return { ok: false, error: `Canal sem handler: ${channel}` };
    try {
      const data = await (handler as (input: unknown) => Promise<unknown>)(validated.data);
      return { ok: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });
  ipcMain.handle("meta", () => ({ name: "caderno", version: app.getVersion(), userDataPath: app.getPath("userData"), platform: process.platform }));
  if (process.env.CADERNO_QA_IPC === "1") ipcMain.handle("qa:ipc-counts", () => ({ ...qaIpcCounts }));
}

app.whenReady().then(() => {
  const userData = app.getPath("userData");
  const files = {
    database: path.join(userData, "caderno.sqlite"),
    attachments: path.join(userData, "attachments"),
  };
  const db = openDatabase(files);
  transcriptionRepo=new TranscriptionsRepo(db);try{const configPath=path.join(userData,"transcription-config.json");if(fs.existsSync(configPath)){const saved=JSON.parse(fs.readFileSync(configPath,"utf8"));if(typeof saved.runtime==="string"&&typeof saved.ffmpeg==="string")transcriptionConfig=saved;}}catch{transcriptionConfig=null;}
  repos = {
    notes: new NotesRepo(db),
    notebooks: new NotebooksRepo(db),
    stacks: new NotebookStacksRepo(db),
    tags: new TagsRepo(db),
    counts: new CountsRepo(db),
    meta: new Meta(db),
    attachments: new AttachmentsRepo(db, files.attachments),
    backup: new BackupRepo(db, files.attachments),
    tasks:new TasksRepo(db),
    events:new EventsRepo(db),
    attachmentJobs:new AttachmentJobsRepo(db),
  };
  clipperBridge = new ClipperBridge({ notes: repos.notes, notebooks: repos.notebooks }, () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('clipper-note-created');
  });
  repos.attachmentJobs.recover();
  for(const staleId of transcriptionRepo.recover()){if(!/^[0-9a-f-]{36}$/i.test(staleId))continue;const root=path.resolve(getTranscriptionConfig().runtime,"jobs"),staging=path.resolve(root,staleId.replace(/-/g,""));if(staging.startsWith(`${root}${path.sep}`))try{fs.rmSync(staging,{recursive:true,force:true});}catch{}}
  protocol.handle("caderno-asset", request => {
    let name=""; try { const u=new URL(request.url); if(u.username||u.password||u.port||u.pathname!=="/")return new Response("Invalid asset URL",{status:400});name=u.hostname; } catch { return new Response("Invalid asset URL",{status:400}); }
    const media=repos.attachments.media(name); if(!media)return new Response("Not found",{status:404});
    const headers:Record<string,string>={"Content-Type":media.mime==="text/html"?"text/html; charset=utf-8":media.mime,"X-Content-Type-Options":"nosniff","Cache-Control":"no-store","Accept-Ranges":"bytes","Content-Length":String(media.size)};
    if(media.mime==="text/html")headers["Content-Security-Policy"]="default-src 'none'; img-src caderno-asset: data:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    let start=0,end=media.size-1,status=200;
    const range=request.headers.get("range");
    if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{"Content-Range":`bytes */${media.size}`,"Accept-Ranges":"bytes"}});
      if(!match[1]){const suffix=Number(match[2]);if(!suffix||!Number.isSafeInteger(suffix))return new Response(null,{status:416,headers:{"Content-Range":`bytes */${media.size}`}});start=Math.max(0,media.size-suffix);}
      else start=Number(match[1]); if(match[1]&&match[2])end=Number(match[2]);
      if(start>=media.size||end<start)return new Response(null,{status:416,headers:{"Content-Range":`bytes */${media.size}`,"Accept-Ranges":"bytes"}});
      end=Math.min(end,media.size-1);status=206;headers["Content-Range"]= `bytes ${start}-${end}/${media.size}`;headers["Content-Length"]=String(end-start+1);
    }
    if(request.method==="HEAD")return new Response(null,{status,headers});
    let fd:number;
    try {
      const flags=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0);fd=fs.openSync(media.filePath,flags);
      const stat=fs.fstatSync(fd);
      if(!stat.isFile()||stat.size!==media.size||fs.realpathSync(media.filePath)!==media.filePath){fs.closeSync(fd);return new Response("Invalid asset",{status:415});}
    } catch { return new Response("Not found",{status:404}); }
    const stream=fs.createReadStream(media.filePath,{fd,autoClose:true,start,end});
    return new Response(Readable.toWeb(stream) as ReadableStream,{status,headers});
  });
  registerHandlers();
  jobTimer=setInterval(runNextAttachmentJob,350);jobTimer.unref();runNextAttachmentJob();
  transcriptionTimer=setInterval(runNextTranscription,700);transcriptionTimer.unref();runNextTranscription();
  createWindow();
  // Poll only while this process is alive. Delivered rows are persisted before OS notification.
  const scheduler=new LocalReminderScheduler((now,limit)=>repos.tasks.deliverDue(now,limit),{show(task){if(!Notification.isSupported())throw new Error('unsupported');const n=new Notification({title:'Lembrete de tarefa',body:task.title});n.on('click',()=>{if(mainWindow){mainWindow.show();mainWindow.focus();mainWindow.webContents.send('task-reminder-click',task.id);}});n.show();},fallback(task){mainWindow?.webContents.send('task-reminder-fallback',task.title);}});
  mainWindow?.webContents.once('did-finish-load',()=>scheduler.start());app.on('will-quit',()=>scheduler.stop());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit",event=>{
  if(transcriptionWorker&&!transcriptionStopping){event.preventDefault();transcriptionStopping=true;if(transcriptionTimer)clearInterval(transcriptionTimer);transcriptionWorker.postMessage({cancel:true});const worker=transcriptionWorker;setTimeout(()=>{if(transcriptionWorker===worker)worker.kill();},2500).unref();worker.once("exit",()=>{transcriptionStopping=false;app.quit();});return;}
  if(jobStopping)return;
  lifecycle("before-quit", { runningAttachmentJobId });jobStopping=true;if(jobTimer)clearInterval(jobTimer);
  if(clipperBridge&&!clipperStopping){event.preventDefault();clipperStopping=true;void clipperBridge.close().catch(error=>lifecycle("clipper-close-error",{message:error instanceof Error?error.message:String(error)})).finally(()=>{clipperStopping=false;app.quit();});}
  const worker=jobWorker;
  if(!worker)return;
  event.preventDefault();quitAfterAttachmentWorker=true;
  if(runningAttachmentJobId!==null)worker.postMessage({id:runningAttachmentJobId,cancel:true});
  const stopTimer=setTimeout(async()=>{
    if(jobWorker!==worker)return;
    lifecycle("attachment-worker-shutdown-timeout", { runningAttachmentJobId });
    worker.kill();
  },3000);
  worker.once("exit",()=>clearTimeout(stopTimer));
});
app.on("will-quit",()=>lifecycle("will-quit", { runningAttachmentJobId }));
