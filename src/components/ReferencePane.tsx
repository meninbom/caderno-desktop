import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { ArrowLeftRight, Replace, X, Eye } from "lucide-react";
import type { NoteFull } from "../../shared/ipc";
import { client } from "../api/client";
import { buildNoteExtensions } from "../editor/extensions";

/**
 * Painel lateral SOMENTE LEITURA. Usa um editor TipTap próprio com editable=false,
 * desconectado de state.openNote, autosave e do listener de flush: nada aqui grava.
 */
export function ReferencePane({ noteId, mainNoteId, onChange, onSwap, onClose, onNavigate }: {
  noteId: string; mainNoteId: string; onChange: () => void; onSwap: () => void; onClose: () => void; onNavigate: (id: string) => void;
}) {
  const [note, setNote] = useState<NoteFull | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const editor = useEditor({ extensions: buildNoteExtensions({ resizableTables: false }), editable: false, content: "" });

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    client.getNote(noteId).then(value => {
      if (!alive) return;
      if (!value) { setNote(null); setError("Esta nota não existe mais."); } else setNote(value);
    }).catch(e => { if (alive) setError((e as Error).message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [noteId]);

  useEffect(() => {
    if (!editor || !note) return;
    editor.commands.setContent(note.contentHtml, false);
    document.querySelector(".reference-body")?.scrollTo({ top: 0 });
  }, [editor, note?.id, note?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editor) return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      event.preventDefault();
      const match = anchor.getAttribute("href")?.match(/^caderno-note:\/\/([0-9a-f-]{36})$/i);
      if (match) onNavigate(match[1]); // só troca a referência; nunca edita nem abre como principal
    };
    editor.view.dom.addEventListener("click", onClick);
    return () => editor.view.dom.removeEventListener("click", onClick);
  }, [editor, onNavigate]);

  const same = noteId === mainNoteId;
  return <aside className="reference-pane" aria-label="Nota de referência (somente leitura)" data-reference-note-id={noteId}>
    <header className="reference-header">
      <div className="reference-title"><span className="reference-badge"><Eye size={12} /> Somente leitura</span><strong title={note?.title || "Sem título"}>{note ? (note.title || "Sem título") : loading ? "Carregando…" : "Indisponível"}</strong></div>
      <div className="reference-actions">
        <button type="button" title="Trocar nota de referência" aria-label="Trocar nota de referência" onClick={onChange}><Replace size={14} /></button>
        <button type="button" title="Permutar: tornar esta a nota principal" aria-label="Permutar principal e referência" disabled={same || !note} onClick={onSwap}><ArrowLeftRight size={14} /></button>
        <button type="button" title="Fechar referência" aria-label="Fechar referência" onClick={onClose}><X size={14} /></button>
      </div>
    </header>
    <div className="reference-body" tabIndex={0} aria-label="Conteúdo da nota de referência" aria-busy={loading}>
      {error && <p role="alert" className="reference-message">{error}</p>}
      {same && <p className="reference-message">A nota de referência é a mesma nota principal. Escolha outra nota.</p>}
      {note?.deletedAt != null && <p className="reference-message">Esta nota está na lixeira.</p>}
      {note && !same && <div className="reference-content"><h1 className="reference-note-title">{note.title || "Sem título"}</h1><EditorContent editor={editor} /></div>}
    </div>
  </aside>;
}
