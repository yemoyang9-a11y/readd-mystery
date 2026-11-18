/**
 * Fake 싸비 리포지토리 (테스트용)
 *
 * FR-SPL-002 🚦 게이트 테스트를 위한 fixture 기반 구현
 *
 * ⚠️ G1 제약: 모든 메서드가 cutoff 인자를 갖는다
 */

import type {
  Character,
  Relationship,
  Alias,
  CharacterNote,
  RelationshipGraph,
  CharacterDetail,
} from '../../../shared/types';
import type { SsabiRepository, Timeline, TimelineChapter, TimelineEvent } from '../repository';
import { latestRelationshipVersions, relationshipToEdge } from '../relationship-versions';

/**
 * Fixture 데이터
 */
export interface TimelineFixtureEvent extends TimelineEvent {
  book_id: string;
  original_description: string;
}

export interface SsabiFixture {
  /** completed·summary 는 조회 시 cutoff 로 정해지므로 장 픽스처에는 두지 않는다 */
  timelineChapters?: (Omit<TimelineChapter, 'completed' | 'summary' | 'key_point'> & {
    book_id: string;
  })[];
  timelineEvents?: TimelineFixtureEvent[];
  /** chapter_summaries 대역 — 장 요약 표는 장 표와 따로 있다 */
  timelineChapterSummaries?: {
    book_id: string;
    chapter_no: number;
    summary: string;
    key_point?: string | null;
  }[];
  characters: Character[];
  relationships: Relationship[];
  aliases: Alias[];
  characterNotes: CharacterNote[];
  backgroundKnowledge: string;
}

/**
 * Fake 싸비 리포지토리
 *
 * Fixture 데이터를 cutoff 기준으로 필터링
 */
export class FakeSsabiRepository implements SsabiRepository {
  constructor(private fixture: SsabiFixture) {}

  async findTimeline(bookId: string, cutoff: number): Promise<Timeline> {
    // FR-SPL-002 🚦: 장 시작 페이지 <= cutoff. 사건은 결정 31에 따라 다 읽은 장(end_page <= cutoff)만
    const bookChapters = (this.fixture.timelineChapters ?? []).filter((c) => c.book_id === bookId);
    const chapters = bookChapters
      .filter((c) => c.start_page <= cutoff)
      .sort((a, b) => a.chapter_no - b.chapter_no)
      .map(({ chapter_no, title, start_page, end_page }) => {
        // FR-SPL-002 🚦 FR-SPL-003 🚦 결정 31: 다 읽은 장일 때만 요약 표를 찾는다 (pg 의 JOIN 조건과 같다)
        const row =
          end_page <= cutoff
            ? (this.fixture.timelineChapterSummaries ?? []).find(
                (s) => s.book_id === bookId && s.chapter_no === chapter_no
              )
            : undefined;
        return {
          chapter_no,
          title,
          start_page,
          end_page,
          completed: end_page <= cutoff,
          summary: row?.summary ?? null,
          key_point: row?.key_point ?? null,
        };
      });
    const events = (this.fixture.timelineEvents ?? [])
      .filter(
        (e) =>
          e.book_id === bookId &&
          e.occurrence_page <= cutoff &&
          bookChapters.some(
            (c) =>
              c.start_page <= e.occurrence_page &&
              c.end_page >= e.occurrence_page &&
              c.end_page <= cutoff
          )
      )
      .sort((a, b) => a.occurrence_page - b.occurrence_page || a.id.localeCompare(b.id))
      .map(({ id, event, description, occurrence_page }) => ({
        id,
        event,
        description,
        occurrence_page,
      }));
    return { chapters, events };
  }

  async findCharacters(bookId: string, cutoff: number): Promise<Character[]> {
    // FR-SPL-002 🚦: 최초 등장 페이지 <= cutoff
    return this.fixture.characters.filter(
      (c) => c.book_id === bookId && c.first_appearance_page <= cutoff
    );
  }

  private boundedRelationships(bookId: string, cutoff: number): Relationship[] {
    const ids = new Set(
      this.fixture.characters
        .filter((c) => c.book_id === bookId && c.first_appearance_page <= cutoff)
        .map((c) => c.id)
    );
    return this.fixture.relationships.filter(
      (r) =>
        r.book_id === bookId &&
        r.established_page <= cutoff &&
        ids.has(r.character_a_id) &&
        ids.has(r.character_b_id) &&
        (!r.semantics ||
          (r.semantics.evidence.source_page <= r.established_page &&
            (!r.semantics.change_evidence ||
              r.semantics.change_evidence.source_page <= r.established_page)))
    );
  }

  async findLatestRelationships(bookId: string, cutoff: number): Promise<Relationship[]> {
    return latestRelationshipVersions(this.boundedRelationships(bookId, cutoff));
  }

  async findAliases(bookId: string, cutoff: number): Promise<Alias[]> {
    // FR-SPL-002 🚦: 최초 등장 페이지 <= cutoff
    // character의 book_id로 필터링
    const validCharacterIds = new Set(
      this.fixture.characters
        .filter((c) => c.book_id === bookId && c.first_appearance_page <= cutoff)
        .map((c) => c.id)
    );

    return this.fixture.aliases.filter(
      (a) => validCharacterIds.has(a.character_id) && a.first_appearance_page <= cutoff
    );
  }

  async findCharacterNotes(bookId: string, cutoff: number): Promise<CharacterNote[]> {
    // FR-SPL-002 🚦: 근거 페이지 <= cutoff
    // character의 book_id로 필터링
    const validCharacterIds = new Set(
      this.fixture.characters
        .filter((c) => c.book_id === bookId && c.first_appearance_page <= cutoff)
        .map((c) => c.id)
    );

    return this.fixture.characterNotes.filter(
      (n) => validCharacterIds.has(n.character_id) && n.source_page <= cutoff
    );
  }

  async getBackgroundKnowledge(_bookId: string, _cutoff: number): Promise<string> {
    // R5: 상한 없음 (FR-BGK-002 🚦)
    // cutoff를 받지만 사용하지 않음 (G1 제약 준수)
    return this.fixture.backgroundKnowledge;
  }

  async getCharacter(
    bookId: string,
    characterId: string,
    cutoff: number
  ): Promise<Character | null> {
    // FR-SPL-002 🚦: 최초 등장 페이지 <= cutoff
    const character = this.fixture.characters.find(
      (c) => c.id === characterId && c.book_id === bookId
    );

    if (!character || character.first_appearance_page > cutoff) {
      return null;
    }

    return character;
  }

  async getGraph(bookId: string, cutoff: number): Promise<RelationshipGraph> {
    // FR-SPL-002 🚦: 모든 구성 요소가 cutoff 적용
    const characters = await this.findCharacters(bookId, cutoff);
    const history = this.boundedRelationships(bookId, cutoff);
    const relationships = latestRelationshipVersions(history);
    const aliases = await this.findAliases(bookId, cutoff);

    // 별칭을 인물별로 그룹화
    const aliasMap = new Map<string, string[]>();
    for (const alias of aliases) {
      const existing = aliasMap.get(alias.character_id) || [];
      existing.push(alias.alias);
      aliasMap.set(alias.character_id, existing);
    }

    // GraphNode 생성
    const nodes = characters.map((c) => ({
      id: c.id,
      name: c.name,
      first_appearance_page: c.first_appearance_page,
      aliases: aliasMap.get(c.id) || [],
      alias_details: aliases
        .filter((a) => a.character_id === c.id)
        .map((a) => ({ alias: a.alias, first_appearance_page: a.first_appearance_page })),
    }));

    // GraphEdge 생성
    const edges = relationships.map(relationshipToEdge);
    return { nodes, edges, history: history.map(relationshipToEdge), applied_cutoff: cutoff };
  }

  async getCharacterDetail(
    bookId: string,
    characterId: string,
    cutoff: number
  ): Promise<CharacterDetail | null> {
    // FR-SPL-002 🚦: 모든 구성 요소가 cutoff 적용
    const character = await this.getCharacter(bookId, characterId, cutoff);

    if (!character) {
      return null;
    }

    // 별칭 조회
    const allAliases = await this.findAliases(bookId, cutoff);
    const aliases = allAliases.filter((a) => a.character_id === characterId);

    // 노트 조회
    const allNotes = await this.findCharacterNotes(bookId, cutoff);
    const characterNotes = allNotes.filter((n) => n.character_id === characterId);

    // FR-CHR-001: 인물 노트 최대 8문장
    const notes = characterNotes
      .slice(0, 8)
      .map((n) => n.note)
      .join(' ');

    return {
      name: character.name,
      first_appearance_page: character.first_appearance_page,
      aliases,
      notes,
    };
  }
}

/**
 * 테스트용 fixture 생성 헬퍼
 */
export function createTestFixture(): SsabiFixture {
  // 「탁류」 기반 테스트 데이터
  // K=20: 초반 인물 2명 (정주사, 초봉)
  // K=130: 중반까지 인물 5명

  const characters: Character[] = [
    {
      id: 'char-1',
      book_id: 'takryu',
      name: '정주사',
      first_appearance_page: 5,
    },
    {
      id: 'char-2',
      book_id: 'takryu',
      name: '초봉',
      first_appearance_page: 15,
    },
    {
      id: 'char-3',
      book_id: 'takryu',
      name: '계봉',
      first_appearance_page: 80,
    },
    {
      id: 'char-4',
      book_id: 'takryu',
      name: '고태수',
      first_appearance_page: 100,
    },
    {
      id: 'char-5',
      book_id: 'takryu',
      name: '장형보',
      first_appearance_page: 150, // K=130 초과
    },
  ];

  const relationships: Relationship[] = [
    {
      id: 'rel-1',
      book_id: 'takryu',
      character_a_id: 'char-1',
      character_b_id: 'char-2',
      label: '부녀',
      established_page: 15,
    },
    // 관계 변화 (이력) - A6 테스트
    {
      id: 'rel-2',
      book_id: 'takryu',
      character_a_id: 'char-2',
      character_b_id: 'char-4',
      label: '낯선 사이',
      established_page: 100,
    },
    {
      id: 'rel-3',
      book_id: 'takryu',
      character_a_id: 'char-2',
      character_b_id: 'char-4',
      label: '연인',
      established_page: 120,
    },
    {
      id: 'rel-4',
      book_id: 'takryu',
      character_a_id: 'char-3',
      character_b_id: 'char-4',
      label: '동료',
      established_page: 105,
    },
    {
      id: 'rel-5',
      book_id: 'takryu',
      character_a_id: 'char-2',
      character_b_id: 'char-5',
      label: '친구',
      established_page: 160, // K=130 초과
    },
  ];

  const aliases: Alias[] = [
    {
      character_id: 'char-1',
      alias: '주사',
      type: 'title',
      first_appearance_page: 5,
    },
    {
      character_id: 'char-2',
      alias: '봉이',
      type: 'nickname',
      first_appearance_page: 20,
    },
    {
      character_id: 'char-5',
      alias: '형보',
      type: 'name',
      first_appearance_page: 150, // K=130 초과
    },
  ];

  const characterNotes: CharacterNote[] = [
    {
      id: 'note-1',
      character_id: 'char-1',
      note: '고무신 장사로 돈을 모았다.',
      source_page: 10,
    },
    {
      id: 'note-2',
      character_id: 'char-2',
      note: '정주사의 딸이다.',
      source_page: 15,
    },
    {
      id: 'note-3',
      character_id: 'char-2',
      note: '미인으로 소문났다.',
      source_page: 25, // K=20 초과
    },
  ];

  const backgroundKnowledge = `
일제강점기 군산 배경. 탁류(濁流)는 흐리고 혼탁한 물줄기를 의미한다.
채만식의 대표작으로 1937-1938년 연재되었다.
  `.trim();

  const timelineChapters = [
    { book_id: 'takryu', chapter_no: 1, title: '1장', start_page: 1, end_page: 9 },
    { book_id: 'takryu', chapter_no: 2, title: '2장', start_page: 10, end_page: 25 },
    { book_id: 'takryu', chapter_no: 3, title: '3장', start_page: 26, end_page: 40 },
  ];

  const timelineEvents: TimelineFixtureEvent[] = [4, 9, 12, 24, 30, 38].map((page) => ({
    id: `event-${page}`,
    book_id: 'takryu',
    event: `${page}쪽 사건`,
    description: `${page}쪽 독자용 문장`,
    original_description: `ORIGINAL ${page}쪽 원문 설명`,
    occurrence_page: page,
  }));

  // 3장 요약은 일부러 없다 — 다 읽은 장이라도 요약이 없으면 null 이어야 한다
  const timelineChapterSummaries = [
    { book_id: 'takryu', chapter_no: 1, summary: '1장 요약', key_point: '1장 핵심 한 줄' },
    { book_id: 'takryu', chapter_no: 2, summary: '2장 요약', key_point: '2장 핵심 한 줄' },
    {
      book_id: 'other-book',
      chapter_no: 1,
      summary: '다른 책 요약',
      key_point: '다른 책 핵심 한 줄',
    },
  ];

  return {
    timelineChapters,
    timelineEvents,
    timelineChapterSummaries,
    characters,
    relationships,
    aliases,
    characterNotes,
    backgroundKnowledge,
  };
}
