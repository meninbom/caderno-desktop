import { describe, expect, it } from 'vitest';
import { calendarDays, chipLabel, dayKey, eventDayRange, eventsInRange, groupEventsByDay, parseDayKey, shiftAnchor, visibleRange } from '../shared/calendar-view';
import { zonedAllDayRange } from '../shared/zoned-time';
import type { CalendarEvent } from '../shared/ipc';

const at = (month: number, day: number, hour = 0, minute = 0) => new Date(2026, month, day, hour, minute).getTime();
const event = (id: string, startAt: number, endAt: number, values: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, noteId: null, noteTitle: null, title: `Evento ${id}`, description: '', startAt, endAt, timeZone: 'America/Sao_Paulo', allDay: false, createdAt: 0, updatedAt: 0, ...values });

describe('grade do calendário', () => {
  it('mês tem 42 dias começando na segunda e semana tem 7', () => {
    const days = calendarDays(new Date(2026, 9, 15), 'month');
    expect(days).toHaveLength(42);
    expect(dayKey(days[0])).toBe('2026-09-28');
    expect(days[0].getDay()).toBe(1);
    expect(dayKey(days[41])).toBe('2026-11-08');
    expect(calendarDays(new Date(2026, 9, 30), 'week').map(dayKey)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  });
  it('o intervalo visível cobre a grade inteira, inclusive os dias de transbordo', () => {
    const [start, end] = visibleRange(calendarDays(new Date(2026, 9, 15), 'month'));
    expect(start).toBe(at(8, 28));
    expect(end).toBe(at(10, 9) - 1);
  });
  it('navegar um mês nunca transborda (31 jan → fev)', () => {
    expect(dayKey(shiftAnchor(new Date(2026, 0, 31), 'month', 1))).toBe('2026-02-01');
    expect(dayKey(shiftAnchor(new Date(2026, 2, 31), 'month', -1))).toBe('2026-02-01');
    expect(dayKey(shiftAnchor(new Date(2026, 9, 30), 'week', 1))).toBe('2026-11-06');
  });
  it('chaves de dia fazem ida e volta', () => expect(dayKey(parseDayKey('2026-03-08'))).toBe('2026-03-08'));
});

describe('eventos por dia', () => {
  it('evento de dia inteiro segue o próprio fuso, não o do aparelho', () => {
    const range = zonedAllDayRange('2026-10-30', '2026-10-31', 'Pacific/Auckland');
    expect(eventDayRange(event('a', range.startAt, range.endAt, { allDay: true, timeZone: 'Pacific/Auckland' }))).toEqual(['2026-10-30', '2026-10-31']);
  });
  it('um evento que termina exatamente à meia-noite não ocupa o dia seguinte', () => {
    expect(eventDayRange(event('a', at(9, 30, 22), at(9, 31)))).toEqual(['2026-10-30', '2026-10-30']);
    expect(eventDayRange(event('b', at(9, 30, 22), at(9, 31, 1)))).toEqual(['2026-10-30', '2026-10-31']);
  });
  it('agrupa uma vez, ordena dia inteiro primeiro e repete eventos de vários dias', () => {
    const range = zonedAllDayRange('2026-10-30', '2026-10-30', 'America/Sao_Paulo');
    const events = [event('late', at(9, 30, 15), at(9, 30, 16)), event('early', at(9, 30, 8), at(9, 30, 9)), event('all', range.startAt, range.endAt, { allDay: true }), event('span', at(9, 29, 20), at(9, 31, 10))];
    const byDay = groupEventsByDay(events, '2026-10-26', '2026-11-01');
    expect(byDay.get('2026-10-30')!.map(e => e.id)).toEqual(['all', 'span', 'early', 'late']);
    expect([...byDay.keys()].sort()).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
  });
  it('limita o trabalho ao intervalo visível mesmo para eventos muito longos', () => {
    expect(groupEventsByDay([event('year', at(0, 1), at(11, 31))], '2026-10-26', '2026-11-01').size).toBe(7);
  });
  it('ignora eventos fora do intervalo e lista cada evento uma única vez', () => {
    const events = [event('out', at(5, 1, 9), at(5, 1, 10)), event('in', at(9, 29, 20), at(9, 31, 10))];
    expect(eventsInRange(events, '2026-10-26', '2026-11-01').map(e => e.id)).toEqual(['in']);
  });
  it('o rótulo da pastilha mostra a hora só no dia em que o evento começa', () => {
    const e = event('a', at(9, 30, 14, 5), at(9, 31, 10));
    expect(chipLabel(e, '2026-10-30')).toMatch(/14.05 Evento a$/);
    expect(chipLabel(e, '2026-10-31')).toBe('Evento a');
    expect(chipLabel(event('b', at(9, 30), at(9, 30, 23), { allDay: true }), '2026-10-30')).toBe('Evento b');
  });
});
