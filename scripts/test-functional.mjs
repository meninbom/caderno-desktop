import { _electron as electron } from 'playwright';
import strictAssert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-functional-'));
const userData = path.join(runDir, 'profile');
const restoredProfile=path.join(runDir,'restored-profile');
const artifacts = path.join(root, 'evidence', 'functional');
fs.mkdirSync(artifacts, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
const require = createRequire(import.meta.url);
const electronBin = require('electron');
let assertionCount = 0;
const assert = new Proxy(strictAssert, { get(target, key) {
  const member = Reflect.get(target, key, target);
  if (typeof member !== 'function') return member;
  return (...args) => { assertionCount += 1; return Reflect.apply(member, target, args); };
} });
let app;
let page;
let recoveryJobId=null;
let recoveryOcrJobId=null;
let recoveryOcrNoteId=null;
const results = [];
const hostileRequests=[];
const processEvidence = path.join(runDir, 'electron-process.jsonl');
const emlFixture = path.join(runDir, 'fixture.eml');
fs.writeFileSync(emlFixture, ['From: =?UTF-8?Q?Jo=C3=A3o_QA?= <qa@example.test>','To: caderno@example.test','Subject: =?UTF-8?Q?E-mail_de_teste?=','Message-ID: <functional-4a@example.test>','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="qa"','','--qa','Content-Type: text/html; charset=utf-8','','<h1>Conteúdo EML</h1><script>window.evil=1</script><img src="https://tracker.invalid/pixel">','--qa','Content-Type: application/octet-stream; name="dados.bin"','Content-Disposition: attachment; filename="dados.bin"','Content-Transfer-Encoding: base64','','AQIDBA==','--qa--',''].join('\r\n'));
const fakeAudio = path.join(runDir, 'fake-mic.wav');
const sampleRate=48000,samples=sampleRate*3,wav=Buffer.alloc(44+samples*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(sampleRate,24);wav.writeUInt32LE(sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/sampleRate)*5000),44+i*2);fs.writeFileSync(fakeAudio,wav);
const logProcess = (event, details = {}) => fs.appendFileSync(processEvidence, `${JSON.stringify({at:new Date().toISOString(),event,...details})}\n`);
const observeElectron = (electronApp, label) => {
  const child = electronApp.process();
  logProcess('electron-launched', {label,pid:child.pid});
  child.once('error', error => logProcess('electron-process-error', {label,message:error.message}));
  child.once('exit', (code, signal) => logProcess('electron-process-exit', {label,code,signal}));
  child.once('close', (code, signal) => logProcess('electron-process-close', {label,code,signal}));
};
const launchEnv = (profile=userData) => {
  const env = { ...process.env, CADERNO_USER_DATA: profile, CADERNO_DEBUG: '1', CADERNO_QA_IPC: '1', CADERNO_QA_UPDATE_DELAY_MS: '1', CADERNO_QA_EXPORT: path.join(runDir, 'export.md'), CADERNO_QA_BACKUP: path.join(runDir, 'backup.json'), CADERNO_QA_INVALID: path.join(runDir, 'invalid.json'), CADERNO_QA_INVALID_EML:path.join(runDir,'invalid.eml'), CADERNO_QA_EML: emlFixture };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
};
const check = async (name, fn) => {
  const startedAt=Date.now();console.log(`START ${name}`);
  try { await fn(); results.push(name); console.log(`PASS ${name} (${Date.now()-startedAt}ms)`); }
  catch(error) { logProcess('functional-check-failed',{name,elapsedMs:Date.now()-startedAt,message:error instanceof Error?error.message:String(error)}); console.error(`FAIL ${name} (${Date.now()-startedAt}ms)`); throw error; }
};
const invoke = (channel, input = null) => page.evaluate(async ({ channel, input }) => {
  const result = await window.cadernoDesktop.invoke(channel, input);
  if (!result.ok) throw new Error(`${channel}: ${result.error}`);
  return result.data;
}, { channel, input });
const windowCall=(channel,input=null)=>page.evaluate(({channel,input})=>window.cadernoDesktop.invoke(channel,input),{channel,input});
const noteRows = () => page.locator('.note-row');
const clearBanners = async () => {
  for (let i = 0; i < 4 && await page.locator('.error-bar button').count(); i++) await page.locator('.error-bar button').first().click();
};
const openTitle = async (title) => {
  await page.locator('.note-row').filter({ hasText: title }).first().click();
  await page.locator('.title-input').waitFor();
};
const waitForFile = async file => {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`arquivo não apareceu: ${file}`);
};
const waitForNote = async (title, predicate) => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const list = await invoke('notes:list', { view: 'all' });
    const note = list.find(n => n.title === title);
    if (note) {
      const full = await invoke('notes:get', { id: note.id });
      if (predicate(full)) return full;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`persistência não concluída para ${title}`);
};
const assertMoreMenuGeometry = async (width, height, screenshot) => {
  const trigger = page.getByRole('button', { name: 'Mais ações' });
  await trigger.click();
  const menu = page.getByRole('menu');
  await menu.waitFor();
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    const rect = menu.getBoundingClientRect();
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map(item => {
      const r = item.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return { label: item.textContent.trim(), x: r.x, y: r.y, right: r.right, bottom: r.bottom,
        hit: document.elementFromPoint(x, y)?.closest('[role="menuitem"]') === item };
    });
    return { menu: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }, items };
  });
  assert.ok(geometry.menu.x >= 0 && geometry.menu.y >= 0 && geometry.menu.right <= width && geometry.menu.bottom <= height,
    `menu fora da viewport ${width}x${height}: ${JSON.stringify(geometry)}`);
  assert.deepEqual(geometry.items.map(item => item.label), ['Importar Markdown', 'Importar e-mail (.eml)', 'Web Clipper', 'Salvar backup', 'Restaurar backup']);
  for (const item of geometry.items) {
    assert.ok(item.x >= 0 && item.y >= 0 && item.right <= width && item.bottom <= height && item.hit,
      `item inacessível ${item.label} em ${width}x${height}: ${JSON.stringify(item)}`);
  }
  await page.screenshot({ path: screenshot });
  await page.keyboard.press('Escape');
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Escape devolve foco ao botão Mais ações');
  await trigger.click();
  await page.locator('.brand').click();
  await menu.waitFor({ state: 'detached' });
};
// Caption buttons live in the Windows titleBarOverlay: top 40px, rightmost ~140px.
// The formatting toolbar is a centered pill at the bottom of the editor, so its x
// can pass width-140 without covering those buttons.
const assertToolbarClearsCaption = async (width, theme) => {
  const overlaps = await page.locator('.editor-toolbar button, .editor-toolbar select, .editor-toolbar summary').evaluateAll((controls, width) => {
    const bandBottom = 40, bandLeft = width - 140;
    return controls.flatMap(el => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return [];
      if (!(r.right > bandLeft && r.left < width && r.top < bandBottom && r.bottom > 0)) return [];
      return [{ label: el.getAttribute('aria-label') || el.getAttribute('title') || el.tagName, left: r.left, top: r.top, right: r.right, bottom: r.bottom }];
    });
  }, width);
  assert.deepEqual(overlaps, [], `toolbar invade caption buttons em ${width} ${theme}: ${JSON.stringify(overlaps)}`);
};

try {
  app = await electron.launch({ executablePath: electronBin, args: [root,'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${fakeAudio}`], env: launchEnv(), timeout: 30000 });
  observeElectron(app, 'profile');
  const processLog = path.join(runDir, 'electron-process.jsonl');
  const appendProcessLog = event => { try { fs.appendFileSync(processLog, `${JSON.stringify({at:new Date().toISOString(),...event})}\n`); } catch {} };
  app.process().on('exit', (code, signal) => appendProcessLog({event:'electron-exit',code,signal}));
  app.process().on('close', (code, signal) => appendProcessLog({event:'electron-close',code,signal}));
  app.process().stderr?.on('data', chunk => appendProcessLog({event:'stderr',text:String(chunk).slice(-2000)}));
  app.on('close', () => appendProcessLog({event:'playwright-close'}));
  page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  page.on('request',request=>{if(request.url().startsWith('https://127.0.0.1:45551/'))hostileRequests.push(request.url());});
  page.on('console', m => { if (m.type() === 'error') console.error('RENDERER', m.text()); });
  await page.locator('.new-note').waitFor();
  await page.locator('.note-row').first().waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
  await app.evaluate(({ dialog, shell }) => {
    globalThis.__qa = { openPath: null, openError: '', openResult: { canceled: true, filePaths: [] }, saveResult: { canceled: false, filePath: process.env.CADERNO_QA_EXPORT } };
    dialog.showOpenDialog = async () => globalThis.__qa.openResult;
    dialog.showSaveDialog = async () => globalThis.__qa.saveResult;
    shell.openPath = async p => { globalThis.__qa.openPath = p; return globalThis.__qa.openError; };
  });
  const runtimeErrors = [];
  page.on('pageerror', e => runtimeErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error'&&!/Blocked script execution|Not allowed to navigate top frame to data URL|violates the following Content Security Policy|Unsafe attempt to initiate navigation|server responded with a status of (404|416)/.test(m.text())) runtimeErrors.push(m.text()); });

  await check('startup bridge + isolated SQLite profile', async () => {
    const meta = await invoke('app:meta');
    assert.equal(meta.name, 'caderno');
    assert.equal(path.resolve(meta.userDataPath), path.resolve(userData));
    assert.equal(await page.evaluate(() => typeof window.cadernoDesktop.invoke), 'function');
    await page.evaluate(() => location.assign('data:text/html,<h1>origem externa</h1>')).catch(() => {});
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => location.protocol), 'file:', 'navegação não confiável não pode substituir o renderer privilegiado');
    assert.equal((await invoke('app:meta')).name, 'caderno', 'bridge IPC continua limitado ao renderer principal confiável');
  });
  await check('native window titlebar overlay configuration and window controls', async () => {
    const mainSource = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    assert.match(mainSource, /titleBarStyle:\s*process\.platform === "win32"\s*\?\s*"hidden"/);
    assert.match(mainSource, /titleBarOverlay:\s*titleBarOverlayOptions\(repos\.meta\.get\("theme"\)\)/);
    const result = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const minSize = win.getMinimumSize();
      win.minimize();
      const minimized = win.isMinimized();
      win.restore();
      const restored = !win.isMinimized() && !win.isMaximized();
      win.maximize();
      const maximized = win.isMaximized();
      win.unmaximize();
      const unmaximized = !win.isMaximized();
      const child = new BrowserWindow({ show: false });
      const closeWorks = new Promise(resolve => child.once('closed', () => resolve(true)));
      child.close();
      await closeWorks;
      win.focus();
      return {
        platform: process.platform,
        title: win.getTitle(),
        canUpdateOverlay: typeof win.setTitleBarOverlay === 'function',
        resizable: win.isResizable(),
        minSize,
        minimized,
        restored,
        maximized,
        unmaximized,
        closeWorks: child.isDestroyed(),
      };
    });
    assert.equal(result.platform, 'win32');
    assert.equal(result.title, 'Caderno', 'o nome da janela continua identificável');
    assert.equal(result.canUpdateOverlay, true);
    assert.equal(result.resizable, true);
    assert.deepEqual(result.minSize, [900, 560]);
    assert.equal(result.minimized, true);
    assert.equal(result.restored, true);
    assert.equal(result.maximized, true);
    assert.equal(result.unmaximized, true);
    assert.equal(result.closeWorks, true);
  });
  await check('create note, title/body autosave, status and SQLite-backed reload', async () => {
    await page.locator('.new-note').click();
    const title = page.locator('.title-input');
    await title.fill('Funcional 001');
    const body = page.locator('.tiptap');
    await body.fill('corpo gravado via renderer');
    await page.locator('.editor-status').waitFor();
    await waitForNote('Funcional 001', n => /corpo gravado via renderer/.test(n.contentHtml));
    await page.locator('.saved-ok').waitFor({ timeout: 5000 });
    const notes = await invoke('notes:list', { view: 'all' });
    assert.equal(notes[0].title, 'Funcional 001');
    assert.match(notes[0].preview, /corpo gravado via renderer/);
    await page.reload();
    await openTitle('Funcional 001');
    await page.waitForFunction(() => document.querySelector('.tiptap')?.innerText.includes('corpo gravado via renderer'), null, { timeout: 5000 }).catch(async () => {
      const n = (await invoke('notes:list', { view: 'all' })).find(x => x.title === 'Funcional 001');
      console.log('TRACE after reload', n && await invoke('notes:get', { id: n.id }));
    });
    assert.match(await page.locator('.tiptap').innerText(), /corpo gravado via renderer/);
  });
  await check('TipTap table editing, formatting persistence and local raster image bytes', async () => {
    const openMenu=async title=>page.locator(`.toolbar-menu summary[title="${title}"]`).evaluate(el=>{if(!el.parentElement.open)el.click();});
    await page.locator('.new-note').click(); await page.locator('.title-input').fill('Editor 1B QA');
    await waitForNote('Editor 1B QA',()=>true);
    const editor=page.locator('.ProseMirror'); await editor.fill('texto formato');
    await editor.press('Control+A');
    await openMenu('Formatação adicional');
    await page.getByTitle('Sublinhar').click();
    await page.getByRole('button', { name: /^Marca-texto:/ }).click();
    await page.getByRole('group', { name: 'Marca-texto', exact: true }).getByRole('button', { name: 'Amarelo, #FFF176', exact: true }).click();
    await page.getByTitle('Centralizar').click();
    await page.getByRole('button', { name: /^Cor do texto:/ }).click();
    const textColor = page.getByRole('group', { name: 'Cor do texto', exact: true });
    await textColor.getByLabel('Cor personalizada (HEX)').fill('#336699');
    await textColor.getByRole('button', { name: 'Aplicar', exact: true }).click();
    const formatted=await editor.innerHTML();
    assert.match(formatted,/<u>/i,'underline serializado'); assert.match(formatted,/<mark\b/i,'highlight serializado');
    assert.match(formatted,/text-align:\s*center/i,'alinhamento serializado');
    const formatId=(await invoke('notes:list',{view:'all'})).find(n=>n.title==='Editor 1B QA').id;
    await page.waitForTimeout(800); assert.match((await invoke('notes:get',{id:formatId})).contentHtml,/<u>/i,'formatação autosalva no SQLite');
    await page.locator('.new-note').click(); await page.locator('.title-input').fill('Tabela QA');
    await waitForNote('Tabela QA',()=>true);
    const tableEditor=page.locator('.ProseMirror');
    await openMenu('Mais ferramentas'); await page.getByTitle('Inserir tabela').click();
    const table=tableEditor.locator('table'); await table.waitFor();
    await table.locator('td p').first().click(); await page.keyboard.type('célula real');
    assert.match(await table.innerText(),/célula real/,'digitação em célula real do editor');
    await openMenu('Mais ferramentas'); await page.getByTitle('Adicionar linha').click();
    await openMenu('Mais ferramentas'); await page.getByTitle('Adicionar coluna').click();
    assert.equal(await table.locator('tr').count(),4,'linha inserida');
    assert.equal(await table.locator('tr').first().locator('th,td').count(),4,'coluna inserida');
    await openMenu('Mais ferramentas'); await page.getByTitle('Excluir coluna').click();
    await openMenu('Mais ferramentas'); await page.getByTitle('Excluir linha').click();
    assert.equal(await table.locator('tr').count(),3,'linha removida');
    await page.getByTitle('Desfazer').click(); assert.equal(await table.locator('tr').count(),4,'undo reverte exclusão da linha');
    await page.getByTitle('Refazer').click(); assert.equal(await table.locator('tr').count(),3,'redo reaplica exclusão da linha');
    await openMenu('Mais ferramentas'); await page.getByTitle('Inserir imagem').click();
    const png=path.join(root,'evidence','functional','menu-light-900x560.png');
    await page.locator('#note-image-input').setInputFiles(png);
    const img=tableEditor.locator('img'); await img.waitFor({state:'attached'}); await img.scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>{const i=document.querySelector('.ProseMirror img');return i&&i.complete&&i.naturalWidth>0;});
    await img.click();const imageDialog=page.getByRole('dialog',{name:'Visualizar imagem'});const expandedImage=imageDialog.locator('img');await expandedImage.waitFor();
    assert.ok(await expandedImage.evaluate(el=>el.naturalWidth>0),'preview inline decodifica imagem real');const imageWidth=await expandedImage.evaluate(el=>el.getBoundingClientRect().width);
    await imageDialog.getByRole('button',{name:'Ampliar zoom'}).click();assert.ok(await expandedImage.evaluate(el=>el.getBoundingClientRect().width)>imageWidth,'zoom altera largura renderizada');await page.screenshot({path:path.join(artifacts,'media-preview-image-zoom.png')});await page.keyboard.press('Escape');
    assert.equal(await page.locator('.ProseMirror').evaluate(el=>el.contains(document.activeElement)),true,'fechar preview retorna foco ao editor');
    await openMenu('Mais ferramentas'); await page.getByTitle('Texto alternativo da imagem').click(); await page.locator('#image-alt').fill('captura de interface'); await page.getByRole('dialog',{name:'Texto alternativo',exact:true}).getByRole('button',{name:'Salvar',exact:true}).click();
    assert.equal(await img.getAttribute('alt'),'captura de interface','texto alternativo editável');
    const imageBase64=fs.readFileSync(png).toString('base64');
    for(const kind of ['paste','drop']) await tableEditor.evaluate((dom,{kind,imageBase64})=>{const bytes=Uint8Array.from(atob(imageBase64),c=>c.charCodeAt(0));const file=new File([bytes],'event-image.png',{type:'image/png'});const transfer=new DataTransfer();transfer.items.add(file);const event=kind==='paste'?new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true});dom.dispatchEvent(event);},{kind,imageBase64});
    await page.waitForFunction(()=>document.querySelectorAll('.ProseMirror img').length>0);
    const noteId=(await invoke('notes:list',{view:'all'})).find(n=>n.title==='Tabela QA').id;
    assert.equal((await invoke('attachments:list',{noteId})).length,3,'picker, paste e drop salvam os bytes no store local');
    const beforeInvalid=(await invoke('attachments:list',{noteId})).length;
    const invalid=await page.evaluate(async noteId=>window.cadernoDesktop.invoke('images:save',{noteId,name:'ativo.svg',dataBase64:btoa('<svg onload="alert(1)"/>')}),noteId);
    assert.equal(invalid.ok,false,'SVG ativo rejeitado pelo IPC principal'); assert.equal((await invoke('attachments:list',{noteId})).length,beforeInvalid,'imagem inválida não altera anexos');
    const content=await tableEditor.innerHTML();
    assert.match(content,/caderno-asset:\/\/[0-9a-f-]{36}\.(png|jpg|webp)/i,'URI local opaca');
    assert.doesNotMatch(content,/data:image\//i,'HTML não contém base64');
    const fileName=new URL(await img.getAttribute('src')).hostname;
    const attached=(await invoke('attachments:list',{noteId})).find(a=>a.storedName===fileName);
    assert.ok(attached,'asset local associado à nota');
    assert.ok(fs.statSync(path.join(userData,'attachments',attached.storedName)).size>0,'bytes reais persistidos em attachments');
    await page.waitForTimeout(800); await page.reload(); await openTitle('Tabela QA');
    assert.equal(await tableEditor.locator('table tr').count(),3,'tabela persiste após reload');
    await page.waitForFunction(()=>{const i=document.querySelector('.ProseMirror img');return i&&i.complete&&i.naturalWidth>0;});
    const persisted=await invoke('notes:get',{id:noteId}); assert.doesNotMatch(persisted.contentHtml,/data:image\//i);
    await page.setViewportSize({width:900,height:560}); await page.screenshot({path:path.join(artifacts,'editor-1b-light-900x560.png')});
    await page.getByTitle('Alternar tema').click(); await page.screenshot({path:path.join(artifacts,'editor-1b-dark-900x560.png')}); await page.getByTitle('Alternar tema').click(); await page.setViewportSize({width:1200,height:780});
  });
  await check('1C real PDF/HTML/WebM previews, PDF canvas/zoom, Range and viewer errors', async()=>{
    const showAttachments=async()=>{if(!await page.locator('.attach-pop').isVisible().catch(()=>false))await page.getByTitle('Anexos', { exact: true }).click();};
    const waitPdfInk=()=>page.waitForFunction(()=>{const c=document.querySelector('#media-pdf-canvas');if(!c||c.dataset.renderedPage!=='1')return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=4)if(d[i+3]>0&&d[i]<100&&d[i+1]<100&&d[i+2]<100)return true;return false;});
    const settlePdfPaint=async(expected)=>{await page.waitForFunction(text=>{const c=document.querySelector('#media-pdf-canvas');return c?.dataset.renderedPage===String(text.page)&&c.dataset.textContent.includes(text.label);},{page:expected.page,label:expected.label});const pixels=await page.locator('#media-pdf-canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let dark=0,nonWhite=0;for(let i=0;i<d.length;i+=4){if(d[i]<100&&d[i+1]<100&&d[i+2]<100)dark++;if(d[i]<245||d[i+1]<245||d[i+2]<245)nonWhite++;}return {dark,nonWhite};});assert.ok(pixels.dark>20&&pixels.nonWhite>20,`PDF precisa conter glifos rasterizados e tinta, não canvas branco: ${JSON.stringify(pixels)}`);};
    const captureCompositedPdf=async(file,expected)=>{for(let frame=0;frame<40;frame++){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));const png=await page.screenshot();const box=await page.locator('#media-pdf-canvas').boundingBox();const dark=await page.evaluate(async({data,box})=>{const image=new Image();image.src=`data:image/png;base64,${data}`;await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const x=Math.max(0,Math.floor(box.x+box.width*.05)),y=Math.max(0,Math.floor(box.y+box.height*.15)),w=Math.min(c.width-x,Math.ceil(box.width*.5)),h=Math.min(c.height-y,Math.ceil(box.height*.4)),d=ctx.getImageData(x,y,w,h).data;let count=0;for(let i=0;i<d.length;i+=4)if(d[i]<100&&d[i+1]<100&&d[i+2]<100)count++;return count;},{data:png.toString('base64'),box});if(dark>20){fs.writeFileSync(file,png);return;} }throw new Error(`PDF ${expected.label} está correto no backing canvas mas seus glifos não apareceram na captura composta após 40 frames`);};
    await page.locator('.new-note').click();await page.locator('.title-input').fill('Etapa 1C QA');
    await waitForNote('Etapa 1C QA',()=>true);
    await page.getByTitle('Anexos', { exact: true }).click();await page.getByRole('menuitem',{name:'Inserir mídia na nota'}).click();
    const mediaFiles=['two-pages.pdf','attack.html','two-seconds.webm','corrupt.pdf'].map(n=>path.join(root,'tests/fixtures/media',n));
    await page.locator('input[accept*="application/pdf"]').setInputFiles(mediaFiles);
    const noteId=(await invoke('notes:list',{view:'all'})).find(n=>n.title==='Etapa 1C QA').id;recoveryOcrNoteId=noteId;
    let items=[];const mediaDeadline=Date.now()+6000;while(Date.now()<mediaDeadline){items=await invoke('attachments:list',{noteId});if(items.length===4)break;await page.waitForTimeout(50);}assert.equal(items.length,4,'os quatro anexos foram confirmados no SQLite antes da leitura');assert.deepEqual(items.map(a=>a.mimeType).sort(),['application/pdf','application/pdf','text/html','video/webm'].sort());
    const txtFixture=path.join(runDir,'search-only-cobalt.txt'),htmlFixture=path.join(runDir,'search-only-cobalt.html');fs.writeFileSync(txtFixture,'cobalt searchable attachment phrase','utf8');fs.writeFileSync(htmlFixture,'<!doctype html><title>Fixture</title><p>cobalt html attachment phrase</p>','utf8');
    const indexBatch=[];for(let i=0;i<20;i++){const file=path.join(runDir,`index-batch-${String(i).padStart(2,'0')}.txt`);fs.writeFileSync(file,`background indexing batch ${i} ${'payload '.repeat(8000)}`,'utf8');indexBatch.push(file);}
    const ocrPng=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=300;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='bold 76px Arial';x.fillText('ORCHID 2046',40,180);return c.toDataURL('image/png').split(',')[1]}),'base64');const ocrFixture=path.join(runDir,'ocr-winrt-orchid.png');fs.writeFileSync(ocrFixture,ocrPng);
    const jpeg=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=300;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='bold 76px Arial';x.fillText('ORCHID 2046',40,180);return c.toDataURL('image/jpeg',.92).split(',')[1]}),'base64');
    const pdfParts=[Buffer.from('%PDF-1.4\n')],pdfOffsets=[0];const addObj=(id,body)=>{pdfOffsets[id]=Buffer.concat(pdfParts).length;pdfParts.push(Buffer.from(`${id} 0 obj\n`),Buffer.isBuffer(body)?body:Buffer.from(body),Buffer.from('\nendobj\n'));};
    addObj(1,'<< /Type /Catalog /Pages 2 0 R >>');addObj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');addObj(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>');const ops=Buffer.from('q 560 0 0 140 26 500 cm /Im0 Do Q');addObj(4,Buffer.concat([Buffer.from(`<< /Length ${ops.length} >>\nstream\n`),ops,Buffer.from('\nendstream')]));addObj(5,Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1200 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,Buffer.from('\nendstream')]));const body=Buffer.concat(pdfParts),xref=body.length;const xrefText=`xref\n0 6\n0000000000 65535 f \n${pdfOffsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const scanFixture=path.join(root,'tests/fixtures/media/ocr-scan-two-pages.pdf'),mixedFixture=path.join(root,'tests/fixtures/media/ocr-mixed-three-pages.pdf'),cancelFixture=path.join(root,'tests/fixtures/media/ocr-cancel-24-pages.pdf'),pageLimitFixture=path.join(root,'tests/fixtures/media/ocr-page-limit-501.pdf'),corruptFixture=path.join(runDir,'ocr-corrupt.pdf');fs.writeFileSync(corruptFixture,'%PDF-1.4\nconteudo quebrado sem tabela xref');
    await showAttachments();await page.getByRole('menuitem',{name:'Adicionar arquivo'}).click();await page.locator('input[type="file"]:not([accept])').setInputFiles([txtFixture,htmlFixture,...indexBatch,ocrFixture,scanFixture,mixedFixture,cancelFixture,pageLimitFixture,corruptFixture]);
    let attached=[];for(let i=0;i<200;i++){attached=await invoke('attachments:list',{noteId});if(attached.length===32)break;await page.waitForTimeout(50);}assert.equal(attached.length,32,`upload UI anexou ${attached.length}/32 arquivos`);
    const jobsBefore=(await invoke('attachments:jobs')).filter(j=>j.fileName.startsWith('index-batch-'));assert.ok(jobsBefore.length===20,`20 anexos reais pela UI aguardam fila (${jobsBefore.length})`);
    await page.keyboard.press('Escape');const typing='teclado continua responsivo ';const typingStart=Date.now();await page.locator('.tiptap').click();await page.keyboard.type(typing,{delay:12});const typingElapsed=Date.now()-typingStart;const keyboardExcessMs=Math.max(0,typingElapsed-typing.length*12);fs.mkdirSync(path.join(root,'evidence/performance'),{recursive:true});fs.writeFileSync(path.join(root,'evidence/performance/functional-indexing.json'),JSON.stringify({timestamp:new Date().toISOString(),fixture:{queuedTextAttachments:20,bytes:indexBatch.reduce((sum,file)=>sum+fs.statSync(file).size,0)},typing:{characters:typing.length,perKeyDelayMs:12,elapsedMs:typingElapsed,excessAboveIntentionalDelayMs:keyboardExcessMs,jobStates:jobsBefore.map(j=>j.status)}},null,2)+'\n');
    let indexed=[];for(let i=0;i<300;i++){indexed=(await invoke('attachments:jobs')).filter(j=>j.fileName.includes('search-only-cobalt')||j.fileName==='ocr-winrt-orchid.png');if(indexed.length===3&&indexed.every(j=>j.status==='completed'))break;await page.waitForTimeout(100);}assert.equal(indexed.length,3);assert.ok(indexed.every(j=>j.status==='completed'),`jobs de texto/OCR não concluíram: ${JSON.stringify(indexed)}`);
    let batchJobs=[];for(let i=0;i<400;i++){batchJobs=(await invoke('attachments:jobs')).filter(j=>j.fileName.startsWith('index-batch-'));if(batchJobs.length===20&&batchJobs.every(j=>j.status==='completed'))break;await page.waitForTimeout(100);}assert.ok(batchJobs.every(j=>j.status==='completed'),'jobs de carga completam no worker');
    const waitJob=async name=>{let job;for(let i=0;i<300;i++){job=(await invoke('attachments:jobs')).find(j=>j.fileName===name);if(job?.status==='completed'||job?.status==='error')return job;await page.waitForTimeout(100);}throw new Error(`job ${name} excedeu o limite de espera: ${JSON.stringify(job)}`)};
    const pdfStarted=Date.now(),memoryBefore=await app.evaluate(({app})=>app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,workingSetSize:m.memory.workingSetSize})));let scannedJob=await waitJob('ocr-scan-two-pages.pdf');assert.equal(scannedJob.status,'completed',`PDF escaneado real OCR falhou: ${scannedJob.error}`);assert.equal(scannedJob.progress,100);assert.equal(scannedJob.checkpoint,2);assert.equal(scannedJob.totalPages,2,'job persiste páginas processadas');
    const mixedJob=await waitJob('ocr-mixed-three-pages.pdf');assert.equal(mixedJob.status,'completed',`PDF misto falhou: ${mixedJob.error}`);assert.equal(mixedJob.checkpoint,3);assert.equal(mixedJob.totalPages,3);
    const cancelJob=(await invoke('attachments:jobs')).find(j=>j.fileName==='ocr-cancel-24-pages.pdf');assert.ok(cancelJob,'job OCR cancelável persistido');let cancelProgress;for(let i=0;i<150;i++){cancelProgress=(await invoke('attachments:jobs')).find(j=>j.id===cancelJob.id);if(cancelProgress?.progress>30&&cancelProgress.checkpoint>0)break;await page.waitForTimeout(50);}assert.equal(cancelProgress?.status,'running',`OCR WinRT de múltiplas páginas não alcançou progresso: ${JSON.stringify(cancelProgress)}`);assert.ok(cancelProgress.progress>30,'progresso maior que a etapa de leitura indica página passada ao OCR WinRT');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(900,560));await page.setViewportSize({width:900,height:560});const themeBefore=await page.locator('html').getAttribute('data-theme');if(themeBefore!=='light')await page.getByTitle('Alternar tema').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='light');await page.getByRole('button',{name:'Configurações',exact:true}).click();await page.getByRole('button',{name:/Indexação de anexos/}).click();await page.waitForFunction(()=>/processando (?:3[2-9]|[4-9]\d)% · página \d+\/24/.test(document.querySelector('.attachment-jobs')?.innerText??''),null,{timeout:8000});await page.screenshot({path:path.join(artifacts,'pdf-ocr-progress-light-900x560.png')});const progressGeometry=await page.evaluate(()=>({w:document.documentElement.clientWidth,sw:document.documentElement.scrollWidth,job:document.querySelector('.attachment-jobs')?.innerText??''}));assert.ok(progressGeometry.sw<=progressGeometry.w,'status OCR não introduz overflow horizontal em 900x560');assert.match(progressGeometry.job,/processando (?:3[2-9]|[4-9]\d)% · página \d+\/24/,'UI mostra progresso de OCR por página e distingue rasterização');await page.getByTitle('Alternar tema').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='dark');await page.screenshot({path:path.join(artifacts,'pdf-ocr-progress-dark-900x560.png')});await page.getByRole('button',{name:'Configurações',exact:true}).click();
    const noteHtmlBefore=(await invoke('notes:get',{id:noteId})).contentHtml,keyboardStart=Date.now();await page.locator('.tiptap').click();await page.keyboard.type('OCR typing responsiveness',{delay:8});await page.keyboard.press('Control+z');const ocrTypingElapsed=Date.now()-keyboardStart;const memoryDuringOcr=await app.evaluate(({app})=>app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,workingSetSize:m.memory.workingSetSize})));await page.waitForTimeout(250);assert.equal((await invoke('notes:get',{id:noteId})).contentHtml,noteHtmlBefore,'digitar e desfazer enquanto OCR executa preserva o conteúdo da nota');
    const canceledOcr=await invoke('attachments:cancel-job',{id:cancelJob.id});assert.equal(canceledOcr,true);for(let i=0;i<100;i++){cancelProgress=(await invoke('attachments:jobs')).find(j=>j.id===cancelJob.id);if(cancelProgress?.status==='cancel_requested')break;await page.waitForTimeout(25);}assert.equal(cancelProgress.status,'cancel_requested','cancelamento OCR mantém status persistido sem publicar índice parcial');assert.equal((await invoke('notes:list',{view:'all',query:'CANCEL type:attachment'})).some(n=>n.matchSource==='ocr-cancel-24-pages.pdf'),false,'cancelamento OCR não indexa páginas parciais');await invoke('attachments:retry-job',{id:cancelJob.id});const retriedOcr=await waitJob('ocr-cancel-24-pages.pdf');assert.equal(retriedOcr.status,'completed',`retry de OCR após cancelar subprocesso: ${retriedOcr.error}`);assert.ok(retriedOcr.attempts>=2);assert.ok((await invoke('notes:list',{view:'all',query:'CANCEL type:attachment'})).some(n=>n.matchSource==='ocr-cancel-24-pages.pdf'),'retry indexa texto OCR verdadeiro após concluir todas as páginas');
    const scanIndexed=await invoke('notes:list',{view:'all',query:'SCAN PAGE ONE type:attachment'});assert.ok(scanIndexed.some(n=>n.title==='Etapa 1C QA'),'consulta type:attachment encontra a frase reconhecida na página 1 do PDF');
    const secondPage=await invoke('notes:list',{view:'all',query:'PÚBLICA type:attachment'});assert.ok(secondPage.some(n=>n.matchSource==='ocr-scan-two-pages.pdf'),'busca com acento encontra OCR português quando reconhecido pelo runtime local');
    const digitalMixed=await invoke('notes:list',{view:'all',query:'DIGITAL LAYER COBALT type:attachment'});assert.ok(digitalMixed.some(n=>n.matchSource==='ocr-mixed-three-pages.pdf'),'PDF misto preserva camada digital existente');
    const rasterMixed=await invoke('notes:list',{view:'all',query:'RASTER ORCHID MIXED PAGE TWO type:attachment'});assert.ok(rasterMixed.some(n=>n.matchSource==='ocr-mixed-three-pages.pdf'),'PDF misto faz OCR das páginas sem texto digital');
    const failedLimit=await waitJob('ocr-page-limit-501.pdf'),failedCorrupt=await waitJob('ocr-corrupt.pdf');assert.equal(failedLimit.status,'error');assert.match(failedLimit.error,/500 páginas/);assert.equal(failedCorrupt.status,'error');
    for(const filename of ['ocr-scan-two-pages.pdf','ocr-mixed-three-pages.pdf','ocr-page-limit-501.pdf','ocr-corrupt.pdf']){const row=attached.find(a=>a.fileName===filename);assert.ok(row&&fs.existsSync(path.join(userData,'attachments',row.storedName)),`falha/sucesso mantém bytes do anexo ${filename}`);}
    assert.equal((await invoke('notes:list',{view:'all',query:'ORCHID type:attachment'})).some(n=>n.matchSource==='ocr-corrupt.pdf'),false,'PDF corrompido nunca publica texto parcial');
    await page.getByRole('searchbox',{name:'Buscar notas'}).fill('SCAN PAGE ONE type:attachment');await page.locator('.note-row').filter({hasText:'Etapa 1C QA'}).waitFor();
    const captureSearchTheme=async(theme,file)=>{const current=await page.locator('html').getAttribute('data-theme');if(current!==theme)await page.getByTitle('Alternar tema').click();await page.waitForFunction(expected=>document.documentElement.getAttribute('data-theme')===expected,theme);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:path.join(artifacts,file)});};
    await captureSearchTheme('light','pdf-ocr-search-light-900x560.png');await captureSearchTheme('dark','pdf-ocr-search-dark-900x560.png');await captureSearchTheme('light','pdf-ocr-search-light-900x560.png');
    await page.locator('.note-row').filter({hasText:'Etapa 1C QA'}).click();await page.getByRole('dialog',{name:'Visualizar ocr-scan-two-pages.pdf'}).waitFor();await page.keyboard.press('Escape');
    fs.mkdirSync(path.join(root,'evidence/performance'),{recursive:true});const memoryAfter=await app.evaluate(({app})=>app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,workingSetSize:m.memory.workingSetSize})));fs.writeFileSync(path.join(root,'evidence/performance/pdf-ocr-functional.json'),JSON.stringify({timestamp:new Date().toISOString(),fixture:{scanBytes:fs.statSync(scanFixture).size,mixedBytes:fs.statSync(mixedFixture).size,cancelBytes:fs.statSync(cancelFixture).size,scanPages:2,mixedPages:3,cancelPages:24},elapsedMs:Date.now()-pdfStarted,ocrPageProgress:{scan:{checkpoint:scannedJob.checkpoint,totalPages:scannedJob.totalPages},mixed:{checkpoint:mixedJob.checkpoint,totalPages:mixedJob.totalPages},canceled:{checkpoint:cancelProgress.checkpoint,totalPages:cancelProgress.totalPages}},typingDuringOcr:{characters:26,elapsedMs:ocrTypingElapsed,perKeyDelayMs:8},electronMemoryBefore:memoryBefore,electronMemoryDuring:memoryDuringOcr,electronMemoryAfter:memoryAfter,notes:'PowerShell child-process memory is not included in Electron app.getAppMetrics.'},null,2)+'\n');
    await page.getByRole('button',{name:/Notas/}).first().click();const search=page.getByRole('searchbox',{name:'Buscar notas'});await search.fill('cobalt');const direct=await invoke('notes:list',{view:'all',query:'cobalt'});assert.ok(direct.some(n=>n.title==='Etapa 1C QA'),`consulta do main não encontrou anexo: ${JSON.stringify(direct)}`);await page.locator('.note-row').filter({hasText:'Etapa 1C QA'}).waitFor();assert.match(await page.locator('.note-row').filter({hasText:'Etapa 1C QA'}).innerText(),/Anexo: search-only-cobalt/,'resultado cita origem do anexo e snippet');
    await page.getByRole('button',{name:'Filtros'}).click();await page.getByRole('radio',{name:'Anexos'}).click();assert.equal(await page.locator('.note-row').count(),1,'type:attachment pesquisa texto real');await page.screenshot({path:path.join(artifacts,'attachment-search-light-900x560.png')});
    await page.getByLabel('Filtrar por caderno').selectOption({index:0});assert.equal(await search.inputValue(),'cobalt type:attachment');await page.getByRole('button',{name:'Limpar filtros'}).click();assert.equal(await search.inputValue(),'cobalt');
    await page.getByRole('radio',{name:'Transcrições'}).click();await page.getByText(/Nenhuma transcrição indexada\/configurada/).waitFor();await page.getByRole('radio',{name:'Tudo'}).click();
    await search.fill('ORCHID type:attachment');const ocrResult=await invoke('notes:list',{view:'all',query:'ORCHID type:attachment'});assert.ok(ocrResult.some(n=>n.matchSource==='ocr-winrt-orchid.png'),'WinRT OCR de imagem indexou texto local reconhecido');await page.locator('.note-row').filter({hasText:'Etapa 1C QA'}).click();await page.getByRole('dialog',{name:'Visualizar ocr-winrt-orchid.png'}).waitFor();await page.keyboard.press('Escape');
    await search.fill('Page type:attachment');await page.locator('.note-row').filter({hasText:'Etapa 1C QA'}).waitFor();assert.match(await page.locator('.note-row').filter({hasText:'Etapa 1C QA'}).innerText(),/two-pages\.pdf/,'PDF pesquisável identifica arquivo fonte');
    await page.locator('.note-row').filter({hasText:'Etapa 1C QA'}).click();await page.locator('.title-input').waitFor();assert.equal(await page.locator('.title-input').inputValue(),'Etapa 1C QA','clique no resultado abre a nota de origem; a prévia é aberta explicitamente adiante');
     const transientPreview=page.locator('.media-preview-backdrop');if(await transientPreview.count()){await transientPreview.getByRole('button',{name:'Fechar visualização'}).click();await transientPreview.waitFor({state:'detached'});}
    await page.getByTitle('Alternar tema').click();await page.waitForFunction(async()=>{const r=await window.cadernoDesktop.invoke('theme:get',null);return r.ok&&r.data==='dark'});await search.fill('cobalt type:attachment');await page.locator('.note-row').filter({hasText:'Etapa 1C QA'}).waitFor();await page.screenshot({path:path.join(artifacts,'attachment-search-dark-900x560.png')});await page.getByTitle('Alternar tema').click();await page.waitForFunction(async()=>{const r=await window.cadernoDesktop.invoke('theme:get',null);return r.ok&&r.data==='light'});await search.fill('');
    const pdf=items.find(a=>a.fileName==='two-pages.pdf');await showAttachments();await page.getByRole('button',{name:`Visualizar ${pdf.fileName}`}).click();
    const dialog=page.getByRole('dialog',{name:`Visualizar ${pdf.fileName}`}),canvas=dialog.locator('canvas');await canvas.waitFor();
    await settlePdfPaint({page:1,label:'Page One'});
    assert.match(await dialog.innerText(),/Página 1 \/ 2/,'duas páginas do PDF real reconhecidas');const width=await canvas.evaluate(c=>c.getBoundingClientRect().width),pixelWidth=await canvas.evaluate(c=>c.width);
    await dialog.getByRole('button',{name:'Ampliar zoom'}).click();await page.waitForFunction(w=>document.querySelector('#media-pdf-canvas')?.getBoundingClientRect().width>w,width);await settlePdfPaint({page:1,label:'Page One'});
    assert.ok(await canvas.evaluate((c,oldWidth)=>c.width>oldWidth,pixelWidth),'zoom redesenha canvas em pixels');await dialog.getByRole('button',{name:'Próxima página'}).click();await page.getByText('Página 2 / 2').waitFor();await settlePdfPaint({page:2,label:'Page Two'});
    const ranged=await page.evaluate(async name=>{const r=await fetch(`caderno-asset://${name}`,{headers:{Range:'bytes=0-15'}});return {status:r.status,bytes:(await r.arrayBuffer()).byteLength,contentRange:r.headers.get('content-range')};},pdf.storedName);
    assert.equal(ranged.status,206);assert.equal(ranged.bytes,16);assert.match(ranged.contentRange,/^bytes 0-15\//);
    assert.equal(await page.evaluate(async name=>(await fetch(`caderno-asset://${name}`,{headers:{Range:'bytes=999999-'}})).status,pdf.storedName),416,'Range fora dos limites retorna 416');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('title')==='Anexos');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('title')),'Anexos','Escape restaura foco ao acionador de anexos');
    const html=items.find(a=>a.mimeType==='text/html');await showAttachments();await page.getByRole('button',{name:`Visualizar ${html.fileName}`}).click();const frame=page.frameLocator('iframe[title^="Prévia isolada"]');
    await frame.locator('#benign').waitFor();assert.equal(await frame.locator('#benign').innerText(),'Conteúdo HTML seguro');
    assert.equal(await frame.locator('body').evaluate(()=>typeof window.cadernoDesktop),'undefined','iframe sem ponte IPC');
    assert.equal(await frame.locator('script').count(),0,'sanitizador DOM elimina scripts');assert.equal(await frame.locator('form').count(),0,'sanitizador remove forms');assert.equal(await frame.locator('#top').getAttribute('href'),null,'URL de navegação removida');assert.equal(await frame.locator('img').getAttribute('src'),null,'URL remota de imagem removida');
    const policy=await page.evaluate(async name=>(await fetch(`caderno-asset://${name}`)).headers.get('content-security-policy'),html.storedName);assert.match(policy,/default-src 'none'/);
    await frame.locator('#top').evaluate(el=>el.click());assert.equal(await page.evaluate(()=>location.protocol),'file:','tentativa de top navigation bloqueada');await page.screenshot({path:path.join(artifacts,'media-preview-html-benign.png')});await page.keyboard.press('Escape');await page.locator('iframe[title^="Prévia isolada"]').waitFor({state:'detached'});
    const video=items.find(a=>a.mimeType==='video/webm');await showAttachments();await page.getByRole('button',{name:`Visualizar ${video.fileName}`}).click();const player=page.locator('.media-preview[role=dialog] video');
    await page.waitForFunction(()=>{const v=document.querySelector('.media-preview[role=dialog] video');return v?.readyState>=1&&v.duration>1.8;});assert.ok(await player.evaluate(v=>v.duration>1.8),'duração de fixture WebM local');
    await player.evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('.media-preview[role=dialog] video')?.currentTime>0.1,{timeout:5000});const advanced=await player.evaluate(v=>{const t=v.currentTime;v.pause();return t;});assert.ok(advanced>0.1,'play avança corrente de vídeo');await page.screenshot({path:path.join(artifacts,'media-preview-video-frame.png')});
    await page.waitForFunction(()=>document.querySelector('.media-preview[role=dialog] video')?.paused===true);const stopped=await player.evaluate(v=>v.currentTime);await page.waitForFunction(before=>{const v=document.querySelector('.media-preview[role=dialog] video');return Boolean(v?.paused&&Math.abs(v.currentTime-before)<0.08);},stopped,{timeout:1000});assert.ok(Math.abs(await player.evaluate(v=>v.currentTime)-stopped)<0.08,'pause interrompe corrente');
    await player.evaluate(v=>{v.currentTime=1.2});await page.waitForFunction(()=>Math.abs(document.querySelector('.media-preview[role=dialog] video').currentTime-1.2)<0.15);assert.ok(await player.evaluate(v=>v.controls),'player nativo fornece controles');
    const videoRange=await page.evaluate(async name=>{const r=await fetch(`caderno-asset://${name}`,{headers:{Range:'bytes=100-199'}});return {status:r.status,size:(await r.arrayBuffer()).byteLength};},video.storedName);assert.deepEqual(videoRange,{status:206,size:100},'seek usa resposta parcial real');await page.keyboard.press('Escape');
    const broken=items.find(a=>a.fileName==='corrupt.pdf');await showAttachments();await page.getByRole('button',{name:`Visualizar ${broken.fileName}`}).click();await page.getByRole('alert').filter({hasText:/Não foi possível abrir este PDF/}).waitFor();await page.keyboard.press('Escape');
    const brokenPath=path.join(userData,'attachments',broken.storedName);fs.unlinkSync(brokenPath);await showAttachments();await page.getByRole('button',{name:`Visualizar ${broken.fileName}`}).click();await page.getByRole('alert').waitFor();await page.keyboard.press('Escape');fs.copyFileSync(path.join(root,'tests/fixtures/media/corrupt.pdf'),brokenPath);
    await showAttachments();await page.locator('.title-input').fill('Etapa 1C QA editada');await page.getByRole('button',{name:'Visualizar two-pages.pdf'}).click();await page.keyboard.press('Escape');
    await waitForNote('Etapa 1C QA editada',()=>true);assert.equal((await invoke('notes:get',{id:noteId})).title,'Etapa 1C QA editada','edição é autosalva e continua na mesma nota com viewer acessível');
    await page.setViewportSize({width:900,height:560});await showAttachments();await page.getByRole('button',{name:'Visualizar two-pages.pdf'}).click();await canvas.waitFor();await settlePdfPaint({page:1,label:'Page One'});
    const bounds=await page.locator('.media-preview[role=dialog]').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};});assert.ok(bounds.x>=0&&bounds.y>=40&&bounds.right<=900&&bounds.bottom<=560,`PDF viewer não sobrepõe caption em 900x560: ${JSON.stringify(bounds)}`);
    await captureCompositedPdf(path.join(artifacts,'media-preview-light-900x560.png'),{page:1,label:'Page One'});await page.locator('.media-preview[role=dialog]').getByRole('button',{name:'Próxima página'}).click();await settlePdfPaint({page:2,label:'Page Two'});await captureCompositedPdf(path.join(artifacts,'media-preview-light-page-two-900x560.png'),{page:2,label:'Page Two'});await page.keyboard.press('Escape');await page.getByTitle('Alternar tema').click();await showAttachments();await page.getByRole('button',{name:'Visualizar two-pages.pdf'}).click();await canvas.waitFor();await settlePdfPaint({page:1,label:'Page One'});await captureCompositedPdf(path.join(artifacts,'media-preview-dark-900x560.png'),{page:1,label:'Page One'});await page.locator('.media-preview[role=dialog]').getByRole('button',{name:'Próxima página'}).click();await settlePdfPaint({page:2,label:'Page Two'});await captureCompositedPdf(path.join(artifacts,'media-preview-dark-page-two-900x560.png'),{page:2,label:'Page Two'});await page.locator('.media-preview[role=dialog]').getByRole('button',{name:'Página anterior'}).click();await page.getByTitle('Alternar tema').evaluate(el=>el.click());await page.locator('.media-preview[role=dialog]').getByRole('button',{name:'Ampliar zoom'}).click();await page.keyboard.press('Escape');await page.setViewportSize({width:1200,height:780});
  });
  await check('real keyboard autosave keeps editor, caret and undo history stable', async () => {
    await page.locator('.new-note').click();
    const title = page.locator('.title-input');
    await title.fill('Digitação real QA');
    await title.press('Tab');
    await waitForNote('Digitação real QA', n => n.contentHtml === '');
    const beforeTyping = (await invoke('app:qa-ipc-counts'))['notes:update'] ?? 0;
    const body = page.locator('.tiptap');
    await body.click();
    await page.keyboard.type('Primeira frase preservada. ', { delay: 55 });
    await page.waitForFunction(async baseline => {
      const result = await window.cadernoDesktop.invoke('app:qa-ipc-counts', null);
      return result.ok && (result.data['notes:update'] ?? 0) > baseline;
    }, beforeTyping, { timeout: 3000 });
    await page.keyboard.type('Segunda frase após autosave.', { delay: 55 });
    const immediateText = await body.innerText();
    const caret = await page.evaluate(() => ({ active: document.activeElement?.className, offset: getSelection()?.anchorOffset, text: getSelection()?.anchorNode?.textContent }));
    assert.match(immediateText, /Primeira frase preservada\. Segunda frase após autosave\./);
    assert.match(caret.active, /tiptap ProseMirror/);
    assert.ok((caret.offset ?? 0) > 5, `caret mantido após autosave: ${JSON.stringify(caret)}`);
    console.log('TRACE typing caret', JSON.stringify(caret), 'text=', immediateText);
    await page.screenshot({ path: path.join(artifacts, 'typing-during-autosave.png') });
    const counts = await invoke('app:qa-ipc-counts');
    assert.ok((counts['notes:update'] ?? 0) - beforeTyping < 3, `não salvou por tecla: ${(counts['notes:update'] ?? 0) - beforeTyping} updates`);
    await page.waitForTimeout(850);
    assert.match(await body.innerText(), /Primeira frase preservada\. Segunda frase após autosave\./);
    await body.press('Control+Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await page.keyboard.type('[meio] ', { delay: 60 });
    await page.waitForTimeout(850);
    const inserted = await body.innerText();
    assert.match(inserted, /^Pr\[meio\] imeira frase/);
    const saved = await waitForNote('Digitação real QA', n => n.contentHtml.includes('[meio]'));
    assert.match(saved.contentHtml, /Pr\[meio\] imeira frase preservada/);
    await title.fill('Título teclado independente');
    await title.press('Tab');
    await waitForNote('Título teclado independente', n => n.contentHtml.includes('[meio]'));
    await body.click(); await body.press('Control+Z');
    await body.press('Control+Y');
    assert.match(await body.innerText(), /\[meio\]/);
    const note = (await invoke('notes:list', { view: 'all' })).find(n => n.title === 'Título teclado independente');
    await page.reload(); await openTitle('Título teclado independente');
    assert.match(await page.locator('.tiptap').innerText(), /Pr\[meio\] imeira frase preservada/);
    await page.screenshot({ path: path.join(artifacts, 'typing-after-reload.png') });
    assert.match((await invoke('notes:get', { id: note.id })).contentHtml, /\[meio\]/);
  });
  await check('title focus, blur flush and rapid note switch preserve both notes', async () => {
    await page.locator('.new-note').click();
    await page.waitForFunction(() => document.querySelector('.title-input')?.value === '');
    await page.locator('.title-input').fill('Troca rápida A');
    await page.locator('.tiptap').fill('corpo A antes do debounce');
    await page.locator('.new-note').click();
    await page.waitForFunction(() => document.querySelector('.title-input')?.value === '');
    await page.locator('.title-input').fill('Troca rápida B');
    await page.locator('.tiptap').fill('corpo B');
    await page.locator('.title-input').press('Enter');
    await page.waitForFunction(() => { const el = document.querySelector('.tiptap'); return el === document.activeElement || el?.contains(document.activeElement); });
    assert.equal(await page.locator('.tiptap').evaluate(el => el === document.activeElement || el.contains(document.activeElement)), true);
    await waitForNote('Troca rápida A', n => n.contentHtml.includes('corpo A antes do debounce'));
    await waitForNote('Troca rápida B', n => n.contentHtml.includes('corpo B'));
  });
  await check('editor toolbar: headings, marks, lists, checklist, quote, code, link, undo/redo', async () => {
    const openLinkMenu=()=>page.locator('.toolbar-menu summary[title="Mais ferramentas"]').evaluate(el=>{if(!el.parentElement.open)el.click();});
    const editor = page.locator('.tiptap'); await editor.click(); await editor.fill('formatacao');
    await editor.press('Control+A'); await page.getByRole('button', { name: 'Título 1' }).click();
    await editor.locator('h1').waitFor();
    await page.getByRole('button', { name: 'Título 2' }).click(); await editor.locator('h2').waitFor();
    await page.getByRole('button', { name: 'Título 3' }).click(); await editor.locator('h3').waitFor();
    await editor.click(); await editor.press('Control+A'); await page.getByRole('button', { name: 'Negrito (Ctrl+B)' }).click();
    await editor.locator('strong').waitFor();
    await page.getByRole('button', { name: 'Itálico (Ctrl+I)' }).click(); await editor.locator('em').waitFor();
    await page.getByRole('button', { name: 'Lista com marcadores' }).click(); await editor.locator('ul').waitFor();
    await page.getByRole('button', { name: 'Lista numerada' }).click(); await editor.locator('ol').waitFor();
    await page.getByRole('button', { name: 'Checklist' }).click(); await editor.locator('ul[data-type="taskList"]').waitFor();
    await page.getByRole('button', { name: 'Citação' }).click(); await editor.locator('blockquote').waitFor();
    await page.getByRole('button', { name: 'Bloco de código' }).click(); await editor.locator('pre').waitFor();
    await page.getByRole('button', { name: 'Desfazer' }).click(); await page.getByRole('button', { name: 'Refazer' }).click();
    await page.locator('.new-note').click();
    await page.waitForFunction(() => document.querySelector('.title-input')?.value === '');
    await page.locator('.title-input').fill('Link funcional QA');
    const linkEditor = page.locator('.tiptap'); await linkEditor.fill('texto selecionado para link'); await linkEditor.press('Control+A');
    await openLinkMenu(); await page.locator('.editor-toolbar').getByRole('button', { name: 'Link', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Inserir link' }); await dialog.waitFor();
    await dialog.getByLabel('Endereço do link').fill('javascript:alert(1)'); await dialog.getByRole('button', { name: 'Salvar' }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(await linkEditor.locator('a').count(), 0, 'URL não segura não cria link');
    await dialog.getByLabel('Endereço do link').fill('https://example.test/path'); await dialog.getByRole('button', { name: 'Salvar' }).click();
    await linkEditor.locator('a[href="https://example.test/path"]').waitFor();
    let savedLink = await waitForNote('Link funcional QA', n => n.contentHtml.includes('href="https://example.test/path"'));
    assert.match(savedLink.contentHtml, /<a[^>]+href="https:\/\/example\.test\/path"/);
    await page.reload(); await openTitle('Link funcional QA');
    const reopenedEditor = page.locator('.tiptap'); await reopenedEditor.locator('a[href="https://example.test/path"]').waitFor();
    await reopenedEditor.click(); await reopenedEditor.press('Control+A'); await openLinkMenu(); await page.locator('.editor-toolbar').getByRole('button', { name: 'Link', exact: true }).click();
    const removeDialog = page.getByRole('dialog', { name: 'Inserir link' });
    await removeDialog.getByRole('button', { name: 'Remover link' }).click();
    await reopenedEditor.locator('a').waitFor({ state: 'detached' });
    await waitForNote('Link funcional QA', n => !n.contentHtml.includes('<a'));
    await reopenedEditor.fill('cancelamento mantém texto'); await reopenedEditor.press('Control+A');
    await openLinkMenu(); await page.locator('.editor-toolbar').getByRole('button', { name: 'Link', exact: true }).click();
    const cancelDialog = page.getByRole('dialog', { name: 'Inserir link' });
    await cancelDialog.getByLabel('Endereço do link').fill('https://nao-aplicar.test');
    await cancelDialog.getByRole('button', { name: 'Cancelar' }).click();
    assert.equal(await reopenedEditor.locator('a').count(), 0);
    await page.waitForFunction(() => document.activeElement === document.querySelector('.tiptap'));
    savedLink = await waitForNote('Link funcional QA', n => n.contentHtml.includes('cancelamento mantém texto'));
    assert.doesNotMatch(savedLink.contentHtml, /nao-aplicar\.test/);
    await page.locator('.editor-toolbar').getByRole('button', { name: 'Link', exact: true }).click();
    await page.getByRole('dialog', { name: 'Inserir link' }).press('Escape');
    await page.getByRole('dialog', { name: 'Inserir link' }).waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement === document.querySelector('.tiptap'));
    await page.locator('.editor-toolbar').getByRole('button', { name: 'Link', exact: true }).click();
    await page.locator('.overlay').click({ position: { x: 2, y: 2 } });
    await page.getByRole('dialog', { name: 'Inserir link' }).waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement === document.querySelector('.tiptap'));
  });
  await check('stack UI create/move/collapse/duplicate/rename/delete keeps notebooks', async () => {
    await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click();
    await page.getByRole('button', { name: 'Criar caderno' }).click();
    const input = page.getByPlaceholder('Nome do caderno'); await input.fill('Stack fixture'); await input.press('Enter');
    await page.getByRole('button', { name: 'Criar pilha' }).click();
    await page.getByRole('dialog', { name: 'Criar pilha' }).locator('#stack-name').fill('Organização QA');
    await page.getByRole('dialog', { name: 'Criar pilha' }).getByRole('button', { name: 'Criar' }).click();
    const heading = name => page.locator('.stack-heading').filter({ has: page.getByText(name, { exact: true }) });
    await heading('Organização QA').waitFor();
    const stackId = (await invoke('stacks:list')).find(s => s.name === 'Organização QA').id;
    const stackSelect = page.getByLabel('Pilha de Stack fixture');
    await page.locator('[data-menu-item]').filter({ hasText: 'Stack fixture' }).first().hover(); await stackSelect.dispatchEvent('click'); await page.getByRole('menuitemradio', { name: 'Organização QA', exact: true }).click(); await page.getByRole('button', { name: 'Recolher Organização QA' }).click();
    await page.getByLabel('Pilha de Stack fixture').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Expandir Organização QA' }).click();
    await page.getByLabel('Pilha de Stack fixture').waitFor();
    await page.getByRole('button', { name: 'Duplicar pilha Organização QA' }).click();
    await page.getByRole('dialog', { name: 'Duplicar pilha' }).locator('#stack-name').fill('Organização QA (cópia)');
    await page.getByRole('dialog', { name: 'Duplicar pilha' }).getByRole('button', { name: 'Criar' }).click();
    await heading('Organização QA (cópia)').waitFor();
    await page.getByLabel('Pilha de Stack fixture').dispatchEvent('click'); assert.equal(await page.getByRole('menuitemradio', { name: 'Organização QA', exact: true }).getAttribute('aria-checked'), 'true', 'duplicar não move cadernos'); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Renomear pilha Organização QA', exact: true }).click();
    await page.getByRole('dialog', { name: 'Renomear pilha' }).locator('#stack-name').fill('Organização renomeada');
    await page.getByRole('dialog', { name: 'Renomear pilha' }).getByRole('button', { name: 'Salvar' }).click();
    await heading('Organização renomeada').waitFor();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: 'Excluir pilha Organização renomeada' }).click();
    await heading('Organização renomeada').waitFor({ state: 'detached' });
    assert.equal((await invoke('notebooks:list')).some(n => n.name === 'Stack fixture'), true, 'excluir pilha preserva caderno');
    await page.getByLabel('Pilha de Stack fixture').dispatchEvent('click'); assert.equal(await page.getByRole('menuitemradio', { name: 'Sem pilha' }).getAttribute('aria-checked'), 'true', 'caderno fica sem pilha'); await page.keyboard.press('Escape');
    page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Excluir pilha Organização QA (cópia)' }).click();
    await heading('Organização QA (cópia)').waitFor({ state: 'detached' });
    const fixtureNotebook = (await invoke('notebooks:list')).find(n => n.name === 'Stack fixture');
    await invoke('notebooks:delete', { id: fixtureNotebook.id }); await page.reload();
  });
  await check('internal note links persist by UUID, survive rename, navigate and report trashed targets', async () => {
    const openTools=async()=>page.locator('.toolbar-menu summary[title="Mais ferramentas"]').evaluate(el=>{if(!el.parentElement.open)el.click();});
    const target = await invoke('notes:create', { title: 'Destino interno QA', contentHtml: '<p>alvo estável</p>' });
    const source = await invoke('notes:create', { title: 'Origem interna QA', contentHtml: '<p>origem</p>' });
    await page.reload(); await openTitle('Origem interna QA');
    const editor = page.locator('.tiptap'); await editor.click(); await editor.press('Control+End');
    await openTools(); await page.getByRole('button', { name: 'Link para nota' }).click();
    const dialog = page.getByRole('dialog', { name: 'Vincular nota' });
    await dialog.getByRole('combobox', { name: 'Buscar nota', exact: true }).fill('Destino interno QA');
    await dialog.getByRole('option').filter({ hasText: 'Destino interno QA' }).click();
    await dialog.getByRole('button', { name: 'Inserir link' }).click();
    const href = `caderno-note://${target.id}`;
    await editor.locator(`a[href="${href}"]`).waitFor();
    await waitForNote('Origem interna QA', n => n.contentHtml.includes(href));
    await editor.click(); await editor.press('Control+A');
    await openTools(); await page.getByRole('button', { name: 'Link para nota' }).click();
    await page.getByRole('dialog', { name: 'Vincular nota' }).getByRole('button', { name: 'Cancelar' }).click();
    await editor.locator(`a[href="${href}"]`).waitFor();
    await openTools(); await page.locator('.editor-toolbar').getByRole('button', { name: 'Link', exact: true }).click();
    const removeLinkDialog = page.getByRole('dialog', { name: 'Inserir link' });
    await removeLinkDialog.getByRole('button', { name: 'Remover link' }).click();
    await editor.locator(`a[href="${href}"]`).waitFor({ state: 'detached' });
    await editor.press('Control+Z'); await editor.locator(`a[href="${href}"]`).waitFor();
    await waitForNote('Origem interna QA', n => n.contentHtml.includes(href));
    await page.reload(); await openTitle('Origem interna QA');
    await page.locator(`.tiptap a[href="${href}"]`).waitFor();
    await page.locator(`.tiptap a[href="${href}"]`).click();
    await page.waitForFunction(()=>document.querySelector('.title-input')?.value==='Destino interno QA');
    assert.equal(await page.locator('.title-input').inputValue(), 'Destino interno QA');
    await page.locator('.title-input').fill('Destino renomeado QA'); await page.locator('.title-input').press('Tab');
    await waitForNote('Destino renomeado QA', n => n.id === target.id);
    await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click(); await openTitle('Origem interna QA');
    await page.locator(`.tiptap a[href="${href}"]`).click();
    await page.waitForFunction(()=>document.querySelector('.title-input')?.value==='Destino renomeado QA');
    assert.equal(await page.locator('.title-input').inputValue(), 'Destino renomeado QA', 'UUID continua apontando após renomear');
    await page.getByTitle('Mover para a lixeira').click();
    await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click(); await openTitle('Origem interna QA');
    await page.locator(`.tiptap a[href="${href}"]`).click();
    await page.getByText(/está na lixeira/).waitFor();
    await page.locator('.sidebar').getByRole('button', { name: /Lixeira/ }).click(); await openTitle('Destino renomeado QA');
    await page.getByRole('button', { name: 'Restaurar' }).click();
    assert.equal((await invoke('notes:get', { id: target.id })).deletedAt, null);
    assert.ok((await invoke('notes:get', { id: source.id })).contentHtml.includes(href));
  });
  await check('notebook create/duplicate/rename/move/delete and tag attach/filter/detach', async () => {
    await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click(); await openTitle('Funcional 001');
    await page.getByRole('button', { name: 'Criar caderno' }).click();
    const nbInput = page.getByPlaceholder('Nome do caderno'); await nbInput.fill('Projetos QA'); await nbInput.press('Enter');
    await page.getByRole('button', { name: /^Projetos QA(?: \d+)?$/ }).waitFor();
    await page.getByRole('button', { name: 'Criar caderno' }).click(); await nbInput.fill('Projetos QA'); await nbInput.press('Enter');
    await page.getByRole('alert').filter({ hasText: 'Já existe' }).waitFor();
    const nb = (await invoke('notebooks:list')).find(x => x.name === 'Projetos QA'); assert.ok(nb);
    await page.getByLabel('Caderno da nota').selectOption(String(nb.id));
    await page.getByRole('button', { name: /^Projetos QA(?: \d+)?$/ }).click();
    await page.locator('.notebook-stack-row').filter({ hasText: 'Projetos QA' }).hover();
    await page.getByRole('button', { name: 'Renomear Projetos QA', exact: true }).click();
    const rename = page.locator('.sidebar input').last(); await rename.fill('Projetos QA 2'); await rename.press('Enter');
    const renamed = (await invoke('notebooks:list')).find(x => x.name === 'Projetos QA 2'); assert.ok(renamed);
    await page.getByRole('button', { name: /^Projetos QA 2(?: \d+)?$/ }).click(); await openTitle('Funcional 001');
    await page.getByRole('button', { name: 'Etiquetas', exact: true }).click(); const tagInput = page.getByPlaceholder('Buscar ou criar etiqueta…');
    await tagInput.fill('qa-flow'); await page.getByRole('button', { name: 'Criar “qa-flow”', exact: true }).click();
    await page.getByRole('button', { name: 'Etiquetas', exact: true }).click();
    const tagId = (await invoke('tags:list')).find(x => x.name === 'qa-flow').id;
    await page.locator('.sidebar').getByRole('button', { name: /qa-flow/ }).click(); assert.ok((await noteRows().count()) >= 1);
    await openTitle('Funcional 001');
    await page.getByRole('button', { name: 'Etiquetas', exact: true }).click(); await page.getByRole('button', { name: 'Remover etiqueta qa-flow desta nota', exact: true }).click();
    await page.getByRole('button', { name: /^Projetos QA 2(?: \d+)?$/ }).click();
    await page.locator('.notebook-stack-row').filter({ hasText: 'Projetos QA 2' }).hover();
    await page.getByRole('button', { name: 'Excluir Projetos QA 2', exact: true }).click();
    assert.equal((await invoke('notebooks:list')).some(x => x.id === renamed.id), false);
    assert.ok(tagId > 0);
  });
  await check('favorite/pin/filter/order/search title-body-empty-no-results', async () => {
    await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click(); await openTitle('Funcional 001');
    await page.getByTitle('Marcar como favorita').click(); await page.getByTitle('Fixar no topo').click();
    await page.getByRole('button', { name: 'Favoritas' }).click(); assert.ok(await noteRows().count() >= 1);
    await page.getByLabel('Ordenar').selectOption('title_asc');
    const search = page.getByPlaceholder('Buscar notas…');
    await search.fill('Funcional 001'); assert.equal(await noteRows().count(), 1);
    await search.fill('corpo gravado'); assert.equal(await noteRows().count(), 1);
    await search.fill('Funcional type:note after:2000-01-01'); assert.equal(await noteRows().count(), 1);
    await clearBanners();
    await page.setViewportSize({width:900,height:560}); await page.screenshot({path:path.join(artifacts,'search-results-light-900x560.png')});
    await page.getByTitle('Alternar tema').click(); await page.screenshot({path:path.join(artifacts,'search-results-dark-900x560.png')}); await page.getByTitle('Alternar tema').click(); await page.setViewportSize({width:1200,height:780});
    await search.fill('sem resultado'); await page.waitForFunction(() => document.querySelectorAll('.note-row').length === 0); assert.equal(await noteRows().count(), 0);
    await search.fill('   '); await page.waitForFunction(() => document.querySelectorAll('.note-row').length >= 1); assert.ok(await noteRows().count() >= 1);
  });
  await check('trash soft delete, restore, purge confirmation cancel/accept, empty cancel/accept', async () => {
    await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click(); await openTitle('Funcional 001');
    await page.getByTitle('Mover para a lixeira').click(); await page.getByRole('button', { name: 'Lixeira' }).click();
    await openTitle('Funcional 001'); await page.getByRole('button', { name: 'Restaurar' }).click();
    await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click(); await openTitle('Funcional 001'); await page.getByTitle('Mover para a lixeira').click();
    await page.getByRole('button', { name: 'Lixeira' }).click(); await openTitle('Funcional 001');
    page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name: 'Excluir definitivamente' }).click();
    assert.equal((await invoke('notes:list', { view: 'trash' })).length, 1);
    page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Excluir definitivamente' }).click();
    assert.equal((await invoke('notes:list', { view: 'trash' })).length, 0);
    await page.locator('.new-note').click(); await page.locator('.title-input').fill('Esvaziar QA');
    await page.getByTitle('Mover para a lixeira').click(); await page.getByRole('button', { name: 'Lixeira' }).click();
    page.once('dialog', d => d.dismiss()); await page.getByRole('button', { name: 'Esvaziar lixeira' }).click();
    assert.equal((await invoke('notes:list', { view: 'trash' })).length, 1);
    page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Esvaziar lixeira' }).click();
    assert.equal((await invoke('notes:list', { view: 'trash' })).length, 0);
  });
  await check('theme persistence, Markdown import/export and backup save/restore invalid/cancel/valid', async () => {
    if(await page.locator('html').getAttribute('data-theme')!=='light')await page.getByTitle('Alternar tema').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='light');await page.getByTitle('Alternar tema').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='dark');assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    const themeDeadline=Date.now()+2000; while(Date.now()<themeDeadline && await invoke('theme:get')!=='dark') await new Promise(resolve=>setTimeout(resolve,20));
    await page.reload();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='dark');assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.getByTitle('Alternar tema').click();
    await page.getByRole('button', { name: 'Mais ações' }).click(); await page.getByRole('menuitem', { name: 'Importar Markdown' }).click();
    const md = path.join(runDir, 'fixture.md'); fs.writeFileSync(md, '# Import QA\n\nTexto markdown real.');
    await page.locator('input[type=file][accept=".md,.markdown,.txt"]').setInputFiles(md);
    await page.getByText(/nota\(s\) importada/).waitFor(); await openTitle('Import QA');
    const saveFile = path.join(runDir, 'export.md');
    await app.evaluate(() => { globalThis.__qa.saveResult = { canceled: true }; });
    await page.getByTitle('Exportar em Markdown').click();
    assert.equal(fs.existsSync(saveFile), false, 'export cancelado não cria arquivo');
    await app.evaluate(() => { globalThis.__qa.saveResult = { canceled: false, filePath: process.env.CADERNO_QA_EXPORT }; });
    await page.getByTitle('Exportar em Markdown').click();
    await waitForFile(saveFile);
    assert.match(fs.readFileSync(saveFile, 'utf8'), /Texto markdown real/);
    const backupPath = path.join(runDir, 'backup.json');
    await page.getByRole('button', { name: 'Mais ações' }).click(); await page.getByRole('menuitem', { name: 'Salvar backup' }).click();
    await waitForFile(backupPath).catch(async () => {
      await app.evaluate(() => { globalThis.__qa.saveResult = { canceled: false, filePath: process.env.CADERNO_QA_BACKUP }; });
      await page.getByRole('button', { name: 'Mais ações' }).click(); await page.getByRole('menuitem', { name: 'Salvar backup' }).click();
      await waitForFile(backupPath);
    });
    const saved = JSON.parse(fs.readFileSync(backupPath, 'utf8')); assert.ok(saved.notes.some(n => n.title === 'Import QA'));
    const before = (await invoke('notes:list', { view: 'all' })).length;
    await app.evaluate(() => { globalThis.__qa.openResult = { canceled: true, filePaths: [] }; });
    await app.evaluate(() => { globalThis.__qa.saveResult = { canceled: true }; });
    const priorBackup = fs.readFileSync(backupPath, 'utf8');
    await page.getByRole('button', { name: 'Mais ações' }).click(); await page.getByRole('menuitem', { name: 'Salvar backup' }).click();
    assert.equal(fs.readFileSync(backupPath, 'utf8'), priorBackup, 'backup cancelado preserva o destino anterior');
    page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Mais ações' }).click(); await page.getByRole('menuitem', { name: 'Restaurar backup' }).click();
    assert.equal((await invoke('notes:list', { view: 'all' })).length, before);
    await app.evaluate(() => { globalThis.__qa.openResult = { canceled: false, filePaths: [process.env.CADERNO_QA_INVALID] }; });
    fs.writeFileSync(path.join(runDir, 'invalid.json'), '{"nope":true}');
    page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Mais ações' }).click(); await page.getByRole('menuitem', { name: 'Restaurar backup' }).click();
    await page.getByText(/Backup inválido, nada foi alterado/).waitFor(); assert.equal((await invoke('notes:list', { view: 'all' })).length, before);
    await page.getByRole('button', { name: /Backup inválido/ }).click().catch(() => {});
    await app.evaluate(() => { globalThis.__qa.openResult = { canceled: false, filePaths: [process.env.CADERNO_QA_BACKUP] }; });
    page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Mais ações' }).click(); await page.getByRole('menuitem', { name: 'Restaurar backup' }).click();
    await page.getByText(/Backup restaurado/).waitFor();
    await app.evaluate(() => { globalThis.__qa.openResult = { canceled: true, filePaths: [] }; });
  });
  await check('attachments add/list/open/remove with OS shell boundary mocked and bytes on disk', async () => {
    await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click(); await openTitle('Import QA');
    await page.getByTitle('Anexos', { exact: true }).click(); await page.locator('.attach-pop').waitFor();
    const fixture = path.join(runDir, 'anexo.txt'); fs.writeFileSync(fixture, 'bytes de anexo qa');
    await page.getByRole('menuitem', { name: 'Adicionar arquivo' }).click();
    await page.locator('input[type=file][multiple]').first().setInputFiles(fixture);
    await page.getByTitle('Abrir arquivo').waitFor();
    const attachment = (await invoke('attachments:list', { noteId: (await invoke('notes:list', { view: 'all' })).find(n => n.title === 'Import QA').id }))[0];
    const stored = path.join(userData, 'attachments', attachment.storedName);
    assert.equal(fs.readFileSync(stored, 'utf8'), 'bytes de anexo qa');
    await app.evaluate(() => { globalThis.__qa.saveResult = { canceled: false, filePath: process.env.CADERNO_QA_BACKUP }; });
    await page.getByRole('button', { name: 'Mais ações' }).click(); await page.getByRole('menuitem', { name: 'Salvar backup' }).click();
    await page.getByText(/Backup completo salvo em/).waitFor();
    const backupPayload = JSON.parse(fs.readFileSync(path.join(runDir, 'backup.json'), 'utf8'));
    assert.equal(backupPayload.schemaVersion, 9, 'backup versão 9 inclui pastas, mídia, tarefas, calendário, fontes do Clipper, transcrições, modelos e marcações de PDF');
    assert.ok(Array.isArray(backupPayload.folders));
    assert.ok(backupPayload.attachments.some(a => a.storedName === attachment.storedName), 'backup carrega bytes do anexo');
    const imageAttachment=(await invoke('attachments:list',{noteId:(await invoke('notes:list',{view:'all'})).find(n=>n.title==='Tabela QA').id}))[0];
    assert.ok(backupPayload.attachments.some(a=>a.storedName===imageAttachment.storedName&&a.kind==='image'&&a.sha256),'backup inclui imagem com hash');
    await app.evaluate(() => { globalThis.__qa.openResult = { canceled: false, filePaths: [process.env.CADERNO_QA_BACKUP] }; });
    page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Mais ações' }).click(); await page.getByRole('menuitem', { name: 'Restaurar backup' }).click();
    await page.getByText(/Backup restaurado/).waitFor();
    assert.equal((await invoke('attachments:list', { noteId: attachment.noteId })).length, 1, 'restauração preserva metadado de anexo existente');
    assert.equal(fs.readFileSync(stored, 'utf8'), 'bytes de anexo qa', 'restauração preserva o binário vinculado');
    await app.evaluate(() => { globalThis.__qa.openResult = { canceled: true, filePaths: [] }; });
    await page.getByTitle('Anexos', { exact: true }).click();
    await page.getByTitle('Abrir arquivo').click();
    assert.equal(await app.evaluate(() => globalThis.__qa.openPath), stored);
    await app.evaluate(() => { globalThis.__qa.openError = 'arquivo indisponível'; });
    await page.getByTitle('Abrir arquivo').click(); await page.getByText(/Não foi possível abrir o anexo/).waitFor();
    assert.equal(fs.existsSync(stored), true, 'erro do shell preserva o arquivo anexado');
    await app.evaluate(() => { globalThis.__qa.openError = ''; });
    fs.unlinkSync(stored);
    await page.getByTitle('Abrir arquivo').click(); await page.getByText(/Arquivo de anexo ausente/).waitFor();
    assert.equal((await invoke('attachments:list', { noteId: attachment.noteId })).length, 1, 'arquivo ausente não remove o registro');
    fs.writeFileSync(stored, 'bytes de anexo qa');
    page.once('dialog', d => d.dismiss()); await page.getByTitle('Remover').click();
    assert.equal(fs.existsSync(stored), true, 'cancelar remoção preserva o anexo');
    page.once('dialog', d => d.accept()); await page.getByTitle('Remover').click();
    await page.getByTitle('Abrir arquivo').waitFor({ state: 'detached' }); assert.equal(fs.existsSync(stored), false);
  });
  await check('deterministic UI ordering updated desc/asc, created desc and title A-Z', async () => {
    const fixtures = [
      ['00000000-0000-4000-8000-000000000101', 'Ordem Charlie', 1000, 9000],
      ['00000000-0000-4000-8000-000000000102', 'Ordem Alpha', 3000, 7000],
      ['00000000-0000-4000-8000-000000000103', 'Ordem Bravo', 2000, 8000],
    ];
    const fixtureCode = `const DB=require('better-sqlite3');const db=new DB(${JSON.stringify(path.join(userData, 'caderno.sqlite'))});const insert=db.prepare('INSERT INTO notes(id,title,created_at,updated_at) VALUES(?,?,?,?)');for(const row of ${JSON.stringify(fixtures)})insert.run(...row);db.close();`;
    const fixtureRun = spawnSync(electronBin, ['-e', fixtureCode], { cwd: root, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    assert.equal(fixtureRun.status, 0, `fixtures SQLite determinísticas: ${fixtureRun.stderr}`);
    await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click();
    await page.getByPlaceholder('Buscar notas…').fill('Ordem');
    const sort = page.getByLabel('Ordenar');
    const sequence = async (order, expected) => {
      await sort.selectOption(order);
      await page.waitForFunction(expected => {
        const rows = [...document.querySelectorAll('.note-row .tt')].map(el => el.textContent);
        return rows.length === expected.length && expected.every((title, i) => rows[i] === title);
      }, expected);
      return await page.locator('.note-row .tt').allTextContents();
    };
    const recent = await sequence('updated_desc', ['Ordem Charlie','Ordem Bravo','Ordem Alpha']);
    assert.deepEqual(recent, ['Ordem Charlie','Ordem Bravo','Ordem Alpha']);
    assert.deepEqual(await sequence('updated_asc', ['Ordem Alpha','Ordem Bravo','Ordem Charlie']), ['Ordem Alpha','Ordem Bravo','Ordem Charlie']);
    assert.deepEqual(await sequence('created_desc', ['Ordem Alpha','Ordem Bravo','Ordem Charlie']), ['Ordem Alpha','Ordem Bravo','Ordem Charlie']);
    assert.deepEqual(await sequence('title_asc', ['Ordem Alpha','Ordem Bravo','Ordem Charlie']), ['Ordem Alpha','Ordem Bravo','Ordem Charlie']);
  });
  await check('cancelled Markdown picker and real export/backup filesystem write failures preserve data', async () => {
    await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click(); await openTitle('Import QA');
    const beforeRows = (await invoke('notes:list', { view: 'all' })).map(n => n.id);
    const beforeSelected = await page.locator('.title-input').inputValue();
    await page.getByRole('button', { name: 'Mais ações' }).click();
    await page.getByRole('menuitem', { name: 'Importar Markdown' }).click();
    await page.locator('input[type=file][accept=".md,.markdown,.txt"]').dispatchEvent('cancel');
    await page.waitForTimeout(100);
    assert.deepEqual((await invoke('notes:list', { view: 'all' })).map(n => n.id), beforeRows);
    assert.equal(await page.locator('.title-input').inputValue(), beforeSelected);

    await app.evaluate(() => { globalThis.__qa.saveResult = { canceled: false, filePath: process.env.CADERNO_USER_DATA }; });
    await page.getByTitle('Exportar em Markdown').click();
    await page.getByRole('alert').filter({ hasText: /Falha ao exportar/ }).waitFor();
    assert.deepEqual((await invoke('notes:list', { view: 'all' })).map(n => n.id), beforeRows);
    await clearBanners();

    const backupPath = path.join(runDir, 'backup.json');
    const previousBackup = fs.readFileSync(backupPath, 'utf8');
    await app.evaluate(() => { globalThis.__qa.saveResult = { canceled: false, filePath: process.env.CADERNO_USER_DATA }; });
    await page.getByRole('button', { name: 'Mais ações' }).click(); await page.getByRole('menuitem', { name: 'Salvar backup' }).click();
    await page.getByText(/Falha no backup:/).waitFor();
    assert.equal(fs.readFileSync(backupPath, 'utf8'), previousBackup);
    assert.deepEqual((await invoke('notes:list', { view: 'all' })).map(n => n.id), beforeRows);
    await clearBanners();
    await app.evaluate(() => { globalThis.__qa.saveResult = { canceled: false, filePath: process.env.CADERNO_QA_EXPORT }; });
  });
  await check('local EML import creates sanitized note, real attachment bytes, deduplicates and preserves on cancel/error', async () => {
    const before=(await invoke('notes:list',{view:'all'})).length;
    await app.evaluate(()=>{globalThis.__qa.openResult={canceled:true,filePaths:[]};});
    await page.getByRole('button',{name:'Mais ações'}).click();await page.getByRole('menuitem',{name:'Importar e-mail (.eml)'}).click();
    await page.waitForTimeout(80);assert.equal((await invoke('notes:list',{view:'all'})).length,before,'cancelar seletor não cria nota');
    await app.evaluate(()=>{globalThis.__qa.openResult={canceled:false,filePaths:[process.env.CADERNO_QA_EML]};});
    await page.getByRole('button',{name:'Mais ações'}).click();await page.getByRole('menuitem',{name:'Importar e-mail (.eml)'}).click();
    await page.getByText(/1 e-mail\(s\) importado\(s\)/).waitFor();const imported=await waitForNote('E-mail de teste',n=>n.contentHtml.includes('Conteúdo EML'));
    assert.doesNotMatch(imported.contentHtml,/script|tracker\.invalid/i,'HTML hostil/remoto foi removido');
    const assets=await invoke('attachments:list',{noteId:imported.id});assert.equal(assets.length,1);const stored=path.join(userData,'attachments',assets[0].storedName);assert.deepEqual([...fs.readFileSync(stored)],[1,2,3,4],'anexo base64 gravado com bytes originais');
    const count=(await invoke('notes:list',{view:'all'})).length;
    await page.getByRole('button',{name:'Mais ações'}).click();await page.getByRole('menuitem',{name:'Importar e-mail (.eml)'}).click();await page.getByText(/0 e-mail\(s\) importado\(s\), 1 duplicado\(s\)/).waitFor();
    assert.equal((await invoke('notes:list',{view:'all'})).length,count,'Message-ID evita segunda nota');
    const invalid=path.join(runDir,'invalid.eml');fs.mkdirSync(invalid);
    await app.evaluate(()=>{globalThis.__qa.openResult={canceled:false,filePaths:[process.env.CADERNO_QA_INVALID_EML]};});
    const failedImport=await invoke('import:eml',{notebookId:null});assert.match(failedImport.errors.join(' '),/invalid\.eml/,'falha por arquivo é retornada à interface');assert.equal(failedImport.created,0);
    assert.equal((await invoke('notes:list',{view:'all'})).length,count,'arquivo inválido não deixa nota parcial');
  });
  await check('recording uses explicit action, pause/resume/stop saves decodable local audio and playback controls work', async () => {
    const note=await invoke('notes:create',{title:'Áudio 4A',contentHtml:''});await page.reload();await openTitle('Áudio 4A');
    const trigger=page.getByRole('button',{name:'Gravar áudio nesta nota'});await page.setViewportSize({width:900,height:560});
    await trigger.click();await page.screenshot({path:path.join(artifacts,'audio-recorder-light-900x560.png')});await page.getByRole('group',{name:'Gravação de áudio'}).getByRole('button',{name:'Iniciar'}).waitFor();
    await page.getByTitle('Alternar tema').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='dark');await page.screenshot({path:path.join(artifacts,'audio-recorder-dark-900x560.png')});await page.getByTitle('Alternar tema').click();await page.waitForFunction(()=>document.documentElement.getAttribute('data-theme')==='light');
    const panel=page.getByRole('group',{name:'Gravação de áudio'});
    await page.evaluate(()=>{window.__qaNativeGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__qaGetUserMediaCalls=0;navigator.mediaDevices.getUserMedia=()=>{window.__qaGetUserMediaCalls++;return Promise.reject(new DOMException('denied','NotAllowedError'));};});
    assert.equal(await page.evaluate(()=>window.__qaGetUserMediaCalls),0,'abrir controles não solicita permissão antes da ação explícita');
    await panel.getByRole('button',{name:'Iniciar'}).click();await panel.getByRole('alert').filter({hasText:'Permissão do microfone negada'}).waitFor();
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>{window.__qaGetUserMediaCalls++;return Promise.reject(new DOMException('no device','NotFoundError'));};});
    await panel.getByRole('button',{name:'Iniciar'}).click();await panel.getByRole('alert').filter({hasText:'Verifique se há um dispositivo disponível'}).waitFor();
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{window.__qaGetUserMediaCalls++;window.__qaCapturedStream=await window.__qaNativeGetUserMedia({audio:true});return window.__qaCapturedStream;};});
    await panel.getByRole('button',{name:'Iniciar'}).click();await panel.getByRole('button',{name:'Pausar'}).waitFor();
    // MediaRecorder emits the first partial chunk on the 500 ms timeslice; let it arrive before simulating disconnect.
    await page.waitForTimeout(700);
    await page.evaluate(()=>window.__qaCapturedStream.getAudioTracks()[0].dispatchEvent(new Event('ended')));
    await panel.getByRole('alert').filter({hasText:'dispositivo de áudio foi desconectado'}).waitFor();await panel.getByRole('button',{name:'Descartar'}).waitFor();await panel.getByRole('button',{name:'Descartar'}).click();
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=window.__qaNativeGetUserMedia;delete window.__qaCapturedStream;});
    await panel.getByRole('button',{name:'Iniciar'}).click();await panel.getByRole('button',{name:'Cancelar'}).click();assert.equal((await invoke('attachments:list',{noteId:note.id})).length,0,'cancelar descarta captura');
    await panel.getByRole('button',{name:'Iniciar'}).click();await panel.getByRole('button',{name:'Pausar'}).waitFor();
    await panel.getByRole('button',{name:'Pausar'}).click();await panel.getByRole('button',{name:'Retomar'}).click();await page.waitForTimeout(1300);
    await panel.getByRole('button',{name:'Parar'}).click();await panel.getByRole('button',{name:'Salvar na nota'}).waitFor();
    await panel.getByRole('button',{name:'Salvar na nota'}).click();await page.getByText(/Salvo/).waitFor().catch(()=>{});
    const items=await invoke('attachments:list',{noteId:note.id}),audio=items.find(x=>x.mimeType?.startsWith('audio/'));assert.ok(audio,'gravação vira attachment áudio');
    const disk=path.join(userData,'attachments',audio.storedName),payload=fs.readFileSync(disk);assert.ok(payload.length>1000,'bytes WebM reais persistidos');assert.equal(audio.mimeType,'audio/webm');
    await page.getByTitle('Anexos', { exact: true }).click();await page.getByRole('button',{name:'Visualizar '+audio.fileName}).click();
    const player=page.locator('.media-preview audio');await player.waitFor();await page.waitForFunction(el=>Number.isFinite(el.duration)&&el.duration>0,await player.elementHandle());
    const duration=await player.evaluate(el=>el.duration);assert.ok(Number.isFinite(duration)&&duration>0,'duração do WebM decodifica: '+duration);
    await player.evaluate(el=>el.play());await page.waitForFunction(el=>el.currentTime>0.15,await player.elementHandle());const pos=await player.evaluate(el=>el.currentTime);await player.evaluate(el=>el.pause());await page.waitForTimeout(250);assert.ok(Math.abs(await player.evaluate(el=>el.currentTime)-pos)<0.1,'pause mantém posição');
    await player.evaluate(el=>{el.currentTime=Math.min(0.5,el.duration/2)});await page.waitForTimeout(100);assert.ok(await player.evaluate(el=>el.currentTime>0.1),'seek do áudio');
    await page.keyboard.press('Escape');await app.evaluate(()=>{globalThis.__qa.saveResult={canceled:false,filePath:process.env.CADERNO_QA_BACKUP};});await page.getByRole('button',{name:'Mais ações'}).click();await page.getByRole('menuitem',{name:'Salvar backup'}).click();await page.getByText(/Backup completo salvo em/).waitFor();
    const backup=JSON.parse(fs.readFileSync(path.join(runDir,'backup.json'),'utf8'));assert.ok(backup.attachments.some(a=>a.mimeType==='audio/webm'),'backup serializa bytes do áudio');assert.ok(backup.notes.some(n=>n.title==='E-mail de teste'),'backup inclui nota EML');
    await openTitle('Áudio 4A');assert.equal((await invoke('attachments:list',{noteId:note.id})).filter(x=>x.mimeType==='audio/webm').length,1,'attachment áudio sobrevive reabrir nota');await page.setViewportSize({width:1200,height:780});
  });
  await check('Mais ações, etiquetas et anexos popovers dismiss on Escape/outside and restore focus', async () => {
    await page.locator('.toolbar-menu[open] summary').evaluateAll(els=>els.forEach(el=>el.click()));
    const cases = [
      { trigger: page.getByRole('button', { name: 'Mais ações' }), menu: page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Importar Markdown' }) }) },
      { trigger: page.getByTitle('Etiquetas', { exact: true }), menu: page.locator('.tag-pop') },
      { trigger: page.getByTitle('Anexos', { exact: true }), menu: page.locator('.attach-pop') },
    ];
    for (const { trigger, menu } of cases) {
      await trigger.click(); await menu.waitFor(); await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
      await page.waitForFunction(el => el === document.activeElement, await trigger.elementHandle());assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Escape retorna foco ao trigger');
      await trigger.click(); await menu.waitFor(); await page.locator('.editor-pane').click({ position: { x: 500, y: 300 } });
      await menu.waitFor({ state: 'detached' });
    }
  });
  await check('restart persistence + layout geometry at 1440x900 and 900x560 both themes', async () => {
    await page.locator('.new-note').click();
    await page.waitForFunction(() => document.querySelector('.title-input')?.value === '');
    const longTitle = 'T'.repeat(280);
    await page.locator('.title-input').fill(longTitle);
    await page.locator('.tiptap').fill('W'.repeat(2400));
    await waitForNote(longTitle, n => n.contentHtml.length > 2000);
    if (await page.locator('.attach-pop').count()) await page.getByTitle('Anexos', { exact: true }).click();
    await page.locator('.editor-scroll').evaluate(el => { el.scrollTop = 0; });
    const longNotebook = ('Caderno extremamente longo '.repeat(10)).slice(0, 115).trim();
    const longTag = ('Etiqueta extremamente longa '.repeat(10)).slice(0, 75).trim();
    const createdNotebook = await invoke('notebooks:create', { name: longNotebook });
    const createdTag = await invoke('tags:create', { name: longTag });
    const visualNote = (await invoke('notes:list', { view: 'all' })).find(n => n.title === 'Import QA');
    await invoke('notes:move', { id: visualNote.id, notebookId: createdNotebook.id });
    await invoke('tags:attach', { noteId: visualNote.id, tagId: createdTag.id });
    await page.reload(); await openTitle('Import QA');
    for (const theme of ['light', 'dark']) {
      await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click(); await openTitle('Import QA');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
      await page.setViewportSize({ width: 1440, height: 900 });
      if ((await page.locator('html').getAttribute('data-theme')) !== theme) await page.getByTitle('Alternar tema').click();
      await page.waitForFunction(expected => document.documentElement.getAttribute('data-theme') === expected, theme);
      await page.locator('.error-bar button').click().catch(() => {});
      await page.locator('.editor-scroll').evaluate(el => { el.scrollTop = 0; });
      await assertMoreMenuGeometry(1440, 900, path.join(artifacts, `menu-${theme}-1440x900.png`));
      await page.evaluate(() => { window.focus(); return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))); });
      const visible = await page.evaluate(() => Object.fromEntries(['.sidebar','.notelist','.editor-toolbar','.title-input','.editor-status'].map(s => {
        const e = document.querySelector(s), r = e?.getBoundingClientRect();
        return [s, !!e && !!r && r.width > 0 && r.height > 0 && getComputedStyle(e).visibility === 'visible'];
      })));
      assert.deepEqual(visible, { '.sidebar': true, '.notelist': true, '.editor-toolbar': true, '.title-input': true, '.editor-status': true }, `todos paineis visiveis em ${theme}`);
      await assertToolbarClearsCaption(1440, theme);
      await page.screenshot({ path: path.join(artifacts, `${theme}-1440x900.png`) });
      const measure = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert.ok(measure.sw <= measure.cw, `horizontal overflow 1440 ${theme}: ${JSON.stringify(measure)}`);
      assert.equal(await page.locator('.note-row').first().evaluate(el => el.scrollWidth <= el.clientWidth), true, 'long title/preview overflows note row');
      await page.getByTitle('Etiquetas', { exact: true }).click();
      const tagBox = await page.locator('.tag-pop').boundingBox();
      assert.ok(tagBox && tagBox.x >= 0 && tagBox.x + tagBox.width <= 1440, `popover etiqueta fora da viewport ${JSON.stringify(tagBox)}`);
      await page.keyboard.press('Escape');
      const sidebarNameBox = await page.locator('.sidebar [data-menu-item]').filter({ hasText: longNotebook.slice(0, 15) }).boundingBox();
      assert.ok(sidebarNameBox && sidebarNameBox.x + sidebarNameBox.width <= 1440, 'nome longo do caderno não invade outros controles');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 560));
      await page.setViewportSize({ width: 900, height: 560 });
      await page.waitForFunction(() => innerWidth === 900 && innerHeight === 560);
      await page.evaluate(async () => {
        await document.fonts.ready;
        document.querySelector('.sidebar').scrollTop = 0;
        document.querySelector('.editor-scroll').scrollTop = 0;
        window.scrollTo(0, 0);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      });
      await assertMoreMenuGeometry(900, 560, path.join(artifacts, `menu-${theme}-900x560.png`));
      const compactRects = await page.evaluate(prefix => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const longNotebook = [...document.querySelectorAll('.sidebar [data-menu-item]')].find(el => el.textContent.includes(prefix));
        const r = longNotebook.getBoundingClientRect();
        return { brand: box('.brand'), toolbar: box('.editor-toolbar'), status: box('.editor-status'), notebook: { x: r.x, y: r.y, width: r.width, height: r.height }, notebookSelect: box('.status-select') };
      }, longNotebook.slice(0, 16));
      assert.ok(compactRects.brand.y >= 0 && compactRects.brand.height > 0, `marca cortada em 900x560: ${JSON.stringify(compactRects)}`);
      assert.ok(compactRects.toolbar.y >= 0 && compactRects.toolbar.height >= 25, `toolbar cortada em 900x560: ${JSON.stringify(compactRects)}`);
      await assertToolbarClearsCaption(900, theme);
      assert.ok(compactRects.status.y + compactRects.status.height <= 561, `status fora do viewport em 900x560: ${JSON.stringify(compactRects)}`);
      assert.ok(compactRects.notebook.x >= 0 && compactRects.notebook.x + compactRects.notebook.width <= 900, `caderno longo invade controles em 900x560: ${JSON.stringify(compactRects.notebook)}`);
      assert.ok(compactRects.notebookSelect.x >= 0 && compactRects.notebookSelect.x + compactRects.notebookSelect.width <= 900, `select de caderno longo fora do viewport: ${JSON.stringify(compactRects.notebookSelect)}`);
      await page.screenshot({ path: path.join(artifacts, `${theme}-900x560.png`) });
      const compact = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      assert.ok(compact.sw <= compact.cw, `horizontal overflow 900 ${theme}: ${JSON.stringify(compact)}`);
      await page.getByTitle('Etiquetas', { exact: true }).click();
      const compactTagBox = await page.locator('.tag-pop').boundingBox();
      assert.ok(compactTagBox && compactTagBox.x >= 0 && compactTagBox.x + compactTagBox.width <= 900 && compactTagBox.y >= 0 && compactTagBox.y + compactTagBox.height <= 560, `popover etiqueta fora da viewport compacta ${JSON.stringify(compactTagBox)}`);
      await page.keyboard.press('Escape');
      await page.getByTitle('Anexos', { exact: true }).click();
      const attachBox = await page.locator('.attach-pop').boundingBox();
      assert.ok(attachBox && attachBox.x >= 0 && attachBox.x + attachBox.width <= 900 && attachBox.y >= 0 && attachBox.y + attachBox.height <= 560, `popover anexo fora da viewport compacta ${JSON.stringify(attachBox)}`);
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button',{name:'Configurações',exact:true}).click();await page.getByRole('button',{name:/Indexação de anexos/}).click();const queuedCount=await page.getByRole('button',{name:'Reindexar anexos'}).count();assert.ok(queuedCount,'reindex manual disponível no painel de jobs');await page.getByRole('button',{name:'Reindexar anexos'}).click();const queued=(await invoke('attachments:jobs')).find(j=>j.status==='queued');assert.ok(queued,'reindexação manual coloca jobs na fila');recoveryJobId=queued.id;const queuedRow=page.locator('.attachment-jobs > div').filter({hasText:queued.fileName});await queuedRow.getByRole('button',{name:'Cancelar'}).click();await page.getByRole('button',{name:'Configurações',exact:true}).click();const canceled=(await invoke('attachments:jobs')).find(j=>j.id===recoveryJobId);assert.equal(canceled?.status,'cancel_requested','cancelamento real pela interface persiste no SQLite');
    const queuedScan=(await invoke('attachments:jobs')).find(j=>j.fileName==='ocr-scan-two-pages.pdf'&&j.status==='queued');assert.ok(queuedScan,'reindex colocou fixture OCR na fila persistida');const cancelScan=await invoke('attachments:cancel-job',{id:queuedScan.id});assert.equal(cancelScan,true);const orderCode=`const DB=require('better-sqlite3');const db=new DB(${JSON.stringify(path.join(userData,'caderno.sqlite'))});db.prepare('UPDATE attachment_jobs SET created_at=-1 WHERE id=?').run(${queuedScan.id});db.close();`;const orderResult=spawnSync(electronBin,['-e',orderCode],{cwd:root,encoding:'utf8',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});assert.equal(orderResult.status,0,`fixture de fila OCR para reinício: ${orderResult.stderr}`);recoveryOcrJobId=queuedScan.id;
    await page.setViewportSize({ width: 1200, height: 780 });
    await app.close(); app = null;
    const firstCloseProcess = fs.readFileSync(processEvidence,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)).filter(entry=>entry.label==='profile'&&entry.event==='electron-process-close').at(-1);
    assert.deepEqual({code:firstCloseProcess?.code,signal:firstCloseProcess?.signal},{code:0,signal:null},'OCR cancellation + Electron restart fecha o processo filho normalmente');
    const firstCloseLifecycle=fs.readFileSync(path.join(userData,'lifecycle.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
    assert.equal(firstCloseLifecycle.some(entry=>entry.event==='uncaughtException'),false,'fechamento e restart não geram exceção de lifecycle');
    app = await electron.launch({ executablePath: electronBin, args: [root], env: launchEnv() });observeElectron(app,'profile-restart');
    page = await app.firstWindow(); await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).waitFor();
    const recoveredJobs=await invoke('attachments:jobs');assert.ok(recoveredJobs.find(j=>j.id===recoveryJobId)?.status!=='cancel_requested','restart recupera job pendente para fila ativa');let restartedOcr;for(let i=0;i<300;i++){restartedOcr=(await invoke('attachments:jobs')).find(j=>j.id===recoveryOcrJobId);if(restartedOcr?.status==='completed'||restartedOcr?.status==='error')break;await page.waitForTimeout(100);}assert.equal(restartedOcr?.status,'completed',`restart retoma OCR PDF enfileirado: ${restartedOcr?.error}`);assert.ok((await invoke('notes:list',{view:'all',query:'SCAN PAGE ONE type:attachment'})).some(n=>n.id===recoveryOcrNoteId),'texto OCR volta à busca após reinício do perfil local');let settledJobs;for(let i=0;i<1800;i++){settledJobs=await invoke('attachments:jobs');if(settledJobs.every(j=>!['queued','running','cancel_requested'].includes(j.status)))break;await page.waitForTimeout(100);}assert.ok(settledJobs.every(j=>!['queued','running','cancel_requested'].includes(j.status)),`reindexação após restart ainda tem jobs ativos: ${JSON.stringify(settledJobs.filter(j=>['queued','running','cancel_requested'].includes(j.status)))}`);
    await openTitle('Import QA'); assert.match(await page.locator('.tiptap').innerText(), /Texto markdown real/);
    await openTitle('Título teclado independente');
    assert.match(await page.locator('.tiptap').innerText(), /Pr\[meio\] imeira frase preservada/);
    const keyboardNote = (await invoke('notes:list', { view: 'all' })).find(n => n.title === 'Título teclado independente');
    assert.match((await invoke('notes:get', { id: keyboardNote.id })).contentHtml, /Segunda frase após autosave/);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await app.close();app=await electron.launch({executablePath:electronBin,args:[root],env:launchEnv(restoredProfile)});observeElectron(app,'restored-profile');page=await app.firstWindow();await page.getByRole('button',{name:/^Notas(?: \d+)?$/}).waitFor();
    await app.evaluate(({dialog,shell})=>{globalThis.__qa={openPath:null,openError:'',openResult:{canceled:false,filePaths:[process.env.CADERNO_QA_BACKUP]},saveResult:{canceled:true}};dialog.showOpenDialog=async()=>globalThis.__qa.openResult;dialog.showSaveDialog=async()=>globalThis.__qa.saveResult;shell.openPath=async()=>'';});
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Mais ações'}).click();await page.getByRole('menuitem',{name:'Restaurar backup'}).click();await page.getByText(/Backup restaurado/).waitFor();
    await openTitle('Etapa 1C QA editada');const restoredNote=(await invoke('notes:list',{view:'all'})).find(n=>n.title==='Etapa 1C QA editada');const restoredMedia=await invoke('attachments:list',{noteId:restoredNote.id});
    assert.equal(restoredMedia.filter(a=>a.mimeType==='application/pdf'||a.mimeType==='text/html'||a.mimeType==='video/webm').length,10,'backup v5 restaura mídia de preview e fixtures HTML/PDF/OCR em perfil limpo');
    for(const item of restoredMedia)assert.ok(fs.existsSync(path.join(restoredProfile,'attachments',item.storedName)),`asset restaurado: ${item.fileName}`);
    const restoredNotes=await invoke('notes:list',{view:'all'}),emlNote=restoredNotes.find(n=>n.title==='E-mail de teste'),audioNote=restoredNotes.find(n=>n.title==='Áudio 4A');assert.ok(emlNote&&audioNote,'backup restaura notas de e-mail e gravação');const restoredEmlAssets=await invoke('attachments:list',{noteId:emlNote.id}),restoredAudio=(await invoke('attachments:list',{noteId:audioNote.id})).find(a=>a.mimeType==='audio/webm');assert.equal(restoredEmlAssets.length,1);assert.ok(restoredAudio&&fs.statSync(path.join(restoredProfile,'attachments',restoredAudio.storedName)).size>1000,'bytes reais de áudio regravados no restore limpo');
    await app.evaluate(()=>{globalThis.__qa.openResult={canceled:false,filePaths:[process.env.CADERNO_QA_EML]};});const restoredDuplicate=await invoke('import:eml',{notebookId:null});assert.equal(restoredDuplicate.duplicates,1,'dedupe Message-ID sobrevive ao backup/restore');
    await page.getByTitle('Anexos', { exact: true }).click();await page.getByRole('button',{name:'Visualizar two-pages.pdf'}).click();await page.locator('#media-pdf-canvas').waitFor();await page.keyboard.press('Escape');
    await app.close();app=await electron.launch({executablePath:electronBin,args:[root],env:launchEnv(restoredProfile)});observeElectron(app,'restored-profile-restart');page=await app.firstWindow();await page.getByRole('button',{name:/^Notas(?: \d+)?$/}).waitFor();
    await openTitle('Etapa 1C QA editada');const afterRestart=(await invoke('attachments:list',{noteId:restoredNote.id})).find(a=>a.fileName==='two-pages.pdf');assert.ok(afterRestart&&fs.existsSync(path.join(restoredProfile,'attachments',afterRestart.storedName)),'mídia do backup continua após restart do perfil limpo');
    await page.getByTitle('Anexos', { exact: true }).click();await page.getByRole('button',{name:'Visualizar two-pages.pdf'}).click();await page.locator('#media-pdf-canvas').waitFor();await page.keyboard.press('Escape');
  });
  await check('local tasks CRUD/reminder dedupe, event range validation, UI and profile-local persistence', async()=>{
    const note=(await invoke('notes:list',{view:'all'}))[0],now=Date.now(),duplicateNote=await invoke('notes:create',{title:(await invoke('notes:get',{id:(await invoke('notes:list',{view:'all'}))[0].id})).title,contentHtml:''});
    const todayNoon=new Date();todayNoon.setHours(12,0,0,0);const taskId=await invoke('tasks:create',{noteId:note.id,title:'QA tarefa hoje',dueAt:todayNoon.getTime(),reminderAt:now-1000});
    const dueRows=await invoke('tasks:reminder-due');assert.ok(dueRows.some(t=>t.id===taskId),'lembrete vencido entregue');assert.equal((await invoke('tasks:reminder-due')).some(t=>t.id===taskId),false,'reinicialização/poll seguinte não duplica entrega');
    assert.ok((await invoke('tasks:list',{filter:'today'})).some(t=>t.id===taskId));await invoke('tasks:update',{id:taskId,done:true});assert.ok((await invoke('tasks:list',{filter:'completed'})).some(t=>t.id===taskId));await invoke('tasks:update',{id:taskId,done:false});
    const overdueId=await invoke('tasks:create',{noteId:note.id,title:'QA tarefa atrasada',dueAt:now-3*86400000,reminderAt:null});assert.ok((await invoke('tasks:list',{filter:'overdue'})).some(t=>t.id===overdueId));
    const eventId=await invoke('events:create',{noteId:note.id,title:'QA evento semana',description:'fixture',startAt:now,endAt:now+3600000,timeZone:'America/Sao_Paulo',allDay:false});assert.ok((await invoke('events:list',{startAt:now-1000,endAt:now+7200000})).some(e=>e.id===eventId));
    const dayStart=new Date();dayStart.setHours(0,0,0,0);const nextDay=new Date(dayStart);nextDay.setDate(nextDay.getDate()+1);const allDayId=await invoke('events:create',{noteId:null,title:'QA evento dia inteiro',description:'',startAt:dayStart.getTime(),endAt:nextDay.getTime()-1,timeZone:'America/Sao_Paulo',allDay:true});assert.equal((await invoke('events:list',{startAt:now,endAt:now})).find(e=>e.id===allDayId)?.allDay,true);
    const bad=await windowCall('events:create',{noteId:null,title:'Inválido',description:'',startAt:now+1,endAt:now,timeZone:'UTC',allDay:false});assert.equal(bad.ok,false,'fim anterior ao início é recusado');
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'Tarefas'}).click();await page.locator('header').getByRole('button',{name:'Hoje'}).waitFor();assert.ok(await page.getByText('QA tarefa hoje').count());
    await page.getByRole('button',{name:'Todas'}).click();const newTaskButton=page.getByRole('button',{name:'Nova tarefa'});assert.match(await page.evaluate(()=>{try{window.prompt('guard')}catch(e){return e.message}}),/prompt.*not supported/,'runtime Electron falha com prompt not supported');await newTaskButton.click();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Nova tarefa'}).waitFor({state:'detached'});assert.equal(await newTaskButton.evaluate(el=>el===document.activeElement),true,'Escape cancela e devolve foco');await newTaskButton.click();await page.locator('.overlay').click({position:{x:4,y:4}});await page.getByRole('dialog',{name:'Nova tarefa'}).waitFor({state:'detached'});await page.waitForFunction(el=>el===document.activeElement,await newTaskButton.elementHandle());assert.equal(await newTaskButton.evaluate(el=>el===document.activeElement),true,'clique fora cancela e devolve foco');await newTaskButton.click();const taskDialog=page.getByRole('dialog',{name:'Nova tarefa'});await taskDialog.waitFor();await page.getByLabel('Título').fill('UI tarefa associada');await page.getByLabel('Buscar nota').fill(note.title);await page.locator(`.note-picker-results [data-note-id="${note.id}"]`).click();const taskTimes=await page.evaluate(()=>{const d=new Date(Date.now()+86400000),e=new Date(Date.now()+90000000);const val=x=>new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,16);return [val(d),val(e)]});await page.getByLabel('Prazo', { exact: true }).fill(taskTimes[0]);await page.getByLabel('Lembrete', { exact: true }).fill(taskTimes[1]);await taskDialog.getByRole('button',{name:'Salvar tarefa'}).click();await taskDialog.waitFor({state:'detached'});assert.equal(await newTaskButton.evaluate(el=>el===document.activeElement),true,'fechar formulário devolve foco ao iniciador');const uiTask=(await invoke('tasks:list',{filter:'all'})).find(t=>t.title==='UI tarefa associada');assert.ok(uiTask);assert.equal(uiTask.noteId,note.id);assert.ok(uiTask.dueAt&&uiTask.reminderAt);await page.locator('.agenda-list article').filter({hasText:'UI tarefa associada'}).getByRole('button',{name:'Editar'}).click();await page.getByRole('dialog',{name:'Editar tarefa'}).waitFor();await page.getByLabel('Título').fill('UI tarefa editada');await page.getByLabel('Buscar nota').fill(note.title);await page.locator(`.note-picker-results [data-note-id="${duplicateNote.id}"]`).click();await page.getByRole('button',{name:'Salvar tarefa'}).click();await page.getByText('UI tarefa editada').waitFor();await page.locator('.agenda-list article').filter({hasText:'UI tarefa editada'}).getByRole('checkbox').check();assert.equal((await invoke('tasks:list',{filter:'completed'})).find(t=>t.id===uiTask.id).noteId,duplicateNote.id,'edição troca nota por UUID apesar do título duplicado');await page.locator('.agenda-list article').filter({hasText:'UI tarefa editada'}).getByRole('checkbox').uncheck();assert.equal((await invoke('tasks:list',{filter:'all'})).find(t=>t.id===uiTask.id).done,false,'tarefa reabre pela interface');await page.locator('.agenda-list article').filter({hasText:'UI tarefa editada'}).getByRole('button',{name:'Abrir nota'}).click();await page.locator('.title-input').waitFor();assert.equal(await page.locator('.title-input').inputValue(),note.title,'abrir tarefa navega para nota selecionada');await page.getByRole('button',{name:'Tarefas'}).click();await page.getByRole('button',{name:'Todas'}).click();await page.locator('.agenda-list article').filter({hasText:'UI tarefa editada'}).waitFor();await page.locator('.agenda-list article').filter({hasText:'UI tarefa editada'}).getByRole('button',{name:'Excluir'}).click();assert.ok(!(await invoke('tasks:list',{filter:'all'})).some(t=>t.id===uiTask.id));
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(900,560));await page.setViewportSize({width:900,height:560});
    await page.getByRole('button',{name:'Calendário'}).click();await page.locator('.calendar-grid').waitFor();const targetDayLabel=await page.evaluate(v=>new Date(v).toLocaleDateString(),taskTimes[0]);const targetDayIndex=await page.locator('.calendar-grid [role=gridcell]').evaluateAll((cells,label)=>cells.findIndex(cell=>cell.getAttribute('aria-label')?.startsWith(label)),targetDayLabel);assert.ok(targetDayIndex>=0,'dia para criar evento existe na grade');await page.locator('.calendar-grid [role=gridcell]').nth(targetDayIndex).click();if(await page.locator('.overlay').isVisible().catch(()=>false)){await page.keyboard.press('Escape');await page.locator('.overlay').waitFor({state:'detached'});}await page.locator('.agenda-actions').getByRole('button',{name:'Novo evento'}).click();await page.getByRole('dialog',{name:'Novo evento'}).waitFor();await page.getByRole('button',{name:'Salvar evento'}).click();assert.match(await page.getByRole('alert').innerText(),/título/i,'título vazio é validado no formulário');await page.getByLabel('Título').fill('UI evento inválido');await page.getByLabel('Fuso horário IANA').fill('America/New_York');await page.getByLabel('Início').fill('2026-10-30T12:00');await page.getByLabel('Fim').fill('2026-10-30T11:00');await page.getByRole('button',{name:'Salvar evento'}).click();assert.match(await page.getByRole('alert').innerText(),/fim deve ser posterior/i,'fim anterior é validado no formulário');await page.getByLabel('Início').fill('2026-03-08T02:30');await page.getByLabel('Fim').fill('2026-03-08T03:30');await page.getByRole('button',{name:'Salvar evento'}).click();await page.getByRole('alert').filter({hasText:'horário local não existe'}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Novo evento'}).waitFor({state:'detached'});await page.locator('.agenda-actions').getByRole('button',{name:'Novo evento'}).click();await page.getByRole('dialog',{name:'Novo evento'}).waitFor();await page.getByLabel('Título').fill('UI evento completo');await page.getByLabel('Descrição').fill('Descrição do evento criada no DOM');await page.getByLabel('Início').fill(taskTimes[0]);await page.getByLabel('Fim').fill(taskTimes[1]);await page.getByLabel('Fuso horário IANA').fill('America/Sao_Paulo');await page.getByLabel('Buscar nota (opcional)').fill(note.title);await page.locator(`.note-picker-results [data-note-id="${note.id}"]`).click();await page.getByRole('button',{name:'Salvar evento'}).click();await page.getByRole('dialog',{name:'Novo evento'}).waitFor({state:'detached'});const uiEvent=(await invoke('events:list',{startAt:Date.now(),endAt:Date.now()+3*86400000})).find(e=>e.title==='UI evento completo');assert.ok(uiEvent);assert.equal(uiEvent.noteId,note.id);assert.equal(uiEvent.description,'Descrição do evento criada no DOM');await page.locator('.agenda-list article').filter({hasText:'UI evento completo'}).getByRole('button',{name:'Editar'}).click();await page.getByRole('dialog',{name:'Editar evento'}).waitFor();assert.equal(await page.getByLabel('Fuso horário IANA').inputValue(),'America/Sao_Paulo');assert.equal(await page.getByLabel('Início').inputValue(),taskTimes[0],'edição preserva valor local do início');assert.equal(await page.getByLabel('Fim').inputValue(),taskTimes[1],'edição preserva valor local do fim');await page.getByLabel('Título').fill('UI evento editado');await page.getByLabel('Buscar nota (opcional)').fill(note.title);await page.locator(`.note-picker-results [data-note-id="${duplicateNote.id}"]`).click();await page.getByRole('button',{name:'Salvar evento'}).click();await page.locator('.agenda-list article').filter({hasText:'UI evento editado'}).waitFor();assert.equal((await invoke('events:list',{startAt:Date.now()-86400000,endAt:Date.now()+3*86400000})).find(e=>e.id===uiEvent.id).noteId,duplicateNote.id,'edição de evento resolve nota por UUID com título duplicado');await page.locator('.agenda-actions').getByRole('button',{name:'Próximo'}).click();await page.locator('.agenda-actions').getByRole('button',{name:'Anterior'}).click();await page.locator('.agenda-actions').getByRole('button',{name:'Hoje'}).click();
    for(const theme of ['light','dark']){if(await page.locator('html').getAttribute('data-theme')!==theme)await page.getByTitle('Alternar tema').click();await page.waitForFunction(t=>document.documentElement.getAttribute('data-theme')===t,theme);await page.getByRole('button',{name:'Tarefas'}).click();await page.getByRole('button',{name:'Todas'}).click();await page.getByText('QA tarefa hoje').waitFor();await page.screenshot({path:path.join(artifacts,`tasks-${theme}-900x560.png`)});await page.getByRole('button',{name:'Calendário'}).click();await page.locator('.agenda-list article').filter({hasText:'UI evento editado'}).waitFor();assert.equal((await invoke('events:list',{startAt:Date.now()-86400000,endAt:Date.now()+3*86400000})).find(e=>e.id===uiEvent.id).noteId,duplicateNote.id,'edição de evento resolve nota por UUID com título duplicado');await page.screenshot({path:path.join(artifacts,`calendar-${theme}-900x560.png`)});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,900));await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(artifacts,`calendar-${theme}-1440x900.png`)});await page.getByRole('button',{name:'Tarefas'}).click();await page.getByRole('button',{name:'Todas'}).click();await page.screenshot({path:path.join(artifacts,`tasks-${theme}-1440x900.png`)});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(900,560));await page.setViewportSize({width:900,height:560});await page.getByRole('button',{name:'Calendário'}).click();await page.locator('.agenda select').selectOption('week');await page.locator('.calendar-grid.week').waitFor();await page.locator('.agenda select').selectOption('month');}
    await page.locator('.agenda-list article').filter({hasText:'UI evento editado'}).getByRole('button',{name:'Excluir'}).click();assert.ok(!(await invoke('events:list',{startAt:Date.now()-86400000,endAt:Date.now()+3*86400000})).some(e=>e.id===uiEvent.id),'evento excluído pela interface');await invoke('events:delete',{id:eventId});await invoke('events:delete',{id:allDayId});await invoke('tasks:delete',{id:taskId});await invoke('tasks:delete',{id:overdueId});
  });
  assert.deepEqual(hostileRequests,[],'nenhuma tentativa remota do HTML sai do app');
  assert.deepEqual(runtimeErrors, [], 'sem erros não tratados no renderer');
  const lifecycleEvidence=fs.readFileSync(path.join(userData,'lifecycle.jsonl'),'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  const workerExits=lifecycleEvidence.filter(entry=>entry.event==='attachment-worker-exit').map(entry=>({jobId:entry.details.jobId,code:entry.details.code,resultHandled:entry.details.resultHandled,stopping:entry.details.stopping}));
  assert.ok(workerExits.length>=30,`stress OCR executou múltiplos processos isolados: ${workerExits.length}`);
  assert.ok(workerExits.every(exit=>(exit.resultHandled&&(exit.code===0||exit.code===2))||(exit.stopping&&exit.code===0)),`processos OCR tiveram resultado ou fechamento de shutdown recuperado no restart: ${JSON.stringify(workerExits.filter(exit=>!exit.resultHandled||![0,2].includes(exit.code)))}`);
  assert.ok(workerExits.some(exit=>exit.code===2),'processo cancelado terminou com código esperado após publicar estado cancelado');
  assert.equal(lifecycleEvidence.some(entry=>entry.event==='uncaughtException'||entry.event==='render-process-gone'),false,'sem exceções main ou queda do renderer no ciclo OCR/restart');
  const supervisorEvents=fs.readFileSync(processEvidence,'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
  assert.ok(supervisorEvents.some(entry=>entry.event==='electron-process-close'&&entry.label==='profile'&&entry.code===0&&entry.signal===null),'supervisor confirmou processo Electron principal encerrado com código 0 após o restart OCR');
  const stabilityEvidence={runId:path.basename(runDir),finishedAt:new Date().toISOString(),functionalJourneys:results.length,assertions:assertionCount,ocrElapsedMs:JSON.parse(fs.readFileSync(path.join(root,'evidence/performance/pdf-ocr-functional.json'),'utf8')).elapsedMs,workerExits,mainLifecycleEvents:lifecycleEvidence.map(entry=>entry.event),electronProcesses:supervisorEvents.filter(entry=>entry.event==='electron-process-close').map(({label,code,signal})=>({label,code,signal}))};
  fs.writeFileSync(path.join(root,'evidence/performance',`ocr-stability-${path.basename(runDir)}.json`),JSON.stringify(stabilityEvidence,null,2)+'\n');
  console.log(JSON.stringify({ passed: results.length, assertions: assertionCount, results, userData, screenshots: artifacts }, null, 2));
} finally {
  if (app) {logProcess('harness-cleanup-app-close-start');await app.close().catch(error=>logProcess('harness-cleanup-app-close-error',{message:error instanceof Error?error.message:String(error)}));logProcess('harness-cleanup-app-close-complete');}
}
