import { useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Plus, RotateCcw, X } from "lucide-react";
import type { Notebook } from "../../shared/ipc";
import {
  NOTEBOOK_COLOR_PRESETS, NOTEBOOK_DEFAULT_ICON, NOTEBOOK_DESCRIPTION_MAX, NOTEBOOK_EMOJI_SUGGESTIONS, NOTEBOOK_ICON_PRESETS,
  NOTEBOOK_LABELS_MAX, NOTEBOOK_LABEL_MAX, defaultNotebookCustomization, isDefaultNotebookCustomization, normalizeNotebookColor,
  normalizeNotebookDescription, normalizeNotebookEmoji, normalizeNotebookLabel, normalizeNotebookLabels, notebookEmojiIcon, notebookLabelKey,
  parseNotebookIcon, sameNotebookCustomization, type NotebookCustomization,
} from "../../shared/notebook-customization";
import { client } from "../api/client";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { NOTEBOOK_ICON_COMPONENTS, NotebookBadge, NotebookIcon, notebookAccentStyle } from "./NotebookBadge";

const COLOR_NAMES: Record<string, string> = {
  "#ef4444": "Vermelho", "#f97316": "Laranja", "#eab308": "Amarelo", "#22c55e": "Verde", "#14b8a6": "Turquesa",
  "#3b82f6": "Azul", "#4f46e5": "Índigo", "#7c3aed": "Roxo", "#ec4899": "Rosa", "#64748b": "Cinza",
};

/**
 * Diálogo de personalização do caderno (ícone, cor, descrição, etiquetas).
 * Carregado sob demanda pela barra lateral (React.lazy) para não pesar na abertura do app.
 */
export default function NotebookCustomizeDialog({ notebook, labelSuggestions, onClose, onSaved }: {
  notebook: Notebook;
  /** Etiquetas já usadas em outros cadernos (sugestões rápidas). */
  labelSuggestions: string[];
  onClose: () => void;
  onSaved: (notebook: Notebook) => void;
}) {
  const initial = useMemo<NotebookCustomization>(() => ({ icon: notebook.icon, color: notebook.color, description: notebook.description, labels: notebook.labels }), [notebook]);
  const [draft, setDraft] = useState<NotebookCustomization>(initial);
  const parsedIcon = parseNotebookIcon(draft.icon);
  const [emojiText, setEmojiText] = useState(parsedIcon.kind === "emoji" ? parsedIcon.value : "");
  const [labelText, setLabelText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const root = useDialogFocus(true, () => { if (!saving) onClose(); });

  const emojiInvalid = emojiText.trim() !== "" && normalizeNotebookEmoji(emojiText) === null;
  const pendingLabel = normalizeNotebookLabel(labelText);
  const labelKeys = new Set(draft.labels.map(notebookLabelKey));
  const labelsFull = draft.labels.length >= NOTEBOOK_LABELS_MAX;
  const dirty = !sameNotebookCustomization(draft, initial) || (pendingLabel !== "" && !labelKeys.has(notebookLabelKey(pendingLabel)));
  const set = (patch: Partial<NotebookCustomization>) => { setDraft(current => ({ ...current, ...patch })); setError(""); };

  const pickPreset = (name: string) => { setEmojiText(""); set({ icon: name }); };
  const typeEmoji = (value: string) => {
    setEmojiText(value);
    const icon = notebookEmojiIcon(value);
    if (icon) set({ icon });
    else if (value.trim() === "" && parsedIcon.kind === "emoji") set({ icon: NOTEBOOK_DEFAULT_ICON });
  };
  const addLabel = (raw = labelText) => {
    const label = normalizeNotebookLabel(raw);
    setLabelText("");
    if (!label) return;
    set({ labels: normalizeNotebookLabels([...draft.labels, label]) });
  };
  const removeLabel = (label: string) => set({ labels: draft.labels.filter(item => item !== label) });
  const restoreDefaults = () => { setEmojiText(""); setLabelText(""); setDraft(defaultNotebookCustomization()); setError(""); };

  const save = async () => {
    if (saving || emojiInvalid) return;
    const labels = pendingLabel ? normalizeNotebookLabels([...draft.labels, pendingLabel]) : draft.labels;
    setSaving(true); setError("");
    try {
      const saved = await client.customizeNotebook({ id: notebook.id, icon: draft.icon, color: draft.color, description: normalizeNotebookDescription(draft.description), labels });
      if (!saved) { setError("Este caderno não existe mais."); return; }
      onSaved(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message || "Não foi possível salvar a personalização.");
    } finally { setSaving(false); }
  };

  const suggestions = labelSuggestions.filter(label => !labelKeys.has(notebookLabelKey(label))).slice(0, 8);
  const customColor = draft.color && !NOTEBOOK_COLOR_PRESETS.includes(draft.color as never) ? draft.color : null;

  return createPortal(<div className="overlay dialog-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <form ref={root as unknown as RefObject<HTMLFormElement>} className="modal nb-custom-dialog" role="dialog" aria-modal="true" aria-labelledby="nb-custom-title" aria-busy={saving}
      onSubmit={event => { event.preventDefault(); void save(); }}>
      <header className="dialog-heading">
        <span><h3 id="nb-custom-title">Personalizar caderno</h3><p>Ícone, cor e etiquetas ajudam a reconhecer e encontrar “{notebook.name}” na barra lateral.</p></span>
        <button type="button" aria-label="Fechar personalização" disabled={saving} onClick={onClose}><X size={17} /></button>
      </header>

      <div className="nb-preview" role="group" aria-label="Prévia do caderno">
        <div className={`nb-preview-row ${draft.color ? "has-accent" : ""}`} style={notebookAccentStyle(draft.color)}>
          <NotebookBadge icon={draft.icon} color={draft.color} size={16} />
          <span className="nb-preview-name">{notebook.name}</span>
        </div>
        <div className="nb-preview-side">
          {draft.description ? <span className="nb-preview-desc">{normalizeNotebookDescription(draft.description)}</span> : <span className="nb-preview-desc">Sem descrição</span>}
          {draft.labels.length > 0 && <span className="nb-preview-labels">{draft.labels.map(label => <span key={label} className="nb-chip"><span>{label}</span></span>)}</span>}
        </div>
      </div>

      <fieldset className="nb-section">
        <legend>Ícone</legend>
        <div className="nb-icon-grid" role="group" aria-label="Ícones disponíveis">
          {NOTEBOOK_ICON_PRESETS.map(name => <button key={name} type="button" className="nb-icon-option" title={NOTEBOOK_ICON_COMPONENTS[name].label} aria-label={`Ícone ${NOTEBOOK_ICON_COMPONENTS[name].label}`}
            aria-pressed={parsedIcon.kind === "preset" && parsedIcon.name === name} disabled={saving} onClick={() => pickPreset(name)}><NotebookIcon icon={name} size={16} /></button>)}
        </div>
        <div className="nb-emoji-row">
          <label htmlFor="nb-emoji-input">Ou use um emoji:</label>
          <input id="nb-emoji-input" value={emojiText} maxLength={24} autoComplete="off" spellCheck={false} aria-invalid={emojiInvalid} aria-describedby={emojiInvalid ? "nb-emoji-error" : undefined}
            placeholder="🙂" disabled={saving} onChange={event => typeEmoji(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
          {NOTEBOOK_EMOJI_SUGGESTIONS.map(emoji => <button key={emoji} type="button" className="nb-emoji-suggestion" aria-label={`Usar emoji ${emoji}`} disabled={saving} onClick={() => typeEmoji(emoji)}>{emoji}</button>)}
        </div>
        {emojiInvalid && <p id="nb-emoji-error" className="nb-field-error" role="alert">Use um único emoji (sem texto ou símbolos comuns).</p>}
      </fieldset>

      <fieldset className="nb-section">
        <legend>Cor de destaque</legend>
        <div className="nb-color-grid" role="group" aria-label="Cores disponíveis">
          <button type="button" className="nb-color-option is-none" aria-label="Sem cor" title="Sem cor" aria-pressed={draft.color === null} disabled={saving} onClick={() => set({ color: null })}>×</button>
          {NOTEBOOK_COLOR_PRESETS.map(color => <button key={color} type="button" className="nb-color-option" style={{ backgroundColor: color }} aria-label={COLOR_NAMES[color] ?? color} title={COLOR_NAMES[color] ?? color}
            aria-pressed={draft.color === color} disabled={saving} onClick={() => set({ color })} />)}
          <span className="nb-color-option is-custom" style={{ backgroundColor: customColor ?? "var(--surface-2)" }} data-selected={customColor !== null} title="Cor personalizada">
            <input type="color" aria-label="Cor personalizada" value={draft.color ?? "#3b82f6"} disabled={saving} onChange={event => set({ color: normalizeNotebookColor(event.target.value) })} />
          </span>
        </div>
        <p className="nb-hint">O ícone usa texto claro ou escuro automaticamente para manter a leitura em qualquer cor.</p>
      </fieldset>

      <div className="nb-section">
        <label htmlFor="nb-description">Descrição curta (opcional)</label>
        <input id="nb-description" value={draft.description} maxLength={NOTEBOOK_DESCRIPTION_MAX} disabled={saving} placeholder="Para que serve este caderno?" onChange={event => set({ description: event.target.value })} />
        <span className="nb-counter" aria-hidden="true">{draft.description.length}/{NOTEBOOK_DESCRIPTION_MAX}</span>
      </div>

      <fieldset className="nb-section">
        <legend>Etiquetas do caderno</legend>
        <p className="nb-hint">Servem para agrupar e filtrar cadernos. São independentes das etiquetas das notas.</p>
        <div className="nb-label-input">
          <input aria-label="Nova etiqueta do caderno" value={labelText} maxLength={NOTEBOOK_LABEL_MAX} disabled={saving || labelsFull} placeholder={labelsFull ? `Limite de ${NOTEBOOK_LABELS_MAX} etiquetas` : "Ex.: trabalho, 2026"}
            onChange={event => setLabelText(event.target.value.replace(/,/g, ""))}
            onKeyDown={event => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addLabel(); } else if (event.key === "Backspace" && !labelText && draft.labels.length) removeLabel(draft.labels[draft.labels.length - 1]); }} />
          <button type="button" disabled={saving || labelsFull || !pendingLabel} onClick={() => addLabel()}><Plus size={14} /> Adicionar</button>
        </div>
        {draft.labels.length > 0 && <ul className="nb-label-list" aria-label="Etiquetas deste caderno" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {draft.labels.map(label => <li key={label} className="nb-chip"><span>{label}</span><button type="button" aria-label={`Remover etiqueta ${label}`} disabled={saving} onClick={() => removeLabel(label)}><X size={12} /></button></li>)}
        </ul>}
        {suggestions.length > 0 && !labelsFull && <div className="nb-label-list" role="group" aria-label="Etiquetas usadas em outros cadernos">
          {suggestions.map(label => <button key={label} type="button" className="nb-chip" aria-label={`Adicionar etiqueta ${label}`} disabled={saving} onClick={() => addLabel(label)}><span>+ {label}</span></button>)}
        </div>}
      </fieldset>

      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="nb-reset" disabled={saving || isDefaultNotebookCustomization(draft)} onClick={restoreDefaults}><RotateCcw size={13} /> Restaurar padrão</button>
        <button type="button" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="submit" className="primary" disabled={saving || !dirty || emojiInvalid}>{saving ? "Salvando…" : "Salvar"}</button>
      </div>
    </form>
  </div>, document.body);
}
