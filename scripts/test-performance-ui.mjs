import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=process.cwd(),runDir=fs.mkdtempSync(path.join(os.tmpdir(),'caderno-performance-qa-'));
const env={...process.env,CADERNO_USER_DATA:path.join(runDir,'profile'),CADERNO_QA_IPC:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;const errors=[];
const invoke=(channel,input=null)=>page.evaluate(async({channel,input})=>{const r=await window.cadernoDesktop.invoke(channel,input);if(!r.ok)throw new Error(r.error);return r.data;},{channel,input});
try{
  app=await electron.launch({executablePath:require('electron'),args:[root],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.locator('.sidebar').waitFor();
  await page.evaluate(async()=>{const call=async(channel,input)=>{const r=await window.cadernoDesktop.invoke(channel,input);if(!r.ok)throw new Error(r.error);return r.data;};const nb=await call('notebooks:create',{name:'Coleção extensa'});for(let i=0;i<600;i++)await call('notes:create',{notebookId:nb.id,title:`Nota ${String(i).padStart(4,'0')}`,contentHtml:`<p>Conteúdo da nota ${i} para verificar janelas de altura variável.</p>`});});
  await page.reload();await page.waitForFunction(()=>document.querySelector('.notelist-header .count')?.textContent.trim()==='600');
  await page.waitForFunction(()=>document.querySelectorAll('.tree-note').length===60);
  assert.ok(await page.locator('.note-row').count()<40,'large lists render only the visible window');
  await page.getByRole('button',{name:'Mostrar mais notas em Coleção extensa',exact:true}).click();assert.equal(await page.locator('.tree-note').count(),120);
  const all=await invoke('notes:list',{view:'all'}),last=all[all.length-1];
  await page.locator('.notes-scroll').evaluate(e=>{e.scrollTop=e.scrollHeight;});
  const lastRow=page.locator(`.note-row[data-note-id="${last.id}"]`);await lastRow.waitFor();await lastRow.click();await page.locator('.title-input').waitFor();assert.equal(await page.locator('.title-input').inputValue(),last.title);
  const search=page.getByRole('searchbox',{name:'Buscar notas',exact:true});await search.fill('Nota 0599');await page.waitForFunction(()=>document.querySelectorAll('.note-row').length===1);assert.match(await page.locator('.note-row').innerText(),/Nota 0599/);
  await search.fill('Nota 0000');await search.fill('Nota 0342');await page.waitForFunction(()=>document.querySelector('.note-row')?.textContent.includes('Nota 0342'));assert.equal(await page.locator('.note-row').count(),1);
  await page.waitForTimeout(300);const before=await invoke('app:qa-ipc-counts');await page.waitForTimeout(2700);const after=await invoke('app:qa-ipc-counts');assert.equal(after['attachments:jobs']??0,before['attachments:jobs']??0,'no indexing polling while idle');
  await invoke('attachments:save',{noteId:last.id,name:'perf-queue.txt',dataBase64:Buffer.from('PERFORMANCE EVENT WAKEUP').toString('base64')});
  await page.waitForFunction(async count=>{const r=await window.cadernoDesktop.invoke('app:qa-ipc-counts',null);return r.ok&&(r.data['attachments:jobs']??0)>count;},after['attachments:jobs']??0);
  let job;for(let i=0;i<80;i++){job=(await invoke('attachments:jobs')).find(j=>j.fileName==='perf-queue.txt');if(job?.status==='completed')break;await page.waitForTimeout(100);}assert.equal(job?.status,'completed','indexing queue wakes on actual writes');
  await page.keyboard.press('Control+k');await page.getByRole('dialog',{name:'Pesquisar no Caderno',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.command-result[data-note-id]').length===8);await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(runDir,'large-list.png')});await app.close();app=null;console.log(JSON.stringify({ok:true,notes:600,checks:['windowed rows','progressive sidebar','last row reachable','rapid search correctness','zero idle polling','event-driven indexing','bounded recent notes','no renderer errors'],artifacts:runDir}));
}catch(error){console.error(error);await page?.screenshot({path:path.join(runDir,'failure.png')}).catch(()=>{});console.error('Artifacts:',runDir);await app?.close().catch(()=>{});process.exitCode=1;}
