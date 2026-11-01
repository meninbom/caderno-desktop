import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AGENDA_CHANGED } from './useAgenda';
import { EventDialog, TaskDialog, type EventDraft, type TaskDraft } from './AgendaDialogs';
import { eventToDraft, localZone, taskToDraft, type AgendaHost } from './AgendaParts';
import { TasksView } from './TasksView';
import { CalendarView } from './CalendarView';

const TOAST_MS = 7000;
type Toast = { id: number; message: string; undo?: () => Promise<void> };

export function LocalAgenda({ area, openNote }: { area: 'tasks' | 'calendar'; openNote: (id: string | null) => Promise<void> }) {
  const [error, setError] = useState('');
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const opener = useRef<HTMLElement | null>(null), taskSaved = useRef<(() => void) | undefined>(undefined), openNoteRef = useRef(openNote), toastTimer = useRef(0), toastId = useRef(0);
  openNoteRef.current = openNote;

  const host = useMemo<AgendaHost>(() => ({
    openNote: id => openNoteRef.current(id),
    report: setError,
    toast(message, undo) {
      window.clearTimeout(toastTimer.current);
      setToast({ id: ++toastId.current, message, undo });
      toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
    },
    createTask(draft, options) { opener.current = options?.opener ?? (document.activeElement as HTMLElement | null); taskSaved.current = options?.saved; setTaskDraft(draft); },
    editTask(task, from) { opener.current = from ?? (document.activeElement as HTMLElement | null); taskSaved.current = undefined; setTaskDraft(taskToDraft(task)); },
    createEvent(day, from) {
      opener.current = from ?? (document.activeElement as HTMLElement | null);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9), end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10);
      setEventDraft({ noteId: null, title: '', description: '', startAt: start.getTime(), endAt: end.getTime(), timeZone: localZone(), allDay: false });
    },
    editEvent(event, from) { opener.current = from ?? (document.activeElement as HTMLElement | null); setEventDraft(eventToDraft(event)); },
  }), []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  useEffect(() => setError(''), [area]);

  const restoreFocus = () => requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus(); });
  const closeTask = () => { setTaskDraft(null); taskSaved.current = undefined; restoreFocus(); };
  const closeEvent = () => { setEventDraft(null); restoreFocus(); };
  const changed = () => window.dispatchEvent(new Event(AGENDA_CHANGED));
  const undo = useCallback(async () => {
    const action = toast?.undo;
    setToast(null);
    try { await action?.(); } catch (failure) { setError((failure as Error).message); }
  }, [toast]);

  return <main className="agenda" data-area={area}>
    {area === 'tasks' ? <TasksView host={host} error={error}/> : <CalendarView host={host} error={error}/>}
    {taskDraft && <TaskDialog initial={taskDraft} onClose={closeTask} onSaved={() => { const done = taskSaved.current; closeTask(); done?.(); changed(); }}/>}
    {eventDraft && <EventDialog initial={eventDraft} onClose={closeEvent} onSaved={() => { closeEvent(); changed(); }}/>}
    {toast && <div className="agenda-toast" role="status" key={toast.id}><span>{toast.message}</span>{toast.undo && <button onClick={() => void undo()}>Desfazer</button>}<button className="agenda-toast-close" aria-label="Fechar aviso" onClick={() => setToast(null)}>×</button></div>}
  </main>;
}
