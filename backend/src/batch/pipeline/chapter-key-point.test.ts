/**
 * 타임라인 장 핵심 한 줄 — FR-SPL-003 🚦, 결정 31 (2026-11-18 대표 승인 시안 2차 A안)
 *
 * 가짜 LLM만 쓴다. 상한은 입력 범위(그 장 원문만)로 건다 — 절대 규칙 3.
 * 검사를 통과하지 못한 문장은 쓰지 않고 검수 후보로 남긴다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Chapter, Page } from '../../shared/types';
import {
  KEY_POINT_MAX_LENGTH,
  KEY_POINT_TASK,
  KeyPointFile,
  applyKeyPoints,
  buildKeyPointPrompt,
  chapterPagesOnly,
  evaluateChapterKeyPoint,
  generateBookKeyPoints,
  requestChapterKeyPoint,
} from './chapter-key-point';
import { groundingManifest } from './grounding';

const P1 = '유불란은 해왕좌 분장실에 들어갔다. 유불란이 바닥에서 손수건을 주웠다.';
const P2 = '그날 밤 박영민은 극장 앞 찻집에 앉아 있었다.';
// 다음 장(쪽 3·4) — 1장 입력에 1자도 들어가면 안 되는 원문
const P3 = '이튿날 아침 형사 백검사가 무대 뒤에서 피 묻은 칼을 발견했다.';
const P4 = '범인은 끝내 자백하지 않았다고 신문은 전했다.';

const book = 'fixture';
const pages: Page[] = [P1, P2, P3, P4].map((content, i) => ({
  id: `p${i + 1}`,
  book_id: book,
  page_no: i + 1,
  content,
}));
const ch1: Chapter = {
  id: 'c1',
  book_id: book,
  chapter_no: 1,
  title: '분장실',
  start_page: 1,
  end_page: 2,
};
const ch2: Chapter = {
  id: 'c2',
  book_id: book,
  chapter_no: 2,
  title: '칼',
  start_page: 3,
  end_page: 4,
};
const LEXICON = ['유불란', '박영민', '백검사'];

const GOOD = {
  key_point: '유불란이 분장실 바닥에서 손수건을 줍는다.',
  source_page: 1,
  quote: '유불란이 바닥에서 손수건을 주웠다.',
};

const evaluate = (raw: unknown, chapter = ch1) =>
  evaluateChapterKeyPoint(chapter, chapterPagesOnly(chapter, pages), raw, LEXICON);
const reasons = (raw: unknown) =>
  (evaluate(raw).review[0]?.candidate as { reasons: string[] } | undefined)?.reasons ?? [];

describe('FR-SPL-003 🚦: 핵심 한 줄 입력은 그 장 원문뿐이다 (절대 규칙 3 — 상한은 데이터 선택에서)', () => {
  test('FR-SPL-003: 1장 입력에 장 범위 밖 원문 0자', () => {
    const prompt = buildKeyPointPrompt(ch1, chapterPagesOnly(ch1, pages));
    // negative — 다음 장 원문은 한 조각(6자 창)도 없다
    for (const outside of [P3, P4]) {
      for (let i = 0; i + 6 <= outside.length; i++) {
        expect(prompt).not.toContain(outside.slice(i, i + 6));
      }
    }
    expect(prompt).not.toMatch(/\[페이지 [34]\]/);
    // positive — 그 장 원문은 장 끝 쪽까지 다 있다
    expect(prompt).toContain(P1);
    expect(prompt).toContain(P2);
    expect(prompt).toContain('[페이지 2]');
  });

  test('FR-SPL-003: 2장 입력은 2장 원문만 — 앞 장 원문도 0자, 그 장 끝 쪽은 있다', () => {
    const prompt = buildKeyPointPrompt(ch2, chapterPagesOnly(ch2, pages));
    expect(prompt).not.toContain(P1);
    expect(prompt).not.toContain(P2);
    expect(prompt).toContain(P3);
    expect(prompt).toContain(P4);
  });

  test('FR-SPL-003: 장 범위 밖 쪽이 섞이면 프롬프트를 만들지 않는다', () => {
    expect(() => buildKeyPointPrompt(ch1, pages)).toThrow(/장 범위/);
    // 장 끝 쪽이 빠져도 만들지 않는다 — "장 끝까지"가 입력 범위다
    expect(() => buildKeyPointPrompt(ch1, [pages[0]])).toThrow(/장 범위/);
  });

  test('FR-SPL-003: 요청은 책 전체를 받아도 그 장 쪽만 골라 게이트웨이 작업 이름으로 묻는다', async () => {
    const ask = jest.fn().mockResolvedValue(GOOD);
    await requestChapterKeyPoint(ch1, pages, ask);
    expect(ask).toHaveBeenCalledTimes(1);
    const [prompt, task] = ask.mock.calls[0];
    expect(task).toBe(KEY_POINT_TASK);
    expect(prompt).not.toContain(P3);
    expect(prompt).not.toContain(P4);
    expect(prompt).toContain(P2);
  });
});

describe('핵심 한 줄 검사 — 통과 못 하면 쓰지 않고 검수 후보 (NFR-AI-004, R9)', () => {
  test('검사를 모두 통과하면 그 문장을 쓴다 (positive)', () => {
    const result = evaluate(GOOD);
    expect(result.key_point).toBe(GOOD.key_point);
    expect(result.review).toHaveLength(0);
  });

  test(`${KEY_POINT_MAX_LENGTH}자를 넘으면 0건 — 정확히 ${KEY_POINT_MAX_LENGTH}자는 통과`, () => {
    const exact = '유불란이 손수건을 줍는다' + '가'.repeat(KEY_POINT_MAX_LENGTH - 14) + '.';
    expect([...exact]).toHaveLength(KEY_POINT_MAX_LENGTH);
    expect(evaluate({ ...GOOD, key_point: exact }).key_point).toBe(exact);
    const long = '유불란이 손수건을 줍는다' + '가'.repeat(KEY_POINT_MAX_LENGTH - 13) + '.';
    const result = evaluate({ ...GOOD, key_point: long });
    expect(result.key_point).toBeNull();
    expect(reasons({ ...GOOD, key_point: long })).toContain('key_point_too_long');
  });

  test('두 문장이면 쓰지 않는다', () => {
    const raw = { ...GOOD, key_point: '유불란이 손수건을 줍는다. 박영민은 찻집에 있다.' };
    expect(evaluate(raw).key_point).toBeNull();
    expect(reasons(raw)).toContain('key_point_not_one_sentence');
  });

  test('평가어(단서·수상한 등)가 있으면 쓰지 않는다', () => {
    const raw = { ...GOOD, key_point: '유불란이 결정적 단서인 손수건을 줍는다.' };
    expect(evaluate(raw).key_point).toBeNull();
    expect(reasons(raw)).toContain('key_point_evaluative_word');
  });

  test('그 장 원문에 없는 고유명사(다른 장 인물)가 생기면 쓰지 않는다', () => {
    const raw = { ...GOOD, key_point: '백검사가 분장실에서 손수건을 줍는다.' };
    const result = evaluate(raw);
    expect(result.key_point).toBeNull();
    expect(reasons(raw)).toContain('key_point_new_proper_noun');
    expect(result.review[0].candidate).toMatchObject({ introduced_names: ['백검사'] });
  });

  test('근거 인용이 그 장 원문에 없으면 쓰지 않는다 — 다음 장 문장을 인용해도 0건', () => {
    const fromNextChapter = { ...GOOD, source_page: 3, quote: P3 };
    expect(evaluate(fromNextChapter).key_point).toBeNull();
    expect(reasons(fromNextChapter)).toContain('key_point_ungrounded');
    const noQuote = { key_point: GOOD.key_point };
    expect(evaluate(noQuote).key_point).toBeNull();
    expect(reasons(noQuote)).toContain('key_point_ungrounded');
  });

  test('빈 응답·형식이 다른 응답은 쓰지 않는다', () => {
    for (const raw of [null, {}, { key_point: '   ' }, { key_point: 3 }, 'text']) {
      const result = evaluate(raw);
      expect(result.key_point).toBeNull();
      expect(result.review).toHaveLength(1);
    }
  });

  test('검수 후보는 장 번호·문장·이유를 담는다', () => {
    const raw = { ...GOOD, key_point: '유불란이 수상한 손수건을 줍는다.' };
    expect(evaluate(raw).review[0]).toMatchObject({
      kind: 'key_point',
      candidate: { chapter_no: 1, key_point: raw.key_point },
    });
  });
});

describe('핵심 한 줄 생성 — 장마다 1회, 캐시 재생 (게이트웨이 경유는 ask 주입)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'key-point-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('FR-SPL-003: 장마다 그 장 원문만 넣고, 다시 돌리면 AI를 부르지 않는다', async () => {
    const ask = jest
      .fn()
      .mockResolvedValueOnce(GOOD)
      .mockResolvedValueOnce({
        key_point: '형사가 무대 뒤에서 칼을 찾는다.',
        source_page: 3,
        quote: P3,
      });
    const first = await generateBookKeyPoints({
      bookId: book,
      chapters: [ch1, ch2],
      pages,
      lexicon: LEXICON,
      outDir: dir,
      ask,
    });
    expect(ask).toHaveBeenCalledTimes(2);
    const [ch1Prompt] = ask.mock.calls[0];
    const [ch2Prompt] = ask.mock.calls[1];
    expect(ch1Prompt).not.toContain(P3);
    expect(ch1Prompt).not.toContain(P4);
    expect(ch2Prompt).not.toContain(P1);
    expect(ch2Prompt).toContain(P4);
    expect(first.key_points.map((k) => [k.chapter_no, k.key_point])).toEqual([
      [1, GOOD.key_point],
      [2, '형사가 무대 뒤에서 칼을 찾는다.'],
    ]);

    const again = jest.fn();
    const replay = await generateBookKeyPoints({
      bookId: book,
      chapters: [ch1, ch2],
      pages,
      lexicon: LEXICON,
      outDir: dir,
      ask: again,
    });
    expect(again).not.toHaveBeenCalled();
    expect(replay.key_points).toEqual(first.key_points);
  });

  test('장 원문이 바뀌면 낡은 캐시를 쓰지 않고 멈춘다', async () => {
    await generateBookKeyPoints({
      bookId: book,
      chapters: [ch1],
      pages,
      lexicon: LEXICON,
      outDir: dir,
      ask: jest.fn().mockResolvedValue(GOOD),
    });
    const changed = pages.map((p) => (p.page_no === 2 ? { ...p, content: P2 + ' 덧붙임' } : p));
    await expect(
      generateBookKeyPoints({
        bookId: book,
        chapters: [ch1],
        pages: changed,
        lexicon: LEXICON,
        outDir: dir,
        ask: jest.fn(),
      })
    ).rejects.toThrow(/Stale/);
  });
});

describe('핵심 한 줄 DB 쓰기 — 파이프라인(⑦) 경로, R12', () => {
  const okFile = (): KeyPointFile => ({
    book_id: book,
    version: 'x',
    key_points: [
      {
        chapter_no: 1,
        grounding: groundingManifest(ch1, chapterPagesOnly(ch1, pages)),
        key_point: GOOD.key_point,
      },
      {
        chapter_no: 2,
        grounding: groundingManifest(ch2, chapterPagesOnly(ch2, pages)),
        key_point: null,
      },
    ],
    review_candidates: [],
  });

  function fakeClient(
    dbChapters = [
      { chapter_no: 1, start_page: 1, end_page: 2 },
      { chapter_no: 2, start_page: 3, end_page: 4 },
    ],
    existing: Record<number, string | null> = {}
  ) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM chapters/i.test(sql)) return { rows: dbChapters };
      if (/SELECT chapter_no, key_point FROM chapter_summaries/i.test(sql))
        return {
          rows: Object.entries(existing).map(([no, kp]) => ({
            chapter_no: Number(no),
            key_point: kp,
          })),
        };
      if (/UPDATE chapter_summaries/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    return { client: { query }, calls };
  }

  test('R12: 쓰기 전에 책을 공개에서 내리고, 통과한 문장만 pending 으로 쓴다', async () => {
    const { client, calls } = fakeClient();
    const report = await applyKeyPoints(client, okFile(), [ch1, ch2], pages);
    const reset = calls.findIndex((c) => /UPDATE books SET ssabi_ready = false/i.test(c.sql));
    const write = calls.findIndex((c) => /UPDATE chapter_summaries/i.test(c.sql));
    expect(reset).toBeGreaterThanOrEqual(0);
    expect(reset).toBeLessThan(write);
    const writes = calls.filter((c) => /UPDATE chapter_summaries/i.test(c.sql));
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toMatch(/key_point_review_status = 'pending'/);
    expect(writes[0].params).toEqual([GOOD.key_point, book, 1]);
    expect(report).toEqual({ written: 1, skipped: 1 });
  });

  test('FR-ADM-005: 문장이 바뀐 장은 이전 검수 기록을 지워 다시 검수받게 한다 — 같으면 남긴다', async () => {
    const changed = fakeClient(undefined, { 1: '예전 핵심 한 줄.' });
    await applyKeyPoints(changed.client, okFile(), [ch1, ch2], pages);
    const forget = changed.calls.filter((c) => /DELETE FROM review_records/i.test(c.sql));
    expect(forget).toHaveLength(1);
    expect(forget[0].params).toEqual([book, 'chapter_key_point', '1']);

    const same = fakeClient(undefined, { 1: GOOD.key_point });
    await applyKeyPoints(same.client, okFile(), [ch1, ch2], pages);
    expect(same.calls.filter((c) => /DELETE FROM review_records/i.test(c.sql))).toHaveLength(0);
  });

  test('DB의 장 범위가 생성 때와 다르면 아무것도 쓰지 않는다', async () => {
    const { client, calls } = fakeClient([
      { chapter_no: 1, start_page: 1, end_page: 3 },
      { chapter_no: 2, start_page: 4, end_page: 4 },
    ]);
    await expect(applyKeyPoints(client, okFile(), [ch1, ch2], pages)).rejects.toThrow(/장 범위/);
    expect(calls.filter((c) => /^\s*UPDATE|DELETE/i.test(c.sql))).toHaveLength(0);
  });

  test('원문이 생성 때와 다르면 아무것도 쓰지 않는다', async () => {
    const { client, calls } = fakeClient();
    const changed = pages.map((p) => (p.page_no === 1 ? { ...p, content: P1 + ' 덧붙임' } : p));
    await expect(applyKeyPoints(client, okFile(), [ch1, ch2], changed)).rejects.toThrow(/원문/);
    expect(calls.filter((c) => /^\s*UPDATE|DELETE/i.test(c.sql))).toHaveLength(0);
  });

  test('파일에 적힌 문장도 다시 검사한다 — 60자 넘는 문장은 쓰지 않는다', async () => {
    const { client } = fakeClient();
    const file = okFile();
    file.key_points[0].key_point = '가'.repeat(KEY_POINT_MAX_LENGTH + 1) + '.';
    await expect(applyKeyPoints(client, file, [ch1, ch2], pages)).rejects.toThrow(/60자/);
  });
});

describe('절대 규칙 4: LLM은 게이트웨이(⑥)로만', () => {
  test('핵심 한 줄 코드는 SDK를 직접 부르지 않고 실행 스크립트는 gateway.call 을 쓴다', () => {
    const lib = fs.readFileSync(path.join(__dirname, 'chapter-key-point.ts'), 'utf-8');
    const run = fs.readFileSync(path.join(__dirname, 'run-generate-key-points.ts'), 'utf-8');
    for (const source of [lib, run]) {
      expect(source).not.toMatch(/from ['"](openai|@anthropic-ai\/sdk)['"]/);
      expect(source).not.toMatch(/require\(['"](openai|@anthropic-ai\/sdk)['"]\)/);
    }
    expect(run).toMatch(/from '\.\.\/\.\.\/modules\/llm-gateway\/gateway'/);
  });
});
