import { describe, expect, it } from 'vitest';
import {
  describeEdited, describeEventWhen, describeTaskDue, greetingFor, pickRecentNotes, pickStarredNotes, pickTodayTasks, pickUpcomingEvents,
} from '../shared/home-content';
import type { CalendarEvent, NoteMeta, Task } from '../shared/ipc';

const at = (month: number, day: number, hour = 0, minute = 0) => new Date(2026, month, day, hour, minute).getTime();
const NOW = at(10, 1, 14, 30);
const note = (id: string, updatedAt: number, values: Partial<NoteMeta> = {}): NoteMeta => ({ id, notebookId: null, folderId: null, title: `Nota ${id}`, favorited: false, pinned: false, tags: [], createdAt: 0, updatedAt, deletedAt: null, preview: '', ...values });
const task = (id: string, dueAt: number | null, values: Partial<Task> = {}): Task => ({ id, noteId: 'n', noteTitle: 'N', title: `Tarefa ${id}`, done: false, dueAt, reminderAt: null, reminderState: 'pending', createdAt: 0, updatedAt: 0, ...values });
const event = (id: string, startAt: number, endAt: number, values: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, noteId: null, noteTitle: null, title: `Evento ${id}`, description: '', startAt, endAt, timeZone: 'America/Sao_Paulo', allDay: false, createdAt: 0, updatedAt: 0, ...values });

describe('saudação', () => {
  it('muda por faixa do dia', () => {
    expect([4, 5, 11, 12, 17, 18, 23].map(hour => greetingFor(new Date(2026, 10, 1, hour)))).toEqual(['Boa noite', 'Bom dia', 'Bom dia', 'Boa tarde', 'Boa tarde', 'Boa noite', 'Boa noite']);
  });
});

describe('notas', () => {
  it('recentes: ordena por edição, ignora lixeira e respeita o limite informando o total', () => {
    const notes = [note('a', 10), note('b', 30), note('c', 20, { deletedAt: 5 }), note('d', 25)];
    const pick = pickRecentNotes(notes, 2);
    expect(pick.items.map(item => item.id)).toEqual(['b', 'd']);
    expect(pick.total).toBe(3);
    expect(notes.map(item => item.id)).toEqual(['a', 'b', 'c', 'd']); // entrada intacta
    expect(pickRecentNotes([], 5)).toEqual({ items: [], total: 0 });
    expect(pickRecentNotes(notes, 0).items).toEqual([]);
  });
  it('fixadas e favoritas: fixadas primeiro, depois as mais recentes; lixeira fora', () => {
    const notes = [note('fav-old', 1, { favorited: true }), note('pin-old', 2, { pinned: true }), note('fav-new', 50, { favorited: true }), note('plain', 99), note('pin-fav', 3, { pinned: true, favorited: true }), note('gone', 100, { pinned: true, deletedAt: 1 })];
    expect(pickStarredNotes(notes, 10).items.map(item => item.id)).toEqual(['pin-fav', 'pin-old', 'fav-new', 'fav-old']);
    expect(pickStarredNotes(notes, 2).total).toBe(4);
  });
});

describe('tarefas de hoje', () => {
  it('atrasadas primeiro (mais antigas antes), depois hoje; sem duplicar nem listar concluídas', () => {
    const overdue = [task('o2', at(9, 31)), task('o1', at(9, 20)), task('done', at(9, 10), { done: true })];
    const today = [task('t2', at(10, 1, 18)), task('t1', at(10, 1, 9)), task('o1', at(9, 20))];
    const pick = pickTodayTasks(overdue, today, 10);
    expect(pick.items.map(item => item.id)).toEqual(['o1', 'o2', 't1', 't2']);
    expect(pick.overdue).toBe(2);
    expect(pick.total).toBe(4);
  });
  it('limite corta a lista mas mantém o total', () => {
    const pick = pickTodayTasks([], Array.from({ length: 9 }, (_, i) => task(String(i), at(10, 1, 8 + i % 10))), 5);
    expect(pick.items).toHaveLength(5);
    expect(pick.total).toBe(9);
  });
  it('rótulo de prazo: horário, "Hoje" sem hora marcada e atrasada', () => {
    expect(describeTaskDue(task('a', at(10, 1, 18)), NOW)).toEqual({ label: expect.stringMatching(/^\d{1,2}:00/), overdue: false });
    expect(describeTaskDue(task('a', at(10, 1)), NOW)).toEqual({ label: 'Hoje', overdue: false });
    expect(describeTaskDue(task('a', at(9, 31, 10)), NOW)).toEqual({ label: 'Ontem', overdue: true });
    expect(describeTaskDue(task('a', at(9, 20, 10)), NOW).overdue).toBe(true);
    expect(describeTaskDue(task('a', null), NOW)).toEqual({ label: 'Sem prazo', overdue: false });
  });
});

describe('próximos eventos', () => {
  it('descarta os encerrados e os além do horizonte; ordena por dia, dia inteiro antes, depois início', () => {
    const events = [
      event('past', at(10, 1, 8), at(10, 1, 9)),
      event('later', at(10, 1, 16), at(10, 1, 17)),
      event('allday', at(10, 1), at(10, 2), { allDay: true }),
      event('now', at(10, 1, 14), at(10, 1, 15)),
      event('tomorrow', at(10, 2, 9), at(10, 2, 10)),
      event('far', at(10, 30, 9), at(10, 30, 10)),
    ];
    expect(pickUpcomingEvents(events, NOW, 10).items.map(item => item.id)).toEqual(['allday', 'now', 'later', 'tomorrow']);
    const limited = pickUpcomingEvents(events, NOW, 2);
    expect(limited.items).toHaveLength(2);
    expect(limited.total).toBe(4);
  });
  it('rótulos: Agora, Hoje, Amanhã, dia da semana e dia inteiro', () => {
    expect(describeEventWhen({ startAt: at(10, 1, 14), endAt: at(10, 1, 15), allDay: false }, NOW)).toBe('Agora');
    expect(describeEventWhen({ startAt: at(10, 1, 16), endAt: at(10, 1, 17), allDay: false }, NOW)).toMatch(/^Hoje, \d{1,2}:00/);
    expect(describeEventWhen({ startAt: at(10, 2, 9), endAt: at(10, 2, 10), allDay: false }, NOW)).toMatch(/^Amanhã, \d{1,2}:00/);
    expect(describeEventWhen({ startAt: at(10, 1), endAt: at(10, 2), allDay: true }, NOW)).toBe('Hoje · dia todo');
    expect(describeEventWhen({ startAt: at(10, 5, 9), endAt: at(10, 5, 10), allDay: false }, NOW)).toMatch(/nov/);
  });
});

describe('textos e validações', () => {
  it('edição: hora hoje, "Ontem", senão dia/mês', () => {
    expect(describeEdited(at(10, 1, 9), NOW)).toMatch(/09:00/);
    expect(describeEdited(at(9, 31, 9), NOW)).toBe('Ontem');
    expect(describeEdited(at(8, 5, 9), NOW)).toMatch(/set/);
  });
});
