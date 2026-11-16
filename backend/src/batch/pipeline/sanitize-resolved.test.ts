import { checkIntegrity, ResolvedBookData } from './check-integrity';
import { sanitizeResolved } from './sanitize-resolved';

const TOTAL = 10;

function character(id: string, name: string, page = 1) {
  return { id, name, first_appearance_page: page, aliases: [], notes: [] };
}

function book(overrides: Partial<ResolvedBookData> = {}): ResolvedBookData {
  return {
    book_id: 'bk-x',
    chapter_summaries: [{ chapter_no: 1, title: '1', summary: 's' }],
    characters: [character('c1', '갑'), character('c2', '을')],
    relationships: [],
    terms: [{ id: 't1', term: '미두장', definition: 'd', first_appearance_page: 3 }],
    events: [],
    background_and_intro: { background: 'b', intro: 'i' },
    ...overrides,
  };
}

describe('sanitizeResolved', () => {
  test('FR-ADM-005: 페이지 0인 용어 하나는 등록에서 빠지고 held에 사유가 남는다, 정상 용어는 남는다', () => {
    const input = book({
      terms: [
        { id: 't1', term: '미두장', definition: 'd', first_appearance_page: 0 },
        { id: 't2', term: '탐정극', definition: 'd', first_appearance_page: 3 },
      ],
    });

    const { data, held } = sanitizeResolved(input, TOTAL);

    expect(data.terms.map((t) => t.term)).toEqual(['탐정극']);
    expect(held).toEqual([
      { target_type: 'term', label: '미두장', reasons: ['page_out_of_range: 0'] },
    ]);
    expect(checkIntegrity(input, TOTAL).ok).toBe(false);
    expect(checkIntegrity(data, TOTAL).ok).toBe(true);
  });

  test('FR-ADM-005: 총 쪽수 초과·비정수 페이지도 항목만 보류한다', () => {
    const { data, held } = sanitizeResolved(
      book({
        events: [
          { id: 'e1', event: '초과', description: 'd', occurrence_page: TOTAL + 1 },
          { id: 'e2', event: '소수', description: 'd', occurrence_page: 2.5 },
          { id: 'e3', event: '정상', description: 'd', occurrence_page: TOTAL },
        ],
      }),
      TOTAL
    );

    expect(data.events.map((e) => e.event)).toEqual(['정상']);
    expect(held.map((h) => h.label)).toEqual(['초과', '소수']);
  });

  test('FR-ADM-005: 중복 용어는 뒤의 것만 보류한다', () => {
    const { data, held } = sanitizeResolved(
      book({
        terms: [
          { id: 't1', term: '같다', definition: 'a', first_appearance_page: 1 },
          { id: 't2', term: '같다', definition: 'b', first_appearance_page: 2 },
        ],
      }),
      TOTAL
    );

    expect(data.terms.map((t) => t.id)).toEqual(['t1']);
    expect(held[0].reasons).toEqual(['duplicate_term']);
  });

  test('FR-ADM-005: 최초 등장 쪽이 잘못된 인물은 보류하고 그 인물의 관계도 함께 보류한다', () => {
    const { data, held } = sanitizeResolved(
      book({
        characters: [character('c1', '갑'), character('c2', '을', 99)],
        relationships: [
          {
            id: 'r1',
            character_a_id: 'c1',
            character_b_id: 'c2',
            label: '친구',
            established_page: 2,
          },
        ],
      }),
      TOTAL
    );

    expect(data.characters.map((c) => c.id)).toEqual(['c1']);
    expect(data.relationships).toEqual([]);
    expect(held.map((h) => [h.target_type, h.reasons[0]])).toEqual([
      ['character', 'page_out_of_range: 99'],
      ['relationship', 'endpoint_character_held'],
    ]);
  });

  test('FR-ADM-005: 별칭·노트의 잘못된 페이지는 그 항목만 보류한다', () => {
    const c = {
      ...character('c1', '갑'),
      aliases: [
        { alias: '좋은', type: 'name' as const, first_appearance_page: 1 },
        { alias: '나쁜', type: 'name' as const, first_appearance_page: 0 },
      ],
      notes: [{ id: 'n1', note: '메모', source_page: 0 }],
    };

    const { data, held } = sanitizeResolved(book({ characters: [c] }), TOTAL);

    expect(data.characters[0].aliases.map((a) => a.alias)).toEqual(['좋은']);
    expect(data.characters[0].notes).toEqual([]);
    expect(held.map((h) => h.target_type)).toEqual(['alias', 'character_note']);
  });

  test('FR-ADM-005: 모두 정상이면 held는 비어 있고 데이터가 그대로다', () => {
    const input = book();

    const { data, held } = sanitizeResolved(input, TOTAL);

    expect(held).toEqual([]);
    expect(data).toEqual(input);
  });
});
