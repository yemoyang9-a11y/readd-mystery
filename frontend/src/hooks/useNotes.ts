import { useCallback, useEffect, useState } from 'react';
import { createNote, deleteNote, fetchNotes, updateNote } from '../services/notesService';
import type { NoteDraft, ReadingNote } from '../types';

function sortByPage(notes: ReadingNote[]): ReadingNote[] {
  return [...notes].sort((a, b) => a.page_no - b.page_no || a.created_at.localeCompare(b.created_at));
}

export interface NotesState {
  notes: ReadingNote[];
  failed: boolean;
  add: (draft: NoteDraft) => Promise<boolean>;
  edit: (noteId: string, draft: Partial<NoteDraft>) => Promise<boolean>;
  remove: (noteId: string) => Promise<boolean>;
}

export function useNotes(bookId: string): NotesState {
  const [notes, setNotes] = useState<ReadingNote[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchNotes(bookId)
      .then((loaded) => {
        if (!cancelled) setNotes(sortByPage(loaded));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const add = useCallback(
    async (draft: NoteDraft) => {
      try {
        const created = await createNote(bookId, draft);
        setNotes((prev) => sortByPage([...prev, created]));
        return true;
      } catch {
        return false;
      }
    },
    [bookId]
  );

  const edit = useCallback(
    async (noteId: string, draft: Partial<NoteDraft>) => {
      try {
        const updated = await updateNote(bookId, noteId, draft);
        setNotes((prev) => sortByPage(prev.map((n) => (n.note_id === noteId ? updated : n))));
        return true;
      } catch {
        return false;
      }
    },
    [bookId]
  );

  const remove = useCallback(
    async (noteId: string) => {
      try {
        await deleteNote(bookId, noteId);
        setNotes((prev) => prev.filter((n) => n.note_id !== noteId));
        return true;
      } catch {
        return false;
      }
    },
    [bookId]
  );

  return { notes, failed, add, edit, remove };
}
