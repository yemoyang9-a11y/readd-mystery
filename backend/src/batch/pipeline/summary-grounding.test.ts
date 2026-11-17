/**
 * 장 요약 문장별 근거 확인 — FR-DAT-003 🚦 · NFR-AI-004
 * 가짜 LLM만 쓴다. 근거를 확인하지 못한 문장은 지우거나 고치지 않고 검수 후보로 남긴다.
 */
import { Chapter, Page } from '../../shared/types';
import {
  SUMMARY_GROUNDING_TASK,
  buildSummaryGroundingPrompt,
  requestSummaryGrounding,
  splitSummarySentences,
  summaryGroundingCandidates,
} from './summary-grounding';

const P1 = '유불란은 해왕좌 분장실에 들어갔다. 유불란이 바닥에서 손수건을 주웠다.';
const P2 = '그날 밤 박영민은 극장 앞 찻집에 앉아 있었다.';
// 다음 장(쪽 3) — 이 장의 입력에 들어가면 안 되는 원문
const NEXT = '이튿날 아침 형사가 무대 뒤에서 피 묻은 칼을 발견했다.';

const chapter: Chapter = {
  id: 'c1',
  book_id: 'fixture',
  chapter_no: 1,
  title: '분장실',
  start_page: 1,
  end_page: 2,
};
const pages: Page[] = [P1, P2].map((content, i) => ({
  id: `p${i + 1}`,
  book_id: 'fixture',
  page_no: i + 1,
  content,
}));

const S1 = '유불란이 분장실에서 손수건을 주웠다.';
const S2 = '박영민은 찻집에 앉아 있었다.';
const SUMMARY = `${S1} ${S2}`;
const Q1 = { index: 1, source_page: 1, quote: '유불란이 바닥에서 손수건을 주웠다.' };
const Q2 = { index: 2, source_page: 2, quote: '박영민은 극장 앞 찻집에 앉아 있었다.' };

const candidates = (raw: unknown, summary = SUMMARY) =>
  summaryGroundingCandidates(1, summary, pages, raw);
const flagged = (raw: unknown, summary = SUMMARY) =>
  (
    candidates(raw, summary)[0]?.candidate as
      { sentences: { index: number; sentence: string; detail: string }[] } | undefined
  )?.sentences;

describe('요약 문장 나누기 — FR-DAT-003', () => {
  test('FR-DAT-003: 마침표·물음표·느낌표에서 나누고 빈 조각은 버린다', () => {
    expect(splitSummarySentences(` ${S1}  ${S2}\n형사가 왔는가? 왔다! `)).toEqual([
      S1,
      S2,
      '형사가 왔는가?',
      '왔다!',
    ]);
    expect(splitSummarySentences('')).toEqual([]);
    expect(splitSummarySentences('마침표 없는 요약')).toEqual(['마침표 없는 요약']);
  });

  test('FR-DAT-003: 따옴표 안의 마침표에서는 나누지 않는다', () => {
    expect(
      splitSummarySentences('박영민이 "나는 집에 있었소." 하고 말했다. 유불란이 나갔다.')
    ).toEqual(['박영민이 "나는 집에 있었소." 하고 말했다.', '유불란이 나갔다.']);
  });
});

describe('근거 확인 프롬프트 — FR-SPL-002 🚦', () => {
  test('FR-SPL-002: 입력은 그 장 원문뿐이다 — 다음 장 원문 0자', () => {
    const prompt = buildSummaryGroundingPrompt(chapter, pages, [S1, S2]);
    expect(prompt).not.toContain(NEXT);
    expect(prompt).not.toContain('[페이지 3]');
  });

  test('FR-SPL-002: positive — 그 장의 모든 쪽과 번호 붙인 요약 문장은 들어간다', () => {
    const prompt = buildSummaryGroundingPrompt(chapter, pages, [S1, S2]);
    expect(prompt).toContain(`[페이지 1]\n${P1}`);
    expect(prompt).toContain(`[페이지 2]\n${P2}`);
    expect(prompt).toContain(`1. ${S1}`);
    expect(prompt).toContain(`2. ${S2}`);
  });
});

describe('문장별 근거 검증 — NFR-AI-004', () => {
  test('NFR-AI-004: 모든 문장의 인용이 그 장 원문에 있으면 검수 후보 0건', () => {
    expect(candidates({ sentences: [Q1, Q2] })).toEqual([]);
  });

  test('NFR-AI-004: 인용이 그 장 원문에 없는 문장만 검수 후보에 적힌다 — 요약은 고치지 않는다', () => {
    const out = candidates({
      sentences: [Q1, { index: 2, source_page: 2, quote: '박영민은 찻집에서 편지를 썼다.' }],
    });
    expect(out).toEqual([
      {
        kind: 'summary',
        reason: 'summary_sentence_ungrounded',
        candidate: {
          chapter_no: 1,
          summary: SUMMARY,
          sentences: [{ index: 2, sentence: S2, detail: 'quote_not_in_chapter' }],
        },
      },
    ]);
  });

  test('NFR-AI-004: 다른 장의 인용은 근거로 치지 않는다 — 쪽이 장 밖이거나, 이 장 쪽에 없는 문장', () => {
    // 다음 장 쪽 번호를 댄 경우
    expect(flagged({ sentences: [Q1, { index: 2, source_page: 3, quote: NEXT }] })).toEqual([
      { index: 2, sentence: S2, detail: 'quote_not_in_chapter' },
    ]);
    // 다음 장 문장을 이 장 쪽 번호로 댄 경우
    expect(flagged({ sentences: [Q1, { index: 2, source_page: 2, quote: NEXT }] })).toEqual([
      { index: 2, sentence: S2, detail: 'quote_not_in_chapter' },
    ]);
  });

  test('NFR-AI-004: 인용을 내지 않은 문장·응답에서 빠진 문장은 근거 없음이다', () => {
    expect(flagged({ sentences: [Q1, { index: 2, source_page: null, quote: null }] })).toEqual([
      { index: 2, sentence: S2, detail: 'no_quote' },
    ]);
    expect(flagged({ sentences: [Q2] })).toEqual([{ index: 1, sentence: S1, detail: 'no_quote' }]);
  });

  test('NFR-AI-004: 너무 짧은 인용은 근거로 치지 않는다', () => {
    expect(flagged({ sentences: [{ index: 1, source_page: 1, quote: '유불란' }, Q2] })).toEqual([
      { index: 1, sentence: S1, detail: 'quote_too_short' },
    ]);
  });

  test('NFR-AI-004: 응답이 깨졌으면 조용히 통과하지 않는다 — 모든 문장이 검수 후보', () => {
    for (const raw of [null, {}, 'x', { sentences: 'x' }, { sentences: [null, 3] }]) {
      expect(flagged(raw)?.map((s) => s.index)).toEqual([1, 2]);
    }
  });

  test('NFR-AI-004: 같은 문장 번호가 두 번 오면 하나라도 검증되지 않을 때 근거 없음이다', () => {
    expect(
      flagged({ sentences: [Q1, Q2, { index: 2, source_page: 2, quote: '원문에 없는 문장이다.' }] })
    ).toEqual([{ index: 2, sentence: S2, detail: 'quote_not_in_chapter' }]);
  });

  test('FR-DAT-003: 빈 요약은 확인할 문장이 없어 통과가 아니라 검수 후보다', () => {
    expect(candidates({ sentences: [] }, '  ')).toEqual([
      {
        kind: 'summary',
        reason: 'summary_sentence_ungrounded',
        candidate: { chapter_no: 1, summary: '  ', sentences: [] },
      },
    ]);
  });
});

describe('LLM 호출 — 4.3절', () => {
  test('NFR-OBS-004: 장당 1회, 자기 작업 이름으로 부른다', async () => {
    const calls: { prompt: string; task: string }[] = [];
    const raw = await requestSummaryGrounding(chapter, pages, SUMMARY, async (prompt, task) => {
      calls.push({ prompt, task });
      return { sentences: [Q1, Q2] };
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].task).toBe(SUMMARY_GROUNDING_TASK);
    expect(SUMMARY_GROUNDING_TASK).toBe('generate_summary_grounding');
    expect(calls[0].prompt).toBe(buildSummaryGroundingPrompt(chapter, pages, [S1, S2]));
    expect(raw).toEqual({ sentences: [Q1, Q2] });
  });

  test('FR-SPL-005: LLM 호출이 실패하면 오류가 그대로 올라온다 — 통과로 바꾸지 않는다', async () => {
    await expect(
      requestSummaryGrounding(chapter, pages, SUMMARY, async () => {
        throw new Error('gateway down');
      })
    ).rejects.toThrow('gateway down');
  });

  test('FR-DAT-003: 빈 요약은 LLM을 부르지 않는다', async () => {
    const ask = jest.fn();
    expect(await requestSummaryGrounding(chapter, pages, ' ', ask)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
});
