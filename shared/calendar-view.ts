import type { CalendarEvent } from './ipc';
import { localDateTimeInZone } from './zoned-time';

export type CalendarMode = 'month' | 'week';

const pad = (value: number) => String(value).padStart(2, '0');

export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** Local midnight for a `YYYY-MM-DD` key. */
export const parseDayKey = (key: string) => { const [year, month, day] = key.split('-').map(Number); return new Date(year, month - 1, day); };
/** Calendar-day arithmetic, safe across DST changes. */
export const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
export const startOfWeek = (date: Date) => addDays(date, -((date.getDay() + 6) % 7));

/** Days rendered in the grid: a Monday-based week, or six full weeks around the month. */
export function calendarDays(anchor: Date, mode: CalendarMode): Date[] {
  const first = mode === 'week' ? startOfWeek(anchor) : startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  return Array.from({ length: mode === 'week' ? 7 : 42 }, (_, index) => addDays(first, index));
}

/** Inclusive epoch range covering every rendered day. */
export function visibleRange(days: Date[]): [number, number] {
  const last = days[days.length - 1];
  return [days[0].getTime(), addDays(last, 1).getTime() - 1];
}

/** Moves the anchor by whole weeks, or whole months pinned to day 1 to avoid month overflow. */
export function shiftAnchor(anchor: Date, mode: CalendarMode, delta: number): Date {
  return mode === 'week' ? addDays(anchor, delta * 7) : new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
}

/** First/last local day keys an event occupies. All-day events follow their own zone, never the viewer's. */
export function eventDayRange(event: CalendarEvent): [string, string] {
  if (event.allDay) {
    const first = localDateTimeInZone(event.startAt, event.timeZone).slice(0, 10);
    const last = localDateTimeInZone(event.endAt, event.timeZone).slice(0, 10);
    return [first, last < first ? first : last];
  }
  const first = dayKey(new Date(event.startAt));
  // An event that ends exactly at local midnight does not occupy the following day.
  const end = new Date(event.endAt);
  const endsAtMidnight = event.endAt > event.startAt && end.getHours() + end.getMinutes() + end.getSeconds() + end.getMilliseconds() === 0;
  const last = dayKey(endsAtMidnight ? new Date(event.endAt - 1) : end);
  return [first, last < first ? first : last];
}

export const compareEvents = (a: CalendarEvent, b: CalendarEvent) =>
  Number(b.allDay) - Number(a.allDay) || a.startAt - b.startAt || a.endAt - b.endAt || a.title.localeCompare(b.title);

/** One pass over the events; days outside `[firstKey, lastKey]` are never materialised. */
export function groupEventsByDay(events: CalendarEvent[], firstKey: string, lastKey: string): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of [...events].sort(compareEvents)) {
    const [start, end] = eventDayRange(event);
    if (end < firstKey || start > lastKey) continue;
    const to = end < lastKey ? end : lastKey;
    for (let cursor = parseDayKey(start < firstKey ? firstKey : start), key = dayKey(cursor); key <= to; cursor = addDays(cursor, 1), key = dayKey(cursor)) {
      const list = byDay.get(key);
      if (list) list.push(event); else byDay.set(key, [event]);
    }
  }
  return byDay;
}

/** Events overlapping the range, once each and in display order. */
export function eventsInRange(events: CalendarEvent[], firstKey: string, lastKey: string): CalendarEvent[] {
  return events.filter(event => { const [start, end] = eventDayRange(event); return end >= firstKey && start <= lastKey; }).sort(compareEvents);
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
export const clockLabel = (epoch: number) => timeFormat.format(epoch);

/** Short text for a grid chip: timed events starting on this day lead with their local time. */
export function chipLabel(event: CalendarEvent, key: string): string {
  if (event.allDay || eventDayRange(event)[0] !== key) return event.title;
  return `${clockLabel(event.startAt)} ${event.title}`;
}
