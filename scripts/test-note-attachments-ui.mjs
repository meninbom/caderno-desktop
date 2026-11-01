// Jornada de anexos em notas: arrastar arquivos do sistema para a nota, cartões/prévias integrados, recusas e reload.
// Roda DEPOIS do build (usa dist/). Perfil temporário em CADERNO_USER_DATA; nunca toca em %APPDATA%/caderno.
// A queda usa Input.dispatchDragEvent (CDP) com caminhos reais de disco; se o CDP não entregar a queda, cai para DataTransfer sintético.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), root = process.cwd();
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-attach-ui-'));
const filesDir = path.join(runDir, 'arquivos'), shots = path.join(runDir, 'capturas');
fs.mkdirSync(filesDir, { recursive: true }); fs.mkdirSync(shots, { recursive: true });
const env = { ...process.env, CADERNO_USER_DATA: path.join(runDir, 'profile'), CADERNO_QA_IPC: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const media = name => path.join(root, 'tests', 'fixtures', 'media', name);

// ── Fixtures reais e sintéticas ────────────────────────────────────────────────
const fixture = {
  png: path.join(filesDir, 'foto.png'), pdf: path.join(filesDir, 'Relatorio QA.pdf'), html: path.join(filesDir, 'Funil_QA.html'),
  docx: path.join(filesDir, 'relatorio.docx'), webm: path.join(filesDir, 'video.webm'), csv: path.join(filesDir, 'dados.csv'),
  txt: path.join(filesDir, 'notas.txt'), fakePdf: path.join(filesDir, 'falso.pdf'), huge: path.join(filesDir, 'grande.bin'), small: path.join(filesDir, 'extra.txt'),
};
fs.copyFileSync(media('valid.png'), fixture.png); fs.copyFileSync(media('two-pages.pdf'), fixture.pdf); fs.copyFileSync(media('two-seconds.webm'), fixture.webm); fs.copyFileSync(media('corrupt.pdf'), fixture.fakePdf);
// Sem assinatura PDF: o backend recusa o tipo antes de gravar. PDFs com cabeçalho
// válido e estrutura corrompida são aceitos e exibem erro no visualizador (test-functional).
fs.writeFileSync(fixture.fakePdf,'Este arquivo tem extensao pdf mas nao e um PDF.');
fs.writeFileSync(fixture.html, '<!doctype html><html><head><title>Funil</title><style>body{font-family:sans-serif;background:#dde5f2}.c{background:#fff;border-radius:16px;padding:24px;text-align:center}</style></head><body><div class="c"><h1 id="titulo">Bem-vindo!</h1><p>Selecione seu nome acima</p></div><img id="externa" src="https://example.invalid/pixel.png"><script>document.title="x";parent.__executou=true</script></body></html>');
fs.writeFileSync(fixture.docx, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('conteudo sintetico de um docx para QA')]));
fs.writeFileSync(fixture.csv, 'a;b\n1;2\n'); fs.writeFileSync(fixture.txt, 'anotações em texto simples\n'); fs.writeFileSync(fixture.small, 'x');
{ const fd = fs.openSync(fixture.huge, 'w'); const chunk = Buffer.alloc(1024 * 1024); for (let i = 0; i < 51; i++) fs.writeSync(fd, chunk); fs.closeSync(fd); } // 51 MiB > limite de 50 MB

let app, page, cdp, dropMode = 'synthetic', failed = false; const errors = [];
const invoke = (channel, input = null) => page.evaluate(async ({ channel, input }) => {
  const result = await window.cadernoDesktop.invoke(channel, input);
  if (!result.ok) throw new Error(`${channel}: ${result.error}`);
  return result.data;
}, { channel, input });
const poll = async (read, ok, message, ms = 8000) => { const end = Date.now() + ms; let value; while (Date.now() < end) { value = await read(); if (ok(value)) return value; await new Promise(r => setTimeout(r, 60)); } assert.fail(`${message} (último valor: ${JSON.stringify(value)})`); };
const stage = () => page.locator('.editor-main-stage');
const outline = () => page.evaluate(() => [...document.querySelector('.editor-main-stage .ProseMirror').children].map(el => {
  const figure=el.matches('figure.attachment-block')?el:el.querySelector('figure.attachment-block');
  if (figure) return `fig:${figure.dataset.attachmentKind}:${figure.querySelector('strong')?.textContent ?? '?'}`;
  if (el.tagName === 'IMG') return 'img';
  return `p:${el.textContent}`;
}));
const settledOutline = async () => { await page.waitForFunction(()=>!document.querySelector('.attachment-loading')&&[...document.querySelectorAll('figure.attachment-block')].every(el=>el.querySelector('strong')),{},{timeout:10000}); return outline(); };
const openTitle = async title => { const row=page.locator('.note-row').filter({ hasText: title }).first();const id=await row.getAttribute('data-note-id');await row.click(); await page.locator('.title-input').waitFor(); await page.locator(`.editor-pane[data-editor-ready="${id}"]`).waitFor(); };
const noteAttachments = id => invoke('attachments:list', { noteId: id });
const point = async (text, frac) => { const paragraph=page.locator('.editor-main-stage .ProseMirror p', { hasText: text }).first();await paragraph.scrollIntoViewIfNeeded();const box = await paragraph.boundingBox(); return { x: Math.round(box.x + Math.min(40, box.width / 2)), y: Math.round(box.y + box.height * frac) }; };

// ── Queda de arquivos (CDP com caminhos reais; fallback sintético) ────────────────
const synthetic = async (phase, files, x, y) => {
  const payload = files.map(file => { const size = fs.statSync(file).size; return { name: path.basename(file), size, b64: size < 2_000_000 ? fs.readFileSync(file).toString('base64') : null }; });
  await page.evaluate(({ phase, payload, x, y }) => {
    const dt = new DataTransfer();
    for (const item of payload) dt.items.add(new File([item.b64 ? Uint8Array.from(atob(item.b64), c => c.charCodeAt(0)) : new Uint8Array(item.size)], item.name));
    const target = document.elementFromPoint(x, y) ?? document.body;
    const types = phase === 'over' ? ['dragenter', 'dragover'] : ['drop'];
    for (const type of types) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y }));
  }, { phase, payload, x, y });
};
const dragOver = async (files, x, y) => {
  if (dropMode === 'cdp') { const data = { items: [], files, dragOperationsMask: 1 }; await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data }); await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data }); }
  else await synthetic('over', files, x, y);
};
const dropAt = async (files, x, y) => {
  if (dropMode === 'cdp') { const data = { items: [], files, dragOperationsMask: 1 }; await cdp.send('Input.dispatchDragEvent', { type: 'drop', x, y, data }); }
  else await synthetic('drop', files, x, y);
};
const dropOnce = async (files, x, y) => { await dragOver(files, x, y); await dropAt(files, x, y); };
const lastStatus = async kind => { const el = page.locator(`[data-drop-status="${kind}"]`); await el.waitFor({ timeout: 15000 }); return el.innerText(); };
const dismissStatus = async () => { const dismiss = page.getByRole('button', { name: 'Dispensar aviso de anexo' }); if (await dismiss.count()) await dismiss.click(); await page.locator('[data-drop-status]').waitFor({ state: 'detached' }); };
const size = async (width, height) => { await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]); await page.setViewportSize({ width, height }); await page.waitForTimeout(200); };

try {
  app = await electron.launch({ executablePath: process.env.CADERNO_EXECUTABLE || require('electron'), args: process.env.CADERNO_EXECUTABLE ? [] : [root], env });
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message)); await page.locator('.sidebar').waitFor();
  const validPng=await app.evaluate(({nativeImage})=>nativeImage.createFromBitmap(Buffer.alloc(32*32*4,255),{width:32,height:32}).toPNG().toString('base64'));
  fs.writeFileSync(fixture.png,Buffer.from(validPng,'base64'));
  await size(1440, 900);
  const note = await invoke('notes:create', { title: 'Anexos por arraste QA', contentHtml: '<p>Primeira linha</p><p>Segunda linha</p><p>Terceira linha</p>' });
  const trashed = await invoke('notes:create', { title: 'Nota na lixeira QA', contentHtml: '<p>conteúdo antigo</p>' });
  await page.reload(); await page.locator('.sidebar').waitFor(); await openTitle('Anexos por arraste QA');

  // Detecta se o CDP entrega a queda com arquivos reais (sonda em área sem tratador: a barra lateral).
  try {
    cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => { window.__probe = [];window.__dropProbe=e=>{window.__probe.push([...e.dataTransfer.files].map(f=>f.name));e.preventDefault();};window.__overProbe=e=>e.preventDefault();window.addEventListener('drop',window.__dropProbe,true);window.addEventListener('dragover',window.__overProbe,true); });
    const sidebar = await page.locator('.sidebar').boundingBox(), x = Math.round(sidebar.x + 20), y = Math.round(sidebar.y + sidebar.height - 20);
    const data = { items: [], files: [fixture.small], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x, y, data });
    await page.waitForTimeout(250);
    if ((await page.evaluate(() => window.__probe)).flat().includes('extra.txt')) dropMode = 'cdp';
  } catch { dropMode = 'synthetic'; }
  await page.evaluate(()=>{window.removeEventListener('drop',window.__dropProbe,true);window.removeEventListener('dragover',window.__overProbe,true);});
  console.log(`modo de queda: ${dropMode}`);
  assert.deepEqual(await noteAttachments(note.id), [], 'a sonda não pode gravar anexos');

  // ── 1. Queda múltipla no ponto de soltura ─────────────────────────────────────
  assert.equal(await page.locator('figure.attachment-block').count(), 0);
  const startUrl = page.url();
  const where = await point('Segunda linha', 0.85);
  await dragOver([fixture.png, fixture.pdf, fixture.html, fixture.docx, fixture.webm], where.x, where.y);
  const accept = page.locator('[data-drop-overlay="accept"]'); await accept.waitFor(); assert.match(await accept.innerText(), /Solte para anexar/);
  await page.screenshot({ path: path.join(shots, '1-arrastando.png') });
  await dropAt([fixture.png, fixture.pdf, fixture.html, fixture.docx, fixture.webm], where.x, where.y);
  assert.match(await lastStatus('ok'), /5 arquivos anexados/);
  await page.locator('[data-drop-overlay]').waitFor({ state: 'detached' });
  assert.equal(page.url(), startUrl, 'soltar não navega para o arquivo');
  const order = await settledOutline();
  const expected = ['p:Primeira linha', 'p:Segunda linha', 'img', 'fig:preview:Relatorio QA.pdf', 'fig:preview:Funil_QA.html', 'fig:file:relatorio.docx', 'fig:preview:video.webm', 'p:Terceira linha'];
  assert.deepEqual(order, expected, 'ordem dos arquivos soltos preservada após o parágrafo da queda');
  await dismissStatus();
  let rows = await noteAttachments(note.id); assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(r => r.fileName).sort(), ['Relatorio QA.pdf', 'Funil_QA.html', 'foto.png', 'relatorio.docx', 'video.webm'].sort());
  assert.equal(rows.find(r => r.fileName === 'relatorio.docx').mimeType, 'application/octet-stream');
  assert.match(await page.getByRole('button', { name: 'Anexos', exact:true }).innerText(), /5/, 'contador de anexos atualiza por evento, sem abrir o menu');

  // ── 2. Aparência: sem moldura, controles discretos ────────────────────────────
  const htmlFig = page.locator('figure.attachment-block', { hasText: 'Funil_QA.html' });
  await htmlFig.locator('iframe').waitFor();
  const frame = page.frameLocator('iframe[title^="Prévia isolada de Funil_QA.html"]');
  await frame.locator('#titulo').waitFor(); assert.equal(await frame.locator('#externa').getAttribute('src'), null, 'recurso externo removido');
  assert.equal(await page.evaluate(() => window.__executou === true), false, 'script do HTML não executa');
  assert.equal(await htmlFig.locator('iframe').getAttribute('sandbox'), '');
  const look = await htmlFig.evaluate(fig => {
    const css = (el, p) => getComputedStyle(el)[p], viewer = fig.querySelector('.media-preview'), header = viewer.querySelector('header'), frameBox = fig.querySelector('.html-frame');
    return { figBorder: css(fig, 'borderTopWidth'), figBg: css(fig, 'backgroundColor'), viewBorder: css(viewer, 'borderTopWidth'), viewShadow: css(viewer, 'boxShadow'), viewBg: css(viewer, 'backgroundColor'), headBorder: css(header, 'borderBottomWidth'), headBg: css(header, 'backgroundColor'), headH: header.getBoundingClientRect().height, tools: fig.querySelectorAll('.attachment-block-tools').length, handle: !!fig.querySelector('[data-drag-handle]'), frameH: frameBox.getBoundingClientRect().height, hint: fig.querySelector('.html-preview-hint')?.textContent, controlsOpacity: css(viewer.querySelector('.media-controls'), 'opacity') };
  });
  assert.equal(look.figBorder, '0px'); assert.equal(look.viewBorder, '0px'); assert.equal(look.headBorder, '0px'); assert.equal(look.viewShadow, 'none');
  assert.equal(look.figBg, 'rgba(0, 0, 0, 0)'); assert.equal(look.viewBg, 'rgba(0, 0, 0, 0)'); assert.equal(look.headBg, 'rgba(0, 0, 0, 0)');
  assert.equal(look.tools, 0, 'sem barra de arrastar separada'); assert.ok(look.handle, 'alça de arrastar mantida');
  assert.ok(look.headH <= 34, `cabeçalho baixo (${look.headH}px)`); assert.ok(look.frameH >= 160, 'prévia HTML tem altura útil');
  assert.match(look.hint, /Scripts e recursos externos ficam desativados/);
  await page.mouse.move(2, 2); await page.waitForTimeout(250);
  assert.equal(await htmlFig.locator('.media-controls').evaluate(el => getComputedStyle(el).opacity), '0', 'controles ocultos em repouso');
  await htmlFig.locator('header').hover(); await page.waitForTimeout(250);
  assert.equal(await htmlFig.locator('.media-controls').evaluate(el => getComputedStyle(el).opacity), '1', `controles aparecem no hover: ${JSON.stringify(await htmlFig.evaluate(fig=>({hover:fig.matches(':hover'),chain:[...document.querySelectorAll(':hover')].map(el=>el.tagName+'.'+el.className)})))}`);
  await page.mouse.move(2, 2); await htmlFig.getByRole('button', { name: 'Remover Funil_QA.html do texto' }).focus(); await page.waitForTimeout(250);
  assert.equal(await htmlFig.locator('.media-controls').evaluate(el => getComputedStyle(el).opacity), '1', 'controles aparecem no foco do teclado');
  await page.screenshot({ path: path.join(shots, '2-html-claro.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(shots, '2-html-escuro.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

  // ── 3. Controles preservados: ampliar, zoom, páginas, vídeo, cartão ───────────
  await htmlFig.getByRole('button', { name: 'Ampliar prévia de Funil_QA.html' }).click();
  const dialog = page.locator('.media-preview[role=dialog]'); await dialog.waitFor(); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  const pdfFig = page.locator('figure.attachment-block', { hasText: 'Relatorio QA.pdf' });
  await pdfFig.locator('canvas[data-rendered-page="1"]').waitFor({ timeout: 15000 });
  await pdfFig.hover(); assert.match(await pdfFig.locator('.media-controls').innerText(), /60%/);
  await pdfFig.getByRole('button', { name: 'Ampliar zoom' }).click(); assert.match(await pdfFig.locator('.media-controls').innerText(), /85%/);
  await pdfFig.getByRole('button', { name: 'Próxima página' }).click(); await pdfFig.locator('canvas[data-rendered-page="2"]').waitFor({ timeout: 15000 });
  assert.match(await pdfFig.locator('.media-controls').innerText(), /Página 2 \/ 2/);
  const video = page.locator('figure.attachment-block video'); await video.waitFor();
  await poll(() => video.evaluate(v => v.controls && v.readyState >= 1 && v.duration), d => d > 1.8, 'vídeo carrega metadados');
  const image = page.locator('.editor-main-stage .ProseMirror > img'); await poll(() => image.evaluate(i => i.naturalWidth), w => w > 0, 'imagem inline carrega');
  const card = page.locator('figure.attachment-block-file');
  assert.equal(await card.count(), 1); assert.match(await card.innerText(), /relatorio\.docx[\s\S]*DOCX[\s\S]*sem prévia/);
  assert.equal(await card.getByRole('button', { name: 'Abrir relatorio.docx' }).isVisible(), true, 'cartão tem ação Abrir visível');
  await card.getByRole('button', { name: 'Remover relatorio.docx do texto' }).click();
  assert.equal(await card.count(), 0); assert.equal((await noteAttachments(note.id)).length, 5, 'remover do texto mantém o arquivo nos anexos');
  await page.getByRole('button', { name: 'Desfazer' }).click(); await card.waitFor();
  assert.deepEqual(await settledOutline(), expected, 'Ctrl+Z restaura o cartão na mesma posição');

  // ── 4. Arraste interno de bloco e arraste de nota não viram anexo ────────────
  const before = (await noteAttachments(note.id)).length;
  const handle = card.locator('[data-drag-handle]');await handle.scrollIntoViewIfNeeded();await handle.hover();
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x+hb.width/2,hb.y+hb.height/2);await page.mouse.down();
  await page.mouse.move(hb.x+hb.width/2+12,hb.y+hb.height/2+4,{steps:4});
  await page.locator('.editor-main-stage .editor-scroll').evaluate(el=>{el.scrollTop=0;});
  const top = await point('Primeira linha', 0.2);
  await page.mouse.move(top.x,top.y+20,{steps:8});await page.mouse.move(top.x,top.y,{steps:5});await page.mouse.up();
  await page.waitForTimeout(400);
  const moved = await settledOutline();
  assert.notDeepEqual(moved, expected, 'arrastar o bloco interno reordena a nota'); assert.equal(moved.filter(x => x.startsWith('fig:file')).length, 1);
  assert.equal((await noteAttachments(note.id)).length, before, 'arraste interno não cria anexos');
  assert.equal(await page.locator('[data-drop-status]').count(), 0, 'arraste interno não dispara feedback de arquivo');
  await page.getByRole('button', { name: 'Desfazer' }).click(); assert.deepEqual(await settledOutline(), expected, 'undo desfaz o arraste interno');
  const sidebarDrag = await point('Terceira linha', 0.5);
  await page.evaluate(({ x, y }) => {
    const dt = new DataTransfer(); dt.setData('application/x-caderno-note', 'abc'); dt.setData('text/plain', 'note:abc'); dt.items.add(new File(['x'], 'residual.txt'));
    const target = document.elementFromPoint(x, y); for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y }));
  }, sidebarDrag);
  await page.waitForTimeout(300); assert.equal((await noteAttachments(note.id)).length, before, 'nota/pasta da barra lateral não é tratada como arquivo');
  assert.equal(await page.locator('[data-drop-overlay],[data-drop-status]').count(), 0);
  // O editor mantém o comportamento de inserir o texto do arraste interno.
  // Desfaz essa inserção para preservar os parágrafos usados nos próximos passos.
  await page.getByRole('button',{name:'Desfazer',exact:true}).click();
  assert.deepEqual(await settledOutline(),expected);

  // ── 5. Limites e erros por arquivo ────────────────────────────────────────────
  const bottom = await point('Terceira linha', 0.9);
  await dropOnce([fixture.huge, fixture.csv], bottom.x, bottom.y);
  const bigMessage = await lastStatus('error'); assert.match(bigMessage, /grande\.bin/); assert.match(bigMessage, /50 MB/);
  await dismissStatus();
  rows = await noteAttachments(note.id); assert.equal(rows.length, before + 1); assert.ok(!rows.some(r => r.fileName === 'grande.bin'), 'arquivo acima do limite não é gravado'); assert.ok(rows.some(r => r.fileName === 'dados.csv'));
  const bottom2 = await point('Terceira linha', 0.9);
  await dropOnce([fixture.fakePdf, fixture.txt], bottom2.x, bottom2.y);
  const partial = await lastStatus('error'); assert.match(partial, /falso\.pdf/); assert.match(partial, /PDF inválido/);
  await dismissStatus();
  rows = await noteAttachments(note.id); assert.ok(rows.some(r => r.fileName === 'notas.txt')); assert.ok(!rows.some(r => r.fileName === 'falso.pdf'), 'PDF corrompido não é anexado');
  assert.ok((await settledOutline()).includes('fig:file:notas.txt'), 'arquivo válido do mesmo lote entra no texto');
  assert.match(await page.getByRole('button', { name: 'Anexos', exact:true }).innerText(), new RegExp(String(rows.length)));

  // ── 6. Autosave e reload ──────────────────────────────────────────────────────
  const finalOutline = await settledOutline();
  await poll(async () => (await invoke('notes:get', { id: note.id })).contentHtml, html => (html.match(/data-caderno-attachment/g) ?? []).length === finalOutline.filter(x => x.startsWith('fig:')).length && html.includes('caderno-asset://'), 'conteúdo salvo com os anexos');
  await page.reload(); await page.locator('.sidebar').waitFor(); await openTitle('Anexos por arraste QA');
  assert.deepEqual(await settledOutline(), finalOutline, 'estrutura idêntica após reload');
  await poll(() => page.locator('.editor-main-stage .ProseMirror > img').evaluate(i => i.naturalWidth), w => w > 0, 'imagem volta após reload');
  await page.locator('figure.attachment-block', { hasText: 'Relatorio QA.pdf' }).locator('canvas[data-rendered-page="1"]').waitFor({ timeout: 15000 });

  // ── 7. Lixeira recusa sem gravar ──────────────────────────────────────────────
  await invoke('notes:delete', { id: trashed.id }); await page.reload(); await page.locator('.sidebar').waitFor();
  await page.locator('.sidebar').getByRole('button', { name: /Lixeira/ }).click(); await openTitle('Nota na lixeira QA');
  const tb = await page.locator('.editor-main-stage .ProseMirror p').first().boundingBox(), tx = Math.round(tb.x + 20), ty = Math.round(tb.y + tb.height / 2);
  assert.equal(await page.locator('.tiptap').getAttribute('contenteditable'),'false');
  const callsBeforeTrash=await invoke('app:qa-ipc-counts');
  await dragOver([fixture.csv], tx, ty); const refused = page.locator('[data-drop-overlay="refused"]'); await refused.waitFor();const refusalText=await refused.innerText(); assert.match(refusalText, /lixeira/i);
  await dropAt([fixture.csv], tx, ty);
  // dropEffect=none pode fazer o Chromium cancelar a queda sem emitir `drop`.
  // Nesse caso a recusa já está visível durante o arraste; nenhum arquivo é gravado.
  await page.waitForTimeout(150);
  if(await page.locator('[data-drop-status="error"]').count())assert.match(await lastStatus('error'), /lixeira/i);
  else assert.match(refusalText,/lixeira/i);
  assert.deepEqual(await noteAttachments(trashed.id), [], 'nota na lixeira não grava anexos');
  const callsAfterTrash=await invoke('app:qa-ipc-counts');assert.equal(callsAfterTrash['attachments:save']??0,callsBeforeTrash['attachments:save']??0);
  assert.equal(await page.locator('figure.attachment-block').count(), 0); assert.equal(page.url(), startUrl);
  if(dropMode==='cdp')await cdp.send('Input.dispatchDragEvent',{type:'dragCancel',x:tx,y:ty,data:{items:[],files:[],dragOperationsMask:1}});
  await page.evaluate(()=>window.dispatchEvent(new Event('dragend')));
  await dismissStatus();

  // ── 8. Responsivo: sem estouro horizontal em duas janelas ─────────────────────
  await page.getByRole('button', { name: /^Notas(?: \d+)?$/ }).click(); await openTitle('Anexos por arraste QA'); await settledOutline();
  for (const [w, h] of [[900, 560], [1440, 900]]) {
    await size(w, h); await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, figures: [...document.querySelectorAll('figure.attachment-block')].filter(f => f.scrollWidth - f.clientWidth > 1).map(f => f.dataset.attachmentKind) }));
    assert.equal(overflow.doc <= 0, true, `${w}x${h}: sem rolagem horizontal da página`); assert.deepEqual(overflow.figures, [], `${w}x${h}: anexos sem estouro`);
    await page.screenshot({ path: path.join(shots, `8-${w}x${h}.png`) });
  }
  assert.deepEqual(errors, [], 'sem erros de página');
  console.log(`OK jornada de anexos em notas (capturas em ${shots})`);
} catch (error) {
  try { await page?.screenshot({ path: path.join(shots, 'falha.png') }); } catch { /* janela já fechada */ }
  failed = true; console.error(`FALHOU (artefatos em ${runDir})`); throw error;
} finally {
  await app?.close().catch(() => {});
  if (!process.env.KEEP_QA_RUN && !failed) { try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { /* temp */ } }
}
