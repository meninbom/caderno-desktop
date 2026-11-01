import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, Bell, CalendarDays, ChevronDown, Clock3, ExternalLink, Repeat2, Search, Trash2, X } from 'lucide-react';
import type { Task } from '../../shared/ipc';
import type { Priority } from '../../shared/recurrence';
import { filterTasks, groupTasks, type TaskGroupKey, type TaskStatusFilter } from '../../shared/task-view';
import { describeDue, parseQuickTask, postponeTarget, summarizeTasks } from '../../shared/task-agenda';
import { client } from '../api/client';
import { AgendaError, AgendaHeader, taskToDraft, type AgendaHost } from './AgendaParts';
import { shortcutAllowed, useAgendaResource, useTodayKey } from './useAgenda';

const EMPTY: Task[] = [];
const PAGE_SIZE = 100;
const GROUPS: [TaskGroupKey, string][] = [['overdue', 'Atrasadas'], ['today', 'Hoje'], ['next', 'Próximas'], ['later', 'Mais tarde'], ['undated', 'Sem data'], ['completed', 'Concluídas']];
const PRIORITY_NAME: Record<Priority, string> = { high: 'alta', normal: 'normal', low: 'baixa' };
const RECURRENCE_NAME = { daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal' } as const;
const repeats = (task: Task) => !!task.recurrence && task.recurrence !== 'none';

type RowActions = {
  toggle(task: Task, done: boolean): void;
  setPriority(task: Task, priority: Priority): void;
  postpone(task: Task): void;
  remove(task: Task): void;
  edit(task: Task, opener: HTMLElement): void;
  openNote(task: Task): void;
};

const TaskRow = memo(function TaskRow({ task, todayKey, actions }: { task: Task; todayKey: string; actions: RowActions }) {
  const due = task.dueAt === null ? null : describeDue(task.dueAt, task.done);
  const reminder = task.reminderAt !== null && !task.done ? describeDue(task.reminderAt, false) : null;
  const priority = task.priority ?? 'normal';
  return <article className={`task-row${task.done ? ' is-done' : ''}`} data-task-id={task.id} data-day={todayKey}>
    <label className="task-check-wrap"><input className="task-checkbox" aria-label={task.done ? `Reabrir ${task.title}` : `Concluir ${task.title}`} type="checkbox" checked={task.done} onChange={e => actions.toggle(task, e.target.checked)}/></label>
    <div className="task-copy" onDoubleClick={e => actions.edit(task, e.currentTarget)}>
      <div className="task-title-line">
        <strong title={task.title}>{task.title}</strong>
        <span className={`task-priority-dot ${priority}`} title={`Prioridade ${PRIORITY_NAME[priority]}`}/>
        {priority === 'high' && !task.done && <span className="task-flag high">Alta</span>}
        <span className="agenda-sr">Prioridade {PRIORITY_NAME[priority]}</span>
      </div>
      <div className="task-meta">
        {due && <span className={`task-date-chip ${due.tone}`} title={new Date(task.dueAt!).toLocaleString()}><Clock3 size={12}/>{due.label}</span>}
        {reminder && <span className="task-reminder" title={task.reminderState === 'delivered' ? 'Lembrete já entregue' : 'Lembrete programado'}><Bell size={11}/>{reminder.label}</span>}
        {repeats(task) && <span className="task-repeat"><Repeat2 size={12}/>{RECURRENCE_NAME[task.recurrence as keyof typeof RECURRENCE_NAME]}</span>}
        <button className="task-origin" title="Abrir a nota desta tarefa" onClick={() => actions.openNote(task)}>{task.noteTitle || 'Sem título'}<ExternalLink size={11}/></button>
      </div>
    </div>
    <div className="task-row-actions">
      <button aria-label={`Editar prazo e recorrência de ${task.title}`} title="Editar prazo" onClick={e => actions.edit(task, e.currentTarget)}><CalendarDays size={15}/></button>
      {!task.done && <button aria-label={`Adiar ${task.title} para amanhã`} title="Adiar para amanhã" onClick={() => actions.postpone(task)}><AlarmClock size={15}/></button>}
      <select aria-label={`Prioridade de ${task.title}`} value={priority} onChange={e => actions.setPriority(task, e.target.value as Priority)}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select>
      <button aria-label={`Excluir ${task.title}`} title="Excluir tarefa" onClick={() => actions.remove(task)}><Trash2 size={15}/></button>
    </div>
  </article>;
});

export function TasksView({ host, error }: { host: AgendaHost; error: string }) {
  const [status, setStatus] = useState<TaskStatusFilter>('pending');
  const [priority, setPriority] = useState<'all' | Priority>('all');
  const [query, setQuery] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [collapsed, setCollapsed] = useState<Partial<Record<TaskGroupKey, boolean>>>({ completed: true });
  const [limits, setLimits] = useState<Partial<Record<TaskGroupKey, number>>>({});
  const deferredQuery = useDeferredValue(query);
  const search = useRef<HTMLInputElement>(null);
  const todayKey = useTodayKey();
  const { value: tasks = EMPTY, loaded, reload, mutate } = useAgendaResource('tasks', () => client.listTasks('all', 'all'), host.report);

  const visible = useMemo(() => filterTasks(tasks, { status, priority, query: deferredQuery }), [tasks, status, priority, deferredQuery]);
  const groups = useMemo(() => groupTasks(visible), [visible, todayKey]);
  const summary = useMemo(() => summarizeTasks(tasks), [tasks, todayKey]);
  const quick = useMemo(() => quickTitle.trim() ? parseQuickTask(quickTitle) : null, [quickTitle]);
  const filtered = status !== 'pending' || priority !== 'all' || !!query.trim();

  const actions = useMemo<RowActions>(() => ({
    toggle(task, done) {
      mutate(list => list.map(item => item.id === task.id ? { ...item, done, updatedAt: Date.now() } : item));
      const request = client.updateTask({ id: task.id, done });
      // Completing a repeating task makes the repository create its next occurrence.
      void request.then(() => done && repeats(task) ? reload(true) : undefined).catch(error => { host.report((error as Error).message); void reload(true); });
    },
    setPriority(task, next) {
      mutate(list => list.map(item => item.id === task.id ? { ...item, priority: next } : item));
      void client.updateTask({ id: task.id, priority: next }).catch(error => { host.report((error as Error).message); void reload(true); });
    },
    postpone(task) {
      const target = postponeTarget(task);
      mutate(list => list.map(item => item.id === task.id ? { ...item, dueAt: target.dueAt, reminderAt: target.reminderAt, reminderState: 'pending' } : item));
      const request = client.updateTask({ id: task.id, dueAt: target.dueAt, ...(task.reminderAt === null ? {} : { reminderAt: target.reminderAt }) });
      void request.then(() => host.toast('Prazo adiado para amanhã', async () => {
        await client.updateTask({ id: task.id, dueAt: task.dueAt, ...(task.reminderAt === null ? {} : { reminderAt: task.reminderAt }) });
        await reload(true);
      })).catch(error => { host.report((error as Error).message); void reload(true); });
    },
    remove(task) {
      mutate(list => list.filter(item => item.id !== task.id));
      const request = client.deleteTask(task.id);
      // A completed repeating task already spawned its successor, which a re-created copy would duplicate.
      const restorable = !(task.done && repeats(task));
      void request.then(() => host.toast('Tarefa excluída', restorable ? async () => {
        const id = await client.createTask({ noteId: task.noteId, title: task.title, dueAt: task.dueAt, reminderAt: task.reminderState === 'delivered' ? null : task.reminderAt, recurrence: task.recurrence, priority: task.priority, timeZone: task.timeZone });
        if (task.done) await client.updateTask({ id, done: true });
        await reload(true);
      } : undefined)).catch(error => { host.report((error as Error).message); void reload(true); });
    },
    edit: (task, opener) => host.editTask(task, opener),
    openNote: task => void host.openNote(task.noteId).catch(error => host.report((error as Error).message)),
  }), [host, mutate, reload]);

  const submitQuick = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseQuickTask(quickTitle);
    if (!parsed.title) return;
    host.createTask({ noteId: '', title: parsed.title, dueAt: parsed.dueAt, reminderAt: null, priority: parsed.priority ?? undefined }, { opener: document.activeElement as HTMLElement, saved: () => setQuickTitle('') });
  };
  const clearFilters = () => { setStatus('pending'); setPriority('all'); setQuery(''); };
  const jumpToday = () => {
    const target = document.getElementById('task-group-today') ?? document.getElementById('task-group-overdue');
    target?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target?.querySelector<HTMLElement>('.task-group-heading')?.focus({ preventScroll: true });
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!shortcutAllowed(event)) return;
      if (event.key === '/') { event.preventDefault(); search.current?.focus(); }
      else if (event.key === 'n') { event.preventDefault(); host.createTask({ noteId: '', title: '', dueAt: null, reminderAt: null }, { opener: document.activeElement as HTMLElement }); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [host]);

  // Arrow keys walk the checkboxes; Enter edits and Delete removes the focused task.
  const onListKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches('input.task-checkbox')) return;
    const task = tasks.find(item => item.id === target.closest<HTMLElement>('[data-task-id]')?.dataset.taskId);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const boxes = [...event.currentTarget.querySelectorAll<HTMLElement>('input.task-checkbox')];
      const next = boxes[boxes.indexOf(target) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) { event.preventDefault(); next.focus(); }
    } else if (task && event.key === 'Enter') { event.preventDefault(); actions.edit(task, target); }
    else if (task && event.key === 'Delete') { event.preventDefault(); (target.closest('.task-row')?.nextElementSibling?.querySelector<HTMLElement>('input.task-checkbox') ?? target.closest('.task-row')?.previousElementSibling?.querySelector<HTMLElement>('input.task-checkbox'))?.focus(); actions.remove(task); }
  };

  const quickHint = quick && (quick.dueAt !== null || quick.priority !== null)
    ? <>Será criada “{quick.title}”{quick.dueAt !== null && <> · <strong>{describeDue(quick.dueAt, false).label}</strong></>}{quick.priority && <> · prioridade <strong>{PRIORITY_NAME[quick.priority]}</strong></>} — escolha a nota para concluir.</>
    : <>Pressione Enter para escolher a nota. Dicas: “amanhã 9h”, “sexta”, “!alta”.</>;

  return <>
    <AgendaHeader title="Tarefas" subtitle="Lembretes ativos enquanto o app estiver aberto">
      <button onClick={jumpToday} title="Ir para as tarefas de hoje">Hoje</button>
      <button className="primary" aria-keyshortcuts="N" title="Nova tarefa (N)" onClick={e => host.createTask({ noteId: '', title: '', dueAt: null, reminderAt: null }, { opener: e.currentTarget })}>Nova tarefa</button>
    </AgendaHeader>
    <AgendaError message={error}/>
    <section className="tasks-page" aria-busy={!loaded}>
      <div className="tasks-summary"><span><strong>{summary.pending}</strong> pendentes</span><span className={summary.overdue ? 'alert' : undefined}><strong>{summary.overdue}</strong> atrasadas</span><span><strong>{summary.dueToday}</strong> para hoje</span><span><strong>{summary.completedToday}</strong> concluídas hoje</span></div>
      <form className="task-quick-add" onSubmit={submitQuick}><input aria-label="Adicionar tarefa rapidamente" placeholder="Adicionar uma tarefa…" maxLength={300} value={quickTitle} onChange={e => setQuickTitle(e.target.value)}/><button className="primary" type="submit" disabled={!quickTitle.trim()}>Adicionar</button></form>
      <p className="task-quick-hint" aria-live="polite">{quickHint}</p>
      <div className="task-toolbar">
        <label className="task-search"><Search size={15}/><input ref={search} aria-label="Buscar tarefas" aria-keyshortcuts="/" placeholder="Buscar tarefas ou notas  ( / )" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); } }}/>{query && <button type="button" className="task-search-clear" aria-label="Limpar busca" onClick={() => { setQuery(''); search.current?.focus(); }}><X size={13}/></button>}</label>
        <select aria-label="Status das tarefas" value={status} onChange={e => setStatus(e.target.value as TaskStatusFilter)}><option value="pending">Pendentes</option><option value="completed">Concluídas</option><option value="all">Todas</option></select>
        <select aria-label="Filtrar prioridade" value={priority} onChange={e => setPriority(e.target.value as 'all' | Priority)}><option value="all">Todas as prioridades</option><option value="high">Alta</option><option value="normal">Normal</option><option value="low">Baixa</option></select>
        {filtered && <button type="button" className="task-clear" onClick={clearFilters}>Limpar filtros</button>}
        <span className="agenda-sr" role="status">{loaded ? `${visible.length} ${visible.length === 1 ? 'tarefa' : 'tarefas'}` : 'Carregando'}</span>
      </div>
      <div className="task-groups" onKeyDown={onListKey}>
        {GROUPS.map(([key, title]) => {
          const items = groups[key];
          if (!items.length) return null;
          const open = status === 'completed' || !collapsed[key];
          const limit = limits[key] ?? PAGE_SIZE;
          return <section className={`task-group ${key}`} id={`task-group-${key}`} key={key}>
            <button className="task-group-heading" aria-expanded={open} aria-controls={`task-rows-${key}`} onClick={() => setCollapsed(current => ({ ...current, [key]: open }))}><span><ChevronDown size={15} className={open ? 'open' : ''}/><strong>{title}</strong><small>{items.length}</small></span></button>
            {open && <div className="task-rows" id={`task-rows-${key}`}>
              {items.slice(0, limit).map(task => <TaskRow key={task.id} task={task} todayKey={todayKey} actions={actions}/>)}
              {items.length > limit && <button className="task-more" onClick={() => setLimits(current => ({ ...current, [key]: limit + PAGE_SIZE }))}>Mostrar mais {Math.min(PAGE_SIZE, items.length - limit)} de {items.length - limit}</button>}
            </div>}
          </section>;
        })}
        {loaded && !visible.length && (tasks.length === 0
          ? <p className="task-empty" role="status">Nenhuma tarefa ainda. Escreva acima e pressione Enter para criar a primeira.</p>
          : <p className="task-empty" role="status">{filtered ? 'Nenhuma tarefa com estes filtros.' : 'Tudo em dia: não há tarefas pendentes.'}{filtered && <> <button type="button" className="task-clear" onClick={clearFilters}>Limpar filtros</button></>}</p>)}
      </div>
    </section>
  </>;
}
