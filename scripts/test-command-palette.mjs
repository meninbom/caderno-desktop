import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const root=process.cwd(),require=createRequire(import.meta.url);
const {_electron:electron}=require('playwright');
const artifacts=fs.mkdtempSync(path.join(os.tmpdir(),'caderno-palette-regression-'));
const env={...process.env,CADERNO_USER_DATA:path.join(artifacts,'profile')};
delete env.ELECTRON_RUN_AS_NODE;
let app,page;
const errors=[];
const invoke=(channel,input=null)=>page.evaluate(async({channel,input})=>{
  const response=await window.cadernoDesktop.invoke(channel,input);
  if(!response.ok)throw new Error(`${channel}: ${response.error}`);
  return response.data;
},{channel,input});
const focused=()=>page.waitForFunction(()=>document.activeElement?.id==='command-query');
const open=async(method='shortcut')=>{
  if(method==='button')await page.getByRole('button',{name:'Pesquisar no Caderno',exact:true}).click();
  else await page.keyboard.press('Control+k');
  await page.locator('.command-palette').waitFor();
  await focused();
};
const type=async(text)=>{
  // Deliberately no fill(), input focus() or click() here: typing must work
  // with the focus assigned by the product itself.
  await page.keyboard.type(text,{delay:20});
  assert.equal(await page.locator('#command-query').inputValue(),text);
  await focused();
};
const close=async()=>{
  await page.keyboard.press('Escape');
  await page.locator('.command-palette').waitFor({state:'hidden'});
  assert.equal(await page.locator('#root').evaluate(el=>el.inert),false);
};
try{
  app=await electron.launch({executablePath:process.env.CADERNO_QA_EXECUTABLE||require('electron'),args:process.env.CADERNO_QA_EXECUTABLE?[]:[root],env});
  page=await app.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.getByRole('button',{name:'Pesquisar no Caderno',exact:true}).waitFor();
  const note=await invoke('notes:create',{title:'Nota de foco',contentHtml:'<p>conteudopesquisavel e texto que deve permanecer intacto.</p>'});

  for(const method of ['button','shortcut']){
    await open(method);await type('conteudopesquisavel');
    await page.locator(`.command-result[data-note-id="${note.id}"]`).waitFor();
    await close();
  }
  await open();await type('conteudopesquisavel');await page.locator(`.command-result[data-note-id="${note.id}"]`).waitFor();await page.keyboard.press('Enter');
  await page.locator('.title-input').waitFor();
  for(const origin of ['.ProseMirror','.title-input']){
    await page.locator(origin).click();await open();await type('conteudopesquisavel');await close();
    assert.equal(await page.locator(origin).evaluate(el=>el===document.activeElement),true);
  }

  // A background popover must neither reclaim focus after a pointer event nor
  // consume Escape intended for the palette.
  await page.getByRole('button',{name:'Anexos',exact:true}).click();
  await open();await page.locator('#command-query').click();await page.waitForTimeout(80);await type('conteudopesquisavel');await close();
  if(await page.locator('.attach-pop').isVisible())await page.keyboard.press('Escape');

  for(const tab of ['Notas','Comandos','Tudo']){
    await open();await page.locator('.command-tabs').getByRole('button',{name:tab,exact:true}).click();
    await type(tab==='Comandos'?'Criar nota':'conteudopesquisavel');await close();
  }

  await open();await type('conteudopesquisavel');await page.locator(`.command-result[data-note-id="${note.id}"]`).waitFor();
  await page.keyboard.press('Control+a');await page.keyboard.type('temporario');await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#command-query').inputValue(),'');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');await type('conteudopesquisavel');
  await page.locator(`.command-result[data-note-id="${note.id}"]`).waitFor();
  await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.command-palette').evaluate(el=>el.contains(document.activeElement)),true);
  await page.keyboard.press('Tab');await focused();
  await page.screenshot({path:path.join(artifacts,'palette-typing.png')});await close();

  await page.getByRole('button',{name:'Recolher barra lateral',exact:true}).click();await open('button');await type('conteudopesquisavel');await close();
  assert.equal((await invoke('notes:get',{id:note.id})).contentHtml,note.contentHtml);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,version:await app.evaluate(({app})=>app.getVersion()),checks:['typing on open via button and Ctrl+K','editor/title focus restored','background popover','typing after every tab','arrows, Escape, Backspace and focus trap','collapsed sidebar','note content unchanged','clean console'],artifacts}));
}catch(error){if(page)await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});console.error(error);console.error(`Artifacts: ${artifacts}`);process.exitCode=1;}
finally{await app?.close().catch(()=>{});}
