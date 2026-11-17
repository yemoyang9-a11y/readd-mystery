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
 *        다른 책의 산출물은 data/generated/<bookId>/full/ 에 따로 둔다 — run-args.ts 참조
 */
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { call } from '../../modules/llm-gateway/gateway';
import { LLM_PROVIDER, MODEL_CONFIG, DEFAULT_EFFORT } from '../../modules/llm-gateway/model-config';
import { splitBook } from './split';
import {
  buildSummaryPrompt,
  buildCharacterPrompt,
  buildRelationshipPrompt,
  buildBackgroundPrompt,
  buildTermPrompt,
  parseJsonResponse,
} from './generate';
import {
  ChapterEventRaw,
  ChapterEventResult,
  EVENT_EXTRACTION_VERSION,
  TimelineEvent,
  buildSceneBoundaryPrompt,
  buildSceneEventPrompt,
  chapterEventCallCount,
  evaluateChapterEvents,
  extractChapterEventsRaw,
} from './event-scenes';
import { checkPageBounds } from './validate';
import {
  createEmptyState,
  knownCharacterNames,
  mergeCharacters,
  mergeRelationships,
  mergeTerms,
  resolveCharacterId,
  GenerationState,
  previousRelationshipHints,
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
} from './grounding';
import {
  BookArgs,
  DEFAULT_BOOK_ID,
  bookArgsFromCli,
  parseBookArgs,
  requireBookMeta,
} from './run-args';
import { ResolvedBookData } from './check-integrity';
import {
  VerifierAnswer,
  VerifierCharacter,
  VerifierInput,
  buildVerifierPrompt,
  verifyRelationships,
} from './relationship-verification';
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
import { createHash } from 'crypto';

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
    });
    try {
      return parseJsonResponse<T>(raw);
    } catch (err) {
      if (attempt > JSON_PARSE_RETRIES) throw err;
      console.warn(`[JSON 재시도] task=${task} 장=${chapterLabel} 시도=${attempt + 1}`);
    }
  }
}

/** 인자 없는 기본값(takryu) — 장 캐시를 읽는 export 함수의 기본 디렉터리 */
const DEFAULT_OUT_DIR = parseBookArgs([]).fullDir;
const EXTRACTION_CONTRACT = JSON.stringify({
  characterPrompt: buildCharacterPrompt.toString(),
  relationshipPrompt: buildRelationshipPrompt.toString(),
  provider: LLM_PROVIDER,
  models: MODEL_CONFIG,
  effort: DEFAULT_EFFORT,
});

// FR-CHR-001 🚦
const PIPELINE_MODE: GroundingOptions = {
  requireRelationshipSemantics: true,
  deferRelationshipEndpoints: true,
  requireStoryPresence: true,
};
const DEFAULT_MODE: GroundingOptions = { requireRelationshipSemantics: true };

// FR-DAT-008 — 사건 추출 계약. 인물·관계 캐시(EXTRACTION_CONTRACT)와 따로 봉인해, 사건 규칙이
// 바뀌어도 인물·관계를 다시 부르지 않는다. 바뀌면 사건 캐시만 Stale로 멈춘다.
const EVENT_EXTRACTION_CONTRACT = JSON.stringify({
  version: EVENT_EXTRACTION_VERSION,
  sceneBoundaryPrompt: buildSceneBoundaryPrompt.toString(),
  sceneEventPrompt: buildSceneEventPrompt.toString(),
  provider: LLM_PROVIDER,
  models: MODEL_CONFIG,
  effort: DEFAULT_EFFORT,
});

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
  previousRelationships: string[],
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

  const knownForRelationships = [...known, ...accepted.characters.map((c) => c.name)];
  const { relationships } = await callJson<{ relationships: RawRelationship[] }>(
    'generate_relationship',
    buildRelationshipPrompt(chapter, pages, knownForRelationships, previousRelationships),
    chapter.chapter_no
  );
  record(
    '관계',
    validateGroundedChapter({ relationships }, pages, mode).relationships.map(
      (r) => r.established_page
    )
  );

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
    relationships,
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
  const output = await generateChapter(chapter, pages, known, previousRelationships, mode);
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

// FR-CHR-001 🚦
export async function loadOrGenerateRelationshipRun(
  chapter: Chapter,
  pages: Page[],
  known: string[],
  previousRelationships: string[],
  chapterCharacters: string[],
  runNo: number,
  outDir: string,
  mode: GroundingOptions
): Promise<GroundedRelationship[]> {
  const cacheContext = [...known, JSON.stringify(previousRelationships)];
  const contract = `${EXTRACTION_CONTRACT}|relationship-run-${runNo}`;
  const filePath = path.join(outDir, `chapter-${chapter.chapter_no}.rel-run${runNo}.json`);
  if (fs.existsSync(filePath)) {
    console.log(`[재생] ${chapter.chapter_no}장 관계 ${runNo}차 추출 — 기존 결과 재사용`);
    const cached = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      relationships: RawRelationship[];
    };
    assertGroundingCache(cached, chapter, pages, cacheContext, contract);
    return validateGroundedChapter(cached, pages, mode).relationships;
  }
  console.log(`[생성] ${chapter.chapter_no}장 관계 ${runNo}차 추출 게이트웨이 호출 중...`);
  const { relationships } = await callJson<{ relationships: RawRelationship[] }>(
    'generate_relationship',
    buildRelationshipPrompt(
      chapter,
      pages,
      [...known, ...chapterCharacters],
      previousRelationships
    ),
    chapter.chapter_no
  );
  const sealed = sealChapterCache(
    { chapter_no: chapter.chapter_no, run: runNo, relationships },
    chapter,
    pages,
    cacheContext,
    contract
  );
  fs.writeFileSync(filePath, JSON.stringify(sealed, null, 2), 'utf-8');
  return validateGroundedChapter(sealed, pages, mode).relationships;
}

/**
 * 사건(타임라인) — 장면 단위 추출. FR-DAT-008 · FR-SPL-002 🚦 · NFR-AI-004
 * 원본 LLM 응답(경계 + 장면별 응답)만 chapter-{N}.events.json에 봉인해 두고, 새 실행과 재생
 * 모두 evaluateChapterEvents로 같은 검증을 거친다. 재생 때는 LLM을 부르지 않는다.
 */
export async function loadOrGenerateChapterEvents(
  chapter: Chapter,
  pages: Page[],
  outDir: string = DEFAULT_OUT_DIR
): Promise<ChapterEventResult> {
  const filePath = path.join(outDir, `chapter-${chapter.chapter_no}.events.json`);
  let raw: ChapterEventRaw;
  if (fs.existsSync(filePath)) {
    console.log(`[재생] ${chapter.chapter_no}장 사건(장면 단위) — 기존 결과 재사용`);
    const cached = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ChapterEventRaw;
    assertGroundingCache(cached, chapter, pages, [], EVENT_EXTRACTION_CONTRACT);
    raw = cached;
  } else {
    // 게이트웨이 경유만 — 4.3절. 배치 전용이라 런타임 호출 수(R9)와 무관하다
    raw = await extractChapterEventsRaw(chapter, pages, (prompt, task) =>
      // NFR-OBS-004 — 경계 호출과 장면별 추출의 작업 이름이 달라 비용 지표가 나뉜다
      callJson<unknown>(task, prompt, chapter.chapter_no)
    );
    const sealed = sealChapterCache(
      { chapter_no: chapter.chapter_no, ...raw },
      chapter,
      pages,
      [],
      EVENT_EXTRACTION_CONTRACT
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
  if (result.warnings.length > 0) {
    console.warn(`  [사건 경고] ${chapter.chapter_no}장:`, result.warnings);
  }
  return result;
}

// NFR-AI-004
export function cachedRelationshipVerifier(
  chapterNo: number,
  outDir: string
): (input: VerifierInput) => Promise<VerifierAnswer> {
  const filePath = path.join(outDir, `chapter-${chapterNo}.verifier.json`);
  const cache: Record<string, VerifierAnswer> = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    : {};
  return async (input) => {
    const key = createHash('sha256').update(buildVerifierPrompt(input)).digest('hex');
    if (cache[key]) return cache[key];
    const answer = await callJson<VerifierAnswer>(
      'generate_relationship',
      buildVerifierPrompt(input),
      `${chapterNo}-검토`
    );
    if (typeof answer.supports !== 'boolean') throw new Error('verifier answer malformed');
    cache[key] = { supports: answer.supports, why: String(answer.why ?? '') };
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf-8');
    return cache[key];
  };
}

function verifierLexicon(state: GenerationState): VerifierCharacter[] {
  return state.characters.map((c) => ({
    id: c.id,
    name: c.name,
    first_appearance_page: c.first_appearance_page,
    aliases: c.aliases.map((a) => ({
      alias: a.alias,
      first_appearance_page: a.first_appearance_page,
    })),
  }));
}

async function loadOrGenerateBackground(
  outDir: string,
  title: string,
  author: string
): Promise<{ background: string; intro: string }> {
  const filePath = path.join(outDir, 'background.json');
  if (fs.existsSync(filePath)) {
    console.log('[재생] 배경지식·소개 — 기존 결과 재사용');
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  console.log('[생성] 배경지식·소개 게이트웨이 호출 중...');
  const out = await callJson<{ background: string; intro: string }>(
    'generate_background',
    buildBackgroundPrompt(title, author),
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

/** 해당 장의 관계 결과를 이름→id로 해소해 상태에 병합한다. 매칭 실패는 건너뛰고 경고만 남긴다(지어내지 않는다) */
function mergeChapterRelationships(
  state: GenerationState,
  chapterNo: number,
  relationships: RawRelationship[]
): void {
  const resolved: {
    character_a_id: string;
    character_b_id: string;
    label: string;
    established_page: number;
  }[] = [];
  for (const r of relationships) {
    const aId = resolveCharacterId(state, r.character_a, r.established_page);
    const bId = resolveCharacterId(state, r.character_b, r.established_page);
    if (!aId || !bId || aId === bId) {
      state.review.push({
        kind: 'relationship',
        reason: 'Unresolved, ambiguous, future or identical endpoints',
        candidate: r,
      });
      console.warn(
        `  [경고] ${chapterNo}장: 관계의 인물명을 인물 목록에서 찾지 못함 — "${r.character_a}" / "${r.character_b}" (검수 대상)`
      );
      continue;
    }
    resolved.push({
      ...r,
      character_a_id: aId,
      character_b_id: bId,
      label: r.label,
      established_page: r.established_page,
    });
  }
  mergeRelationships(state, resolved);
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
    if (added.length === 0) return text;
    state.review.push({
      kind,
      reason: 'reader_text_new_proper_noun',
      candidate: { id, source, reader_text: text, introduced_names: added },
    });
    return undefined;
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
export async function generateFullBook(args: BookArgs): Promise<ResolvedBookData> {
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

    const previousRelationships = previousRelationshipHints(state);
    const output = await loadOrGenerateChapter(
      chapter,
      pages,
      known,
      previousRelationships,
      OUT_DIR,
      PIPELINE_MODE
    );
    const chapterEvents = await loadOrGenerateChapterEvents(chapter, pages, OUT_DIR);
    chapterReviews.push({
      chapter_no: chapter.chapter_no,
      candidates: [...output.review, ...chapterEvents.review],
    });

    mergeCharacters(state, output.characters);
    const secondRun = await loadOrGenerateRelationshipRun(
      chapter,
      pages,
      known,
      previousRelationships,
      output.characters.map((c) => c.name),
      2,
      OUT_DIR,
      PIPELINE_MODE
    );
    const verified = await verifyRelationships(
      output.relationships,
      pages,
      verifierLexicon(state),
      {
        secondRun,
        verifier: cachedRelationshipVerifier(chapter.chapter_no, OUT_DIR),
      }
    );
    const accepted: RawRelationship[] = [];
    for (const v of verified) {
      verification.candidates++;
      verification[v.check]++;
      const stamp = { check: v.check, reasons: v.reasons, runs_agreed: v.runs_agreed };
      if (v.check === 'held') {
        state.review.push({
          kind: 'relationship',
          reason: `held: ${v.reasons.join(', ')}`,
          candidate: {
            ...v.relationship,
            verification: stamp,
            ...(v.verifier_why ? { verifier_why: v.verifier_why } : {}),
          },
        });
        continue;
      }
      accepted.push({
        ...v.relationship,
        semantics: { ...v.relationship.semantics!, verification: stamp },
      });
    }
    mergeChapterRelationships(state, chapter.chapter_no, accepted);
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

  const background = await loadOrGenerateBackground(OUT_DIR, title, author);

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
  generateFullBook(bookArgsFromCli('run-generate-full')).catch((err) => {
    console.error('[FAIL]', err);
    process.exit(1);
  });
