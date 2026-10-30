import { describe, expect, it } from 'vitest';
import { filterTasks, groupTasks } from '../shared/task-view';
import type { Task } from '../shared/ipc';

const now = new Date(2026, 9, 30, 12).getTime();
const task = (id: string, dueAt: number | null, values: Partial<Task> = {}): Task => ({ id, noteId: `note-${id}`, noteTitle: `Nota ${id}`, title: `Tarefa ${id}`, done: false, dueAt, reminderAt: null, reminderState: 'pending', createdAt: now, updatedAt: now, priority: 'normal', ...values });

describe('visão de tarefas', () => {
  it('separa prazos vencidos, hoje, próximos sete dias, mais tarde e sem data; concluídas ficam à parte', () => {
    const result = groupTasks([task('late', now - 86400000), task('today', now), task('next', now + 7 * 86400000), task('later', now + 8 * 86400000), task('none', null), task('done', now, { done: true })], now);
    expect(Object.fromEntries(Object.entries(result).map(([key, items]) => [key, items.map(item => item.id)]))).toEqual({ overdue: ['late'], today: ['today'], next: ['next'], later: ['later'], undated: ['none'], completed: ['done'] });
  });
  it('combina status, prioridade e busca de texto sem alterar a lista de origem', () => {
    const tasks = [task('a', now, { priority: 'high' }), task('b', now, { done: true, noteTitle: 'Projeto azul' }), task('c', null)];
    expect(filterTasks(tasks, { status: 'pending', priority: 'high', query: 'tarefa a' }).map(item => item.id)).toEqual(['a']);
    expect(filterTasks(tasks, { status: 'completed', priority: 'all', query: 'azul' }).map(item => item.id)).toEqual(['b']);
    expect(filterTasks(tasks, { status: 'all', priority: 'all', query: '' })).toHaveLength(3);
  });
});
