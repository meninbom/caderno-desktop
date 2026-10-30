import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { GripVertical, X } from "lucide-react";
import { MediaPreview, MediaViewer, type PreviewAttachment } from "../components/MediaPreview";

function AttachmentView({ node, deleteNode, editor }: NodeViewProps) {
  const [expanded, setExpanded] = useState(false);
  const item = node.attrs as PreviewAttachment;
  return <NodeViewWrapper as="figure" className="attachment-block" contentEditable={false} data-attachment-id={item.id}>
    {editor.isEditable && <div className="attachment-block-tools">
      <span data-drag-handle className="attachment-drag-handle" title="Arrastar anexo"><GripVertical size={14}/></span>
      <button aria-label={`Remover ${item.fileName} do texto`} title="Remover do texto (o arquivo continua nos anexos)" onClick={deleteNode}><X size={13}/></button>
    </div>}
    <MediaViewer item={item} inline onExpand={() => setExpanded(true)} />
    {expanded && <MediaPreview item={item} readOnly={!editor.isEditable} onClose={() => setExpanded(false)} />}
  </NodeViewWrapper>;
}

export const AttachmentNode = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
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
