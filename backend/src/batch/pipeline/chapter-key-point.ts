/**
 * 타임라인 장 핵심 한 줄 — FR-SPL-003 🚦, 결정 31 (2026-11-18 대표 승인 시안 2차 A안: 장마다 "핵심 한 줄" 50자 안팎)
 *
 * 1) 입력: 그 장 원문(장 첫 쪽 ~ 장 끝 쪽)뿐이다. 장 범위 밖 원문은 0자다 — 상한은 프롬프트 지시가
 *    아니라 입력 범위(데이터 선택)로 건다(절대 규칙 3, R4). 범위가 어긋난 쪽이 섞이면 프롬프트를 만들지 않는다.
 * 2) LLM 1회/장: 한 문장 + 그 문장을 뒷받침하는 원문 인용 하나. 호출은 주입된 ask(게이트웨이 ⑥ 경유)로만
 *    한다(절대 규칙 4). 배치 전용이라 런타임 호출 수(R9)와 무관하다.
 * 3) 코드 검사 — 한 문장, 60자 이하(하드 상한, 목표 50자 안팎), 평가어 없음(semantic-guards), 그 장 원문에
 *    없던 고유명사 없음(reader-text introducedNames), 인용이 그 장 그 쪽 원문에 실제로 있음(validEvidence).
 *    하나라도 못 지키면 문장을 쓰지 않고(key_point = null) 검수 후보를 남긴다. 고치거나 자르지 않는다.
 * 4) DB 쓰기는 applyKeyPoints — 파이프라인(⑦) 경로. 쓰기 전에 책을 공개에서 내리고(R12), 문장이 바뀐 장은
 *    이전 검수 기록을 지워 다시 검수받게 한다(FR-ADM-005 🚦).
 *
 * 화면은 key_point 가 없으면 장 요약 첫 문장으로 대신한다. 인용이 원문에 있다는 것은 필요조건일 뿐
 * 문장이 옳다는 증명이 아니다 — 사람 검수(chapter_key_point)를 대신하지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Chapter, Page } from '../../shared/types';
import { buildPageTaggedText } from './generate';
import {
  ReviewCandidate,
  assertGroundingCache,
  groundingManifest,
  sealChapterCache,
  validEvidence,
} from './grounding';
import { introducedNames } from './reader-text';
import { evaluativeWord } from './semantic-guards';
import { splitSummarySentences } from './summary-grounding';

/** 게이트웨이 작업 이름 — 비용 지표를 장 요약과 나눈다(NFR-OBS-004). 모델은 generate_summary 것을 빌린다 */
export const KEY_POINT_TASK = 'generate_chapter_key_point';
/** 캐시 계약 버전 — 프롬프트·검사 규칙이 바뀌면 올린다 */
export const KEY_POINT_VERSION = 'chapter-key-point-v1';
/** 하드 상한(글자 수, 공백·문장부호 포함) — 넘으면 쓰지 않는다 */
export const KEY_POINT_MAX_LENGTH = 60;
/** 목표 길이 — 프롬프트에만 쓴다 (시안 "50자 안팎") */
export const KEY_POINT_TARGET_LENGTH = 50;

export type AskKeyPoint = (prompt: string, task: typeof KEY_POINT_TASK) => Promise<unknown>;

export type KeyPointReason =
  | 'key_point_missing'
  | 'key_point_too_long'
  | 'key_point_not_one_sentence'
  | 'key_point_evaluative_word'
  | 'key_point_new_proper_noun'
  | 'key_point_ungrounded';

export interface ChapterKeyPoint {
  chapter_no: number;
  /** 생성 때 쓴 장 원문의 봉인 — DB에 쓸 때 지금 원문과 같은지 확인한다 */
  grounding: { schema_version: number; source_hash: string };
  /** 검사를 통과한 문장. 못 했으면 null (DB에 쓰지 않는다) */
  key_point: string | null;
}

export interface KeyPointFile {
  book_id: string;
  version: string;
  key_points: ChapterKeyPoint[];
  review_candidates: ReviewCandidate[];
}

const length = (text: string): number => [...text].length;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** FR-SPL-003 🚦 데이터 선택 — 책 전체에서 그 장 첫 쪽 ~ 끝 쪽만 고른다 */
export function chapterPagesOnly(chapter: Chapter, allPages: Page[]): Page[] {
  return allPages
    .filter((p) => p.page_no >= chapter.start_page && p.page_no <= chapter.end_page)
    .sort((a, b) => a.page_no - b.page_no);
}

/** 입력이 정확히 그 장 첫 쪽 ~ 끝 쪽인지 — 밖의 쪽이 섞이거나 끝 쪽이 빠지면 거절한다. FR-SPL-003 🚦 */
function assertChapterRange(chapter: Chapter, pages: Page[]): void {
  const expected = chapter.end_page - chapter.start_page + 1;
  const inRange = pages.every(
    (p) =>
      p.book_id === chapter.book_id &&
      p.page_no >= chapter.start_page &&
      p.page_no <= chapter.end_page
  );
  const distinct = new Set(pages.map((p) => p.page_no)).size;
  if (!inRange || distinct !== expected || pages.length !== expected) {
    throw new Error(
      `${chapter.chapter_no}장 핵심 한 줄 입력이 장 범위(${chapter.start_page}~${chapter.end_page}쪽)와 다르다 — 만들지 않는다`
    );
  }
}

/** 입력은 그 장 원문뿐이다 — FR-SPL-003 🚦, 절대 규칙 3 */
export function buildKeyPointPrompt(chapter: Chapter, pages: Page[]): string {
  assertChapterRange(chapter, pages);
  return `다음은 이 작품 ${chapter.chapter_no}장 "${chapter.title}"의 원문 전체다(각 문단 앞에 [페이지 N] 표시).
이 장에서 일어난 일의 핵심을 한 문장으로 써라. 독자가 장 목록에서 "이 장은 이런 장이었지" 하고 떠올릴 문장이다.

규칙:
- 한 문장만 쓴다. ${KEY_POINT_TARGET_LENGTH}자 안팎으로 쓰고 ${KEY_POINT_MAX_LENGTH}자를 넘기지 않는다(공백 포함).
- 이 장 원문에서 실제로 일어난 일만 쓴다. 이 장 이후의 일, 범인·동기·진상에 대한 추측은 쓰지 않는다(알더라도 금지).
- 중요도를 매기거나 해석하지 않는다. "단서", "결정적", "수상한", "중요한", "알고 보니", "복선" 같은 말을 쓰지 않는다.
- 인물은 이 장 원문에 나온 이름으로만 부른다.
- quote에는 그 문장을 뒷받침하는 원문 한 곳을 그대로 복사한다(고치거나 줄이거나 이어 붙이지 않는다). source_page는 그 인용이 있는 [페이지 N]의 숫자다.

출력은 아래 JSON 형식만 반환하라. 다른 설명·마크다운 코드블록 없이 JSON 텍스트만 출력하라.
{"key_point": "...", "source_page": 0, "quote": "..."}

--- 원문 ---
${buildPageTaggedText(pages)}`;
}

/**
 * LLM 호출 단계 — 장당 1회. 책 전체를 받아도 그 장 쪽만 골라 넣는다. 원본 응답만 돌려준다.
 * 호출 실패는 잡지 않는다 — 실패를 "통과"로 바꾸는 경로를 두지 않는다(FR-SPL-005 🚦).
 */
export async function requestChapterKeyPoint(
  chapter: Chapter,
  allPages: Page[],
  ask: AskKeyPoint
): Promise<unknown> {
  const pages = chapterPagesOnly(chapter, allPages);
  return ask(buildKeyPointPrompt(chapter, pages), KEY_POINT_TASK);
}

/** 문장 자체만 보는 검사 — 길이·한 문장·평가어. 생성 직후와 DB 쓰기 직전에 같은 검사를 한다 */
function textReasons(text: string): KeyPointReason[] {
  const reasons: KeyPointReason[] = [];
  if (length(text) > KEY_POINT_MAX_LENGTH) reasons.push('key_point_too_long');
  if (splitSummarySentences(text).length !== 1) reasons.push('key_point_not_one_sentence');
  if (evaluativeWord(text)) reasons.push('key_point_evaluative_word');
  return reasons;
}

/**
 * 원본 응답을 결정적으로 검증한다 — 새 실행과 캐시 재생이 같은 검증을 거친다. NFR-AI-004, R9
 * pages 는 그 장 쪽뿐이어야 한다(근거 인용도 그 장 안에서만 찾는다).
 */
export function evaluateChapterKeyPoint(
  chapter: Chapter,
  pages: Page[],
  raw: unknown,
  lexicon: string[]
): { chapter_no: number; key_point: string | null; review: ReviewCandidate[] } {
  assertChapterRange(chapter, pages);
  const entry = object(raw);
  const text = typeof entry.key_point === 'string' ? entry.key_point.trim() : '';
  const reasons: KeyPointReason[] = [];
  let introduced: string[] = [];
  if (!text) {
    reasons.push('key_point_missing');
  } else {
    reasons.push(...textReasons(text));
    const source = pages.map((p) => p.content).join('\n');
    introduced = introducedNames(source, text, lexicon);
    if (introduced.length > 0) reasons.push('key_point_new_proper_noun');
  }
  if (!validEvidence(entry, pages, entry.source_page, [])) reasons.push('key_point_ungrounded');

  if (reasons.length === 0) return { chapter_no: chapter.chapter_no, key_point: text, review: [] };
  return {
    chapter_no: chapter.chapter_no,
    key_point: null,
    review: [
      {
        kind: 'key_point',
        reason: reasons[0],
        candidate: {
          chapter_no: chapter.chapter_no,
          key_point: text || null,
          reasons,
          ...(introduced.length > 0 ? { introduced_names: introduced } : {}),
          source_page: entry.source_page ?? null,
          quote: entry.quote ?? null,
        },
      },
    ],
  };
}

const KEY_POINT_CONTRACT = JSON.stringify({
  version: KEY_POINT_VERSION,
  prompt: buildKeyPointPrompt.toString(),
});

/**
 * 책 전체 장의 핵심 한 줄. 원본 응답은 chapter-{N}.key-point.json 에 봉인해 두고, 다시 돌리면
 * AI를 부르지 않고 같은 검증을 거친다. 장 원문·프롬프트가 바뀌면 캐시가 Stale 로 멈춘다.
 */
export async function generateBookKeyPoints(input: {
  bookId: string;
  chapters: Chapter[];
  pages: Page[];
  lexicon: string[];
  outDir: string;
  ask: AskKeyPoint;
  contract?: string;
}): Promise<KeyPointFile> {
  const contract = input.contract ?? KEY_POINT_CONTRACT;
  fs.mkdirSync(input.outDir, { recursive: true });
  const key_points: ChapterKeyPoint[] = [];
  const review_candidates: ReviewCandidate[] = [];
  for (const chapter of input.chapters) {
    const pages = chapterPagesOnly(chapter, input.pages);
    const filePath = path.join(input.outDir, `chapter-${chapter.chapter_no}.key-point.json`);
    let response: unknown;
    if (fs.existsSync(filePath)) {
      const cached = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { response: unknown };
      assertGroundingCache(cached, chapter, pages, [], contract);
      response = cached.response;
    } else {
      // 게이트웨이 경유만 — 4.3절, 절대 규칙 4
      response = await requestChapterKeyPoint(chapter, input.pages, input.ask);
      const sealed = sealChapterCache(
        { chapter_no: chapter.chapter_no, response },
        chapter,
        pages,
        [],
        contract
      );
      fs.writeFileSync(filePath, JSON.stringify(sealed, null, 2), 'utf-8');
    }
    const result = evaluateChapterKeyPoint(chapter, pages, response, input.lexicon);
    key_points.push({
      chapter_no: chapter.chapter_no,
      grounding: groundingManifest(chapter, pages),
      key_point: result.key_point,
    });
    review_candidates.push(...result.review);
  }
  return { book_id: input.bookId, version: KEY_POINT_VERSION, key_points, review_candidates };
}

interface ApplyClient {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

type Rows<T> = { rows: T[]; rowCount?: number | null };

/**
 * 핵심 한 줄을 공개 콘텐츠 스토어에 쓴다 — 파이프라인(⑦) 경로(절대 규칙 5). 호출하는 쪽이 트랜잭션을 연다.
 * - 생성 때 장 원문 봉인이 지금 원문과 다르거나, DB 장 범위가 지금 분할과 다르면 아무것도 쓰지 않는다.
 * - 쓰기 전에 책을 공개에서 내린다(R12, FR-ADM-005 🚦) — 검수를 다시 마쳐야 공개된다.
 * - 통과한 문장만 쓰고 key_point_review_status = 'pending'. null 인 장은 건드리지 않는다.
 * - 문장이 바뀐 장은 chapter_key_point 검수 기록을 지운다(예전 판정으로 새 문장이 공개되지 않게).
 */
export async function applyKeyPoints(
  client: ApplyClient,
  file: KeyPointFile,
  chapters: Chapter[],
  allPages: Page[]
): Promise<{ written: number; skipped: number }> {
  const bookId = file.book_id;
  const byNo = new Map(chapters.map((c) => [c.chapter_no, c]));

  // 쓰기 전에 전부 확인한다 — 하나라도 어긋나면 아무것도 쓰지 않는다
  for (const kp of file.key_points) {
    const chapter = byNo.get(kp.chapter_no);
    if (!chapter || chapter.book_id !== bookId)
      throw new Error(`${kp.chapter_no}장이 지금 원문 분할에 없다 — 쓰지 않는다`);
    const now = groundingManifest(chapter, chapterPagesOnly(chapter, allPages));
    if (
      now.source_hash !== kp.grounding?.source_hash ||
      now.schema_version !== kp.grounding?.schema_version
    )
      throw new Error(`${kp.chapter_no}장 원문이 생성 때와 다르다 — 다시 생성할 것`);
    if (kp.key_point !== null) {
      const reasons = textReasons(kp.key_point);
      if (reasons.length > 0)
        throw new Error(
          `${kp.chapter_no}장 핵심 한 줄이 검사(한 문장·${KEY_POINT_MAX_LENGTH}자·평가어)를 통과하지 못한다: ${reasons.join(', ')}`
        );
    }
  }
  const dbChapters = (
    (await client.query(
      'SELECT chapter_no, start_page, end_page FROM chapters WHERE book_id = $1',
      [bookId]
    )) as Rows<{ chapter_no: number; start_page: number; end_page: number }>
  ).rows;
  for (const kp of file.key_points) {
    const chapter = byNo.get(kp.chapter_no)!;
    const db = dbChapters.find((c) => c.chapter_no === kp.chapter_no);
    if (!db || db.start_page !== chapter.start_page || db.end_page !== chapter.end_page)
      throw new Error(
        `${kp.chapter_no}장 DB 장 범위가 생성 때(${chapter.start_page}~${chapter.end_page}쪽)와 다르다 — 쓰지 않는다`
      );
  }

  const toWrite = file.key_points.filter((kp) => kp.key_point !== null);
  if (toWrite.length === 0) return { written: 0, skipped: file.key_points.length };

  // R12 / FR-ADM-005 🚦 — 공개 중인 책은 쓰기 전에 공개에서 내린다(실패 = 미노출)
  await client.query(
    "UPDATE books SET ssabi_ready = false, publish_status = 'review' WHERE book_id = $1 AND (ssabi_ready OR publish_status = 'published')",
    [bookId]
  );
  // 관리자 화면에서 다시 검수할 수 있게 한다(관리자 승인은 review_ready 작업에서만 받는다)
  await client.query(
    "UPDATE ingest_jobs SET status = 'review_ready', updated_at = now() WHERE book_id = $1 AND status = 'published'",
    [bookId]
  );

  const existing = (
    (await client.query('SELECT chapter_no, key_point FROM chapter_summaries WHERE book_id = $1', [
      bookId,
    ])) as Rows<{ chapter_no: number; key_point: string | null }>
  ).rows;
  for (const kp of toWrite) {
    const before = existing.find((r) => r.chapter_no === kp.chapter_no)?.key_point ?? null;
    if (before !== kp.key_point) {
      await client.query(
        'DELETE FROM review_records WHERE book_id = $1 AND target_type = $2 AND target_id = $3',
        [bookId, 'chapter_key_point', String(kp.chapter_no)]
      );
    }
    const result = (await client.query(
      "UPDATE chapter_summaries SET key_point = $1, key_point_review_status = 'pending' WHERE book_id = $2 AND chapter_no = $3",
      [kp.key_point, bookId, kp.chapter_no]
    )) as Rows<unknown>;
    if (result.rowCount !== 1)
      throw new Error(
        `${kp.chapter_no}장 장 요약 행이 없다 — run-register-content 로 생성물을 먼저 등록할 것`
      );
  }
  return { written: toWrite.length, skipped: file.key_points.length - toWrite.length };
}
