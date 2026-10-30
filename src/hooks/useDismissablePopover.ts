import { useEffect, useRef } from "react";

export function useDismissablePopover(open: boolean, close: () => void) {
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    let dismissed = false;
    const dismiss = (restoreFocus: boolean) => {
      if (dismissed) return;
      dismissed = true;
      closeRef.current();
      if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
    };
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) dismiss(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const modal = event.target instanceof Element ? event.target.closest('[aria-modal="true"]') : null;
      if (modal && rootRef.current && !modal.contains(rootRef.current)) return;
      if (event.key === "Escape") { event.preventDefault(); dismiss(true); }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return { rootRef, triggerRef };
}
