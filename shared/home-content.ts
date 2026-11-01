/** Seleção, limites e textos dos widgets da tela inicial (puro; sem DOM nem rede). */
import type { CalendarEvent, NoteMeta, Task } from './ipc';
import { addDays, clockLabel, dayKey } from './calendar-view';

export const HOME_EVENT_HORIZON_DAYS = 14;

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  return hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
}

const longDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
export const formatLongDate = (date: Date) => longDate.format(date);

export interface Limited<T> { items: T[]; total: number }
const limited = <T>(all: T[], limit: number): Limited<T> => ({ items: all.slice(0, Math.max(0, limit)), total: all.length });

/** Notas na ordem de edição mais recente; a lixeira nunca entra. */
export function pickRecentNotes(notes: readonly NoteMeta[], limit: number): Limited<NoteMeta> {
  return limited(notes.filter(note => !note.deletedAt).sort((a, b) => b.updatedAt - a.updatedAt), limit);
}

/** Fixadas primeiro, depois as favoritas; dentro de cada grupo, a mais recente antes. */
export function pickStarredNotes(notes: readonly NoteMeta[], limit: number): Limited<NoteMeta> {
  const starred = notes.filter(note => !note.deletedAt && (note.pinned || note.favorited));
  return limited(starred.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt), limit);
}

export interface TaskPick extends Limited<Task> { overdue: number }

/** Atrasadas (mais antigas primeiro) e depois as de hoje, sem repetir ids e ignorando concluídas. */
export function pickTodayTasks(overdue: readonly Task[], today: readonly Task[], limit: number): TaskPick {
  const seen = new Set<string>(), ordered: Task[] = [];
  const add = (list: readonly Task[], sort: (a: Task, b: Task) => number) => {
    for (const task of [...list].sort(sort)) if (!task.done && !seen.has(task.id)) { seen.add(task.id); ordered.push(task); }
  };
  const byDue = (a: Task, b: Task) => (a.dueAt ?? 0) - (b.dueAt ?? 0);
  add(overdue, byDue);
  const overdueCount = ordered.length;
  add(today, byDue);
  return { ...limited(ordered, limit), overdue: overdueCount };
}

/** Eventos que ainda não terminaram, em ordem de início; os de dia inteiro de cada dia vêm antes. */
export function pickUpcomingEvents(events: readonly CalendarEvent[], now: number, limit: number, horizonDays = HOME_EVENT_HORIZON_DAYS): Limited<CalendarEvent> {
  const horizon = addDays(new Date(now), horizonDays + 1).getTime();
  const upcoming = events.filter(event => event.endAt > now && event.startAt < horizon);
  const day = (event: CalendarEvent) => dayKey(new Date(event.startAt));
  upcoming.sort((a, b) => day(a).localeCompare(day(b)) || Number(b.allDay) - Number(a.allDay) || a.startAt - b.startAt || a.endAt - b.endAt || a.title.localeCompare(b.title));
  return limited(upcoming, limit);
}

const dayDiff = (target: number, now: number) => {
  const a = new Date(target), b = new Date(now);
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
};
const shortWeekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });

/** "Agora", "Hoje, 14:00", "Amanhã · dia todo", "sex., 6 nov., 09:30". */
export function describeEventWhen(event: Pick<CalendarEvent, 'startAt' | 'endAt' | 'allDay'>, now: number): string {
  const offset = dayDiff(event.startAt, now);
  const day = offset <= 0 ? 'Hoje' : offset === 1 ? 'Amanhã' : shortWeekday.format(event.startAt);
  if (event.allDay) return `${day} · dia todo`;
  if (event.startAt <= now && event.endAt > now) return 'Agora';
  return `${day}, ${clockLabel(event.startAt)}`;
}

const dayOnly = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const timeOnly = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
/** Hora se for hoje; "ontem"; senão dia e mês. */
export function describeEdited(value: number, now: number): string {
  const offset = dayDiff(value, now);
  return offset === 0 ? timeOnly.format(value) : offset === -1 ? 'Ontem' : dayOnly.format(value);
}

/** Hora do prazo de uma tarefa de hoje/atrasada: "18:00" ou "Atrasada" com o dia. */
export function describeTaskDue(task: Pick<Task, 'dueAt'>, now: number): { label: string; overdue: boolean } {
  if (task.dueAt === null) return { label: 'Sem prazo', overdue: false };
  const offset = dayDiff(task.dueAt, now);
  if (offset < 0) return { label: offset === -1 ? 'Ontem' : dayOnly.format(task.dueAt), overdue: true };
  const due = new Date(task.dueAt);
  return { label: due.getHours() + due.getMinutes() === 0 ? 'Hoje' : clockLabel(task.dueAt), overdue: false };
}
