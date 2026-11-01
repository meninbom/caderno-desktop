import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {ExportFinishResult} from "../../shared/ipc";
import {EXPORT_LIMITS} from "../../shared/export-limits";
import { client } from "../api/client";

type Render = { storedName: string; totalPages: number; pages: { page: number; width: number; height: number; dataUrl: string }[]; error?: string };

/** Renderiza TODAS as páginas (até o limite) de um anexo PDF para JPEG; o arquivo original nunca é alterado. */
async function renderPdf(storedName: string, budget: { pages: number; chars: number }): Promise<Render> {
  const {getDocument,GlobalWorkerOptions}=await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc=workerUrl;
  const task = getDocument({ url: `caderno-asset://${storedName}`, disableAutoFetch: false });
  try {
    const doc = await task.promise;
    const out: Render = { storedName, totalPages: doc.numPages, pages: [] };
    const limit = Math.min(doc.numPages, EXPORT_LIMITS.pagesPerPdf, budget.pages);
    for (let n = 1; n <= limit; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1600 / base.width, 2200 / base.height);
      const viewport = page.getViewport({ scale: Math.max(0.5, scale) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas indisponível.");
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      let dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      if (dataUrl.length > EXPORT_LIMITS.pageDataUrlChars) dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      canvas.width = canvas.height = 0;
      if (dataUrl.length > EXPORT_LIMITS.pageDataUrlChars || budget.chars - dataUrl.length < 0) break;
      budget.chars -= dataUrl.length; budget.pages -= 1;
      out.pages.push({ page: n, width: Math.min(4000, Math.round(viewport.width)), height: Math.min(6000, Math.round(viewport.height)), dataUrl });
    }
    return out;
  } finally { void task.destroy(); }
}

export type ExportOutcome = { canceled: true } | ({ canceled: false } & ExportFinishResult);

/** Salva pendências do editor, abre o diálogo nativo, renderiza PDFs incorporados e finaliza no processo principal. */
export async function exportNote(noteId: string, format: "pdf" | "html"): Promise<ExportOutcome> {
  await new Promise<void>((resolve, reject) => window.dispatchEvent(new CustomEvent("caderno:flush-editor", { detail: { resolve, reject } })));
  const begin = await client.exportBegin(noteId, format);
  if (begin.canceled) return { canceled: true };
  try {
    const budget = { pages: EXPORT_LIMITS.totalPages, chars: EXPORT_LIMITS.totalRenderChars - 1_000_000 };
    const renders: Render[] = [];
    for (const pdf of begin.pdfs.slice(0, EXPORT_LIMITS.pdfAttachments)) {
      try { renders.push(await renderPdf(pdf.storedName, budget)); }
      catch (error) { renders.push({ storedName: pdf.storedName, totalPages: 0, pages: [], error: (error as Error).message.slice(0, 400) }); }
    }
    const result = await client.exportFinish({ token: begin.token, renders });
    return { canceled: false, ...result };
  } catch (error) {
    await client.exportAbort(begin.token).catch(() => undefined);
    throw error;
  }
}
