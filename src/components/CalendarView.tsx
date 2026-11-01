import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import type { CalendarEvent } from '../../shared/ipc';
import { addDays, calendarDays, chipLabel, dayKey, eventDayRange, eventsInRange, groupEventsByDay, parseDayKey, shiftAnchor, startOfWeek, visibleRange, type CalendarMode } from '../../shared/calendar-view';
import { client } from '../api/client';
import { AgendaError, AgendaHeader, localZone, type AgendaHost } from './AgendaParts';
import { shortcutAllowed, useAgendaResource, useTodayKey } from './useAgenda';

const EMPTY: CalendarEvent[] = [];
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MODE_KEY = 'caderno.calendar.mode';
const dateLabel = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const dayTitle = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const zoneClocks = new Map<string, Intl.DateTimeFormat>();
const clockInZone = (epoch: number, zone: string) => {
  let format = zoneClocks.get(zone);
  if (!format) { format = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: '2-digit', minute: '2-digit' }); zoneClocks.set(zone, format); }
  return format.format(epoch);
};
const zoneDateTime = (epoch: number, zone: string) => new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'short', timeStyle: 'short' }).format(epoch);

/** Same day-of-month one month away, clamped to the last day of shorter months. */
const shiftDay = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() + months, Math.min(date.getDate(), new Date(date.getFullYear(), date.getMonth() + months + 1, 0).getDate()));
const LOCAL_ZONE = localZone();
const storedMode = (): CalendarMode => { try { return localStorage.getItem(MODE_KEY) === 'week' ? 'week' : 'month'; } catch { return 'month'; } };

/** Short windows (900x560) get one chip fewer per day so the grid never needs inner scrolling. */
function useCompact() {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-height: 650px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-height: 650px)');
    const change = () => setCompact(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return compact;
}

type CellProps = {
  date: Date; events: CalendarEvent[]; isToday: boolean; isSelected: boolean; isOutside: boolean; focusable: boolean; maxChips: number;
  onSelect(key: string): void; onCreate(key: string): void; onEdit(event: CalendarEvent, opener: HTMLElement): void;
};

const DayCell = memo(function DayCell({ date, events, isToday, isSelected, isOutside, focusable, maxChips, onSelect, onCreate, onEdit }: CellProps) {
  const key = dayKey(date);
  const count = events.length;
  return <button type="button" role="gridcell" data-day={key} tabIndex={focusable ? 0 : -1} aria-selected={isSelected}
    aria-label={`${dateLabel.format(date)}${isToday ? ' (hoje)' : ''}${count ? `, ${count} ${count === 1 ? 'evento' : 'eventos'}` : ''}`}
    className={`calendar-day${isToday ? ' today' : ''}${isOutside ? ' outside' : ''}${count ? ' has-events' : ''}`}
    onClick={() => onSelect(key)} onDoubleClick={() => onCreate(key)}>
    <span>{date.getDate()}</span>
    {events.slice(0, maxChips).map(event => <span key={event.id} aria-hidden="true" title={event.title} className={`calendar-event${event.allDay ? ' all-day' : ''}`} onClick={e => { e.stopPropagation(); onEdit(event, e.currentTarget.closest('button')!); }}>{chipLabel(event, key)}</span>)}
    {count > maxChips && <small aria-hidden="true">+{count - maxChips}</small>}
  </button>;
});

function eventWhen(event: CalendarEvent) {
  const [first, last] = eventDayRange(event);
  if (event.allDay) return first === last ? 'Dia inteiro' : 'Dia inteiro · vários dias';
  if (dayKey(new Date(event.startAt)) === dayKey(new Date(event.endAt - (event.endAt > event.startAt ? 1 : 0)))) return `${clockInZone(event.startAt, event.timeZone)} – ${clockInZone(event.endAt, event.timeZone)}`;
  return `${zoneDateTime(event.startAt, event.timeZone)} – ${zoneDateTime(event.endAt, event.timeZone)}`;
}

export function CalendarView({ host, error }: { host: AgendaHost; error: string }) {
  const [mode, setModeState] = useState<CalendarMode>(storedMode);
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dayKey(new Date()));
  const todayKey = useTodayKey();
  const compact = useCompact();
  const grid = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null), focusAfter = useRef<string | null>(null), cache = useRef(new Map<string, CalendarEvent[]>());

  const days = useMemo(() => calendarDays(anchor, mode), [anchor, mode]);
  const firstKey = dayKey(days[0]), lastKey = dayKey(days[days.length - 1]);
  const [rangeStart, rangeEnd] = useMemo(() => visibleRange(days), [days]);

  // One request per visited range; revisits are served from memory until the agenda changes.
  const { value: events = EMPTY, loaded, loading, reload, mutate } = useAgendaResource(`${rangeStart}:${rangeEnd}`, async force => {
    if (force) cache.current.clear();
    const cacheKey = `${rangeStart}:${rangeEnd}`, hit = cache.current.get(cacheKey);
    if (hit) return hit;
    const fetched = await client.listEvents(rangeStart, rangeEnd);
    cache.current.set(cacheKey, fetched);
    if (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!);
    return fetched;
  }, host.report);

  const byDay = useMemo(() => groupEventsByDay(events, firstKey, lastKey), [events, firstKey, lastKey]);
  const agenda = useMemo(() => {
    const groups = new Map<string, CalendarEvent[]>();
    for (const event of eventsInRange(events, firstKey, lastKey)) {
      const start = eventDayRange(event)[0], key = start < firstKey ? firstKey : start;
      const bucket = groups.get(key);
      if (bucket) bucket.push(event); else groups.set(key, [event]);
    }
    return [...groups].sort(([a], [b]) => a < b ? -1 : 1);
  }, [events, firstKey, lastKey]);
  const total = useMemo(() => agenda.reduce((sum, [, items]) => sum + items.length, 0), [agenda]);

  const setMode = (next: CalendarMode) => { setModeState(next); try { localStorage.setItem(MODE_KEY, next); } catch { /* storage is optional */ } };
  const navigate = (delta: number) => {
    const next = shiftAnchor(anchor, mode, delta), nextDays = calendarDays(next, mode);
    setAnchor(next);
    setSelected(nextDays.some(day => dayKey(day) === todayKey) && (mode === 'week' || next.getMonth() === parseDayKey(todayKey).getMonth()) ? todayKey : dayKey(mode === 'week' ? nextDays[0] : new Date(next.getFullYear(), next.getMonth(), 1)));
  };
  const goToday = () => { setAnchor(new Date()); setSelected(dayKey(new Date())); };
  const createOn = useCallback((key: string, opener?: HTMLElement | null) => host.createEvent(parseDayKey(key), opener), [host]);
  const select = useCallback((key: string) => setSelected(key), []);
  const create = useCallback((key: string) => { setSelected(key); createOn(key, document.activeElement as HTMLElement); }, [createOn]);
  const edit = useCallback((event: CalendarEvent, opener: HTMLElement) => host.editEvent(event, opener), [host]);

  const moveTo = (date: Date) => {
    const key = dayKey(date);
    focusAfter.current = key;
    setSelected(key);
    if (key < firstKey || key > lastKey) setAnchor(date);
  };
  const onGridKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-day]');
    if (!cell) return;
    const current = parseDayKey(cell.dataset.day!);
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in step) { event.preventDefault(); moveTo(addDays(current, step[event.key])); }
    else if (event.key === 'Home') { event.preventDefault(); moveTo(startOfWeek(current)); }
    else if (event.key === 'End') { event.preventDefault(); moveTo(addDays(startOfWeek(current), 6)); }
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const next = mode === 'week' ? addDays(current, event.key === 'PageUp' ? -7 : 7) : shiftDay(current, event.key === 'PageUp' ? -1 : 1);
      focusAfter.current = dayKey(next);
      setAnchor(next);
      setSelected(dayKey(next));
    }
  };
  useEffect(() => {
    const key = focusAfter.current;
    if (!key) return;
    focusAfter.current = null;
    grid.current?.querySelector<HTMLElement>(`[data-day="${key}"]`)?.focus();
  });

  // Keep the selected day's section in view inside the agenda column (no page scroll when it is stacked).
  useEffect(() => {
    const box = list.current, section = box?.querySelector<HTMLElement>(`[data-agenda-day="${selected}"]`);
    if (box && section && box.scrollHeight > box.clientHeight) box.scrollTo({ top: section.offsetTop - 4 });
  }, [selected, agenda]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!shortcutAllowed(event)) return;
      if (event.key === 'n') { event.preventDefault(); createOn(selected, document.activeElement as HTMLElement); }
      else if (event.key === 't') goToday();
      else if (event.key === 'm') setMode('month');
      else if (event.key === 's') setMode('week');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const remove = (event: CalendarEvent) => {
    cache.current.clear();
    mutate(list => list.filter(item => item.id !== event.id));
    const request = client.deleteEvent(event.id);
    void request.then(() => host.toast('Evento excluído', async () => {
      await client.createEvent({ noteId: event.noteId, title: event.title, description: event.description, startAt: event.startAt, endAt: event.endAt, timeZone: event.timeZone, allDay: event.allDay });
      await reload(true);
    })).catch(failure => { host.report((failure as Error).message); void reload(true); });
  };
  const openNote = (event: CalendarEvent) => void host.openNote(event.noteId).catch(failure => host.report((failure as Error).message));

  const visibleSelected = selected >= firstKey && selected <= lastKey;
  const tabKey = visibleSelected ? selected : days.some(day => dayKey(day) === todayKey) ? todayKey : firstKey;
  const selectedEvents = byDay.get(selected)?.length ?? 0;
  const maxChips = mode === 'week' ? 8 : compact ? 2 : 3;
  const title = mode === 'month' ? monthTitle.format(anchor) : `${shortDate.format(days[0])} – ${shortDate.format(days[6])}`;

  return <>
    <AgendaHeader title="Calendário" subtitle="Dados locais neste dispositivo">
      <button onClick={goToday} aria-keyshortcuts="T" title="Hoje (T)">Hoje</button>
      <button aria-label="Anterior" title={mode === 'week' ? 'Semana anterior' : 'Mês anterior'} onClick={() => navigate(-1)}>‹</button>
      <button aria-label="Próximo" title={mode === 'week' ? 'Próxima semana' : 'Próximo mês'} onClick={() => navigate(1)}>›</button>
      <select aria-label="Modo de calendário" aria-keyshortcuts="M S" value={mode} onChange={e => setMode(e.target.value as CalendarMode)}><option value="month">Mês</option><option value="week">Semana</option></select>
      <button className="primary" aria-keyshortcuts="N" title="Novo evento (N)" onClick={e => createOn(selected, e.currentTarget)}>Novo evento</button>
    </AgendaHeader>
    <AgendaError message={error}/>
    <div className="calendar-layout" aria-busy={loading}><div className="calendar-shell">
      <div className="calendar-main">
        <h2 aria-live="polite">{title}</h2>
        <div ref={grid} className={`calendar-grid ${mode}`} role="grid" aria-label={mode === 'month' ? 'Calendário mensal' : 'Agenda semanal'} onKeyDown={onGridKey}>
          <div role="row" className="calendar-row">{WEEKDAYS.map(day => <div className="calendar-weekday" role="columnheader" key={day}>{day}</div>)}</div>
          {Array.from({ length: days.length / 7 }, (_, week) => <div role="row" className="calendar-row" key={dayKey(days[week * 7])}>
            {days.slice(week * 7, week * 7 + 7).map(date => {
              const key = dayKey(date);
              return <DayCell key={key} date={date} events={byDay.get(key) ?? EMPTY} isToday={key === todayKey} isSelected={key === selected} isOutside={mode === 'month' && date.getMonth() !== anchor.getMonth()} focusable={key === tabKey} maxChips={maxChips} onSelect={select} onCreate={create} onEdit={edit}/>;
            })}
          </div>)}
        </div>
      </div>
      <aside className="calendar-side">
        <div className="calendar-selected">
          <div><strong>{dayTitle.format(parseDayKey(selected))}</strong><small>{selected === todayKey ? 'Hoje · ' : ''}{selectedEvents ? `${selectedEvents} ${selectedEvents === 1 ? 'evento' : 'eventos'}` : 'Sem eventos'}</small></div>
          <button type="button" className="calendar-add" onClick={e => createOn(selected, e.currentTarget)}><Plus size={14}/>Neste dia</button>
        </div>
        <h3>Eventos no período</h3>
        <div ref={list} className="agenda-list">
          {agenda.map(([key, items]) => <section className={`agenda-day${key === selected ? ' selected' : ''}`} data-agenda-day={key} key={key}>
            <h4>{dayTitle.format(parseDayKey(key))}{key === todayKey ? ' · hoje' : ''}</h4>
            {items.map(event => <article key={event.id}>
              <div className="agenda-item"><strong>{event.title}</strong><span className="agenda-when">{eventWhen(event)}{event.timeZone !== LOCAL_ZONE ? ` · ${event.timeZone}` : ''}</span>{event.description && <span className="agenda-description">{event.description}</span>}{event.noteTitle && <small>{event.noteTitle}</small>}</div>
              <div className="agenda-event-actions">
                {event.noteId && <button aria-label="Abrir nota" title="Abrir nota vinculada" onClick={() => openNote(event)}><ExternalLink size={14}/></button>}
                <button aria-label="Editar" title="Editar evento" onClick={e => edit(event, e.currentTarget)}><Pencil size={14}/></button>
                <button aria-label="Excluir" title="Excluir evento" onClick={() => remove(event)}><Trash2 size={14}/></button>
              </div>
            </article>)}
          </section>)}
          {loaded && total === 0 && <p className="agenda-empty">Nenhum evento neste período. Dê dois cliques em um dia para criar.</p>}
        </div>
      </aside>
    </div></div>
  </>;
}
