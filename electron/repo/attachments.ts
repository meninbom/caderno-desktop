import crypto from "node:crypto";
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { extractVisibleText } from "./db";
import type { ParsedEml } from "./eml";
import { emlHtml } from "./eml";

export interface AttachmentRow {
  id: number;
  noteId: string;
  fileName: string;
  storedName: string;
  byteSize: number;
  createdAt: number;
  mimeType?: string;
  kind?: string;
}

const MEDIA_MIME: Record<string,string> = { ".pdf":"application/pdf", ".html":"text/html", ".htm":"text/html", ".webm":"video/webm", ".mp4":"video/mp4", ".ogv":"video/ogg", ".ogg":"video/ogg", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".audio.webm":"audio/webm", ".audio.ogg":"audio/ogg", ".audio.m4a":"audio/mp4" };
export function inspectMedia(data: Buffer, fileName: string): string {
  const lower=fileName.toLowerCase(), ext=Object.keys(MEDIA_MIME).sort((a,b)=>b.length-a.length).find(s=>lower.endsWith(s))??path.extname(fileName).toLowerCase(), mime=MEDIA_MIME[ext];
  if(!mime)return "application/octet-stream";
  if(data.length>50*1024*1024) throw new Error("Anexo excede 50 MB.");
  const head=data.subarray(0,Math.min(512,data.length));
  if(mime==="application/pdf"&&(!head.toString("latin1").includes("%PDF-")||data.length<16)) throw new Error("PDF inválido ou corrompido.");
  if(mime==="text/html"&&data.length===0) throw new Error("Arquivo HTML vazio.");
  if(mime.startsWith("audio/")&&!((mime==="audio/webm"&&head.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))||(mime==="audio/ogg"&&head.toString("ascii").includes("OggS"))||(mime==="audio/mp4"&&head.toString("ascii").includes("ftyp")))) throw new Error("Cabeçalho de áudio inválido.");
  if(mime.startsWith("video/")&&!((ext===".webm"&&head.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))||(ext===".mp4"&&head.toString("ascii").includes("ftyp"))||(ext===".ogv"||ext===".ogg")&&head.toString("ascii").includes("OggS"))) throw new Error("Cabeçalho de vídeo inválido; o arquivo não foi anexado.");
  return mime;
}

export function inspectRaster(data: Buffer): { mime: string; width: number; height: number } {
  let mime = ""; let width = 0; let height = 0;
  if (data.length >= 24 && data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    mime="image/png"; width=data.readUInt32BE(16); height=data.readUInt32BE(20);
  } else if (data.length >= 4 && data[0]===0xff && data[1]===0xd8) {
    mime="image/jpeg"; let p=2;
    while(p+9<data.length) { if(data[p++]!==0xff) continue; const marker=data[p++]; if(marker===0xd8||marker===0xd9) continue; const len=data.readUInt16BE(p); if(len<2||p+len>data.length) break; if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=data.readUInt16BE(p+3);width=data.readUInt16BE(p+5);break;} p+=len; }
  } else if (data.length >= 30 && data.toString("ascii",0,4)==="RIFF" && data.toString("ascii",8,12)==="WEBP") {
    mime="image/webp"; const type=data.toString("ascii",12,16);
    if(type==="VP8X"){width=1+data.readUIntLE(24,3);height=1+data.readUIntLE(27,3);}
    else if(type==="VP8L"&&data[20]===0x2f){width=1+(((data[22]&0x3f)<<8)|data[21]);height=1+(((data[24]&0x0f)<<10)|(data[23]<<2)|((data[22]&0xc0)>>6));}
    else if(type==="VP8 "&&data[23]===0x9d&&data[24]===0x01&&data[25]===0x2a){width=data.readUInt16LE(26)&0x3fff;height=data.readUInt16LE(28)&0x3fff;}
  }
  if (!mime || !width || !height || data.length>10*1024*1024 || width*height>40_000_000) throw new Error("Imagem inválida ou fora do limite (PNG/JPEG/WebP, 10 MB, 40 MP). SVG não é aceito.");
  return {mime,width,height};
}

export class AttachmentsRepo {
  constructor(private db: Database.Database, private attachmentsDir: string) {}

  importEml(notebookId: number | null, message: ParsedEml): { duplicate: boolean; attachmentCount: number; noteId?: string } {
    if (this.db.prepare("SELECT 1 FROM eml_imports WHERE message_key=?").get(message.key)) return { duplicate: true, attachmentCount: 0 };
    const files: { stage: string; dest: string; name: string; mime: string; bytes: Buffer; hash: string }[] = [];
    try {
      for (const a of message.attachments) {
        const stored = `${crypto.randomUUID()}__${a.fileName.toLowerCase().replace(/\s+/g, "-")}`;
        const dest = path.join(this.attachmentsDir, stored), stage = `${dest}.${crypto.randomUUID()}.stage`;
        fs.writeFileSync(stage, a.content, { flag: "wx" });
        files.push({ stage, dest, name: a.fileName, mime: a.mimeType, bytes: a.content, hash: crypto.createHash("sha256").update(a.content).digest("hex") });
      }
      for (const f of files) { fs.renameSync(f.stage, f.dest); f.stage = ""; }
      const noteId = crypto.randomUUID(), now = Date.now(), html = emlHtml(message);
      this.db.transaction(() => {
        this.db.prepare("INSERT INTO notes(id,notebook_id,title,content_html,content_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
          .run(noteId, notebookId, message.subject || "E-mail sem assunto", html, extractVisibleText(html), now, now);
        this.db.prepare("INSERT INTO eml_imports(message_key,note_id,imported_at) VALUES(?,?,?)").run(message.key,noteId,now);
        const insert = this.db.prepare("INSERT INTO attachments(note_id,file_name,stored_name,byte_size,created_at,mime_type,sha256,kind) VALUES(?,?,?,?,?,?,?,'file')");
        for (let i=0;i<files.length;i++) { const f=files[i]; insert.run(noteId,f.name,path.basename(f.dest),f.bytes.length,Date.now(),f.mime,f.hash); }
      })();
      return { duplicate: false, attachmentCount: files.length, noteId };
    } catch (error) {
      for (const f of files) { if (f.stage) fs.rmSync(f.stage,{force:true}); fs.rmSync(f.dest,{force:true}); }
      throw error;
    }
  }

  list(noteId: string): AttachmentRow[] {
    return this.db
      .prepare("SELECT id, note_id AS noteId, file_name AS fileName, stored_name AS storedName, byte_size AS byteSize, created_at AS createdAt,mime_type AS mimeType,kind FROM attachments WHERE note_id = ? ORDER BY created_at DESC")
      .all(noteId) as unknown as AttachmentRow[];
  }

  save(noteId: string, fileName: string, data: Buffer): AttachmentRow {
    const noteExists = this.db.prepare("SELECT 1 FROM notes WHERE id = ?").get(noteId);
    if (!noteExists) throw new Error("Nota inexistente para anexo");
    const mime=inspectMedia(data,fileName);
    if(mime.startsWith("image/")){const img=inspectRaster(data);if(img.mime!==mime)throw new Error("O conteúdo não corresponde à extensão da imagem.");}
    const safeName = fileName.replace(/[^a-zA-Z0-9. _\-()\[\]]/g, "_").slice(0, 160) || "anexo";
    const storedName = `${crypto.randomUUID()}__${safeName.toLowerCase().replace(/\s+/g,"-")}`;
    const target = path.join(this.attachmentsDir, storedName);
    fs.writeFileSync(target, data);
    const createdAt = Date.now();
    const result = this.db
      .prepare("INSERT INTO attachments (note_id,file_name,stored_name,byte_size,created_at,mime_type,sha256,kind) VALUES (?,?,?,?,?,?,?,'file')")
      .run(noteId,safeName,storedName,data.length,createdAt,mime,crypto.createHash("sha256").update(data).digest("hex"));
    return { id: Number(result.lastInsertRowid), noteId, fileName: safeName, storedName, byteSize: data.length, createdAt,mimeType:mime,kind:"file" };
  }

  media(storedName:string):{filePath:string;mime:string;size:number;sha256:string|null}|null {
    if(!/^[0-9a-f-]{36}(?:\.(?:png|jpg|webp)|__[a-zA-Z0-9. _()\[\]-]{1,160})$/i.test(storedName)||path.basename(storedName)!==storedName)return null;
    const row=this.db.prepare("SELECT stored_name,mime_type,kind,sha256,byte_size FROM attachments WHERE stored_name=?").get(storedName) as {stored_name:string;mime_type:string;kind:string;sha256:string|null;byte_size:number}|undefined;
    if(!row||path.basename(row.stored_name)!==row.stored_name||!(/^(image\/(png|jpeg|webp)|application\/pdf|text\/html|video\/(webm|mp4|ogg)|audio\/(webm|mp4|ogg))$/.test(row.mime_type)))return null;
    const root=fs.realpathSync(this.attachmentsDir),candidate=path.join(root,row.stored_name);if(!fs.existsSync(candidate))return null;
    const real=fs.realpathSync(candidate);if(path.dirname(real)!==root||!fs.statSync(real).isFile())return null;
    return {filePath:real,mime:row.mime_type,size:fs.statSync(real).size,sha256:row.sha256};
  }

  saveImage(noteId: string, fileName: string, data: Buffer): { id:number; mime:string; sha256:string; storedName:string } {
    const info=inspectRaster(data);
    if(!this.db.prepare("SELECT 1 FROM notes WHERE id=? AND deleted_at IS NULL").get(noteId)) throw new Error("Nota inexistente ou na lixeira");
    const safeName=fileName.replace(/[^a-zA-Z0-9. _\-()\[\]]/g,"_").slice(0,160)||"imagem";
    const storedName=`${crypto.randomUUID()}.${info.mime==="image/png"?"png":info.mime==="image/jpeg"?"jpg":"webp"}`;
    const target=path.join(this.attachmentsDir,storedName), temp=`${target}.tmp`;
    fs.writeFileSync(temp,data,{flag:"wx"}); fs.renameSync(temp,target);
    const hash=crypto.createHash("sha256").update(data).digest("hex");
    try { const result=this.db.prepare("INSERT INTO attachments(note_id,file_name,stored_name,byte_size,created_at,mime_type,sha256,kind) VALUES(?,?,?,?,?,?,?,'image')").run(noteId,safeName,storedName,data.length,Date.now(),info.mime,hash); return {id:Number(result.lastInsertRowid),mime:info.mime,sha256:hash,storedName}; }
    catch(error){fs.rmSync(target,{force:true});throw error;}
  }

  image(storedName: string): { filePath:string; mime:string } | null {
    if(!/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(storedName)) return null;
    const row=this.db.prepare("SELECT stored_name,mime_type,kind FROM attachments WHERE stored_name=?").get(storedName) as {stored_name:string;mime_type:string;kind:string}|undefined;
    if(!row||row.kind!=="image"||!/^image\/(png|jpeg|webp)$/.test(row.mime_type)||path.basename(row.stored_name)!==row.stored_name)return null;
    const filePath=path.join(this.attachmentsDir,row.stored_name);
    return fs.existsSync(filePath)?{filePath,mime:row.mime_type}:null;
  }

  remove(noteId: string, attachmentId: number): boolean {
    const row = this.db
      .prepare("SELECT stored_name,kind FROM attachments WHERE id = ? AND note_id = ?")
      .get(attachmentId, noteId) as { stored_name: string;kind:string } | undefined;
    if (!row) return false;
    if(row.kind==="image"&&this.db.prepare("SELECT 1 FROM notes WHERE content_html LIKE ? LIMIT 1").get(`%${row.stored_name}%`)) throw new Error("Esta imagem ainda é referenciada por uma nota. Remova a imagem do conteúdo primeiro; o arquivo é mantido para undo e lixeira.");
    const ok = this.db.prepare("DELETE FROM attachments WHERE id = ? AND note_id = ?").run(attachmentId, noteId).changes > 0;
    if (ok) {
      try {
        fs.unlinkSync(path.join(this.attachmentsDir, row.stored_name));
      } catch {
        /* arquivo já pode estar ausente */
      }
    }
    return ok;
  }

  open(noteId: string, attachmentId: number): { filePath: string; fileName: string } | null {
    const row = this.db
      .prepare("SELECT stored_name, file_name FROM attachments WHERE id = ? AND note_id = ?")
      .get(attachmentId, noteId) as { stored_name: string; file_name: string } | undefined;
    if (!row) return null;
    return { filePath: path.join(this.attachmentsDir, row.stored_name), fileName: row.file_name };
  }
}

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: number;
  notebooks: { id: number; name: string; stackId?: string | null }[];
  stacks?: { id: string; name: string; sortOrder: number; createdAt: number; updatedAt: number }[];
  notes: {
    id: string;
    notebookId: number | null;
    title: string;
    contentHtml: string;
    favorited: boolean;
    pinned: boolean;
    deletedAt: number | null;
    createdAt: number;
    updatedAt: number;
    tags: string[];
  }[];
  attachments?: { noteId:string; fileName:string; storedName:string; mimeType:string; kind:string; sha256:string; dataBase64:string }[];
  tasks?: {id:string;noteId:string;title:string;done:boolean;dueAt:number|null;reminderAt:number|null;reminderState:'pending'|'delivered';createdAt:number;updatedAt:number}[];
  events?: {id:string;noteId:string|null;title:string;description:string;startAt:number;endAt:number;timeZone:string;allDay:boolean;createdAt:number;updatedAt:number}[];
  emlImports?: {messageKey:string;noteId:string;importedAt:number}[];
  clipperSources?: {noteId:string;sourceUrl:string;sourceTitle:string;capturedAt:number}[];
  transcripts?: {id:string;attachmentId:number;attachmentStoredName?:string;noteId:string;model:string;language:string;durationMs:number;text:string;createdAt:number;segments:{startMs:number;endMs:number;text:string}[]}[];
}

export class BackupRepo {
  constructor(private db: Database.Database, private attachmentsDir?: string) {}

  dump(): BackupPayload {
    return this.db.transaction(() => this.dumpInTransaction())();
  }

  private dumpInTransaction(): BackupPayload {
    const attachmentDir=this.attachmentsDir;
    const assetRows=attachmentDir ? this.db.prepare("SELECT stored_name,kind,byte_size FROM attachments ORDER BY id").all() as {stored_name:string;kind:string;byte_size:number}[] : [];
    if(assetRows.some(f=>f.byte_size>(f.kind==="image"?10:50)*1024*1024)||assetRows.reduce((n,f)=>n+f.byte_size,0)>300*1024*1024) throw new Error("Backup excede limites: imagens até 10 MB, outros anexos até 50 MB e total até 300 MB.");
    const notebooks = this.db.prepare("SELECT id, name, stack_id AS stackId FROM notebooks").all() as unknown as { id: number; name: string; stackId: string | null }[];
    const stacks = this.db.prepare("SELECT id,name,sort_order AS sortOrder,created_at AS createdAt,updated_at AS updatedAt FROM notebook_stacks ORDER BY sort_order,name COLLATE NOCASE").all() as unknown as BackupPayload["stacks"];
    const noteRows = this.db.prepare("SELECT id, notebook_id, title, content_html, favorited, pinned, deleted_at, created_at, updated_at FROM notes").all() as unknown as {
      id: string;
      notebook_id: number | null;
      title: string;
      content_html: string;
      favorited: number;
      pinned: number;
      deleted_at: number | null;
      created_at: number;
      updated_at: number;
    }[];
    const tagRows = this.db
      .prepare("SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id")
      .all() as unknown as { note_id: string; name: string }[];
    const tagsByNote = new Map<string, string[]>();
    for (const r of tagRows) {
      const list = tagsByNote.get(r.note_id) ?? [];
      list.push(r.name);
      tagsByNote.set(r.note_id, list);
    }
    return {
      app: "caderno",
      schemaVersion: 6,
      exportedAt: Date.now(),
      notebooks,
      stacks,
      notes: noteRows.map(n => ({
        id: n.id,
        notebookId: n.notebook_id,
        title: n.title,
        contentHtml: n.content_html,
        favorited: n.favorited === 1,
        pinned: n.pinned === 1,
        deletedAt: n.deleted_at,
        createdAt: n.created_at,
        updatedAt: n.updated_at,
        tags: tagsByNote.get(n.id) ?? [],
      })),
      tasks:this.db.prepare("SELECT id,note_id AS noteId,title,is_done AS done,due_at AS dueAt,reminder_at AS reminderAt,reminder_state AS reminderState,created_at AS createdAt,updated_at AS updatedAt FROM tasks").all() as BackupPayload['tasks'],
      events:this.db.prepare("SELECT id,note_id AS noteId,title,description,start_at AS startAt,end_at AS endAt,time_zone AS timeZone,all_day AS allDay,created_at AS createdAt,updated_at AS updatedAt FROM calendar_events").all().map((x:any)=>({...x,allDay:!!x.allDay})) as BackupPayload['events'],
      emlImports:this.db.prepare("SELECT message_key AS messageKey,note_id AS noteId,imported_at AS importedAt FROM eml_imports ORDER BY imported_at").all() as BackupPayload['emlImports'],
      clipperSources:this.db.prepare("SELECT note_id AS noteId,source_url AS sourceUrl,source_title AS sourceTitle,captured_at AS capturedAt FROM clipper_sources ORDER BY captured_at").all() as BackupPayload['clipperSources'],
      transcripts:this.db.prepare("SELECT t.id,t.attachment_id AS attachmentId,a.stored_name AS attachmentStoredName,t.note_id AS noteId,t.model,t.language,t.duration_ms AS durationMs,t.text,t.created_at AS createdAt FROM transcripts t JOIN attachments a ON a.id=t.attachment_id ORDER BY t.created_at").all().map((t:any)=>({...t,segments:this.db.prepare("SELECT start_ms AS startMs,end_ms AS endMs,text FROM transcript_segments WHERE transcript_id=? ORDER BY start_ms").all(t.id)})) as BackupPayload['transcripts'],
      attachments: attachmentDir ? (this.db.prepare("SELECT note_id,file_name,stored_name,mime_type,kind,sha256 FROM attachments ORDER BY id").all() as {note_id:string;file_name:string;stored_name:string;mime_type:string;kind:string;sha256:string|null}[]).map(a=>{
        const bytes=fs.readFileSync(path.join(attachmentDir,a.stored_name));
        return {noteId:a.note_id,fileName:a.file_name,storedName:a.stored_name,mimeType:a.mime_type,kind:a.kind,sha256:a.sha256||crypto.createHash("sha256").update(bytes).digest("hex"),dataBase64:bytes.toString("base64")};
      }) : [],
    };
  }

  /** Valida e restaura backup dentro de uma transação: se qualquer item for inválido, nada muda. */
  restore(json: string): { ok: true; notes: number; notebooks: number; assets:number; legacy:boolean } | { ok: false; error: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: "JSON inválido: arquivo não pode ser lido como BackupPayload" };
    }
    const errors = this.validate(parsed);
    if (errors) return { ok: false, error: `Backup inválido: ${errors}` };
    const payload = parsed as BackupPayload;
    // Decode, hash and inspect every asset before touching SQLite or profile files.
    const validatedAssets=(payload.attachments??[]).map(a=>({a,data:Buffer.from(a.dataBase64,"base64")}));
    let totalAssetBytes=0;
    for(const {a,data} of validatedAssets){
      totalAssetBytes+=data.length;if(totalAssetBytes>300*1024*1024)return {ok:false,error:"Backup excede o limite total de assets de 300 MB"};
      if(!/^[0-9a-f-]{36}(?:\.(?:png|jpg|webp)|__[a-zA-Z0-9. _()\[\]-]{1,160})$/i.test(a.storedName)||path.basename(a.storedName)!==a.storedName) return {ok:false,error:"Backup inválido: nome interno de anexo inválido"};
      if(data.toString("base64")!==a.dataBase64||data.length>(a.kind==="image"?10:50)*1024*1024||crypto.createHash("sha256").update(data).digest("hex")!==a.sha256) return {ok:false,error:`Backup inválido: hash/bytes de ${a.fileName} não conferem`};
      if(a.kind==="image"){try{if(inspectRaster(data).mime!==a.mimeType)return {ok:false,error:`Backup inválido: MIME de ${a.fileName} não confere`};}catch(e){return {ok:false,error:String(e)}}}
      else if(a.mimeType!=="application/octet-stream"&&!/^[-\w.+]+\/[-\w.+]+$/.test(a.mimeType))return {ok:false,error:"Backup inválido: MIME de anexo"};
    }
    const newlyWritten:string[]=[];
    const stageFiles:string[]=[];
    if(this.attachmentsDir) for(const {a} of validatedAssets){const dest=path.join(this.attachmentsDir,a.storedName);if(fs.existsSync(dest)&&crypto.createHash("sha256").update(fs.readFileSync(dest)).digest("hex")!==a.sha256)return {ok:false,error:"Backup inválido: colisão de nome de anexo"};}
    const apply = this.db.transaction(() => {
      const notebookMap = new Map<number, number>();
      const stackMap = new Map<string, string>();
      for (const stack of payload.stacks ?? []) {
        const existing = this.db.prepare("SELECT id FROM notebook_stacks WHERE name=? COLLATE NOCASE").get(stack.name) as {id:string}|undefined;
        const id = existing?.id ?? stack.id;
        this.db.prepare("INSERT INTO notebook_stacks(id,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order,updated_at=excluded.updated_at").run(id,stack.name,stack.sortOrder,stack.createdAt,stack.updatedAt);
        stackMap.set(stack.id,id);
      }
      const getOrCreateNotebook = (name: string): number => {
        const found = this.db.prepare("SELECT id FROM notebooks WHERE name = ? COLLATE NOCASE").get(name) as { id: number } | undefined;
        if (found) return found.id;
        const now = Date.now();
        return Number(this.db.prepare("INSERT INTO notebooks (name, created_at, updated_at) VALUES (?, ?, ?)").run(name, now, now).lastInsertRowid);
      };
      for (const nb of payload.notebooks) {
        notebookMap.set(nb.id, getOrCreateNotebook(nb.name));
        if (nb.stackId && stackMap.has(nb.stackId)) this.db.prepare("UPDATE notebooks SET stack_id=? WHERE id=?").run(stackMap.get(nb.stackId), notebookMap.get(nb.id));
      }
      for (const note of payload.notes) {
        const notebookId = note.notebookId !== null ? (notebookMap.get(note.notebookId) ?? null) : null;
        this.db
          .prepare(
            `INSERT INTO notes (id, notebook_id, title, content_html, content_text, favorited, pinned, deleted_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET notebook_id = excluded.notebook_id, title = excluded.title,
               content_html = excluded.content_html, content_text = excluded.content_text,
               favorited = excluded.favorited, pinned = excluded.pinned, deleted_at = excluded.deleted_at,
               created_at = excluded.created_at, updated_at = excluded.updated_at`
          )
          .run(
            note.id,
            notebookId,
            note.title,
            note.contentHtml,
            extractVisibleText(note.contentHtml),
            note.favorited ? 1 : 0,
            note.pinned ? 1 : 0,
            note.deletedAt,
            note.createdAt,
            note.updatedAt
          );
        for (const tagName of note.tags) {
          let tag = this.db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE").get(tagName) as { id: number } | undefined;
          if (!tag) tag = { id: Number(this.db.prepare("INSERT INTO tags (name) VALUES (?)").run(tagName).lastInsertRowid) };
          this.db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)").run(note.id, tag.id);
        }
      }
      for(const task of payload.tasks??[]){if(!this.db.prepare('SELECT 1 FROM notes WHERE id=?').get(task.noteId))continue;this.db.prepare("INSERT INTO tasks(id,note_id,title,is_done,due_at,reminder_at,reminder_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET note_id=excluded.note_id,title=excluded.title,is_done=excluded.is_done,due_at=excluded.due_at,reminder_at=excluded.reminder_at,reminder_state=excluded.reminder_state,updated_at=excluded.updated_at").run(task.id,task.noteId,task.title,task.done?1:0,task.dueAt,task.reminderAt,task.reminderState,task.createdAt,task.updatedAt);}
      for(const event of payload.events??[]){const noteId=event.noteId&&this.db.prepare('SELECT 1 FROM notes WHERE id=?').get(event.noteId)?event.noteId:null;this.db.prepare("INSERT INTO calendar_events(id,note_id,title,description,start_at,end_at,time_zone,all_day,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET note_id=excluded.note_id,title=excluded.title,description=excluded.description,start_at=excluded.start_at,end_at=excluded.end_at,time_zone=excluded.time_zone,all_day=excluded.all_day,updated_at=excluded.updated_at").run(event.id,noteId,event.title,event.description,event.startAt,event.endAt,event.timeZone,event.allDay?1:0,event.createdAt,event.updatedAt);}
      for(const imported of payload.emlImports??[]){if(this.db.prepare("SELECT 1 FROM notes WHERE id=?").get(imported.noteId))this.db.prepare("INSERT OR REPLACE INTO eml_imports(message_key,note_id,imported_at) VALUES(?,?,?)").run(imported.messageKey,imported.noteId,imported.importedAt);}
      for(const clip of payload.clipperSources??[]){if(this.db.prepare("SELECT 1 FROM notes WHERE id=?").get(clip.noteId)&&/^https?:\/\//i.test(clip.sourceUrl))this.db.prepare("INSERT OR IGNORE INTO clipper_sources(source_key,note_id,source_url,source_title,captured_at) VALUES(?,?,?,?,?)").run(crypto.createHash("sha256").update(clip.sourceUrl).digest("hex"),clip.noteId,clip.sourceUrl,clip.sourceTitle,clip.capturedAt);}
      if(this.attachmentsDir) for(const {a} of validatedAssets) {
        if(!this.db.prepare("SELECT 1 FROM notes WHERE id=?").get(a.noteId)) continue;
        if(this.db.prepare("SELECT 1 FROM attachments WHERE stored_name=?").get(a.storedName)) continue;
        this.db.prepare("INSERT INTO attachments(note_id,file_name,stored_name,byte_size,created_at,mime_type,sha256,kind) VALUES(?,?,?,?,?,?,?,?)").run(a.noteId,a.fileName,a.storedName,Buffer.byteLength(a.dataBase64,"base64"),Date.now(),a.mimeType,a.sha256,a.kind);
      }
      for(const t of payload.transcripts??[]){if(!this.db.prepare("SELECT 1 FROM notes WHERE id=?").get(t.noteId))continue;const attachment=t.attachmentStoredName?this.db.prepare("SELECT id FROM attachments WHERE stored_name=? AND note_id=?").get(t.attachmentStoredName,t.noteId) as {id:number}|undefined:this.db.prepare("SELECT id FROM attachments WHERE id=? AND note_id=?").get(t.attachmentId,t.noteId) as {id:number}|undefined;if(!attachment)continue;const existing=this.db.prepare("SELECT id FROM transcripts WHERE attachment_id=?").get(attachment.id) as {id:string}|undefined;const transcriptId=existing?.id??t.id;this.db.prepare("INSERT INTO transcripts(id,attachment_id,note_id,model,language,duration_ms,text,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(attachment_id) DO UPDATE SET note_id=excluded.note_id,model=excluded.model,language=excluded.language,duration_ms=excluded.duration_ms,text=excluded.text,created_at=excluded.created_at").run(transcriptId,attachment.id,t.noteId,t.model,t.language,t.durationMs,t.text,t.createdAt);this.db.prepare("DELETE FROM transcript_segments WHERE transcript_id=?").run(transcriptId);const add=this.db.prepare("INSERT INTO transcript_segments(transcript_id,start_ms,end_ms,text) VALUES(?,?,?,?)");for(const s of t.segments)add.run(transcriptId,s.startMs,s.endMs,s.text);this.db.prepare("INSERT INTO attachment_text(attachment_id,note_id,source_name,source_kind,content,extractor_version,indexed_at) VALUES(?,?,?,'transcription',?,1,?) ON CONFLICT(attachment_id) DO UPDATE SET note_id=excluded.note_id,source_name=excluded.source_name,source_kind='transcription',content=excluded.content,extractor_version=1,indexed_at=excluded.indexed_at").run(attachment.id,t.noteId,"Transcrição local",t.text,t.createdAt);}
    });
    try {
      if(this.attachmentsDir){
        fs.mkdirSync(this.attachmentsDir,{recursive:true});
        for(const {a,data} of validatedAssets){
          const dest=path.join(this.attachmentsDir,a.storedName);
          if(fs.existsSync(dest)) continue;
          const stage=`${dest}.${crypto.randomUUID()}.stage`;stageFiles.push(stage);
          fs.writeFileSync(stage,data,{flag:"wx"});fs.renameSync(stage,dest);
          stageFiles.pop();newlyWritten.push(dest);
        }
      }
      apply();
    } catch(error) { for(const f of stageFiles) fs.rmSync(f,{force:true});for(const f of newlyWritten) fs.rmSync(f,{force:true});return {ok:false,error:`Restauração cancelada sem alterar o perfil: ${String(error)}`}; }
    const notebooks = this.db.prepare("SELECT COUNT(*) AS c FROM notebooks").get() as { c: number };
    const notes = this.db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
    return { ok: true, notebooks: notebooks.c, notes: notes.c, assets:validatedAssets.length, legacy:payload.schemaVersion<3 };
  }

  private validate(value: unknown): string | null {
    if (typeof value !== "object" || value === null) return "payload não é um objeto";
    const p = value as Partial<BackupPayload>;
    if (p.app !== "caderno") return "campo app deve ser \"caderno\"";
    if (typeof p.schemaVersion !== "number") return "schemaVersion ausente";
    if (!Array.isArray(p.notes)) return "notes ausente";
    if (!Array.isArray(p.notebooks)) return "notebooks ausente";
    if ((p as BackupPayload).schemaVersion >= 3 && !Array.isArray((p as BackupPayload).attachments)) return "assets ausentes no backup versão 3";
    if ((p as BackupPayload).schemaVersion >= 4 && (!Array.isArray((p as BackupPayload).tasks)||!Array.isArray((p as BackupPayload).events))) return "tarefas/eventos ausentes no backup versão 4";
    if ((p as BackupPayload).schemaVersion >= 6 && !Array.isArray((p as BackupPayload).transcripts)) return "transcrições ausentes no backup versão 6";
    const transcriptRows=(p as BackupPayload).transcripts;if(transcriptRows!==undefined&&(!Array.isArray(transcriptRows)||transcriptRows.some(t=>!t||typeof t.id!=="string"||typeof t.text!=="string"||!Array.isArray(t.segments))))return "transcrição inválida";
    if ((p as BackupPayload).emlImports !== undefined && !Array.isArray((p as BackupPayload).emlImports)) return "lista de importações EML inválida";
    if ((p as BackupPayload).clipperSources !== undefined && (!Array.isArray((p as BackupPayload).clipperSources) || (p as BackupPayload).clipperSources!.some(c=>!c||typeof c.noteId!=="string"||typeof c.sourceUrl!=="string"||typeof c.sourceTitle!=="string"||typeof c.capturedAt!=="number"))) return "lista de fontes do Clipper inválida";
    if (Array.isArray((p as BackupPayload).attachments) && (p as BackupPayload).attachments!.length > 10000) return "muitos anexos";
    for (const n of p.notes) {
      if (typeof n !== "object" || n === null) return "nota inválida";
      const note = n as { id?: unknown; title?: unknown; contentHtml?: unknown };
      if (typeof note.id !== "string" || note.id.length === 0) return "nota com id inválido";
      if (typeof note.title !== "string") return "nota com title inválido";
      if (typeof note.contentHtml !== "string") return "nota com contentHtml inválido";
    }
    for (const nb of p.notebooks) {
      if (typeof nb !== "object" || nb === null) return "caderno inválido";
      if (typeof (nb as { name?: unknown }).name !== "string") return "caderno com name inválido";
    }
    for(const a of (p as BackupPayload).attachments??[]){if(!a||typeof a.noteId!=="string"||typeof a.dataBase64!=="string"||typeof a.sha256!=="string"||typeof a.storedName!=="string"||typeof a.mimeType!=="string"||typeof a.kind!=="string")return "anexo inválido";}
    return null;
  }
}
