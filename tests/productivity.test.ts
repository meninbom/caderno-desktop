import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDatabase } from '../electron/repo/db';
import { NotesRepo, TasksRepo } from '../electron/repo/sqlite';
import { PdfAnnotationsRepo } from '../electron/repo/pdf-annotations';
import { AttachmentsRepo, BackupRepo } from '../electron/repo/attachments';
import { nextOccurrence } from '../shared/recurrence';
import { localDateTimeInZone, zonedLocalToEpoch } from '../shared/zoned-time';

const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup()});
function fresh(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'caderno-productivity-')),assets=path.join(root,'assets'),db=openDatabase({database:path.join(root,'data.sqlite'),attachments:assets});cleanups.push(()=>{db.close();fs.rmSync(root,{recursive:true,force:true})});return{root,assets,db,notes:new NotesRepo(db),tasks:new TasksRepo(db),pdf:new PdfAnnotationsRepo(db),backup:new BackupRepo(db,assets)}}

describe('busca geral e referências',()=>{
  it('encontra conteúdo distante do título e ignora notas excluídas',()=>{
    const r=fresh(),note=r.notes.create({title:'Reunião',contentHtml:`<p>${'Introdução '.repeat(100)}cancelamentoexclusivo e decisão.</p>`});
    expect(r.notes.search('cancelamentoexclusivo',50)).toMatchObject([{id:note.id,matchSnippet:expect.stringContaining('cancelamentoexclusivo')}]);
    r.notes.softDelete(note.id);expect(r.notes.search('cancelamentoexclusivo',50)).toEqual([]);
  });
  it('usa links reais por UUID e acompanha renomeação, lixeira e restauração',()=>{
    const r=fresh(),target=r.notes.create({title:'Destino'}),source=r.notes.create({title:'Origem',contentHtml:`<a href="caderno-note://${target.id}">Ver destino</a>`});
    r.notes.create({title:'Menção sem link',contentHtml:`<p>caderno-note://${target.id}</p>`});
    expect(r.notes.backlinks(target.id)).toMatchObject([{id:source.id,title:'Origem'}]);
    r.notes.update(source.id,{title:'Renomeada'});expect(r.notes.backlinks(target.id)[0].title).toBe('Renomeada');
    r.notes.softDelete(source.id);expect(r.notes.backlinks(target.id)).toEqual([]);r.notes.restore(source.id);expect(r.notes.backlinks(target.id)).toHaveLength(1);
  });
});
describe('tarefas recorrentes',()=>{
  it('mantém o dia mensal original, pula atrasos e conserva o horário local no DST',()=>{
    const jan=zonedLocalToEpoch('2028-01-31T09:00','America/Sao_Paulo');
    const feb=nextOccurrence('monthly','2028-01-31T09:00',jan,jan,'America/Sao_Paulo');
    expect(localDateTimeInZone(feb,'America/Sao_Paulo')).toBe('2028-02-29T09:00');
    expect(localDateTimeInZone(nextOccurrence('monthly','2028-01-31T09:00',feb,feb,'America/Sao_Paulo'),'America/Sao_Paulo')).toBe('2028-03-31T09:00');
    const friday=zonedLocalToEpoch('2028-03-10T09:00','America/New_York'),late=zonedLocalToEpoch('2028-03-13T10:00','America/New_York');
    expect(localDateTimeInZone(nextOccurrence('daily','2028-03-10T09:00',friday,late,'America/New_York'),'America/New_York')).toBe('2028-03-14T09:00');
    const beforeGap=zonedLocalToEpoch('2028-03-11T02:30','America/New_York');
    expect(localDateTimeInZone(nextOccurrence('daily','2028-03-11T02:30',beforeGap,beforeGap,'America/New_York'),'America/New_York')).toBe('2028-03-12T03:00');
  });
  it('conclui atomicamente, preserva lembrete/prioridade e nunca duplica ao reabrir',()=>{
    const r=fresh(),note=r.notes.create({title:'Contexto'}),due=zonedLocalToEpoch('2028-01-31T09:00','America/Sao_Paulo');
    const id=r.tasks.create({noteId:note.id,title:'Revisar',dueAt:due,reminderAt:due-3600000,recurrence:'monthly',priority:'high',timeZone:'America/Sao_Paulo'});
    r.tasks.update({id,done:true},due);let rows=r.tasks.list('all');expect(rows).toHaveLength(2);
    const next=rows.find(t=>t.id!==id)!;expect(next).toMatchObject({done:false,recurrence:'monthly',priority:'high',reminderAt:next.dueAt!-3600000});
    r.tasks.update({id,done:false},due);r.tasks.update({id,done:true},due);expect(r.tasks.list('all')).toHaveLength(2);
    r.tasks.delete(next.id);r.tasks.update({id,done:false},due);r.tasks.update({id,done:true},due);expect(r.tasks.list('all')).toHaveLength(1);
    expect(()=>r.tasks.create({noteId:note.id,title:'Sem prazo',dueAt:null,reminderAt:null,recurrence:'daily'})).toThrow(/prazo/);
    expect(r.tasks.list('all',due,'low')).toHaveLength(0);
  });
  it('reverte a conclusão se a gravação da próxima ocorrência falhar',()=>{
    const r=fresh(),note=r.notes.create({title:'Contexto'}),due=Date.UTC(2028,0,1);
    const id=r.tasks.create({noteId:note.id,title:'Transação',dueAt:due,reminderAt:null,recurrence:'daily',timeZone:'UTC'});
    r.db.exec("CREATE TRIGGER fail_occurrence BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'falha simulada'); END;");
    expect(()=>r.tasks.update({id,done:true},due)).toThrow(/falha simulada/);
    expect(r.tasks.list('all')).toMatchObject([{id,done:false}]);
    r.db.exec('DROP TRIGGER fail_occurrence');r.tasks.update({id,done:true},due);expect(r.tasks.list('all')).toHaveLength(2);
  });
});
describe('migração de dados existentes',()=>{
  it('preserva notas e prazos da versão 10 e cria um snapshot antes de ampliar o banco',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'caderno-v10-')),assets=path.join(root,'assets'),database=path.join(root,'data.sqlite');
    let db=openDatabase({database,attachments:assets});
    try{
      const note=new NotesRepo(db).create({title:'Nota antiga',contentHtml:'<p>Não alterar.</p>'}),due=Date.UTC(2028,0,1);
      const task=new TasksRepo(db).create({noteId:note.id,title:'Prazo antigo',dueAt:due,reminderAt:due-1000});
      db.exec('DROP TABLE pdf_annotations; DROP INDEX idx_task_occurrence_parent;');
      for(const column of ['recurrence','priority','time_zone','recurrence_anchor','recurrence_spawned','recurrence_parent_id'])db.exec(`ALTER TABLE tasks DROP COLUMN ${column}`);
      db.exec('DROP TABLE note_template_assets; DROP TABLE note_templates;');db.prepare('DELETE FROM migration_log WHERE version>=11').run();db.close();
      db=openDatabase({database,attachments:assets});
      expect(new NotesRepo(db).get(note.id)).toMatchObject({title:'Nota antiga',contentHtml:'<p>Não alterar.</p>'});
      expect(new TasksRepo(db).list('all')).toMatchObject([{id:task,dueAt:due,reminderAt:due-1000,recurrence:'none',priority:'normal',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}]);
      expect(fs.readdirSync(root).some(file=>file.includes('.pre-v11-')&&file.endsWith('.sqlite'))).toBe(true);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    }finally{db.close();fs.rmSync(root,{recursive:true,force:true})}
  });
});
describe('marcações de PDF e backup',()=>{
  it('restaura marcações e cadeia recorrente sem alterar os bytes do PDF ou duplicar a ocorrência',()=>{
    const r=fresh(),note=r.notes.create({title:'PDF anotado'}),bytes=fs.readFileSync(path.resolve('tests/fixtures/media/two-pages.pdf'));
    const attachment=new AttachmentsRepo(r.db,r.assets).save(note.id,'original.pdf',bytes);
    const annotation=r.pdf.save({storedName:attachment.storedName,page:2,kind:'highlight',rect:{x:.1,y:.2,width:.4,height:.05},comment:'Revisar cláusula'});
    const due=Date.UTC(2028,0,1),task=r.tasks.create({noteId:note.id,title:'Revisão',dueAt:due,reminderAt:null,recurrence:'weekly',timeZone:'UTC'});r.tasks.update({id:task,done:true},due);
    const backup=r.backup.dump(),target=fresh();expect(target.backup.restore(JSON.stringify(backup)).ok).toBe(true);
    expect(target.pdf.list(attachment.storedName,2)).toMatchObject([{id:annotation,comment:'Revisar cláusula',rect:{x:.1,y:.2,width:.4,height:.05}}]);
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(target.assets,attachment.storedName))).digest('hex')).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    target.tasks.update({id:task,done:false},due);target.tasks.update({id:task,done:true},due);expect(target.tasks.list('all')).toHaveLength(2);
    const corrupt=structuredClone(backup);corrupt.pdfAnnotations![0].rect.width=2;expect(target.backup.restore(JSON.stringify(corrupt)).ok).toBe(false);expect(target.pdf.list(attachment.storedName,2)).toHaveLength(1);
    expect(()=>target.pdf.save({storedName:attachment.storedName,page:2,kind:'comment',rect:{x:.1,y:.1,width:.02,height:.02},comment:''})).toThrow();
    target.pdf.delete(annotation);expect(target.pdf.list(attachment.storedName,2)).toEqual([]);
  });
});
