import { useEffect, useState } from "react";
import { searchNotes, type NoteSummary } from "../client";

export function useNoteSearch() {
  const [searchText, setSearchText] = useState("");
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(undefined);

    const timeout = setTimeout(() => {
      void searchNotes(searchText.trim(), controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setNotes(result);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setNotes([]);
            setError(
              cause instanceof Error
                ? cause.message
                : "Não foi possível buscar notas no Caderno.",
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [searchText, refreshKey]);

  return {
    searchText,
    setSearchText,
    notes,
    isLoading,
    error,
    refresh: () => setRefreshKey((value) => value + 1),
  };
}
