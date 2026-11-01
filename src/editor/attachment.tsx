import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import {lazy,Suspense,useState,type ReactNode} from "react";
import { File as FileIcon, FileArchive, FileAudio, FileCode2, FileSpreadsheet, FileText, GripVertical, X } from "lucide-react";
import type {PreviewAttachment} from "../components/MediaPreview";
import { client } from "../api/client";
import { canPreviewMime, fileKindLabel, formatBytes, isRiskyToOpen } from "../lib/note-attachments";
import "../attachment-refinements.css";
const MediaPreview=lazy(()=>import("../components/MediaPreview").then(m=>({default:m.MediaPreview})));
const MediaViewer=lazy(()=>import("../components/MediaPreview").then(m=>({default:m.MediaViewer})));

function iconFor(fileName: string) {
  if (/\.(zip|rar|7z|tar|gz|tgz|bz2)$/i.test(fileName)) return FileArchive;
  if (/\.(xls|xlsx|xlsm|csv|ods|tsv)$/i.test(fileName)) return FileSpreadsheet;
  if (/\.(mp3|wav|m4a|aac|flac|opus|wma)$/i.test(fileName)) return FileAudio;
  if (/\.(json|xml|ya?ml|js|ts|tsx|jsx|css|py|java|c|cpp|cs|go|rs|sh|sql)$/i.test(fileName)) return FileCode2;
  if (/\.(doc|docx|odt|rtf|txt|md|ppt|pptx|odp)$/i.test(fileName)) return FileText;
  return FileIcon;
}

/** Cartão de arquivo para tipos sem visualizador: nome, tipo/tamanho e "Abrir" no aplicativo padrão do sistema. */
function FileCard({ item, editor, leading, trailing }: { item: PreviewAttachment; editor: NodeViewProps["editor"]; leading: ReactNode; trailing: ReactNode }) {
  const [error, setError] = useState("");
  const Icon = iconFor(item.fileName);
  const open = async () => {
    const noteId = (editor.storage as { attachment?: { noteId: string | null } }).attachment?.noteId;
    if (!noteId) { setError("Abra a nota que contém este arquivo para usá-lo."); return; }
    if (isRiskyToOpen(item.fileName) && !window.confirm(`“${item.fileName}” é um arquivo executável ou script. Abri-lo pode executar código no computador. Continuar?`)) return;
    try { await client.openAttachment(noteId, item.id); setError(""); }
    catch (err) { setError(`Não foi possível abrir o arquivo: ${(err as Error).message}`); }
  };
  return <div className="attachment-file" role="group" aria-label={`Arquivo ${item.fileName}`}>
    <div className="attachment-file-row">
      {leading}
      <span className="attachment-file-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.7} /></span>
      <span className="attachment-file-text"><strong title={item.fileName}>{item.fileName}</strong><small>{[fileKindLabel(item.fileName), formatBytes(item.byteSize)].filter(Boolean).join(" · ")} · sem prévia</small></span>
      <div className="media-controls"><button className="attachment-file-open" aria-label={`Abrir ${item.fileName}`} title="Abrir no aplicativo padrão" onClick={() => void open()}>Abrir</button>{trailing}</div>
    </div>
    {error && <p role="alert" className="media-preview-error">{error}</p>}
  </div>;
}

function AttachmentView({ node, deleteNode, editor }: NodeViewProps) {
  const [expanded, setExpanded] = useState(false);
  const item = node.attrs as PreviewAttachment;
  const editable = editor.isEditable;
  const leading = editable ? <span data-drag-handle className="attachment-drag-handle" title="Arrastar anexo" aria-label={`Arrastar ${item.fileName}`} role="img"><GripVertical size={14} aria-hidden="true"/></span> : null;
  const trailing = editable ? <button className="attachment-remove" aria-label={`Remover ${item.fileName} do texto`} title="Remover do texto (o arquivo continua nos anexos)" onClick={deleteNode}><X size={13} aria-hidden="true"/></button> : null;
  const previewable = !!item.storedName && canPreviewMime(item.mimeType);
  return <NodeViewWrapper as="figure" className={`attachment-block${previewable ? "" : " attachment-block-file"}`} contentEditable={false} data-attachment-id={item.id} data-attachment-kind={previewable ? "preview" : "file"}>
    {previewable
      ? <Suspense fallback={<figcaption role="status" className="attachment-loading">Abrindo {item.fileName}…</figcaption>}><MediaViewer item={item} inline leading={leading} trailing={trailing} onExpand={() => setExpanded(true)} /></Suspense>
      : <FileCard item={item} editor={editor} leading={leading} trailing={trailing} />}
    {expanded && <Suspense fallback={<span role="status">Abrindo visualização…</span>}><MediaPreview item={item} readOnly={!editable} onClose={() => setExpanded(false)} /></Suspense>}
  </NodeViewWrapper>;
}

export const AttachmentNode = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  /** `noteId` é definido pelo editor dono (NoteEditor) para o cartão poder abrir o arquivo; não entra no HTML salvo. */
  addStorage() { return { noteId: null as string | null }; },
  addAttributes() {
    return {
      id: { default: 0, parseHTML: el => Number(el.getAttribute("data-attachment-id")), renderHTML: attrs => ({ "data-attachment-id": attrs.id }) },
      fileName: { default: "Anexo", parseHTML: el => el.getAttribute("data-file-name"), renderHTML: attrs => ({ "data-file-name": attrs.fileName }) },
      storedName: { default: "", parseHTML: el => el.getAttribute("data-stored-name"), renderHTML: attrs => ({ "data-stored-name": attrs.storedName }) },
      mimeType: { default: "", parseHTML: el => el.getAttribute("data-mime-type"), renderHTML: attrs => ({ "data-mime-type": attrs.mimeType }) },
      byteSize: { default: 0, parseHTML: el => Number(el.getAttribute("data-byte-size")), renderHTML: attrs => ({ "data-byte-size": attrs.byteSize }) },
    };
  },
  parseHTML: () => [{ tag: "figure[data-caderno-attachment]" }],
  renderHTML({ node, HTMLAttributes }) { return ["figure", mergeAttributes(HTMLAttributes, { "data-caderno-attachment": "true" }), ["figcaption", {}, node.attrs.fileName]]; },
  addNodeView() { return ReactNodeViewRenderer(AttachmentView); },
});
