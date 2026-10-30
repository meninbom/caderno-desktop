import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root=process.cwd(),require=createRequire(import.meta.url),{_electron:electron}=require('playwright');
const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'caderno-search-qa-'));
const env={...process.env,CADERNO_USER_DATA:path.join(artifacts,'profile')};
delete env.ELECTRON_RUN_AS_NODE;
let app,page;
const errors=[];
const invoke=(channel,input=null)=>page.evaluate(async({channel,input})=>{
  const response=await window.cadernoDesktop.invoke(channel,input);
  if(!response.ok)throw new Error(`${channel}: ${response.error}`);
  return response.data;
},{channel,input});
const until=async(check,label,timeout=6000)=>{
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,70))}
  throw new Error(`Timeout: ${label}`);
};
const query=async(text)=>{
  // Use actual keystrokes, preserving the focus assigned by the palette.
  await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');await page.keyboard.type(text,{delay:25});
  assert.equal(await page.locator('#command-query').inputValue(),text);
};
const result=id=>page.locator(`.command-result[data-note-id="${id}"]`);
try{
  app=await electron.launch({executablePath:process.env.CADERNO_QA_EXECUTABLE||require('electron'),args:process.env.CADERNO_QA_EXECUTABLE?[]:[root],env});
  page=await app.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,950));
  await page.getByRole('button',{name:'Pesquisar no Caderno',exact:true}).waitFor();
  const welcome=await invoke('notes:create',{title:'Bem-vindo ao Caderno',contentHtml:'<p>Bem-vindo! Este é seu primeiro passo.</p><p>Crie cadernos, etiquete tudo e favorite o que mais importa.</p>'});
  await page.getByRole('button',{name:'Pesquisar no Caderno',exact:true}).click();await page.locator('.command-palette').waitFor();
  await query('Crie cadern');await until(async()=>await result(welcome.id).count()>0,'Crie cadern encontra Crie cadernos',3000);
  await page.screenshot({path:path.join(artifacts,'prefix-light.png')});
  for(const suffix of ['o','s']){await page.keyboard.type(suffix);await until(async()=>await result(welcome.id).count()>0,`prefixo com ${suffix}`)}
  for(const text of ['Cri','CRIE CADERN','cadernos Cr','crie cadernos','crie ausentezzzz']){
    await query(text);
    if(text.includes('ausente'))await until(async()=>await page.locator('.command-results').innerText().then(t=>t.includes('Nenhum resultado.')),'AND não amplia resultados');
    else await until(async()=>await result(welcome.id).count()>0,`resultado para ${text}`);
  }
  await query('Crie cadern');await result(welcome.id).waitFor();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.title-input')?.value==='Bem-vindo ao Caderno');
  const listInput=page.getByRole('searchbox',{name:'Buscar notas',exact:true});
  await listInput.click();await page.keyboard.type('Crie cadern',{delay:25});
  await page.waitForTimeout(250);
  await until(async()=>await page.locator('.note-row').filter({hasText:'Bem-vindo ao Caderno'}).count()>0,'prefixo na lista de notas');
  assert.equal(await page.locator('.error-bar[role=alert]').count(),0);
  await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');

  const accented=await invoke('notes:create',{title:'Ação estratégica',contentHtml:'<p>Relatórios anuais.</p>'});
  assert.ok((await invoke('notes:search',{query:'ACAO estrat',limit:50})).some(note=>note.id===accented.id));
  assert.ok((await invoke('notes:find',{query:'ACAO estrat',limit:30})).some(note=>note.id===accented.id));
  const titleHit=await invoke('notes:create',{title:'Orquídeas do projeto',contentHtml:'<p>Contexto da reunião.</p>'});
  const bodyHit=await invoke('notes:create',{title:'Atualizado recentemente',contentHtml:'<p>Orquídeas do projeto e contexto da reunião.</p>'});
  await invoke('notes:pin',{id:bodyHit.id,value:true});
  assert.equal((await invoke('notes:search',{query:'orquid',limit:50}))[0].id,titleHit.id);
  assert.equal((await invoke('notes:list',{view:'all',query:'orquid',order:'title_asc'}))[0].id,bodyHit.id);

  const notebook=await invoke('notebooks:create',{name:'Caderno de teste'}),tag=await invoke('tags:create',{name:'Revisão'});
  await invoke('notes:move',{id:welcome.id,notebookId:notebook.id});await invoke('tags:attach',{noteId:welcome.id,tagId:tag.id});
  assert.deepEqual((await invoke('notes:search',{query:'Crie cadern notebook:"Caderno de teste" tag:Revisão type:note',limit:50})).map(n=>n.id),[welcome.id]);
  assert.ok((await invoke('notes:search',{query:'type:note',limit:50})).some(n=>n.id===welcome.id));
  assert.deepEqual(await invoke('notes:search',{query:'type:transcription',limit:50}),[]);
  assert.deepEqual(await invoke('notes:search',{query:'!!!',limit:50}),[]);
  assert.deepEqual(await invoke('notes:search',{query:'crie OR ausentezzzz',limit:50}),[]);

  const attachmentNote=await invoke('notes:create',{title:'Arquivos pesquisáveis',contentHtml:'<p>Crie cadernos com critérios de pesquisa.</p>'});
  const txt=await invoke('attachments:save',{noteId:attachmentNote.id,name:'pesquisa.txt',dataBase64:Buffer.from('Crie cadernos com critérios de pesquisa no anexo.').toString('base64')});
  const pdf=await invoke('attachments:save',{noteId:attachmentNote.id,name:'two-pages.pdf',dataBase64:fs.readFileSync(path.join(root,'tests/fixtures/media/two-pages.pdf')).toString('base64')});
  await until(async()=>{const jobs=await invoke('attachments:jobs');return [txt.id,pdf.id].every(id=>jobs.find(j=>j.attachmentId===id)?.status==='completed')},'extração e indexação reais TXT/PDF',18000);
  const txtHit=(await invoke('notes:search',{query:'type:attachment Crie cadern',limit:50})).find(n=>n.id===attachmentNote.id);
  assert.equal(txtHit.matchSource,'pesquisa.txt');assert.equal(txtHit.matchSourceKind,'attachment');assert.match(txtHit.matchSnippet,/cadernos/i);
  const pdfHit=(await invoke('notes:search',{query:'type:attachment Page O',limit:50})).find(n=>n.id===attachmentNote.id);
  assert.equal(pdfHit.matchSource,'two-pages.pdf');assert.match(pdfHit.matchSnippet,/Page One/);
  assert.ok((await invoke('notes:search',{query:'type:attachment',limit:50})).some(n=>n.id===attachmentNote.id));

  await invoke('notes:update',{id:welcome.id,contentHtml:'<p>Conteúdo modificado, indexação atualizada.</p>'});
  assert.ok(!(await invoke('notes:search',{query:'Crie cadern',limit:50})).some(n=>n.id===welcome.id));
  assert.ok((await invoke('notes:search',{query:'indexacao atualiz',limit:50})).some(n=>n.id===welcome.id));
  await invoke('notes:delete',{id:welcome.id});assert.ok(!(await invoke('notes:search',{query:'indexacao atualiz',limit:50})).some(n=>n.id===welcome.id));
  await invoke('notes:restore',{id:welcome.id});assert.ok((await invoke('notes:search',{query:'indexacao atualiz',limit:50})).some(n=>n.id===welcome.id));
  await invoke('notes:delete',{id:welcome.id});await invoke('notes:purge',{id:welcome.id});assert.ok(!(await invoke('notes:search',{query:'indexacao atualiz',limit:50})).some(n=>n.id===welcome.id));

  await page.keyboard.press('Control+k');await page.locator('.command-palette').waitFor();await query('type:attachment Page O');
  await result(attachmentNote.id).waitFor();await page.screenshot({path:path.join(artifacts,'pdf-search-light.png')});await page.keyboard.press('Escape');
  await invoke('theme:set',{value:'dark'});await page.reload();await page.getByRole('button',{name:'Pesquisar no Caderno',exact:true}).waitFor();
  await page.getByRole('button',{name:'Pesquisar no Caderno',exact:true}).click();await page.locator('.command-palette').waitFor();await query('ACAO estrat');await result(accented.id).waitFor();
  await page.screenshot({path:path.join(artifacts,'accent-search-dark.png')});await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,version:await app.evaluate(({app})=>app.getVersion()),checks:['example and incremental words via keystrokes','case/accents and AND literals','palette/list/note picker consistent','title relevance and explicit list order','filters without text','real TXT/PDF extraction and source snippets','edit/trash/restore/purge update index','light/dark and clean console'],artifacts}));
}catch(error){if(page)await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});console.error(error);console.error(`Artifacts: ${artifacts}`);process.exitCode=1;}
finally{await app?.close().catch(()=>{});}
