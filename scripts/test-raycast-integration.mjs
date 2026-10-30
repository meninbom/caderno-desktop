import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import net from 'node:net';

const root = process.cwd();
const tempBase = path.resolve(os.tmpdir());
const runDir = fs.mkdtempSync(path.join(tempBase, 'caderno-raycast-'));
const userData = path.join(runDir, 'profile');
const scriptLocalAppData = path.join(runDir, 'raycast-local-app-data');
const raycastScriptRoot = path.join(root, 'extensions', 'raycast');
const raycastTokenPath = path.join(scriptLocalAppData, 'Caderno', 'Raycast', 'token.dpapi');
const powershell = process.env.POWERSHELL_EXE ?? 'pwsh';
fs.mkdirSync(userData, { recursive: true });
const require = createRequire(import.meta.url);
const electronBin = require('electron');
const appExecutable = process.env.CADERNO_TEST_EXECUTABLE || electronBin;
const qaPort = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('Não foi possível reservar uma porta temporária para a ponte QA.'));
    const port = address.port;
    server.close(error => error ? reject(error) : resolve(port));
  });
});
const apiUrl = `http://127.0.0.1:${qaPort}/v1`;
let app;
let page;
let token;
const results = [];

const launchEnv = { ...process.env, CADERNO_USER_DATA: userData, CADERNO_DEBUG: '1', CADERNO_QA_IPC: '1', CADERNO_QA_RAYCAST_PORT: String(qaPort) };
const scriptEnv = { ...process.env, LOCALAPPDATA: scriptLocalAppData, CADERNO_QA_IPC: '1', CADERNO_QA_RAYCAST_PORT: String(qaPort) };
delete launchEnv.ELECTRON_RUN_AS_NODE;

function runRaycastScript(file, ...args) {
  const scriptPath = path.join(raycastScriptRoot, file);
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
    encoding: 'utf8', env: scriptEnv, timeout: 20_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

async function launch() {
  app = await electron.launch({ executablePath: appExecutable, args: process.env.CADERNO_TEST_EXECUTABLE ? [] : [root], env: launchEnv, timeout: 30_000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  await page.waitForFunction(() => Boolean(window.cadernoDesktop));
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.hide();
  });
}

const ipc = (channel, input = null) => page.evaluate(async ({ channel, input }) => {
  const result = await window.cadernoDesktop.invoke(channel, input);
  if (!result.ok) throw new Error(`${channel}: ${result.error}`);
  return result.data;
}, { channel, input });

async function request(route, { method = 'GET', body, bearer = token, headers = {}, rawBody = false } = {}) {
  const requestHeaders = { ...headers };
  if (bearer) requestHeaders.Authorization = `Bearer ${bearer}`;
  let payload;
  if (body !== undefined) {
    payload = Buffer.from(rawBody ? String(body) : JSON.stringify(body));
    if (!rawBody && !Object.keys(requestHeaders).some(key => key.toLowerCase() === 'content-type')) requestHeaders['Content-Type'] = 'application/json';
  }
  const url = new URL(`${apiUrl}${route}`);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: url.hostname, port: Number(url.port), path: url.pathname + url.search, method, headers: requestHeaders }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, json: async () => JSON.parse(text) });
      });
    });
    req.setTimeout(5_000, () => req.destroy(new Error('Raycast test request timed out')));
    req.once('error', reject);
    req.end(payload);
  });
}

function readTaskRow(title) {
  const code = `const DB=require('better-sqlite3'),db=new DB(${JSON.stringify(path.join(userData, 'caderno.sqlite'))}, {readonly:true});const row=db.prepare('SELECT id,note_id AS noteId,title,due_at AS dueAt,reminder_at AS reminderAt,recurrence,priority,time_zone AS timeZone FROM tasks WHERE title=?').get(${JSON.stringify(title)});db.close();console.log(JSON.stringify(row??null));`;
  const result = spawnSync(electronBin, ['-e', code], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, CADERNO_USER_DATA: userData, ELECTRON_RUN_AS_NODE: '1' },
  });
  if (result.status !== 0) throw new Error(`SQLite Raycast QA falhou (${result.status}): ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function validateRaycastScriptMetadata() {
  const scripts = fs.readdirSync(raycastScriptRoot).filter(file => file.endsWith('.ps1'));
  assert.equal(scripts.length, 6, 'espera os seis comandos PowerShell locais');
  assert.ok(fs.existsSync(path.join(raycastScriptRoot, 'assets', 'icon.png')));
  for (const file of scripts) {
    const source = fs.readFileSync(path.join(raycastScriptRoot, file), 'utf8');
    const fields = new Map();
    for (const line of source.split(/\r?\n/)) {
      const match = /^# @raycast\.([A-Za-z0-9]+)(?:\s+(.+))?$/.exec(line);
      if (match) fields.set(match[1], match[2] ?? '');
    }
    assert.equal(fields.get('schemaVersion'), '1', `${file}: schemaVersion`);
    assert.ok(fields.get('title'), `${file}: title`);
    assert.ok(['silent', 'compact', 'fullOutput', 'inline'].includes(fields.get('mode')), `${file}: output mode`);
    assert.equal(fields.get('platform'), 'windows', `${file}: Windows-only metadata`);
    assert.equal(fields.has('author'), false, `${file}: local commands do not claim an author account`);
    for (const [key, value] of fields) {
      if (/^argument[1-3]$/.test(key)) assert.doesNotThrow(() => JSON.parse(value), `${file}: ${key} JSON metadata`);
    }
  }
}

async function check(name, fn) {
  await fn();
  results.push(name);
  console.log(`PASS ${name}`);
}

try {
  await check('official Windows Script Command metadata and local icon are present without public author attribution', async () => {
    validateRaycastScriptMetadata();
  });
  await launch();
  const enabled = await ipc('raycast:enable');
  assert.equal(enabled.port, qaPort);
  const challenge = await ipc('raycast:pair');
  assert.match(challenge.code, /^\d{10}$/);
  assert.ok(challenge.expiresAt > Date.now());

  await check('strict browser headers, pairing, bearer auth, and JSON boundary', async () => {
    const browserPair = await request('/pair', { method: 'POST', body: { code: challenge.code }, bearer: undefined, headers: { Origin: 'http://127.0.0.1:5173' } });
    assert.equal(browserPair.status, 403);
    const invalidCode = challenge.code.slice(0, 9) + String((Number(challenge.code.at(-1)) + 1) % 10);
    const invalidPair = await request('/pair', { method: 'POST', body: { code: invalidCode }, bearer: undefined });
    assert.equal(invalidPair.status, 401);
    const pairing = await request('/pair', { method: 'POST', body: { code: challenge.code }, bearer: undefined });
    assert.equal(pairing.status, 200);
    token = (await pairing.json()).token;
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal((await request('/notes?query=')).status, 200);
    assert.equal((await request('/notes?query=', { bearer: '00'.repeat(32) })).status, 401);
    assert.equal((await request('/notes?query=', { headers: { Origin: 'http://localhost' } })).status, 403);
    const noJson = await request('/notes', { method: 'POST', body: 'plain text', rawBody: true });
    assert.equal(noJson.status, 415);
    const badNote = await request('/notes', { method: 'POST', body: { title: ' ', content: '<script>bad</script>', notebookId: null } });
    assert.equal(badNote.status, 400);
  });

  let note;
  let task;
  let noDeadlineTask;
  let todayDeadlineTask;
  let upcomingDeadlineTask;
  let todayDeadlineAt;
  let todayDeadlineLocal;
  let upcomingDeadlineAt;
  await check('search, quick note and task creation persist through Electron IPC and SQLite', async () => {
    const created = await request('/notes', { method: 'POST', body: { title: 'Raycast integração local', content: 'trecho de busca caderno externo', notebookId: null } });
    assert.equal(created.status, 201);
    note = await created.json();
    assert.match(note.id, /^[0-9a-f-]{36}$/i);
    const match = await request('/notes?query=trecho%20de%20busca');
    assert.equal(match.status, 200);
    assert.equal((await match.json()).notes[0].title, note.title);
    const saved = await ipc('notes:get', { id: note.id });
    assert.match(saved.contentHtml, /trecho de busca caderno externo/);
    assert.doesNotMatch(saved.contentHtml, /<script/i);

    const taskResponse = await request('/tasks', { method: 'POST', body: { noteId: note.id, title: 'Revisar integração Raycast', priority: 'high' } });
    assert.equal(taskResponse.status, 201);
    task = await taskResponse.json();
    const nullDeadlineResponse = await request('/tasks', { method: 'POST', body: { noteId: note.id, title: 'Tarefa com prazo nulo', priority: 'low', dueAt: null } });
    assert.equal(nullDeadlineResponse.status, 201, 'new bridge keeps accepting an explicit null deadline');
    noDeadlineTask = await nullDeadlineResponse.json();

    const now = new Date();
    const todayDeadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 34, 56, 789);
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 14, 37, 12, 345);
    todayDeadlineAt = todayDeadline.getTime();
    todayDeadlineLocal = [todayDeadline.getFullYear(), todayDeadline.getMonth(), todayDeadline.getDate(), todayDeadline.getHours(), todayDeadline.getMinutes(), todayDeadline.getSeconds(), todayDeadline.getMilliseconds()];
    upcomingDeadlineAt = tomorrow.getTime();
    const todayResponse = await request('/tasks', { method: 'POST', body: { noteId: note.id, title: 'Prazo de hoje Raycast', priority: 'normal', dueAt: todayDeadlineAt } });
    assert.equal(todayResponse.status, 201);
    todayDeadlineTask = await todayResponse.json();
    const upcomingResponse = await request('/tasks', { method: 'POST', body: { noteId: note.id, title: 'Prazo próximo Raycast', priority: 'high', dueAt: upcomingDeadlineAt } });
    assert.equal(upcomingResponse.status, 201);
    upcomingDeadlineTask = await upcomingResponse.json();

    const tasks = await ipc('tasks:list', { filter: 'all', priority: 'all' });
    assert.ok(tasks.some(item => item.id === task.id && item.noteId === note.id && item.priority === 'high'));
    assert.ok(tasks.some(item => item.id === noDeadlineTask.id && item.dueAt === null));
    assert.ok(tasks.some(item => item.id === todayDeadlineTask.id && item.dueAt === todayDeadlineAt));
    assert.ok(tasks.some(item => item.id === upcomingDeadlineTask.id && item.dueAt === upcomingDeadlineAt));

    const today = await ipc('tasks:list', { filter: 'today', priority: 'all' });
    const upcoming = await ipc('tasks:list', { filter: 'upcoming', priority: 'all' });
    const all = await ipc('tasks:list', { filter: 'all', priority: 'all' });
    assert.ok(today.some(item => item.id === todayDeadlineTask.id));
    assert.ok(!today.some(item => item.id === upcomingDeadlineTask.id || item.id === task.id || item.id === noDeadlineTask.id));
    assert.ok(upcoming.some(item => item.id === upcomingDeadlineTask.id));
    assert.ok(!upcoming.some(item => item.id === todayDeadlineTask.id || item.id === task.id || item.id === noDeadlineTask.id));
    assert.ok(all.some(item => item.id === task.id) && all.some(item => item.id === noDeadlineTask.id));

    const invalidDueAtCases = [
      ['texto', '"2030-02-03T14:37:00"'],
      ['booleano', 'true'],
      ['infinito-json', '1e400'],
      ['fora-do-limite-date', '8640000000000001'],
    ];
    for (const [label, rawDueAt] of invalidDueAtCases) {
      const invalidTitle = `Prazo inválido ${label}`;
      const raw = JSON.stringify({ noteId: note.id, title: invalidTitle, priority: 'normal' }).replace(/}$/, `,"dueAt":${rawDueAt}}`);
      const invalid = await request('/tasks', { method: 'POST', body: raw, rawBody: true, headers: { 'Content-Type': 'application/json' } });
      assert.equal(invalid.status, 400, `${label} deadline is rejected`);
      assert.equal((await invalid.json()).error, 'INVALID_TASK');
      assert.equal(readTaskRow(invalidTitle), null, `${label} deadline creates no SQLite row`);
    }

    const trashedNoteResponse = await request('/notes', { method: 'POST', body: { title: 'Nota na lixeira Raycast', content: 'fixture temporário' } });
    assert.equal(trashedNoteResponse.status, 201);
    const trashedNote = await trashedNoteResponse.json();
    await ipc('notes:delete', { id: trashedNote.id });
    const trashedTaskTitle = 'Tarefa para nota na lixeira';
    const trashedTaskResponse = await request('/tasks', { method: 'POST', body: { noteId: trashedNote.id, title: trashedTaskTitle, dueAt: todayDeadlineAt } });
    assert.equal(trashedTaskResponse.status, 404);
    assert.equal((await trashedTaskResponse.json()).error, 'NOTE_NOT_FOUND');
    assert.equal(readTaskRow(trashedTaskTitle), null, 'a deleted note cannot receive a task');

    const invalidTask = await request('/tasks', { method: 'POST', body: { noteId: 'bad-id', title: 'Tarefa inválida' } });
    assert.equal(invalidTask.status, 400);
  });

  await check('deadline is stored as the exact local epoch, timezone is preserved, and reminders/recurrence stay disabled', async () => {
    const row = readTaskRow('Prazo de hoje Raycast');
    assert.ok(row);
    assert.equal(row.noteId, note.id);
    assert.equal(row.dueAt, todayDeadlineAt);
    assert.equal(row.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(row.reminderAt, null);
    assert.equal(row.recurrence, 'none');
    assert.equal(row.priority, 'normal');
    const storedLocal = new Date(row.dueAt);
    assert.deepEqual([storedLocal.getFullYear(), storedLocal.getMonth(), storedLocal.getDate(), storedLocal.getHours(), storedLocal.getMinutes(), storedLocal.getSeconds(), storedLocal.getMilliseconds()], todayDeadlineLocal);
  });

  await check('open-note request selects and focuses the note in the renderer', async () => {
    const opened = await request('/notes/open', { method: 'POST', body: { id: note.id } });
    assert.equal(opened.status, 200);
    await page.waitForFunction(title => document.querySelector('.title-input')?.value === title, note.title);
    assert.equal(await page.locator('.note-row.selected').count(), 1);
  });

  let scriptNote;
  let scriptTask;
  await check('Windows Script Commands pair with DPAPI storage and execute search, create, task, and open flows', async () => {
    const scriptChallenge = await ipc('raycast:pair');
    const pairResult = runRaycastScript('parear.ps1', scriptChallenge.code);
    assert.equal(pairResult.status, 0, `${pairResult.stdout}\n${pairResult.stderr}`);
    assert.match(pairResult.stdout, /Raycast pareado com o Caderno/);
    assert.doesNotMatch(pairResult.stdout, /[a-f0-9]{64}/i, 'o token não é impresso pelo comando');
    assert.ok(fs.existsSync(raycastTokenPath), 'pareamento cria apenas a credencial cifrada no perfil temporário');
    const encryptedCredential = fs.readFileSync(raycastTokenPath, 'utf8');
    assert.ok(encryptedCredential.length > 64);
    assert.ok(!encryptedCredential.includes(token), 'arquivo não contém a credencial em texto claro');

    const createResult = runRaycastScript('criar-nota.ps1', 'Nota por Script Command', 'Conteúdo para busca Raycast script em perfil temporário');
    assert.equal(createResult.status, 0, `${createResult.stdout}\n${createResult.stderr}`);
    const idMatch = createResult.stdout.match(/ID:\s*([0-9a-f-]{36})/i);
    assert.ok(idMatch, createResult.stdout);
    scriptNote = await ipc('notes:get', { id: idMatch[1] });
    assert.equal(scriptNote.title, 'Nota por Script Command');
    assert.match(scriptNote.contentHtml, /Conteúdo para busca/);

    const searchResult = runRaycastScript('buscar-notas.ps1', 'busca Raycast script em perfil');
    assert.equal(searchResult.status, 0, `${searchResult.stdout}\n${searchResult.stderr}`);
    assert.match(searchResult.stdout, /Nota por Script Command/);
    assert.match(searchResult.stdout, new RegExp(scriptNote.id));

    const taskResult = runRaycastScript('criar-tarefa.ps1', scriptNote.id, 'Revisar comando local', 'high');
    assert.equal(taskResult.status, 0, `${taskResult.stdout}\n${taskResult.stderr}`);
    const tasks = await ipc('tasks:list', { filter: 'all', priority: 'all' });
    scriptTask = tasks.find(item => item.noteId === scriptNote.id && item.title === 'Revisar comando local');
    assert.ok(scriptTask);
    assert.equal(scriptTask.priority, 'high');

    const openBySearch = runRaycastScript('buscar-notas.ps1', 'busca Raycast script em perfil', '1');
    assert.equal(openBySearch.status, 0, `${openBySearch.stdout}\n${openBySearch.stderr}`);
    await page.waitForFunction(title => document.querySelector('.title-input')?.value === title, scriptNote.title);
    const openById = runRaycastScript('abrir-nota.ps1', scriptNote.id);
    assert.equal(openById.status, 0, `${openById.stdout}\n${openById.stderr}`);
    await page.waitForFunction(title => document.querySelector('.title-input')?.value === title, scriptNote.title);

    const replacementChallenge = await ipc('raycast:pair');
    const replacementPair = runRaycastScript('parear.ps1', replacementChallenge.code);
    assert.equal(replacementPair.status, 0, `${replacementPair.stdout}\n${replacementPair.stderr}`);
    const afterReplacement = runRaycastScript('buscar-notas.ps1', 'busca Raycast script em perfil');
    assert.equal(afterReplacement.status, 0, `${afterReplacement.stdout}\n${afterReplacement.stderr}`);
    assert.match(afterReplacement.stdout, new RegExp(scriptNote.title), 'substituição da credencial cifrada continua funcionando');
  });

  await check('paired bridge and persisted note/task survive a real Electron restart', async () => {
    await app.close();
    app = null;
    await launch();
    const status = await ipc('raycast:status');
    assert.deepEqual(status, { enabled: true, paired: true, port: qaPort });
    const deadline = Date.now() + 15_000;
    let scriptSearch;
    while (Date.now() < deadline) {
      scriptSearch = runRaycastScript('buscar-notas.ps1', 'trecho de busca caderno externo');
      if (scriptSearch.status === 0) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(scriptSearch?.status, 0, `${scriptSearch?.stdout}\n${scriptSearch?.stderr}`);
    assert.match(scriptSearch.stdout, new RegExp(note.title));
    const savedScriptSearch = runRaycastScript('buscar-notas.ps1', 'busca Raycast script em perfil');
    assert.equal(savedScriptSearch.status, 0, `${savedScriptSearch.stdout}\n${savedScriptSearch.stderr}`);
    assert.match(savedScriptSearch.stdout, new RegExp(scriptNote.title));
    assert.equal((await request('/notes?query=', { bearer: token })).status, 401, 'repareamento substitui a credencial anterior');
    const saved = await ipc('notes:get', { id: note.id });
    assert.match(saved.contentHtml, /trecho de busca/);
    const tasks = await ipc('tasks:list', { filter: 'all', priority: 'all' });
    assert.ok(tasks.some(item => item.id === task.id && item.noteId === note.id));
    assert.ok(tasks.some(item => item.id === todayDeadlineTask.id && item.dueAt === todayDeadlineAt));
    assert.ok(tasks.some(item => item.id === upcomingDeadlineTask.id && item.dueAt === upcomingDeadlineAt));
    assert.equal(readTaskRow('Prazo de hoje Raycast').dueAt, todayDeadlineAt, 'exact due_at persists after real Electron restart');
    assert.ok((await ipc('tasks:list', { filter: 'today', priority: 'all' })).some(item => item.id === todayDeadlineTask.id));
    assert.ok((await ipc('tasks:list', { filter: 'upcoming', priority: 'all' })).some(item => item.id === upcomingDeadlineTask.id));
    assert.ok(tasks.some(item => item.id === scriptTask.id && item.noteId === scriptNote.id));
    const opened = await request('/notes/open', { method: 'POST', body: { id: note.id } });
    assert.equal(opened.status, 401, 'credencial anterior não pode abrir a nota após parear novamente');
    const openResult = runRaycastScript('abrir-nota.ps1', scriptNote.id);
    assert.equal(openResult.status, 0, `${openResult.stdout}\n${openResult.stderr}`);
    await page.waitForFunction(title => document.querySelector('.title-input')?.value === title, scriptNote.title);
  });

  await check('revocation removes authorization and stops the local listener', async () => {
    await ipc('raycast:revoke');
    assert.equal((await ipc('raycast:status')).paired, false);
    await assert.rejects(() => request('/notes?query='));
    const unpairResult = runRaycastScript('desparear.ps1');
    assert.equal(unpairResult.status, 0, `${unpairResult.stdout}\n${unpairResult.stderr}`);
    assert.equal(fs.existsSync(raycastTokenPath), false);
  });

  console.log(`PASS ${results.length} Raycast integration checks; temporary profile: ${userData}`);
} catch (error) {
  console.error('FAIL Raycast integration', error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  const resolvedTarget = path.resolve(runDir);
  if (!resolvedTarget.startsWith(`${tempBase}${path.sep}`)) throw new Error('Refusing to remove a temp path outside os.tmpdir().');
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}
