import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-settings-'));
const env = { ...process.env, CADERNO_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: [root], env });
const page = await app.firstWindow();
try {
  await page.locator('.title-input, .empty-state').first().waitFor();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('region', { name: 'Configurações' }).waitFor();
  await page.getByRole('radio', { name: 'Violeta' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '#8b5cf6');
  await page.screenshot({ path: path.join(root, 'evidence/settings/appearance.png') });
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await page.getByLabel('Tamanho do texto').fill('19');
  await page.getByRole('switch', { name: 'Barra de formatação flutuante' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-toolbar-hidden')), true);
  await page.getByRole('button', { name: /Indexação de anexos/ }).click();
  await page.getByRole('button', { name: 'Reindexar anexos' }).waitFor();
  await page.screenshot({ path: path.join(root, 'evidence/settings/indexing.png') });
  await page.getByRole('button', { name: /Avisos e erros/ }).click();
  await page.getByRole('log').waitFor();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click(); // volta às notas
  await page.locator('.new-note').click();
  await page.locator('.title-input').fill('Teste');
  await page.locator('.ProseMirror').click();
  assert.equal(await page.locator('.ProseMirror').evaluate((el) => getComputedStyle(el).fontSize), '19px');
  assert.equal(await page.locator('.editor-toolbar').evaluate((el) => getComputedStyle(el).display), 'none');
  await page.screenshot({ path: path.join(root, 'evidence/settings/editor.png') });
  await app.close(); // persistência: reabre
  const app2 = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const p2 = await app2.firstWindow(); await p2.locator('.title-input, .empty-state').first().waitFor();
  assert.equal(await p2.evaluate(() => document.documentElement.style.getPropertyValue('--accent')), '#8b5cf6');
  await app2.close();
  console.log('PASS settings');
} catch (e) { console.error('FAIL', e); await app.close().catch(() => {}); process.exit(1); }
