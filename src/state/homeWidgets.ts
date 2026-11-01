import { useCallback, useEffect, useRef, useState } from "react";
import {
  HOME_LAYOUT_KEY, defaultHomeLayout, moveWidget, moveWidgetTo, parseHomeLayout, readHomeLayout, setWidgetEnabled, setWidgetSize, writeHomeLayout,
  type HomeLayout, type HomeWidgetId, type HomeWidgetSize,
} from "../../shared/home-widgets";

const storage = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

/**
 * Preferências do painel inicial (somente configuração). Grava só depois de uma alteração do usuário,
 * escutando `storage` para refletir outra janela sem consultas periódicas.
 */
export function useHomeLayout() {
  const [layout, setLayout] = useState<HomeLayout>(() => readHomeLayout(storage()));
  const [saveError, setSaveError] = useState(false);
  const loaded = useRef(layout);

  useEffect(() => {
    if (layout === loaded.current) return;
    setSaveError(!writeHomeLayout(storage(), layout));
  }, [layout]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== HOME_LAYOUT_KEY) return;
      const next = parseHomeLayout(event.newValue);
      loaded.current = next;
      setLayout(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const move = useCallback((id: HomeWidgetId, direction: -1 | 1) => setLayout(current => moveWidget(current, id, direction)), []);
  const moveTo = useCallback((id: HomeWidgetId, target: HomeWidgetId, placement: "before" | "after") => setLayout(current => moveWidgetTo(current, id, target, placement)), []);
  const setEnabled = useCallback((id: HomeWidgetId, enabled: boolean) => setLayout(current => setWidgetEnabled(current, id, enabled)), []);
  const setSize = useCallback((id: HomeWidgetId, size: HomeWidgetSize) => setLayout(current => setWidgetSize(current, id, size)), []);
  const restore = useCallback((next: HomeLayout = defaultHomeLayout()) => setLayout(next), []);
  return { layout, saveError, move, moveTo, setEnabled, setSize, restore };
}
