/**
 * Conversores Markdown do Caderno. Reexporta a implementação pura em
 * shared/text para que main (Electron) e renderer (adapter web) usem a mesma.
 */
export { markdownFromNote, markdownToNoteHtml, noteTextForSearch, markdownHeadline } from "../../shared/text";
