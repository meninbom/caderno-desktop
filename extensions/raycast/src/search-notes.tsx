import {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  closeMainWindow,
  showToast,
} from "@raycast/api";
import {
  escapeMarkdown,
  formatUpdatedAt,
  openNote,
  type NoteSummary,
} from "./client";
import { useNoteSearch } from "./hooks/use-note-search";

function NoteActions({
  note,
  refresh,
}: {
  note: NoteSummary;
  refresh: () => void;
}) {
  const openSelectedNote = async () => {
    try {
      await openNote(note.id);
      await closeMainWindow();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Não foi possível abrir a nota",
        message: error instanceof Error ? error.message : "Tente novamente.",
      });
    }
  };

  return (
    <ActionPanel>
      <Action
        title="Abrir Nota no Caderno"
        icon={Icon.Window}
        onAction={openSelectedNote}
      />
      <Action.CopyToClipboard title="Copiar ID da Nota" content={note.id} />
      <Action
        title="Atualizar Resultados"
        icon={Icon.ArrowClockwise}
        shortcut={{ modifiers: ["ctrl"], key: "r" }}
        onAction={refresh}
      />
    </ActionPanel>
  );
}

export default function SearchNotes() {
  const { searchText, setSearchText, notes, isLoading, error, refresh } =
    useNoteSearch();

  return (
    <List
      navigationTitle="Buscar Notas no Caderno"
      searchBarPlaceholder="Buscar título ou conteúdo…"
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
              : "As notas locais do Caderno aparecerão aqui.")
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
              metadata={
                <List.Item.Detail.Metadata>
                  <List.Item.Detail.Metadata.Label
                    title="Caderno"
                    text={note.notebookName ?? "Sem caderno"}
                  />
                  <List.Item.Detail.Metadata.Label
                    title="Atualizada"
                    text={formatUpdatedAt(note.updatedAt)}
                  />
                  <List.Item.Detail.Metadata.Label title="ID" text={note.id} />
                </List.Item.Detail.Metadata>
              }
            />
          }
          actions={<NoteActions note={note} refresh={refresh} />}
        />
      ))}
    </List>
  );
}
