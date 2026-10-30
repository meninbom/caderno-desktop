import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../electron/repo/db";
import { NotesRepo, NotebooksRepo, NotebookStacksRepo, TagsRepo, CountsRepo, Meta, uuid,TasksRepo,EventsRepo,AttachmentJobsRepo,TranscriptionsRepo } from "../electron/repo/sqlite";
import { AttachmentsRepo, BackupRepo, inspectRaster } from "../electron/repo/attachments";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import type { ParsedEml } from "../electron/repo/eml";

function fresh(): {
  db: Database.Database;
  notes: NotesRepo;
  notebooks: NotebooksRepo;
  tags: TagsRepo;
  counts: CountsRepo;
  meta: Meta;
  attachments: AttachmentsRepo;
  backup: BackupRepo;
} {
  const db = openDatabase({ database: path.join(os.tmpdir(), `caderno-test-${uuid()}.sqlite`), attachments: os.tmpdir() });
  const notes = new NotesRepo(db);
  const notebooks = new NotebooksRepo(db);
  const tags = new TagsRepo(db);
  const counts = new CountsRepo(db);
  const meta = new Meta(db);
  const attachments = new AttachmentsRepo(db, os.tmpdir());
  const backup = new BackupRepo(db);
  return { db, notes, notebooks, tags, counts, meta, attachments, backup };
}

describe("Gestão de etiquetas", () => {
  it("renomeia a mesma etiqueta em todas as notas e evita duplicatas por caixa ou espaços", () => {
    const x = fresh();
    try {
      const first = x.notes.create({ title: "Uma nota", contentHtml: "<p>Conteúdo intacto</p>" });
      const second = x.notes.create({ title: "Outra nota", contentHtml: "<p>Outro conteúdo</p>" });
      const tag = x.tags.create("  Ação   comercial  ")!;
      expect(tag.name).toBe("Ação comercial");
      expect(x.tags.create("AÇÃO COMERCIAL")).toBeNull();
      x.tags.attach(first.id, tag.id); x.tags.attach(second.id, tag.id);
      expect(x.tags.rename(tag.id, "  Prioridade  ")).toMatchObject({ id: tag.id, name: "Prioridade", noteCount: 2 });
      expect(x.notes.get(first.id)?.tags).toEqual([{ id: tag.id, name: "Prioridade" }]);
      expect(x.notes.get(second.id)?.tags).toEqual([{ id: tag.id, name: "Prioridade" }]);
      expect(x.notes.get(first.id)?.contentHtml).toBe("<p>Conteúdo intacto</p>");
      const other = x.tags.create("Outra")!;
      expect(x.tags.rename(tag.id, " OUTRA ")).toBeNull();
      expect(x.tags.list().find(t => t.id === tag.id)?.name).toBe("Prioridade");
      expect(x.tags.list().find(t => t.id === other.id)?.name).toBe("Outra");
      expect(() => x.tags.rename(tag.id, " ")).toThrow(/entre 1 e 80/);
    } finally { x.db.close(); }
  });

  it("exclui apenas a etiqueta e seus vínculos, mantendo notas ativas e na lixeira", () => {
    const x = fresh();
    try {
      const first = x.notes.create({ title: "Manter ativa", contentHtml: "<p>Preservado</p>" });
      const second = x.notes.create({ title: "Manter na lixeira", contentHtml: "<p>Também preservado</p>" });
      const tag = x.tags.create("Excluir vínculo")!, keep = x.tags.create("Manter etiqueta")!;
      x.tags.attach(first.id, tag.id); x.tags.attach(second.id, tag.id); x.tags.attach(first.id, keep.id);
      x.notes.softDelete(second.id);
      expect(x.tags.list().find(t => t.id === tag.id)?.noteCount).toBe(1);
      expect(x.tags.remove(tag.id)).toBe(true);
      expect(x.tags.remove(tag.id)).toBe(false);
      expect(x.notes.get(first.id)?.tags).toEqual([{ id: keep.id, name: keep.name }]);
      expect(x.notes.get(second.id)?.tags).toEqual([]);
      expect(x.notes.get(second.id)?.contentHtml).toBe("<p>Também preservado</p>");
      expect(x.notes.get(second.id)?.deletedAt).not.toBeNull();
      expect(x.db.pragma("foreign_key_check")).toEqual([]);
    } finally { x.db.close(); }
  });
});

describe("NotesRepo", () => {
  let r: ReturnType<typeof fresh>;
  beforeAll(() => { r = fresh(); });

  it("cria, atualiza, lê e busca nota", () => {
    const note = r.notes.create({ title: "Lista de compras", contentHtml: "<p>comprar café e leite</p>" });
    const saved = r.notes.get(note.id);
    expect(saved?.title).toBe("Lista de compras");
    expect(saved?.contentHtml).toContain("café");
    expect(saved?.preview).toContain("comprar café");

    const upd = r.notes.update(note.id, { html: undefined } as never);
    void upd;
    r.notes.update(note.id, { title: "Lista do mercado" });
    const after = r.notes.get(note.id);
    expect(after?.title).toBe("Lista do mercado");

    const found = r.notes.list({ view: "all", query: "mercado" });
    expect(found).toHaveLength(1);
    expect(found[0].id).not.toBe("");
    const notFound = r.notes.list({ view: "all", query: "inexistente-xyz" });
    expect(notFound).toHaveLength(0);
  });

  it("mantém FTS5 consistente com edição, filtros, lixeira, restore e purge", () => {
    const nb = r.notebooks.create("Projetos pessoais")!;
    const tag = r.tags.create("ação rápida")!;
    const n = r.notes.create({ notebookId: nb.id, title: "Café da manhã", contentHtml: "<p>termo exclusivo no corpo</p>" });
    r.tags.attach(n.id, tag.id);
    expect(r.notes.list({ view: "all", query: 'termo notebook:"Projetos pessoais" tag:"ação rápida" type:note' }).map(x => x.id)).toContain(n.id);
    expect(r.notes.list({ view: "all", query: "CAFE" }).map(x => x.id)).toContain(n.id);
    r.notes.update(n.id, { contentHtml: "<p>texto atualizado</p>" });
    expect(r.notes.list({ view: "all", query: "termo" }).map(x => x.id)).not.toContain(n.id);
    expect(r.notes.list({ view: "all", query: "atualizado" }).map(x => x.id)).toContain(n.id);
    r.notes.softDelete(n.id);
    expect(r.notes.list({ view: "all", query: "atualizado" }).map(x => x.id)).not.toContain(n.id);
    r.notes.restore(n.id);
    expect(r.notes.list({ view: "all", query: "atualizado" }).map(x => x.id)).toContain(n.id);
    r.notes.purge(n.id);
    expect(r.notes.list({ view: "all", query: "atualizado" }).map(x => x.id)).not.toContain(n.id);
    expect(() => r.notes.list({ view: "all", query: "x' OR 1=1 --" })).not.toThrow();
  });

  it("busca incrementalmente por prefixos sem distinção de caixa ou acento e prioriza título", () => {
    const titleHit = r.notes.create({ title: "Crie cadernos agora", contentHtml: "<p>ajuda</p>" });
    const bodyHit = r.notes.create({ title: "Outra nota", contentHtml: "<p>crie cadernos nesta etapa</p>" });
    const unrelated = r.notes.create({ title: "Nota sem relação", contentHtml: "<p>apenas texto</p>" });
    expect(r.notes.list({ view: "all", query: "Crie cadern" }).map(note => note.id)).toEqual(expect.arrayContaining([titleHit.id, bodyHit.id]));
    expect(r.notes.list({ view: "all", query: "CRIE CADERN" }).map(note => note.id)).toEqual(expect.arrayContaining([titleHit.id, bodyHit.id]));
    const accented = r.notes.create({ title: "Café", contentHtml: "" });
    expect(r.notes.list({ view: "all", query: "cafe" }).map(note => note.id)).toContain(accented.id);
    expect(r.notes.search("Crie cadern", 10)[0]?.id).toBe(titleHit.id);
    expect(r.notes.find("Crie cadern", 10).map(note => note.id)).toContain(titleHit.id);
    expect(r.notes.search("Crie cadern", 10).map(note => note.id)).not.toContain(unrelated.id);
    expect(r.notes.list({ view: "all", query: "type:note" }).map(note => note.id)).toContain(titleHit.id);
    expect(r.notes.search("!!!", 10)).toEqual([]);
  });

  it("indexa anexos via jobs deduplicados e mantém retry, cancel, restart e FTS coerentes",()=>{
    const jobs=new AttachmentJobsRepo(r.db), note=r.notes.create({title:"Anexo"});
    const attachment=r.attachments.save(note.id,"fixture-etapa3.txt",Buffer.from("conteudo exclusivo cobalt attachment"));
    let queue=jobs.list().filter(x=>x.noteId===note.id);expect(queue).toHaveLength(1);expect(queue[0].status).toBe("queued");
    expect(jobs.next()?.id).toBe(queue[0].id);expect(jobs.next()).toBeUndefined();
    jobs.complete(queue[0].id,attachment.id,note.id,"fixture-etapa3.txt","conteudo exclusivo cobalt attachment");
    expect(r.notes.list({view:"all",query:"cobalt"}).find(x=>x.id===note.id)?.matchSource).toBe("fixture-etapa3.txt");
    expect(r.notes.list({view:"all",query:"type:attachment cobalt"}).map(x=>x.id)).toContain(note.id);
    expect(r.notes.list({view:"all",query:"type:attachment"}).map(x=>x.id)).toContain(note.id);
    expect(r.notes.list({view:"all",query:"type:attachment absenttoken"}).map(x=>x.id)).not.toContain(note.id);
    expect(jobs.retry(queue[0].id)).toBe(true);expect(jobs.list().find(x=>x.id===queue[0].id)?.status).toBe("queued");
    jobs.next();expect(jobs.cancel(queue[0].id)).toBe(true);expect(jobs.list().find(x=>x.id===queue[0].id)?.status).toBe("cancel_requested");
    jobs.recover();expect(jobs.list().find(x=>x.id===queue[0].id)?.status).toBe("queued");
    jobs.next();expect(jobs.list().find(x=>x.id===queue[0].id)?.attempts).toBe(3);
    r.attachments.remove(note.id,attachment.id);expect(jobs.list().some(x=>x.id===queue[0].id)).toBe(false);expect(r.notes.list({view:"all",query:"cobalt"}).map(x=>x.id)).not.toContain(note.id);
  });

  it("preserva origem e snippet de anexo quando a mesma busca também bate no corpo",()=>{
    const jobs=new AttachmentJobsRepo(r.db),note=r.notes.create({title:"Nota de concordância",contentHtml:"<p>termo cobalt exclusivo no corpo</p>"});
    const attachment=r.attachments.save(note.id,"origem-cobalt.txt",Buffer.from("termo cobalt exclusivo no documento"));
    const job=jobs.list().find(x=>x.attachmentId===attachment.id)!;
    jobs.complete(job.id,attachment.id,note.id,attachment.fileName,"termo cobalt exclusivo no documento");
    for(const result of [r.notes.list({view:"all",query:"termo cobalt exclusivo"}).find(x=>x.id===note.id),r.notes.search("termo cobalt exclusivo",10).find(x=>x.id===note.id)]) {
      expect(result?.matchSource).toBe("origem-cobalt.txt");
      expect(result?.matchSourceKind).toBe("attachment");
      expect(result?.matchSnippet).toContain("documento");
    }
  });

  it("mede FTS com 1000 notas e 20 anexos e registra p50/p95 com hardware local",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),`caderno-perf-${uuid()}-`)),db=openDatabase({database:path.join(root,"caderno.sqlite"),attachments:path.join(root,"attachments")});
    try {
      const notes=new NotesRepo(db),attachments=new AttachmentsRepo(db,path.join(root,"attachments")),jobs=new AttachmentJobsRepo(db),ids:string[]=[];
      const insert=db.transaction(()=>{for(let i=0;i<1000;i++)ids.push(notes.create({title:`Benchmark nota ${i}`,contentHtml:`<p>texto de corpus ${i}</p>`}).id);});insert();
      for(let i=0;i<20;i++){const a=attachments.save(ids[i],`benchmark-${i}.txt`,Buffer.from(`benchmarkterm attachment ${i} local index`));const j=jobs.list().find(x=>x.attachmentId===a.id)!;jobs.complete(j.id,a.id,ids[i],a.fileName,`benchmarkterm attachment ${i} local index`);}
      const samples:number[]=[];for(let i=0;i<40;i++){const start=performance.now();const results=notes.list({view:"all",query:"benchmarkterm"});samples.push(performance.now()-start);expect(results).toHaveLength(20);}
      samples.sort((a,b)=>a-b);const p=(q:number)=>samples[Math.ceil(q*samples.length)-1];const cpus=os.cpus();const report={timestamp:new Date().toISOString(),platform:`${process.platform} ${process.arch}`,node:process.version,cpu:cpus[0]?.model??"unknown",logicalCores:cpus.length,corpus:{notes:1000,attachments:20,queryIterations:samples.length,resultCount:20},queryMs:{p50:Number(p(.5).toFixed(3)),p95:Number(p(.95).toFixed(3)),min:Number(samples[0].toFixed(3)),max:Number(samples.at(-1)!.toFixed(3))},limits:"Repository/SQLite measurements in unit process; no keyboard or packaged-app latency claim."};
      const out=path.resolve("evidence/performance");fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,"search-1000.json"),JSON.stringify(report,null,2)+"\n");expect(report.queryMs.p95).toBeGreaterThanOrEqual(report.queryMs.p50);
    } finally {db.close();fs.rmSync(root,{recursive:true,force:true});}
  });

  it("favorita, fixa, move e em ordem", async () => {
    const a = r.notes.create({ title: "A", contentHtml: "<p>a</p>" });
    const b = r.notes.create({ title: "B", contentHtml: "<p>b</p>" });
    r.notes.setFlag(a.id, "favorited", true);
    r.notes.setFlag(b.id, "pinned", true);
    const favorites = r.notes.list({ view: "favorites" });
    expect(favorites.map(n => n.id)).toContain(a.id);

    const nb = r.notebooks.create("Pessoal");
    expect(nb).not.toBeNull();
    r.notes.move(a.id, nb!.id);
    const inNotebook = r.notes.list({ view: "notebook", notebookId: nb!.id });
    expect(inNotebook.map(n => n.id)).toContain(a.id);

    const ordered = r.notes.list({ view: "all", order: "title_asc" });
    const titles = ordered.map(n => n.title);
    const sorted = [...titles].sort((x, y) => x.localeCompare(y));
    expect(titles).toEqual(sorted);
  });

  it("lixeira: soft delete, restaura, apaga definitivo e esvazia", () => {
    const n = r.notes.create({ title: "Temp", contentHtml: "<p>x</p>" });
    r.notes.softDelete(n.id);
    expect(r.notes.get(n.id)?.deletedAt).not.toBeNull();
    expect(r.notes.list({ view: "all" }).find(x => x.id === n.id)).toBeUndefined();
    expect(r.notes.list({ view: "trash" }).map(x => x.id)).toContain(n.id);

    r.notes.restore(n.id);
    expect(r.notes.get(n.id)?.deletedAt).toBeNull();

    r.notes.softDelete(n.id);
    r.notes.purge(n.id);
    expect(r.notes.get(n.id)).toBeNull();
    expect(r.notes.list({ view: "trash" }).map(x => x.id)).not.toContain(n.id);
  });

  it("cadernos: cria, detecta duplicado, renomeia, exclui", () => {
    const first = r.notebooks.create("Trabalho");
    expect(first).not.toBeNull();
    const dup = r.notebooks.create("trabalho");
    expect(dup).toBeNull();
    const renamed = r.notebooks.rename(first!.id, "Escritório");
    expect(renamed?.name).toBe("Escritório");
    expect(r.notebooks.rename(999999, "X")).toBeNull();
    expect(r.notebooks.delete(first!.id)).toBe(true);
  });

  it("etiquetas: cria, anexa, desanexa e conta", () => {
    const n = r.notes.create({ title: "Tagged", contentHtml: "<p>conteúdo</p>" });
    const t = r.tags.create("ideias");
    expect(t).not.toBeNull();
    expect(r.tags.attach(n.id, t!.id)).toBe(true);
    const listed = r.tags.list();
    const found = listed.find(x => x.id === t!.id);
    expect(found?.noteCount).toBe(1);

    const tagNotes = r.notes.list({ view: "tag", tagId: t!.id });
    expect(tagNotes.map(x => x.id)).toContain(n.id);

    expect(r.tags.detach(n.id, t!.id)).toBe(true);
    expect(r.tags.list().find(x => x.id === t!.id)?.noteCount).toBe(0);
  });

  it("contagens da sidebar", () => {
    const counts = r.counts.get();
    expect(typeof counts.all).toBe("number");
    expect(counts.all).toBeGreaterThan(0);
    expect(typeof counts.trash).toBe("number");
  });

  it("tema persistido via meta", () => {
    expect(r.meta.get("theme")).toBeNull();
    r.meta.set("theme", "dark");
    expect(r.meta.get("theme")).toBe("dark");
  });
});

describe('Tarefas e calendário local',()=>{
 it('persiste tarefa, filtra prazo local com fronteiras do dia, reabre e entrega lembrete uma vez',()=>{
  const r=fresh(),tasks=new TasksRepo(r.db),note=r.notes.create({title:'Nota da tarefa'}),alternate=r.notes.create({title:'Nota alternativa'}),today=new Date();today.setHours(12,0,0,0);const due=today.getTime(),reminder=due-1000;
  const id=tasks.create({noteId:note.id,title:'Revisar',dueAt:due,reminderAt:reminder});expect(tasks.list('today').some(t=>t.id===id)).toBe(true);expect(tasks.deliverDue(reminder)).toHaveLength(1);expect(tasks.deliverDue(reminder+1)).toHaveLength(0);tasks.update({id,done:true,noteId:alternate.id});expect(tasks.list('completed').find(t=>t.id===id)?.noteId).toBe(alternate.id);tasks.update({id,done:false});expect(tasks.list('all').find(t=>t.id===id)?.done).toBe(false);expect(()=>tasks.update({id,noteId:uuid()})).toThrow(/Nota não encontrada/);r.db.close();
 });
 it('não agenda tarefa de nota na lixeira e purge aplica FK cascade',()=>{const r=fresh(),tasks=new TasksRepo(r.db),note=r.notes.create({title:'Lixeira'}),id=tasks.create({noteId:note.id,title:'Inativa',dueAt:null,reminderAt:10});r.notes.softDelete(note.id);expect(tasks.list('all').some(t=>t.id===id)).toBe(false);expect(tasks.deliverDue(20)).toHaveLength(0);expect(r.db.prepare('SELECT id FROM tasks WHERE id=?').get(id)).toBeTruthy();r.notes.purge(note.id);expect(r.db.prepare('SELECT id FROM tasks WHERE id=?').get(id)).toBeUndefined();r.db.close();});
 it('usa limites de dias civis locais corretamente na virada de DST',()=>{const prior=process.env.TZ;process.env.TZ='America/New_York';try{const r=fresh(),tasks=new TasksRepo(r.db),note=r.notes.create({title:'DST'}),noon=new Date(2026,2,8,12).getTime(),late=new Date(2026,2,8,23,30).getTime(),tomorrow=new Date(2026,2,9,0,0).getTime();expect(new Date(2026,2,9).getTime()-new Date(2026,2,8).getTime()).toBe(23*3600000);const a=tasks.create({noteId:note.id,title:'Hoje DST',dueAt:late,reminderAt:null}),b=tasks.create({noteId:note.id,title:'Amanhã DST',dueAt:tomorrow,reminderAt:null});expect(tasks.list('today',noon).map(t=>t.id)).toContain(a);expect(tasks.list('today',noon).map(t=>t.id)).not.toContain(b);expect(tasks.list('upcoming',noon).map(t=>t.id)).toContain(b);r.db.close();}finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}});
 it('valida eventos, mantém associação e define ciclo de vida de nota',()=>{
  const r=fresh(),events=new EventsRepo(r.db),note=r.notes.create({title:'Evento'}),now=Date.now();expect(()=>events.create({noteId:null,title:'Inválido',description:'',startAt:now+1,endAt:now,timeZone:'UTC',allDay:false})).toThrow(/fim/i);const id=events.create({noteId:note.id,title:'Reunião',description:'',startAt:now,endAt:now+3600000,timeZone:'America/Sao_Paulo',allDay:false});expect(events.list(now,now+100).find(e=>e.id===id)?.noteId).toBe(note.id);r.notes.softDelete(note.id);expect(events.list(now,now+100).find(e=>e.id===id)?.noteId).toBe(note.id);r.notes.purge(note.id);expect(events.list(now,now+100).find(e=>e.id===id)?.noteId).toBeNull();r.db.close();
 });
});

describe("AttachmentsRepo", () => {
  let r: ReturnType<typeof fresh>;
  beforeAll(() => { r = fresh(); });

  it("salva, lista e remove anexo em diretório dedicado", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-att-"));
    const db = r.db;
    const attachments = new AttachmentsRepo(db, dir);
    const note = r.notes.create({ title: "Com anexo", contentHtml: "<p>x</p>" });
    const data = Buffer.from("conteudo-do-arquivo");
    const saved = attachments.save(note.id, "anexo teste.txt", data);
    const list = attachments.list(note.id);
    expect(list).toHaveLength(1);
    expect(list[0].fileName).toBe("anexo teste.txt");
    expect(list[0].byteSize).toBe(data.length);
    const open = attachments.open(note.id, saved.id);
    expect(open?.fileName).toBe("anexo teste.txt");
    expect(fs.open).toBeDefined();
    expect(attachments.remove(note.id, saved.id)).toBe(true);
    expect(attachments.list(note.id)).toHaveLength(0);
  });

  it("serve somente assets registrados e rejeita traversal/symlink para fora da raiz", () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"caderno-media-root-")),outside=path.join(os.tmpdir(),`caderno-outside-${uuid()}.pdf`);
    const db=openDatabase({database:path.join(dir,"test.sqlite"),attachments:path.join(dir,"attachments")}),repo=new AttachmentsRepo(db,path.join(dir,"attachments"));
    const note=new NotesRepo(db).create({title:"Media"}),data=Buffer.from("%PDF-1.4 sample document");const saved=repo.save(note.id,"doc.pdf",data);
    expect(repo.media(saved.storedName)).toMatchObject({mime:"application/pdf",size:data.length});expect(repo.media(`..${path.sep}outside.pdf`)).toBeNull();expect(repo.media(`${uuid()}__outside.pdf`)).toBeNull();
    const stored=path.join(dir,"attachments",saved.storedName);fs.unlinkSync(stored);fs.writeFileSync(outside,data);
    try { fs.symlinkSync(outside,stored,"file");expect(repo.media(saved.storedName)).toBeNull(); }
    catch(error) { expect(["EPERM","EACCES","ENOTSUP"]).toContain((error as NodeJS.ErrnoException).code); }
    finally { db.close();fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(outside,{force:true}); }
  });
});

describe("BackupRepo", () => {
  let r: ReturnType<typeof fresh>;
  beforeAll(() => { r = fresh(); });

  it("faz backup e restaura preservando dados (roundtrip)", () => {
    const nb = r.notebooks.create("Backup NB");
    const stack = new NotebookStacksRepo(r.db).create("Backup stack");
    expect(stack).not.toBeNull();
    expect(r.notebooks.moveToStack(nb!.id, stack!.id)).toBe(true);
    const n = r.notes.create({ notebookId: nb!.id, title: "Nota backup", contentHtml: "<p>conteúdo</p>" });
    const t = r.tags.create("importante");
    r.tags.attach(n.id, t!.id);
    const dump = r.backup.dump();
    expect(dump.app).toBe("caderno");
    expect(dump.stacks?.some(s => s.id === stack!.id)).toBe(true);
    expect(dump.notebooks.find(x => x.id === nb!.id)?.stackId).toBe(stack!.id);

    const second = fresh();
    const restore = second.backup.restore(JSON.stringify(dump));
    expect(restore.ok).toBe(true);
    if (restore.ok) {
      expect(restore.notes).toBeGreaterThan(0);
      expect(restore.notebooks).toBeGreaterThan(0);
    }
    const restoredNote = second.notes.get(n.id);
    expect(restoredNote?.title).toBe("Nota backup");
    expect(restoredNote?.tags.some(tag => tag.name === "importante")).toBe(true);
    const restoredNotebook = second.notebooks.list().find(x => x.name === "Backup NB");
    expect(restoredNotebook?.stackId).toBe(stack!.id);
    expect(new NotebookStacksRepo(second.db).list().some(x => x.id === stack!.id)).toBe(true);
  });

  it("backup inválido não altera dados", () => {
    const second = fresh();
    const before = second.notes.list({ view: "all" }).length;
    const result = second.backup.restore(JSON.stringify({ app: "outro", notes: [] }));
    expect(result.ok).toBe(false);
    expect(second.notes.list({ view: "all" }).length).toBe(before);
  });

  it("inclui bytes de imagem, valida hash antes do restore e preserva notas em falha", () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"caderno-backup-assets-"));
    const sourceDir=path.join(root,"source"),destDir=path.join(root,"dest");fs.mkdirSync(sourceDir);fs.mkdirSync(destDir);
    const sourceDb=openDatabase({database:path.join(root,"source.sqlite"),attachments:sourceDir});
    const sourceNotes=new NotesRepo(sourceDb),sourceAssets=new AttachmentsRepo(sourceDb,sourceDir);
    const note=sourceNotes.create({title:"Imagem"});
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF3sAAAAASUVORK5CYII=","base64");
    const image=sourceAssets.saveImage(note.id,"pixel.png",png);
    sourceNotes.update(note.id,{contentHtml:`<img src="caderno-asset://${image.storedName}" data-asset-id="${image.storedName}" alt="pixel">`});
    const sourceTasks=new TasksRepo(sourceDb),sourceEvents=new EventsRepo(sourceDb),taskId=sourceTasks.create({noteId:note.id,title:'Backup task',dueAt:100,reminderAt:null}),eventId=sourceEvents.create({noteId:note.id,title:'Backup event',description:'',startAt:100,endAt:200,timeZone:'UTC',allDay:false});
    sourceNotes.recordClipSource(note.id,"https://example.test/article","Article");
    const backup=new BackupRepo(sourceDb,sourceDir).dump();expect(backup.schemaVersion).toBe(9);expect(backup.attachments).toHaveLength(1);expect(backup.clipperSources).toHaveLength(1);
    expect(backup.tasks).toHaveLength(1);expect(backup.events).toHaveLength(1);
    const targetDb=openDatabase({database:path.join(root,"dest.sqlite"),attachments:destDir}),targetBackup=new BackupRepo(targetDb,destDir);
    const corrupt=structuredClone(backup);corrupt.attachments![0].sha256="0".repeat(64);
    expect(targetBackup.restore(JSON.stringify(corrupt)).ok).toBe(false);
    expect(new NotesRepo(targetDb).get(note.id)).toBeNull();expect(fs.readdirSync(destDir)).toHaveLength(0);
    const restored=targetBackup.restore(JSON.stringify(backup));expect(restored.ok).toBe(true);
    const restoredAsset=new AttachmentsRepo(targetDb,destDir).image(image.storedName);
    expect(restoredAsset?.mime).toBe("image/png");expect(fs.readFileSync(restoredAsset!.filePath)).toEqual(png);
    expect(new NotesRepo(targetDb).get(note.id)?.contentHtml).toContain(image.storedName);
    expect(new NotesRepo(targetDb).findByClipSource("https://example.test/article")?.title).toBe("Imagem");
    expect(new TasksRepo(targetDb).list('all').find(t=>t.id===taskId)?.title).toBe('Backup task');expect(new EventsRepo(targetDb).list(100,200).find(e=>e.id===eventId)?.title).toBe('Backup event');
    sourceDb.close();targetDb.close();fs.rmSync(root,{recursive:true,force:true});
  });
});

describe("importação EML transacional",()=>{
  it("deduplica por chave e reverte nota/registro/assets quando o insert do anexo falha",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"caderno-eml-")),dir=path.join(root,"attachments");fs.mkdirSync(dir);
    const db=openDatabase({database:path.join(root,"db.sqlite"),attachments:dir}),repo=new AttachmentsRepo(db,dir),notes=new NotesRepo(db);
    const mail:ParsedEml={messageId:"<one@local>",subject:"Email",from:"a@b.test",to:"c@d.test",date:1,html:"<p>corpo</p>",text:"corpo",key:"mid:<one@local>",attachments:[]};
    const first=repo.importEml(null,mail);expect(first.duplicate).toBe(false);expect(notes.get(first.noteId!)?.title).toBe("Email");
    expect(repo.importEml(null,mail).duplicate).toBe(true);
    const restoreRoot=fs.mkdtempSync(path.join(os.tmpdir(),"caderno-eml-restore-")),restoreDir=path.join(restoreRoot,"attachments");fs.mkdirSync(restoreDir);
    const restoreDb=openDatabase({database:path.join(restoreRoot,"db.sqlite"),attachments:restoreDir}),backup=new BackupRepo(db,dir).dump();
    expect(backup.emlImports).toHaveLength(1);expect(new BackupRepo(restoreDb,restoreDir).restore(JSON.stringify(backup)).ok).toBe(true);
    expect(new AttachmentsRepo(restoreDb,restoreDir).importEml(null,mail).duplicate).toBe(true);restoreDb.close();fs.rmSync(restoreRoot,{recursive:true,force:true});
    const fail:ParsedEml={...mail,key:"mid:<fail@local>",attachments:[{fileName:"payload.bin",mimeType:"application/octet-stream",content:Buffer.from([1,2,3])}]};
    db.exec("CREATE TRIGGER fail_eml_attachment BEFORE INSERT ON attachments BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
    expect(()=>repo.importEml(null,fail)).toThrow(/fixture failure/);
    expect(db.prepare("SELECT count(*) AS c FROM notes").get()).toMatchObject({c:1});
    expect(db.prepare("SELECT count(*) AS c FROM eml_imports").get()).toMatchObject({c:1});
    expect(fs.readdirSync(dir)).toHaveLength(0);db.close();fs.rmSync(root,{recursive:true,force:true});
  });
});

describe("Raster asset validation",()=>{
  it("recognizes bounded VP8L and VP8 WebP dimensions and rejects active/unknown formats",()=>{
    const lossless=Buffer.alloc(30);lossless.write("RIFF",0);lossless.write("WEBP",8);lossless.write("VP8L",12);lossless[20]=0x2f;
    expect(inspectRaster(lossless)).toMatchObject({mime:"image/webp",width:1,height:1});
    const lossy=Buffer.alloc(30);lossy.write("RIFF",0);lossy.write("WEBP",8);lossy.write("VP8 ",12);lossy[23]=0x9d;lossy[24]=0x01;lossy[25]=0x2a;lossy.writeUInt16LE(640,26);lossy.writeUInt16LE(480,28);
    expect(inspectRaster(lossy)).toMatchObject({mime:"image/webp",width:640,height:480});
    expect(()=>inspectRaster(Buffer.from('<svg onload="alert(1)"/>'))).toThrow(/Imagem inválida/);
  });
});

describe("Pilhas de cadernos", () => {
  it("CRUD, movimento e exclusão preservam cadernos e notas", () => {
    const x = fresh();
    const notebook = x.notebooks.create("Com pilha");
    const note = x.notes.create({ notebookId: notebook!.id, title: "Nota preservada" });
    const stacks = new NotebookStacksRepo(x.db);
    const stack = stacks.create("Projetos");
    expect(stacks.create("projetos")).toBeNull();
    expect(x.notebooks.moveToStack(notebook!.id, stack!.id)).toBe(true);
    expect(stacks.list().find(s => s.id === stack!.id)?.noteCount).toBe(1);
    expect(stacks.rename(stack!.id, "Arquivo")?.name).toBe("Arquivo");
    expect(x.notebooks.moveToStack(notebook!.id, null)).toBe(true);
    expect(stacks.delete(stack!.id)).toBe(true);
    expect(x.notebooks.list().find(n => n.id === notebook!.id)?.name).toBe("Com pilha");
    expect(x.notes.get(note.id)?.title).toBe("Nota preservada");
    x.db.close();
  });
});

describe("Migração idempotente", () => {
  it('migração v4 com colisão restaura snapshot consistente e anexos',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'caderno-v4-rollback-')),file=path.join(root,'caderno.sqlite'),assets=path.join(root,'attachments');fs.mkdirSync(assets);fs.writeFileSync(path.join(assets,'keep.bin'),'keep');const db=new Database(file);db.pragma('journal_mode=WAL');db.exec(`CREATE TABLE migration_log(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);INSERT INTO migration_log VALUES(3,3);CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE notebooks(id INTEGER PRIMARY KEY,name TEXT,created_at INTEGER,updated_at INTEGER,stack_id TEXT,sort_order INTEGER);CREATE TABLE notes(id TEXT PRIMARY KEY,notebook_id INTEGER,title TEXT,content_html TEXT,content_text TEXT,favorited INTEGER,pinned INTEGER,deleted_at INTEGER,created_at INTEGER,updated_at INTEGER);CREATE TABLE tags(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE note_tags(note_id TEXT,tag_id INTEGER);CREATE TABLE attachments(id INTEGER PRIMARY KEY,note_id TEXT,file_name TEXT,stored_name TEXT,byte_size INTEGER,created_at INTEGER,mime_type TEXT,sha256 TEXT,kind TEXT);CREATE VIEW tasks AS SELECT 1 AS collision;INSERT INTO notes(id,title,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000055','Preservada',1,1);`);db.close();expect(()=>openDatabase({database:file,attachments:assets})).toThrow(/already exists/i);const restored=new Database(file);expect(restored.pragma('user_version')).toBeDefined();expect(restored.prepare('SELECT title FROM notes').get()).toEqual({title:'Preservada'});expect(restored.prepare("SELECT version FROM migration_log ORDER BY version DESC LIMIT 1").get()).toEqual({version:3});expect(restored.prepare("SELECT type FROM sqlite_master WHERE name='tasks'").get()).toEqual({type:'view'});restored.close();expect(fs.readFileSync(path.join(assets,'keep.bin'),'utf8')).toBe('keep');fs.rmSync(root,{recursive:true,force:true});});
  it("abre o mesmo banco duas vezes e reexecuta migrações sem duplicar", () => {
    const file = path.join(os.tmpdir(), `caderno-mig-${uuid()}.sqlite`);
    const db1 = openDatabase({ database: file, attachments: os.tmpdir() });
    db1.prepare("INSERT INTO notebooks (name, created_at, updated_at) VALUES ('Mig', 1, 1)").run();
    db1.close();
    const db2 = openDatabase({ database: file, attachments: os.tmpdir() });
    const names = (db2.prepare("SELECT name FROM notebooks").all() as unknown as { name: string }[]).map(x => x.name);
    expect(names).toContain("Mig");
    db2.close();
  });

  it("migra fixture v1 com transações em WAL e preserva IDs, anexos e snapshot", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-v1-fixture-"));
    const file = path.join(root, "caderno.sqlite");
    const attachmentsDir = path.join(root, "attachments"); fs.mkdirSync(attachmentsDir);
    fs.writeFileSync(path.join(attachmentsDir, "v1.txt"), "anexo v1 intacto");
    const source = new Database(file); source.pragma("journal_mode = WAL"); source.pragma("foreign_keys = ON");
    source.exec(`CREATE TABLE migration_log(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
      INSERT INTO migration_log VALUES(1,1);
      CREATE TABLE notebooks(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL COLLATE NOCASE UNIQUE,color TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE notes(id TEXT PRIMARY KEY,notebook_id INTEGER REFERENCES notebooks(id) ON DELETE SET NULL,title TEXT NOT NULL DEFAULT '',content_html TEXT NOT NULL DEFAULT '',content_text TEXT NOT NULL DEFAULT '',favorited INTEGER NOT NULL DEFAULT 0,pinned INTEGER NOT NULL DEFAULT 0,deleted_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE tags(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE COLLATE NOCASE);
      CREATE TABLE note_tags(note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(note_id,tag_id));
      CREATE TABLE attachments(id INTEGER PRIMARY KEY AUTOINCREMENT,note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,file_name TEXT NOT NULL,stored_name TEXT NOT NULL,byte_size INTEGER NOT NULL,created_at INTEGER NOT NULL);
      INSERT INTO notebooks(id,name,created_at,updated_at) VALUES(41,'Caderno v1',1,1);
      INSERT INTO notes(id,notebook_id,title,content_html,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000041',41,'Nota v1','<p>HTML legado</p>',1,1);
      INSERT INTO attachments(id,note_id,file_name,stored_name,byte_size,created_at) VALUES(41,'00000000-0000-4000-8000-000000000041','v1.txt','v1.txt',16,1);`);
    // Keep the source connection open so the committed rows are still represented in WAL.
    const migrated = openDatabase({ database: file, attachments: attachmentsDir });
    expect(migrated.prepare("SELECT id FROM notebooks WHERE id=41").get()).toBeTruthy();
    expect(migrated.prepare("SELECT id,content_html FROM notes WHERE id=?").get("00000000-0000-4000-8000-000000000041")).toEqual({ id: "00000000-0000-4000-8000-000000000041", content_html: "<p>HTML legado</p>" });
    expect(migrated.pragma("foreign_key_check")).toEqual([]);
    expect(fs.readFileSync(path.join(attachmentsDir, "v1.txt"), "utf8")).toBe("anexo v1 intacto");
    const snapshots = fs.readdirSync(root).filter(name => name.includes("pre-v2"));
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    migrated.close(); source.close();
  });

  it("restaura snapshot e anexos se a migração falhar", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-v1-rollback-"));
    const file = path.join(root, "caderno.sqlite"), attachmentsDir = path.join(root, "attachments");
    fs.mkdirSync(attachmentsDir); fs.writeFileSync(path.join(attachmentsDir, "original.bin"), "original");
    const db = new Database(file); db.pragma("journal_mode = WAL");
    db.exec(`CREATE TABLE migration_log(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL); INSERT INTO migration_log VALUES(1,1);
      CREATE TABLE notebooks(id INTEGER PRIMARY KEY,name TEXT,created_at INTEGER,updated_at INTEGER);
      INSERT INTO notebooks VALUES(77,'Rollback intacto',7,7);
      CREATE VIEW notebook_stacks AS SELECT 'collision' AS id;`);
    db.close();
    expect(() => openDatabase({ database: file, attachments: attachmentsDir })).toThrow(/already exists/i);
    const restored = new Database(file);
    expect(restored.prepare("SELECT id,name FROM notebooks WHERE id=77").get()).toEqual({ id: 77, name: "Rollback intacto" });
    expect(restored.prepare("SELECT type FROM sqlite_master WHERE name='notebook_stacks'").get()).toEqual({ type: "view" });
    expect(restored.prepare("SELECT MAX(version) AS version FROM migration_log").get()).toEqual({ version: 1 });
    restored.close();
    expect(fs.existsSync(`${file}-wal`)).toBe(false);
    expect(fs.existsSync(`${file}-shm`)).toBe(false);
    const reopened=new Database(file);
    expect(reopened.prepare("SELECT id,name FROM notebooks WHERE id=77").get()).toEqual({id:77,name:"Rollback intacto"});
    reopened.close();
    expect(fs.readFileSync(path.join(attachmentsDir, "original.bin"), "utf8")).toBe("original");
    expect(fs.readdirSync(root).some(name => name.includes("pre-v2"))).toBe(true);
  });
});

describe("Persistência após reinício", () => {
  it("nota sobrevive ao fechar e reabrir o banco (SQLite em disco)", () => {
    const file = path.join(os.tmpdir(), `caderno-restart-${uuid()}.sqlite`);
    let db = openDatabase({ database: file, attachments: os.tmpdir() });
    const nb = new NotebooksRepo(db).create("Persistente");
    const created = new NotesRepo(db).create({
      notebookId: nb!.id,
      title: "Sobrevive ao reinício",
      contentHtml: "<p>conteúdo durável</p>",
    });
    db.close();

    // Simula reiniciar o aplicativo: nova conexão, mesmo arquivo.
    db = openDatabase({ database: file, attachments: os.tmpdir() });
    const reloaded = new NotesRepo(db).get(created.id);
    expect(reloaded?.title).toBe("Sobrevive ao reinício");
    expect(reloaded?.notebookId).toBe(nb!.id);
    expect(reloaded?.contentHtml).toContain("durável");
    db.close();
  });
});

describe("Transcrições locais",()=>{
  it("persiste segmentos, indexa type:transcription e inclui metadados no backup",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"caderno-transcript-")),dir=path.join(root,"attachments"),db=openDatabase({database:path.join(root,"db.sqlite"),attachments:dir});
    const note=new NotesRepo(db).create({title:"Reunião de teste"}),attachment=new AttachmentsRepo(db,dir).save(note.id,"fala.wav",Buffer.from("fixture")),repo=new TranscriptionsRepo(db),job=repo.enqueue(note.id,attachment.id,"pt");
    const queued=repo.queued();expect(queued?.id).toBe(job);repo.complete(queued,{text:"bom dia transcrição local",language:"pt",durationMs:2200,segments:[{startMs:0,endMs:2200,text:"bom dia transcrição local"}]});
    expect(repo.get(note.id)[0].segments[0]).toMatchObject({startMs:0,endMs:2200});expect(new NotesRepo(db).list({view:"all",query:"type:transcription transcrição"})).toHaveLength(1);
    const payload=new BackupRepo(db,dir).dump();expect(payload.transcripts?.[0].text).toContain("transcrição local");expect(payload.transcripts?.[0].segments).toHaveLength(1);
    const targetRoot=path.join(root,"target"),targetDir=path.join(targetRoot,"attachments");fs.mkdirSync(targetRoot);const target=openDatabase({database:path.join(targetRoot,"db.sqlite"),attachments:targetDir});const restored=new BackupRepo(target,targetDir).restore(JSON.stringify(payload));expect(restored.ok).toBe(true);expect(new TranscriptionsRepo(target).get(note.id)[0].segments[0].text).toContain("transcrição local");expect(new NotesRepo(target).list({view:"all",query:"type:transcription bom dia"})).toHaveLength(1);
    target.close();expect(new AttachmentsRepo(db,dir).remove(note.id,attachment.id)).toBe(true);expect(repo.get(note.id)).toHaveLength(0);expect(new NotesRepo(db).list({view:"all",query:"type:transcription bom dia"})).toHaveLength(0);db.close();fs.rmSync(root,{recursive:true,force:true});
  });
  it("cancela fila e recupera uma tarefa ativa depois de reabrir o banco",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"caderno-transcription-restart-")),dir=path.join(root,"attachments"),file=path.join(root,"db.sqlite");let db=openDatabase({database:file,attachments:dir});const note=new NotesRepo(db).create({title:"Retomada"}),attachment=new AttachmentsRepo(db,dir).save(note.id,"retomada.wav",Buffer.from("fixture"));let repo=new TranscriptionsRepo(db),id=repo.enqueue(note.id,attachment.id,"auto");expect(repo.cancel(id)).toBe(true);expect(repo.list(note.id)[0].status).toBe("canceled");id=repo.enqueue(note.id,attachment.id,"pt");repo.progress(id,"transcribing",65,"Executando modelo");db.close();db=openDatabase({database:file,attachments:dir});repo=new TranscriptionsRepo(db);repo.recover();expect(repo.queued()?.id).toBe(id);expect(repo.list(note.id).find(j=>j.id===id)?.status).toBe("queued");repo.settle(id,"failed","CLI encerrou com código 1");expect(repo.list(note.id).find(j=>j.id===id)?.error).toMatch(/código 1/);db.close();fs.rmSync(root,{recursive:true,force:true});
  });
});
