// Clima da Home: perfil temporário, cache, falhas/races determinísticos; LIVE_WEATHER=1 também usa o serviço real.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), root = process.cwd();
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caderno-weather-'));
const env = { ...process.env, CADERNO_USER_DATA: path.join(runDir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const KEY = 'caderno.home.weather.v1', errors = [], requests = [];
let app, page, mode = 'ok';
const city = { id: 3459712, name: 'Joinville', admin1: 'Santa Catarina', country: 'Brasil', latitude: -26.3044, longitude: -48.8487 };
const second = { ...city, id: 9, name: 'Porto Alegre', latitude: -30.03, longitude: -51.23 };
const reading = temp => ({ current: { temperature_2m: temp, weather_code: 3, is_day: 0, time: Math.floor(Date.now() / 1000) }, daily: { temperature_2m_min: [-2], temperature_2m_max: [12] } });
const widget = () => page.locator('.home-widget[data-widget-id="clock"]');
const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), KEY);
const searchCity = async query => {
  await widget().getByRole('button', { name: /Configurar cidade do clima|Alterar cidade do clima/ }).click();
  await widget().getByRole('searchbox', { name: 'Buscar cidade para o clima' }).fill(query);
  await widget().getByRole('button', { name: 'Buscar cidade', exact: true }).click();
  await widget().getByRole('list', { name: 'Cidades encontradas' }).waitFor();
};
const size = async (width, height) => {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]);
  await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
};
try {
  app = await electron.launch({ executablePath: process.env.CADERNO_QA_EXECUTABLE || require('electron'), args: process.env.CADERNO_QA_EXECUTABLE ? [] : [root], env });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('open-meteo.com')) requests.push(request.url()); });
  await page.route('https://geocoding-api.open-meteo.com/**', route => route.fulfill({ json: { results: [city, second] } }));
  await page.route('https://api.open-meteo.com/**', async route => {
    if (mode === 'offline') return route.abort('internetdisconnected');
    if (mode === 'delayed') await new Promise(resolve => setTimeout(resolve, 800));
    await route.fulfill({ json: reading(mode === 'delayed' ? 55 : 0) }).catch(() => {});
  });
  await widget().waitFor(); await size(1440, 900); await page.waitForTimeout(300);
  assert.equal(requests.length, 0, 'sem rede antes de escolher a cidade');
  await widget().getByRole('button', { name: 'Configurar cidade do clima' }).click();
  const input = widget().getByRole('searchbox', { name: 'Buscar cidade para o clima' });
  assert.equal(await input.evaluate(el => el === document.activeElement), true, 'foco na busca de cidade');
  await input.fill('Joinville'); await page.waitForTimeout(200);
  assert.equal(requests.length, 0, 'digitar não dispara chamadas por caractere');
  await widget().getByRole('button', { name: 'Buscar cidade', exact: true }).click();
  await widget().getByRole('button', { name: 'Joinville, Santa Catarina, Brasil', exact: true }).click();
  await widget().getByLabel('0 graus Celsius', { exact: true }).waitFor();
  assert.equal((await stored()).city.id, city.id);
  assert.equal((await stored()).reading.temperature, 0, 'zero graus é uma leitura válida');
  assert.match(await widget().innerText(), /Mín\. -2°[\s\S]*Máx\. 12°/);
  const beforeReload = requests.length;
  await page.reload(); await widget().getByLabel('0 graus Celsius', { exact: true }).waitFor();
  await page.waitForTimeout(250);
  assert.equal(requests.length, beforeReload, 'reabertura aproveita cache recente');
  await searchCity('Joinville');
  const sameCityRequests = requests.length;
  await widget().getByRole('button', { name: 'Joinville, Santa Catarina, Brasil', exact: true }).click();
  await widget().getByLabel('0 graus Celsius', { exact: true }).waitFor();
  assert.equal(requests.length, sameCityRequests, 'selecionar a mesma cidade preserva leitura e cache');
  mode = 'offline';
  await widget().getByRole('button', { name: 'Atualizar clima', exact: true }).click();
  await widget().getByText(/Sem atualização/).waitFor();
  await widget().getByLabel('0 graus Celsius', { exact: true }).waitFor();
  const afterFailure = requests.length;
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('focus')); });
  await page.waitForTimeout(400);
  assert.equal(requests.length, afterFailure, 'falha não dispara laço de consultas');
  await page.screenshot({ path: path.join(runDir, 'weather-offline-cache.png') });
  mode = 'delayed';
  await searchCity('Porto Alegre');
  await widget().getByRole('button', { name: 'Porto Alegre, Santa Catarina, Brasil', exact: true }).click();
  await page.waitForTimeout(100);
  await widget().getByRole('button', { name: 'Alterar cidade do clima' }).click();
  await widget().getByRole('button', { name: 'Remover cidade', exact: true }).click();
  await page.waitForTimeout(1000);
  assert.equal((await stored()).city, null, 'remover cidade cancela e descarta a resposta antiga');
  assert.equal(await widget().locator('.home-weather-reading').count(), 0);
  const beforeIdle = requests.length; await page.waitForTimeout(1200);
  assert.equal(requests.length, beforeIdle, 'sem consultas em repouso');
  const proof = { deterministic: true, live: false, requests: requests.length };
  if (process.env.LIVE_WEATHER === '1') {
    await page.unroute('https://geocoding-api.open-meteo.com/**'); await page.unroute('https://api.open-meteo.com/**');
    await searchCity('Joinville');
    await widget().getByRole('button', { name: 'Joinville, Santa Catarina, Brasil', exact: true }).click();
    await widget().locator('.home-weather-reading').waitFor({ timeout: 15000 });
    const saved = await stored();
    assert.equal(saved.city.id, city.id); assert.equal(typeof saved.reading.temperature, 'number');
    proof.live = { city: saved.city.name, temperature: saved.reading.temperature, observedAt: saved.reading.observedAt };
    for (const [w, h] of [[867, 553], [900, 560], [1440, 900]]) {
      await size(w, h);
      const layout = await page.evaluate(() => {
        const pane = document.querySelector('.home-pane'), cards = [...document.querySelectorAll('.home-widget')];
        const scroll = document.querySelector('.home-scroll');
        return { overflow: pane.scrollWidth - pane.clientWidth, vertical: scroll.scrollHeight - scroll.clientHeight, bottom: Math.max(...cards.map(card => card.getBoundingClientRect().bottom)) };
      });
      assert.ok(layout.overflow < 2, `sem overflow horizontal em ${w}`);
      assert.ok(layout.bottom <= h, `widgets completos em ${w}x${h}: ${layout.bottom}`);
      assert.ok(layout.vertical <= 1, `padrão com clima cabe sem rolagem em ${w}x${h}: ${layout.vertical}`);
      await page.screenshot({ path: path.join(runDir, `weather-live-${w}.png`) });
    }
    await page.evaluate(async () => {
      const call = async (channel, input) => { const r = await window.cadernoDesktop.invoke(channel, input); if (!r.ok) throw new Error(r.error); return r.data; };
      await call('theme:set', { value: 'dark' });
      for (const title of ['Ideias para a semana', 'Próximos passos']) await call('notes:create', { title, contentHtml: '<p>Anotações da semana.</p>' });
      const previous = JSON.parse(localStorage.getItem('caderno.appearance.v1') ?? '{}');
      localStorage.setItem('caderno.appearance.v1', JSON.stringify({ ...previous, backgroundKind: 'solid', backgroundColor: '#08090b', backgroundPattern: 'dots', patternOpacity: 12, backgroundDim: 0 }));
    });
    await page.reload(); await widget().locator('.home-weather-reading').waitFor();
    for (const [w, h] of [[867, 553], [1440, 900]]) { await size(w, h); await page.screenshot({ path: path.join(runDir, `weather-dark-${w}.png`) }); }
  }
  proof.requests = requests.length;
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(runDir, 'result.json'), JSON.stringify({ ok: true, ...proof, screenshots: runDir }, null, 2));
  console.log(JSON.stringify({ ok: true, ...proof, screenshots: runDir }));
} catch (error) { await page?.screenshot({ path: path.join(runDir, 'failure.png') }).catch(() => {}); console.error('Artifacts:', runDir); throw error; }
finally { await app?.close(); }
