import { Columns3 } from "lucide-react";
import { useState } from "react";
import { useDismissablePopover } from "../hooks/useDismissablePopover";
import type { Appearance } from "../state/appearance";

export function WritingLayoutControl({ appearance, update }: { appearance: Appearance; update: (patch: Partial<Appearance>) => void }) {
  const [open, setOpen] = useState(false);
  const popover = useDismissablePopover(open, () => setOpen(false));
  return <span className="writing-layout" ref={popover.rootRef}>
    <button ref={popover.triggerRef} aria-label="Configurar largura de escrita" aria-expanded={open} onClick={() => setOpen(v => !v)}><Columns3 size={14} /> Largura</button>
    {open && <div className="writing-layout-popover" role="group" aria-label="Limites da escrita">
      <strong>Limites da escrita</strong>
      <p>Defina onde o texto quebra para a próxima linha.</p>
      <label className="writing-full-width"><input type="checkbox" checked={appearance.fullWidth} onChange={e => update({ fullWidth: e.target.checked })} /> Usar toda a largura disponível</label>
      <label>Largura do texto <output>{appearance.fullWidth ? "Automática" : `${appearance.contentWidth} px`}</output>
        <input aria-label="Largura do texto" type="range" min={320} max={2400} step={20} disabled={appearance.fullWidth} value={appearance.contentWidth} onChange={e => update({ contentWidth: Number(e.target.value) })} />
      </label>
      <label>Margem lateral mínima <output>{appearance.editorGutter} px</output>
        <input aria-label="Margem lateral mínima" type="range" min={12} max={160} step={4} value={appearance.editorGutter} onChange={e => update({ editorGutter: Number(e.target.value) })} />
      </label>
      <small>A largura se adapta à janela. Sua preferência fica salva.</small>
    </div>}
  </span>;
}
