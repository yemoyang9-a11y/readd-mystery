import { expect, test, vi } from 'vitest';

vi.mock('../utils/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/constants')>()),
  USE_MOCK: true,
}));

import { createNote, deleteNote, fetchNotes, updateNote } from './notesService';

// 2026-11-17 추리 노트 종류 — mock 모드도 서버와 같은 규칙으로 동작한다
test('mock 모드: 종류 없이 적으면 일반 메모(kind null, resolved false)로 저장된다', async () => {
  const created = await createNote('bk', { page_no: 3, kind: null, body: '메모' });
  expect(created).toMatchObject({ page_no: 3, kind: null, resolved: false, body: '메모' });
  expect(await fetchNotes('bk')).toContainEqual(created);
  await deleteNote('bk', created.note_id);
});

test('mock 모드: 궁금한 점·가설은 풀림 표시를 켜고 끌 수 있다', async () => {
  const created = await createNote('bk', { page_no: 5, kind: 'question', body: '왜?' });
  expect(await updateNote('bk', created.note_id, { resolved: true })).toMatchObject({
    kind: 'question',
    resolved: true,
  });
  expect(await updateNote('bk', created.note_id, { body: '왜일까?' })).toMatchObject({
    body: '왜일까?',
    resolved: true,
  });
  expect(await updateNote('bk', created.note_id, { resolved: false })).toMatchObject({ resolved: false });
  await deleteNote('bk', created.note_id);
});

test('mock 모드: 단서·일반 메모에는 풀림 표시를 켤 수 없고, 그런 종류로 바꾸면 풀림 표시가 꺼진다', async () => {
  const clue = await createNote('bk', { page_no: 5, kind: 'clue', body: '장갑' });
  await expect(updateNote('bk', clue.note_id, { resolved: true })).rejects.toThrow();
  expect((await fetchNotes('bk')).find((n) => n.note_id === clue.note_id)?.resolved).toBe(false);

  const hypothesis = await createNote('bk', { page_no: 6, kind: 'hypothesis', body: '가설' });
  await updateNote('bk', hypothesis.note_id, { resolved: true });
  expect(await updateNote('bk', hypothesis.note_id, { kind: null })).toMatchObject({
    kind: null,
    resolved: false,
  });
  await deleteNote('bk', clue.note_id);
  await deleteNote('bk', hypothesis.note_id);
});
