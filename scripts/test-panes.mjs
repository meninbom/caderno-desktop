import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-panes-'));
const env = { ...process.env, CADERNO_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: [root], env });
const page = await app.firstWindow();
const shot = (n) => page.screenshot({ path: path.join(root, 'evidence/settings', n) });
try {
  await page.locator('.new-note').waitFor();
  await page.locator('.new-note').click();
  await page.locator('.title-input').fill('Roteiro da reunião');
  // diálogo de tarefa
  await page.getByRole('button', { name: 'Tarefas' }).click();
  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  await page.getByRole('dialog', { name: 'Nova tarefa' }).waitFor();
  await page.getByRole('button', { name: 'Amanhã' }).click();
  await page.getByRole('button', { name: 'No prazo' }).click();
  await shot('task-dialog.png');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Notas' }).first().click();
  // filtros com lista estreita
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByLabel('Largura da lista de notas').fill('230');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: 'Filtros' }).click();
  await shot('filters-narrow.png');
  const overflow = await page.locator('.filter-panel').evaluate((el) => el.scrollWidth - el.clientWidth);
  assert.ok(overflow <= 0, 'filtros sem overflow: ' + overflow);
  // recolher
  await page.getByRole('button', { name: 'Recolher lista de notas' }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.notelist').evaluate((el) => el.getBoundingClientRect().width), 0);
  await page.getByRole('button', { name: 'Recolher barra lateral' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width), 0);
  await shot('collapsed.png');
  await page.keyboard.press("Control+Backslash");
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)) > 150);
  await page.getByRole('button', { name: 'Expandir lista de notas' }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.notelist').evaluate((el) => el.getBoundingClientRect().width)) > 150);
  console.log('PASS panes');
  await app.close();
} catch (e) { console.error('FAIL', e); await shot('fail.png').catch(() => {}); await app.close().catch(() => {}); process.exit(1); }
