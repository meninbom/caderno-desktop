import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-startup-'));
const env = { ...process.env, CADERNO_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: require('electron'), args: [root], env });
try {
  const page = await app.firstWindow();
  await page.locator('.title-input, .empty-state').first().waitFor();
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByRole('button', { name: 'Geral', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Iniciar com o Windows' });
  await page.getByText('Disponível no aplicativo instalado no Windows.').waitFor();
  assert.equal(await toggle.isDisabled(), true);
  assert.equal((await page.evaluate(() => window.cadernoDesktop.invoke('startup:set', { enabled: 'true' }))).ok, false);
  assert.equal((await page.evaluate(() => window.cadernoDesktop.invoke('startup:set', { enabled: true }))).ok, false);

  if (process.platform === 'win32') {
    // Simula a API nativa para testar a interface e o IPC sem alterar o registro do usuário.
    await app.evaluate(({ app }) => {
      Object.defineProperty(app, 'isPackaged', { value: true, configurable: true });
      let enabled = false;
      app.getLoginItemSettings = () => ({ openAtLogin: enabled });
      app.setLoginItemSettings = settings => { enabled = settings.openAtLogin; };
    });
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    await page.getByRole('button', { name: 'Geral', exact: true }).click();
    await toggle.waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Iniciar com o Windows"]').disabled);
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Iniciar com o Windows"]').getAttribute('aria-checked') === 'true');
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    await page.getByRole('button', { name: 'Geral', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Iniciar com o Windows"]').getAttribute('aria-checked') === 'true');
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Iniciar com o Windows"]').getAttribute('aria-checked') === 'false');
  }
  console.log('PASS startup settings');
} finally {
  await app.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
