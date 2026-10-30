import { useRef } from "react";
import { client } from "../api/client";
import { useAppStore } from "../state/store";

export function useTagRefresh() {
  const { state, dispatch, refreshMeta, refreshNotes } = useAppStore();
  const current = useRef(state);
  current.current = state;
  return async () => {
    await Promise.all([refreshMeta(), refreshNotes()]);
    const id = current.current.openNoteId;
    if (!id) return;
    const note = await client.getNote(id);
    if (note && current.current.openNoteId === id) dispatch({ type: "openNote", note, noteId: id });
  };
}
