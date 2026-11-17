import { act, renderHook, waitFor } from '@testing-library/react';
import { useNotes } from './useNotes';
import { createNote, deleteNote, fetchNotes } from '../services/notesService';
import type { ReadingNote } from '../types';

vi.mock('../services/notesService', () => ({ fetchNotes: vi.fn(), createNote: vi.fn(), updateNote: vi.fn(), deleteNote: vi.fn() }));
const note = (id: string): ReadingNote => ({ note_id: id, page_no: 1, kind: null, resolved: false, body: id, created_at: '2026-11-18', updated_at: '2026-11-18' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => vi.resetAllMocks());

it('늦게 온 목록이 방금 저장한 노트를 지우지 않는다', async () => {
  const load = deferred<ReadingNote[]>();
  vi.mocked(fetchNotes).mockReturnValue(load.promise);
  vi.mocked(createNote).mockResolvedValue(note('new'));
  const { result } = renderHook(() => useNotes('a'));
  await act(async () => { await result.current.add({ page_no: 1, kind: null, body: 'new' }); });
  await act(async () => { load.resolve([note('old')]); });
  expect(result.current.notes.map((n) => n.note_id).sort()).toEqual(['new', 'old']);
});

it('늦게 온 목록이 삭제한 노트를 되살리지 않는다', async () => {
  const load = deferred<ReadingNote[]>();
  vi.mocked(fetchNotes).mockReturnValue(load.promise);
  vi.mocked(deleteNote).mockResolvedValue();
  const { result } = renderHook(() => useNotes('a'));
  await act(async () => { await result.current.remove('old'); });
  await act(async () => { load.resolve([note('old')]); });
  expect(result.current.notes).toEqual([]);
});

it('책을 바꾸면 이전 노트와 늦게 완료된 저장 결과가 섞이지 않는다', async () => {
  vi.mocked(fetchNotes).mockResolvedValueOnce([note('a')]).mockResolvedValueOnce([note('b')]);
  const save = deferred<ReadingNote>();
  vi.mocked(createNote).mockReturnValue(save.promise);
  const { result, rerender } = renderHook(({ book }) => useNotes(book), { initialProps: { book: 'a' } });
  await waitFor(() => expect(result.current.notes).toEqual([note('a')]));
  let pending!: Promise<boolean>;
  act(() => { pending = result.current.add({ page_no: 1, kind: null, body: 'late' }); });
  rerender({ book: 'b' });
  expect(result.current.notes).not.toContainEqual(note('a'));
  await waitFor(() => expect(result.current.notes).toEqual([note('b')]));
  await act(async () => { save.resolve(note('late')); await pending; });
  expect(result.current.notes).toEqual([note('b')]);
});
