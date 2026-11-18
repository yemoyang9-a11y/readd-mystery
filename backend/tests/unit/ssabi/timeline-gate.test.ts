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

  it('FR-SPL-002: 읽는 중인 장의 사건은 타임라인에 0건 (결정 31)', async () => {
    // 2장 = 10~25쪽, 사건 12·24쪽. K=13은 2장 중간
    const t = await service.getTimeline(BOOK, 13);
    expect(t.events.filter((e) => e.occurrence_page >= 10 && e.occurrence_page <= 25)).toHaveLength(0);
    expect(t.events.map((e) => e.occurrence_page)).toEqual([4, 9]);
  });

  it('FR-SPL-002: 장 마지막 쪽 직전(K=24)이면 그 장 사건은 발생 쪽이 지났어도 0건', async () => {
    const t = await service.getTimeline(BOOK, 24);
    expect(t.events.filter((e) => e.occurrence_page >= 10 && e.occurrence_page <= 25)).toHaveLength(0);
  });

  it('FR-SPL-002: 그 장 마지막 쪽(K=25)까지 읽으면 그 장 사건이 보인다', async () => {
    const t = await service.getTimeline(BOOK, 25);
    expect(t.events.map((e) => e.occurrence_page)).toEqual([4, 9, 12, 24]);
  });

  it('FR-SPL-002: 읽는 중인 장도 장 목록에는 제목으로 남는다 (R3)', async () => {
    const t = await service.getTimeline(BOOK, 13);
    expect(t.chapters.map((c) => c.chapter_no)).toEqual([1, 2]);
  });

  // 2026-11-17 대표 결정 — "이 장을 다 읽으면…" 안내의 근거. 장 경계는 목차라 상한 대상이 아니다(R3)
  it('FR-SPL-002: 읽는 중인 장은 completed=false, 다 읽은 장은 completed=true', async () => {
    // 2장 = 10~25쪽. K=13은 2장 중간
    const reading = await service.getTimeline(BOOK, 13);
    expect(reading.chapters.map((c) => [c.chapter_no, c.completed])).toEqual([
      [1, true],
      [2, false],
    ]);
    // 마지막 쪽 직전(K=24)에도 아직 다 읽은 장이 아니다
    const almost = await service.getTimeline(BOOK, 24);
    expect(almost.chapters.find((c) => c.chapter_no === 2)!.completed).toBe(false);
  });

  it('FR-SPL-002: 그 장 마지막 쪽(K=25)까지 읽으면 completed=true로 바뀐다', async () => {
    const t = await service.getTimeline(BOOK, 25);
    expect(t.chapters.map((c) => [c.chapter_no, c.completed])).toEqual([
      [1, true],
      [2, true],
    ]);
  });

  it('FR-SPL-002: completed를 실어도 기준점 뒤에서 시작하는 장은 0건', async () => {
    const t = await service.getTimeline(BOOK, 25);
    expect(t.chapters.filter((c) => c.start_page > 25)).toHaveLength(0);
    // positive 쌍 — 기준점을 올리면 3장이 보인다
    const later = await service.getTimeline(BOOK, 26);
    expect(later.chapters.map((c) => [c.chapter_no, c.completed])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
  });

  // 2026-11-18 대표 승인 시안(타임라인 안 사건) — 장마다 간략 요약. 결정 31: 다 읽은 장만
  it('FR-SPL-002: 읽는 중인 장(K가 장 안)의 요약은 0건 — 장 제목만 남는다', async () => {
    // 2장 = 10~25쪽. K=13은 2장 중간
    const t = await service.getTimeline(BOOK, 13);
    const reading = t.chapters.find((c) => c.chapter_no === 2)!;
    expect(reading.summary).toBeNull();
    expect(t.chapters.filter((c) => c.end_page > 13 && c.summary !== null)).toHaveLength(0);
    // 마지막 쪽 직전(K=24)에도 그 장 요약은 0건
    const almost = await service.getTimeline(BOOK, 24);
    expect(almost.chapters.filter((c) => c.end_page > 24 && c.summary !== null)).toHaveLength(0);
  });

  it('FR-SPL-002: 그 장 마지막 쪽(K >= end_page)까지 읽으면 그 장 요약이 보인다', async () => {
    const t = await service.getTimeline(BOOK, 25);
    expect(t.chapters.map((c) => [c.chapter_no, c.summary])).toEqual([
      [1, '1장 요약'],
      [2, '2장 요약'],
    ]);
    // 다 읽은 장 중 요약이 없는 장은 null (지어내지 않는다)
    const later = await service.getTimeline(BOOK, 40);
    expect(later.chapters.map((c) => [c.chapter_no, c.summary])).toEqual([
      [1, '1장 요약'],
      [2, '2장 요약'],
      [3, null],
    ]);
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

  it('FR-SPL-002: 사건 쿼리는 사건이 속한 장의 end_page <= 기준점을 SQL 조건으로 건다 (결정 31)', async () => {
    const { query, repository } = capture();
    await repository.findTimeline('synthetic-book', 13);
    const eventSql: string = query.mock.calls[1][0];
    expect(eventSql).toMatch(/JOIN\s+chapters\s+(\w+)/i);
    const alias = eventSql.match(/JOIN\s+chapters\s+(\w+)/i)![1];
    const where = eventSql.slice(eventSql.search(/\bWHERE\b/i));
    expect(where).toMatch(new RegExp(`${alias}\\.end_page\\s*<=\\s*\\$2`, 'i'));
    expect(eventSql).toMatch(new RegExp(`${alias}\\.start_page\\s*<=\\s*\\w+\\.occurrence_page`, 'i'));
    expect(eventSql).toMatch(new RegExp(`${alias}\\.end_page\\s*>=\\s*\\w+\\.occurrence_page`, 'i'));
    expect(eventSql).toMatch(new RegExp(`${alias}\\.book_id\\s*=\\s*\\w+\\.book_id`, 'i'));
  });

  it('FR-SPL-002: 장 쿼리는 completed를 end_page <= 기준점($2) SQL 식으로 고른다 — 조회 밖에서 판정하지 않는다', async () => {
    const { query, repository } = capture();
    await repository.findTimeline('synthetic-book', 13);
    const chapterSql: string = query.mock.calls[0][0];
    expect(chapterSql).toMatch(/\(\s*end_page\s*<=\s*\$2\s*\)\s+AS\s+completed/i);
    // 장 목록 자체의 상한은 그대로다
    expect(chapterSql.slice(chapterSql.search(/\bWHERE\b/i))).toMatch(/start_page\s*<=\s*\$2/i);
  });

  it('FR-SPL-002: 장 요약은 다 읽은 장(end_page <= 기준점 $2)일 때만 JOIN 조건으로 붙인다 — 읽는 중인 장의 요약 행은 읽지 않는다 (결정 31, 절대 규칙 7)', async () => {
    const { query, repository } = capture();
    await repository.findTimeline('synthetic-book', 13);
    expect(query).toHaveBeenCalledTimes(2);
    const chapterSql: string = query.mock.calls[0][0];
    const join = chapterSql.match(/LEFT\s+JOIN\s+chapter_summaries\s+(\w+)\s+ON\s+([\s\S]*?)\bWHERE\b/i);
    expect(join).not.toBeNull();
    const [, alias, on] = join!;
    // 요약 행은 기준점 조건을 만족하는 장에만 붙는다 — 결과에서 숨기는 것이 아니라 읽지 않는다
    expect(on).toMatch(/\bend_page\s*<=\s*\$2/i);
    expect(on).toMatch(new RegExp(`${alias}\\.book_id\\s*=\\s*\\w+\\.book_id`, 'i'));
    expect(on).toMatch(new RegExp(`${alias}\\.chapter_no\\s*=\\s*\\w+\\.chapter_no`, 'i'));
    expect(chapterSql).toMatch(new RegExp(`${alias}\\.summary\\s+AS\\s+summary`, 'i'));
    expect(query.mock.calls[0][1]).toEqual(['synthetic-book', 13]);
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
