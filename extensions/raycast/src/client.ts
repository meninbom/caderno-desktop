import { LocalStorage } from "@raycast/api";
import { sendApiRequest } from "./api-transport";
import {
  isUnsupportedTaskDeadlineError,
  TASK_DEADLINE_UNSUPPORTED_MESSAGE,
  type TaskPriority,
} from "./create-task-form";

const TOKEN_KEY = "caderno-local-token-v1";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const NOTE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NoteSummary = {
  id: string;
  title: string;
  notebookName: string | null;
  preview: string;
  updatedAt: string;
};

export type Notebook = {
  id: number;
  name: string;
};

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  unauthenticated?: boolean;
  signal?: AbortSignal;
};

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  let token: string | undefined;

  if (!options.unauthenticated) {
    try {
      token = await LocalStorage.getItem<string>(TOKEN_KEY);
    } catch {
      throw new Error(
        "Não foi possível ler a credencial segura deste Raycast. Pareie novamente.",
      );
    }
    if (!token || !TOKEN_PATTERN.test(token)) {
      throw new Error(
        "Pareie o Raycast em Configurações → Raycast no Caderno antes de continuar.",
      );
    }
  }

  try {
    return await sendApiRequest<T>(path, {
      method: options.method,
      body: options.body,
      signal: options.signal,
      token,
    });
  } finally {
    token = undefined;
  }
}

export async function hasLocalCredential(): Promise<boolean> {
  try {
    const token = await LocalStorage.getItem<string>(TOKEN_KEY);
    return typeof token === "string" && TOKEN_PATTERN.test(token);
  } catch {
    throw new Error(
      "Não foi possível ler o armazenamento seguro deste Raycast.",
    );
  }
}

export async function pairWithCode(code: string): Promise<void> {
  const normalized = code.trim();
  if (!/^\d{10}$/.test(normalized)) {
    throw new Error("O código de pareamento precisa ter dez números.");
  }

  const result = await request<{ token?: string }>("/pair", {
    method: "POST",
    body: { code: normalized },
    unauthenticated: true,
  });
  const token = result.token;
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new Error(
      "O Caderno retornou uma credencial inválida. Gere outro código e tente novamente.",
    );
  }

  try {
    await LocalStorage.setItem(TOKEN_KEY, token);
  } catch {
    throw new Error(
      "O Caderno aceitou o código, mas a credencial não foi salva. Gere outro código e pareie novamente.",
    );
  }
}

export async function removeLocalCredential(): Promise<void> {
  try {
    await LocalStorage.removeItem(TOKEN_KEY);
  } catch {
    throw new Error(
      "Não foi possível remover a credencial local deste Raycast.",
    );
  }
}

export async function verifyConnection(): Promise<void> {
  await request<{ notebooks: Notebook[] }>("/notebooks");
}

export async function searchNotes(
  query: string,
  signal?: AbortSignal,
  limit = 50,
): Promise<NoteSummary[]> {
  const normalized = query.trim();
  if (normalized.length > 200)
    throw new Error("A busca aceita até 200 caracteres.");
  const params = new URLSearchParams({
    query: normalized,
    limit: String(limit),
  });
  const result = await request<{ notes: NoteSummary[] }>(
    `/notes?${params.toString()}`,
    { signal },
  );
  return Array.isArray(result.notes) ? result.notes : [];
}

export async function getNotebooks(): Promise<Notebook[]> {
  const result = await request<{ notebooks: Notebook[] }>("/notebooks");
  return Array.isArray(result.notebooks) ? result.notebooks : [];
}

export async function createNote(input: {
  title: string;
  content: string;
  notebookId: number | null;
}): Promise<{ id: string; title: string }> {
  const title = input.title.trim();
  if (!title || title.length > 300)
    throw new Error("Informe um título com até 300 caracteres.");
  if (input.content.length > 10_000)
    throw new Error("O conteúdo aceita até 10.000 caracteres.");
  return request("/notes", { method: "POST", body: { ...input, title } });
}

export async function createTask(input: {
  noteId: string;
  title: string;
  priority: TaskPriority;
  dueAt?: number;
}): Promise<{ id: string; title: string }> {
  const title = input.title.trim();
  if (!NOTE_ID_PATTERN.test(input.noteId))
    throw new Error("Escolha uma nota válida.");
  if (!title || title.length > 300)
    throw new Error("Informe uma descrição com até 300 caracteres.");
  if (input.dueAt !== undefined && (!Number.isSafeInteger(input.dueAt) || !Number.isFinite(new Date(input.dueAt).getTime())))
    throw new Error("Escolha uma data e hora válidas.");
  const body: { noteId: string; title: string; priority: TaskPriority; dueAt?: number } = {
    noteId: input.noteId,
    title,
    priority: input.priority,
  };
  if (input.dueAt !== undefined) body.dueAt = input.dueAt;
  try {
    return await request("/tasks", { method: "POST", body });
  } catch (error) {
    if (input.dueAt !== undefined && isUnsupportedTaskDeadlineError(error)) {
      throw new Error(TASK_DEADLINE_UNSUPPORTED_MESSAGE);
    }
    throw error;
  }
}

export async function openNote(id: string): Promise<void> {
  if (!NOTE_ID_PATTERN.test(id))
    throw new Error("O ID desta nota não é válido.");
  await request<{ opened: boolean }>("/notes/open", {
    method: "POST",
    body: { id },
  });
}

export function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data indisponível";
  return date.toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, "\\$&");
}
