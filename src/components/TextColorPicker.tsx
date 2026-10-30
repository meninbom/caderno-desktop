import "./TextColorPicker.css";
import { Baseline, Check, ChevronDown, Highlighter, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { Editor } from "@tiptap/react";
import { useDismissablePopover } from "../hooks/useDismissablePopover";
import {
  DEFAULT_HIGHLIGHT, RECENT_LIMIT, buildColorTransaction, canStyleSelection, captureSelection, colorName, loadRecentColors,
  normalizeHex, paletteFor, pushRecentColor, readColors, readableInk, saveRecentColors,
} from "../editor/text-colors";
import type { ColorKind, ColorReading, SelectionSnapshot } from "../editor/text-colors";

export interface TextColorPickerProps {
  editor: Editor;
  /** Desativa os dois controles (ex.: nota na lixeira). Editor não editável também desativa. */
  disabled?: boolean;
}

const COPY = {
  text: { title: "Cor do texto", none: "Cor padrão", reset: "Restaurar cor padrão", Icon: Baseline, fallback: "#1b4ed8" },
  highlight: { title: "Marca-texto", none: "Sem marca-texto", reset: "Remover marca-texto", Icon: Highlighter, fallback: "#fff176" },
} as const;

const NOTICES = {
  "doc-changed": "A nota mudou com o seletor aberto. Selecione o texto novamente.",
  "invalid-color": "Cor inválida. Use um HEX como #1B4ED8 ou #1BD.",
  unsupported: "Este editor não suporta essa formatação.",
} as const;

const upper = (hex: string) => hex.toUpperCase();
const cssColor = (value: string) => value === DEFAULT_HIGHLIGHT ? COPY.highlight.fallback : value;

function describe(reading: ColorReading, kind: ColorKind): string {
  const one = (value: string) => {
    if (value === DEFAULT_HIGHLIGHT) return "Destaque padrão";
    const hex = normalizeHex(value);
    const name = colorName(kind, value);
    return hex ? `${name ?? "Personalizada"} (${upper(hex)})` : "Personalizada";
  };
  if (reading.status === "none") return COPY[kind].none;
  if (reading.status === "single") return one(reading.value);
  if (reading.values.length === 1) return `${one(reading.values[0])} em parte da seleção`;
  return "Várias cores na seleção";
}

function indicatorBackground(reading: ColorReading): string | undefined {
  if (reading.status === "single") return cssColor(reading.value);
  if (reading.status !== "mixed") return undefined;
  const stops = reading.values.slice(0, 3).map(cssColor);
  if (reading.hasUnstyled) stops.push("var(--border)");
  const step = 100 / stops.length;
  return `linear-gradient(90deg, ${stops.map((color, i) => `${color} ${i * step}% ${(i + 1) * step}%`).join(", ")})`;
}

interface Layout { placement: "above" | "below"; width: number; maxHeight: number; shift: number }

function ColorMenu({ editor, kind, disabled }: { editor: Editor; kind: ColorKind; disabled?: boolean }) {
  const copy = COPY[kind];
  const ids = useId();
  const panelId = `${ids}-panel`, hexId = `${ids}-hex`, hintId = `${ids}-hint`;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => loadRecentColors(kind));
  const [layout, setLayout] = useState<Layout | null>(null);
  const snapshot = useRef<SelectionSnapshot | null>(null);
  const hexRef = useRef<HTMLInputElement>(null);
  const { rootRef, triggerRef } = useDismissablePopover(open, () => setOpen(false));

  const subscribe = useCallback((notify: () => void) => { editor.on("transaction", notify); return () => { editor.off("transaction", notify); }; }, [editor]);
  const state = useSyncExternalStore(subscribe, () => editor.state);
  const reading = useMemo(() => readColors(state, kind), [state.doc, state.selection, state.storedMarks, kind]);
  const canStyle = useMemo(() => canStyleSelection(state, kind), [state.doc, state.selection, state.storedMarks, kind]);
  const blocked = !!disabled || !editor.isEditable || !canStyle;
  const label = describe(reading, kind);

  // Nota mudou (ou a seleção ficou sem alvo) com o popup aberto: fecha em vez de aplicar um intervalo antigo.
  useEffect(() => {
    if (open && (blocked || (snapshot.current && state.doc !== snapshot.current.doc))) setOpen(false);
  }, [open, blocked, state.doc]);

  // Mantém o popup dentro do painel do editor (modo lado a lado, janela estreita, zoom).
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const place = () => {
      const t = trigger.getBoundingClientRect();
      const pane = trigger.closest(".editor-pane")?.getBoundingClientRect();
      const left = Math.max(pane?.left ?? 0, 0) + 8, right = Math.min(pane?.right ?? window.innerWidth, window.innerWidth) - 8;
      const width = Math.min(304, Math.max(168, right - left));
      const above = t.top - 12, below = window.innerHeight - t.bottom - 12;
      const placement = above >= 320 || above >= below ? "above" : "below";
      const center = t.left + t.width / 2 - width / 2;
      setLayout({ placement, width, maxHeight: Math.max(160, Math.min(520, placement === "above" ? above : below)), shift: Math.min(Math.max(center, left), Math.max(left, right - width)) - center });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, triggerRef]);

  const singleHex = reading.status === "single" ? normalizeHex(reading.value) : null;
  const draftHex = normalizeHex(draft);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    snapshot.current = captureSelection(editor.state);
    setDraft(singleHex ? upper(singleHex) : "");
    setDraftError(false);
    setNotice(null);
    setRecent(loadRecentColors(kind));
    setOpen(true);
  };

  const commit = (value: string | null) => {
    const snap = snapshot.current;
    if (!snap) return;
    const result = buildColorTransaction(editor.state, snap, kind, value);
    if (!result.ok) { setNotice(NOTICES[result.reason]); return; }
    editor.view.focus(); // devolve o foco ao editor antes; a transação já restaura a seleção capturada
    editor.view.dispatch(result.tr);
    if (value) { const next = pushRecentColor(recent, value); setRecent(next); saveRecentColors(kind, next); }
    setOpen(false);
  };

  const submitDraft = () => {
    if (!draftHex) { setDraftError(true); hexRef.current?.focus(); return; }
    commit(draftHex);
  };

  const keepEditorFocus = (event: MouseEvent) => event.preventDefault();
  const swatch = (name: string, value: string) => {
    const hex = normalizeHex(value) ?? value;
    const selected = reading.status === "single" && reading.value === hex;
    return <button key={hex} type="button" className="tcp-swatch" style={{ "--swatch": hex, "--ink": readableInk(hex) } as CSSProperties}
      aria-label={`${name}, ${upper(hex)}`} title={`${name} · ${upper(hex)}`} aria-pressed={selected}
      onMouseDown={keepEditorFocus} onClick={() => commit(hex)}>{selected && <Check size={14} aria-hidden />}</button>;
  };

  const barBackground = indicatorBackground(reading);
  const popStyle = layout ? { "--tcp-width": `${layout.width}px`, "--tcp-max-height": `${layout.maxHeight}px`, "--tcp-shift": `${layout.shift}px` } as CSSProperties : undefined;

  return <span className="tcp-menu" ref={rootRef}
    onBlur={event => { const next = event.relatedTarget as Node | null; if (open && next && !event.currentTarget.contains(next)) setOpen(false); }}>
    <button ref={triggerRef} type="button" className="tcp-trigger" disabled={blocked} data-kind={kind}
      aria-label={`${copy.title}: ${label}`} aria-expanded={open} aria-controls={open ? panelId : undefined}
      title={blocked ? `${copy.title} indisponível aqui (código ou seleção sem texto)` : `${copy.title}: ${label}`}
      onMouseDown={keepEditorFocus} onClick={toggle}>
      <span className="tcp-icon">
        <copy.Icon size={16} aria-hidden />
        <span className={`tcp-bar${reading.status === "none" ? " is-none" : ""}${reading.status === "mixed" ? " is-mixed" : ""}`} style={{ background: barBackground }} />
      </span>
      <ChevronDown size={10} aria-hidden className="tcp-caret" />
    </button>
    {open && <div id={panelId} role="group" aria-label={copy.title} className={`tcp-popover ${layout?.placement ?? "above"}`} style={popStyle}>
      <div className="tcp-head">
        <strong>{copy.title}</strong>
        <span className="tcp-current"><span className={`tcp-chip${reading.status === "mixed" ? " is-mixed" : ""}${reading.status === "none" ? " is-none" : ""}`} style={{ background: barBackground }} aria-hidden />{label}</span>
      </div>
      {snapshot.current?.empty && <p className="tcp-hint">Sem texto selecionado: a escolha vale para o que você digitar a seguir.</p>}

      {paletteFor(kind).map(group => <div key={group.label} className="tcp-section" role="group" aria-label={group.label}>
        <span className="tcp-label">{group.label}</span>
        <div className="tcp-grid">{group.colors.map(color => swatch(color.name, color.value))}</div>
      </div>)}

      <div className="tcp-section" role="group" aria-label="Cores recentes">
        <span className="tcp-label">Recentes</span>
        {recent.length ? <div className="tcp-grid">{recent.slice(0, RECENT_LIMIT).map(hex => swatch(colorName(kind, hex) ?? "Personalizada", hex))}</div>
          : <span className="tcp-empty">As cores que você usar aparecem aqui.</span>}
      </div>

      <form className="tcp-section tcp-custom" onSubmit={event => { event.preventDefault(); submitDraft(); }}>
        <label className="tcp-label" htmlFor={hexId}>Cor personalizada (HEX)</label>
        <div className="tcp-custom-row">
          <input type="color" className="tcp-native" aria-label="Escolher cor no seletor do sistema" value={draftHex ?? singleHex ?? copy.fallback}
            onChange={event => { setDraft(upper(event.target.value)); setDraftError(false); }} />
          <input ref={hexRef} id={hexId} className="tcp-hex" value={draft} maxLength={7} spellCheck={false} autoComplete="off" placeholder="#RRGGBB"
            aria-invalid={draftError} aria-describedby={hintId}
            onChange={event => { setDraft(event.target.value); setDraftError(false); }} />
          <span className="tcp-preview" aria-hidden style={draftHex ? (kind === "text" ? { color: draftHex } : { background: draftHex, color: readableInk(draftHex) }) : undefined}>Aa</span>
          <button type="submit" className="tcp-action primary" onMouseDown={keepEditorFocus}>Aplicar</button>
        </div>
        <span id={hintId} className={draftError ? "tcp-error" : "tcp-empty"} role={draftError ? "alert" : undefined}>
          {draftError ? NOTICES["invalid-color"] : "Digite 3 ou 6 dígitos, com ou sem #."}
        </span>
      </form>

      {notice && <p className="tcp-error" role="alert">{notice}</p>}
      <button type="button" className="tcp-action tcp-reset" disabled={reading.status === "none"} onMouseDown={keepEditorFocus} onClick={() => commit(null)}>
        <RotateCcw size={13} aria-hidden /> {copy.reset}
      </button>
    </div>}
  </span>;
}

/** Dois controles distintos para a barra de formatação: "Cor do texto" e "Marca-texto". */
export function TextColorPicker({ editor, disabled }: TextColorPickerProps) {
  return <span className="text-color-picker" role="group" aria-label="Cores do texto">
    <ColorMenu editor={editor} kind="text" disabled={disabled} />
    <ColorMenu editor={editor} kind="highlight" disabled={disabled} />
  </span>;
}
