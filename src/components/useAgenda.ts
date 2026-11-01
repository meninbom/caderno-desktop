import { useCallback, useEffect, useRef, useState } from 'react';
import { dayKey } from '../../shared/calendar-view';

export const AGENDA_CHANGED = 'caderno:agenda-changed';

type Resource<T> = { value: T | undefined; loaded: boolean; loading: boolean };

/**
 * One fetch per `key` change and per `caderno:agenda-changed`; stale responses are dropped.
 * `mutate` patches the loaded value in place so single-row edits never need a refetch.
 */
export function useAgendaResource<T>(key: string, load: (force: boolean) => Promise<T>, onError: (message: string) => void) {
  const [state, setState] = useState<Resource<T>>({ value: undefined, loaded: false, loading: true });
  const loadRef = useRef(load), errorRef = useRef(onError), request = useRef(0);
  loadRef.current = load;
  errorRef.current = onError;
  const reload = useCallback(async (force = true) => {
    const id = ++request.current;
    setState(current => current.loading ? current : { ...current, loading: true });
    try {
      const value = await loadRef.current(force);
      if (id !== request.current) return;
      setState({ value, loaded: true, loading: false });
      errorRef.current('');
    } catch (error) {
      if (id !== request.current) return;
      setState(current => ({ ...current, loaded: true, loading: false }));
      errorRef.current((error as Error).message);
    }
  }, []);
  useEffect(() => { void reload(false); }, [key, reload]);
  useEffect(() => {
    const changed = () => void reload(true);
    window.addEventListener(AGENDA_CHANGED, changed);
    return () => window.removeEventListener(AGENDA_CHANGED, changed);
  }, [reload]);
  const mutate = useCallback((update: (value: T) => T) => setState(current => current.value === undefined ? current : { ...current, value: update(current.value) }), []);
  return { value: state.value, loaded: state.loaded, loading: state.loading, reload, mutate };
}

/** Today's `YYYY-MM-DD`, refreshed at local midnight and when the window regains focus. */
export function useTodayKey(): string {
  const [key, setKey] = useState(() => dayKey(new Date()));
  useEffect(() => {
    let timer = 0;
    const sync = () => {
      const now = new Date();
      setKey(dayKey(now));
      window.clearTimeout(timer);
      timer = window.setTimeout(sync, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1).getTime() - now.getTime());
    };
    sync();
    window.addEventListener('focus', sync);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', sync); };
  }, []);
  return key;
}

/** Same-day shortcuts must not hijack typing, native controls, or open dialogs. */
export function shortcutAllowed(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input:not([type="checkbox"]),textarea,select,[contenteditable="true"],[role="combobox"]')) return false;
  return !document.querySelector('[aria-modal="true"]');
}
