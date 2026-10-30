import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { FONT_GROUPS, MIXED_FONT, selectionFontFamily } from "../editor/fonts";
import { buildNoteExtensions } from "../editor/extensions";
import fixWebmDuration from "fix-webm-duration";
import { MediaPreview, type PreviewAttachment } from "./MediaPreview";
import {
  Bold, Italic, Code, List, ListOrdered, SquareCheck, Quote, Link2, CodeXml, Folder,
  Heading1, Heading2, Heading3, Undo2, Redo2, Star, Pin, RotateCcw, Trash2, AudioLines,
  Paperclip, X, FileDown, Columns2, BookmarkPlus, FileText, FileCode2, NotebookPen, Book, Table2, ImagePlus, Underline as UnderlineIcon, AlignLeft, AlignCenter, AlignRight, Mic, Type, Ellipsis,
} from "lucide-react";
import { useAppStore } from "../state/store";
import { client } from "../api/client";
import { useDismissablePopover } from "../hooks/useDismissablePopover";
import { TaskDialog } from "./AgendaDialogs";
import { WritingLayoutControl } from "./WritingLayoutControl";
import type { Appearance } from "../state/appearance";
import { NoteBacklinks } from "./NoteBacklinks";
import { NoteTags } from "./NoteTags";
import { NotePicker } from "./NotePicker";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ReferencePane } from "./ReferencePane";
import { SaveTemplateDialog } from "./TemplateDialogs";
import { TextColorPicker } from "./TextColorPicker";
import { exportNote } from "../export/exportNote";

function ToolBtn({ on, title, onClick, children }: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={on ? "on" : undefined} title={title} aria-label={title} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );
}

const SAVE_DEBOUNCE_MS = 600;

export function NoteEditor({ appearance, onAppearanceChange }: { appearance: Appearance; onAppearanceChange: (patch: Partial<Appearance>) => void }) {
  const { state, dispatch, refreshMeta, refreshNotes, openNote, saveNoteContent } = useAppStore();
  const note = state.openNote;
  const noteRef = useRef(note);
  noteRef.current = note;
  const pendingPatch = useRef<{ title?: string; contentHtml?: string }>({});
  const pendingForId = useRef<string | null>(null);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [linkDialog, setLinkDialog] = useState(false);
  const [internalDialog, setInternalDialog] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<{id:string;title:string}|null>(null);
  const [anchorText, setAnchorText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const [altDialog,setAltDialog]=useState(false);
  const [imageAlt,setImageAlt]=useState("");
  const [imagePreview,setImagePreview]=useState<{src:string;alt:string}|null>(null);
  const [taskDialog,setTaskDialog]=useState(false);
  const linkSelection = useRef<{ from: number; to: number } | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const internalDialogRef = useDialogFocus(internalDialog, () => setInternalDialog(false));
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [referencePicker, setReferencePicker] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<{ id: string; title: string } | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ text: string; kind: "busy" | "ok" | "error" } | null>(null);
  const exporting = useRef(false);
  const referencePickerRef = useDialogFocus(referencePicker, () => setReferencePicker(false));
  const exportPopover = useDismissablePopover(exportMenu, () => setExportMenu(false));
  const [refWidth, setRefWidth] = useState<number>(() => { const v = Number(localStorage.getItem("caderno.reference.width")); return Number.isFinite(v) && v >= 240 ? v : 420; });
  const splitRef = useRef<HTMLDivElement>(null);
  const clampRef = (value: number) => { const total = splitRef.current?.clientWidth ?? 1200; return Math.round(Math.min(Math.max(240, value), Math.max(240, total - 360))); };
  const setRefWidthPersist = (value: number) => { const next = clampRef(value); setRefWidth(next); try { localStorage.setItem("caderno.reference.width", String(next)); } catch { /* preferência opcional */ } };

  const flushSave = useCallback(async () => {
    while (saveInFlight.current) {
      const previous = saveInFlight.current;
      const saved = await previous;
      if (saveInFlight.current === previous) saveInFlight.current = null;
      if (!saved) return false;
    }
    const id = pendingForId.current;
    pendingForId.current = null;
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    if (!id) return true;
    if (patch.title === undefined && patch.contentHtml === undefined) return true;
    const work = (async () => {
      const saved = await saveNoteContent(id, patch);
      if (!saved) {
        // Falha: devolve a edição à fila para não perder o texto e deixa o chamador saber.
        if (pendingForId.current === null || pendingForId.current === id) { pendingForId.current = id; pendingPatch.current = { ...patch, ...pendingPatch.current }; }
        return false;
      }
      await refreshNotes();
      return true;
    })();
    saveInFlight.current = work;
    try { return await work; }
    finally { if (saveInFlight.current === work) saveInFlight.current = null; }
  }, [saveNoteContent, refreshNotes]);

  useEffect(()=>{const flush=(event:Event)=>{const detail=(event as CustomEvent<{resolve:()=>void;reject:(error:unknown)=>void}>).detail;void flushSave().then(ok=>ok?detail.resolve():detail.reject(new Error('Não foi possível salvar a nota antes de continuar.')),detail.reject)};window.addEventListener('caderno:flush-editor',flush);return()=>window.removeEventListener('caderno:flush-editor',flush)},[flushSave]);

  const runExport = useCallback(async (format: "pdf" | "html") => {
    const current = noteRef.current;
    if (!current || exporting.current) return;
    exporting.current = true; setExportMenu(false);
    setExportStatus({ text: `Preparando ${format.toUpperCase()}…`, kind: "busy" });
    try {
      const result = await exportNote(current.id, format);
      if (result.canceled) setExportStatus(null);
      else setExportStatus({ text: `${format.toUpperCase()} salvo em ${result.filePath}${result.warnings.length ? ` (${result.warnings.length} aviso(s): ${result.warnings[0]})` : ""}`, kind: "ok" });
    } catch (error) { setExportStatus({ text: `Falha ao exportar ${format.toUpperCase()}: ${(error as Error).message}`, kind: "error" }); }
    finally { exporting.current = false; }
  }, []);
  useEffect(() => {
    const exportEvent = (event: Event) => { const format = (event as CustomEvent<"pdf" | "html">).detail; if (format === "pdf" || format === "html") void runExport(format); };
    const templateEvent = () => { if (noteRef.current && noteRef.current.deletedAt === null) setSaveTemplateOpen(true); };
    const referenceEvent = () => { if (noteRef.current) setReferencePicker(true); };
    window.addEventListener("caderno:export-note", exportEvent); window.addEventListener("caderno:save-template", templateEvent); window.addEventListener("caderno:pick-reference", referenceEvent);
    return () => { window.removeEventListener("caderno:export-note", exportEvent); window.removeEventListener("caderno:save-template", templateEvent); window.removeEventListener("caderno:pick-reference", referenceEvent); };
  }, [runExport]);

  const scheduleSave = useCallback((title?: string, contentHtml?: string) => {
    const current = noteRef.current;
    if (!current) return;
    pendingForId.current = current.id;
    if (title !== undefined) pendingPatch.current.title = title;
    if (contentHtml !== undefined) pendingPatch.current.contentHtml = contentHtml;
    dispatch({ type: "saveState", state: "saving" });
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void flushSave(); }, SAVE_DEBOUNCE_MS);
  }, [flushSave, dispatch]);

  const editor = useEditor({
    extensions: [...buildNoteExtensions(), Placeholder.configure({ placeholder: "Escreva algo…" })],
    content: note?.contentHtml ?? "",
    onUpdate: ({ editor }) => scheduleSave(undefined, editor.getHTML()),
    onBlur: () => { if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); void flushSave(); } },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (!editor?.view.dom.contains(document.activeElement)) return;
      if (e.key === "+" || e.key === "=") { e.preventDefault(); onAppearanceChange({ editorZoom: Math.min(200, appearance.editorZoom + 10) }); }
      else if (e.key === "-") { e.preventDefault(); onAppearanceChange({ editorZoom: Math.max(50, appearance.editorZoom - 10) }); }
      else if (e.key === "0") { e.preventDefault(); onAppearanceChange({ editorZoom: 100 }); }
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !editor?.view.dom.contains(e.target as Node)) return;
      e.preventDefault(); onAppearanceChange({ editorZoom: Math.max(50, Math.min(200, appearance.editorZoom + (e.deltaY < 0 ? 10 : -10))) });
    };
    window.addEventListener("keydown", onKey); window.addEventListener("wheel", onWheel, { passive: false });
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("wheel", onWheel); };
  }, [editor, appearance.editorZoom, onAppearanceChange]);

  // Troca de nota: salva edição pendente da nota anterior e aplica o conteúdo novo.
  useEffect(() => {
    if (!editor) return;
    if (pendingForId.current && pendingForId.current !== (note?.id ?? null)) {
      if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
      void flushSave();
    }
    if (note) editor.commands.setContent(note.contentHtml, false);
  }, [note?.id, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editor) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if(target instanceof HTMLImageElement){event.preventDefault();setImagePreview({src:target.src,alt:target.alt||"Imagem da nota"});return;}
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (anchor && !anchor.getAttribute("href")?.startsWith("caderno-note://")) {
        const href = anchor.getAttribute("href") || "";
        if (/^(https?:\/\/|mailto:)/i.test(href)) { event.preventDefault(); void client.openExternal(href); }
        return;
      }
      const match = anchor?.getAttribute("href")?.match(/^caderno-note:\/\/([0-9a-f-]{36})$/i);
      if (!anchor || !match) return;
      event.preventDefault();
      void (async () => {
        const destination = await client.getNote(match[1]);
        if (!destination) { dispatch({ type: "error", message: "O destino deste link não existe mais; a nota pode ter sido excluída definitivamente." }); return; }
        if (destination.deletedAt !== null) { dispatch({ type: "error", message: `A nota “${destination.title || "Sem título"}” está na lixeira. Restaure-a para abrir o destino.` }); return; }
        if (!(await flushSave())) return;
        await openNote(match[1]);
      })();
    };
    editor.view.dom.addEventListener("click", onClick);
    return () => editor.view.dom.removeEventListener("click", onClick);
  }, [editor, dispatch, flushSave, openNote]);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (titleRef.current) titleRef.current.value = note?.title ?? ""; }, [note?.id]);

  const chain = () => editor!.chain().focus();
  const openLinkDialog = () => {
    linkSelection.current = { from: editor!.state.selection.from, to: editor!.state.selection.to };
    setLinkUrl(editor!.getAttributes("link").href || "");
    setLinkError("");
    setLinkDialog(true);
    window.setTimeout(() => linkInput.current?.focus(), 0);
  };
  const closeLinkDialog = () => {
    setLinkDialog(false);
    window.setTimeout(() => editor!.commands.focus(), 0);
  };
  const applyLink = () => {
    const value = linkUrl.trim();
    if (!value) {
      const selection = linkSelection.current;
      if (selection) editor!.chain().focus().setTextSelection(selection).unsetLink().run();
      closeLinkDialog();
      return;
    }
    let parsed: URL;
    try { parsed = new URL(value); } catch { setLinkError("Informe um endereço válido (https://, http:// ou mailto:)."); return; }
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) {
      setLinkError("Por segurança, use um endereço https://, http:// ou mailto:."); return;
    }
    const selection = linkSelection.current;
    if (selection) editor!.chain().focus().setTextSelection(selection).setLink({ href: parsed.href }).run();
    closeLinkDialog();
  };

  const openInternalLinkDialog = () => {
    const selection = editor!.state.selection;
    linkSelection.current = { from: selection.from, to: selection.to };
    setAnchorText(selection.empty ? "" : editor!.state.doc.textBetween(selection.from, selection.to, " "));
    setSelectedTarget(null); setInternalDialog(true);
  };
  const insertInternalLink = () => {
    const target = selectedTarget;
    const text = anchorText.trim() || target?.title || "Sem título";
    const selection = linkSelection.current;
    if (!target || !selection || !text) return;
    const href = `caderno-note://${target.id}`;
    editor!.chain().focus().insertContentAt(selection, [{ type: "text", text, marks: [{ type: "link", attrs: { href, target: null, class: null, rel: null, style: null, title: null } }] }]).run();
    setInternalDialog(false);
    requestAnimationFrame(() => editor!.commands.focus());
  };
  const removeCurrentLink = () => {
    const selection=linkSelection.current;
    if(selection) editor!.chain().focus().setTextSelection(selection).unsetLink().run();
    setInternalDialog(false);
  };

  const addImageFile = async (file:File) => {
    if(!note||!editor)return;
    if(file.size>10*1024*1024){dispatch({type:"error",message:"Imagem excede o limite de 10 MB."});return;}
    try {const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));const saved=await client.saveImage(note.id,file.name,btoa(binary));if(!chain().setImage({src:`caderno-asset://${saved.storedName}`,alt:file.name,title:file.name}).run())throw new Error("O editor não aceitou a imagem nesta posição.");}
    catch(err){dispatch({type:"error",message:`Imagem não inserida: ${(err as Error).message}`});}
  };
  useEffect(()=>{if(!editor)return;const dom=editor.view.dom;const raster=(dt:DataTransfer|null)=>{if(!dt)return null;const files=[...dt.files];for(const item of [...dt.items])if(item.kind==="file"){const f=item.getAsFile();if(f&&!files.includes(f))files.push(f);}return files.find(x=>x.type.startsWith("image/"))??null;};const paste=(e:ClipboardEvent)=>{const f=raster(e.clipboardData);if(f){e.preventDefault();void addImageFile(f);}};const drop=(e:DragEvent)=>{const f=raster(e.dataTransfer);if(f){e.preventDefault();void addImageFile(f);}};dom.addEventListener("paste",paste);dom.addEventListener("drop",drop);return()=>{dom.removeEventListener("paste",paste);dom.removeEventListener("drop",drop);};},[editor,note?.id]);

  useEffect(() => {
    const on = !document.documentElement.hasAttribute("data-no-spellcheck");
    document.querySelectorAll(".ProseMirror, .title-input").forEach((el) => el.setAttribute("spellcheck", String(on)));
  }, [editor, note?.id]);

  if (!note || !editor) {
    return <div className="editor-pane"><div className="editor-scroll"><div className="empty-state" style={{ margin: "18vh auto", maxWidth: 420 }}><NotebookPen size={24} strokeWidth={1.6} /><span>Selecione ou crie uma nota.</span></div></div></div>;
  }
  const inTrash = note.deletedAt !== null;
  const fontFamily = selectionFontFamily(editor);
  const knownFont = FONT_GROUPS.some(group => group.fonts.some(font => font.family === fontFamily));

  const deleteNote = async () => {
    saveTimer.current = null;
    await client.deleteNote(note.id);
    dispatch({ type: "openNote", note: null, noteId: null });
    await refreshNotes();
    await refreshMeta();
  };

  return (
    <div className="editor-pane">
      <div className="editor-topbar" title="Links externos abrem no navegador padrão ao clicar">
        <div className="note-zoom" role="group" aria-label="Zoom da nota"><button aria-label="Diminuir zoom" title="Ctrl/Cmd −" onClick={() => onAppearanceChange({ editorZoom: Math.max(50, appearance.editorZoom - 10) })}>−</button><span>{appearance.editorZoom}%</span><button aria-label="Aumentar zoom" title="Ctrl/Cmd +" onClick={() => onAppearanceChange({ editorZoom: Math.min(200, appearance.editorZoom + 10) })}>+</button><button aria-label="Redefinir zoom" title="Ctrl/Cmd 0" onClick={() => onAppearanceChange({ editorZoom: 100 })}>100%</button></div>
        <button type="button" className="reference-toggle" aria-pressed={referenceId !== null} title={referenceId ? "Fechar nota de referência" : "Abrir outra nota ao lado (somente leitura)"} aria-label={referenceId ? "Fechar nota de referência" : "Abrir nota de referência ao lado"} onClick={() => { if (referenceId) setReferenceId(null); else { setPickerTarget(null); setReferencePicker(true); } }}><Columns2 size={14} /><span>Lado a lado</span></button>
        <WritingLayoutControl appearance={appearance} update={onAppearanceChange} />
      </div>
      <div className={`editor-split${referenceId ? " with-reference" : ""}`} ref={splitRef} style={referenceId ? ({ "--reference-w": `${refWidth}px` } as React.CSSProperties) : undefined}>
      <div className="editor-stage editor-main-stage">
      <div className="editor-scroll">
        <div className="editor-content">
          <textarea
            ref={titleRef}
            className="title-input"
            placeholder="Título da nota"
            rows={1}
            readOnly={inTrash}
            onChange={(e) => {
              scheduleSave(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onBlur={() => { if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); void flushSave(); } }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "ArrowDown") {
                e.preventDefault();
                editor.commands.focus("start");
              }
            }}
          />
          <EditorContent editor={editor} readOnly={inTrash} />
          {!inTrash&&<NoteBacklinks id={note.id} revision={state.notes} onOpen={async id=>{if(await flushSave())await openNote(id)}}/>}
        </div>
      </div>
      {!inTrash && (
        <div className="editor-toolbar" role="toolbar" aria-label="Formatação">
          <ToolBtn title="Desfazer" onClick={() => chain().undo().run()}><Undo2 size={14} /></ToolBtn>
          <ToolBtn title="Refazer" onClick={() => chain().redo().run()}><Redo2 size={14} /></ToolBtn>
          <span className="sep" />
          <select
            className="toolbar-font"
            aria-label="Fonte do texto"
            title={editor.isActive("codeBlock") || editor.isActive("code") ? "Código usa fonte monoespaçada" : "Aplicar fonte à seleção ou ao próximo texto digitado"}
            disabled={editor.isActive("codeBlock") || editor.isActive("code")}
            value={fontFamily}
            onChange={event => chain().setMark("textStyle", { fontFamily: event.target.value || null }).removeEmptyTextStyle().run()}
          >
            <option value="">Padrão do editor</option>
            {fontFamily === MIXED_FONT && <option value={MIXED_FONT} disabled>Várias fontes</option>}
            {fontFamily && fontFamily !== MIXED_FONT && !knownFont && <option value={fontFamily}>{fontFamily.split(",")[0].replace(/["']/g, "")}</option>}
            {FONT_GROUPS.map(group => <optgroup key={group.label} label={group.label}>
              {group.fonts.map(font => <option key={font.family} value={font.family} style={{ fontFamily: font.family }}>{font.name}</option>)}
            </optgroup>)}
          </select>
          <span className="sep" />
          <ToolBtn title="Título 1" on={editor.isActive("heading", { level: 1 })} onClick={() => chain().toggleHeading({ level: 1 }).run()}><Heading1 size={14} /></ToolBtn>
          <ToolBtn title="Título 2" on={editor.isActive("heading", { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()}><Heading2 size={14} /></ToolBtn>
          <ToolBtn title="Título 3" on={editor.isActive("heading", { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()}><Heading3 size={14} /></ToolBtn>
          <span className="sep" />
          <ToolBtn title="Negrito (Ctrl+B)" on={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}><Bold size={14} /></ToolBtn>
          <ToolBtn title="Itálico (Ctrl+I)" on={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}><Italic size={14} /></ToolBtn>
          <TextColorPicker editor={editor} disabled={inTrash} />
          <ToolBtn title="Código inline" on={editor.isActive("code")} onClick={() => chain().toggleCode().run()}><Code size={14} /></ToolBtn>
          <details className="toolbar-menu"><summary title="Formatação adicional"><Type size={15}/></summary><div className="toolbar-popover"><ToolBtn title="Sublinhar" on={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}><UnderlineIcon size={14}/></ToolBtn><ToolBtn title="Alinhar à esquerda" on={editor.isActive({textAlign:"left"})} onClick={()=>chain().setTextAlign("left").run()}><AlignLeft size={14}/></ToolBtn><ToolBtn title="Centralizar" on={editor.isActive({textAlign:"center"})} onClick={()=>chain().setTextAlign("center").run()}><AlignCenter size={14}/></ToolBtn><ToolBtn title="Alinhar à direita" on={editor.isActive({textAlign:"right"})} onClick={()=>chain().setTextAlign("right").run()}><AlignRight size={14}/></ToolBtn></div></details>
          <span className="sep" />
          <ToolBtn title="Lista com marcadores" on={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}><List size={14} /></ToolBtn>
          <ToolBtn title="Lista numerada" on={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}><ListOrdered size={14} /></ToolBtn>
          <ToolBtn title="Checklist" on={editor.isActive("taskList")} onClick={() => chain().toggleTaskList().run()}><SquareCheck size={14} /></ToolBtn>
          <ToolBtn title="Citação" on={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}><Quote size={14} /></ToolBtn>
          <ToolBtn title="Bloco de código" on={editor.isActive("codeBlock")} onClick={() => chain().toggleCodeBlock().run()}><CodeXml size={14} /></ToolBtn>
          <details className="toolbar-menu"><summary title="Mais ferramentas"><Ellipsis size={16}/></summary><div className="toolbar-popover toolbar-tools-popover">
            <ToolBtn title="Link" onClick={openLinkDialog}><Link2 size={14}/></ToolBtn><ToolBtn title="Link para nota" onClick={()=>void openInternalLinkDialog()}><NotebookPen size={14}/></ToolBtn>
            <span className="sep"/><ToolBtn title="Inserir tabela" onClick={()=>chain().insertTable({rows:3,cols:3,withHeaderRow:true}).run()}><Table2 size={14}/></ToolBtn><ToolBtn title="Adicionar linha" onClick={()=>chain().addRowAfter().run()}>＋L</ToolBtn><ToolBtn title="Excluir linha" onClick={()=>chain().deleteRow().run()}>−L</ToolBtn><ToolBtn title="Adicionar coluna" onClick={()=>chain().addColumnAfter().run()}>＋C</ToolBtn><ToolBtn title="Excluir coluna" onClick={()=>chain().deleteColumn().run()}>−C</ToolBtn><ToolBtn title="Alternar cabeçalho" onClick={()=>chain().toggleHeaderRow().run()}>H</ToolBtn><ToolBtn title="Excluir tabela" onClick={()=>chain().deleteTable().run()}><Trash2 size={14}/></ToolBtn>
            <span className="sep"/><ToolBtn title="Inserir imagem" onClick={()=>document.getElementById("note-image-input")?.click()}><ImagePlus size={14}/></ToolBtn><input id="note-image-input" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{const f=e.currentTarget.files?.[0];if(f)void addImageFile(f);e.currentTarget.value="";}} /><ToolBtn title="Texto alternativo da imagem" onClick={()=>{if(!editor.isActive("image")){dispatch({type:"error",message:"Selecione uma imagem para editar o texto alternativo."});return;}setImageAlt(editor.getAttributes("image").alt||"");setAltDialog(true);}}>Alt</ToolBtn>
          </div></details>
        </div>
      )}
      </div>
      {referenceId && <>
        <div className="reference-resizer" role="separator" aria-orientation="vertical" aria-label="Ajustar largura da nota de referência" aria-valuemin={240} aria-valuenow={refWidth} tabIndex={0}
          onKeyDown={e => { if (e.key === "ArrowLeft") { e.preventDefault(); setRefWidthPersist(refWidth + 24); } if (e.key === "ArrowRight") { e.preventDefault(); setRefWidthPersist(refWidth - 24); } }}
          onPointerDown={e => { e.preventDefault(); const target = e.currentTarget; target.setPointerCapture(e.pointerId); const startX = e.clientX, startW = refWidth; const move = (ev: PointerEvent) => setRefWidth(clampRef(startW + (startX - ev.clientX))); const up = (ev: PointerEvent) => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.releasePointerCapture(ev.pointerId); setRefWidthPersist(startW + (startX - ev.clientX)); }; target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); }} />
        <ReferencePane noteId={referenceId} mainNoteId={note.id}
          onChange={() => { setPickerTarget(null); setReferencePicker(true); }}
          onClose={() => setReferenceId(null)}
          onNavigate={id => setReferenceId(id)}
          onSwap={async () => { const old = note.id, next = referenceId; try { if (!(await flushSave())) return; await openNote(next); setReferenceId(old); } catch (err) { dispatch({ type: "error", message: `Não foi possível permutar: ${(err as Error).message}` }); } }} />
      </>}
      </div>

      {referencePicker && <div className="overlay dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setReferencePicker(false); }}><section ref={referencePickerRef} className="modal internal-link-modal" role="dialog" aria-modal="true" aria-labelledby="reference-picker-title">
        <header className="dialog-heading"><span><h3 id="reference-picker-title">Nota de referência</h3><p>Escolha outra nota para consultar ao lado. Ela abre somente para leitura e não é alterada.</p></span><button aria-label="Fechar seleção de referência" onClick={() => setReferencePicker(false)}><X size={17} /></button></header>
        <NotePicker value={pickerTarget} onChange={setPickerTarget} excludeId={note.id} autoFocus />
        <div className="row"><button onClick={() => setReferencePicker(false)}>Cancelar</button><button className="primary" disabled={!pickerTarget} onClick={() => { if (pickerTarget) { setReferenceId(pickerTarget.id); setReferencePicker(false); } }}>Abrir ao lado</button></div>
      </section></div>}
      {saveTemplateOpen && <SaveTemplateDialog noteId={note.id} noteTitle={note.title} onClose={() => setSaveTemplateOpen(false)} onSaved={result => { setSaveTemplateOpen(false); setExportStatus({ text: `Modelo “${result.template.name}” salvo${result.copiedAssets ? ` com ${result.copiedAssets} mídia(s)` : ""}${result.skippedAssets.length ? `; ${result.skippedAssets.length} mídia(s) indisponível(is) ficaram de fora` : ""}.`, kind: "ok" }); }} />}

      {linkDialog && <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeLinkDialog(); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title" onKeyDown={(e) => { if (e.key === "Escape") closeLinkDialog(); }}>
          <h3 id="link-dialog-title">Inserir link</h3>
          <label htmlFor="link-url">Endereço</label>
          <input ref={linkInput} id="link-url" aria-label="Endereço do link" value={linkUrl} onChange={(e) => { setLinkUrl(e.target.value); setLinkError(""); }} onKeyDown={(e) => { if (e.key === "Enter") applyLink(); }} placeholder="https://exemplo.com" />
          {linkError && <span role="alert" className="saved-warn">{linkError}</span>}
          <div className="row">
            <button onClick={closeLinkDialog}>Cancelar</button>
            {(editor.isActive("link") || editor.getHTML().includes("<a ")) && <button onClick={() => { const selection = linkSelection.current; if (selection) editor.chain().focus().setTextSelection(selection).unsetLink().run(); closeLinkDialog(); }}>Remover link</button>}
            <button className="primary" onClick={applyLink}>Salvar</button>
          </div>
        </section>
      </div>}

      {internalDialog && <div className="overlay dialog-overlay" onMouseDown={e => { if(e.target===e.currentTarget)setInternalDialog(false); }}><section ref={internalDialogRef} className="modal internal-link-modal" role="dialog" aria-modal="true" aria-labelledby="internal-link-title">
        <header className="dialog-heading"><span><h3 id="internal-link-title">Vincular nota</h3><p>Encontre a nota de destino e escolha o texto do link.</p></span><button aria-label="Fechar vínculo de nota" onClick={()=>setInternalDialog(false)}><X size={17}/></button></header>
        <NotePicker value={selectedTarget} onChange={setSelectedTarget} excludeId={note.id} autoFocus />
        <div className="dlg-field"><label htmlFor="note-link-anchor">Texto do link</label><input id="note-link-anchor" value={anchorText} maxLength={500} onChange={e=>setAnchorText(e.target.value)} placeholder="Usar o título da nota selecionada" /></div>
        <div className="row"><button onClick={()=>setInternalDialog(false)}>Cancelar</button>{editor.isActive("link")&&<button onClick={removeCurrentLink}>Remover link</button>}<button className="primary" disabled={!selectedTarget} onClick={insertInternalLink}>Inserir link</button></div>
      </section></div>}

      {altDialog&&<div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setAltDialog(false);}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="image-alt-title"><h3 id="image-alt-title">Texto alternativo</h3><label htmlFor="image-alt">Descreva a imagem</label><input id="image-alt" maxLength={500} value={imageAlt} onChange={e=>setImageAlt(e.target.value)}/><div className="row"><button onClick={()=>setAltDialog(false)}>Cancelar</button><button className="primary" onClick={()=>{editor.chain().focus().updateAttributes("image",{alt:imageAlt.trim()}).run();setAltDialog(false);}}>Salvar</button></div></section></div>}
      {imagePreview&&<InlineImageDialog src={imagePreview.src} alt={imagePreview.alt} onClose={()=>setImagePreview(null)}/>}
      {taskDialog&&<TaskDialog initialNoteId={note.id} onClose={()=>setTaskDialog(false)} onSaved={()=>{setTaskDialog(false);dispatch({type:'error',message:'Tarefa criada e vinculada a esta nota.'});window.setTimeout(()=>dispatch({type:'error',message:null}),2500);}}/>}

      <div className="editor-status">
        <span>
          {state.saveState === "saving" && "Salvando…"}
          {state.saveState === "saved" && state.lastSavedAt !== null && (
            <span className="saved-ok">Salvo {new Date(state.lastSavedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
          )}
          {state.saveState === "error" && <span className="saved-warn" title="Verifique a barra de erro">Problema ao salvar</span>}
        </span>
        {exportStatus && <span className={`export-status ${exportStatus.kind}`} role={exportStatus.kind === "error" ? "alert" : "status"} data-export-status={exportStatus.kind}>{exportStatus.text}<button className="icon" aria-label="Dispensar aviso" onClick={() => setExportStatus(null)}><X size={11} /></button></span>}
        <span className="spacer" />
        {!inTrash && (
          <div className="status-actions">
            <NoteNotebook />
            <NoteFolderSelect />
            <NoteTags />
            <NoteAttachments onInsertImage={(storedName,alt)=>editor.chain().focus().setImage({src:`caderno-asset://${storedName}`,alt,title:alt}).run()} onInsertMedia={(item,sourceNoteId)=>{if(noteRef.current?.id!==sourceNoteId)return;if(item.mimeType?.startsWith("image/")){editor.chain().focus().setImage({src:`caderno-asset://${item.storedName}`,alt:item.fileName}).run();return;}editor.chain().focus().insertContent([{type:"attachment",attrs:item},{type:"paragraph"}]).run();}} />
            <AudioRecorder key={note.id} noteId={note.id} onSaved={async()=>{await refreshNotes();}} />
            <TranscriptionPanel noteId={note.id} editor={editor} />
            <button className="icon" aria-label="Criar tarefa ligada a esta nota" title="Criar tarefa ligada a esta nota" onClick={()=>setTaskDialog(true)}>＋</button>
            <span className="sep" />
            <button className="icon" title={note.favorited ? "Remover dos favoritos" : "Marcar como favorita"} onClick={async () => { const updated = await client.setFavorite(note.id, !note.favorited); if (updated) dispatch({ type: "openNote", note: updated, noteId: updated.id }); await refreshNotes(); await refreshMeta(); }}>
              <Star size={14} style={note.favorited ? { fill: "var(--star)", color: "var(--star)" } : undefined} />
            </button>
            <button className="icon" title={note.pinned ? "Desafixar" : "Fixar no topo"} onClick={async () => { const updated = await client.setPinned(note.id, !note.pinned); if (updated) dispatch({ type: "openNote", note: updated, noteId: updated.id }); await refreshNotes(); }}>
              <Pin size={14} style={note.pinned ? { color: "var(--accent)" } : undefined} />
            </button>
            <button className="icon" title="Salvar como modelo" aria-label="Salvar como modelo" onClick={() => setSaveTemplateOpen(true)}><BookmarkPlus size={14} /></button>
            <span className="pop-anchor" ref={exportPopover.rootRef}>
              <button ref={exportPopover.triggerRef} className="icon" title="Exportar em PDF ou HTML" aria-label="Exportar em PDF ou HTML" aria-expanded={exportMenu} disabled={exporting.current} onClick={() => setExportMenu(v => !v)}><FileText size={14} /></button>
              {exportMenu && <div className="menu-pop export-pop" role="menu">
                <button className="menu-row" role="menuitem" data-export-format="pdf" onClick={() => void runExport("pdf")}><FileText size={13} /> Exportar como PDF</button>
                <button className="menu-row" role="menuitem" data-export-format="html" onClick={() => void runExport("html")}><FileCode2 size={13} /> Exportar como HTML</button>
              </div>}
            </span>
            <button className="icon" title="Exportar em Markdown" onClick={async () => { try { await client.exportMarkdown(note.id); } catch (err) { dispatch({ type: "error", message: `Falha ao exportar: ${(err as Error).message}` }); } }}><FileDown size={14} /></button>
            <button className="icon" title="Mover para a lixeira" style={{ color: "var(--text-muted)" }} onClick={() => void deleteNote()}><Trash2 size={14} /></button>
          </div>
        )}
        {inTrash && (
          <div className="status-actions">
            <button onClick={async () => { await client.restoreNote(note.id); await refreshNotes(); await refreshMeta(); }}>
              <RotateCcw size={13} /> Restaurar
            </button>
            <button style={{ color: "var(--danger)" }} onClick={async () => {
              if (!window.confirm("Excluir esta nota definitivamente? Esta ação não pode ser desfeita.")) return;
              await client.purgeNote(note.id);
              dispatch({ type: "openNote", note: null, noteId: null });
              await refreshNotes();
              await refreshMeta();
            }}><Trash2 size={13} /> Excluir definitivamente</button>
          </div>
        )}
      </div>
    </div>
  );
}

function InlineImageDialog({src,alt,onClose}:{src:string;alt:string;onClose:()=>void}){
  const [zoom,setZoom]=useState(100),[error,setError]=useState("");
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const close=document.querySelector<HTMLElement>(".image-preview-close");close?.focus();const key=(e:KeyboardEvent)=>{if(e.key==="Escape")onClose();};document.addEventListener("keydown",key);return()=>{document.removeEventListener("keydown",key);previous?.focus();};},[]);
  return <div className="media-preview-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="media-preview" role="dialog" aria-modal="true" aria-label="Visualizar imagem" onKeyDown={e=>{if(e.key==="Tab"){const buttons=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}}><header><strong>{alt}</strong><div className="media-controls"><button aria-label="Reduzir zoom" onClick={()=>setZoom(v=>Math.max(25,v-25))}>−</button><span>{zoom}%</span><button aria-label="Ampliar zoom" onClick={()=>setZoom(v=>Math.min(300,v+25))}>＋</button><button className="image-preview-close" aria-label="Fechar visualização" onClick={onClose}>Fechar</button></div></header><div className="media-preview-body">{error?<p role="alert">{error}</p>:<img className="preview-image" src={src} alt={alt} style={{width:`${zoom}%`}} onError={()=>setError("Não foi possível decodificar esta imagem.")}/>}</div></section></div>;
}

function NoteFolderSelect() {
  const { state, refreshMeta, refreshNotes, openNote } = useAppStore();
  const note = state.openNote!;
  const folders = state.folders.filter(folder => folder.notebookId === note.notebookId);
  const change = async (value: string) => {
    await client.moveNoteToFolder(note.id, value === "" ? null : value);
    await refreshNotes();
    await refreshMeta();
    await openNote(note.id);
  };
  return (
    <span className="status-field" title="Mover para pasta">
      <Folder size={13} />
      <select className="status-select" aria-label="Pasta da nota" value={note.folderId ?? ""} disabled={note.notebookId === null} onChange={e => void change(e.target.value)}>
        <option value="">Sem pasta</option>
        {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
    </span>
  );
}

function NoteNotebook() {
  const { state, refreshMeta, refreshNotes, openNote } = useAppStore();
  const note = state.openNote!;

  const change = async (value: string) => {
    const notebookId = value === "" ? null : Number(value);
    await client.moveNote(note.id, notebookId);
    await refreshNotes();
    await refreshMeta();
    await openNote(note.id);
  };

  return (
    <span className="status-field" title="Mover para caderno">
      <Book size={13} />
      <select
        className="status-select"
        aria-label="Caderno da nota"
        value={note.notebookId === null ? "" : String(note.notebookId)}
        onChange={(e) => void change(e.target.value)}
      >
        <option value="">Sem caderno</option>
        {state.notebooks.map((nb) => (
          <option key={nb.id} value={String(nb.id)}>{nb.name}</option>
        ))}
      </select>
    </span>
  );
}

function NoteAttachments({onInsertImage,onInsertMedia}:{onInsertImage:(storedName:string,alt:string)=>void;onInsertMedia:(item:PreviewAttachment,noteId:string)=>void}) {
  const { state, refreshNotes } = useAppStore();
  const note = state.openNote!;
  const [items, setItems] = useState<PreviewAttachment[]>([]);
  const [preview,setPreview]=useState<PreviewAttachment|null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popover = useDismissablePopover(menuOpen, () => setMenuOpen(false));
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const closePreview=useCallback(()=>{setPreview(null);window.setTimeout(()=>popover.triggerRef.current?.focus(),0);},[popover.triggerRef]);

  const load = useCallback(async () => {
    setItems(await client.listAttachments(note.id));
  }, [note.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setMenuOpen(false); setError(null); }, [note.id]);
  useEffect(()=>{
    const open=async(event:Event)=>{const detail=(event as CustomEvent<{noteId:string;attachmentId:number}>).detail;if(detail?.noteId!==note.id)return;const found=(await client.listAttachments(note.id)).find(a=>a.id===detail.attachmentId);if(found&&(["application/pdf","text/html"].includes(found.mimeType??"")||found.mimeType?.startsWith("image/")||found.mimeType?.startsWith("video/")||found.mimeType?.startsWith("audio/"))){setItems(await client.listAttachments(note.id));setMenuOpen(false);setPreview(found);}};
    window.addEventListener("caderno:preview-attachment",open);return()=>window.removeEventListener("caderno:preview-attachment",open);
  },[note.id]);

  const onFiles = async (files: FileList | null,inlineImages=false) => {
    if (!files) return;
    try {
      for (const f of Array.from(files)) {
        const buf = await f.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
        }
        if(inlineImages&&f.type.startsWith("image/")){const saved=await client.saveImage(note.id,f.name,btoa(binary));onInsertImage(saved.storedName,f.name);}
        else { const saved=await client.saveAttachment(note.id, f.name, btoa(binary)); if(inlineImages){const added=(await client.listAttachments(note.id)).find(item=>item.id===saved.id);if(added)onInsertMedia(added,note.id);} }
      }
      await load();
      if(inlineImages)setMenuOpen(false);
      await refreshNotes();
    } catch (err) {
      setError(`${(err as Error).message}`);
    }
  };

  return (
    <span className="pop-anchor" ref={popover.rootRef}>
      <button ref={popover.triggerRef} aria-expanded={menuOpen} className={items.length > 0 ? "active" : undefined} title="Anexos" aria-label="Anexos" onClick={() => { void load(); setMenuOpen((v) => !v); }}>
        <Paperclip size={13} />{items.length > 0 ? items.length : null}
      </button>
      <input ref={inputRef} type="file" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      <input ref={mediaInputRef} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,text/html,video/webm,video/mp4,video/ogg,.ogv" hidden onChange={(e)=>{void onFiles(e.target.files,true);e.target.value="";}} />
      {menuOpen && (
        <div className="menu-pop attach-pop" role="menu">
          <button className="menu-row" role="menuitem" onClick={() => inputRef.current?.click()}><Paperclip size={13} /> Adicionar arquivo</button>
          <button className="menu-row" role="menuitem" onClick={() => mediaInputRef.current?.click()}><ImagePlus size={13} /> Inserir mídia na nota</button>
          {error && <span className="saved-warn" style={{ color: "var(--danger)", fontSize: 11, padding: "0 8px" }}>{error}</span>}
          {items.length === 0 && (
            <span style={{ padding: "4px 8px", fontSize: 12, color: "var(--text-faint)" }}>Nenhum arquivo anexado.</span>
          )}
          {items.map((a) => (
            <div key={`att-${a.id}`} className="attach-row">
              <Paperclip size={12} />
              <button className="ghost" title="Abrir arquivo" onClick={async () => { if(a.mimeType?.startsWith("image/")||a.mimeType==="application/pdf"||a.mimeType==="text/html"||a.mimeType?.startsWith("video/")||a.mimeType?.startsWith("audio/")){setMenuOpen(false);setPreview(a);setError(null);return;}try { await client.openAttachment(note.id, a.id); setError(null); } catch (err) { setError(`Não foi possível abrir o anexo: ${(err as Error).message}`); } }}>
                {a.fileName}
              </button>
              {(a.mimeType?.startsWith("image/")||a.mimeType==="application/pdf"||a.mimeType==="text/html"||a.mimeType?.startsWith("video/")||a.mimeType?.startsWith("audio/"))&&<button className="icon" aria-label={`Visualizar ${a.fileName}`} title="Visualizar" onClick={()=>{setMenuOpen(false);setPreview(a);}}>◉</button>}
              {(a.mimeType?.startsWith("image/")||a.mimeType==="application/pdf"||a.mimeType==="text/html"||a.mimeType?.startsWith("video/")||a.mimeType?.startsWith("audio/"))&&<button className="icon" aria-label={`Incorporar ${a.fileName} ao texto`} title="Incorporar ao texto na posição do cursor" onClick={()=>{setMenuOpen(false);onInsertMedia(a,note.id);}}>＋</button>}
              <span className="size">{Math.ceil(a.byteSize / 1024)} KiB</span>
              <button className="icon" title="Remover" onClick={async () => { if (window.confirm(`Remover o anexo “${a.fileName}”?`)) { await client.deleteAttachment(note.id, a.id); await load(); } }}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {preview&&<MediaPreview item={preview} onClose={closePreview}/>}
    </span>
  );
}

function AudioRecorder({noteId,onSaved}:{noteId:string;onSaved:()=>Promise<void>}){
  const [open,setOpen]=useState(false),[status,setStatus]=useState<"idle"|"recording"|"paused"|"ready">("idle"),[seconds,setSeconds]=useState(0),[error,setError]=useState(""),[blob,setBlob]=useState<Blob|null>(null);
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),chunks=useRef<Blob[]>([]),timer=useRef<number|null>(null),url=useRef<string|null>(null),bytes=useRef(0),elapsedMs=useRef(0),segmentStarted=useRef(0),stopRef=useRef<(keep:boolean)=>void>(()=>{});
  const cleanup=useCallback(()=>{if(timer.current!==null)window.clearInterval(timer.current);timer.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;recorder.current=null;},[]);
  useEffect(()=>()=>{cleanup();if(url.current)URL.revokeObjectURL(url.current);},[cleanup]);
  const begin=async()=>{
    setError("");setBlob(null);chunks.current=[];bytes.current=0;elapsedMs.current=0;setSeconds(0);
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){setError("Gravação indisponível neste dispositivo.");return;}
    try{
      const media=await navigator.mediaDevices.getUserMedia({audio:true});stream.current=media;
      const mime=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":"";
      const rec=new MediaRecorder(media,mime?{mimeType:mime}:undefined);recorder.current=rec;
      rec.ondataavailable=e=>{if(e.data.size){bytes.current+=e.data.size;if(bytes.current>50*1024*1024){setError("Gravação excedeu 50 MB; a gravação parcial permanece disponível para salvar.");stopRef.current(true);return;}chunks.current.push(e.data);}};
      rec.onerror=()=>{setError("A gravação foi interrompida. Você pode tentar novamente.");cleanup();setStatus("idle");};
      media.getAudioTracks().forEach(t=>t.addEventListener("ended",()=>{if(rec.state!=="inactive"){setError("O dispositivo de áudio foi desconectado. A gravação parcial continua disponível.");stopRef.current(true);}}));
      rec.start(500);segmentStarted.current=performance.now();setStatus("recording");timer.current=window.setInterval(()=>setSeconds(s=>{if(s>=599){stopRef.current(true);return 600;}return s+1;}),1000);
    }catch(e){cleanup();setStatus("idle");setError((e as DOMException).name==="NotAllowedError"?"Permissão do microfone negada.":"Não foi possível abrir o microfone. Verifique se há um dispositivo disponível.");}
  };
  const stop=(keep:boolean)=>{
    const rec=recorder.current;if(!rec){cleanup();setStatus("idle");return;}
    if(rec.state==="recording")elapsedMs.current+=performance.now()-segmentStarted.current;
    const finish=async()=>{let result=new Blob(chunks.current,{type:rec.mimeType||"audio/webm"});try{if(keep&&result.size&&result.type.includes("webm"))result=await fixWebmDuration(result,elapsedMs.current,{logger:false});}catch(e){setError(`Não foi possível preparar a duração do áudio: ${(e as Error).message}`);}cleanup();if(keep&&result.size){setBlob(result);setStatus("ready");}else{chunks.current=[];setBlob(null);setStatus("idle");}};
    rec.addEventListener("stop",finish,{once:true});try{rec.stop();}catch{finish();}
  };
  stopRef.current=stop;
  const save=async()=>{
    if(!blob)return;setError("");
    try{const raw=await blob.arrayBuffer();const bytes=new Uint8Array(raw);let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));await client.saveAttachment(noteId,`gravacao-${new Date().toISOString().replace(/[:.]/g,"-")}.audio.webm`,btoa(binary));setBlob(null);chunks.current=[];setStatus("idle");setOpen(false);await onSaved();}
    catch(e){setError(`Falha ao salvar o áudio. A gravação permanece disponível: ${(e as Error).message}`);}
  };
  const previewUrl=useMemo(()=>{if(!blob)return null;const next=URL.createObjectURL(blob);if(url.current)URL.revokeObjectURL(url.current);url.current=next;return next;},[blob]);
  return <span className="audio-recorder">
    <button className="icon" title="Gravar áudio nesta nota" aria-label="Gravar áudio nesta nota" onClick={()=>setOpen(v=>!v)}><Mic size={14}/></button>
    {open&&<div className="audio-recorder-panel" role="group" aria-label="Gravação de áudio">
      <strong>{status==="recording"?"Gravando":status==="paused"?"Pausado":status==="ready"?"Áudio pronto":"Gravar áudio"}</strong><span>{String(Math.floor(seconds/60)).padStart(2,"0")}:{String(seconds%60).padStart(2,"0")} / 10:00</span>
      {status==="idle"&&<button onClick={()=>void begin()}>Iniciar</button>}
      {status==="recording"&&<><button onClick={()=>{elapsedMs.current+=performance.now()-segmentStarted.current;recorder.current?.pause();if(timer.current!==null)window.clearInterval(timer.current);setStatus("paused");}}>Pausar</button><button onClick={()=>stop(true)}>Parar</button><button onClick={()=>stop(false)}>Cancelar</button></>}
      {status==="paused"&&<><button onClick={()=>{recorder.current?.resume();segmentStarted.current=performance.now();setStatus("recording");timer.current=window.setInterval(()=>setSeconds(s=>{if(s>=599){stop(true);return 600;}return s+1;}),1000);}}>Retomar</button><button onClick={()=>stop(true)}>Parar</button><button onClick={()=>stop(false)}>Cancelar</button></>}
      {status==="ready"&&<><audio controls src={previewUrl??undefined}/><button onClick={()=>void save()}>Salvar na nota</button><button onClick={()=>{setBlob(null);chunks.current=[];setStatus("idle");}}>Descartar</button></>}
      {error&&<span role="alert" className="audio-recorder-error">{error}</span>}
    </div>}
  </span>;
}

function TranscriptionPanel({noteId,editor}:{noteId:string;editor:ReturnType<typeof useEditor>}){
  const [open,setOpen]=useState(false),[config,setConfig]=useState<{runtimeConfigured:boolean;modelConfigured:boolean;ffmpegConfigured:boolean;runtime:string;ffmpeg:string}|null>(null),[runtime,setRuntime]=useState(""),[ffmpeg,setFfmpeg]=useState(""),[language,setLanguage]=useState<"pt"|"auto">("pt"),[attachments,setAttachments]=useState<Awaited<ReturnType<typeof client.listAttachments>>>([]),[jobs,setJobs]=useState<Awaited<ReturnType<typeof client.listTranscriptionJobs>>>([]),[transcripts,setTranscripts]=useState<Awaited<ReturnType<typeof client.listTranscripts>>>([]),[transcriptFilter,setTranscriptFilter]=useState<number|null>(null),[error,setError]=useState("");const players=useRef<Record<number,HTMLAudioElement|null>>({});
  const refresh=useCallback(async(loadPaths=false)=>{try{const [c,a,j,t]=await Promise.all([client.transcriptionConfig(),client.listAttachments(noteId),client.listTranscriptionJobs(noteId),client.listTranscripts(noteId)]);setConfig(c);if(loadPaths){setRuntime(c.runtime);setFfmpeg(c.ffmpeg);}setAttachments(a);setJobs(j);setTranscripts(t);}catch(e){setError((e as Error).message);}},[noteId]);
  useEffect(()=>{if(open)void refresh(true);},[open,refresh]);useEffect(()=>{if(!open)return;const timer=window.setInterval(()=>void refresh(),1200);return()=>window.clearInterval(timer);},[open,refresh]);useEffect(()=>{if(!open)return;return window.cadernoDesktop?.onTranscriptionJobsChanged?.(changedNoteId=>{if(changedNoteId===noteId)void refresh();});},[open,noteId,refresh]);
  useEffect(()=>{const handler=(event:Event)=>{const d=(event as CustomEvent<{noteId:string;attachmentId:number}>).detail;if(d.noteId===noteId){setTranscriptFilter(d.attachmentId);setOpen(true);}};window.addEventListener("caderno:open-transcription",handler);return()=>window.removeEventListener("caderno:open-transcription",handler);},[noteId]);
  const audio=attachments.filter(a=>/\.(wav|mp3|m4a|aac|flac|ogg|opus|webm|mp4|wma)$/i.test(a.fileName));
  const ready=Boolean(config?.runtimeConfigured&&config.modelConfigured&&config.ffmpegConfigured);
  return <span className="pop-anchor transcription-anchor"><button className="icon" title="Transcrever áudio localmente" aria-label="Transcrever áudio localmente" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><AudioLines size={14}/></button>{open&&<div className="menu-pop transcription-pop" role="dialog" aria-label="Transcrição local">
    <strong>Transcrição local</strong><p className="transcription-warning">A transcrição automática pode errar. O áudio permanece neste dispositivo; nenhum upload é feito.</p>
    <div className="transcription-config-state"><span>Mecanismo: {config?.runtimeConfigured?"configurado":"ausente"} · Modelo: {config?.modelConfigured?"configurado":"ausente"} · FFmpeg: {config?.ffmpegConfigured?"configurado":"ausente"}</span><button onClick={()=>void refresh()}>Verificar</button></div>
    <details><summary>Configurar caminhos locais</summary><label>Runtime whisper.cpp<input value={runtime} onChange={e=>setRuntime(e.target.value)} placeholder="Pasta com whisper-cli.exe e models"/></label><label>FFmpeg<input value={ffmpeg} onChange={e=>setFfmpeg(e.target.value)} placeholder="Caminho completo para ffmpeg.exe"/></label><button onClick={async()=>{try{setConfig(await client.configureTranscription({runtime,ffmpeg}));setError("");}catch(e){setError((e as Error).message);}}}>Validar e salvar configuração</button></details>
    {ready&&<><label>Idioma<select value={language} onChange={e=>setLanguage(e.target.value as "pt"|"auto")}><option value="pt">Português</option><option value="auto">Detectar automaticamente</option></select></label>{audio.length?audio.map(a=><div className="transcription-audio-row" key={a.id}><span title={a.fileName}>{a.fileName}</span><button disabled={!ready||jobs.some(j=>j.attachmentId===a.id&&["queued","converting","transcribing"].includes(j.status))} onClick={async()=>{try{await client.startTranscription(noteId,a.id,language);setError("");await refresh();}catch(e){setError((e as Error).message);}}}>Transcrever</button></div>):<p>Nenhum anexo de áudio compatível nesta nota.</p>}</>}
    {jobs.map(j=><div className="transcription-job" key={j.id}><span>{j.stage} · {j.progress}%{j.error?` · ${j.error}`:""}</span>{["queued","converting","transcribing"].includes(j.status)&&<button onClick={()=>void client.cancelTranscription(j.id)}>Cancelar</button>}{j.status==="failed"&&<button onClick={async()=>{try{await client.startTranscription(noteId,j.attachmentId,j.language as "pt"|"auto");}catch(e){setError((e as Error).message);}}}>Tentar novamente</button>}</div>)}
    {transcripts.filter(t=>transcriptFilter===null||t.attachmentId===transcriptFilter).map(t=>{const audio=attachments.find(a=>a.id===t.attachmentId);return <article className="transcription-result" key={t.id}><header><b>Transcrição · {t.language} · {Math.round(t.durationMs/1000)} s</b>{transcriptFilter!==null&&<button onClick={()=>setTranscriptFilter(null)}>Ver todas</button>}<button onClick={()=>void navigator.clipboard.writeText(t.text)}>Copiar</button><button onClick={()=>{if(editor)editor.chain().focus().insertContent(`<p>${t.text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>`).run();}}>Inserir na nota</button></header>{audio?.storedName&&<audio ref={node=>{players.current[t.attachmentId]=node;}} controls preload="metadata" src={`caderno-asset://${audio.storedName}`}/>}<div>{t.segments.map((s,i)=><p key={i}><button className="transcription-seek" onClick={()=>{const player=players.current[t.attachmentId];if(player){player.currentTime=s.startMs/1000;void player.play();}}}><time>{new Date(s.startMs).toISOString().slice(14,19)}</time> {s.text}</button></p>)}</div></article>;})}
    {error&&<p role="alert" className="audio-recorder-error">{error}</p>}
  </div>}</span>;
}
