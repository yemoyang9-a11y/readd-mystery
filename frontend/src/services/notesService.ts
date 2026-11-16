import { api } from './api';
import { USE_MOCK } from '../utils/constants';
import type { NoteDraft, ReadingNote } from '../types';

export async function fetchNotes(bookId: string): Promise<ReadingNote[]> {
  if (USE_MOCK) {
    const { mockListNotes } = await import('../../mocks/server');
    return mockListNotes();
  }
  const { data } = await api.get<{ notes: ReadingNote[] }>(`/books/${bookId}/notes`);
  return data.notes;
}

export async function createNote(bookId: string, draft: NoteDraft): Promise<ReadingNote> {
  if (USE_MOCK) {
    const { mockCreateNote } = await import('../../mocks/server');
    return mockCreateNote(draft);
  }
  const { data } = await api.post<ReadingNote>(`/books/${bookId}/notes`, draft);
  return data;
}

export async function updateNote(
  bookId: string,
  noteId: string,
  draft: Partial<NoteDraft>
): Promise<ReadingNote> {
  if (USE_MOCK) {
    const { mockUpdateNote } = await import('../../mocks/server');
    return mockUpdateNote(noteId, draft);
  }
  const { data } = await api.patch<ReadingNote>(`/books/${bookId}/notes/${noteId}`, draft);
  return data;
}

export async function deleteNote(bookId: string, noteId: string): Promise<void> {
  if (USE_MOCK) {
    const { mockDeleteNote } = await import('../../mocks/server');
    mockDeleteNote(noteId);
    return;
  }
  await api.delete(`/books/${bookId}/notes/${noteId}`);
}
