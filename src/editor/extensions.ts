import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Underline from "@tiptap/extension-underline";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { NoteTextStyle } from "./fonts";
import { AttachmentNode } from "./attachment";
import { NoteHighlight } from "./highlight";

/** Mesmo schema para o editor principal e para o painel de referência (somente leitura). */
export function buildNoteExtensions(options: { resizableTables?: boolean } = {}) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { title: "Clique para abrir no navegador padrão" }, isAllowedUri: (url, ctx) => url.startsWith("caderno-note://") || ctx.defaultValidate(url) }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: options.resizableTables ?? true }), TableRow, TableHeader, TableCell,
    Underline, NoteHighlight, NoteTextStyle, Color,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    AttachmentNode,
    Image.extend({
      addAttributes() {
        const attrs = this.parent?.() ?? {};
        return {
          ...attrs,
          src: { default: null, parseHTML: el => { const value = el.getAttribute("src") || ""; return value.startsWith("caderno-asset://") ? value : null; }, renderHTML: attrs => ({ src: attrs.src }) },
          assetId: { default: null, parseHTML: el => el.getAttribute("data-asset-id"), renderHTML: attrs => attrs.assetId ? { "data-asset-id": attrs.assetId } : {} },
        };
      },
    }).configure({ inline: false, allowBase64: false }),
  ];
}
