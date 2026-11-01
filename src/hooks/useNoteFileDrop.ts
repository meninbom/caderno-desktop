import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { client } from "../api/client";
import { buildInsertTransaction, collectDropped, describeDropReport, fileToBase64, isExternalFileDrag, planDrop, type DropReport, type DroppedEntry } from "../lib/note-attachments";

export type DropStatus = { kind: "busy" | "ok" | "error"; text: string; progress?: number } | null;
export type DropOverlayLine = { top: number; left: number; width: number };
export type DropOverlay = { refused: boolean; text: string; line?: DropOverlayLine } | null;
type Slot = { kind: "image"; storedName: string; alt: string } | { kind: "attachment"; id: number };
interface DropPoint { pos: number; after: boolean; rect?: DOMRect }
const STATUS_OK_MS = 5000;

function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, "").replace(/^Error:\s*/, "").trim() || "falha desconhecida";
}

/** Motivo para recusar a gravação (sem tocar em disco/banco); `null` quando a nota aceita anexos. */
function refusal(note: { deletedAt: number | null } | null | undefined, editor: Editor | null): string | null {
  if (!note || !editor) return "Abra uma nota para anexar arquivos.";
  if (note.deletedAt !== null) return "Esta nota está na lixeira. Restaure-a para anexar arquivos.";
  if (!editor.isEditable) return "A nota está bloqueada para edição agora. Tente novamente em instantes.";
  return null;
}

/** Posição de queda: bloco de texto → antes/depois pela metade vertical; bloco atômico (anexo/imagem) → antes/depois dele. */
function dropPoint(editor: Editor, event: DragEvent): DropPoint {
  const view = editor.view, { doc, selection } = view.state;
  if (view.dom.contains(event.target as Node)) {
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (hit) {
      const atom: PMNode | null | undefined = hit.inside >= 0 ? doc.nodeAt(hit.inside) : null;
      if (atom && atom.isBlock && atom.isAtom) {
        const dom = view.nodeDOM(hit.inside);
        const rect = dom instanceof HTMLElement ? dom.getBoundingClientRect() : undefined;
        const after = rect ? event.clientY > rect.top + rect.height / 2 : true;
        return { pos: after ? hit.inside + atom.nodeSize : hit.inside, after, rect };
      }
      const $pos = doc.resolve(hit.pos);
      let after = true, rect: DOMRect | undefined;
      if ($pos.parent.inlineContent && $pos.depth > 0) {
        const dom = view.nodeDOM($pos.before());
        if (dom instanceof HTMLElement) { rect = dom.getBoundingClientRect(); after = event.clientY > rect.top + rect.height / 2; }
      }
      return { pos: hit.pos, after, rect };
    }
  }
  if (event.clientY > view.dom.getBoundingClientRect().bottom) return { pos: doc.content.size, after: true, rect: view.dom.lastElementChild?.getBoundingClientRect() };
  return { pos: selection.to, after: true };
}

/** Linha de inserção (coordenadas relativas ao palco) para mostrar onde o bloco vai entrar, em vez do cursor inline do editor. */
function insertionLine(point: DropPoint, stage: HTMLElement): DropOverlayLine | undefined {
  if (!point.rect) return undefined;
  const box = stage.getBoundingClientRect();
  return { top: Math.round(point.after ? point.rect.bottom - box.top : point.rect.top - box.top), left: Math.round(point.rect.left - box.left), width: Math.round(point.rect.width) };
}

/**
 * Arrastar arquivos do Explorer para a nota. Salva pela API de anexos existente (imagens PNG/JPEG/WebP inline via
 * images:save, demais tipos via attachments:save) e insere tudo numa única transação (um Ctrl+Z desfaz o bloco).
 * Só reage a arrastes com `Files`; blocos internos do TipTap e notas/pastas da barra lateral passam intactos.
 */
export function useNoteFileDrop({ editor, stageRef, note, onSaved }: {
  editor: Editor | null;
  stageRef: RefObject<HTMLElement | null>;
  note: { id: string; deletedAt: number | null } | null;
  onSaved: () => void | Promise<void>;
}) {
  const [overlay, setOverlay] = useState<DropOverlay>(null);
  const [status, setStatus] = useState<DropStatus>(null);
  const noteRef = useRef(note); noteRef.current = note;
  const savedRef = useRef(onSaved); savedRef.current = onSaved;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<number | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (timer.current !== null) window.clearTimeout(timer.current); }; }, []);

  const show = useCallback((next: DropStatus) => {
    if (!alive.current) return;
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    setStatus(next);
    if (next?.kind === "ok") timer.current = window.setTimeout(() => { timer.current = null; setStatus(null); }, STATUS_OK_MS);
  }, []);
  const dismiss = useCallback(() => show(null), [show]);

  useEffect(() => { setOverlay(null); show(null); }, [note?.id, show]);

  const process = useCallback(async (editorNow: Editor, noteId: string, entries: DroppedEntry[], point: DropPoint) => {
    const plan = planDrop(entries);
    const failed = [...plan.rejected];
    if (!plan.accepted.length) { const report = describeDropReport({ saved: 0, failed, ignored: plan.ignored, inserted: false }); show({ kind: "error", text: report.text }); return; }
    const tracked = { pos: point.pos };
    const track = ({ transaction }: { transaction: Transaction }) => { if (transaction.docChanged) tracked.pos = transaction.mapping.map(tracked.pos); };
    editorNow.on("transaction", track);
    const slots: { slot: Slot; name: string }[] = [];
    try {
      const total = plan.accepted.length;
      for (let index = 0; index < total; index++) {
        const { file, mode } = plan.accepted[index];
        show({ kind: "busy", text: `Anexando ${index + 1} de ${total}: ${file.name}…`, progress: index / total });
        try {
          const data = await fileToBase64(file);
          if (mode === "image") {
            const saved = await client.saveImage(noteId, file.name, data);
            slots.push({ slot: { kind: "image", storedName: saved.storedName, alt: file.name }, name: file.name });
          } else {
            const saved = await client.saveAttachment(noteId, file.name, data);
            slots.push({ slot: { kind: "attachment", id: saved.id }, name: file.name });
          }
        } catch (error) { failed.push({ name: file.name, reason: cleanError(error) }); }
      }
      // Linhas completas (storedName/mimeType/byteSize) vêm da lista oficial de anexos, uma única consulta.
      const rows = slots.some(item => item.slot.kind === "attachment") ? await client.listAttachments(noteId) : [];
      const nodes: PMNode[] = [];
      const { schema } = editorNow.state;
      for (const { slot, name } of slots) {
        if (slot.kind === "image") { nodes.push(schema.nodes.image.create({ src: `caderno-asset://${slot.storedName}`, alt: slot.alt, title: slot.alt })); continue; }
        const row = rows.find(item => item.id === slot.id);
        if (!row) { failed.push({ name, reason: "anexado, mas não foi possível inseri-lo no texto" }); continue; }
        nodes.push(schema.nodes.attachment.create({ id: row.id, fileName: row.fileName, storedName: row.storedName ?? "", mimeType: row.mimeType ?? "", byteSize: row.byteSize }));
      }
      let inserted = false, refusedInsert: string | undefined;
      const current = noteRef.current;
      if (nodes.length) {
        if (!alive.current || editorNow.isDestroyed || current?.id !== noteId) refusedInsert = "não entraram no texto porque você trocou de nota (estão nos anexos da nota original)";
        else if (refusal(current, editorNow)) refusedInsert = "não entraram no texto porque a nota não aceita edição agora (estão nos anexos)";
        else inserted = insertNodes(editorNow, nodes, tracked.pos, point.after);
        if (!inserted && !refusedInsert) refusedInsert = "não entraram no texto porque o editor não aceitou a posição de queda (estão nos anexos)";
      }
      const report: DropReport = { saved: nodes.length, failed, ignored: plan.ignored, inserted, refusedInsert };
      const described = describeDropReport(report);
      if (alive.current) show({ kind: described.kind, text: described.text });
      if (slots.length) {
        window.dispatchEvent(new CustomEvent("caderno:attachments-changed", { detail: { noteId } }));
        await savedRef.current();
      }
    } catch (error) {
      show({ kind: "error", text: `Não foi possível anexar: ${cleanError(error)}` });
    } finally { editorNow.off("transaction", track); }
  }, [show]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!editor || !stage) return;
    const reasonNow = () => refusal(noteRef.current, editor);
    const hide = () => setOverlay(null);
    const over = (event: DragEvent) => {
      if (!isExternalFileDrag(event.dataTransfer)) return;
      // Impede o cursor de queda inline do editor (a inserção é em bloco) e autoriza a queda fora da área editável.
      event.preventDefault(); event.stopPropagation();
      const reason = reasonNow();
      if (event.dataTransfer) event.dataTransfer.dropEffect = reason ? "none" : "copy";
      const line = reason ? undefined : insertionLine(dropPoint(editor, event), stage);
      setOverlay(previous => {
        const same = previous && previous.refused === Boolean(reason) && previous.line?.top === line?.top && previous.line?.left === line?.left && previous.line?.width === line?.width;
        return same ? previous : { refused: Boolean(reason), text: reason ?? "Solte para anexar à nota", line };
      });
    };
    const leave = (event: DragEvent) => { if (!stage.contains(event.relatedTarget as Node | null)) hide(); };
    const drop = (event: DragEvent) => {
      if (!isExternalFileDrag(event.dataTransfer) || !event.dataTransfer) return;
      // Impede o Chromium de abrir/navegar para o arquivo e o ProseMirror de tratar a queda como texto.
      event.preventDefault(); event.stopPropagation(); hide();
      const reason = reasonNow();
      if (reason) { show({ kind: "error", text: reason }); return; }
      const current = noteRef.current;
      if (!current) return;
      const entries = collectDropped(event.dataTransfer);
      if (!entries.length) { show({ kind: "error", text: "Nenhum arquivo foi recebido na queda." }); return; }
      const point = dropPoint(editor, event);
      queue.current = queue.current.then(() => process(editor, current.id, entries, point)).catch(() => undefined);
    };
    stage.addEventListener("dragenter", over, true);
    stage.addEventListener("dragover", over, true);
    stage.addEventListener("dragleave", leave, true);
    stage.addEventListener("drop", drop, true);
    window.addEventListener("dragend", hide);
    window.addEventListener("drop", hide);
    return () => {
      stage.removeEventListener("dragenter", over, true);
      stage.removeEventListener("dragover", over, true);
      stage.removeEventListener("dragleave", leave, true);
      stage.removeEventListener("drop", drop, true);
      window.removeEventListener("dragend", hide);
      window.removeEventListener("drop", hide);
    };
  }, [editor, stageRef, process, show, note?.id]);

  return { overlay, status, dismiss };
}

/** Insere os blocos numa única transação (um Ctrl+Z desfaz tudo). */
function insertNodes(editor: Editor, nodes: PMNode[], pos: number, after: boolean): boolean {
  const tr = buildInsertTransaction(editor.state, nodes, pos, after);
  if (!tr) return false;
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}
