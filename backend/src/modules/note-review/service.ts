/**
 * 추리 채점 서비스 (대표 결정 2026-11-24)
 *
 * 흐름: 관문(reached_end) → 이미 성공했으면 저장 결과 → 결말 전 노트 고르기 → 채점 맡기(잠금)
 *       → 근거 조회(상한 = 책 끝 쪽) → 게이트웨이 1회(형식이 틀리면 1회 재생성) → 고정 규칙으로 개수·칭호 → 저장
 *
 * - 관문은 저장소 접근보다 먼저다. 닫혀 있으면 노트·근거를 조회하지 않는다 (절대 규칙 7, FR-QNA-004 🚦).
 * - 범위 숫자는 기준점 결정기에서만 받는다 (절대 규칙 2번, R2). 클라이언트는 숫자를 보내지 않는다 (절대 규칙 8번).
 * - 모델 호출은 게이트웨이로만 한다 (절대 규칙 4번). 실패 = 결과 없음 — 저장소에 결과를 남기지 않는다 (R11).
 * - 런타임 AI 호출의 세 번째 종류다(리캡·챗봇·채점). R9 변경은 대표 결정이다.
 */

import type { ReviewScopeService } from '../reading-state/cutoff.service';
import type { ReviewNoteRow, ReviewNotesReader } from '../notes/repository';
import {
  buildEvidenceContext,
  buildGradingPrompt,
  GRADING_SYSTEM,
  MAX_GRADED_NOTES,
  parseGrading,
  type GradingTarget,
  type ParsedGrading,
  type ReviewEvidence,
} from './grading';
import type {
  CommunityRepository,
  CommunityReviewShareRepository,
  ReviewCard,
} from '../community/repository';
import type { NoteReviewRepository } from './repository';
import {
  countVerdicts,
  earlyPagesFor,
  titleFor,
  type GradedKind,
  type ReviewedNote,
  type ReviewResult,
} from './types';

export interface ReviewEvidenceReader {
  /** FR-SPL-002 🚦 — bound 쪽까지의 검수 통과 데이터만 */
  load(bookId: string, bound: number): Promise<ReviewEvidence>;
}

export type ReviewLlm = (
  prompt: string,
  options: { system: string; context: string; maxTokens: number }
) => Promise<string>;

export interface NoteReviewLogRecord {
  book_id: string;
  outcome: 'done' | 'failed' | 'invalid' | 'busy' | 'no_targets' | 'locked' | 'cached';
  model: string;
  bound_page?: number;
  llm_calls?: number;
  graded?: number;
  pending?: number;
  excluded?: number;
  timing_verified?: boolean;
  duration_ms?: number;
  error?: string;
}

export interface NoteReviewServiceDeps {
  scope: Pick<ReviewScopeService, 'getReviewScope'>;
  notes: ReviewNotesReader;
  reviews: NoteReviewRepository;
  evidence: ReviewEvidenceReader;
  llm: ReviewLlm;
  model: string;
  now?: () => Date;
  log?: (record: NoteReviewLogRecord) => void;
  /** 결과지 공유 — 없으면 공유 경로를 열지 않는다 */
  community?: Pick<CommunityRepository, 'countRecentPosts'> & CommunityReviewShareRepository;
}

/** 커뮤니티 글 쓰기와 같은 한도 (community/router.ts POSTS_PER_HOUR) */
const POSTS_PER_HOUR = 10;
export const MAX_SHARE_MESSAGE = 2000;
/** 한마디 글 없이 공유하면 글 본문 칸에 넣는 말 — 화면은 카드의 message 를 본다 */
export const DEFAULT_SHARE_BODY = '내 추리 결과지를 공유했어요';

export type ShareOutcome =
  | { ok: true; post_id: string }
  | {
      ok: false;
      reason:
        'locked' | 'not_graded' | 'invalid_choice' | 'duplicate' | 'rate_limited' | 'unavailable';
      post_id?: string;
    };

/** 일반 메모 가운데 "가설이었던 메모"로 고를 수 있는 것 — 결말 전에 쓴 것만 */
export interface ReviewCandidate {
  note_id: string;
  page_no: number;
  body: string;
}

export type ReviewStatusView =
  | { state: 'locked' }
  | { state: 'done'; result: ReviewResult; shared_post_id: string | null }
  | {
      state: 'ready';
      busy: boolean;
      targets: { hypothesis: number; clue: number };
      candidates: ReviewCandidate[];
      excluded_count: number;
      timing_verified: boolean;
      /** 지난번 시도가 실패했으면 true — "잠시 뒤 다시 눌러 주세요" */
      last_failed: boolean;
    };

export type GradeOutcome =
  | { ok: true; result: ReviewResult }
  | { ok: false; reason: 'locked' | 'no_targets' | 'busy' | 'failed' | 'invalid_choice' };

const MAX_TOKENS = 4096;

interface Selection {
  eligible: ReviewNoteRow[];
  excluded: number;
  timingVerified: boolean;
}

/**
 * 결말 전 노트 — 끝에 처음 닿은 시각보다 먼저 쓰고, 본문을 그 뒤로 고치지 않은 노트 (대표 결정 8번).
 * 시각을 모르는 기존 독자(029 전)는 모든 노트를 넣고 "확인 안 됨"으로 표시한다.
 */
export function selectBeforeEnding(
  rows: readonly ReviewNoteRow[],
  reachedEndAt: string | null
): Selection {
  if (reachedEndAt === null) return { eligible: [...rows], excluded: 0, timingVerified: false };
  const end = Date.parse(reachedEndAt);
  const eligible = rows.filter(
    (row) => Date.parse(row.created_at) < end && Date.parse(row.content_updated_at) < end
  );
  return { eligible, excluded: rows.length - eligible.length, timingVerified: true };
}

function gradedKind(row: ReviewNoteRow, chosen: ReadonlySet<string>): GradedKind | null {
  if (row.kind === 'hypothesis' || row.kind === 'clue') return row.kind;
  if (row.kind === null && chosen.has(row.note_id)) return 'hypothesis';
  return null;
}

export function createNoteReviewService(deps: NoteReviewServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const log =
    deps.log ?? ((record) => console.log(JSON.stringify({ type: 'note_review', ...record })));

  async function callAndParse(
    targets: GradingTarget[],
    evidence: ReviewEvidence,
    bound: number
  ): Promise<{ parsed: ParsedGrading | 'invalid'; calls: number }> {
    const context = buildEvidenceContext(evidence);
    const prompt = buildGradingPrompt(targets);
    let calls = 0;
    // 형식이 틀리면 1회만 다시 만든다 — 하네스의 재생성 1회와 같다 (대표 결정 12번)
    for (let attempt = 0; attempt < 2; attempt++) {
      calls += 1;
      const text = await deps.llm(prompt, {
        system: GRADING_SYSTEM,
        context,
        maxTokens: MAX_TOKENS,
      });
      const parsed = parseGrading(text, targets, bound);
      if (parsed !== 'invalid') return { parsed, calls };
    }
    return { parsed: 'invalid', calls };
  }

  return {
    async status(readerId: string, bookId: string): Promise<ReviewStatusView> {
      // FR-QNA-004 🚦 — 관문이 먼저다
      const scope = await deps.scope.getReviewScope(readerId, bookId);
      if (!scope.open) return { state: 'locked' };
      const stored = await deps.reviews.find(readerId, bookId);
      if (stored?.status === 'done' && stored.result) {
        const shared = deps.community
          ? await deps.community.findMyReviewPost(bookId, readerId)
          : null;
        return { state: 'done', result: stored.result, shared_post_id: shared };
      }

      const rows = await deps.notes.listForReview(readerId, bookId, scope.bound);
      const selection = selectBeforeEnding(rows, scope.reached_end_at);
      return {
        state: 'ready',
        busy: stored?.status === 'pending',
        targets: {
          hypothesis: selection.eligible.filter((r) => r.kind === 'hypothesis').length,
          clue: selection.eligible.filter((r) => r.kind === 'clue').length,
        },
        candidates: selection.eligible
          .filter((r) => r.kind === null)
          .map((r) => ({ note_id: r.note_id, page_no: r.page_no, body: r.body })),
        excluded_count: selection.excluded,
        timing_verified: selection.timingVerified,
        last_failed: stored?.status === 'failed',
      };
    },

    async grade(
      readerId: string,
      bookId: string,
      chosenIds: readonly string[]
    ): Promise<GradeOutcome> {
      const started = Date.now();
      const scope = await deps.scope.getReviewScope(readerId, bookId);
      if (!scope.open) {
        log({ book_id: bookId, outcome: 'locked', model: deps.model });
        return { ok: false, reason: 'locked' };
      }
      const stored = await deps.reviews.find(readerId, bookId);
      // 대표 결정 7번 — 성공한 결과가 최종이다. 다시 부르지 않는다
      if (stored?.status === 'done' && stored.result) {
        log({ book_id: bookId, outcome: 'cached', model: deps.model });
        return { ok: true, result: stored.result };
      }

      const rows = await deps.notes.listForReview(readerId, bookId, scope.bound);
      const selection = selectBeforeEnding(rows, scope.reached_end_at);
      const chosen = new Set(chosenIds);
      // 고를 수 있는 것은 결말 전 일반 메모뿐이다. 그 밖의 ID가 섞이면 받지 않는다
      const choosable = new Set(
        selection.eligible.filter((r) => r.kind === null).map((r) => r.note_id)
      );
      if ([...chosen].some((id) => !choosable.has(id)))
        return { ok: false, reason: 'invalid_choice' };

      const graded = selection.eligible
        .map((row) => ({ row, kind: gradedKind(row, chosen) }))
        .filter((item): item is { row: ReviewNoteRow; kind: GradedKind } => item.kind !== null);
      if (graded.length === 0) {
        // AI를 부르지 않는다 (대표 결정 12번)
        log({
          book_id: bookId,
          outcome: 'no_targets',
          model: deps.model,
          excluded: selection.excluded,
        });
        return { ok: false, reason: 'no_targets' };
      }

      const claim = await deps.reviews.claim(readerId, bookId, {
        bound_page: scope.bound,
        reached_end_at: scope.reached_end_at,
        eligible_count: graded.length,
        excluded_count: selection.excluded,
        model: deps.model,
      });
      if (claim === 'done') {
        const again = await deps.reviews.find(readerId, bookId);
        if (again?.result) return { ok: true, result: again.result };
      }
      if (typeof claim !== 'object') {
        log({ book_id: bookId, outcome: 'busy', model: deps.model });
        return { ok: false, reason: 'busy' };
      }
      const { token } = claim;

      const sent = graded.slice(0, MAX_GRADED_NOTES);
      const targets: GradingTarget[] = sent.map((item, i) => ({
        ref: `n${i + 1}`,
        kind: item.kind,
        page_no: item.row.page_no,
        body: item.row.body,
      }));

      let parsed: ParsedGrading | 'invalid';
      let calls = 0;
      try {
        const evidence = await deps.evidence.load(bookId, scope.bound);
        ({ parsed, calls } = await callAndParse(targets, evidence, scope.bound));
      } catch (error) {
        const message = String((error as Error)?.message ?? error).slice(0, 500);
        await deps.reviews.fail(readerId, bookId, token, message);
        log({
          book_id: bookId,
          outcome: 'failed',
          model: deps.model,
          llm_calls: calls,
          error: message,
          duration_ms: Date.now() - started,
        });
        return { ok: false, reason: 'failed' };
      }
      if (parsed === 'invalid') {
        await deps.reviews.fail(readerId, bookId, token, 'invalid_response');
        log({
          book_id: bookId,
          outcome: 'invalid',
          model: deps.model,
          llm_calls: calls,
          duration_ms: Date.now() - started,
        });
        return { ok: false, reason: 'failed' };
      }

      const refById = new Map(sent.map((item, i) => [item.row.note_id, `n${i + 1}`]));
      const notes: ReviewedNote[] = graded.map(({ row, kind }) => {
        const ref = refById.get(row.note_id);
        const grade = ref ? parsed.grades.get(ref) : undefined;
        return {
          note_id: row.note_id,
          page_no: row.page_no,
          kind,
          chosen_as_hypothesis: row.kind === null,
          body: row.body,
          verdict: grade?.verdict ?? 'pending',
          explanation: grade?.explanation ?? null,
          evidence_page: grade?.evidence_page ?? null,
        };
      });
      const counts = countVerdicts(notes);
      const result: ReviewResult = {
        version: 1,
        truth_summary: parsed.truth_summary,
        reveal_page: parsed.reveal_page,
        notes,
        counts,
        title: titleFor(counts),
        early_pages: earlyPagesFor(notes, parsed.reveal_page, selection.timingVerified),
        timing_verified: selection.timingVerified,
        excluded_count: selection.excluded,
        graded_at: now().toISOString(),
      };
      if (!(await deps.reviews.complete(readerId, bookId, token, result))) {
        // 멈춘 것으로 보고 다른 요청이 맡았다. 저장된 것만 '그 1회'이므로 저장된 결과를 준다 (대표 결정 7번)
        const stored = await deps.reviews.find(readerId, bookId);
        log({ book_id: bookId, outcome: 'busy', model: deps.model, llm_calls: calls });
        if (stored?.status === 'done' && stored.result) return { ok: true, result: stored.result };
        return { ok: false, reason: 'busy' };
      }
      log({
        book_id: bookId,
        outcome: 'done',
        model: deps.model,
        bound_page: scope.bound,
        llm_calls: calls,
        graded: notes.length - counts.pending,
        pending: counts.pending,
        excluded: selection.excluded,
        timing_verified: selection.timingVerified,
        duration_ms: Date.now() - started,
      });
      return { ok: true, result };
    },

    async share(
      readerId: string,
      bookId: string,
      noteIds: readonly string[],
      rawMessage: string | null
    ): Promise<ShareOutcome> {
      const community = deps.community;
      if (!community) return { ok: false, reason: 'unavailable' };
      // FR-QNA-004 🚦 — 커뮤니티와 같은 관문. 막히면 저장소를 부르지 않는다
      const scope = await deps.scope.getReviewScope(readerId, bookId);
      if (!scope.open) return { ok: false, reason: 'locked' };
      const stored = await deps.reviews.find(readerId, bookId);
      if (stored?.status !== 'done' || !stored.result) return { ok: false, reason: 'not_graded' };
      const result = stored.result;

      // 고를 수 있는 것은 판정을 받은 노트뿐이다 (판정 보류 제외)
      const judged = new Set(
        result.notes.filter((n) => n.verdict !== 'pending').map((n) => n.note_id)
      );
      const chosen = new Set(noteIds);
      if ([...chosen].some((id) => !judged.has(id))) return { ok: false, reason: 'invalid_choice' };

      const existing = await community.findMyReviewPost(bookId, readerId);
      if (existing) return { ok: false, reason: 'duplicate', post_id: existing };
      if ((await community.countRecentPosts(readerId)) >= POSTS_PER_HOUR) {
        return { ok: false, reason: 'rate_limited' };
      }
      const message = rawMessage?.trim() ? rawMessage.trim() : null;
      const card = buildReviewCard(result, chosen, message);
      const row = await community.createReviewPost(
        bookId,
        readerId,
        message ?? DEFAULT_SHARE_BODY,
        card
      );
      if (row === 'duplicate') {
        const again = await community.findMyReviewPost(bookId, readerId);
        return { ok: false, reason: 'duplicate', ...(again ? { post_id: again } : {}) };
      }
      return { ok: true, post_id: row.post_id };
    },
  };
}

/**
 * 결과지 카드 — 요약(칭호·개수·결말 N쪽 전)과 독자가 고른 노트의 판정·해설. 진상 요약은 넣지 않는다
 * (대표 결정 9번). 공유한 시점의 복사본이라 나중에 노트를 고치거나 지워도 카드는 그대로다 (11번).
 */
export function buildReviewCard(
  result: ReviewResult,
  noteIds: ReadonlySet<string>,
  message: string | null
): ReviewCard {
  const { hypothesis, clue } = result.counts;
  return {
    version: 1,
    title: result.title,
    counts: { hypothesis: { ...hypothesis }, clue: { ...clue } },
    early_pages: result.early_pages,
    timing_verified: result.timing_verified,
    message,
    notes: result.notes
      .filter((n) => noteIds.has(n.note_id))
      .map((n) => ({
        kind: n.kind,
        page_no: n.page_no,
        body: n.body,
        verdict: n.verdict,
        explanation: n.explanation,
        evidence_page: n.evidence_page,
      })),
  };
}

export type NoteReviewService = ReturnType<typeof createNoteReviewService>;
