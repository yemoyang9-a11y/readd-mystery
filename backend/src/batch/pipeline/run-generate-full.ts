/**
 * S4 본실행 — 19장 × 생성 6종 전체를 게이트웨이로 호출한다.
 *
 * 장별로 결과를 data/generated/full/chapter-{N}.json에 즉시 저장한다 — 이미 저장된
 * 장은 재호출하지 않고 파일을 그대로 재생(replay)해 상태를 복원한다(재시작 시 이어서
 * 진행, LLM 재호출 비용 없음). 배경지식·소개는 책 전체 1회이므로 background.json 하나.
 *
 * DB 연결 없음 — RDS 준비 전까지는 JSON으로만 남기고, 준비되면 register류 함수로 적재.
 * 최종적으로 data/generated/full/all-resolved.json에 인물 id가 해소된 전체 결과를 합친다.
 *
 * 사용법: npx ts-node --transpile-only src/batch/pipeline/run-generate-full.ts
 *        [--book <bookId> --file <원문 경로> --title <제목> --author <저자>]
 *        [--scene-window <full|recent:N>] — 사건 추출 입력 창(T9). 기본 full. 환경 변수
 *        EVENT_SCENE_WINDOW 로도 준다. 장마다 창별 입력 글자 수를 [사건 입력] 로그로 남긴다
 *        다른 책의 산출물은 data/generated/<bookId>/full/ 에 따로 둔다 — run-args.ts 참조
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { call } from '../../modules/llm-gateway/gateway';
import { CLAUDE_CLI_CONFIG } from '../../modules/llm-gateway/claude-cli-provider';
import { splitBook } from './split';
import {
  buildSummaryPrompt,
  buildCharacterPrompt,
  buildBackgroundPrompt,
  buildTermPrompt,
  parseJsonResponse,
} from './generate';
import {
  ChapterEventRaw,
  ChapterEventResult,
  EVENT_EXTRACTION_VERSION,
  FULL_SCENE_WINDOW,
  SceneInputWindow,
  TimelineEvent,
  WINDOWED_SCENE_PROMPT_SOURCE,
  buildSceneBoundaryPrompt,
  buildSceneEventPrompt,
  chapterEventCallCount,
  evaluateChapterEvents,
  extractChapterEventsRaw,
  sceneInputComparison,
  sceneWindowLabel,
} from './event-scenes';
import { checkPageBounds } from './validate';
import {
  createEmptyState,
  knownCharacterNames,
  mergeCharacters,
  mergeRelationships,
  mergeTerms,
  GenerationState,
} from './accumulate';
import { Chapter, Page } from '../../shared/types';
import {
  GroundedCharacter,
  GroundedRelationship,
  GroundingOptions,
  ReviewCandidate,
  assertGroundingCache,
  groundingManifest,
  validateGroundedChapter,
  sealResolvedOutput,
  assertResolvedGrounding,
  sealChapterCache,
  summaryReviewCandidates,
} from './grounding';
import { evaluativeWord } from './semantic-guards';
import {
  SUMMARY_GROUNDING_VERSION,
  buildSummaryGroundingPrompt,
  requestSummaryGrounding,
  summaryGroundingCandidates,
} from './summary-grounding';
import {
  BookArgs,
  DEFAULT_BOOK_ID,
  bookArgsFromCli,
  parseBookArgs,
  parseSceneWindow,
  requireBookMeta,
} from './run-args';
import { ResolvedBookData } from './check-integrity';
import { STRUCTURAL_LABEL_VERSION, runStructuralChapter } from './relationship-labeling';
import {
  cachedLabeler,
  cachedVerifier,
  lexiconFromAccumulated,
  structuralContract,
} from './relationship-structural-calls';
import {
  ReaderTextInput,
  eventReaderInput,
  eventReaderKey,
  introducedNames,
  readerNameLexicon,
  relationshipReaderInput,
  relationshipReaderKey,
  rewriteReaderTexts,
} from './reader-text';

// 출력 상한은 reasoning 토큰을 포함한다 — 기본 4096이면 장 하나의 인물·별칭·노트 JSON이 잘린다(화분 1장 incomplete)
const GENERATE_MAX_TOKENS = 16000;

// 출력 형식 불이행(JSON 파싱 실패)이면 그 호출만 최대 2회 다시 부른다 — 재시도도 게이트웨이 경유라 [LLM Metrics]로 집계된다
const JSON_PARSE_RETRIES = 2;

// NFR-AI-012
const JSON_RETRY_REMINDER =
  '\n\n직전 응답은 JSON이 아니었다. 설명 문장 없이, 위에서 지정한 형식의 JSON 객체 하나만 출력하라. 첫 글자는 { 여야 한다.';

async function callJson<T>(
  task: string,
  prompt: string,
  chapterLabel: number | string
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const raw = await call(task, attempt === 1 ? prompt : prompt + JSON_RETRY_REMINDER, {
      maxTokens: GENERATE_MAX_TOKENS,
      attempt, // NFR-OBS-004 (측정)
    });
    try {
      return parseJsonResponse<T>(raw);
    } catch (err) {
      if (attempt > JSON_PARSE_RETRIES) throw err;
      console.warn(`[JSON 재시도] task=${task} 장=${chapterLabel} 시도=${attempt + 1}`);
    }
  }
}

/**
 * 장 캐시 계약에 넣는 생성기 — 2026-11-24 대표 지시로 등록 단계는 전부 Claude 구독(CLI)으로 간다.
 * 예전 캐시(API 모델로 만든 것)는 계약이 달라 낡은 캐시로 멈춘다. 다른 모델 결과가 섞이지 않게 하는 것이 목적이다.
 */
const GENERATOR = {
  provider: 'claude-cli',
  model: CLAUDE_CLI_CONFIG.model,
  effort: CLAUDE_CLI_CONFIG.effort ?? '',
};

/** 인자 없는 기본값(takryu) — 장 캐시를 읽는 export 함수의 기본 디렉터리 */
const DEFAULT_OUT_DIR = parseBookArgs([]).fullDir;
const EXTRACTION_CONTRACT = JSON.stringify({
  characterPrompt: buildCharacterPrompt.toString(),
  // 관계는 장 캐시에 없다 — 구조 방식 + Claude 구독(STRUCTURAL_CONTRACT, 2026-11-18)
  relationshipMethod: 'structural-claude-cli',
  generator: GENERATOR,
});

// FR-CHR-001 🚦
const PIPELINE_MODE: GroundingOptions = {
  requireRelationshipSemantics: true,
  deferRelationshipEndpoints: true,
  requireStoryPresence: true,
};
const DEFAULT_MODE: GroundingOptions = { requireRelationshipSemantics: true };

// FR-CHR-001 🚦 — 관계 추출 계약(관계 질문지·유형 표·Claude 구독 모델). 장 캐시와 따로 봉인한다
const STRUCTURAL_CONTRACT = structuralContract();

// FR-DAT-008 — 사건 추출 계약. 인물·관계 캐시(EXTRACTION_CONTRACT)와 따로 봉인해, 사건 규칙이
// 바뀌어도 인물·관계를 다시 부르지 않는다. 바뀌면 사건 캐시만 Stale로 멈춘다.
const EVENT_EXTRACTION_CONTRACT = JSON.stringify({
  version: EVENT_EXTRACTION_VERSION,
  sceneBoundaryPrompt: buildSceneBoundaryPrompt.toString(),
  sceneEventPrompt: buildSceneEventPrompt.toString(),
  generator: GENERATOR,
});

// FR-DAT-003 — 장 요약 근거 확인 계약. 장 캐시·사건 캐시와 따로 봉인해, 이 규칙이 바뀌어도
// 요약·인물·관계·사건을 다시 부르지 않는다. 바뀌면 근거 확인 캐시만 Stale로 멈춘다.
const SUMMARY_GROUNDING_CONTRACT = JSON.stringify({
  version: SUMMARY_GROUNDING_VERSION,
  prompt: buildSummaryGroundingPrompt.toString(),
  generator: GENERATOR,
});

/**
 * T9 — 입력 창이 full이 아니면 계약과 캐시 파일을 따로 둔다. full 계약 문자열은 그대로라
 * 이미 만든 사건 캐시는 낡지 않고, 창을 바꿔 실행해도 full 캐시를 덮어쓰지 않는다.
 */
function eventCache(
  chapterNo: number,
  outDir: string,
  window: SceneInputWindow
): { filePath: string; contract: string } {
  if (window.mode === 'full') {
    return {
      filePath: path.join(outDir, `chapter-${chapterNo}.events.json`),
      contract: EVENT_EXTRACTION_CONTRACT,
    };
  }
  return {
    filePath: path.join(outDir, `chapter-${chapterNo}.events.recent-${window.scenes}.json`),
    contract: JSON.stringify({
      base: EVENT_EXTRACTION_CONTRACT,
      window: sceneWindowLabel(window),
      windowedPrompt: WINDOWED_SCENE_PROMPT_SOURCE,
    }),
  };
}

type RawCharacter = GroundedCharacter;
type RawRelationship = GroundedRelationship;
interface RawTerm {
  term: string;
  definition: string;
  first_appearance_page: number;
}

interface ChapterOutput {
  grounding: ReturnType<typeof groundingManifest>;
  review: ReviewCandidate[];
  chapter_no: number;
  title: string;
  start_page: number;
  end_page: number;
  summary: string;
  characters: RawCharacter[];
  relationships: RawRelationship[];
  terms: RawTerm[];
  warnings: string[];
}

function chapterFilePath(chapterNo: number, outDir: string): string {
  return path.join(outDir, `chapter-${chapterNo}.json`);
}

/** 이 장을 실제 게이트웨이로 생성한다 — 캐시가 있으면 절대 여기까지 오지 않는다 */
async function generateChapter(
  chapter: Chapter,
  pages: Page[],
  known: string[],
  mode: GroundingOptions
): Promise<ChapterOutput> {
  const warnings: string[] = [];
  const bounds = { min: chapter.start_page, max: chapter.end_page };

  function record(label: string, reportedPages: unknown[]): void {
    const missing = reportedPages.filter((p) => typeof p !== 'number' || !Number.isFinite(p));
    if (missing.length > 0) {
      warnings.push(
        `${label}: 페이지 번호 누락/비정수 ${missing.length}건 (LLM이 값을 채우지 않음)`
      );
    }

    const numericPages = reportedPages.filter(
      (p): p is number => typeof p === 'number' && Number.isFinite(p)
    );
    const result = checkPageBounds(label, numericPages, bounds.min, bounds.max);
    if (!result.ok) {
      warnings.push(
        `${label}: 장 범위(${bounds.min}~${bounds.max}) 밖 페이지 → ${result.outOfBounds.join(', ')}`
      );
    }
  }

  const { summary } = await callJson<{ summary: string }>(
    'generate_summary',
    buildSummaryPrompt(chapter, pages),
    chapter.chapter_no
  );

  const { characters } = await callJson<{ characters: RawCharacter[] }>(
    'generate_character',
    buildCharacterPrompt(chapter, pages, known),
    chapter.chapter_no
  );
  const accepted = validateGroundedChapter({ characters }, pages, mode);
  record(
    '인물/별칭/노트',
    accepted.characters.flatMap((c) => [
      c.first_appearance_page,
      ...c.aliases.map((a) => a.first_appearance_page),
      ...c.notes.map((n) => n.source_page),
    ])
  );

  // 관계는 여기서 만들지 않는다 — 인물 병합 뒤 구조 방식으로(generateFullBook, 2026-11-18 대표 지시)

  const { terms } = await callJson<{ terms: RawTerm[] }>(
    'generate_term',
    buildTermPrompt(chapter, pages),
    chapter.chapter_no
  );
  record(
    '용어',
    terms.map((t) => t.first_appearance_page)
  );

  // 사건은 장면 단위로 따로 뽑는다 — loadOrGenerateChapterEvents (FR-DAT-008)

  return {
    grounding: groundingManifest(chapter, pages, known, EXTRACTION_CONTRACT),
    review: [],
    chapter_no: chapter.chapter_no,
    title: chapter.title,
    start_page: chapter.start_page,
    end_page: chapter.end_page,
    summary,
    characters,
    relationships: [],
    terms,
    warnings,
  };
}

/** 캐시된 장 결과가 있으면 재생하고, 없으면 새로 생성해 즉시 저장한다 */
export async function loadOrGenerateChapter(
  chapter: Chapter,
  pages: Page[],
  known: string[],
  previousRelationships: string[] = [],
  outDir: string = DEFAULT_OUT_DIR,
  mode: GroundingOptions = DEFAULT_MODE
): Promise<ChapterOutput> {
  const cacheContext = [...known, JSON.stringify(previousRelationships)];
  const filePath = chapterFilePath(chapter.chapter_no, outDir);
  if (fs.existsSync(filePath)) {
    console.log(`[재생] ${chapter.chapter_no}장 "${chapter.title}" — 기존 결과 재사용`);
    const cached = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ChapterOutput;
    assertGroundingCache(cached, chapter, pages, cacheContext, EXTRACTION_CONTRACT);
    return {
      ...cached,
      ...validateGroundedChapter(cached, pages, mode),
    };
  }

  console.log(
    `[생성] ${chapter.chapter_no}장 "${chapter.title}" (p.${chapter.start_page}~${chapter.end_page}) 게이트웨이 호출 중...`
  );
  const output = await generateChapter(chapter, pages, known, mode);
  const validated = {
    ...output,
    ...validateGroundedChapter(output, pages, mode),
  };
  // Keep original candidates in the chapter cache for review and repeat validation.
  const cached = sealChapterCache(
    { ...output, review: validated.review },
    chapter,
    pages,
    cacheContext,
    EXTRACTION_CONTRACT
  );
  fs.writeFileSync(filePath, JSON.stringify(cached, null, 2), 'utf-8');
  if (output.warnings.length > 0) {
    console.warn(`  [경고] ${chapter.chapter_no}장:`, output.warnings);
  }
  console.log(`  [저장] ${filePath}`);
  return { ...validated, grounding: cached.grounding };
}

/**
 * 사건(타임라인) — 장면 단위 추출. FR-DAT-008 · FR-SPL-002 🚦 · NFR-AI-004
 * 원본 LLM 응답(경계 + 장면별 응답)만 chapter-{N}.events.json에 봉인해 두고, 새 실행과 재생
 * 모두 evaluateChapterEvents로 같은 검증을 거친다. 재생 때는 LLM을 부르지 않는다.
 */
export async function loadOrGenerateChapterEvents(
  chapter: Chapter,
  pages: Page[],
  outDir: string = DEFAULT_OUT_DIR,
  window: SceneInputWindow = FULL_SCENE_WINDOW
): Promise<ChapterEventResult> {
  const { filePath, contract } = eventCache(chapter.chapter_no, outDir, window);
  let raw: ChapterEventRaw;
  if (fs.existsSync(filePath)) {
    console.log(`[재생] ${chapter.chapter_no}장 사건(장면 단위) — 기존 결과 재사용`);
    const cached = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ChapterEventRaw;
    assertGroundingCache(cached, chapter, pages, [], contract);
    raw = cached;
  } else {
    // 게이트웨이 경유만 — 4.3절. 배치 전용이라 런타임 호출 수(R9)와 무관하다
    raw = await extractChapterEventsRaw(
      chapter,
      pages,
      (prompt, task) =>
        // NFR-OBS-004 — 경계 호출과 장면별 추출의 작업 이름이 달라 비용 지표가 나뉜다
        callJson<unknown>(task, prompt, chapter.chapter_no),
      window
    );
    const sealed = sealChapterCache(
      { chapter_no: chapter.chapter_no, ...raw },
      chapter,
      pages,
      [],
      contract
    );
    fs.writeFileSync(filePath, JSON.stringify(sealed, null, 2), 'utf-8');
    console.log(
      `  [사건] ${chapter.chapter_no}장 장면 ${raw.scenes.length}개 · LLM 호출 ${chapterEventCallCount(raw.scenes.length)}회 → ${filePath}`
    );
  }
  const result = evaluateChapterEvents(pages, raw);
  console.log(
    `  [사건] ${chapter.chapter_no}장 저장 ${result.events.length}건 · 검수 후보 ${result.review.length}건`
  );
  // T9 — 창별 장면 추출 입력 글자 수(LLM 없이 계산). 재생 때도 남으므로 캐시만으로 비교할 수 있다
  console.log(
    `  [사건 입력] ${chapter.chapter_no}장 장면 ${result.scenes.length}개 · 창 ${sceneWindowLabel(window)} · 원문 입력 글자 수 ${JSON.stringify(sceneInputComparison(result.scenes))}`
  );
  if (result.warnings.length > 0) {
    console.warn(`  [사건 경고] ${chapter.chapter_no}장:`, result.warnings);
  }
  return result;
}

/**
 * 장 요약 문장별 근거 확인 — FR-DAT-003 🚦 · NFR-AI-004
 * 원본 LLM 응답만 chapter-{N}.summary-grounding.json에 봉인해 두고, 새 실행과 재생 모두
 * summaryGroundingCandidates로 같은 검증을 거친다. 재생 때는 LLM을 부르지 않는다.
 * 호출·파싱 실패는 잡지 않는다 — 실행이 멈추고 산출물이 만들어지지 않는다(FR-SPL-005 🚦).
 * 요약이 바뀌면(봉인에 요약을 넣는다) 캐시가 Stale로 멈춘다.
 */
export async function loadOrGenerateSummaryGrounding(
  chapter: Chapter,
  pages: Page[],
  summary: string,
  outDir: string = DEFAULT_OUT_DIR
): Promise<ReviewCandidate[]> {
  const filePath = path.join(outDir, `chapter-${chapter.chapter_no}.summary-grounding.json`);
  let response: unknown;
  if (fs.existsSync(filePath)) {
    console.log(`[재생] ${chapter.chapter_no}장 요약 근거 확인 — 기존 결과 재사용`);
    const cached = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { response: unknown };
    assertGroundingCache(cached, chapter, pages, [summary], SUMMARY_GROUNDING_CONTRACT);
    response = cached.response;
  } else {
    // 게이트웨이 경유만 — 4.3절. 배치 전용이라 런타임 호출 수(R9)와 무관하다
    response = await requestSummaryGrounding(chapter, pages, summary, (prompt, task) =>
      callJson<unknown>(task, prompt, chapter.chapter_no)
    );
    const sealed = sealChapterCache(
      { chapter_no: chapter.chapter_no, response },
      chapter,
      pages,
      [summary],
      SUMMARY_GROUNDING_CONTRACT
    );
    fs.writeFileSync(filePath, JSON.stringify(sealed, null, 2), 'utf-8');
  }
  const candidates = summaryGroundingCandidates(chapter.chapter_no, summary, pages, response);
  const count = candidates.flatMap(
    (c) => (c.candidate as { sentences: unknown[] }).sentences
  ).length;
  console.log(
    `  [요약 근거] ${chapter.chapter_no}장 근거 미확인 문장 ${count}개${candidates.length > 0 ? ' — 검수 후보' : ''}`
  );
  return candidates;
}

async function loadOrGenerateBackground(
  outDir: string,
  title: string,
  author: string,
  openingPages: Page[]
): Promise<{ background: string; intro: string }> {
  const filePath = path.join(outDir, 'background.json');
  if (fs.existsSync(filePath)) {
    console.log('[재생] 배경지식·소개 — 기존 결과 재사용');
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  console.log('[생성] 배경지식·소개 게이트웨이 호출 중...');
  const out = await callJson<{ background: string; intro: string }>(
    'generate_background',
    buildBackgroundPrompt(title, author, openingPages),
    '배경'
  );
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf-8');
  return out;
}

/** Existing manual removals/merges must never disappear under an automatic replay. */
export function persistResolvedOutput(
  filePath: string,
  data: Record<string, unknown>,
  pages: Page[]
): void {
  const sealed = sealResolvedOutput(data, pages);
  if (fs.existsSync(filePath)) {
    const previous = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    try {
      assertResolvedGrounding(previous, pages);
      const oldManifest = previous.grounding as { content_hash: string };
      if (oldManifest.content_hash === sealed.grounding.content_hash) return;
    } catch {
      // Preserve legacy/manual artifacts too; the candidate is reviewable separately.
    }
    fs.writeFileSync(`${filePath}.candidate.json`, JSON.stringify(sealed, null, 2), 'utf-8');
    throw new Error(
      `Existing resolved artifact preserved at ${filePath}; review ${filePath}.candidate.json and migrate corrections explicitly`
    );
  }
  fs.writeFileSync(filePath, JSON.stringify(sealed, null, 2), 'utf-8');
}

// R9
async function applyReaderTexts(
  state: GenerationState,
  events: { id: string; description: string; reader_description?: string }[],
  outDir: string
): Promise<void> {
  const names = new Map(state.characters.map((c) => [c.id, c.name]));
  const lexicon = readerNameLexicon(state.characters);
  const items: ReaderTextInput[] = [
    ...state.relationships.flatMap((r) => {
      const item =
        r.semantics &&
        relationshipReaderInput(
          r.id,
          r.semantics.summary,
          names.get(r.character_a_id),
          names.get(r.character_b_id)
        );
      return item ? [item] : [];
    }),
    ...events.map((e) => eventReaderInput(e.id, e.description)),
  ];

  const cachePath = path.join(outDir, 'reader-text.json');
  const cache: Record<string, { source: string; text: string }> = fs.existsSync(cachePath)
    ? JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
    : {};
  const missing = items.filter((item) => cache[item.key]?.source !== item.text);
  for (const [key, text] of await rewriteReaderTexts(missing)) {
    cache[key] = { source: items.find((item) => item.key === key)!.text, text };
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');

  // NFR-AI-004 — 쉬운 문장이 원래 문장에 없던 고유명사(인물명 등)를 들여오면 쓰지 않고 검수로
  const readerText = (
    kind: 'relationship' | 'event',
    id: string,
    key: string,
    source: string
  ): string | undefined => {
    if (cache[key]?.source !== source) return undefined;
    const text = cache[key].text;
    const added = introducedNames(source, text, lexicon);
    if (added.length > 0) {
      state.review.push({
        kind,
        reason: 'reader_text_new_proper_noun',
        candidate: { id, source, reader_text: text, introduced_names: added },
      });
      return undefined;
    }
    // R9 — 쉬운 문장에 해석·평가어가 생기면 쓰지 않고 검수로 (원래 문장은 그대로 남는다)
    const matched = evaluativeWord(text);
    if (matched) {
      state.review.push({
        kind,
        reason: 'reader_text_evaluative_word',
        candidate: { id, source, reader_text: text, matched },
      });
      return undefined;
    }
    return text;
  };
  state.relationships = state.relationships.map((r) => {
    const text =
      r.semantics &&
      readerText('relationship', r.id, relationshipReaderKey(r.id), r.semantics.summary);
    return text ? { ...r, semantics: { ...r.semantics!, reader_summary: text } } : r;
  });
  for (const e of events) {
    const text = readerText('event', e.id, eventReaderKey(e.id), e.description);
    if (text) e.reader_description = text;
  }
}

// FR-ADM-005 🚦
export async function generateFullBook(
  args: BookArgs,
  sceneWindow: SceneInputWindow = FULL_SCENE_WINDOW
): Promise<ResolvedBookData> {
  const BOOK_ID = args.bookId;
  const OUT_DIR = args.fullDir;
  const { title, author } = requireBookMeta(args);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const rawText = fs.readFileSync(args.filePath, 'utf-8');
  const { pages: allPages, chapters: allChapters } = splitBook(rawText, BOOK_ID);

  // MAX_CHAPTERS — 전체 배치 전 소규모 스모크 테스트용. 지정 안 하면 전체 장 처리
  const maxChapters = process.env.MAX_CHAPTERS
    ? parseInt(process.env.MAX_CHAPTERS, 10)
    : allChapters.length;
  const chapters = allChapters.slice(0, maxChapters);
  console.log(
    `=== 「${title}」 총 ${allChapters.length}장 중 ${chapters.length}장 처리, ${allPages.length}페이지 — 본실행 시작 ===\n`
  );

  const state = createEmptyState(BOOK_ID);
  const chapterReviews: { chapter_no: number; candidates: ReviewCandidate[] }[] = [];
  const chapterSummaries: { chapter_no: number; title: string; summary: string }[] = [];
  const verification = { candidates: 0, confirmed: 0, needs_review: 0, held: 0 };
  // FR-DAT-008 — DB events 열(event, description, occurrence_page, reader_description) + 근거 필드(JSON 산출물 전용)
  const allEvents: (TimelineEvent & { id: string; reader_description?: string })[] = [];
  // events.id는 전역 PK다 — takryu는 기존 id를 유지하고, 다른 책은 bookId를 붙여 다른 도서와 충돌하지 않게 한다
  const eventIdPrefix = BOOK_ID === DEFAULT_BOOK_ID ? '' : `${BOOK_ID}:`;

  for (const chapter of chapters) {
    const pages = allPages.filter(
      (p) => p.page_no >= chapter.start_page && p.page_no <= chapter.end_page
    );
    const known = knownCharacterNames(state);

    const output = await loadOrGenerateChapter(chapter, pages, known, [], OUT_DIR, PIPELINE_MODE);
    const chapterEvents = await loadOrGenerateChapterEvents(chapter, pages, OUT_DIR, sceneWindow);
    const summaryGrounding = await loadOrGenerateSummaryGrounding(
      chapter,
      pages,
      output.summary,
      OUT_DIR
    );
    chapterReviews.push({
      chapter_no: chapter.chapter_no,
      candidates: [
        ...output.review,
        ...chapterEvents.review,
        ...summaryReviewCandidates(output.chapter_no, output.summary), // FR-DAT-003
        ...summaryGrounding, // FR-DAT-003 — 근거 미확인 문장
      ],
    });

    mergeCharacters(state, output.characters);
    // FR-CHR-001 🚦 — 관계: 구조적 후보 쌍(LLM 0회) → 근거 창 관계 질문지 2회 → 결정적 검사 → 반대 검토자.
    // LLM은 Claude 구독(게이트웨이 generate_relationship*)으로만 부른다(2026-11-18 대표 지시, OpenAI 경로 삭제).
    const prefix = path.join(OUT_DIR, `chapter-${chapter.chapter_no}.rel-structural`);
    const structural = await runStructuralChapter(
      chapter,
      pages,
      lexiconFromAccumulated(state.characters),
      {
        label: cachedLabeler(prefix, chapter.chapter_no, STRUCTURAL_CONTRACT, call),
        verifier: cachedVerifier(prefix, call),
      }
    );
    for (const h of structural.held) {
      verification.candidates++;
      verification.held++;
      state.review.push({
        kind: 'relationship',
        reason: `held: ${h.reasons.join(', ')}`,
        candidate: h.candidate,
      });
    }
    for (const r of structural.accepted) {
      verification.candidates++;
      verification[r.check]++;
    }
    mergeRelationships(
      state,
      structural.accepted.map((r) => ({
        character_a_id: r.character_a_id,
        character_b_id: r.character_b_id,
        label: r.relationship.label,
        established_page: r.relationship.established_page,
        evidence: r.relationship.evidence,
        rationale: r.relationship.rationale,
        change_type: r.relationship.change_type,
        change_evidence: r.relationship.change_evidence,
        semantics: {
          ...r.relationship.semantics!,
          verification: { check: r.check, reasons: r.reasons, runs_agreed: r.runs_agreed },
        },
      }))
    );
    mergeTerms(state, output.terms);

    chapterSummaries.push({
      chapter_no: output.chapter_no,
      title: output.title,
      summary: output.summary,
    });
    for (const e of chapterEvents.events) {
      allEvents.push({ id: `${eventIdPrefix}${chapter.chapter_no}-${allEvents.length}`, ...e });
    }

    console.log(
      `  누적 인물 ${state.characters.length}명, 관계(이력 포함) ${state.relationships.length}건, 용어 ${state.terms.length}개\n`
    );
  }

  await applyReaderTexts(state, allEvents, OUT_DIR);

  const background = await loadOrGenerateBackground(
    OUT_DIR,
    title,
    author,
    allPages.filter((p) => p.page_no === 1)
  );

  const combined = {
    book_id: BOOK_ID,
    chapter_summaries: chapterSummaries,
    characters: state.characters,
    relationships: state.relationships,
    terms: state.terms,
    events: allEvents,
    background_and_intro: background,
    review_candidates: { chapters: chapterReviews, identities_and_relationships: state.review },
    provenance: {
      relationship_coverage: {
        complete: chapters.length === allChapters.length,
        source_page_count: allPages.length,
        chapter_nos: chapters.map((c) => c.chapter_no),
      },
      validation_scope:
        'exact source provenance and conservative semantic guards; human semantic review required',
      identities: state.identity_evidence,
      identity_merges: state.merges,
      relationship_verification: verification,
      relationship_method: `structural-v${STRUCTURAL_LABEL_VERSION} (claude-cli subscription)`,
    },
  };
  const combinedPath = path.join(OUT_DIR, 'all-resolved.json');
  persistResolvedOutput(combinedPath, combined, allPages);

  console.log(`=== 완료 — ${combinedPath} ===`);
  console.log(
    `인물 ${state.characters.length}명 · 관계(이력 포함) ${state.relationships.length}건 · 용어 ${state.terms.length}개 · 사건 ${allEvents.length}건`
  );
  console.log(
    '사람 검토 필요(V4/S7) — 장 요약의 미래 사건 언급, 관계 이력 라벨, 별칭 통합을 직접 확인할 것.'
  );
  return combined as unknown as ResolvedBookData;
}

if (require.main === module)
  generateFullBook(bookArgsFromCli('run-generate-full'), parseSceneWindow()).catch((err) => {
    console.error('[FAIL]', err);
    process.exit(1);
  });
