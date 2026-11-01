// Jornadas de Tarefas e Calendário em 900x560 e 1440x900. Usa perfil temporário e o código já compilado (não faz build).
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), root = process.cwd();
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-agenda-'));
const env = { ...process.env, CADERNO_USER_DATA: path.join(runDir, 'profile'), CADERNO_QA_IPC:'1' }; delete env.ELECTRON_RUN_AS_NODE;
let app, page; const errors = [];
const invoke = (channel, input = null) => page.evaluate(async ({ channel, input }) => {
  const result = await window.cadernoDesktop.invoke(channel, input);
  if (!result.ok) throw new Error(`${channel}: ${result.error}`);
  return result.data;
}, { channel, input });
const size = async (width, height) => { await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]); await page.setViewportSize({ width, height }); };
const noOverflow = async label => {
  const bad = await page.evaluate(() => [...document.querySelectorAll('.agenda, .tasks-page, .calendar-shell, .calendar-grid, .task-row, .agenda-list article')].filter(el => el.scrollWidth - el.clientWidth > 1 && getComputedStyle(el).overflowX === 'visible').map(el => el.className));
  assert.deepEqual(bad, [], `${label}: sem estouro horizontal`);
};
const poll = async (read, ok, message) => { const end = Date.now() + 5000; let value; while (Date.now() < end) { value = await read(); if (ok(value)) return value; await new Promise(r => setTimeout(r, 50)); } assert.fail(message); };
try {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env }); page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message)); await page.locator('.sidebar').waitFor();
  // AGENDA_CSS=src/agenda-refinements.css confere o CSS editado sem recompilar o app.
  if (process.env.AGENDA_CSS) await page.addStyleTag({ content: fs.readFileSync(process.env.AGENDA_CSS, 'utf8') });
  const note = await invoke('notes:create', { title: 'Nota da agenda', contentHtml: '' });
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  await invoke('tasks:create', { noteId: note.id, title: 'Agenda tarefa A', dueAt: noon.getTime(), reminderAt: null, priority: 'high' });
  await invoke('tasks:create', { noteId: note.id, title: 'Agenda tarefa B', dueAt: Date.now() - 3 * 86400000, reminderAt: null });
  await invoke('tasks:create', { noteId: note.id, title: 'Agenda tarefa C', dueAt: null, reminderAt: null, priority: 'low' });

  for (const [w, h] of [[900, 560], [1440, 900]]) {
    await size(w, h);
    await page.getByRole('button', { name: 'Tarefas' }).click(); await page.getByText('Agenda tarefa A').waitFor();
    assert.equal(await page.locator('.task-group').count(), 3, `${w}: só grupos com tarefas (atrasadas, hoje, sem data)`);
    assert.equal(await page.locator('.task-row').first().getByRole('checkbox').isVisible(), true, 'checkbox nativo visível');
    await noOverflow(`tarefas ${w}`);
    await page.screenshot({ path: path.join(runDir, `tasks-${w}.png`) });
  }

  const taskCallsBefore=(await invoke('app:qa-ipc-counts'))['tasks:list']??0;
  await page.getByLabel('Filtrar prioridade').selectOption('high');
  await page.getByLabel('Filtrar prioridade').selectOption('all');
  await page.getByLabel('Status das tarefas').selectOption('completed');
  await page.getByLabel('Status das tarefas').selectOption('pending');
  await poll(()=>page.locator('.task-row').count(),count=>count===3,'filtros locais restauram tarefas');
  const taskFilterCalls=((await invoke('app:qa-ipc-counts'))['tasks:list']??0)-taskCallsBefore;
  assert.equal(taskFilterCalls,0,'filtros e prioridade não refazem consulta ao banco');

  // Entrada rápida entende "amanhã 18h !alta", pré-visualiza e cancelar não perde o texto.
  await page.getByLabel('Adicionar tarefa rapidamente').fill('Revisar contrato amanhã 18h !alta');
  assert.match(await page.locator('.task-quick-hint').innerText(), /Revisar contrato.*Amanhã.*alta/s);
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await page.getByRole('dialog', { name: 'Nova tarefa' }).waitFor();
  assert.equal(await page.getByLabel('Título').inputValue(), 'Revisar contrato');
  assert.match(await page.getByLabel('Prazo', { exact: true }).inputValue(), /T18:00$/);
  assert.equal(await page.locator('#task-priority').inputValue(), 'high');
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(await page.getByLabel('Adicionar tarefa rapidamente').inputValue(), 'Revisar contrato amanhã 18h !alta', 'cancelar mantém o texto');
  await page.getByLabel('Adicionar tarefa rapidamente').fill('');

  // Teclado: setas entre checkboxes, "/" busca, Esc limpa, "n" abre o diálogo.
  const boxes = page.locator('.task-groups input.task-checkbox');
  await boxes.first().focus(); await page.keyboard.press('ArrowDown');
  assert.equal(await boxes.nth(1).evaluate(el => el === document.activeElement), true, 'seta move para a próxima tarefa');
  await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
  await page.keyboard.press('/'); assert.equal(await page.getByLabel('Buscar tarefas').evaluate(el => el === document.activeElement), true);
  await page.keyboard.type('tarefa b'); await poll(() => page.locator('.task-row').count(), n => n === 1, 'busca filtra');
  await page.keyboard.press('Escape'); await poll(() => page.locator('.task-row').count(), n => n === 3, 'Esc limpa a busca');

  // Adiar para amanhã e desfazer; excluir e desfazer.
  const rowB = page.locator('.task-row').filter({ hasText: 'Agenda tarefa B' });
  await rowB.getByRole('button', { name: /Adiar/ }).click();
  const postponed = await poll(async () => (await invoke('tasks:list', { filter: 'all' })).find(t => t.title === 'Agenda tarefa B'), t => t.dueAt > Date.now(), 'adiar persiste prazo futuro');
  await page.getByRole('status').filter({ hasText: 'Prazo adiado' }).getByRole('button', { name: 'Desfazer' }).click();
  await poll(async () => (await invoke('tasks:list', { filter: 'all' })).find(t => t.id === postponed.id), t => t.dueAt < Date.now(), 'desfazer restaura o prazo');
  await page.locator('.task-row').filter({ hasText: 'Agenda tarefa C' }).getByRole('button', { name: /Excluir/ }).click();
  await page.getByRole('status').filter({ hasText: 'Tarefa excluída' }).getByRole('button', { name: 'Desfazer' }).click();
  await poll(async () => (await invoke('tasks:list', { filter: 'all' })).some(t => t.title === 'Agenda tarefa C'), Boolean, 'desfazer recria a tarefa');

  // Calendário: grade com navegação por teclado, lista única por evento e atalhos.
  const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(22, 0, 0, 0);
  await invoke('events:create', { noteId: note.id, title: 'Agenda evento longo', description: 'duas noites', startAt: start.getTime(), endAt: start.getTime() + 26 * 3600000, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, allDay: false });
  for (const [w, h] of [[900, 560], [1440, 900]]) {
    await size(w, h);
    await page.getByRole('button', { name: 'Calendário' }).click(); await page.locator('.calendar-grid').waitFor();
    assert.equal(await page.locator('.agenda-list article').filter({ hasText: 'Agenda evento longo' }).count(), 1, 'evento de vários dias aparece uma vez na lista');
    assert.equal(await page.locator('.calendar-grid [role=gridcell][tabindex="0"]').count(), 1, 'um único dia na ordem de tabulação');
    assert.equal(await page.locator('.calendar-grid [role=row]').count(), 7, 'cabeçalho + 6 semanas');
    await noOverflow(`calendário ${w}`);
    await page.screenshot({ path: path.join(runDir, `calendar-${w}.png`) });
  }
  const selected = () => page.locator('.calendar-grid [role=gridcell][aria-selected=true]').getAttribute('data-day');
  await page.locator('.calendar-grid [role=gridcell][tabindex="0"]').focus();
  const first = await selected(); await page.keyboard.press('ArrowRight');
  assert.notEqual(await selected(), first, 'seta direita seleciona o dia seguinte');
  assert.equal(await page.locator('.calendar-grid [role=gridcell]').evaluateAll(cells => cells.filter(c => c === document.activeElement).length), 1, 'foco acompanha a seleção');
  await page.keyboard.press('PageDown'); await page.keyboard.press('PageUp');
  await page.locator('.calendar-main h2').click(); await page.keyboard.press('s');
  await page.locator('.calendar-grid.week').waitFor(); await page.keyboard.press('m'); await page.locator('.calendar-grid.month').waitFor();

  // Requisições: voltar a um intervalo já visitado não consulta o banco de novo.
  const eventsBefore=(await invoke('app:qa-ipc-counts'))['events:list']??0;
  await page.locator('.agenda-actions').getByRole('button', { name: 'Próximo' }).click(); await page.waitForTimeout(300);
  const eventsAfterNext=(await invoke('app:qa-ipc-counts'))['events:list']??0;
  await page.locator('.agenda-actions').getByRole('button', { name: 'Anterior' }).click(); await page.waitForTimeout(300);
  const eventsAfterBack=(await invoke('app:qa-ipc-counts'))['events:list']??0;
  assert.equal(eventsAfterBack,eventsAfterNext,'retorno ao período conhecido vem do cache, sem nova consulta');
  assert.ok(eventsAfterNext-eventsBefore<=1,'no máximo uma consulta para o outro período');

  // Excluir evento + desfazer.
  await page.locator('.agenda-list article').filter({ hasText: 'Agenda evento longo' }).getByRole('button', { name: 'Excluir' }).click();
  await page.getByRole('status').filter({ hasText: 'Evento excluído' }).getByRole('button', { name: 'Desfazer' }).click();
  await poll(async () => (await invoke('events:list', { startAt: Date.now(), endAt: Date.now() + 5 * 86400000 })).some(e => e.title === 'Agenda evento longo'), Boolean, 'desfazer recria o evento');

  // Diálogo de evento: mover o início arrasta o fim; fuso inválido é recusado.
  await page.locator('.agenda-actions').getByRole('button', { name: 'Hoje' }).click();
  await page.locator('.agenda-actions').getByRole('button', { name: 'Novo evento' }).click();
  await page.getByRole('dialog', { name: 'Novo evento' }).waitFor();
  const duration = async () => page.evaluate(() => (new Date(document.getElementById('event-end').value) - new Date(document.getElementById('event-start').value)) / 60000);
  assert.equal(await duration(), 60);
  await page.getByLabel('Início').fill('2026-12-01T15:00'); assert.equal(await duration(), 60, 'duração preservada ao mover o início');
  await page.getByRole('button', { name: '2 h' }).click(); assert.equal(await duration(), 120);
  await page.getByLabel('Título').fill('Evento fuso ruim'); await page.getByLabel('Fuso horário IANA').fill('Marte/Olympus');
  await page.getByRole('button', { name: 'Salvar evento' }).click(); assert.match(await page.getByRole('alert').innerText(), /Fuso horário desconhecido/);
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, screenshots: runDir,taskFilterCalls,calendarCallsOnReturn:eventsAfterBack-eventsAfterNext }));
} finally { await app?.close(); }
