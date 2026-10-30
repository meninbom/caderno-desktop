import { useEffect, useRef, useState } from "react";
import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Toast,
  showToast,
} from "@raycast/api";
import { createNote, getNotebooks, type Notebook } from "./client";

export default function CreateNote() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notebookId, setNotebookId] = useState("none");
  const [isLoading, setIsLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const submitting = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void getNotebooks()
      .then((result) => {
        if (active) setNotebooks(result);
      })
      .catch((error: unknown) => {
        if (active) {
          void showToast({
            style: Toast.Style.Failure,
            title: "Não foi possível carregar os cadernos",
            message:
              error instanceof Error
                ? error.message
                : "Abra o Caderno e tente novamente.",
          });
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const submit = async (values: {
    title?: string;
    content?: string;
    notebookId?: string;
  }) => {
    if (submitting.current) return;
    const selectedId = values.notebookId ?? notebookId;
    const numericId =
      selectedId === "none" || selectedId === "" ? null : Number(selectedId);
    if (
      numericId !== null &&
      !notebooks.some((notebook) => notebook.id === numericId)
    ) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Escolha um caderno válido",
      });
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    try {
      const created = await createNote({
        title: values.title ?? title,
        content: values.content ?? content,
        notebookId: numericId,
      });
      setTitle("");
      setContent("");
      await showToast({
        style: Toast.Style.Success,
        title: "Nota criada no Caderno",
        message: created.title,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Não foi possível criar a nota",
        message:
          error instanceof Error
            ? error.message
            : "Confira os campos e tente novamente.",
      });
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Form
      navigationTitle="Criar Nota no Caderno"
      isLoading={isLoading || isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Criar Nota"
            icon={Icon.Plus}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Título"
        placeholder="Título da nota"
        value={title}
        onChange={setTitle}
      />
      <Form.TextArea
        id="content"
        title="Conteúdo"
        placeholder="Escreva uma nota em texto simples"
        value={content}
        onChange={setContent}
      />
      <Form.Dropdown
        id="notebookId"
        title="Caderno"
        value={notebookId}
        onChange={setNotebookId}
      >
        <Form.Dropdown.Item title="Sem caderno" value="none" />
        {notebooks.map((notebook) => (
          <Form.Dropdown.Item
            key={notebook.id}
            title={notebook.name}
            value={String(notebook.id)}
          />
        ))}
      </Form.Dropdown>
      <Form.Description
        title="Limites"
        text="Até 300 caracteres no título e 10.000 no conteúdo. Você pode salvar sem escolher um caderno."
      />
    </Form>
  );
}
