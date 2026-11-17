import { createPgNotesRepository } from '../pg-repository';

const READER = '11111111-1111-4111-8111-111111111111';
const BOOK = 'bk-published';

function row(page_no: number, body: string) {
  return {
    note_id: `n-${page_no}`,
    page_no,
    kind: 'clue',
    body,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
  };
}

describe('챗봇용 노트 조회 (FR-SPL-002 🚦, R4)', () => {
  test('FR-SPL-002: listNotes는 cutoff를 쿼리 조건으로 건다', async () => {
    const query = jest.fn(async () => ({ rows: [row(12, '장갑')] }));
    const repository = createPgNotesRepository({ query });

    const notes = await repository.listNotes(READER, BOOK, 40);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/reader_id = \$1/);
    expect(sql).toMatch(/book_id = \$2/);
    expect(sql).toMatch(/page_no <= \$3/);
    expect(params).toEqual([READER, BOOK, 40]);
    expect(notes).toEqual([
      { page_no: 12, kind: 'clue', body: '장갑', created_at: '2026-11-01T00:00:00.000Z' },
    ]);
  });

  test('FR-SPL-002: cutoff가 다르면 그 값이 그대로 쿼리 인자로 간다 (positive 쌍)', async () => {
    const query = jest.fn(async () => ({ rows: [row(12, '장갑'), row(41, '회중시계')] }));
    const repository = createPgNotesRepository({ query });

    const notes = await repository.listNotes(READER, BOOK, 130);

    expect((query.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual([READER, BOOK, 130]);
    expect(notes.map((note) => note.page_no)).toEqual([12, 41]);
  });

  test('FR-SPL-002: cutoff가 1 미만이거나 정수가 아니면 저장소에 접근하지 않고 0건', async () => {
    const query = jest.fn(async () => ({ rows: [row(1, '메모')] }));
    const repository = createPgNotesRepository({ query });

    expect(await repository.listNotes(READER, BOOK, 0)).toEqual([]);
    expect(await repository.listNotes(READER, BOOK, Number.NaN)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
