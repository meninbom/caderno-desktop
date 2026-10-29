const parentPort=(process as NodeJS.Process & {parentPort?:Electron.ParentPort}).parentPort;
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;
const OCR_TIMEOUT_MS = 10 * 60 * 1000;
let activeChild: ChildProcess | null = null;
let canceled = false;

parentPort?.on("message", async (event: Electron.MessageEvent) => {
  const job=event.data as { id: number; filePath?: string; fileName?: string; cancel?: boolean };
  if (job.cancel) {
    canceled = true;
    activeChild?.kill();
    return;
  }
  try {
    const root = path.resolve(path.dirname(job.filePath ?? ""));
    const realRoot = fs.realpathSync(root);
    const filePath = fs.realpathSync(job.filePath ?? "");
    if (path.dirname(filePath) !== realRoot || path.basename(filePath) !== path.basename(job.filePath ?? "")) throw new Error("Caminho do anexo inválido ou fora da pasta autorizada.");
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error("O anexo não é um arquivo regular.");
    if (stat.size > MAX_BYTES) throw new Error("Anexo excede o limite de extração de 50 MB.");
    if (stat.size === 0) throw new Error("Arquivo vazio: não há texto para indexar.");
    const ext = (job.fileName ?? "").toLowerCase().split(".").pop();
    let text = "";
    let sourceKind: "text" | "pdf" | "ocr" = "text";
    if (["txt", "md"].includes(ext ?? "")) text = fs.readFileSync(filePath, "utf8");
    else if (["html", "htm"].includes(ext ?? "")) {
      const html = fs.readFileSync(filePath, "utf8");
      text = html.replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
    } else if (["png", "jpg", "jpeg"].includes(ext ?? "")) {
      const output = await runOcr({ id: job.id, imagePath: filePath });
      text = output.text;
      sourceKind = "ocr";
    } else if (ext === "pdf") {
      const bytes = fs.readFileSync(filePath);
      if (bytes.subarray(0, 1024).toString("latin1").indexOf("%PDF-") < 0) throw new Error("PDF corrompido ou cabeçalho inválido.");
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const require = createRequire(path.join(process.cwd(), "package.json"));
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
      const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, stopAtErrors: true }).promise;
      const pages: string[] = [];
      const ocrPages: number[] = [];
      try {
        if (doc.numPages > 500) throw new Error("PDF excede o limite de 500 páginas.");
        for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
          if (canceled) throw new Error("__CANCELED__");
          const page = await doc.getPage(pageNo);
          const content = await page.getTextContent();
          const pageText = content.items.map((item: any) => "str" in item ? item.str : "").join(" ").trim();
          pages.push(pageText);
          if (!pageText) ocrPages.push(pageNo);
          parentPort?.postMessage({ id: job.id, progress: Math.max(1, Math.floor(pageNo / doc.numPages * 30)), checkpoint: pageNo, totalPages: doc.numPages, stage: "Lendo camada de texto" });
          page.cleanup();
        }
      } finally {
        await doc.destroy().catch(() => undefined);
      }
      if (ocrPages.length) {
        const output = await runOcr({ id: job.id, pdfPath: filePath, pages: ocrPages, pageCount: doc.numPages });
        for (const [pageNo, pageText] of Object.entries(output.pages)) pages[Number(pageNo) - 1] = pageText;
        sourceKind = pages.some(Boolean) && ocrPages.length < doc.numPages ? "pdf" : "ocr";
      } else sourceKind = "pdf";
      text = pages.map((value, index) => value ? `[Página ${index + 1}] ${value}` : "").filter(Boolean).join("\n");
      if (text.length > MAX_TEXT) throw new Error("Texto extraído excede 2 MB.");
    } else throw new Error("Tipo de anexo sem extrator de texto configurado.");
    if (canceled) throw new Error("__CANCELED__");
    text = text.replace(/\u0000/g, "").slice(0, MAX_TEXT).trim();
    if (!text) throw new Error("Nenhum texto legível encontrado no anexo.");
    parentPort?.postMessage({ id: job.id, ok: true, text, sourceKind });
    setImmediate(() => process.exit(0));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    parentPort?.postMessage({ id: job.id, ok: false, canceled: canceled || message === "__CANCELED__", error: message === "__CANCELED__" ? "Extração cancelada." : message });
    setImmediate(() => process.exit(canceled || message === "__CANCELED__" ? 2 : 0));
  }
});

function runOcr(input: { id: number; imagePath?: string; pdfPath?: string; pages?: number[]; pageCount?: number }): Promise<{ text: string; pages: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const powershell = path.join(process.env.WINDIR ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const unpackedScript = process.resourcesPath ? path.join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "ocr-winrt.ps1") : "";
    const script = unpackedScript && fs.existsSync(unpackedScript) ? unpackedScript : path.join(__dirname, "ocr-winrt.ps1");
    if (!fs.existsSync(powershell) || !fs.existsSync(script)) { reject(new Error("OCR local indisponível: Windows PowerShell 5 ou script OCR WinRT não encontrado.")); return; }
    const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script];
    if (input.pdfPath) args.push("-PdfPath", input.pdfPath, "-PageNumbers", (input.pages ?? []).join(","), "-PageCount", String(input.pageCount ?? 0));
    else args.push("-ImagePath", input.imagePath ?? "");
    const child = spawn(powershell, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    activeChild = child;
    let stdout = "", stderr = "", settled = false, timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, OCR_TIMEOUT_MS);
    timeout.unref();
    const finish = (error?: Error, result?: { text: string; pages: Record<string, string> }) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); if (activeChild === child) activeChild = null;
      if (error) reject(error); else resolve(result ?? { text: "", pages: {} });
    };
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
      if (stdout.length > 8 * 1024 * 1024) { child.kill(); finish(new Error("Saída OCR excede o limite de 8 MB.")); return; }
      for (const line of stdout.split(/\r?\n/).slice(0, -1)) {
        const progress = /^OCR_PROGRESS:(\d+):(\d+):(\d+)$/.exec(line);
        if (progress) parentPort?.postMessage({ id: input.id, progress: Math.min(99, 30 + Math.floor(Number(progress[1]) / Math.max(1, Number(progress[3])) * 69)), checkpoint: Number(progress[2]), totalPages: Number(progress[3]), stage: "OCR local" });
      }
    });
    child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString("utf8")).slice(-12000); });
    child.once("error", error => finish(new Error(`Não foi possível iniciar OCR WinRT: ${error.message}`)));
    child.once("close", code => {
      if (canceled) { finish(new Error("__CANCELED__")); return; }
      if (timedOut) { finish(new Error("OCR local excedeu o limite de 10 minutos; nenhum texto parcial foi indexado.")); return; }
      if (code !== 0) { const detail=stderr.match(/OCR_WINRT_ERROR: ([^\r\n]+)/)?.[1]??(stderr.trim()||"OCR WinRT indisponível ou falhou.");finish(new Error(detail.slice(0,500)));return; }
      const pages: Record<string, string> = {};
      const image = /OCR_RESULT_BASE64:([A-Za-z0-9+/=]*)/.exec(stdout);
      for (const match of stdout.matchAll(/^OCR_PAGE:(\d+):([A-Za-z0-9+/=]*)$/gm)) pages[match[1]] = Buffer.from(match[2], "base64").toString("utf8");
      const text = image ? Buffer.from(image[1], "base64").toString("utf8") : "";
      if (!Object.keys(pages).length && !text.trim()) { finish(new Error("OCR local executado; nenhum texto foi reconhecido.")); return; }
      finish(undefined, { text, pages });
    });
  });
}
