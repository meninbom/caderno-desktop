import { X } from "lucide-react";
import type { DropOverlay, DropStatus } from "../hooks/useNoteFileDrop";

/** Camada visual do arraste de arquivos: contorno tracejado enquanto se arrasta e aviso de progresso/resultado. */
export function AttachmentDropFeedback({ overlay, status, onDismiss }: { overlay: DropOverlay; status: DropStatus; onDismiss: () => void }) {
  return <>
    {overlay && <div className={`attachment-drop-overlay${overlay.refused ? " refused" : ""}`} aria-hidden="true" data-drop-overlay={overlay.refused ? "refused" : "accept"}><span>{overlay.text}</span></div>}
    {overlay?.line && <div className="attachment-drop-line" aria-hidden="true" style={{ top: overlay.line.top, left: overlay.line.left, width: overlay.line.width }} />}
    {status && <div className="attachment-drop-status" role={status.kind === "error" ? "alert" : "status"} aria-live="polite" aria-busy={status.kind === "busy"} data-kind={status.kind} data-drop-status={status.kind}>
      <span>{status.text}</span>
      {status.kind !== "busy" && <button type="button" aria-label="Dispensar aviso de anexo" title="Dispensar" onClick={onDismiss}><X size={12} aria-hidden="true" /></button>}
      {status.kind === "busy" && status.progress !== undefined && <i className="attachment-drop-progress" style={{ width: `${Math.round(status.progress * 100)}%` }} />}
    </div>}
  </>;
}
