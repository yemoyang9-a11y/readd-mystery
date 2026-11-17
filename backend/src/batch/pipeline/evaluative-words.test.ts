/**
 * 해석·평가어 검사를 사건 밖으로 넓힌다 — 인물 노트·관계 설명·장 요약.
 * 생성 문장이 독자의 추리를 대신하지 않게 한다. 걸린 항목은 고치거나 조용히 버리지 않고
 * 사유 코드와 함께 검수 후보로 남긴다. (독자용 문장은 generate-full-verification.test.ts)
 */
import { Page } from '../../shared/types';
import { validateSceneEvents } from './event-scenes';
import { summaryReviewCandidates, validateGroundedChapter } from './grounding';
import { evaluativeWord } from './semantic-guards';

const pages: Page[] = [
  {
    id: 'p1',
    book_id: 'fixture',
    page_no: 1,
    content:
      '유불란은 소설가다. 유불란은 수상한 사내를 보았다. 박영민은 이몽란의 남편이다. 유불란은 "수상한 사람이군" 하고 말했다.',
  },
];
const BANNED = ['결정적', '단서', '수상한', '중요한', '알고 보니', '복선'];

const note = (text: string, quote = '유불란은 소설가다.') => ({
  note: text,
  source_page: 1,
  rationale: '서술된다.',
  evidence: { source_page: 1, quote },
});
const person = (notes: unknown[]) => ({
  name: '유불란',
  first_appearance_page: 1,
  entity_type: 'person',
  identity_status: 'distinct',
  rationale: '서술된다.',
  evidence: { source_page: 1, quote: '유불란은 소설가다.' },
  earlier_mentions: [],
  aliases: [],
  notes,
});
const REL_QUOTE = '박영민은 이몽란의 남편이다.';
const relationship = (label: string, summary: string) => ({
  character_a: '박영민',
  character_b: '이몽란',
  label,
  established_page: 1,
  assertion_status: 'fact',
  change_type: 'establishment',
  rationale: '남편이라고 서술한다.',
  evidence: { source_page: 1, quote: REL_QUOTE },
  semantics: {
    version: 2,
    direction: 'a_to_b',
    kind: 'family',
    relation_key: 'marriage',
    summary,
    assertion_status: 'fact',
    temporal_scope: 'ongoing',
    state: 'active',
    evidence: { source_page: 1, quote: REL_QUOTE },
  },
});

describe('해석·평가어 사전', () => {
  test.each(BANNED)('FR-DAT-008: 사건과 같은 목록 — "%s"를 찾아 돌려준다', (word) => {
    expect(evaluativeWord(`유불란이 ${word} 손수건을 주웠다`)).toBe(word);
  });

  test('FR-DAT-008: positive — 평가어가 없는 문장은 걸리지 않는다', () => {
    expect(evaluativeWord('유불란이 손수건을 주웠다')).toBeUndefined();
    expect(evaluativeWord('')).toBeUndefined();
  });
});

describe('FR-DAT-004: 인물 노트의 해석·평가어', () => {
  test.each(BANNED)('FR-DAT-004: 노트에 "%s"가 있으면 공개 0건, 검수 후보 1건', (word) => {
    const flagged = note(`유불란은 ${word} 인물이다.`);
    const out = validateGroundedChapter({ characters: [person([flagged])] }, pages);
    expect(out.characters).toHaveLength(1);
    expect(out.characters[0].notes).toHaveLength(0);
    expect(out.review).toEqual([
      { kind: 'note', reason: 'note_evaluative_word', candidate: flagged },
    ]);
  });

  test('FR-DAT-004: positive — 평가어 없는 노트는 그대로 통과하고 검수 후보가 없다', () => {
    const clean = note('유불란은 소설을 쓰는 사람이다.');
    const out = validateGroundedChapter({ characters: [person([clean])] }, pages);
    expect(out.characters[0].notes.map((n) => n.note)).toEqual(['유불란은 소설을 쓰는 사람이다.']);
    expect(out.review).toEqual([]);
  });

  test('FR-DAT-004: 걸린 노트만 검수로 가고 같은 인물의 다른 노트는 남는다 — 내용은 고치지 않는다', () => {
    const clean = note('유불란은 소설을 쓰는 사람이다.');
    const flagged = note('유불란은 사건의 단서를 쥔 사람이다.');
    const out = validateGroundedChapter({ characters: [person([clean, flagged])] }, pages);
    expect(out.characters[0].notes.map((n) => n.note)).toEqual(['유불란은 소설을 쓰는 사람이다.']);
    expect(out.review.map((r) => r.candidate)).toEqual([flagged]);
  });

  test('FR-DAT-004: 원문 인용(evidence)에만 평가어가 있으면 걸리지 않는다 — 검사 대상은 생성 문장', () => {
    const quoted = note('유불란은 낯선 사내를 보았다.', '유불란은 수상한 사내를 보았다.');
    const out = validateGroundedChapter({ characters: [person([quoted])] }, pages);
    expect(out.characters[0].notes).toHaveLength(1);
    expect(out.review).toEqual([]);
  });

  test('FR-DAT-004: 생성 문장 안에 따옴표로 옮긴 대사의 평가어도 사건 규칙과 똑같이 검수 후보', () => {
    const text = '유불란이 "수상한 사람이군" 하고 말했다';
    const event = validateSceneEvents(
      {
        events: [
          {
            agent: '유불란',
            action: text,
            mode: 'dialogue',
            realis: 'actual',
            flashback: false,
            evidence: [{ source_page: 1, quote: '유불란은 "수상한 사람이군" 하고 말했다.' }],
          },
        ],
      },
      pages,
      { scene_no: 1, start: 0, end: pages[0].content.length, start_page: 1, end_page: 1 }
    );
    expect(event.events).toHaveLength(0);
    expect(event.review.map((r) => r.reason)).toEqual(['event_evaluative_word']);

    const out = validateGroundedChapter({ characters: [person([note(`${text}.`)])] }, pages);
    expect(out.characters[0].notes).toHaveLength(0);
    expect(out.review.map((r) => r.reason)).toEqual(['note_evaluative_word']);
  });
});

describe('FR-DAT-005: 관계 설명의 해석·평가어', () => {
  const options = { requireRelationshipSemantics: true };

  test.each(BANNED)('FR-DAT-005: 요약에 "%s"가 있으면 공개 0건, 검수 후보 1건', (word) => {
    const flagged = relationship('남편이다', `박영민은 이몽란의 ${word} 남편이다.`);
    const out = validateGroundedChapter({ relationships: [flagged] }, pages, options);
    expect(out.relationships).toHaveLength(0);
    expect(out.review).toEqual([
      { kind: 'relationship', reason: 'relationship_evaluative_word', candidate: flagged },
    ]);
  });

  test('FR-DAT-005: 라벨에 평가어가 있어도 검수 후보', () => {
    const flagged = relationship('결정적 증인이다', '박영민은 이몽란의 남편이다.');
    const out = validateGroundedChapter({ relationships: [flagged] }, pages, options);
    expect(out.relationships).toHaveLength(0);
    expect(out.review.map((r) => r.reason)).toEqual(['relationship_evaluative_word']);
  });

  test('FR-DAT-005: positive — 평가어 없는 관계는 통과하고 검수 후보가 없다', () => {
    const out = validateGroundedChapter(
      { relationships: [relationship('남편이다', '박영민은 이몽란의 남편이다.')] },
      pages,
      options
    );
    expect(out.relationships.map((r) => r.label)).toEqual(['남편이다']);
    expect(out.review).toEqual([]);
  });
});

describe('FR-DAT-003: 장 요약의 해석·평가어', () => {
  test.each(BANNED)(
    'FR-DAT-003: 요약에 "%s"가 있으면 검수 후보 1건 — 요약은 고치지 않는다',
    (word) => {
      const summary = `유불란이 ${word} 손수건을 주웠다.`;
      expect(summaryReviewCandidates(3, summary)).toEqual([
        {
          kind: 'summary',
          reason: 'summary_evaluative_word',
          candidate: { chapter_no: 3, summary, matched: word },
        },
      ]);
    }
  );

  test('FR-DAT-003: positive — 평가어 없는 요약은 검수 후보 0건', () => {
    expect(summaryReviewCandidates(3, '유불란이 손수건을 주웠다.')).toEqual([]);
  });
});
