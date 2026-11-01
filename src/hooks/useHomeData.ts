import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarEvent, NoteMeta, Task } from "../../shared/ipc";
import { addDays } from "../../shared/calendar-view";
import { client } from "../api/client";
import { useAppStore } from "../state/store";

/** Mesmo evento que a agenda emite quando tarefas/eventos mudam (inclusive por origem externa). */
const AGENDA_CHANGED = "caderno:agenda-changed";
const FOCUS_THROTTLE_MS = 1500;
const NOOP = () => {};

export interface HomeResource<T> {
  status: "loading" | "ready" | "error";
  data: T | undefined;
  error: string;
  reload(): void;
}

interface Triggers { agenda?: boolean; external?: boolean }

/**
 * Uma busca por vez, só quando `enabled`. Recarrega ao ganhar foco (com intervalo mínimo), por eventos
 * relevantes e quando `refreshKey` muda — nunca por temporizador. Respostas antigas são descartadas e,
 * se já havia dados, uma falha posterior mantém os dados anteriores visíveis.
 */
function useHomeResource<T>(enabled: boolean, load: () => Promise<T>, refreshKey: string, triggers: Triggers): HomeResource<T> {
  const [state, setState] = useState<{ status: HomeResource<T>["status"]; data: T | undefined; error: string }>({ status: "loading", data: undefined, error: "" });
  const loadRef = useRef(load), sequence = useRef(0), lastRun = useRef(0), mounted = useRef(true);
  loadRef.current = load;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);

  const run = useCallback(() => {
    const id = ++sequence.current;
    lastRun.current = Date.now();
    loadRef.current().then(
      data => { if (mounted.current && id === sequence.current) setState({ status: "ready", data, error: "" }); },
      (error: unknown) => {
        if (!mounted.current || id !== sequence.current) return;
        const message = (error as Error)?.message || "Falha desconhecida.";
        setState(current => current.data !== undefined ? { ...current, error: message } : { status: "error", data: undefined, error: message });
      },
    );
  }, []);
  const reload = useCallback(() => { setState(current => current.data === undefined ? { status: "loading", data: undefined, error: "" } : current); run(); }, [run]);

  useEffect(() => { if (enabled) run(); }, [enabled, refreshKey, run]);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => { if (!document.hidden) run(); };
    const onFocus = () => { if (Date.now() - lastRun.current > FOCUS_THROTTLE_MS) refresh(); };
    window.addEventListener("focus", onFocus);
    if (triggers.agenda) window.addEventListener(AGENDA_CHANGED, refresh);
    const unsubscribe = triggers.external ? window.cadernoDesktop?.onExternalDataChange?.(refresh) : undefined;
    const unsubscribeClip = triggers.external ? window.cadernoDesktop?.onClipperCapture?.(refresh) : undefined;
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(AGENDA_CHANGED, refresh);
      unsubscribe?.(); unsubscribeClip?.();
    };
  }, [enabled, run, triggers.agenda, triggers.external]);
  return { status: state.status, data: state.data, error: state.error, reload };
}

export interface HomeNotesData { notes: NoteMeta[]; status: HomeResource<NoteMeta[]>["status"]; error: string; reload(): void }

export interface HomeDataSources {
  notes: HomeNotesData;
  tasks: HomeResource<{ overdue: Task[]; today: Task[] }>;
  events: HomeResource<CalendarEvent[]>;
  /** Reabre uma tarefa/evento depois de uma mutação local. */
  reloadTasks(): void;
}

/**
 * Dados dos widgets ativos. Notas: reaproveita a lista do store quando ela já é "todas, por edição"
 * (nenhuma requisição extra); caso contrário faz uma única busca compartilhada por Recentes e Fixadas.
 * Tarefas atrasadas e de hoje são pedidas em paralelo; eventos cobrem de hoje às próximas duas semanas.
 */
export function useHomeData(active: { notes: boolean; tasks: boolean; events: boolean }): HomeDataSources {
  const { state } = useAppStore();
  const storeCovers = state.initialized && state.selection.kind === "all" && state.orderBy === "updated_desc" && !state.search.trim();
  const countsKey = `${state.counts.all}|${state.counts.favorites}|${state.counts.trash}`;
  const own = useHomeResource<NoteMeta[]>(active.notes && !storeCovers, () => client.listNotes({ view: "all", order: "updated_desc" }), countsKey, { external: true });
  const tasks = useHomeResource(active.tasks, async () => {
    const [overdue, today] = await Promise.all([client.listTasks("overdue"), client.listTasks("today")]);
    return { overdue, today };
  }, "", { agenda: true, external: true });
  const events = useHomeResource(active.events, () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return client.listEvents(start.getTime(), addDays(start, 15).getTime() - 1);
  }, "", { agenda: true, external: true });

  let notes: HomeNotesData;
  if (storeCovers) {
    // A lista do store pode estar vazia só porque ainda não chegou: evita piscar "nenhuma nota".
    const pending = state.notes.length === 0 && state.counts.all > 0;
    notes = { notes: state.notes, status: pending ? "loading" : "ready", error: "", reload: NOOP };
  } else {
    notes = { notes: own.data ?? [], status: own.status, error: own.error, reload: own.reload };
  }
  return { notes, tasks, events, reloadTasks: tasks.reload };
}
