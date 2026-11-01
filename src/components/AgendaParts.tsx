import React from 'react';
import type { CalendarEvent, Task } from '../../shared/ipc';
import type { EventDraft, TaskDraft } from './AgendaDialogs';

/** Stable bridge from the Tasks/Calendar views to the dialogs, toasts and navigation owned by LocalAgenda. */
export type AgendaHost = {
  openNote(id: string | null): Promise<void>;
  report(message: string): void;
  toast(message: string, undo?: () => Promise<void>): void;
  createTask(draft: TaskDraft, options?: { opener?: HTMLElement | null; saved?: () => void }): void;
  editTask(task: Task, opener?: HTMLElement | null): void;
  createEvent(day: Date, opener?: HTMLElement | null): void;
  editEvent(event: CalendarEvent, opener?: HTMLElement | null): void;
};

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function taskToDraft(task: Task): TaskDraft {
  return { id: task.id, noteId: task.noteId, title: task.title, dueAt: task.dueAt, reminderAt: task.reminderAt, recurrence: task.recurrence, priority: task.priority, timeZone: task.timeZone };
}

export function eventToDraft(event: CalendarEvent): EventDraft {
  return { id: event.id, noteId: event.noteId, title: event.title, description: event.description, startAt: event.startAt, endAt: event.endAt, timeZone: event.timeZone, allDay: event.allDay };
}

export function AgendaHeader({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <header>
    <div><h1>{title}</h1><p>{subtitle} · fuso {localZone()}</p></div>
    <div className="agenda-actions">{children}</div>
  </header>;
}

export function AgendaError({ message }: { message: string }) {
  return message ? <p role="alert" className="agenda-error">{message}</p> : null;
}
