import {
  pickEvidenceLines,
  EVIDENCE_ITEM_MAX_CHARS,
  EVIDENCE_TOTAL_MAX_CHARS,
} from '../evidence-lines';
import { VERBATIM_LIMIT } from '../output-guard';

const PAGE_65 =
  '비가 내리는 밤이었다. 김 형사는 낡은 장갑을 책상 위에 올려놓았다. 문 밖에서 발소리가 멈췄다.';
const PAGE_130 = '마침내 서재의 불이 꺼졌다. 박 교수는 열쇠를 서랍에 넣었다.';
const PAGE_12 = '그는 천천히 장갑을 벗고 창가에 놓인 편지를 집어 들었다.';

const pages = [
  { page_no: 12, content: PAGE_12 },
  { page_no: 65, content: PAGE_65 },
  { page_no: 130, content: PAGE_130 },
];

describe('FR-SPL-002 🚦: 근거 문장은 기준점 K 이하 쪽에서만 고른다', () => {
  const answer =
    '김 형사가 장갑을 올려놓는 장면은 p.65에 있고, 박 교수가 열쇠를 넣는 장면은 p.130이에요.';

  test('K=40이면 p.130(과 p.65) 항목은 0건', () => {
    expect(pickEvidenceLines({ answer, cutoff: 40, pages })).toEqual([]);
  });

  test('K=130이면 둘 다 나온다 (positive 쌍)', () => {
    const items = pickEvidenceLines({ answer, cutoff: 130, pages });
    expect(items.map((item) => item.page)).toEqual([65, 130]);
  });

  test('K=65이면 p.65만, p.130은 0건', () => {
    const items = pickEvidenceLines({ answer, cutoff: 65, pages });
    expect(items.map((item) => item.page)).toEqual([65]);
  });

  test('조립 범위에 근거 조각이 없는 쪽은 항목을 내지 않는다', () => {
    expect(pickEvidenceLines({ answer: 'p.65를 보세요.', cutoff: 130, pages: [pages[0]] })).toEqual(
      []
    );
  });

  test('조립 범위 안에 K를 넘는 조각이 섞여 있어도 그 쪽은 내지 않는다', () => {
    expect(pickEvidenceLines({ answer: 'p.130이에요 열쇠', cutoff: 40, pages })).toEqual([]);
  });
});

describe('근거 문장 선택과 길이 상한 (NFR-AI-005, 절대 규칙 12의 정신)', () => {
  test('답변과 겹치는 낱말이 가장 많은 문장을 원문 부분 문자열 그대로 고른다', () => {
    const [item] = pickEvidenceLines({
      answer: '김 형사가 장갑을 책상에 올려놓았어요 (p.65)',
      cutoff: 100,
      pages,
    });
    expect(item.page).toBe(65);
    expect(item.text).toBe('김 형사는 낡은 장갑을 책상 위에 올려놓았다.');
    expect(PAGE_65.includes(item.text)).toBe(true);
  });

  test('쪽 표기가 없는 답변은 항목이 없다', () => {
    expect(pickEvidenceLines({ answer: '장갑 이야기예요.', cutoff: 100, pages })).toEqual([]);
  });

  test('겹치는 낱말이 하나도 없는 쪽은 내지 않는다', () => {
    expect(pickEvidenceLines({ answer: '우주선 이야기 p.12', cutoff: 100, pages })).toEqual([]);
  });

  test('한 항목 120자 이하, 합계 200자 이하, 최대 3개', () => {
    const long = '장갑 '.repeat(100);
    const many = [10, 20, 30, 40, 50].map((n) => ({ page_no: n, content: long }));
    const items = pickEvidenceLines({
      answer: '장갑 p.10 p.20 p.30 p.40 p.50',
      cutoff: 100,
      pages: many,
    });
    expect(items.length).toBeLessThanOrEqual(3);
    items.forEach((item) => {
      expect(Array.from(item.text).length).toBeLessThanOrEqual(EVIDENCE_ITEM_MAX_CHARS);
      expect(long.includes(item.text)).toBe(true);
    });
    const total = items.reduce((sum, item) => sum + Array.from(item.text).length, 0);
    expect(total).toBeLessThanOrEqual(EVIDENCE_TOTAL_MAX_CHARS);
    expect(EVIDENCE_TOTAL_MAX_CHARS).toBeLessThanOrEqual(VERBATIM_LIMIT);
    expect(EVIDENCE_ITEM_MAX_CHARS).toBe(120);
  });
});
