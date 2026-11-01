import { describe, expect, it } from 'vitest';
import { civilDate, daysUntilMonday, describeDue, localPreset, parseQuickTask, postponeTarget, resolveLocal, shiftLocal, summarizeTasks } from '../shared/task-agenda';
import { groupTasks } from '../shared/task-view';
import { zonedLocalToEpoch } from '../shared/zoned-time';
import type { Task } from '../shared/ipc';

// Sexta, 30 out 2026, 10:00 local.
const now = new Date(2026, 9, 30, 10).getTime();
const at = (month: number, day: number, hour = 0, minute = 0) => new Date(2026, month, day, hour, minute).getTime();
const task = (id: string, dueAt: number | null, values: Partial<Task> = {}): Task => ({ id, noteId: `n-${id}`, noteTitle: 'Nota', title: `T ${id}`, done: false, dueAt, reminderAt: null, reminderState: 'pending', createdAt: now, updatedAt: now, priority: 'normal', ...values });

describe('resumo e rótulos de prazo', () => {
  it('conta pendentes, atrasadas, de hoje e concluídas hoje em uma passada', () => {
    const tasks = [task('late', at(9, 28, 9)), task('today', at(9, 30, 18)), task('later', at(10, 5)), task('none', null), task('done', at(9, 30), { done: true, updatedAt: at(9, 30, 8) }), task('old', at(9, 1), { done: true, updatedAt: at(9, 1) })];
    expect(summarizeTasks(tasks, now)).toEqual({ pending: 4, overdue: 1, dueToday: 1, completedToday: 1 });
  });
  it('descreve prazos relativos e o tom visual', () => {
    expect(describeDue(at(9, 30, 18), false, now).tone).toBe('today');
    expect(describeDue(at(9, 30, 18), false, now).label).toMatch(/^Hoje, /);
    expect(describeDue(at(9, 31), false, now)).toEqual({ label: 'Amanhã', tone: 'soon' });
    expect(describeDue(at(9, 29, 9), false, now).tone).toBe('overdue');
    expect(describeDue(at(9, 29, 9), false, now).label).toMatch(/^Ontem, /);
    expect(describeDue(at(9, 29, 9), true, now).tone).toBe('done');
    expect(describeDue(at(11, 24), false, now).tone).toBe('later');
  });
});

describe('entrada rápida', () => {
  it('extrai dia, hora e prioridade e limpa o título', () => {
    expect(parseQuickTask('Comprar pão amanhã 18h', now)).toEqual({ title: 'Comprar pão', dueAt: at(9, 31, 18), priority: null });
    expect(parseQuickTask('Reunião sexta às 14:30 !alta', now)).toEqual({ title: 'Reunião', dueAt: at(10, 6, 14, 30), priority: 'high' });
    expect(parseQuickTask('Pagar conta depois de amanhã', now)).toEqual({ title: 'Pagar conta', dueAt: at(10, 1, 9), priority: null });
    expect(parseQuickTask('Entregar relatório até hoje', now)).toEqual({ title: 'Entregar relatório', dueAt: at(9, 30, 18), priority: null });
    expect(parseQuickTask('Ler !baixa', now)).toEqual({ title: 'Ler', dueAt: null, priority: 'low' });
  });
  it('não interpreta horas soltas nem esvazia o título', () => {
    expect(parseQuickTask('Treinar 2h por dia', now)).toEqual({ title: 'Treinar 2h por dia', dueAt: null, priority: null });
    expect(parseQuickTask('amanhã', now)).toEqual({ title: 'amanhã', dueAt: null, priority: null });
    expect(parseQuickTask('Reunião amanhã 25h', now).dueAt).toBeNull();
  });
  it('um horário sem dia vira hoje ou, se já passou, amanhã', () => {
    expect(parseQuickTask('Ligar às 11h', now).dueAt).toBe(at(9, 30, 11));
    expect(parseQuickTask('Ligar às 9h', now).dueAt).toBe(at(9, 31, 9));
  });
});

describe('datas civis, atalhos e adiamento', () => {
  it('atalhos usam a data do fuso da tarefa, não a do aparelho', () => {
    const instant = Date.UTC(2026, 9, 31, 1, 30); // 30 out 22:30 em São Paulo, 31 out em UTC
    expect(civilDate('America/Sao_Paulo', instant)).toBe('2026-10-30');
    expect(civilDate('UTC', instant)).toBe('2026-10-31');
    expect(localPreset('America/Sao_Paulo', instant, 1, 9)).toBe('2026-10-31T09:00');
    expect(daysUntilMonday('America/Sao_Paulo', instant)).toBe(3);
    expect(daysUntilMonday('UTC', Date.UTC(2026, 10, 2, 12))).toBe(7);
  });
  it('shiftLocal atravessa meia-noite e virada de mês', () => {
    expect(shiftLocal('2026-10-31T23:50', 20)).toBe('2026-11-01T00:10');
    expect(shiftLocal('2026-03-01T00:10', -20)).toBe('2026-02-28T23:50');
  });
  it('horário inexistente do horário de verão vai para o primeiro minuto válido', () => {
    expect(resolveLocal('2026-03-08T02:30', 'America/New_York')).toBe(zonedLocalToEpoch('2026-03-08T03:00', 'America/New_York'));
    expect(resolveLocal('2026-03-08T01:30', 'America/New_York')).toBe(zonedLocalToEpoch('2026-03-08T01:30', 'America/New_York'));
  });
  it('adiar leva o prazo para amanhã no mesmo horário e mantém a antecedência do lembrete', () => {
    const zone = 'America/Sao_Paulo', current = zonedLocalToEpoch('2026-10-30T12:00', zone);
    const overdue = { dueAt: zonedLocalToEpoch('2026-10-27T14:30', zone), reminderAt: zonedLocalToEpoch('2026-10-27T14:15', zone), timeZone: zone };
    expect(postponeTarget(overdue, current)).toEqual({ dueAt: zonedLocalToEpoch('2026-10-31T14:30', zone), reminderAt: zonedLocalToEpoch('2026-10-31T14:15', zone) });
    expect(postponeTarget({ dueAt: null, reminderAt: null, timeZone: zone }, current)).toEqual({ dueAt: zonedLocalToEpoch('2026-10-31T09:00', zone), reminderAt: null });
  });
  it('adiar para um dia cuja hora foi pulada pelo horário de verão não falha', () => {
    const zone = 'America/New_York', current = zonedLocalToEpoch('2026-03-07T12:00', zone);
    const result = postponeTarget({ dueAt: zonedLocalToEpoch('2026-03-05T02:30', zone), reminderAt: null, timeZone: zone }, current);
    expect(result.dueAt).toBe(zonedLocalToEpoch('2026-03-08T03:00', zone));
  });
});

describe('agrupamento com horário de verão', () => {
  it('um dia de 25 horas não empurra tarefas das 23h para "próximas"', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const sunday = new Date(2026, 10, 1, 12).getTime(); // 1 nov 2026: fim do horário de verão, dia com 25 h
      const late = new Date(2026, 10, 1, 23, 30).getTime(), nextWeek = new Date(2026, 10, 9, 0, 30).getTime();
      const groups = groupTasks([task('late', late), task('week', nextWeek)], sunday);
      expect(groups.today.map(item => item.id)).toEqual(['late']);
      expect(groups.later.map(item => item.id)).toEqual(['week']);
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });
});
