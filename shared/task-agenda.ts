import type { Task } from './ipc';
import type { Priority } from './recurrence';
import { clockLabel } from './calendar-view';
import { localDateTimeInZone, zonedLocalToEpoch } from './zoned-time';

const DAY = 86400000;
const pad = (value: number) => String(value).padStart(2, '0');
const dayStart = (value: number) => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date.getTime(); };

export type TaskSummary = { pending: number; overdue: number; dueToday: number; completedToday: number };

/** Header counters in a single pass; "overdue" matches the grouping rule (due before today's midnight). */
export function summarizeTasks(tasks: Task[], now = Date.now()): TaskSummary {
  const today = dayStart(now), tomorrow = new Date(today).setDate(new Date(today).getDate() + 1);
  const summary: TaskSummary = { pending: 0, overdue: 0, dueToday: 0, completedToday: 0 };
  for (const task of tasks) {
    if (task.done) { if (task.updatedAt >= today && task.updatedAt < tomorrow) summary.completedToday++; continue; }
    summary.pending++;
    if (task.dueAt === null) continue;
    if (task.dueAt < today) summary.overdue++;
    else if (task.dueAt < tomorrow) summary.dueToday++;
  }
  return summary;
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'done';
const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });
const weekdayFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
const yearFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });

/** Friendly relative label ("Hoje, 18:00", "Amanhã", "sex., 6 nov.") plus a tone for styling. */
export function describeDue(dueAt: number, done: boolean, now = Date.now()): { label: string; tone: DueTone } {
  const offset = Math.round((dayStart(dueAt) - dayStart(now)) / DAY);
  const due = new Date(dueAt);
  const time = due.getHours() + due.getMinutes() === 0 ? '' : `, ${clockLabel(dueAt)}`;
  let label: string;
  if (offset === 0) label = `Hoje${time}`;
  else if (offset === 1) label = `Amanhã${time}`;
  else if (offset === -1) label = `Ontem${time}`;
  else if (offset > 1 && offset < 7) label = `${weekdayFormat.format(due)}${time}`;
  else label = `${(due.getFullYear() === new Date(now).getFullYear() ? dateFormat : yearFormat).format(due)}${time}`;
  const tone: DueTone = done ? 'done' : offset < 0 ? 'overdue' : offset === 0 ? 'today' : offset < 7 ? 'soon' : 'later';
  return { label, tone };
}

/** Civil `YYYY-MM-DD` of the day `dayOffset` days from today in `zone`. */
export function civilDate(zone: string, now: number, dayOffset = 0): string {
  const [year, month, day] = localDateTimeInZone(now, zone).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + dayOffset)).toISOString().slice(0, 10);
}

/** `YYYY-MM-DDTHH:mm` for the given day offset and clock, expressed in `zone`. */
export const localPreset = (zone: string, now: number, dayOffset: number, hour: number, minute = 0) =>
  `${civilDate(zone, now, dayOffset)}T${pad(hour)}:${pad(minute)}`;

/** Days until the next Monday in `zone` (1–7). */
export function daysUntilMonday(zone: string, now: number): number {
  const weekday = new Date(`${civilDate(zone, now)}T00:00:00Z`).getUTCDay();
  return (8 - weekday) % 7 || 7;
}

/** Wall-clock arithmetic on a `datetime-local` value; the zone resolves DST when the value is saved. */
export function shiftLocal(value: string, minutes: number): string {
  const [date, time] = value.split('T'), [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute + minutes)).toISOString().slice(0, 16);
}

/** Like `zonedLocalToEpoch`, but a skipped DST hour moves to the first valid minute after it. */
export function resolveLocal(value: string, zone: string): number {
  let candidate = value;
  for (let attempt = 0; attempt <= 180; attempt++, candidate = shiftLocal(candidate, 1)) {
    try { return zonedLocalToEpoch(candidate, zone); }
    catch (error) { if (!(error instanceof Error) || !error.message.includes('não existe')) throw error; }
  }
  return zonedLocalToEpoch(value, zone);
}

/** New due/reminder when pushing a task to tomorrow; keeps the clock time and the reminder lead. */
export function postponeTarget(task: Pick<Task, 'dueAt' | 'reminderAt' | 'timeZone'>, now = Date.now(), fallbackZone = Intl.DateTimeFormat().resolvedOptions().timeZone): { dueAt: number; reminderAt: number | null } {
  const zone = task.timeZone ?? fallbackZone;
  const clock = task.dueAt === null ? '09:00' : localDateTimeInZone(task.dueAt, zone).slice(11);
  const dueAt = resolveLocal(`${civilDate(zone, now, 1)}T${clock}`, zone);
  const reminderAt = task.reminderAt === null ? null : task.dueAt === null ? dueAt : dueAt + (task.reminderAt - task.dueAt);
  return { dueAt, reminderAt };
}

export type QuickTask = { title: string; dueAt: number | null; priority: Priority | null };

const word = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu');
const WEEKDAYS = ['domingo', 'segunda', 'ter[cç]a', 'quarta', 'quinta', 'sexta', 's[aá]bado'];
const DAY_WORD = word(`depois de amanh[ãa]|amanh[ãa]|hoje|(${WEEKDAYS.join('|')})(?:-feira)?`);
const TIME_WORD = word('(?:[àa]s\\s+)?(\\d{1,2})(?:h(\\d{2})?|:(\\d{2}))');
const PRIORITY_WORD = word('!(alta|urgente|high|baixa|low|normal|m[ée]dia)');

/**
 * Understands the trailing hints of a quick-add line: "amanhã", "sexta 14h", "às 9:30", "!alta".
 * A bare time such as "2h" only counts together with a day word, so titles like "Treinar 2h" stay intact.
 */
export function parseQuickTask(input: string, now = Date.now()): QuickTask {
  const original = input.trim();
  let text = ` ${original} `, dueAt: number | null = null, priority: Priority | null = null;
  const take = (pattern: RegExp) => { const match = pattern.exec(text); if (match) text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`; return match; };

  const flag = take(PRIORITY_WORD)?.[1].toLowerCase();
  if (flag) priority = /^(alta|urgente|high)$/.test(flag) ? 'high' : /^(baixa|low)$/.test(flag) ? 'low' : 'normal';

  const dayMatch = take(DAY_WORD);
  const timeProbe = TIME_WORD.exec(text);
  const timeIsExplicit = !!timeProbe && (/^[àa]s\s/i.test(timeProbe[0]) || timeProbe[3] !== undefined);
  const timeMatch = dayMatch || timeIsExplicit ? take(TIME_WORD) : null;
  if (dayMatch || timeMatch) {
    const hour = timeMatch ? Number(timeMatch[1]) : -1, minute = timeMatch ? Number(timeMatch[2] ?? timeMatch[3] ?? 0) : 0;
    const base = new Date(now);
    if (timeMatch && (hour > 23 || minute > 59)) return { title: original, dueAt: null, priority };
    let offset = 0, defaultHour = 9;
    const spoken = dayMatch?.[0].toLowerCase() ?? '';
    if (/^depois/.test(spoken)) offset = 2;
    else if (/^amanh/.test(spoken)) offset = 1;
    else if (/^hoje/.test(spoken)) defaultHour = base.getHours() < 18 ? 18 : 23;
    else if (dayMatch) {
      const index = WEEKDAYS.findIndex(name => new RegExp(`^${name}`, 'i').test(spoken));
      offset = (index - base.getDay() + 7) % 7 || 7;
    }
    const at = (days: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hour >= 0 ? hour : defaultHour, hour >= 0 ? minute : defaultHour === 23 ? 59 : 0).getTime();
    dueAt = at(offset);
    // "Ligar às 9h" said after 9h means tomorrow, not an already-overdue task.
    if (!dayMatch && dueAt <= now) dueAt = at(1);
  }

  const title = text.replace(/\s+/g, ' ').trim().replace(/(?:\s+(?:at[ée]|para|pra|em|no|na|[àa]s))+$/i, '').trim();
  return { title: title || original, dueAt: title ? dueAt : null, priority: title ? priority : null };
}
