/**
 * Converte o HTML de exportação em PDF numa BrowserWindow isolada: sessão em
 * memória própria, sandbox, JavaScript desativado, nenhuma navegação ou
 * requisição além do arquivo temporário e de data: URLs. A janela e a pasta
 * temporária são destruídas em sucesso, erro ou tempo esgotado.
 */
import { BrowserWindow, session } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { escapeHtml } from "./repo/note-html";

export const exportState = { openWindows: 0, tempDirs: new Set<string>() };

export async function htmlToPdf(html: string, options: { tempRoot: string; title: string; timeoutMs?: number }): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(options.tempRoot, "caderno-export-"));
  exportState.tempDirs.add(dir);
  const file = path.join(dir, "nota.html");
  const fileUrl = pathToFileURL(file).href;
  let win: BrowserWindow | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    fs.writeFileSync(file, html, { encoding: "utf8", flag: "wx" });
    const ses = session.fromPartition(`caderno-export-${crypto.randomUUID()}`, { cache: false });
    ses.setPermissionRequestHandler((_c, _p, callback) => callback(false));
    ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !(details.url === fileUrl || details.url.startsWith("data:")) }));
    win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true, spellcheck: false, images: true, webgl: false } });
    exportState.openWindows++;
    const contents = win.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", event => event.preventDefault());
    contents.on("will-redirect", event => event.preventDefault());
    const work = (async () => {
      await win!.loadURL(fileUrl);
      await new Promise(resolve => setTimeout(resolve, 250)); // fontes data: já decodificadas
      const footer = `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:7.5px;color:#6e7781;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>${escapeHtml(options.title.slice(0, 120))}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
      return contents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footer, generateDocumentOutline: true });
    })();
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Tempo esgotado ao gerar o PDF.")), options.timeoutMs ?? 120_000); });
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (win && !win.isDestroyed()) { win.destroy(); }
    if (win) exportState.openWindows--;
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); exportState.tempDirs.delete(dir); } catch { /* removida no próximo início */ }
  }
}
