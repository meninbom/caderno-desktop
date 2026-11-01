// Jornada de personalização de cadernos no Electron de desenvolvimento.
// Compila o processo principal, sobe o Vite se a porta 5173 estiver livre e grava tudo
// num perfil temporário (CADERNO_USER_DATA). Nunca abre %APPDATA%\caderno.
import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const viteUp = async () => {
  try { return (await fetch("http://localhost:5173/")).ok; } catch { return false; }
};
const compiled = spawnSync(process.execPath, ["scripts/build-electron.mjs"], { cwd: root, stdio: "inherit" });
if (compiled.status !== 0) process.exit(compiled.status ?? 1);
let viteChild = null;
if (!(await viteUp())) {
  const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
  viteChild = spawn(process.execPath, [viteBin], { cwd: root, stdio: "inherit" });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !(await viteUp())) {
    if (viteChild.exitCode !== null) throw new Error("O Vite encerrou antes de responder em localhost:5173.");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!(await viteUp())) throw new Error("O Vite não respondeu em localhost:5173.");
}
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-nb-custom-ui-"));
const userData = path.join(runDir, "profile");
const shots = path.join(runDir, "shots");
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(shots, { recursive: true });
const appData = path.join(process.env.APPDATA ?? "", "caderno").toLowerCase();
assert.ok(!userData.toLowerCase().startsWith(appData), "perfil temporário não pode ser o perfil real");

const env = { ...process.env, CADERNO_USER_DATA: userData, CADERNO_DEV: "1", CADERNO_WINDOW_WIDTH: "1280", CADERNO_WINDOW_HEIGHT: "820" };
delete env.ELECTRON_RUN_AS_NODE;

let app;
let page;
try {
  app = await electron.launch({ executablePath: require("electron"), args: [root], env, timeout: 60000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const failures = [];
  page.on("pageerror", (error) => failures.push(String(error)));
  page.on("console", (msg) => { if (msg.type() === "error") failures.push(msg.text()); });

  const shot = async (name) => { const file = path.join(shots, name); await page.screenshot({ path: file }); console.log("SHOT", file); };
  const invoke = (channel, input = null) => page.evaluate(async ({ channel, input }) => {
    const result = await window.cadernoDesktop.invoke(channel, input);
    if (!result.ok) throw new Error(`${channel}: ${result.error}`);
    return result.data;
  }, { channel, input });
  const notebookByName = async (name) => (await invoke("notebooks:list")).find((nb) => nb.name === name);
  const row = (name) => page.locator(".notebook-block").filter({ has: page.getByRole("button", { name: `Personalizar ${name}`, exact: true }) });
  const openCustomize = async (name) => {
    await row(name).locator(".notebook-row").hover();
    await page.getByRole("button", { name: `Personalizar ${name}`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Personalizar caderno" });
    await dialog.waitFor();
    return dialog;
  };
  const createNotebook = async (name) => {
    await page.getByRole("button", { name: "Criar caderno" }).click();
    const input = page.getByPlaceholder("Nome do caderno");
    await input.fill(name);
    await input.press("Enter");
    await page.getByRole("button", { name: `Personalizar ${name}`, exact: true }).waitFor({ state: "attached" });
  };
  /** Contraste WCAG entre o fundo do selo e a cor do glifo/emoji dentro dele. */
  const badgeContrast = (name) => row(name).locator(".nb-badge").first().evaluate((badge) => {
    const parse = (value) => (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const bg = parse(getComputedStyle(badge).backgroundColor);
    const svg = badge.querySelector("svg");
    const ink = parse(svg ? getComputedStyle(svg).stroke : getComputedStyle(badge).color);
    const [a, b] = [lum(bg), lum(ink)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });

  await page.locator(".brand").waitFor({ timeout: 30000 });

  // 1. Carregamento sob demanda: o diálogo não deve ser baixado antes do primeiro uso.
  await createNotebook("Pessoal");
  await createNotebook("Trabalho");
  await createNotebook("Estudos");
  const loadedBefore = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /NotebookCustomizeDialog/.test(name)));
  assert.deepEqual(loadedBefore, [], "o diálogo de personalização não deve carregar antes de ser aberto");

  // Cadernos existentes continuam com o visual padrão (sem moldura colorida).
  assert.equal(await page.locator(".sidebar .nb-badge").count(), 0);
  for (const nb of await invoke("notebooks:list")) assert.deepEqual({ icon: nb.icon, color: nb.color, description: nb.description, labels: nb.labels }, { icon: "book", color: null, description: "", labels: [] });

  // 2. Diálogo acessível: foco, estado inicial e Cancelar não persiste nada.
  let dialog = await openCustomize("Trabalho");
  assert.equal(await dialog.getByRole("button", { name: "Salvar", exact: true }).isDisabled(), true, "Salvar começa desabilitado");
  assert.equal(await dialog.getByRole("button", { name: "Restaurar padrão" }).isDisabled(), true, "Restaurar começa desabilitado no padrão");
  assert.equal(await dialog.getAttribute("aria-modal"), "true");
  await dialog.getByRole("button", { name: "Ícone Trabalho" }).click();
  await dialog.getByRole("button", { name: "Azul", exact: true }).click();
  await dialog.locator("#nb-description").fill("Projetos e reuniões");
  const labelInput = dialog.getByLabel("Nova etiqueta do caderno");
  await labelInput.fill("Trabalho");
  await labelInput.press("Enter");
  await labelInput.fill("trabalho");
  await labelInput.press("Enter"); // duplicada (sem diferenciar caixa) não entra
  await labelInput.fill("2026");
  await labelInput.press("Enter");
  assert.equal(await dialog.getByRole("list", { name: "Etiquetas deste caderno" }).locator("li").count(), 2);
  const preview = dialog.getByRole("group", { name: "Prévia do caderno" });
  assert.match(await preview.innerText(), /Trabalho[\s\S]*Projetos e reuniões/);
  assert.equal(await preview.locator(".nb-badge").count(), 1);
  await shot("01-dialog.png");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual(await notebookByName("Trabalho").then(({ icon, color, labels }) => ({ icon, color, labels })), { icon: "book", color: null, labels: [] }, "Cancelar não persiste");
  assert.equal(await page.locator(".sidebar .nb-badge").count(), 0);

  // 3. Escape fecha e devolve o foco ao botão que abriu.
  dialog = await openCustomize("Trabalho");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Personalizar Trabalho");

  // 4. Emoji inválido bloqueia o Salvar; emoji válido é aceito.
  dialog = await openCustomize("Trabalho");
  const emoji = dialog.locator("#nb-emoji-input");
  await emoji.fill("<img src=x onerror=alert(1)>");
  await dialog.getByRole("alert").filter({ hasText: "único emoji" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Salvar", exact: true }).isDisabled(), true);
  await emoji.fill("🚀");
  await dialog.getByRole("alert").filter({ hasText: "único emoji" }).waitFor({ state: "detached" });
  await dialog.getByRole("button", { name: "Azul", exact: true }).click();
  await dialog.locator("#nb-description").fill("Projetos e reuniões");
  await dialog.getByLabel("Nova etiqueta do caderno").fill("Trabalho");
  // Etiqueta digitada e não confirmada também é salva.
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const saved = await notebookByName("Trabalho");
  assert.deepEqual({ icon: saved.icon, color: saved.color, description: saved.description, labels: saved.labels }, { icon: "emoji:🚀", color: "#3b82f6", description: "Projetos e reuniões", labels: ["Trabalho"] });
  await row("Trabalho").locator(".nb-badge").waitFor();
  assert.ok((await badgeContrast("Trabalho")) >= 4.5, "selo do caderno com contraste >= 4,5:1");
  assert.match(await row("Trabalho").locator("[data-menu-item]").first().getAttribute("title"), /Projetos e reuniões[\s\S]*Etiquetas: Trabalho/);

  // 5. Etiquetas de outro caderno viram sugestões; ícone preset e cor personalizada clara mantêm contraste.
  dialog = await openCustomize("Estudos");
  await dialog.getByRole("button", { name: "Adicionar etiqueta Trabalho" }).click();
  await dialog.getByLabel("Nova etiqueta do caderno").fill("Faculdade");
  await dialog.getByLabel("Nova etiqueta do caderno").press("Enter");
  await dialog.getByRole("button", { name: "Ícone Estudos" }).click();
  await dialog.getByLabel("Cor personalizada").fill("#ffff00");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.deepEqual((await notebookByName("Estudos")).labels, ["Trabalho", "Faculdade"]);
  assert.ok((await badgeContrast("Estudos")) >= 4.5, "cor amarela clara continua legível");
  await shot("02-sidebar.png");

  // 6. Filtro por nome/etiqueta.
  await page.getByRole("button", { name: "Filtrar cadernos", exact: true }).click();
  const filter = page.getByRole("searchbox", { name: "Filtrar cadernos por nome ou etiqueta" });
  await filter.fill("#faculdade");
  await page.getByRole("button", { name: "Personalizar Estudos", exact: true }).waitFor({ state: "attached" });
  assert.equal(await page.getByRole("button", { name: "Personalizar Trabalho", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Personalizar Pessoal", exact: true }).count(), 0);
  assert.match(await page.locator(".nb-filter-summary").innerText(), /1 de 3 cadernos/);
  await filter.fill("projetos"); // descrição
  await page.getByRole("button", { name: "Personalizar Trabalho", exact: true }).waitFor({ state: "attached" });
  assert.equal(await page.getByRole("button", { name: "Personalizar Estudos", exact: true }).count(), 0);
  await filter.fill("não existe");
  await page.getByText("Nenhum caderno corresponde ao filtro.").waitFor();
  await filter.fill("");
  await page.locator(".nb-filter-chips").getByRole("button", { name: "Trabalho", exact: true }).click();
  assert.match(await page.locator(".nb-filter-summary").innerText(), /2 de 3 cadernos/);
  await filter.press("Escape");
  await page.getByRole("searchbox", { name: "Filtrar cadernos por nome ou etiqueta" }).waitFor({ state: "detached" });
  assert.equal(await page.getByRole("button", { name: "Personalizar Pessoal", exact: true }).count(), 1, "Escape limpa o filtro e mostra todos");

  // 7. Renomear, recolher e contagens preservam a personalização.
  await row("Trabalho").locator(".notebook-row").hover();
  await page.getByRole("button", { name: "Renomear Trabalho", exact: true }).click();
  const rename = page.locator(".notebook-row input");
  await rename.fill("Carreira");
  await rename.press("Enter");
  await page.getByRole("button", { name: "Personalizar Carreira", exact: true }).waitFor({ state: "attached" });
  assert.deepEqual(await notebookByName("Carreira").then(({ icon, color }) => ({ icon, color })), { icon: "emoji:🚀", color: "#3b82f6" });
  const careerId = (await notebookByName("Carreira")).id;
  const created = await invoke("notes:create", { notebookId: careerId, title: "Plano 2026" });
  await invoke("folders:create", { notebookId: careerId, name: "Metas" });
  await page.reload();
  await page.locator(".brand").waitFor();
  await row("Carreira").locator(".nb-badge").waitFor();
  assert.equal(await row("Carreira").locator(".count").first().innerText(), "1", "contagem de notas preservada");
  const chevron = page.getByRole("button", { name: /^(Recolher|Expandir)( pastas de)? Carreira$/ }).first();
  assert.equal(await chevron.getAttribute("aria-expanded"), "true");
  await chevron.click();
  assert.equal(await chevron.getAttribute("aria-expanded"), "false");
  await chevron.click();
  assert.ok(created.id);

  // 8. Tema escuro mantém o contraste do selo.
  await page.getByRole("button", { name: "Alternar tema" }).click();
  assert.ok((await badgeContrast("Carreira")) >= 4.5);
  await shot("03-dark.png");
  await page.getByRole("button", { name: "Alternar tema" }).click();

  // 9. Restaurar padrão (prévia) + Salvar volta ao visual original.
  dialog = await openCustomize("Carreira");
  await dialog.getByRole("button", { name: "Restaurar padrão" }).click();
  assert.equal(await dialog.getByRole("group", { name: "Prévia do caderno" }).locator(".nb-badge").count(), 0);
  assert.equal(await dialog.locator("#nb-emoji-input").inputValue(), "");
  assert.equal(await dialog.getByRole("list", { name: "Etiquetas deste caderno" }).count(), 0);
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const restored = await notebookByName("Carreira");
  assert.deepEqual({ icon: restored.icon, color: restored.color, description: restored.description, labels: restored.labels }, { icon: "book", color: null, description: "", labels: [] });
  assert.equal(await row("Carreira").locator(".nb-badge").count(), 0);

  // 10. Excluir continua funcionando; a nota fica sem caderno.
  await row("Carreira").locator(".notebook-row").hover();
  await page.getByRole("button", { name: "Excluir Carreira", exact: true }).click();
  await page.getByRole("button", { name: "Personalizar Carreira", exact: true }).waitFor({ state: "detached" });
  assert.equal((await invoke("notes:list", { view: "all" })).find((n) => n.title === "Plano 2026").notebookId, null);

  // 11. Canal IPC recusa payload inválido (defesa no processo principal).
  const estudosId = (await notebookByName("Estudos")).id;
  await assert.rejects(() => invoke("notebooks:customize", { id: estudosId, icon: "<img src=x onerror=alert(1)>" }), /Validação IPC/);
  await assert.rejects(() => invoke("notebooks:customize", { id: estudosId, color: "red" }), /Validação IPC/);

  // Janela compacta: diálogo contido na área útil e ações de rodapé acessíveis.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(900,560));
  await page.setViewportSize({width:900,height:560});
  dialog=await openCustomize('Estudos');
  const compact=await dialog.boundingBox();
  assert.ok(compact.x>=0&&compact.y>=0&&compact.x+compact.width<=901&&compact.y+compact.height<=561);
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).scrollIntoViewIfNeeded();
  await shot('04-dialog-900.png');
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();

  assert.equal(failures.filter((line) => !/favicon|Download the React DevTools/.test(line)).join("\n"), "");
  console.log("PASS notebook-customization-ui");
  console.log("PROFILE", userData);
} catch (error) {
  console.error("FAIL", error);
  if (page) {
    const file = path.join(shots, "fail.png");
    await page.screenshot({ path: file }).catch(() => {});
    console.log("SHOT", file);
  }
  console.log("PROFILE", userData);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  if (viteChild && viteChild.exitCode === null) viteChild.kill();
}
