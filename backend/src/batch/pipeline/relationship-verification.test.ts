import {
  VerifierCharacter,
  buildVerifierPrompt,
  endpointForms,
  verifyRelationships,
} from './relationship-verification';
import { GroundedRelationship } from './grounding';
import { Page } from '../../shared/types';

const lexicon: VerifierCharacter[] = [
  {
    id: 'park',
    name: '박영민',
    first_appearance_page: 1,
    aliases: [
      { alias: '좌장', first_appearance_page: 1 },
      { alias: '해왕좌의 좌장', first_appearance_page: 1 },
    ],
  },
  {
    id: 'mong',
    name: '이몽란',
    first_appearance_page: 1,
    aliases: [
      { alias: '좌장 부인', first_appearance_page: 1 },
      { alias: '해왕좌 배우', first_appearance_page: 1 },
    ],
  },
  {
    id: 'na',
    name: '나용귀',
    first_appearance_page: 1,
    aliases: [{ alias: '해왕좌 배우', first_appearance_page: 1 }],
  },
  { id: 'yu', name: '유불란', first_appearance_page: 1, aliases: [] },
  {
    id: 'jin',
    name: '진대성',
    first_appearance_page: 1,
    aliases: [{ alias: '해왕좌 배우', first_appearance_page: 1 }],
  },
];

const filler = '그날 밤은 길었다. '.repeat(40);
const pageOf = (page_no: number, content: string): Page => ({
  id: `p${page_no}`,
  book_id: 'b',
  page_no,
  content,
});

const rel = (
  a: string,
  b: string,
  quote: string,
  page: number,
  patch: Record<string, unknown> = {}
): GroundedRelationship =>
  ({
    character_a: a,
    character_b: b,
    label: '관계다',
    established_page: page,
    rationale: 'r',
    assertion_status: 'fact',
    change_type: 'establishment',
    evidence: { source_page: page, quote, start_char: 0, end_char: quote.length },
    semantics: {
      version: 2,
      direction: 'a_to_b',
      kind: 'family',
      relation_key: 'marriage',
      summary: `${a}은 ${b}의 남편이다.`,
      assertion_status: 'fact',
      temporal_scope: 'ongoing',
      state: 'active',
      evidence: { source_page: page, quote, start_char: 0, end_char: quote.length },
    },
    ...patch,
  }) as unknown as GroundedRelationship;

const supportive = async () => ({ supports: true, why: '근거가 있다' });
const verify = (
  candidates: GroundedRelationship[],
  pages: Page[],
  opts: Parameters<typeof verifyRelationships>[3] = {}
) => verifyRelationships(candidates, pages, lexicon, { verifier: supportive, ...opts });

describe('FR-CHR-001: 인용 원문 일치', () => {
  const quote = '좌장 부인 해왕좌 배우 이몽란(李夢蘭, 24)';
  const pages = [pageOf(1, `배역 소개\n• ${quote}\n`)];

  test('FR-CHR-001: 인용이 해당 쪽 원문에 없으면 quote_not_found로 보류', async () => {
    const [v] = await verify(
      [rel('박영민', '이몽란', '원문에 없는 문장이다 이몽란 좌장', 1)],
      pages
    );
    expect(v.check).toBe('held');
    expect(v.reasons).toContain('quote_not_found');
  });

  test('FR-CHR-001: 따옴표·공백만 다른 인용은 원문 그대로로 인정한다', async () => {
    const curly = [pageOf(1, '“나는   몽란을 사랑한다.” 유불란이 말했다.')];
    const [v] = await verify([rel('유불란', '이몽란', '"나는 몽란을 사랑한다."', 1)], curly);
    expect(v.reasons).not.toContain('quote_not_found');
    expect(v.check).not.toBe('held');
  });

  test('FR-CHR-001: 확립 쪽이 인용 쪽보다 앞이면 established_before_quote로 보류', async () => {
    const two = [pageOf(1, filler), pageOf(2, `• ${quote}`)];
    const bad = rel('박영민', '이몽란', quote, 2, { established_page: 1 });
    const [held] = await verify([bad], two);
    expect(held.reasons).toContain('established_before_quote');
    const [ok] = await verify([rel('박영민', '이몽란', quote, 2)], two);
    expect(ok.reasons).not.toContain('established_before_quote');
  });

  test('FR-CHR-001: 확립 쪽이 인용 쪽보다 뒤여도 쪽이 어긋나므로 established_after_quote로 보류', async () => {
    const two = [pageOf(1, `• ${quote}`), pageOf(2, filler)];
    const [held] = await verify([rel('박영민', '이몽란', quote, 1, { established_page: 2 })], two);
    expect(held.check).toBe('held');
    expect(held.reasons).toContain('established_after_quote');
  });
});

describe('FR-CHR-001: 두 인물이 인용 주변에 실제로 나오는가', () => {
  test('FR-CHR-001: 등록된 호칭(좌장)과 이름 전체로 "좌장 부인 해왕좌 배우 이몽란" 쌍이 통과한다', async () => {
    const quote = '좌장 부인 해왕좌 배우 이몽란(李夢蘭, 24)';
    const [v] = await verify([rel('박영민', '이몽란', quote, 1)], [pageOf(1, `• ${quote}`)]);
    expect(v.reasons).not.toContain('endpoint_not_near_quote');
    expect(v.check).not.toBe('held');
  });

  test('FR-CHR-001: 어느 한 인물도 나오지 않으면 endpoint_not_near_quote로 보류', async () => {
    const quote = '좌장 부인 해왕좌 배우 이몽란(李夢蘭, 24)';
    const [v] = await verify([rel('나용귀', '이몽란', quote, 1)], [pageOf(1, `• ${quote}`)]);
    expect(v.check).toBe('held');
    expect(v.reasons).toContain('endpoint_not_near_quote');
  });

  test('FR-CHR-001: 이름의 성을 뺀 이름("몽란")과 앞뒤 200자 안의 화자 이름으로 통과한다', async () => {
    const quote = '나는 몽란을 사랑한다.';
    const page = pageOf(1, `${filler}유불란은 혼잣말로 중얼거렸다. ${quote} ${filler}`);
    const [v] = await verify([rel('유불란', '이몽란', quote, 1)], [page]);
    expect(v.reasons).not.toContain('endpoint_not_near_quote');
  });

  test('FR-CHR-001: 화자 이름이 200자 밖이면 같은 인용도 endpoint_not_near_quote', async () => {
    const quote = '나는 몽란을 사랑한다.';
    const page = pageOf(1, `유불란은 혼잣말로 중얼거렸다.${filler}${quote}${filler}`);
    const [v] = await verify([rel('유불란', '이몽란', quote, 1)], [page]);
    expect(v.check).toBe('held');
    expect(v.reasons).toContain('endpoint_not_near_quote');
  });

  test('FR-CHR-001: 직함 "좌장"은 그 인물에게 묶인 호칭이면 끝점으로 센다', async () => {
    const quote = '내가 좌장을 죽인 범인이오.';
    const page = pageOf(1, `나용귀는 소리쳤다. ${quote}`);
    const [v] = await verify([rel('나용귀', '박영민', quote, 1)], [page]);
    expect(v.reasons).not.toContain('endpoint_not_near_quote');
  });

  test('FR-CHR-001: 여러 인물이 공유하는 호칭(해왕좌 배우)은 끝점이 되지 못한다', async () => {
    const quote = '해왕좌 배우가 무대 위에서 웃었다.';
    const [v] = await verify([rel('진대성', '이몽란', quote, 1)], [pageOf(1, quote)]);
    expect(v.check).toBe('held');
    expect(v.reasons).toContain('endpoint_not_near_quote');
  });

  test('FR-CHR-001: 확립 쪽보다 늦게 등록된 호칭은 끝점으로 세지 않는다', async () => {
    const late: VerifierCharacter[] = [
      {
        id: 'a',
        name: '박영민',
        first_appearance_page: 1,
        aliases: [{ alias: '좌장', first_appearance_page: 9 }],
      },
      { id: 'b', name: '이몽란', first_appearance_page: 1, aliases: [] },
    ];
    const quote = '좌장은 몽란에게 화를 냈다.';
    const early = await verifyRelationships(
      [rel('박영민', '이몽란', quote, 1)],
      [pageOf(1, quote)],
      late,
      { verifier: supportive }
    );
    expect(early[0].reasons).toContain('endpoint_not_near_quote');
    const onTime = await verifyRelationships(
      [rel('박영민', '이몽란', quote, 1)],
      [pageOf(1, quote)],
      [{ ...late[0], aliases: [{ alias: '좌장', first_appearance_page: 1 }] }, late[1]],
      { verifier: supportive }
    );
    expect(onTime[0].reasons).not.toContain('endpoint_not_near_quote');
  });

  test('FR-CHR-001: 끝점으로 쓰는 형태는 한 인물에게만 속해야 한다', () => {
    const forms = endpointForms(lexicon[1], lexicon, 1);
    expect(forms).toEqual(expect.arrayContaining(['이몽란', '몽란', '좌장 부인']));
    expect(forms).not.toContain('해왕좌 배우');
  });
});

describe('FR-CHR-001: 교차 추출', () => {
  const quote = '좌장 부인 해왕좌 배우 이몽란(李夢蘭, 24)';
  const pages = [pageOf(1, `• ${quote}`)];
  const base = rel('박영민', '이몽란', quote, 1);

  test('FR-CHR-001: 두 번째 추출에도 같은 (주체, 대상, 종류, 방향)이 있으면 confirmed', async () => {
    const [v] = await verify([base], pages, { secondRun: [{ ...base, label: '남편이다' }] });
    expect(v.check).toBe('confirmed');
    expect(v.runs_agreed).toBe(2);
    expect(v.reasons).toEqual([]);
  });

  test('FR-CHR-001: 한쪽 추출에만 있으면 needs_review', async () => {
    const [v] = await verify([base], pages, { secondRun: [] });
    expect(v.check).toBe('needs_review');
    expect(v.runs_agreed).toBe(1);
    expect(v.reasons).toContain('single_run');
  });

  test('FR-CHR-001: 방향이 다르면 같은 후보로 세지 않는다', async () => {
    const flipped = rel('박영민', '이몽란', quote, 1);
    (flipped.semantics as { direction: string }).direction = 'b_to_a';
    const [v] = await verify([base], pages, { secondRun: [flipped] });
    expect(v.check).toBe('needs_review');
  });

  test('FR-CHR-001: 호칭으로 적힌 같은 인물도 같은 후보로 센다', async () => {
    const aliased = rel('좌장', '이몽란', quote, 1);
    const [v] = await verify([base], pages, { secondRun: [aliased] });
    expect(v.check).toBe('confirmed');
  });
});

describe('NFR-AI-004: 반대 검토', () => {
  const quote = '좌장 부인 해왕좌 배우 이몽란(李夢蘭, 24)';
  const pages = [pageOf(1, `• ${quote}`)];
  const base = rel('박영민', '이몽란', quote, 1);

  test('NFR-AI-004: supports=false면 verifier_rejected로 보류', async () => {
    const [v] = await verify([base], pages, {
      secondRun: [base],
      verifier: async () => ({ supports: false, why: '방향이 반대' }),
    });
    expect(v.check).toBe('held');
    expect(v.reasons).toContain('verifier_rejected');
    expect(v.verifier_why).toBe('방향이 반대');
  });

  test('NFR-AI-004: supports=true면 그대로 통과한다', async () => {
    const [v] = await verify([base], pages, { secondRun: [base] });
    expect(v.check).toBe('confirmed');
  });

  test('NFR-AI-004: 기계 검증에서 이미 보류된 후보는 모델을 부르지 않는다', async () => {
    const verifier = jest.fn(supportive);
    await verify([rel('나용귀', '이몽란', quote, 1)], pages, { verifier });
    expect(verifier).not.toHaveBeenCalled();
  });

  test('NFR-AI-004: 검토 호출이 실패하면 보류가 아니라 needs_review(verifier_error)로 남긴다', async () => {
    const [v] = await verify([base], pages, {
      secondRun: [base],
      verifier: async () => {
        throw new Error('boom');
      },
    });
    expect(v.check).toBe('needs_review');
    expect(v.reasons).toContain('verifier_error');
  });

  test('NFR-AI-004: 검토 호출에는 두 인물에게 한 인물로만 묶인 등록 호칭이 함께 간다', async () => {
    const calls: Parameters<
      NonNullable<Parameters<typeof verifyRelationships>[3]>['verifier'] & object
    >[0][] = [];
    const q = '내가 좌장을 죽인 범인이오.';
    await verify([rel('나용귀', '박영민', q, 1)], [pageOf(1, `나용귀는 소리쳤다. ${q}`)], {
      verifier: async (input) => {
        calls.push(input);
        return { supports: true, why: '' };
      },
    });
    expect(calls[0].fromAliases).not.toContain('해왕좌 배우');
    expect(calls[0].toAliases).toEqual(expect.arrayContaining(['좌장']));
    expect(calls[0].toAliases).not.toContain('해왕좌 배우');
    expect(buildVerifierPrompt(calls[0])).toContain('좌장');
  });

  test('NFR-AI-004: 검토 프롬프트는 인용·관계·방향만 묻고 {supports, why} JSON을 요구한다', () => {
    const prompt = buildVerifierPrompt({
      from: '박영민',
      to: '이몽란',
      label: '남편이다',
      direction: 'a_to_b',
      quote,
      context: '배역 소개',
      fromAliases: [],
      toAliases: [],
    });
    expect(prompt).toContain('박영민');
    expect(prompt).toContain('이몽란');
    expect(prompt).toContain(quote);
    expect(prompt).toContain('"supports"');
    expect(prompt).toContain('주체: 박영민');
    expect(prompt).toContain('대상: 이몽란');
  });
});
