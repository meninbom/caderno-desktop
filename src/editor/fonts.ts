import TextStyle from "@tiptap/extension-text-style";
import type { Editor } from "@tiptap/react";

export const FONT_GROUPS = [
  { label: "Sem serifa", fonts: [
    { name: "DM Sans", family: '"DM Sans", sans-serif' },
    { name: "Arial", family: "Arial, sans-serif" },
    { name: "Calibri", family: "Calibri, sans-serif" },
    { name: "Segoe UI", family: '"Segoe UI", sans-serif' },
    { name: "Verdana", family: "Verdana, sans-serif" },
    { name: "Tahoma", family: "Tahoma, sans-serif" },
    { name: "Trebuchet MS", family: '"Trebuchet MS", sans-serif' },
    { name: "Bahnschrift", family: "Bahnschrift, sans-serif" },
  ] },
  { label: "Com serifa", fonts: [
    { name: "Georgia", family: "Georgia, serif" },
    { name: "Times New Roman", family: '"Times New Roman", serif' },
    { name: "Cambria", family: "Cambria, serif" },
    { name: "Palatino Linotype", family: '"Palatino Linotype", serif' },
  ] },
  { label: "Monoespaçadas", fonts: [
    { name: "Monoespaçada", family: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' },
    { name: "Consolas", family: "Consolas, monospace" },
    { name: "Courier New", family: '"Courier New", monospace' },
  ] },
  { label: "Manuscritas", fonts: [
    { name: "Caveat", family: "Caveat, cursive" },
    { name: "Comic Sans MS", family: '"Comic Sans MS", cursive' },
    { name: "Segoe Print", family: '"Segoe Print", cursive' },
    { name: "Segoe Script", family: '"Segoe Script", cursive' },
  ] },
];

// Store the font on text spans, alongside color, so it survives HTML saves.
export const NoteTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontFamily: {
        default: null,
        parseHTML: element => element.style.fontFamily || null,
        renderHTML: attributes => attributes.fontFamily
          ? { style: `font-family: ${attributes.fontFamily}` }
          : {},
      },
      fontSize: {
        default: null,
        parseHTML: element => { const value = element.style.fontSize; return /^\d+(?:\.\d+)?px$/.test(value) ? value : null; },
        renderHTML: attributes => attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
      },
    };
  },
});

export function selectionFontSize(editor: Editor): string {
  const { selection, storedMarks } = editor.state;
  if (selection.empty) return (storedMarks ?? selection.$from.marks()).find(mark => mark.type.name === "textStyle")?.attrs.fontSize ?? "";
  let size: string | undefined;
  editor.state.doc.nodesBetween(selection.from, selection.to, node => {
    if (size === MIXED_FONT) return false;
    if (!node.isText) return;
    const value = node.marks.find(mark => mark.type.name === "textStyle")?.attrs.fontSize ?? "";
    if (size === undefined) size = value;
    else if (size !== value) size = MIXED_FONT;
  });
  return size ?? "";
}

export const MIXED_FONT = "__mixed__";

export function selectionFontFamily(editor: Editor): string {
  const { selection, storedMarks } = editor.state;
  if (selection.empty) {
    const marks = storedMarks ?? selection.$from.marks();
    return marks.find(mark => mark.type.name === "textStyle")?.attrs.fontFamily ?? "";
  }

  let family: string | undefined;
  editor.state.doc.nodesBetween(selection.from, selection.to, node => {
    if (family === MIXED_FONT) return false;
    if (!node.isText) return;
    const value = node.marks.find(mark => mark.type.name === "textStyle")?.attrs.fontFamily ?? "";
    if (family === undefined) family = value;
    else if (family !== value) family = MIXED_FONT;
  });
  return family ?? "";
}
