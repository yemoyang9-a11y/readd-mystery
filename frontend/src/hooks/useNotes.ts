import { useCallback, useEffect, useRef, useState } from 'react';
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

  const scopeRef = useRef({ bookId, changed: new Map<string, ReadingNote>(), removed: new Set<string>() });
  if (scopeRef.current.bookId !== bookId) {
    scopeRef.current = { bookId, changed: new Map(), removed: new Set() };
    setNotes([]);
    setFailed(false);
  }

  useEffect(() => {
    let cancelled = false;
    const scope = scopeRef.current;
    setFailed(false);
    fetchNotes(bookId)
      .then((loaded) => {
        if (!cancelled && scope === scopeRef.current) {
          const merged = new Map(loaded.map((note) => [note.note_id, note]));
          for (const [id, note] of scope.changed) merged.set(id, note);
          for (const id of scope.removed) merged.delete(id);
          setNotes(sortByPage([...merged.values()]));
        }
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
      const scope = scopeRef.current;
      try {
        const created = await createNote(bookId, draft);
        if (scope !== scopeRef.current || scope.bookId !== bookId) return false;
        scope.changed.set(created.note_id, created);
        setNotes((prev) => sortByPage([...prev.filter((n) => n.note_id !== created.note_id), created]));
        return true;
      } catch {
        return false;
      }
    },
    [bookId]
  );

  const edit = useCallback(
    async (noteId: string, draft: Partial<NoteDraft>) => {
      const scope = scopeRef.current;
      try {
        const updated = await updateNote(bookId, noteId, draft);
        if (scope !== scopeRef.current || scope.bookId !== bookId) return false;
        scope.changed.set(noteId, updated);
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
      const scope = scopeRef.current;
      try {
        await deleteNote(bookId, noteId);
        if (scope !== scopeRef.current || scope.bookId !== bookId) return false;
        scope.removed.add(noteId);
        scope.changed.delete(noteId);
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
