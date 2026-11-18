/**
 * 구조적 관계 추출 평가 도구 — FR-CHR-001 🚦
 * 구현 전에 작성했다. LLM·DB를 부르지 않는다.
 *  1) 정밀도·재현율 + 이른 확립 페이지 수(0이어야 통과)
 *  2) oracle.json 주입 후보 21건을 새 파이프라인의 결정적 검사에 넣은 결과 — 기존 구조 검사는 잘못된
 *     후보 11건을 통과시켰다(results/baseline-candidate-probes.json). 그보다 적어야 한다.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  scoreRelationships,
  type GoldRelationship,
  type PredictedRelationship,
} from '../../../evaluation/relationships/structural-metrics';
import { runStructuralProbe } from '../../../evaluation/relationships/structural-probe';

const gold: GoldRelationship[] = [
  {
    subject: '김씨',
    object: '초봉이',
    relation_key: 'jealousy',
    directed: true,
    established_page: 91,
  },
  {
    subject: '형보',
    object: '초봉이',
    relation_key: 'possessive_desire',
    directed: true,
    established_page: 129,
  },
  {
    subject: '서윤',
    object: '도현',
    relation_key: 'siblings',
    directed: false,
    established_page: 3,
  },
];
const pred = (
  character_a: string,
  character_b: string,
  relation_key: string,
  established_page: number,
  direction: PredictedRelationship['direction'] = 'a_to_b'
): PredictedRelationship => ({
  character_a,
  character_b,
  relation_key,
  established_page,
  direction,
});

describe('FR-CHR-001: 구조적 관계 평가 지표', () => {
  test('FR-CHR-001: 전부 맞으면 정밀도·재현율 1, 이른 확립 0건이면 통과', () => {
    const out = scoreRelationships(gold, [
      pred('김씨', '초봉이', 'jealousy', 91),
      pred('형보', '초봉이', 'possessive_desire', 129),
      pred('도현', '서윤', 'siblings', 3, 'undirected'),
    ]);
    expect(out.precision).toBe(1);
    expect(out.recall).toBe(1);
    expect(out.early_established).toBe(0);
    expect(out.pass).toBe(true);
  });

  test('FR-CHR-001: 정답보다 이른 확립 페이지가 1건이라도 있으면 실패 — 그 관계를 돌려준다', () => {
    const out = scoreRelationships(gold, [
      pred('김씨', '초봉이', 'jealousy', 90),
      pred('형보', '초봉이', 'possessive_desire', 129),
    ]);
    expect(out.early_established).toBe(1);
    expect(out.early.map((e) => [e.character_a, e.predicted_page, e.gold_page])).toEqual([
      ['김씨', 90, 91],
    ]);
    expect(out.pass).toBe(false);
  });

  test('방향이 반대면 맞힌 것이 아니다(정밀도·재현율 모두 깎임), 늦은 확립은 경고만', () => {
    const out = scoreRelationships(gold, [
      pred('초봉이', '김씨', 'jealousy', 91),
      pred('형보', '초봉이', 'possessive_desire', 140),
    ]);
    expect(out.tp).toBe(1);
    expect(out.fp).toBe(1);
    expect(out.fn).toBe(2);
    expect(out.late_established).toBe(1);
    expect(out.early_established).toBe(0);
  });

  test('envy와 jealousy는 같은 관계 키로 본다(문서화된 동의어만)', () => {
    const out = scoreRelationships(
      [
        {
          subject: 'Kitty',
          object: 'Miss Lucas',
          relation_key: 'envy',
          directed: true,
          established_page: 1,
        },
      ],
      [pred('Kitty', 'Miss Lucas', 'jealousy', 1)]
    );
    expect(out.tp).toBe(1);
  });

  test('빈 추출은 통과가 아니다', () => {
    const out = scoreRelationships(gold, []);
    expect(out.recall).toBe(0);
    expect(out.pass).toBe(false);
  });
});

describe('FR-CHR-001: 주입 후보 21건 — 새 파이프라인의 결정적 검사', () => {
  const dir = path.join(__dirname, '../../../evaluation/relationships');
  const oracle = JSON.parse(fs.readFileSync(path.join(dir, 'oracle.json'), 'utf8'));
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'injected-triggers.json'), 'utf8'));
  const baseline = JSON.parse(
    fs.readFileSync(path.join(dir, 'results/baseline-candidate-probes.json'), 'utf8')
  );

  test('FR-CHR-001: 그럴듯한 trigger 조건의 잘못된 채택이 기존 11건보다 적다', async () => {
    const out = await runStructuralProbe(oracle, config);
    expect(out.counts.total).toBe(baseline.counts.total);
    expect(baseline.counts.false_accepts).toBe(11);
    expect(out.counts.false_accepts).toBeLessThan(baseline.counts.false_accepts);
  });

  test('결과에 사례별 판정·사유와 최악 조건(모든 낱말 trigger) 수치가 함께 남는다', async () => {
    const out = await runStructuralProbe(oracle, config);
    expect(out.results).toHaveLength(21);
    for (const r of out.results) {
      expect(['accept', 'hold']).toContain(r.observed);
      if (r.observed === 'hold') expect(r.reasons.length).toBeGreaterThan(0);
    }
    expect(out.worst_case.wrong_total).toBe(
      out.results.filter((r) => r.expected !== 'accept').length
    );
    expect(out.worst_case.false_accepts).toBeGreaterThanOrEqual(out.counts.false_accepts);
  });
});
