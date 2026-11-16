import type { Response } from 'express';
import { ensureBookReady } from '../../../src/api/book-ready.guard';
import { createPgContentRepository } from '../../../src/modules/content/pg-repository';

const BOOKS = [
  { book_id: 'bk-draft', publish_status: 'draft', ssabi_ready: false },
  { book_id: 'bk-review', publish_status: 'review', ssabi_ready: false },
  { book_id: 'bk-pub', publish_status: 'published', ssabi_ready: true },
];

function fakeDb() {
  return {
    async query(sql: string, params: unknown[] = []) {
      const publishedOnly = /publish_status\s*=\s*'published'/.test(sql);
      let rows = BOOKS.filter((b) => !publishedOnly || b.publish_status === 'published');
      if (sql.includes('WHERE book_id = $1')) rows = rows.filter((b) => b.book_id === params[0]);
      return {
        rows: rows.map((b) => ({
          ...b,
          title: b.book_id,
          author: 'a',
          cover_url: null,
          intro_summary: null,
          genre: null,
          registered_at: new Date('2026-11-16T00:00:00.000Z'),
        })),
      };
    },
  };
}

function mockRes() {
  const sent: { status?: number } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json() {
      return res;
    },
  };
  return { res: res as unknown as Response, sent };
}

describe('R12: 공개 전환 전 도서', () => {
  const repo = createPgContentRepository(fakeDb());

  test('R12: draft·review 도서는 독자 목록에 없고 published는 있다', async () => {
    const ids = (await repo.findCatalog()).map((b) => b.book_id);

    expect(ids).toEqual(['bk-pub']);
  });

  test('R12: draft·review 도서 ID로 /books/:id/pages/1 류 독자 API를 부르면 404, published는 통과', async () => {
    for (const id of ['bk-draft', 'bk-review', 'bk-unknown']) {
      const { res, sent } = mockRes();
      expect(await ensureBookReady(repo, id, res)).toBe(false);
      expect(sent.status).toBe(404);
    }
    const { res, sent } = mockRes();
    expect(await ensureBookReady(repo, 'bk-pub', res)).toBe(true);
    expect(sent.status).toBeUndefined();
  });
});
