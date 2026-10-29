// Pairing is automated; capture must be performed by the user through Chrome's action.
import { _electron as electron, chromium } from 'playwright';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const root = process.cwd(), require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-clipper-handoff-'));
let app, context, server, browserClosed = false;
const evidence = path.join(root, 'evidence', 'functional', 'clipper-human-gesture.json');
const diagnosticFile = path.join(root, 'evidence', 'functional', 'clipper-handoff-diagnostics.jsonl');
fs.writeFileSync(diagnosticFile, '');
const diagnostic = event => fs.appendFileSync(diagnosticFile, JSON.stringify({at:new Date().toISOString(),...event})+'\n');
try {
  server = http.createServer((_q, r) => { r.writeHead(200, {'content-type':'text/html; charset=utf-8'}); r.end('<!doctype html><title>Validação Clipper — Caderno</title><article><h1>Teste final do Web Clipper</h1><p>Abra Extensões (ícone de quebra-cabeça), escolha Caderno Web Clipper e clique em Salvar página. Esta página e o Caderno de teste usam perfis temporários.</p><p>Frase de validação: captura humana local confirmada.</p></article>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/fixture`;
  const profile = path.join(tmp, 'app'); fs.mkdirSync(profile);
  const env = {...process.env, CADERNO_USER_DATA:profile}; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({executablePath:require('electron'), args:[root], env});
  const ap = await app.firstWindow();
  await ap.getByTitle('Mais ações').click(); await ap.getByRole('menuitem',{name:'Web Clipper'}).click();
  const dlg = ap.getByRole('dialog',{name:'Web Clipper'});
  await dlg.getByRole('button',{name:'Configurar Clipper'}).click();
  await dlg.getByRole('button',{name:'Gerar código de pareamento'}).click();
  const code = await dlg.locator('strong').innerText(), nonce = await dlg.locator('code').innerText();
  const extension = path.join(root,'extensions','clipper');
  const executablePath = path.join(process.env.LOCALAPPDATA,'ms-playwright','chromium-1234','chrome-win64','chrome.exe');
  assert.ok(fs.existsSync(executablePath),'Chromium de QA não encontrado.');
  context = await chromium.launchPersistentContext(path.join(tmp,'browser'), {executablePath,headless:false, args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('close', () => { browserClosed = true; diagnostic({kind:'browser-closed'}); });
  context.on('response', response => {
    const u = new URL(response.url());
    if (u.hostname === '127.0.0.1' && u.port === '43187') diagnostic({kind:'bridge-response',route:u.pathname,status:response.status()});
  });
  context.on('requestfailed', request => {
    const u = new URL(request.url());
    if (u.hostname === '127.0.0.1' && u.port === '43187') diagnostic({kind:'bridge-failure',route:u.pathname,error:request.failure()?.errorText});
  });
  context.on('page', p => {
    p.on('pageerror', error => diagnostic({kind:'page-error',message:error.message}));
    p.on('domcontentloaded', async () => {
      if (!p.url().startsWith('chrome-extension://')) return;
      diagnostic({kind:'extension-opened'});
      await p.locator('#message').evaluate(element => {
        new MutationObserver(() => console.info('CADERNO_STATUS:'+element.textContent)).observe(element,{childList:true,subtree:true,characterData:true});
      }).catch(()=>{});
    });
    p.on('console', message => {
      if (message.text().startsWith('CADERNO_STATUS:')) diagnostic({kind:'popup-status',message:message.text().slice(15)});
    });
  });
  const page = context.pages()[0]; await page.goto('chrome://extensions/');
  const id = await page.waitForFunction(() => document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list')?.shadowRoot?.querySelector('extensions-item')?.id).then(h => h.jsonValue());
  const pair = await context.newPage(); await pair.goto(`chrome-extension://${id}/popup.html`);
  await pair.locator('#code').fill(code); await pair.locator('#nonce').fill(nonce); await pair.locator('#pairButton').click();
  await pair.waitForFunction(() => chrome.storage.local.get('token').then(x => Boolean(x.token)));
  const commands = await pair.evaluate(() => chrome.commands.getAll());
  diagnostic({kind:'registered-commands',commands});
  console.log('Atalhos registrados:', JSON.stringify(commands));
  await pair.close(); await page.goto(url); await page.bringToFront();
  console.log('READY: Chrome temporário pareado. Abra Extensões (ícone de peça de quebra-cabeça) > Caderno Web Clipper > Salvar página.');
  const deadline = Date.now()+15*60*1000;
  let saved;
  while(Date.now()<deadline) {
    assert.ok(!browserClosed && !page.isClosed(), 'A janela do navegador de teste foi fechada antes da captura.');
    const notes = await ap.evaluate(async () => {const r=await window.cadernoDesktop.invoke('notes:list',{view:'all'});return r.ok?r.data:[];});
    saved=notes.find(n=>n.title==='Validação Clipper — Caderno');
    if(saved) break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert.ok(saved,'Tempo esgotado: captura humana não foi confirmada.');
  const full=await ap.evaluate(async id=>{const r=await window.cadernoDesktop.invoke('notes:get',{id});return r.ok?r.data:null;},saved.id);
  assert.ok(full?.contentHtml.includes('captura humana local confirmada'));
  assert.ok(full.contentHtml.includes(url));
  fs.writeFileSync(evidence, JSON.stringify({passed:true,method:'User native action > activeTab > extension scripting > loopback > SQLite',sourceURL:url,noteTitle:saved.title,temporaryProfiles:true},null,2));
  console.log('PASS: captura real da extensão confirmada no SQLite.');
} catch(error) {
  fs.writeFileSync(evidence,JSON.stringify({passed:false,error:String(error)},null,2));
  throw error;
} finally {
  if(context) await context.close().catch(()=>{});
  if(app) await app.close().catch(()=>{});
  if(server) await new Promise(resolve=>server.close(resolve));
  // Keep the isolated fixture profile for diagnosis; it contains no user data.
}
