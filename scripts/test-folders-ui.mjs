// Jornada de pastas no Electron de desenvolvimento.
// Compila o processo principal, sobe o Vite se a porta 5173 estiver livre
// e grava tudo num perfil temporário. Não abre %APPDATA%\caderno.
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
  viteChild = spawn(process.execPath, [require.resolve("vite/bin/vite.js")], { cwd: root, stdio: "inherit" });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !(await viteUp())) {
    if (viteChild.exitCode !== null) throw new Error("O Vite encerrou antes de responder em localhost:5173.");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!(await viteUp())) throw new Error("O Vite não respondeu em localhost:5173.");
}
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "caderno-folders-ui-"));
const userData = path.join(runDir, "profile");
const shots = path.join(runDir, "shots");
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(shots, { recursive: true });
const appData = path.join(process.env.APPDATA ?? "", "caderno").toLowerCase();
assert.ok(!userData.toLowerCase().startsWith(appData), "perfil temporário não pode ser o perfil real");

const env = {
  ...process.env,
  CADERNO_USER_DATA: userData,
  CADERNO_DEV: "1",
  CADERNO_WINDOW_WIDTH: "1280",
  CADERNO_WINDOW_HEIGHT: "820",
};
delete env.ELECTRON_RUN_AS_NODE;

let app;
let page;
try {
app = await electron.launch({
  executablePath: require("electron"),
  args: [root],
  env,
  timeout: 60000,
});
page = await app.firstWindow();
page.setDefaultTimeout(15000);
const failures = [];
page.on("pageerror", (error) => failures.push(String(error)));
page.on("console", (msg) => { if (msg.type() === "error") failures.push(msg.text()); });

const clickAction = async (name) => {
  const button = page.getByRole("button", { name, exact: true });
  await button.locator("xpath=ancestor::div[contains(@class,'notebook-stack-row') or contains(@class,'folder-row')]").hover();
  await button.click();
};

const shot = async (name) => {
  const file = path.join(shots, name);
  await page.screenshot({ path: file });
  console.log("SHOT", file);
};

const invoke = (channel, input = null) => page.evaluate(async ({ channel, input }) => {
  const result = await window.cadernoDesktop.invoke(channel, input);
  if (!result.ok) throw new Error(`${channel}: ${result.error}`);
  return result.data;
}, { channel, input });

  await page.locator(".brand").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Criar caderno" }).click();
  const notebookInput = page.getByPlaceholder("Nome do caderno");
  await notebookInput.fill("Pessoal");
  await notebookInput.press("Enter");
  await page.getByRole("button", { name: "Nova pasta em Pessoal" }).waitFor();
  await page.getByRole("button", { name: "Criar caderno" }).click();
  await notebookInput.fill("Trabalho");
  await notebookInput.press("Enter");
  await page.getByRole("button", { name: "Nova pasta em Trabalho" }).waitFor();

  const createFolder = async (notebook, name) => {
    await clickAction(`Nova pasta em ${notebook}`);
    const dialog = page.getByRole("dialog", { name: "Nova pasta" });
    await dialog.locator("#folder-name").fill(name);
    await dialog.getByRole("button", { name: "Criar" }).click();
  };

  await clickAction("Nova pasta em Pessoal");
  const blankDialog = page.getByRole("dialog", { name: "Nova pasta" });
  await blankDialog.locator("#folder-name").fill("   ");
  assert.equal(await blankDialog.getByRole("button", { name: "Criar" }).isDisabled(), true);
  await blankDialog.getByRole("button", { name: "Cancelar" }).click();

  await createFolder("Pessoal", "Viagem");
  await page.getByRole("button", { name: "Renomear pasta Viagem" }).waitFor();
  await createFolder("Pessoal", "viagem");
  await page.getByRole("alert").filter({ hasText: 'Já existe uma pasta com o nome "viagem" neste caderno.' }).waitFor();
  await page.getByRole("dialog", { name: "Nova pasta" }).getByRole("button", { name: "Cancelar" }).click();
  await page.locator(".error-bar button").click();
  await createFolder("Pessoal", "Arquivo");
  await page.getByRole("button", { name: "Renomear pasta Arquivo" }).waitFor();
  await createFolder("Trabalho", "Projeto");
  await page.getByRole("button", { name: "Renomear pasta Projeto" }).waitFor();
  await shot("01-folders.png");

  const folderButton = (name) => page.locator(".folder-row").filter({ hasText: name }).locator("[data-menu-item]");
  await folderButton("Viagem").click();
  await page.locator(".notelist-title-text").filter({ hasText: "Pessoal / Viagem" }).waitFor();
  assert.match(await page.locator(".notelist").innerText(), /Nenhuma nota nesta pasta/);

  await page.locator(".new-note").click();
  const title = page.locator(".title-input");
  await title.waitFor();
  await title.fill("Roteiro da viagem");
  await title.blur();
  await page.locator(".note-row").filter({ hasText: "Roteiro da viagem" }).waitFor();
  assert.equal(await page.getByLabel("Pasta da nota").inputValue(), (await invoke("folders:list")).find((folder) => folder.name === "Viagem").id);
  await shot("02-note-in-folder.png");

  await page.getByLabel("Pasta da nota").selectOption({ label: "Arquivo" });
  await page.locator(".notelist").filter({ hasText: "Nenhuma nota nesta pasta." }).waitFor();
  await folderButton("Arquivo").click();
  await page.locator(".note-row").filter({ hasText: "Roteiro da viagem" }).waitFor();
  assert.equal(await page.locator(".notelist-title-text").innerText(), "Pessoal / Arquivo");

  const notebookButton = page.locator(".notebook-block").filter({ has: page.getByRole("button", { name: "Nova pasta em Pessoal" }) }).locator("[data-menu-item]").filter({ hasText: "Pessoal" });
  await notebookButton.click();
  await page.locator(".notelist-title-text").filter({ hasText: /^Pessoal$/ }).waitFor();
  await page.locator(".note-row").filter({ hasText: "Roteiro da viagem" }).locator(".meta-tag", { hasText: "Arquivo" }).waitFor();
  await page.locator(".note-row").filter({ hasText: "Roteiro da viagem" }).click();
  await page.getByLabel("Caderno da nota").waitFor();

  await page.getByLabel("Caderno da nota").selectOption({ label: "Trabalho" });
  await page.getByLabel("Pasta da nota").selectOption({ label: "Sem pasta" });
  await page.locator(".notebook-block").filter({ has: page.getByRole("button", { name: "Nova pasta em Trabalho" }) }).locator("[data-menu-item]").filter({ hasText: "Trabalho" }).click();
  await page.locator(".note-row").filter({ hasText: "Roteiro da viagem" }).waitFor();
  assert.equal(await page.locator(".note-row").filter({ hasText: "Roteiro da viagem" }).locator(".meta-tag").count(), 0);
  await page.locator(".note-row").filter({ hasText: "Roteiro da viagem" }).click();
  await page.getByLabel("Pasta da nota").selectOption({ label: "Projeto" });
  await folderButton("Projeto").click();
  await page.locator(".notelist-title-text").filter({ hasText: "Trabalho / Projeto" }).waitFor();
  await page.locator(".note-row").filter({ hasText: "Roteiro da viagem" }).waitFor();

  page.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /Excluir a pasta "Projeto"\? As notas permanecem neste caderno\./);
    await dialog.accept();
  });
  await clickAction("Excluir pasta Projeto");
  await page.getByRole("button", { name: "Renomear pasta Projeto" }).waitFor({ state: "detached" });
  await page.locator(".notelist-title-text").filter({ hasText: /^Trabalho$/ }).waitFor();
  await page.locator(".note-row").filter({ hasText: "Roteiro da viagem" }).click();
  await page.getByLabel("Pasta da nota").waitFor();
  const options = await page.getByLabel("Pasta da nota").locator("option").allTextContents();
  assert.deepEqual(options, ["Sem pasta"]);
  assert.equal(await page.getByLabel("Pasta da nota").inputValue(), "");

  await clickAction("Renomear pasta Viagem");
  const rename = page.getByRole("dialog", { name: "Renomear pasta" });
  await rename.locator("#folder-name").fill("Passeio");
  await rename.getByRole("button", { name: "Salvar" }).click();
  await page.getByRole("button", { name: "Renomear pasta Passeio" }).waitFor();
  await clickAction("Recolher pastas de Pessoal");
  await page.getByRole("button", { name: "Renomear pasta Passeio" }).waitFor({ state: "hidden" });
  await clickAction("Expandir pastas de Pessoal");
  await page.getByRole("button", { name: "Renomear pasta Passeio" }).waitFor();
  await shot("03-after-delete.png");

  const folders = await invoke("folders:list");
  const notes = await invoke("notes:list", { view: "all" });
  assert.deepEqual(folders.map((folder) => folder.name).sort(), ["Arquivo", "Passeio"]);
  const note = notes.find((item) => item.title === "Roteiro da viagem");
  assert.equal(note.folderId, null);
  const trabalho = (await invoke("notebooks:list")).find((item) => item.name === "Trabalho");
  assert.equal(note.notebookId, trabalho.id);
  assert.equal(failures.filter((line) => !/favicon|Download the React DevTools/.test(line)).join("\n"), "");
  console.log("PASS folders-ui");
  console.log("PROFILE", userData);
} catch (error) {
  await shot("fail.png").catch(() => {});
  console.error("FAIL", error);
  console.log("PROFILE", userData);
  process.exitCode = 1;
} finally {
  await app?.close().catch(() => {});
  if (viteChild && viteChild.exitCode === null) viteChild.kill();
}
