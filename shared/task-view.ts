import type { Task } from './ipc';
import type { Priority } from './recurrence';

export type TaskStatusFilter = 'pending' | 'completed' | 'all';
export type TaskGroupKey = 'overdue' | 'today' | 'next' | 'later' | 'undated' | 'completed';
export type TaskGroups = Record<TaskGroupKey, Task[]>;

const dayStart = (value: number) => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date.getTime(); };

export function filterTasks(tasks: Task[], options: { status: TaskStatusFilter; priority: Priority | 'all'; query: string }): Task[] {
  const query = options.query.trim().toLocaleLowerCase();
  return tasks.filter(task => (options.status === 'all' || (options.status === 'completed') === task.done)
    && (options.priority === 'all' || (task.priority ?? 'normal') === options.priority)
    && (!query || `${task.title} ${task.noteTitle}`.toLocaleLowerCase().includes(query)));
}

export function groupTasks(tasks: Task[], now = Date.now()): TaskGroups {
  // Calendar-day arithmetic: a 23h/25h day (DST) must not shift the "today" and "next 7 days" boundaries.
  const today = dayStart(now), start = new Date(today), tomorrow = new Date(start).setDate(start.getDate() + 1), afterWeek = new Date(start).setDate(start.getDate() + 8);
  const groups: TaskGroups = { overdue: [], today: [], next: [], later: [], undated: [], completed: [] };
  for (const task of tasks) {
    if (task.done) groups.completed.push(task);
    else if (task.dueAt === null) groups.undated.push(task);
    else if (task.dueAt < today) groups.overdue.push(task);
    else if (task.dueAt < tomorrow) groups.today.push(task);
    else if (task.dueAt < afterWeek) groups.next.push(task);
    else groups.later.push(task);
  }
  for (const items of Object.values(groups)) items.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.title.localeCompare(b.title));
  return groups;
}
