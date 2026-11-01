// Jornada da tela inicial (sem nota aberta): busca → Ctrl+K, Nova nota, widgets configuráveis e persistência.
// Usa perfil temporário (CADERNO_USER_DATA) e o código já compilado; não faz build e não toca em %APPDATA%/caderno.
// Pré-requisito: HomeDashboard integrada na área central quando nenhuma nota está aberta (ver docs/PERFORMANCE.md → Início).
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), root = process.cwd();
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-home-'));
const env = { ...process.env, CADERNO_USER_DATA: path.join(runDir, 'profile'), CADERNO_QA_IPC: '1' }; delete env.ELECTRON_RUN_AS_NODE;
const LAYOUT_KEY = 'caderno.home.v1', APPEARANCE_KEY = 'caderno.appearance.v1';
let app, page; const errors = [];

const invoke = (channel, input = null) => page.evaluate(async ({ channel, input }) => {
  const result = await window.cadernoDesktop.invoke(channel, input);
  if (!result.ok) throw new Error(`${channel}: ${result.error}`);
  return result.data;
}, { channel, input });
const poll = async (read, ok, message, timeout = 5000) => { const end = Date.now() + timeout; let value; while (Date.now() < end) { value = await read(); if (ok(value)) return value; await new Promise(r => setTimeout(r, 50)); } assert.fail(`${message} (último valor: ${JSON.stringify(value)})`); };
const size = async (width, height) => { await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]); await page.setViewportSize({ width, height }); await page.waitForTimeout(250); }; // transição das barras: 180 ms
const home = () => page.getByRole('region', { name: 'Página inicial' });
const widget = id => page.locator(`.home-widget[data-widget-id="${id}"]`);
const order = () => page.locator('.home-widget').evaluateAll(els => els.map(el => el.dataset.widgetId));
const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), LAYOUT_KEY);
const waitHome = async () => { await page.locator('.sidebar').waitFor(); await home().waitFor(); await page.locator('.home-skeleton').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {}); };
const reload = async () => { await page.reload(); await waitHome(); };
const counts = async () => invoke('app:qa-ipc-counts');
const noOverflow = async label => {
  const bad = await page.evaluate(() => {
    const pane = document.querySelector('.home-pane'), limit = pane.getBoundingClientRect().right + 1;
    const wide = [...document.querySelectorAll('.home-dashboard *')].filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > limit && getComputedStyle(el).position !== 'absolute').map(el => `${el.tagName}.${el.className}`);
    return { scroll: pane.scrollWidth - pane.clientWidth, wide: wide.slice(0, 5) };
  });
  assert.ok(bad.scroll <= 1, `${label}: sem rolagem horizontal (${bad.scroll})`);
  assert.deepEqual(bad.wide, [], `${label}: nada ultrapassa o painel`);
};
const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '');

try {
  app = await electron.launch({ executablePath: process.env.CADERNO_QA_EXECUTABLE || require('electron'), args: process.env.CADERNO_QA_EXECUTABLE ? [] : [root], env }); page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await page.locator('.sidebar').waitFor();

  // ---- Estado vazio: perfil novo, sem dados --------------------------------------------------------------
  await home().waitFor();
  assert.equal(await page.getByText('Selecione ou crie uma nota.').count(), 0, 'o texto antigo não ocupa mais a tela');
  assert.deepEqual(await order(), ['clock', 'recent'], 'dois cartões compactos, como na referência');
  await poll(() => page.locator('.home-skeleton').count(), n => n === 0, 'carregamento termina');
  assert.match(await widget('recent').innerText(), /ainda não tem notas/, 'vazio explica o próximo passo');
  assert.match(await widget('clock').innerText(), /\d{1,2}:\d{2}/);

  // ---- Dados de exemplo ---------------------------------------------------------------------------------
  const book = await invoke('notebooks:create', { name: 'Projetos QA' });
  const notes = [];
  for (let i = 1; i <= 12; i++) notes.push(await invoke('notes:create', { title: `Nota inicial ${i}`, contentHtml: `<p>Conteúdo ${i}</p>`, ...(i === 12 ? { notebookId: book.id } : {}) }));
  await invoke('notes:pin', { id: notes[0].id, value: true });
  await invoke('notes:favorite', { id: notes[1].id, value: true });
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  await invoke('tasks:create', { noteId: notes[2].id, title: 'Tarefa de hoje QA', dueAt: noon.getTime(), reminderAt: null, priority: 'high' });
  await invoke('tasks:create', { noteId: notes[2].id, title: 'Tarefa atrasada QA', dueAt: Date.now() - 3 * 86400000, reminderAt: null });
  const start = new Date(); start.setHours(23, 0, 0, 0); if (start.getTime() < Date.now() + 120000) start.setTime(Date.now() + 3600000);
  await invoke('events:create', { noteId: null, title: 'Evento QA', description: '', startAt: start.getTime(), endAt: start.getTime() + 3600000, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, allDay: false });
  await reload();

  for (const [w, h] of [[867, 553], [900, 560], [1440, 900]]) {
    await size(w, h);
    await noOverflow(`início ${w}x${h}`);
    const composition = await page.evaluate(() => {
      const rect = selector => { const { x, y, width, height, bottom } = document.querySelector(selector).getBoundingClientRect(); return { x, y, width, height, bottom }; };
      return { pane: rect('.home-pane'), greeting: rect('.home-hero h1'), search: rect('.home-search'), grid: rect('.home-grid'), cards: [...document.querySelectorAll('.home-widget')].map(el => { const { x, y, width, bottom } = el.getBoundingClientRect(); return { x, y, width, bottom }; }), background: getComputedStyle(document.querySelector('.home-pane'), '::before').content };
    });
    await page.screenshot({ path: path.join(runDir, `home-light-${w}.png`) });
    assert.ok(Math.abs(composition.search.x + composition.search.width / 2 - (composition.pane.x + composition.pane.width / 2)) < 2, `busca centralizada no espaço entre barras: ${JSON.stringify(composition)}`);
    assert.ok(composition.greeting.bottom < composition.search.y, 'saudação acima da busca');
    assert.ok(composition.grid.y > composition.search.bottom + 55, 'widgets separados da busca por espaço livre');
    assert.ok(composition.search.y > h * .38 && composition.search.y < h * .48, 'busca próxima ao centro vertical');
    assert.ok(composition.cards.every(card => card.bottom <= h + 1), `cartões padrão inteiros na janela: ${JSON.stringify(composition)}`);
    assert.equal(Math.round(composition.cards[0].y), Math.round(composition.cards[1].y), 'cartões padrão lado a lado');
    assert.equal(composition.background, 'none', 'centro sem superfície opaca, preserva o fundo');
  }
  await size(1100, 760);

  // Configuração salva na 0.16: permanece intacta, sem forçar o novo padrão.
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, widgets: [
    { id: 'recent', enabled: true, size: 'wide' },
    ...['tasks', 'events', 'starred'].map(id => ({ id, enabled: true, size: 'compact' })),
    ...['notebooks', 'clock', 'summary'].map(id => ({ id, enabled: false, size: 'compact' })),
  ] })), LAYOUT_KEY);
  await reload();
  assert.deepEqual(await order(), ['recent', 'tasks', 'events', 'starred'], 'painel existente preservado');

  // ---- Conteúdo e limites -------------------------------------------------------------------------------
  assert.equal(await widget('recent').locator('.home-row').count(), 8, 'recentes (largo) mostram no máximo 8 linhas');
  assert.match(await widget('recent').locator('.home-more').innerText(), /\+4 outros/);
  assert.match(await widget('starred').innerText(), /Nota inicial 1/); assert.match(await widget('starred').innerText(), /Nota inicial 2/);
  assert.match(await widget('tasks').innerText(), /Tarefa atrasada QA[\s\S]*Tarefa de hoje QA|Tarefa de hoje QA/, 'tarefas de hoje e atrasadas');
  assert.match(await widget('tasks').locator('.home-due.overdue').first().innerText(), /Atrasada/);
  assert.match(await widget('events').innerText(), /Evento QA/);

  // ---- Busca conectada à pesquisa geral (Ctrl+K) -------------------------------------------------------
  const search = page.getByRole('searchbox', { name: 'Pesquisar no Caderno' });
  await search.fill('contrato anual'); await search.press('Enter');
  await page.locator('.command-palette').waitFor();
  assert.equal(await page.locator('#command-query').inputValue(), 'contrato anual', 'Enter abre a pesquisa já preenchida');
  await page.keyboard.press('Escape'); await page.locator('.command-palette').waitFor({ state: 'hidden' });
  await search.fill('reunião'); await search.press('Control+k');
  await page.locator('.command-palette').waitFor();
  assert.equal(await page.locator('#command-query').inputValue(), 'reunião', 'Ctrl+K dentro do campo leva a consulta');
  assert.equal(await page.locator('.command-palette').count(), 1, 'só uma pesquisa aberta');
  await page.keyboard.press('Escape'); await page.locator('.command-palette').waitFor({ state: 'hidden' });
  await search.fill(''); await page.getByRole('button', { name: 'Abrir pesquisa geral' }).click();
  await page.locator('.command-palette').waitFor();
  assert.equal(await page.locator('#command-query').inputValue(), '', 'sem texto, abre vazia');
  await page.keyboard.press('Escape'); await page.locator('.command-palette').waitFor({ state: 'hidden' });
  await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.keyboard.press('/');
  assert.equal(await search.evaluate(el => el === document.activeElement), true, '"/" foca a busca');
  await search.fill('x'); await search.press('Escape'); assert.equal(await search.inputValue(), '', 'Esc limpa o campo');

  // ---- Concluir tarefa direto do painel ----------------------------------------------------------------
  await widget('tasks').getByRole('checkbox', { name: 'Concluir Tarefa de hoje QA' }).click();
  await poll(async () => (await invoke('tasks:list', { filter: 'all' })).find(t => t.title === 'Tarefa de hoje QA')?.done, Boolean, 'tarefa concluída no banco');
  await widget('tasks').getByText('Tarefa de hoje QA').waitFor({ state: 'detached' });

  // ---- Sem polling em repouso ---------------------------------------------------------------------------
  const before = await counts();
  await page.waitForTimeout(2500);
  const after = await counts();
  for (const channel of ['notes:list', 'tasks:list', 'events:list', 'notes:get']) assert.equal(after[channel] ?? 0, before[channel] ?? 0, `${channel}: sem consultas em repouso`);

  // ---- Personalizar: teclado ----------------------------------------------------------------------------
  const opener = page.getByRole('button', { name: 'Personalizar painel' });
  await opener.focus(); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Personalizar painel' }).waitFor();
  assert.equal(await opener.getAttribute('aria-pressed'), 'true');
  assert.equal(await widget('recent').getByRole('button', { name: /Mover Notas recentes para antes/ }).isDisabled(), true, 'primeiro não sobe');
  const moveTasks = widget('tasks').getByRole('button', { name: 'Mover Tarefas de hoje para depois' });
  await moveTasks.focus(); await page.keyboard.press('Enter');
  assert.deepEqual(await order(), ['recent', 'events', 'tasks', 'starred']);
  assert.match(await focusedLabel(), /^Mover Tarefas de hoje para/, 'foco acompanha o widget movido');
  await page.keyboard.press('Enter'); // de novo: tasks troca com starred e vai para o fim
  assert.deepEqual(await order(), ['recent', 'events', 'starred', 'tasks']);
  assert.match(await focusedLabel(), /^Mover Tarefas de hoje para/);
  assert.match(await page.locator('.home-sr').innerText(), /Tarefas de hoje: posição 4 de 4/, 'mudança anunciada para leitores de tela');
  await widget('tasks').getByRole('button', { name: 'Deixar Tarefas de hoje largo' }).click();
  assert.equal(await widget('tasks').getAttribute('data-size'), 'wide');
  await widget('starred').getByRole('button', { name: 'Ocultar Fixadas e favoritas' }).click();
  assert.deepEqual(await order(), ['recent', 'events', 'tasks']);
  await page.getByRole('button', { name: 'Adicionar Fixadas e favoritas' }).waitFor();
  await page.getByRole('button', { name: 'Adicionar Tempo e clima' }).click();
  await page.getByRole('button', { name: 'Adicionar Cadernos' }).click();
  assert.deepEqual(await order(), ['recent', 'events', 'tasks', 'clock', 'notebooks']);
  assert.match(await widget('clock').locator('time').first().innerText(), /\d{1,2}:\d{2}/, 'relógio visível');
  // Durante a personalização o conteúdo é só prévia (inerte).
  assert.equal(await widget('recent').locator('.home-widget-body').evaluate(el => el.inert), true);
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Personalizar painel' }).waitFor({ state: 'detached' });
  await poll(() => focusedLabel(), label => /Personalizar painel/.test(label), 'foco volta ao botão Personalizar');

  // ---- Persistência: reabrir ----------------------------------------------------------------------------
  const saved = await stored();
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.widgets.filter(w => w.enabled).map(w => w.id), ['recent', 'events', 'tasks', 'clock', 'notebooks']);
  assert.deepEqual(Object.keys(saved.widgets[0]).sort(), ['enabled', 'id', 'size'], 'só configuração é guardada');
  assert.equal(JSON.stringify(saved).includes('Nota inicial'), false, 'nenhuma nota/tarefa duplicada no armazenamento');
  await reload();
  assert.deepEqual(await order(), ['recent', 'events', 'tasks', 'clock', 'notebooks'], 'ordem sobrevive à reabertura');
  assert.equal(await widget('tasks').getAttribute('data-size'), 'wide', 'tamanho sobrevive à reabertura');

  // ---- Caderno como atalho ------------------------------------------------------------------------------
  await widget('notebooks').getByRole('button', { name: /Projetos QA/ }).click();
  await poll(() => page.locator('.notelist').innerText(), text => text.includes('Nota inicial 12') && !text.includes('Nota inicial 11'), 'atalho filtra a lista pelo caderno');

  // ---- Arrastar e soltar (opcional, com equivalente por teclado) ----------------------------------------
  await opener.click();
  const grip = widget('clock').locator('.home-grip');
  await page.evaluate(()=>{window.__homeDrag=[];for(const type of ['dragstart','drop'])document.addEventListener(type,event=>window.__homeDrag.push({type,target:event.target.closest('.home-widget')?.dataset.widgetId}),true);});
  // Inicia o gesto antes de rolar ao destino; dragTo mede a origem após a rolagem
  // do destino e pode pegar a alça de outro widget num painel longo.
  await grip.scrollIntoViewIfNeeded();
  const sourceBox=await grip.boundingBox();
  await page.mouse.move(sourceBox.x+sourceBox.width/2,sourceBox.y+sourceBox.height/2);await page.mouse.down();
  await page.mouse.move(sourceBox.x+sourceBox.width/2+10,sourceBox.y+sourceBox.height/2+8,{steps:4});
  await widget('recent').scrollIntoViewIfNeeded();
  const targetBox=await widget('recent').boundingBox();
  await page.mouse.move(targetBox.x+targetBox.width/2,targetBox.y+20,{steps:12});await page.mouse.up();
  assert.equal((await order())[0], 'clock', `arrastar move o widget: ${JSON.stringify({order:await order(),events:await page.evaluate(()=>window.__homeDrag)})}`);
  // ---- Restaurar padrão (com desfazer) ------------------------------------------------------------------
  await page.getByRole('button', { name: 'Restaurar padrão' }).click();
  assert.deepEqual(await order(), ['clock', 'recent']);
  await page.getByRole('status').filter({ hasText: 'Painel restaurado' }).getByRole('button', { name: 'Desfazer' }).click();
  assert.equal((await order())[0], 'clock', 'desfazer devolve a personalização');
  await page.getByRole('button', { name: 'Restaurar padrão' }).click();
  await page.getByRole('button', { name: 'Concluir personalização' }).click();
  await poll(async () => (await stored()).widgets.filter(w => w.enabled).length, n => n === 2, 'padrão regravado');

  // ---- Widgets ocultos não buscam dados -----------------------------------------------------------------
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ version: 1, widgets: [{ id: 'recent', enabled: true, size: 'wide' }, { id: 'summary', enabled: true, size: 'compact' }] })), LAYOUT_KEY);
  const hiddenBefore = await counts();
  await reload();
  const hiddenAfter = await counts();
  assert.deepEqual(await order(), ['recent', 'summary'], 'só os visíveis aparecem');
  assert.equal((hiddenAfter['tasks:list'] ?? 0) - (hiddenBefore['tasks:list'] ?? 0), 0, 'tarefas ocultas: nenhuma consulta');
  assert.equal((hiddenAfter['events:list'] ?? 0) - (hiddenBefore['events:list'] ?? 0), 0, 'eventos ocultos: nenhuma consulta');
  assert.match(await widget('summary').innerText(), /Notas[\s\S]*12/, 'resumo vem do store, sem consulta extra');

  // ---- Armazenamento corrompido → padrão ----------------------------------------------------------------
  await page.evaluate(key => localStorage.setItem(key, '{lixo'), LAYOUT_KEY);
  await reload();
  assert.deepEqual(await order(), ['clock', 'recent'], 'dados inválidos caem no padrão');

  // ---- Tema escuro e aparência com fundo ----------------------------------------------------------------
  await invoke('theme:set', { value: 'dark' }); await reload();
  await page.screenshot({ path: path.join(runDir, 'home-dark.png') });
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ backgroundKind: 'gradient', backgroundColor: '#24205a', backgroundColorEnd: '#873e65', accent: '#b4a5ff', panelOpacity: 80, editorOpacity: 85 })), APPEARANCE_KEY);
  await reload();
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-custom-background')), true, 'aparência com fundo ativa');
  for (const [w, h] of [[900, 560], [1440, 900]]) { await size(w, h); await noOverflow(`fundo ${w}x${h}`); await page.screenshot({ path: path.join(runDir, `home-background-${w}.png`) }); }
  const legible = await page.evaluate(() => { const el = document.querySelector('.home-widget .home-row-title, .home-widget .home-empty'); const c = getComputedStyle(el).color; return c !== 'rgba(0, 0, 0, 0)' && getComputedStyle(el).visibility === 'visible'; });
  assert.equal(legible, true, 'texto dos widgets visível sobre o fundo');

  // ---- Nova nota -----------------------------------------------------------------------------------------
  await page.evaluate(key => localStorage.removeItem(key), APPEARANCE_KEY); await invoke('theme:set', { value: 'light' }); await reload();
  const totalBefore = (await invoke('notes:list', { view: 'all', order: 'updated_desc' })).length;
  await home().getByRole('button', { name: 'Nova nota', exact:true }).click();
  await page.locator('.title-input').waitFor();
  assert.equal(await home().count(), 0, 'ao abrir a nota o painel sai da tela');
  assert.equal((await invoke('notes:list', { view: 'all', order: 'updated_desc' })).length, totalBefore + 1, 'uma única nota criada');

  // Voltar ao início faz flush da nota, preserva widgets e permite reabrir a edição.
  await page.locator('.title-input').fill('Criada pelo início QA');
  await page.locator('.tiptap').click();await page.keyboard.insertText('Edição preservada ao voltar ao início.');
  await page.locator('.sidebar').getByRole('button',{name:'Início',exact:true}).click();await home().waitFor();
  const created=(await invoke('notes:list',{view:'all'})).find(note=>note.title==='Criada pelo início QA');
  assert.ok(created,'título salvo antes de voltar ao início');
  assert.match((await invoke('notes:get',{id:created.id})).contentHtml,/Edição preservada/);
  await widget('recent').getByRole('button',{name:/Criada pelo início QA/}).click();await page.locator('.tiptap').waitFor();
  assert.match(await page.locator('.tiptap').innerText(),/Edição preservada/,'nota reabre após o painel sem perder texto');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, screenshots: runDir }));
} catch (error) { await page?.screenshot({ path: path.join(runDir, 'failure.png') }).catch(() => {}); console.error('Artifacts:', runDir); throw error; }
finally { await app?.close(); }
