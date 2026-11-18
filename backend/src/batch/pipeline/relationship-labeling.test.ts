/**
 * 근거 창 기반 관계 라벨 검증 — FR-CHR-001 🚦, FR-SPL-002 🚦(확립 페이지 = 스포일러 상한의 기준), R12
 *
 * 구현 전에 작성했다. LLM은 구조적 후보 쌍에만, 그 쌍의 근거 창 안의 정확한 낱말(trigger)로만
 * 라벨을 붙일 수 있다. 확립 페이지는 LLM이 말한 값이 아니라 검증을 통과한 가장 이른 근거 창의 쪽이다.
 * 실제 LLM 호출은 없다 — LLM 응답은 손으로 쓴 가짜다.
 */
import { Page } from '../../shared/types';
import { CandidateCharacter, generateInteractionCandidates } from './interaction-candidates';
import {
  buildPairLabelPrompt,
  finalizeStructuredRelationships,
  runStructuralChapter,
  uncoveredCharacters,
  verifyPairLabels,
} from './relationship-labeling';

const page = (page_no: number, content: string): Page => ({
  id: `p${page_no}`,
  book_id: 'fixture',
  page_no,
  content,
});
const ch = (id: string, name: string, first = 1): CandidateCharacter => ({
  id,
  name,
  first_appearance_page: first,
  aliases: [],
});
const lexicon = [
  ch('seoyun', '서윤'),
  ch('dohyun', '도현'),
  ch('min', '민'),
  ch('yuna', '윤아'),
  ch('su', '수'),
  ch('nara', 'Nara'),
  ch('eren', 'Eren'),
];

/** 가짜 LLM 응답 한 건 — 필드는 실제 프롬프트 계약과 같다 */
function label(
  a: string,
  b: string,
  support: { window_id: string; trigger: string }[],
  extra: Record<string, unknown> = {}
) {
  const relation_key = (extra.relation_key as string) ?? 'jealousy';
  return {
    character_a: a,
    character_b: b,
    direction: 'a_to_b',
    label: '질투한다',
    kind: 'emotion',
    relation_key,
    assertion_status: 'fact',
    temporal_scope: 'ongoing',
    state: 'active',
    change_type: 'establishment',
    summary: `${a}은(는) ${b}을(를) 질투한다.`,
    rationale: '근거 창의 서술',
    support,
    ...extra,
  };
}

function setup(pages: Page[]) {
  const candidates = generateInteractionCandidates(pages, lexicon);
  const windowOn = (pageNo: number, pairIds?: [string, string]) => {
    const c = candidates.find(
      (x) => !pairIds || [x.a_id, x.b_id].sort().join() === [...pairIds].sort().join()
    )!;
    return c.windows.find((w) => w.page_no === pageNo)!.id;
  };
  return { candidates, windowOn };
}

describe('FR-CHR-001: 구조적 근거가 없는 쌍에는 라벨을 붙일 수 없다', () => {
  test('FR-CHR-001: 함께 나온 적 없는 쌍의 라벨 → 0건 채택, no_structural_candidate', () => {
    const pages = [page(1, '서윤은 도현을 질투했다.'), page(2, '민은 산으로 갔다.')];
    const { candidates, windowOn } = setup(pages);
    const out = verifyPairLabels(
      { relations: [label('서윤', '민', [{ window_id: windowOn(1), trigger: '질투' }])] },
      candidates,
      pages,
      lexicon
    );
    expect(out.relationships).toHaveLength(0);
    expect(out.held.map((h) => h.reasons)).toEqual([['no_structural_candidate']]);
  });

  test('positive — 같은 문장에 함께 나온 쌍의 라벨은 채택된다', () => {
    const pages = [page(1, '서윤은 도현을 질투했다.')];
    const { candidates, windowOn } = setup(pages);
    const out = verifyPairLabels(
      { relations: [label('서윤', '도현', [{ window_id: windowOn(1), trigger: '질투' }])] },
      candidates,
      pages,
      lexicon
    );
    expect(out.held).toEqual([]);
    expect(out.relationships).toHaveLength(1);
    expect(out.relationships[0].character_a_id).toBe('seoyun');
    expect(out.relationships[0].relationship.established_page).toBe(1);
  });

  test('다른 쌍의 근거 창이나 창 밖 낱말을 근거로 댈 수 없다', () => {
    const pages = [page(1, '서윤은 도현을 질투했다. 민은 윤아를 믿었다.')];
    const { candidates, windowOn } = setup(pages);
    const otherPairWindow = windowOn(1, ['min', 'yuna']);
    const out = verifyPairLabels(
      {
        relations: [
          label('서윤', '도현', [{ window_id: otherPairWindow, trigger: '믿었' }]),
          label('서윤', '도현', [
            { window_id: windowOn(1, ['seoyun', 'dohyun']), trigger: '증오' },
          ]),
        ],
      },
      candidates,
      pages,
      lexicon
    );
    expect(out.relationships).toHaveLength(0);
    expect(out.held.map((h) => h.reasons)).toEqual([
      ['support_window_not_for_pair'],
      ['trigger_not_in_window'],
    ]);
  });
});

describe('FR-SPL-002: 확립 페이지 = 검증된 가장 이른 근거 창의 쪽 (LLM이 말한 쪽이 아니다)', () => {
  const pages = [
    page(3, '서윤은 항구에 왔다.'),
    page(5, '서윤은 도현을 질투했다.'),
    page(7, '서윤은 여전히 도현을 질투했다.'),
  ];

  test('FR-SPL-002: LLM이 근거보다 이른 쪽(3)을 말해도 확립 페이지가 3이 되는 관계 0건', () => {
    const { candidates, windowOn } = setup(pages);
    const out = verifyPairLabels(
      {
        relations: [
          label('서윤', '도현', [{ window_id: windowOn(5), trigger: '질투' }], {
            established_page: 3,
          }),
        ],
      },
      candidates,
      pages,
      lexicon
    );
    expect(out.relationships.filter((r) => r.relationship.established_page < 5)).toHaveLength(0);
    expect(out.relationships[0].relationship.established_page).toBe(5);
    expect(out.relationships[0].claimed_established_page).toBe(3);
    expect(out.relationships[0].notes).toContain('claimed_page_earlier_than_evidence');
  });

  test('positive — LLM이 말한 쪽이 근거 쪽과 같으면 그대로 5', () => {
    const { candidates, windowOn } = setup(pages);
    const out = verifyPairLabels(
      {
        relations: [
          label('서윤', '도현', [{ window_id: windowOn(5), trigger: '질투' }], {
            established_page: 5,
          }),
        ],
      },
      candidates,
      pages,
      lexicon
    );
    expect(out.relationships[0].relationship.established_page).toBe(5);
    expect(out.relationships[0].notes).not.toContain('claimed_page_earlier_than_evidence');
    expect(out.relationships[0].relationship.evidence).toEqual({
      source_page: 5,
      quote: '서윤은 도현을 질투했다.',
      start_char: 0,
      end_char: pages[1].content.length,
    });
  });

  test('LLM이 더 늦은 쪽(7)을 말하면 그 쪽 이후의 검증된 근거로만 늦춘다', () => {
    const { candidates, windowOn } = setup(pages);
    const out = verifyPairLabels(
      {
        relations: [
          label(
            '서윤',
            '도현',
            [
              { window_id: windowOn(5), trigger: '질투' },
              { window_id: windowOn(7), trigger: '질투' },
            ],
            { established_page: 7 }
          ),
        ],
      },
      candidates,
      pages,
      lexicon
    );
    expect(out.relationships[0].relationship.established_page).toBe(7);
    expect(out.relationships[0].relationship.evidence.source_page).toBe(7);
  });

  test('같은 창에 trigger가 두 번 나오고 하나가 부정이면 보류한다(보수적)', () => {
    const p = [page(5, '서윤은 도현을 질투하지 않는다고 했지만 결국 질투했다.')];
    const { candidates, windowOn } = setup(p);
    const out = verifyPairLabels(
      { relations: [label('서윤', '도현', [{ window_id: windowOn(5), trigger: '질투' }])] },
      candidates,
      p,
      lexicon
    );
    expect(out.relationships).toHaveLength(0);
  });

  test('근거가 여럿이면 검증을 통과한 것 중 가장 이른 쪽 — 실패한 이른 근거로 앞당기지 않는다', () => {
    const negatedEarly = [
      page(5, '서윤은 도현을 질투하지 않았다.'),
      page(7, '서윤은 마침내 도현을 질투했다.'),
    ];
    const { candidates, windowOn } = setup(negatedEarly);
    const out = verifyPairLabels(
      {
        relations: [
          label('서윤', '도현', [
            { window_id: windowOn(5), trigger: '질투' },
            { window_id: windowOn(7), trigger: '질투' },
          ]),
        ],
      },
      candidates,
      negatedEarly,
      lexicon
    );
    expect(out.relationships).toHaveLength(1);
    expect(out.relationships[0].relationship.established_page).toBe(7);
    expect(out.relationships[0].rejected_support).toEqual([
      { window_id: windowOn(5), reason: 'factuality_cue:negation' },
    ]);
  });

  test('FR-SPL-002: 두 번의 추출이 다른 쪽을 대면 늦은 쪽(7)을 쓴다 — 확립 페이지 5인 관계 0건', async () => {
    const { candidates, windowOn } = setup(pages);
    const run1 = verifyPairLabels(
      { relations: [label('서윤', '도현', [{ window_id: windowOn(5), trigger: '질투' }])] },
      candidates,
      pages,
      lexicon
    );
    const run2 = verifyPairLabels(
      { relations: [label('서윤', '도현', [{ window_id: windowOn(7), trigger: '질투' }])] },
      candidates,
      pages,
      lexicon
    );
    const out = await finalizeStructuredRelationships(run1, run2, pages, lexicon);
    expect(out.accepted.filter((r) => r.relationship.established_page === 5)).toHaveLength(0);
    expect(out.accepted).toHaveLength(1);
    expect(out.accepted[0].relationship.established_page).toBe(7);
    expect(out.accepted[0].relationship.evidence.source_page).toBe(7);
    expect(out.accepted[0].check).toBe('confirmed');
    expect(out.accepted[0].runs_agreed).toBe(2);
  });

  test('positive — 두 번 모두 5를 대면 5로 확정', async () => {
    const { candidates, windowOn } = setup(pages);
    const make = () =>
      verifyPairLabels(
        { relations: [label('서윤', '도현', [{ window_id: windowOn(5), trigger: '질투' }])] },
        candidates,
        pages,
        lexicon
      );
    const out = await finalizeStructuredRelationships(make(), make(), pages, lexicon);
    expect(out.accepted.map((r) => [r.relationship.established_page, r.check])).toEqual([
      [5, 'confirmed'],
    ]);
  });

  test('두 번째 추출에 없는 관계는 needs_review(single_run)로 남는다', async () => {
    const { candidates, windowOn } = setup(pages);
    const run1 = verifyPairLabels(
      { relations: [label('서윤', '도현', [{ window_id: windowOn(5), trigger: '질투' }])] },
      candidates,
      pages,
      lexicon
    );
    const run2 = verifyPairLabels({ relations: [] }, candidates, pages, lexicon);
    const out = await finalizeStructuredRelationships(run1, run2, pages, lexicon);
    expect(out.accepted.map((r) => [r.check, r.reasons])).toEqual([
      ['needs_review', ['single_run']],
    ]);
  });
});

describe('FR-CHR-001: 근거 문장의 사실성·방향 단서 (사실로 단정한 라벨만 검사)', () => {
  const run = (
    text: string,
    l: ReturnType<typeof label> | ((w: string) => ReturnType<typeof label>)
  ) => {
    const pages = [page(2, text)];
    const candidates = generateInteractionCandidates(pages, lexicon);
    const windowId = candidates[0]?.windows[0]?.id ?? 'none';
    const item = typeof l === 'function' ? l(windowId) : l;
    return verifyPairLabels({ relations: [item] }, candidates, pages, lexicon);
  };

  test('부정 — "질투하지 않았다"를 사실 질투로 단정하면 보류, 긍정문은 채택', () => {
    const negated = run('민은 윤아를 질투하지 않았다.', (w) =>
      label('민', '윤아', [{ window_id: w, trigger: '질투' }])
    );
    expect(negated.relationships).toHaveLength(0);
    expect(negated.held[0].reasons).toEqual(['factuality_cue:negation']);
    const plain = run('민은 윤아를 질투했다.', (w) =>
      label('민', '윤아', [{ window_id: w, trigger: '질투' }])
    );
    expect(plain.relationships).toHaveLength(1);
  });

  test('반문 부정("미워한다니, 그럴 리 없었다")·전언("~한다는 말")·희망("~하고 싶다고")은 사실이 아니다', () => {
    const cases: [string, string, string, string][] = [
      ['가람이 혜온을 미워한다니, 그럴 리 없었다.', '가람', '혜온', '미워'],
      ['서윤이 도현과 연인이라는 소문이 돌았다.', '서윤', '도현', '연인'],
      ['민은 언젠가 윤아와 결혼하고 싶다고 말했다.', '민', '윤아', '결혼'],
      ['수는 민이 윤아를 미워한다고 믿었다.', '민', '윤아', '미워'],
    ];
    const lex = [...lexicon, ch('garam', '가람'), ch('heon', '혜온')];
    for (const [text, a, b, trigger] of cases) {
      const pages = [page(2, text)];
      const candidates = generateInteractionCandidates(pages, lex);
      const pair = candidates.find(
        (c) => [c.a_name, c.b_name].sort().join() === [a, b].sort().join()
      )!;
      const out = verifyPairLabels(
        { relations: [label(a, b, [{ window_id: pair.windows[0].id, trigger }])] },
        candidates,
        pages,
        lex
      );
      expect({ text, accepted: out.relationships.length }).toEqual({ text, accepted: 0 });
      expect(out.held[0].reasons.join()).toMatch(/^factuality_cue:/);
    }
  });

  test('trigger가 어미·부정까지 삼켜도("결혼하고", "미워한다니", "않았다") 단서를 놓치지 않는다', () => {
    const lex = [...lexicon, ch('garam', '가람'), ch('heon', '혜온')];
    const cases: [string, string, string, string][] = [
      ['민은 언젠가 윤아와 결혼하고 싶다고 말했다.', '민', '윤아', '결혼하고'],
      ['가람이 혜온을 미워한다니, 그럴 리 없었다.', '가람', '혜온', '미워한다니'],
      ['민은 윤아를 질투하지 않았다.', '민', '윤아', '않았다'],
      ['민은 언젠가 윤아와 결혼하고 싶다고 말했다.', '민', '윤아', '말했다'],
    ];
    for (const [text, a, b, trigger] of cases) {
      const pages = [page(2, text)];
      const candidates = generateInteractionCandidates(pages, lex);
      const pair = candidates.find(
        (c) => [c.a_name, c.b_name].sort().join() === [a, b].sort().join()
      )!;
      const out = verifyPairLabels(
        { relations: [label(a, b, [{ window_id: pair.windows[0].id, trigger }])] },
        candidates,
        pages,
        lex
      );
      expect({ text, trigger, accepted: out.relationships.length }).toEqual({
        text,
        trigger,
        accepted: 0,
      });
    }
  });

  test('이름 자체("서윤은")는 trigger가 될 수 없다', () => {
    const out = run('서윤은 도현을 질투했다.', (w) =>
      label('도현', '서윤', [{ window_id: w, trigger: '서윤은' }])
    );
    expect(out.relationships).toHaveLength(0);
    expect(out.held[0].reasons).toEqual(['trigger_is_name']);
  });

  test('positive — "윤아를 믿고 있었다"의 믿다는 사람을 목적어로 둔 신뢰라 출처 단서로 보지 않는다', () => {
    const out = run('민은 윤아를 믿고 있었다.', (w) =>
      label('민', '윤아', [{ window_id: w, trigger: '믿고' }], {
        relation_key: 'trust',
        label: '신뢰한다',
        summary: '민은 윤아를 신뢰한다.',
      })
    );
    expect(out.relationships).toHaveLength(1);
  });

  test('positive — "초봉이라는"처럼 이름 뒤 조사는 전언 어미로 보지 않는다', () => {
    const lex = [...lexicon, ch('chobong', '초봉이'), ch('hyungbo', '형보')];
    const pages = [page(9, '형보는 초봉이라는 처녀를 탐냈다.')];
    const candidates = generateInteractionCandidates(pages, lex);
    const out = verifyPairLabels(
      {
        relations: [
          label('형보', '초봉이', [{ window_id: candidates[0].windows[0].id, trigger: '탐냈다' }], {
            relation_key: 'possessive_desire',
          }),
        ],
      },
      candidates,
      pages,
      lex
    );
    expect(out.held).toEqual([]);
    expect(out.relationships).toHaveLength(1);
  });

  test('positive — 근거가 전언임을 라벨이 이미 밝히면(belief, attribution 수) 구조 검사는 막지 않는다', () => {
    const out = run('수는 민이 윤아를 미워한다고 믿었다.', (w) =>
      label('민', '윤아', [{ window_id: w, trigger: '미워' }], {
        assertion_status: 'belief',
        attribution: '수',
        summary: '수는 민이 윤아를 미워한다고 믿는다.',
      })
    );
    expect(out.held).toEqual([]);
    expect(out.relationships).toHaveLength(1);
  });

  test('바로 다음 문장이 거짓·오해라고 밝히면 사실 라벨은 보류', () => {
    const out = run('서윤은 도현을 미워했다. 그것은 모두의 오해였다.', (w) =>
      label('서윤', '도현', [{ window_id: w, trigger: '미워' }], { relation_key: 'hostility' })
    );
    expect(out.relationships).toHaveLength(0);
    expect(out.held[0].reasons).toEqual(['factuality_cue:refuted_next']);
  });

  test('방향 — "서윤은 도현을 질투했다"를 도현→서윤으로 붙이면 보류, 서윤→도현은 채택', () => {
    const reversed = run('서윤은 도현을 질투했다.', (w) =>
      label('도현', '서윤', [{ window_id: w, trigger: '질투' }])
    );
    expect(reversed.relationships).toHaveLength(0);
    expect(reversed.held[0].reasons).toEqual(['direction_conflict']);
    const right = run('서윤은 도현을 질투했다.', (w) =>
      label('서윤', '도현', [{ window_id: w, trigger: '질투' }])
    );
    expect(right.relationships).toHaveLength(1);
    const sameMeaning = run('서윤은 도현을 질투했다.', (w) =>
      label('도현', '서윤', [{ window_id: w, trigger: '질투' }], {
        direction: 'b_to_a',
        summary: '서윤은 도현을 질투한다.',
      })
    );
    expect(sameMeaning.relationships).toHaveLength(1);
  });

  test('방향 — 관형절 속 주어("도현이 받은")가 아니라 주제어("서윤은")를 주체로 본다', () => {
    const out = run('서윤은 도현이 받은 찬사를 못마땅해했다.', (w) =>
      label('서윤', '도현', [{ window_id: w, trigger: '못마땅' }], { relation_key: 'resentment' })
    );
    expect(out.relationships).toHaveLength(1);
  });

  test('영어 — 반대 방향·부정(far from) 보류, 바른 방향 채택', () => {
    const reversed = run('Nara envied Eren.', (w) =>
      label('Eren', 'Nara', [{ window_id: w, trigger: 'envied' }], { summary: 'Eren envies Nara.' })
    );
    expect(reversed.held[0].reasons).toEqual(['direction_conflict']);
    const right = run('Nara envied Eren.', (w) =>
      label('Nara', 'Eren', [{ window_id: w, trigger: 'envied' }], { summary: 'Nara envies Eren.' })
    );
    expect(right.relationships).toHaveLength(1);
    const negated = run('Nara was far from envying Eren.', (w) =>
      label('Nara', 'Eren', [{ window_id: w, trigger: 'envying' }], {
        summary: 'Nara envies Eren.',
      })
    );
    expect(negated.held[0].reasons).toEqual(['factuality_cue:negation']);
  });

  test('근거 낱말이 있는 문장에 두 인물이 모두 나와야 한다 — 이웃 문장만으로 욕망을 옮기지 않는다', () => {
    // 이웃 창(두 문장)만 있는 쌍 — 근거 낱말 '원했'이 있는 문장에는 도현이 없다
    const out = run('서윤은 항구의 소유권을 원했다. 도현은 배를 탔다.', (w) =>
      label('서윤', '도현', [{ window_id: w, trigger: '원했' }], { relation_key: 'desire' })
    );
    expect(out.relationships).toHaveLength(0);
    expect(out.held[0].reasons).toEqual(['trigger_sentence_lacks_endpoint']);
  });

  test('대화 창만 근거인 라벨은 화자 추정이 휴리스틱이라 needs_review로 남긴다', async () => {
    const pages = [page(4, '“서윤아, 넌 내 누나야.” 도현이 말했다.')];
    const candidates = generateInteractionCandidates(pages, lexicon);
    const dialogue = candidates[0].windows.find((w) => w.kind === 'dialogue')!;
    const item = label('서윤', '도현', [{ window_id: dialogue.id, trigger: '누나' }], {
      direction: 'undirected',
      kind: 'family',
      relation_key: 'siblings',
      label: '남매다',
      summary: '서윤과 도현은 남매다.',
    });
    const run1 = verifyPairLabels({ relations: [item] }, candidates, pages, lexicon);
    const run2 = verifyPairLabels({ relations: [item] }, candidates, pages, lexicon);
    expect(run1.relationships).toHaveLength(1);
    const out = await finalizeStructuredRelationships(run1, run2, pages, lexicon);
    expect(out.accepted.map((r) => [r.check, r.reasons])).toEqual([
      ['needs_review', ['dialogue_attribution_heuristic']],
    ]);
  });
});

describe('FR-CHR-001: 라벨 프롬프트는 근거 창만 담는다', () => {
  test('근거 창 밖 문장(한 사람만 나온 문장)은 프롬프트에 들어가지 않는다', () => {
    const pages = [page(1, '비밀은 따로 있었다. 범인은 운전수였다. 서윤은 도현을 질투했다.')];
    const candidates = generateInteractionCandidates(pages, lexicon);
    const prompt = buildPairLabelPrompt(
      { id: 'c1', book_id: 'fixture', chapter_no: 1, title: '첫 장', start_page: 1, end_page: 1 },
      candidates,
      lexicon
    );
    expect(prompt).toContain('서윤은 도현을 질투했다.');
    expect(prompt).toContain(candidates[0].windows[0].id);
    expect(prompt).not.toContain('범인은 운전수였다');
    expect(prompt).not.toContain('비밀은');
  });
});

describe('FR-CHR-001: 장 단위 실행 — 가짜 LLM, 실제 호출 0회', () => {
  const chapter = {
    id: 'c1',
    book_id: 'fixture',
    chapter_no: 1,
    title: '첫 장',
    start_page: 1,
    end_page: 2,
  };

  test('R9: 후보 쌍이 없으면 LLM을 부르지 않는다', async () => {
    const calls: string[] = [];
    const out = await runStructuralChapter(
      chapter,
      [page(1, '서윤은 항구에 갔다.'), page(2, '도현은 산에 갔다.')],
      lexicon,
      { label: async (p) => (calls.push(p), { relations: [] }) }
    );
    expect(calls).toHaveLength(0);
    expect(out.accepted).toEqual([]);
  });

  test('두 번 같은 라벨 → confirmed, 근거 없는 쌍을 지어낸 라벨 → held, 반대 검토자 거절 → held', async () => {
    const pages = [
      page(1, '서윤은 도현을 질투했다. 민은 윤아를 믿었다.'),
      page(2, '수는 집에 있었다.'),
    ];
    const candidates = generateInteractionCandidates(pages, lexicon);
    const w = (x: string, y: string) =>
      candidates.find((c) => [c.a_id, c.b_id].sort().join() === [x, y].sort().join())!.windows[0]
        .id;
    const response = {
      relations: [
        label('서윤', '도현', [{ window_id: w('seoyun', 'dohyun'), trigger: '질투' }]),
        label('민', '윤아', [{ window_id: w('min', 'yuna'), trigger: '믿었' }], {
          relation_key: 'trust',
          label: '신뢰한다',
          summary: '민은 윤아를 신뢰한다.',
        }),
        label('서윤', '수', [{ window_id: w('seoyun', 'dohyun'), trigger: '질투' }]),
      ],
    };
    const prompts: string[] = [];
    const out = await runStructuralChapter(chapter, pages, lexicon, {
      label: async (p) => (prompts.push(p), response),
      verifier: async (input) => ({ supports: input.from !== '민', why: '가짜 검토자' }),
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain('수는 집에 있었다');
    expect(out.accepted.map((r) => [r.relationship.character_a, r.check])).toEqual([
      ['서윤', 'confirmed'],
    ]);
    expect(out.held.map((h) => h.reasons)).toEqual([
      ['no_structural_candidate'],
      ['verifier_rejected'],
    ]);
  });
});

// 2026-11-18 대표 지시 — 관계도는 관계만 담는다. 한 번 일어난 행동은 사건(타임라인)이다
describe('FR-CHR-001: 한 번 일어난 행동은 관계로 라벨링하지 않는다', () => {
  test('kind=action 또는 temporal_scope=event 라벨 → 채택 0건, one_off_action', () => {
    const pages = [page(1, '서윤은 도현의 손을 잡았다.')];
    const { candidates, windowOn } = setup(pages);
    const support = [{ window_id: windowOn(1), trigger: '손을 잡았다' }];
    const out = verifyPairLabels(
      {
        relations: [
          label('서윤', '도현', support, {
            label: '손을 잡는다',
            kind: 'action',
            relation_key: 'physical_contact',
            temporal_scope: 'event',
          }),
          label('서윤', '도현', support, { label: '손을 잡는다', kind: 'action' }),
          label('서윤', '도현', support, { label: '손을 잡는다', temporal_scope: 'event' }),
        ],
      },
      candidates,
      pages,
      lexicon
    );
    expect(out.relationships).toHaveLength(0);
    expect(out.held.map((h) => h.reasons)).toEqual([
      ['one_off_action'],
      ['one_off_action'],
      ['one_off_action'],
    ]);
  });

  test('positive — 같은 쌍의 지속 관계(의심)는 채택된다', () => {
    const pages = [page(1, '서윤은 도현을 의심했다.')];
    const { candidates, windowOn } = setup(pages);
    const out = verifyPairLabels(
      {
        relations: [
          label('서윤', '도현', [{ window_id: windowOn(1), trigger: '의심' }], {
            label: '의심한다',
            relation_key: 'suspicion',
            summary: '서윤은(는) 도현을(를) 의심한다.',
          }),
        ],
      },
      candidates,
      pages,
      lexicon
    );
    expect(out.held).toEqual([]);
    expect(out.relationships).toHaveLength(1);
  });

  test('negative 쌍 — 절을 받는 의심("도현이 범인인지 의심했다")은 여전히 사실 관계로 단정하지 않는다', () => {
    const pages = [page(1, '서윤은 도현이 범인인지 의심했다.')];
    const { candidates, windowOn } = setup(pages);
    const out = verifyPairLabels(
      {
        relations: [
          label('서윤', '도현', [{ window_id: windowOn(1), trigger: '의심' }], {
            label: '의심한다',
            relation_key: 'suspicion',
            summary: '서윤은(는) 도현을(를) 의심한다.',
          }),
        ],
      },
      candidates,
      pages,
      lexicon
    );
    expect(out.relationships).toHaveLength(0);
    expect(out.held.map((h) => h.reasons)).toEqual([['factuality_cue:source']]);
  });

  test('라벨 프롬프트는 action·event를 관계 종류로 내놓지 않는다', () => {
    const pages = [page(1, '서윤은 도현을 의심했다.')];
    const { candidates } = setup(pages);
    const prompt = buildPairLabelPrompt(
      { chapter_no: 1, title: '첫 장', start_page: 1, end_page: 1 } as never,
      candidates,
      lexicon
    );
    expect(prompt).not.toMatch(/family\/social\/emotion\/action/);
    expect(prompt).not.toMatch(/ongoing\/event/);
  });
});

// 2026-11-18 대표 지시 — 백검사(21쪽 등장, 임경부와 함께 수사)가 관계 0건으로 관계도에서 빠졌다.
// 자주 함께 나오는데 관계가 하나도 없는 인물은 검수 목록에 올려 사람이 놓침을 알아채게 한다.
describe('FR-CHR-001: 자주 함께 나오는데 관계 0건인 인물은 검수 목록에 오른다', () => {
  const pages = [
    page(1, '서윤은 도현을 질투했다. 민은 서윤과 함께 수사했다. 민은 도현과 함께 수사했다.'),
    page(2, '민은 서윤을 보았다. 민은 도현을 보았다.'),
  ];
  const candidates = generateInteractionCandidates(pages, lexicon);

  test('관계 0건 인물(민) → 목록에 1건, 함께 나온 근거 창 수와 상대가 실린다', () => {
    const out = uncoveredCharacters(
      candidates,
      [{ character_a_id: 'seoyun', character_b_id: 'dohyun' }],
      2
    );
    expect(out.map((c) => c.character_id)).toEqual(['min']);
    expect(out[0].windows).toBeGreaterThanOrEqual(2);
    expect([...out[0].partners].sort()).toEqual(['도현', '서윤']);
  });

  test('positive 쌍 — 관계가 하나라도 있으면 목록 0건', () => {
    const out = uncoveredCharacters(
      candidates,
      [
        { character_a_id: 'seoyun', character_b_id: 'dohyun' },
        { character_a_id: 'min', character_b_id: 'seoyun' },
      ],
      2
    );
    expect(out).toEqual([]);
  });

  test('함께 나온 근거가 문턱보다 적은 인물은 올리지 않는다', () => {
    expect(uncoveredCharacters(candidates, [], 1000)).toEqual([]);
  });
});

describe('라벨 프롬프트 — 같은 일을 함께 맡은 동료·태도 관계 안내', () => {
  test('동료 관계(같은 사건을 함께 맡음)와 의심·적대 태도를 관계로 적으라고 안내한다', () => {
    const pages = [page(1, '서윤은 도현과 함께 이 사건을 처음부터 담당했다.')];
    const candidates = generateInteractionCandidates(pages, lexicon);
    const prompt = buildPairLabelPrompt(
      { chapter_no: 1, title: '첫 장', start_page: 1, end_page: 1 } as never,
      candidates,
      lexicon
    );
    expect(prompt).toMatch(/함께 맡/);
    expect(prompt).toMatch(/동료/);
    expect(prompt).toMatch(/의심/);
  });
});
