import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const fixture = fs.readFileSync(path.join(root, "tests", "fixtures", "clipper", "article.html"));
const extractor = path.join(root, "extensions", "clipper", "extractor.js");
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(fixture);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}/artigo/1`;
const executablePath = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
if (!fs.existsSync(executablePath)) throw new Error(`Chromium de teste ausente: ${executablePath}`);
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage();
try {
  await page.goto(pageUrl);
  await page.addScriptTag({ path: extractor });
  const before = await page.locator("nav").innerText();
  const article = await page.evaluate(() => globalThis.extractClip("article"));
  const after = await page.locator("nav").innerText();
  const selection = await page.evaluate(() => {
    const paragraph = document.querySelector("article p");
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selected = getSelection();
    selected.removeAllRanges();
    selected.addRange(range);
    return globalThis.extractClip("selection");
  });
  const bookmark = await page.evaluate(() => globalThis.extractClip("bookmark"));
  const empty = await page.evaluate(() => { getSelection().removeAllRanges(); return globalThis.extractClip("selection"); });
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  check(before === after && /Menu repetido/.test(after), "a página original conserva a navegação");
  check(article.quality === "good", `qualidade do artigo: ${article.quality}`);
  check(article.title === "Receita de pão" && article.author === "Ana Souza", "título e autor");
  check(article.sourceDate === "2024-05-01T12:00:00Z" && article.sourceDateKind === "publicação", "data de publicação");
  check(article.html.includes("<table") && article.html.includes("500 g") && article.html.includes("<strong>") && article.html.includes("Pão"), "tabela, negrito e título interno");
  check(article.html.includes(`http://127.0.0.1:${port}/dicas`) && !/javascript:/i.test(article.html), "link relativo resolvido e javascript removido");
  check(!article.html.includes("Menu repetido") && !article.html.includes("Rodapé legal") && !article.html.includes("Anúncio lateral") && !article.html.includes("Topo do site"), "menus e rodapé fora do artigo");
  check(article.html.includes("pão assado") && !/<img/i.test(article.html), "alt da imagem vira texto e a imagem não entra");
  check(article.html.includes("forno(180)") && article.text.includes("Ação"), "código e acento");
  check(!article.html.includes("scriptRan"), "script não entra no html");
  check(selection.html.includes("<strong>") && selection.text.includes("farinha"), "seleção conserva negrito");
  check(bookmark.text === "Resumo curto do pão" && !bookmark.html.includes("Misture"), "favorito não leva o corpo");
  check(empty.error === "SELECTION_EMPTY", "seleção vazia");
  if (failures.length) throw new Error(failures.join("; "));
  console.log(JSON.stringify({ passed: true, checks: 13, browser: "playwright-chromium", executablePath, gesture: "nenhum — o script injeta o extrator; não abre o popup nem concede activeTab" }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
