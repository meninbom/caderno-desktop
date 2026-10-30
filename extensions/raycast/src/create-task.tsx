import { useRef, useState } from "react";
import {
  useNavigation,
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  Toast,
  showToast,
} from "@raycast/api";
import {
  createTask,
  escapeMarkdown,
  formatUpdatedAt,
  type NoteSummary,
} from "./client";
import {
  resolveCreateTaskPayload,
  TaskFormValidationError,
  taskListForDeadline,
  type TaskFormSnapshot,
} from "./create-task-form";
import { useNoteSearch } from "./hooks/use-note-search";

function TaskForm({ note }: { note: NoteSummary }) {
  const { pop } = useNavigation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [dueAt, setDueAt] = useState<Date | null>(null);
  const [titleError, setTitleError] = useState<string>();
  const [priorityError, setPriorityError] = useState<string>();
  const [dueAtError, setDueAtError] = useState<string>();
  const formSnapshot = useRef<TaskFormSnapshot>({ title: "", priority: "normal", dueAt: null });
  const submitting = useRef(false);

  function updateTitle(value: string) {
    formSnapshot.current = { ...formSnapshot.current, title: value };
    setTitle(value);
    setTitleError(undefined);
  }

  function updatePriority(value: string) {
    const next: TaskFormSnapshot["priority"] = value === "low" || value === "high" ? value : "normal";
    formSnapshot.current = { ...formSnapshot.current, priority: next };
    setPriority(next);
    setPriorityError(undefined);
  }

  function updateDueAt(value: Date | null) {
    formSnapshot.current = { ...formSnapshot.current, dueAt: value };
    setDueAt(value);
    setDueAtError(undefined);
  }

  async function submit(values: { title?: unknown; priority?: unknown; dueAt?: Date | null }) {
    if (submitting.current) return;
    let payload;
    try {
      payload = resolveCreateTaskPayload(note.id, values, formSnapshot.current);
      setTitleError(undefined);
      setPriorityError(undefined);
      setDueAtError(undefined);
    } catch (error) {
      if (error instanceof TaskFormValidationError) {
        if (error.field === "title") setTitleError(error.message);
        if (error.field === "priority") setPriorityError(error.message);
        if (error.field === "dueAt") setDueAtError(error.message);
        return;
      }
      await showToast({ style: Toast.Style.Failure, title: "Confira os dados da tarefa" });
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    try {
      await createTask(payload);
      const resultHint = payload.dueAt === undefined
        ? "Sem prazo: veja em Tarefas > Todas."
        : `Prazo ${new Date(payload.dueAt).toLocaleString("pt-BR")}: veja em Tarefas > ${taskListForDeadline(payload.dueAt)}.`;
      await showToast({
        style: Toast.Style.Success,
        title: "Tarefa criada no Caderno",
        message: `${note.title} · ${resultHint}`,
      });
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Não foi possível criar a tarefa",
        message:
          error instanceof Error
            ? error.message
            : "Confira os campos e tente novamente.",
      });
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      navigationTitle="Criar Tarefa no Caderno"
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Criar Tarefa"
            icon={Icon.CheckCircle}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Nota escolhida"
        text={`${note.title}${note.notebookName ? ` · ${note.notebookName}` : " · Sem caderno"}`}
      />
      <Form.TextField
        id="title"
        title="Tarefa"
        placeholder="O que precisa ser feito?"
        value={title}
        error={titleError}
        onChange={updateTitle}
      />
      <Form.Dropdown id="priority" title="Prioridade" value={priority} error={priorityError} onChange={updatePriority}>
        <Form.Dropdown.Item title="Baixa" value="low" />
        <Form.Dropdown.Item title="Normal" value="normal" />
        <Form.Dropdown.Item title="Alta" value="high" />
      </Form.Dropdown>
      <Form.DatePicker
        id="dueAt"
        title="Prazo opcional"
        type={Form.DatePicker.Type.DateTime}
        value={dueAt}
        error={dueAtError}
        onChange={updateDueAt}
      />
      <Form.Description
        title="Prazo"
        text="Use data e hora locais. Sem prazo, a tarefa aparece em Tarefas > Todas. O Caderno aceita até 300 caracteres na descrição."
      />
    </Form>
  );
}

export default function ChooseNoteForTask() {
  const { searchText, setSearchText, notes, isLoading, error, refresh } =
    useNoteSearch();

  return (
    <List
      navigationTitle="Escolher Nota para a Tarefa"
      searchBarPlaceholder="Buscar uma nota…"
      onSearchTextChange={setSearchText}
      isLoading={isLoading}
      filtering={false}
      isShowingDetail
    >
      {notes.length === 0 ? (
        <List.EmptyView
          title={
            error ? "Não foi possível buscar notas" : "Nenhuma nota encontrada"
          }
          description={
            error ??
            (searchText
              ? "Tente outro termo."
              : "Busque uma nota para vincular a tarefa.")
          }
          actions={
            <ActionPanel>
              <Action
                title="Tentar Novamente"
                icon={Icon.ArrowClockwise}
                onAction={refresh}
              />
            </ActionPanel>
          }
        />
      ) : null}
      {notes.map((note) => (
        <List.Item
          key={note.id}
          icon={Icon.Document}
          title={note.title || "Sem título"}
          subtitle={note.notebookName ?? "Sem caderno"}
          accessories={[
            {
              text: formatUpdatedAt(note.updatedAt),
              tooltip: "Última atualização",
            },
          ]}
          detail={
            <List.Item.Detail
              markdown={`# ${escapeMarkdown(note.title || "Sem título")}\n\n${escapeMarkdown(note.preview || "Sem prévia disponível.")}`}
            />
          }
          actions={
            <ActionPanel>
              <Action.Push
                title="Escolher Nota e Continuar"
                icon={Icon.CheckCircle}
                target={<TaskForm note={note} />}
              />
              <Action.CopyToClipboard
                title="Copiar ID da Nota"
                content={note.id}
              />
              <Action
                title="Atualizar Resultados"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ["ctrl"], key: "r" }}
                onAction={refresh}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
