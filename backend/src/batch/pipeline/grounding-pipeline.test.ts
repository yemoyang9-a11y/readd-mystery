import { validateGroundedChapter } from './grounding';
import { Page } from '../../shared/types';

const PIPELINE = {
  requireRelationshipSemantics: true,
  deferRelationshipEndpoints: true,
  requireStoryPresence: true,
};

const content = '유불란은 혼잣말을 했다. “나는 몽란을 사랑한다.” 그리고 고개를 들었다.';
const pages: Page[] = [{ id: 'p1', book_id: 'b', page_no: 1, content }];

const relationship = (quote: string) => ({
  character_a: '유불란',
  character_b: '이몽란',
  label: '사랑한다',
  established_page: 1,
  assertion_status: 'fact',
  change_type: 'establishment',
  rationale: '화자가 몽란을 사랑한다고 말한다.',
  evidence: { source_page: 1, quote },
  semantics: {
    version: 2,
    direction: 'a_to_b',
    kind: 'emotion',
    relation_key: 'affection',
    summary: '유불란은 이몽란을 사랑한다.',
    assertion_status: 'fact',
    temporal_scope: 'ongoing',
    state: 'active',
    evidence: { source_page: 1, quote },
  },
});

describe('FR-CHR-001: 관계 인용 검증', () => {
  test('FR-CHR-001: 기본 모드는 인용 안에 두 이름이 모두 없으면 보류한다', () => {
    const out = validateGroundedChapter(
      { relationships: [relationship('나는 몽란을 사랑한다.')] },
      pages,
      { requireRelationshipSemantics: true }
    );
    expect(out.relationships).toHaveLength(0);
    expect(out.review).toHaveLength(1);
  });

  test('FR-CHR-001: 이름 판정을 미루는 모드에서도 원문에 없는 인용은 보류한다', () => {
    const out = validateGroundedChapter(
      { relationships: [relationship('나는 영희를 사랑한다.')] },
      pages,
      PIPELINE
    );
    expect(out.relationships).toHaveLength(0);
    expect(out.review).toHaveLength(1);
  });

  test('FR-CHR-001: 이름 판정을 미루는 모드는 이름이 없는 인용도 받아 다음 단계로 넘긴다', () => {
    const out = validateGroundedChapter(
      { relationships: [relationship('나는 몽란을 사랑한다.')] },
      pages,
      PIPELINE
    );
    expect(out.review).toEqual([]);
    expect(out.relationships).toHaveLength(1);
  });

  test('FR-CHR-001: 따옴표와 공백만 다른 인용은 원문 그대로의 문자열로 바꿔 받는다', () => {
    const out = validateGroundedChapter(
      { relationships: [relationship('"나는  몽란을 사랑한다."')] },
      pages,
      PIPELINE
    );
    expect(out.relationships[0].evidence.quote).toBe('나는 몽란을 사랑한다.');
    expect(
      content.slice(
        out.relationships[0].evidence.start_char,
        out.relationships[0].evidence.end_char
      )
    ).toBe(out.relationships[0].evidence.quote);
  });

  test('FR-CHR-001: 이름 판정을 미루는 모드는 확립 쪽과 인용 쪽이 달라도 받아 쪽 비교를 다음 단계에 맡긴다', () => {
    const two: Page[] = [pages[0], { id: 'p2', book_id: 'b', page_no: 2, content: '다른 쪽이다.' }];
    const shifted = { ...relationship('나는 몽란을 사랑한다.'), established_page: 2 };
    expect(
      validateGroundedChapter({ relationships: [shifted] }, two, PIPELINE).relationships
    ).toHaveLength(1);
    expect(
      validateGroundedChapter({ relationships: [shifted] }, two, {
        requireRelationshipSemantics: true,
      }).relationships
    ).toHaveLength(0);
  });
});
