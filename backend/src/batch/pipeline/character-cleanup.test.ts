import { createEmptyState, mergeCharacters, resolveCharacterId } from './accumulate';
import { validateGroundedChapter } from './grounding';
import { aliasReviewReason, characterNameReviewReason } from './semantic-guards';
import { Page } from '../../shared/types';

const PIPELINE = {
  requireRelationshipSemantics: true,
  deferRelationshipEndpoints: true,
  requireStoryPresence: true,
};

const page = (page_no: number, content: string): Page => ({
  id: `p${page_no}`,
  book_id: 'b',
  page_no,
  content,
});

const character = (name: string, quote: string, patch: Record<string, unknown> = {}) => ({
  name,
  first_appearance_page: 1,
  entity_type: 'person',
  identity_status: 'distinct',
  story_presence: 'in_story',
  rationale: '행동과 대사가 서술된다.',
  evidence: { source_page: 1, quote },
  earlier_mentions: [],
  aliases: [],
  notes: [],
  ...patch,
});

describe('FR-CHR-001: 이야기 속 인물만 등록한다', () => {
  const text =
    '박병국은 문을 열었다. 에도가와 란포의 소설에서는 탐정이 늘 이긴다고 유불란이 말했다.';
  const pages = [page(1, text)];

  test('FR-CHR-001: 이야기 밖에서 언급만 된 이름(mentioned_only)은 보류한다', () => {
    const out = validateGroundedChapter(
      {
        characters: [
          character('박병국', '박병국은 문을 열었다.'),
          character('에도가와 란포', '에도가와 란포의 소설에서는', {
            story_presence: 'mentioned_only',
          }),
        ],
      },
      pages,
      PIPELINE
    );
    expect(out.characters.map((c) => c.name)).toEqual(['박병국']);
    expect(out.review.map((r) => r.reason)).toEqual([expect.stringContaining('mentioned_only')]);
  });

  test('FR-CHR-001: story_presence를 밝히지 않은 인물도 등록하지 않는다', () => {
    const missing = character('박병국', '박병국은 문을 열었다.');
    delete (missing as Record<string, unknown>).story_presence;
    const out = validateGroundedChapter({ characters: [missing] }, pages, PIPELINE);
    expect(out.characters).toHaveLength(0);
    expect(out.review[0].reason).toContain('story_presence_required');
  });

  test('FR-CHR-001: 파이프라인 옵션이 없으면 기존 동작이 그대로다', () => {
    const missing = character('박병국', '박병국은 문을 열었다.');
    delete (missing as Record<string, unknown>).story_presence;
    const out = validateGroundedChapter({ characters: [missing] }, pages);
    expect(out.characters).toHaveLength(1);
  });
});

describe('FR-CHR-001: 직책어·조각·한 글자 이름은 인물 이름이 아니다', () => {
  test.each([
    '보이',
    '운전수',
    '경관',
    '간수',
    '전옥',
    '경찰의',
    '검은 안경을 낀 괴상한 신사',
    '홍',
    '양',
    '박 군',
  ])('FR-CHR-001: "%s"는 이름 검사에서 걸린다', (name) => {
    expect(characterNameReviewReason(name)).toBeDefined();
  });

  test.each(['박병국', '김 순사', '에드거 앨런 포', '나용귀', '아르센 뤼팽'])(
    'FR-CHR-001: "%s"는 이름 검사를 통과한다',
    (name) => {
      expect(characterNameReviewReason(name)).toBeUndefined();
    }
  );

  test('FR-CHR-001: 이름 검사에 걸린 인물은 등록되지 않고 검수 항목에 남는다', () => {
    const pages = [page(1, '운전수는 차를 몰았다. 박병국은 문을 열었다.')];
    const out = validateGroundedChapter(
      {
        characters: [
          character('운전수', '운전수는 차를 몰았다.'),
          character('박병국', '박병국은 문을 열었다.'),
        ],
      },
      pages,
      PIPELINE
    );
    expect(out.characters.map((c) => c.name)).toEqual(['박병국']);
    expect(out.review).toHaveLength(1);
    expect(out.review[0].reason).toContain('role_word_not_a_name');
  });
});

describe('FR-CHR-001: 별칭은 한 글자·조각이면 받지 않는다', () => {
  test.each([
    ['유불란', '군', 'nickname', '유불란 군은 웃었다.'],
    ['아르센 뤼팽', '의도(義盜)', 'title', '의도(義盜) 아르센 뤼팽'],
    ['박영민', '홍', 'nickname', '박영민 홍 씨'],
    ['운전수', '소생', 'nickname', '소생은 운전수올시다.'],
  ])('FR-CHR-001: %s의 별칭 "%s"는 보류한다', (name, alias, type, quote) => {
    expect(aliasReviewReason(name, alias, type, quote)).toBeDefined();
  });

  test.each([
    ['박영민', '좌장', 'title', '박영민은 해왕좌의 좌장이다.'],
    ['이몽란', '몽란', 'nickname', '이몽란 즉 몽란은 배우다.'],
  ])('FR-CHR-001: %s의 별칭 "%s"는 통과한다', (name, alias, type, quote) => {
    expect(aliasReviewReason(name, alias, type, quote)).toBeUndefined();
  });
});

describe('FR-CHR-001: 철자 변형 합치기', () => {
  const entry = (name: string, page: number, patch: Record<string, unknown> = {}) => ({
    name,
    first_appearance_page: page,
    identity_status: 'distinct' as const,
    evidence: { source_page: page, quote: `${name}가 나왔다.`, start_char: 0, end_char: 5 },
    aliases: [],
    notes: [],
    ...patch,
  });

  test('FR-CHR-001: 아케치와 아께지는 한 인물로 묶고 합친 기록을 남긴다', () => {
    const state = createEmptyState('b');
    mergeCharacters(state, [entry('아케치', 31)]);
    mergeCharacters(state, [entry('아께지', 33)]);
    expect(state.characters).toHaveLength(1);
    expect(state.characters[0].aliases.map((a) => a.alias)).toContain('아께지');
    expect(state.merges).toEqual([
      expect.objectContaining({
        name: '아께지',
        merged_into: '아케치',
        reason: 'spelling_variant',
      }),
    ]);
    expect(resolveCharacterId(state, '아께지', 33)).toBe(state.characters[0].id);
  });

  test('FR-CHR-001: 모음이 다른 이름은 합치지 않는다', () => {
    const state = createEmptyState('b');
    mergeCharacters(state, [entry('박영민', 1)]);
    mergeCharacters(state, [entry('백영민', 2)]);
    expect(state.characters).toHaveLength(2);
    expect(state.merges).toEqual([]);
  });

  test('FR-CHR-001: 두 글자 이름은 자음만 달라도 합치지 않는다', () => {
    const state = createEmptyState('b');
    mergeCharacters(state, [entry('고기', 1)]);
    mergeCharacters(state, [entry('코키', 2)]);
    expect(state.characters).toHaveLength(2);
  });
});
