export type TaskPriority = "low" | "normal" | "high";

export type TaskFormValues = {
  title?: unknown;
  priority?: unknown;
  dueAt?: unknown;
};

export type TaskFormSnapshot = {
  title: string;
  priority: TaskPriority;
  dueAt: Date | null;
};

export type CreateTaskPayload = {
  noteId: string;
  title: string;
  priority: TaskPriority;
  dueAt?: number;
};

export const TASK_DEADLINE_UNSUPPORTED_MESSAGE =
  "O Caderno instalado ainda não aceita prazos em tarefas. Atualize o app para uma versão compatível e tente novamente.";

export class TaskFormValidationError extends Error {
  constructor(
    readonly field: "title" | "priority" | "dueAt",
    message: string,
  ) {
    super(message);
    this.name = "TaskFormValidationError";
  }
}

/** Uses the latest controlled state when Raycast omits a controlled form value. */
export function resolveCreateTaskPayload(
  noteId: string,
  values: TaskFormValues,
  snapshot: TaskFormSnapshot,
): CreateTaskPayload {
  const rawTitle = values.title === undefined ? snapshot.title : values.title;
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (!title) {
    throw new TaskFormValidationError("title", "Informe uma descrição para a tarefa.");
  }
  if (title.length > 300) {
    throw new TaskFormValidationError("title", "A descrição aceita até 300 caracteres.");
  }

  const rawPriority = values.priority === undefined ? snapshot.priority : values.priority;
  if (rawPriority !== "low" && rawPriority !== "normal" && rawPriority !== "high") {
    throw new TaskFormValidationError("priority", "Escolha uma prioridade válida.");
  }

  const rawDueAt = values.dueAt === undefined ? snapshot.dueAt : values.dueAt;
  if (rawDueAt === null || rawDueAt === undefined) {
    return { noteId, title, priority: rawPriority };
  }
  if (!(rawDueAt instanceof Date) || !Number.isSafeInteger(rawDueAt.getTime())) {
    throw new TaskFormValidationError("dueAt", "Escolha uma data e hora válidas.");
  }

  return { noteId, title, priority: rawPriority, dueAt: rawDueAt.getTime() };
}

/** Mirrors TasksRepo.today/upcoming/overdue boundaries in the local timezone. */
export function taskListForDeadline(dueAt: number | undefined, now = Date.now()): string {
  if (dueAt === undefined) return "Todas";
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const upcomingEnd = new Date(end);
  upcomingEnd.setDate(upcomingEnd.getDate() + 7);

  if (dueAt < start.getTime()) return "Atrasadas";
  if (dueAt < end.getTime()) return "Hoje";
  if (dueAt < upcomingEnd.getTime()) return "Próximas";
  return "Todas";
}

export function isUnsupportedTaskDeadlineError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { statusCode?: unknown; code?: unknown };
  return value.statusCode === 400 && value.code === "INVALID_TASK";
}
