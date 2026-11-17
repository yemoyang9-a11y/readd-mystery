import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  FakeSsabiRepository,
  createTestFixture,
} from '../../../src/modules/ssabi/__mocks__/fake-repository';
import { createTimelineService } from '../../../src/modules/ssabi/timeline.service';
import { createPgSsabiRepository, QueryClient } from '../../../src/modules/ssabi/pg-repository';

const BOOK = 'takryu';

describe('FR-SPL-002 🚦: 타임라인 스포일러 상한', () => {
  let service: ReturnType<typeof createTimelineService>;

  beforeEach(() => {
    service = createTimelineService({ repository: new FakeSsabiRepository(createTestFixture()) });
  });

  it('FR-SPL-002: 타임라인 사건에 기준점 초과 레코드 0건', async () => {
    const t = await service.getTimeline(BOOK, 10);
    expect(t.events.length).toBeGreaterThan(0);
    expect(t.events.filter((e) => e.occurrence_page > 10)).toHaveLength(0);
    expect(t.chapters.length).toBeGreaterThan(0);
    expect(t.chapters.filter((c) => c.start_page > 10)).toHaveLength(0);
  });

  it('FR-SPL-002: 기준점을 올리면 그 사이 사건이 보인다', async () => {
    const t = await service.getTimeline(BOOK, 40);
    expect(t.events.some((e) => e.occurrence_page > 10 && e.occurrence_page <= 40)).toBe(true);
    expect(t.chapters.some((c) => c.start_page > 10 && c.start_page <= 40)).toBe(true);
  });

  it('FR-SPL-002: 진도 레코드 없음(K=0)이면 장·사건 0건', async () => {
    const t = await service.getTimeline(BOOK, 0);
    expect(t.chapters).toHaveLength(0);
    expect(t.events).toHaveLength(0);
  });

  it('FR-SPL-002: 응답은 독자용 문장만 담고 원래 description은 내보내지 않는다', async () => {
    const t = await service.getTimeline(BOOK, 40);
    expect(t.events.length).toBeGreaterThan(0);
    for (const e of t.events) {
      expect(Object.keys(e).sort()).toEqual(['description', 'event', 'id', 'occurrence_page']);
      expect(e.description).not.toMatch(/ORIGINAL/);
    }
  });

  it('FR-SPL-002: 다른 책의 장·사건은 섞이지 않는다', async () => {
    const t = await service.getTimeline('other-book', 40);
    expect(t.chapters).toHaveLength(0);
    expect(t.events).toHaveLength(0);
  });
});

describe('FR-SPL-002 🚦: 타임라인 pg 쿼리 계약', () => {
  const capture = () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    return { query, repository: createPgSsabiRepository({ query } as QueryClient) };
  };

  it.each([0, 13, 40])('K=%i: 장·사건 쿼리 모두 책과 기준점으로 제한한다', async (cutoff) => {
    const { query, repository } = capture();
    await repository.findTimeline('synthetic-book', cutoff);
    expect(query).toHaveBeenCalledTimes(2);
    const [chapterSql, chapterParams] = query.mock.calls[0];
    const [eventSql, eventParams] = query.mock.calls[1];
    expect(chapterParams).toEqual(['synthetic-book', cutoff]);
    expect(eventParams).toEqual(['synthetic-book', cutoff]);
    expect(chapterSql).toMatch(/book_id\s*=\s*\$1/i);
    expect(chapterSql).toMatch(/start_page\s*<=\s*\$2/i);
    expect(eventSql).toMatch(/book_id\s*=\s*\$1/i);
    expect(eventSql).toMatch(/occurrence_page\s*<=\s*\$2/i);
  });

  it('FR-SPL-002: 사건은 reader_description만 description으로 고르고 원본 컬럼은 고르지 않는다', async () => {
    const { query, repository } = capture();
    await repository.findTimeline('synthetic-book', 13);
    const eventSql: string = query.mock.calls[1][0];
    expect(eventSql).toMatch(/reader_description\s+AS\s+description/i);
    expect(eventSql.replace(/reader_description\s+AS\s+description/i, '')).not.toMatch(
      /\bdescription\b/i
    );
  });

  it('FR-SPL-002: 조회 행을 변경하지 않고 장·사건으로 나눠 반환한다', async () => {
    const chapter = { chapter_no: 1, title: '장', start_page: 1, end_page: 9 };
    const event = { id: 'e', event: '사건', description: '쉬운 문장', occurrence_page: 4 };
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [chapter] })
      .mockResolvedValueOnce({ rows: [event] });
    const repository = createPgSsabiRepository({ query } as QueryClient);
    expect(await repository.findTimeline('synthetic-book', 13)).toEqual({
      chapters: [chapter],
      events: [event],
    });
  });
});
