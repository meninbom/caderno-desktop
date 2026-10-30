import { useEffect, useRef } from "react";

export function useDialogFocus(open: boolean, onClose: () => void) {
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => (root.current?.querySelector<HTMLElement>("input:not(:disabled)") ?? root.current?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus());
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (event.key !== "Tab") return;
      const fields = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])].filter(el => el.getClientRects().length > 0);
      const first = fields[0], last = fields[fields.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !root.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return root;
}
