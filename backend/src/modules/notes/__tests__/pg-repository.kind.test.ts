import { createPgNotesRepository } from '../pg-repository';

const READER = '11111111-1111-4111-8111-111111111111';
const BOOK = 'bk-1';
const NOTE = '33333333-3333-4333-8333-333333333333';

function row(overrides: Record<string, unknown> = {}) {
  return {
    note_id: NOTE,
    page_no: 12,
    kind: null,
    resolved: false,
    body: '메모',
    created_at: '2026-11-17T00:00:00.000Z',
    updated_at: '2026-11-17T00:00:00.000Z',
    ...overrides,
  };
}

function fakeDb(rows: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

// 2026-11-17 추리 노트 종류
describe('pg notes repository — 종류와 풀림 표시', () => {
  test('옛 노트(kind 없음)는 일반 메모(kind null, resolved false)로 읽힌다', async () => {
    const db = fakeDb([row(), row({ kind: 'hypothesis', resolved: true })]);
    const notes = await createPgNotesRepository(db).list(READER, BOOK);
    expect(notes.map(({ kind, resolved }) => ({ kind, resolved }))).toEqual([
      { kind: null, resolved: false },
      { kind: 'hypothesis', resolved: true },
    ]);
    expect(db.calls[0].sql).toMatch(/reader_id = \$1 AND book_id = \$2/);
    expect(db.calls[0].params).toEqual([READER, BOOK]);
  });

  test('저장할 때 kind와 resolved를 받은 그대로 넣는다', async () => {
    const db = fakeDb([row({ kind: 'question' })]);
    await createPgNotesRepository(db).create(READER, BOOK, {
      page_no: 12,
      kind: 'question',
      resolved: false,
      body: '메모',
    });
    expect(db.calls[0].sql).toMatch(/INSERT INTO reading_notes/);
    expect(db.calls[0].params.slice(1)).toEqual([READER, BOOK, 12, 'question', '메모', false]);
  });

  test('kind를 null로 바꾸는 수정과 kind를 건드리지 않는 수정을 구분한다', async () => {
    const db = fakeDb([row()]);
    const repo = createPgNotesRepository(db);
    await repo.update(READER, BOOK, NOTE, { kind: null, resolved: false });
    await repo.update(READER, BOOK, NOTE, { body: '고침' });
    // [noteId, readerId, bookId, page_no, kind 변경 여부, kind, body, resolved]
    expect(db.calls[0].params).toEqual([NOTE, READER, BOOK, null, true, null, null, false]);
    expect(db.calls[1].params).toEqual([NOTE, READER, BOOK, null, false, null, '고침', null]);
    expect(db.calls[0].sql).toMatch(/note_id = \$1 AND reader_id = \$2 AND book_id = \$3/);
  });

  test('find는 reader·도서·노트가 모두 맞는 행만 찾는다', async () => {
    const db = fakeDb([]);
    expect(await createPgNotesRepository(db).find(READER, BOOK, NOTE)).toBeNull();
    expect(db.calls[0].sql).toMatch(/note_id = \$1 AND reader_id = \$2 AND book_id = \$3/);
    expect(db.calls[0].params).toEqual([NOTE, READER, BOOK]);
  });

  test('챗봇용 읽기 경로는 쪽수·종류·내용·쓴 시각만 넘긴다 — 풀림 여부는 넘기지 않는다', async () => {
    const db = fakeDb([row({ kind: 'question', resolved: true })]);
    expect(await createPgNotesRepository(db).listNotes(READER, BOOK, 40)).toEqual([
      { page_no: 12, kind: 'question', body: '메모', created_at: '2026-11-17T00:00:00.000Z' },
    ]);
  });
});
