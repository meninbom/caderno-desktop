import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CalendarDays, FileText, Pin, RotateCw, Star } from "lucide-react";
import type { CalendarEvent, NoteMeta, Task } from "../../shared/ipc";
import {
  describeEdited, describeEventWhen, describeTaskDue, formatLongDate, pickRecentNotes, pickStarredNotes, pickTodayTasks, pickUpcomingEvents,
} from "../../shared/home-content";
import { widgetRowLimit, type HomeWidgetSize } from "../../shared/home-widgets";
import { client } from "../api/client";
import { useAppStore } from "../state/store";
import type { HomeDataSources, HomeResource } from "../hooks/useHomeData";
import { NotebookBadge } from "./NotebookBadge";
import { HomeWeatherBody } from "./HomeWeatherBody";

export interface HomeActions {
  openNote(id: string): void;
  openNotebook(id: number): void;
  navigate(area: "tasks" | "calendar"): void;
}

interface BodyProps { size: HomeWidgetSize; now: number; actions: HomeActions }

/** Carregando / falha / vazio / conteúdo, com os mesmos papéis ARIA em todos os widgets. */
function HomeState({ status, error, onRetry, empty, label, children }: { status: HomeResource<unknown>["status"]; error: string; onRetry(): void; empty: ReactNode | null; label: string; children: ReactNode }) {
  if (status === "loading") return <div className="home-skeleton" role="status" aria-label={`Carregando ${label}`}><i /><i /><i /></div>;
  if (status === "error") {
    return <div className="home-widget-error" role="alert">
      <AlertCircle size={15} aria-hidden="true" />
      <span>Não foi possível carregar {label}.{error && <small>{error}</small>}</span>
      <button type="button" className="home-link-button" onClick={onRetry}><RotateCw size={12} aria-hidden="true" /> Tentar novamente</button>
    </div>;
  }
  if (empty !== null) return <p className="home-empty">{empty}</p>;
  return <>{children}</>;
}

const More = ({ total, shown }: { total: number; shown: number }) => total > shown ? <p className="home-more">+{total - shown} {total - shown === 1 ? "outro" : "outros"}</p> : null;

function NoteRows({ notes, now, actions, size }: { notes: NoteMeta[]; now: number; actions: HomeActions; size: HomeWidgetSize }) {
  return <ul className="home-list">{notes.map(note => <li key={note.id}>
    <button type="button" className="home-row" data-kind="note" data-note-id={note.id} title={note.title || 'Sem título'} onClick={() => actions.openNote(note.id)}>
      <FileText className="home-row-icon" size={14} aria-hidden="true" />
      <span className="home-row-main">
        <span className="home-row-title">{note.title || <em>Sem título</em>}</span>
        {note.preview && size === "wide" && <span className="home-row-sub">{note.preview}</span>}
      </span>
      <span className="home-row-meta">
        {note.pinned && <Pin size={11} aria-label="Fixada" />}
        {note.favorited && <Star size={11} fill="currentColor" aria-label="Favorita" />}
        <time dateTime={new Date(note.updatedAt).toISOString()}>{describeEdited(note.updatedAt, now)}</time>
      </span>
    </button>
  </li>)}</ul>;
}

export function HomeRecentBody({ size, now, actions, data }: BodyProps & { data: HomeDataSources["notes"] }) {
  const pick = pickRecentNotes(data.notes, widgetRowLimit("recent", size));
  return <HomeState status={data.status} error={data.error} onRetry={data.reload} label="as notas recentes" empty={pick.total === 0 ? "Você ainda não tem notas. Comece uma com “Nova nota”." : null}>
    <NoteRows notes={pick.items} now={now} actions={actions} size={size} /><More total={pick.total} shown={pick.items.length} />
  </HomeState>;
}

export function HomeStarredBody({ size, now, actions, data }: BodyProps & { data: HomeDataSources["notes"] }) {
  const pick = pickStarredNotes(data.notes, widgetRowLimit("starred", size));
  return <HomeState status={data.status} error={data.error} onRetry={data.reload} label="as notas fixadas e favoritas" empty={pick.total === 0 ? "Fixe uma nota ou marque-a como favorita para vê-la aqui." : null}>
    <NoteRows notes={pick.items} now={now} actions={actions} size={size} /><More total={pick.total} shown={pick.items.length} />
  </HomeState>;
}

function TaskRows({ tasks, now, actions, onToggled }: { tasks: Task[]; now: number; actions: HomeActions; onToggled(): void }) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set()), [failure, setFailure] = useState("");
  const complete = async (task: Task) => {
    setFailure("");
    setBusy(current => new Set(current).add(task.id));
    try { await client.updateTask({ id: task.id, done: true }); onToggled(); }
    catch (error) { setFailure((error as Error).message); }
    finally { setBusy(current => { const next = new Set(current); next.delete(task.id); return next; }); }
  };
  return <>
    <ul className="home-list">{tasks.map(task => {
      const due = describeTaskDue(task, now), saving = busy.has(task.id);
      return <li key={task.id} className="home-task" data-priority={task.priority ?? "normal"}>
        <input type="checkbox" className="home-check" checked={saving} disabled={saving} aria-label={`Concluir ${task.title}`} onChange={() => void complete(task)} />
        <button type="button" className="home-row" data-kind="task" data-task-id={task.id} onClick={() => actions.openNote(task.noteId)}>
          <span className="home-row-main">
            <span className="home-row-title">{task.title}</span>
            <span className="home-row-sub">{task.noteTitle || "Sem título"}</span>
          </span>
          <span className="home-row-meta"><span className={due.overdue ? "home-due overdue" : "home-due"}>{due.overdue ? `Atrasada · ${due.label}` : due.label}</span></span>
        </button>
      </li>;
    })}</ul>
    {failure && <p className="home-inline-error" role="alert">{failure}</p>}
  </>;
}

export function HomeTasksBody({ size, now, actions, data, reloadTasks }: BodyProps & { data: HomeDataSources["tasks"]; reloadTasks(): void }) {
  const pick = data.data ? pickTodayTasks(data.data.overdue, data.data.today, widgetRowLimit("tasks", size)) : null;
  return <HomeState status={data.status} error={data.error} onRetry={data.reload} label="as tarefas" empty={pick && pick.total === 0 ? "Nada pendente para hoje. Bom trabalho!" : null}>
    {pick && <><TaskRows tasks={pick.items} now={now} actions={actions} onToggled={reloadTasks} /><More total={pick.total} shown={pick.items.length} /></>}
  </HomeState>;
}

function EventRow({ event, now, actions }: { event: CalendarEvent; now: number; actions: HomeActions }) {
  const live = !event.allDay && event.startAt <= now && event.endAt > now;
  return <li>
    <button type="button" className="home-row" data-kind="event" data-event-id={event.id} onClick={() => event.noteId ? actions.openNote(event.noteId) : actions.navigate("calendar")}>
      <CalendarDays className="home-row-icon" size={14} aria-hidden="true" />
      <span className="home-row-main">
        <span className="home-row-title">{event.title}</span>
        <span className={live ? "home-row-sub live" : "home-row-sub"}>{describeEventWhen(event, now)}</span>
      </span>
    </button>
  </li>;
}

export function HomeEventsBody({ size, now, actions, data }: BodyProps & { data: HomeDataSources["events"] }) {
  const pick = data.data ? pickUpcomingEvents(data.data, now, widgetRowLimit("events", size)) : null;
  return <HomeState status={data.status} error={data.error} onRetry={data.reload} label="os eventos" empty={pick && pick.total === 0 ? "Nenhum evento nos próximos dias." : null}>
    {pick && <><ul className="home-list">{pick.items.map(event => <EventRow key={event.id} event={event} now={now} actions={actions} />)}</ul><More total={pick.total} shown={pick.items.length} /></>}
  </HomeState>;
}

export function HomeNotebooksBody({ size, actions }: BodyProps) {
  const { state } = useAppStore();
  const limit = widgetRowLimit("notebooks", size), shown = state.notebooks.slice(0, limit);
  if (!state.initialized) return <div className="home-skeleton" role="status" aria-label="Carregando os cadernos"><i /><i /><i /></div>;
  if (shown.length === 0) return <p className="home-empty">Nenhum caderno ainda. Crie um na barra lateral.</p>;
  return <>
    <ul className="home-list">{shown.map(notebook => <li key={notebook.id}>
      <button type="button" className="home-row" data-kind="notebook" data-notebook-id={notebook.id} onClick={() => actions.openNotebook(notebook.id)}>
        <span className="home-notebook-mark" aria-hidden="true"><NotebookBadge notebook={notebook} size={16} /></span>
        <span className="home-row-main">
          <span className="home-row-title">{notebook.name}</span>
          {notebook.description && size === "wide" && <span className="home-row-sub">{notebook.description}</span>}
        </span>
        <span className="home-row-meta">{notebook.noteCount}</span>
      </button>
    </li>)}</ul>
    <More total={state.notebooks.length} shown={shown.length} />
  </>;
}

const clockFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Atualiza uma vez por minuto, alinhado à virada do minuto, e fica parado com a janela oculta. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const stop = () => { window.clearTimeout(timer); timer = 0; };
    const tick = () => {
      stop();
      const current = Date.now();
      setNow(current);
      if (document.hidden) return;
      timer = window.setTimeout(tick, 60_000 - (current % 60_000) + 50);
    };
    tick();
    document.addEventListener("visibilitychange", tick);
    return () => { stop(); document.removeEventListener("visibilitychange", tick); };
  }, []);
  return now;
}

export function HomeClockBody() {
  const now = useMinuteClock();
  return <div className="home-clock-weather"><div className="home-clock">
    <time className="home-clock-time" dateTime={new Date(now).toISOString()}>{clockFormat.format(now)}</time>
    <span className="home-clock-date">{formatLongDate(new Date(now))}</span>
  </div><HomeWeatherBody now={now} /></div>;
}

export function HomeSummaryBody() {
  const { state } = useAppStore();
  const items: [string, number][] = [["Notas", state.counts.all], ["Favoritas", state.counts.favorites], ["Cadernos", state.notebooks.length], ["Etiquetas", state.tags.length]];
  return <dl className="home-stats" aria-busy={!state.initialized}>{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{state.initialized ? value : "–"}</dd></div>)}</dl>;
}
