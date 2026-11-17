/**
 * 관계 확립 페이지 비대칭 지표 — 정답보다 이르게 잡힌 관계(스포일러 방향)를 따로 센다.
 * 구현 전에 작성했다. 실제 LLM·DB 실행 없이 작은 표본으로만 검증한다.
 */
import {
  collectEstablishedRelationships,
  compareEstablishedPages,
  type EstablishedRelationship,
} from '../../../evaluation/relationships/established-page-metric';

const rel = (
  a: string,
  b: string,
  relation_key: string,
  established_page: number
): EstablishedRelationship => ({ character_a: a, character_b: b, relation_key, established_page });

const gold = [
  rel('김씨', '초봉이', 'jealousy', 91),
  rel('형보', '초봉이', 'possessive_desire', 129),
  rel('태수', '초봉이', 'marriage', 150),
];

describe('FR-CHR-001: 확립 페이지 비대칭 지표', () => {
  test('FR-CHR-001: 정답보다 이른 확립 페이지 0건 — 전부 일치하면 통과', () => {
    const out = compareEstablishedPages(gold, gold);
    expect(out.early).toEqual([]);
    expect(out.late).toEqual([]);
    expect(out.counts).toEqual({
      gold: 3,
      predicted: 3,
      matched: 3,
      exact: 3,
      early: 0,
      late: 0,
      missing: 0,
      unmatched: 0,
    });
    expect(out.pass).toBe(true);
  });

  test('FR-CHR-001: 정답보다 이르게 잡힌 관계가 1건이라도 있으면 실패하고 그 행을 돌려준다', () => {
    const out = compareEstablishedPages(gold, [
      rel('김씨', '초봉이', 'jealousy', 91),
      rel('형보', '초봉이', 'possessive_desire', 120),
      rel('태수', '초봉이', 'marriage', 150),
    ]);
    expect(out.early).toEqual([
      {
        character_a: '형보',
        character_b: '초봉이',
        relation_key: 'possessive_desire',
        gold_page: 129,
        predicted_page: 120,
        pages_off: 9,
      },
    ]);
    expect(out.counts.early).toBe(1);
    expect(out.counts.late).toBe(0);
    expect(out.pass).toBe(false);
  });

  test('FR-CHR-001: 정답보다 늦게 잡힌 관계는 따로 세고 실패로 치지 않는다 (경고)', () => {
    const out = compareEstablishedPages(gold, [
      rel('김씨', '초봉이', 'jealousy', 95),
      rel('형보', '초봉이', 'possessive_desire', 129),
      rel('태수', '초봉이', 'marriage', 150),
    ]);
    expect(out.early).toEqual([]);
    expect(out.late).toEqual([
      {
        character_a: '김씨',
        character_b: '초봉이',
        relation_key: 'jealousy',
        gold_page: 91,
        predicted_page: 95,
        pages_off: 4,
      },
    ]);
    expect(out.counts).toMatchObject({ exact: 2, early: 0, late: 1 });
    expect(out.pass).toBe(true);
  });

  test('FR-CHR-001: 이른 오류와 늦은 오류가 섞이면 각각 세고, 이른 오류 때문에 실패한다', () => {
    const out = compareEstablishedPages(gold, [
      rel('김씨', '초봉이', 'jealousy', 95),
      rel('형보', '초봉이', 'possessive_desire', 128),
      rel('태수', '초봉이', 'marriage', 150),
    ]);
    expect(out.counts).toMatchObject({ matched: 3, exact: 1, early: 1, late: 1 });
    expect(out.pass).toBe(false);
  });

  test('FR-CHR-001: 두 인물의 저장 순서가 바뀌어도 같은 관계로 맞춘다', () => {
    const out = compareEstablishedPages(gold, [rel('초봉이', '형보', 'possessive_desire', 100)]);
    expect(out.early.map((e) => e.predicted_page)).toEqual([100]);
    expect(out.pass).toBe(false);
  });

  test('FR-CHR-001: 이력형 복수 행은 가장 이른 확립 페이지로 비교한다 — 독자에게 처음 보이는 시점', () => {
    const out = compareEstablishedPages(gold, [
      rel('형보', '초봉이', 'possessive_desire', 140),
      rel('형보', '초봉이', 'possessive_desire', 110),
    ]);
    expect(out.early).toHaveLength(1);
    expect(out.early[0]).toMatchObject({ gold_page: 129, predicted_page: 110 });
    expect(out.late).toEqual([]);
  });

  test('FR-CHR-001: 같은 두 인물이라도 의미(relation_key)가 다르면 비교하지 않는다', () => {
    const out = compareEstablishedPages(gold, [rel('형보', '초봉이', 'friendship', 3)]);
    expect(out.early).toEqual([]);
    expect(out.counts).toMatchObject({ matched: 0, missing: 3, unmatched: 1 });
  });

  test('FR-CHR-001: 누락(정답에만 있음)과 정답 밖 추출은 세기만 하고 이른 오류로 치지 않는다', () => {
    const out = compareEstablishedPages(gold, [
      rel('김씨', '초봉이', 'jealousy', 91),
      rel('행화', '초봉이', 'friendship', 10),
    ]);
    expect(out.counts).toMatchObject({ matched: 1, exact: 1, early: 0, missing: 2, unmatched: 1 });
    expect(out.pass).toBe(true);
  });

  test('FR-CHR-001: 비교한 관계가 0건이면 통과로 치지 않는다 — 빈 결과가 통과하면 안 된다', () => {
    expect(compareEstablishedPages(gold, []).pass).toBe(false);
    expect(compareEstablishedPages([], []).pass).toBe(false);
  });
});

describe('평가 파일에서 관계 행 꺼내기', () => {
  test('cases[].relationships 형태 — relation_key는 semantics에서 읽는다', () => {
    const out = collectEstablishedRelationships({
      cases: [
        {
          relationships: [
            {
              character_a: '김씨',
              character_b: '초봉이',
              established_page: 91,
              semantics: { relation_key: 'jealousy' },
            },
          ],
        },
      ],
    });
    expect(out).toEqual({ relationships: [rel('김씨', '초봉이', 'jealousy', 91)], skipped: 0 });
  });

  test('인물이 ID로 적힌 산출물은 characters로 이름을 찾고, 못 찾는 행은 건너뛴 수로 센다', () => {
    const out = collectEstablishedRelationships({
      characters: [
        { id: 'c1', name: '형보' },
        { id: 'c2', name: '초봉이' },
      ],
      relationships: [
        {
          character_a_id: 'c1',
          character_b_id: 'c2',
          established_page: 129,
          semantics: { relation_key: 'possessive_desire' },
        },
        { character_a_id: 'c1', character_b_id: 'c9', established_page: 130 },
      ],
    });
    expect(out).toEqual({
      relationships: [rel('형보', '초봉이', 'possessive_desire', 129)],
      skipped: 1,
    });
  });
});
