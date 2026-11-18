import * as fs from 'fs';
import * as path from 'path';
import {
  APPLICABLE_CRITERIA,
  KEY_POINT_LIST_SQL,
  FilledReviewRow,
  ReviewCompletionReport,
  ReviewTargetType,
  SNAPSHOT_SQL,
  applyReviewJudgments,
  checkReviewComplete,
  publishBook,
} from '../../batch/pipeline/review';
import { QueryClient } from '../../batch/pipeline/register';
import { bookArgsFor } from '../../batch/pipeline/run-args';
import { JobRepository } from './job-repository';
import { readHeldCandidates, readHeldItems } from './integrity';

const REVIEWER = 'admin';
const EXCERPT_LENGTH = 200;
const WILDCARD = '*';

export type Verdict = 'approve' | 'reject';

export interface Decision {
  target_type: ReviewTargetType;
  target_id: string;
  verdict: Verdict;
}

export class ReviewError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export type ApproveResult =
  | { kind: 'published' }
  | { kind: 'not_found' }
  | { kind: 'not_ready'; status: string }
  | { kind: 'incomplete'; missing: ReviewCompletionReport['missing'] };

export interface ReviewService {
  getReview(bookId: string): Promise<Record<string, unknown> | null>;
  applyDecisions(
    bookId: string,
    decisions: unknown
  ): Promise<{ approved: number; rejected: number }>;
  approve(bookId: string): Promise<ApproveResult>;
}

interface DbClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

interface Db extends DbClient {
  connect(): Promise<DbClient & { release(): void }>;
}

const TARGET_TYPES = Object.keys(APPLICABLE_CRITERIA) as ReviewTargetType[];

const LIST_SQL: Record<ReviewTargetType, string> = {
  chapter_summary: 'SELECT chapter_no::text AS target_id FROM chapter_summaries WHERE book_id = $1',
  chapter_key_point: KEY_POINT_LIST_SQL,
  character: 'SELECT id AS target_id FROM characters WHERE book_id = $1',
  alias: "SELECT character_id || '::' || alias AS target_id FROM aliases WHERE book_id = $1",
  character_note: 'SELECT id AS target_id FROM character_notes WHERE book_id = $1',
  relationship: 'SELECT id AS target_id FROM relationships WHERE book_id = $1',
  term: 'SELECT id AS target_id FROM terms WHERE book_id = $1',
  event: 'SELECT id AS target_id FROM events WHERE book_id = $1',
  background:
    "SELECT kind AS target_id FROM background_and_intro WHERE book_id = $1 AND kind = 'background'",
  intro: "SELECT kind AS target_id FROM background_and_intro WHERE book_id = $1 AND kind = 'intro'",
};

const REJECTABLE: ReviewTargetType[] = [
  'chapter_key_point',
  'character',
  'alias',
  'character_note',
  'relationship',
  'term',
  'event',
];

// FR-ADM-005 🚦
function parseDecisions(input: unknown): Decision[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as any).decisions)) {
    throw new ReviewError(400, 'BAD_REQUEST', 'decisions array is required');
  }
  const decisions = (input as { decisions: unknown[] }).decisions;
  if (decisions.length === 0) throw new ReviewError(400, 'BAD_REQUEST', 'decisions is empty');
  return decisions.map((raw) => {
    const d = raw as Partial<Decision>;
    if (
      !d ||
      !TARGET_TYPES.includes(d.target_type as ReviewTargetType) ||
      typeof d.target_id !== 'string' ||
      d.target_id.length === 0 ||
      (d.verdict !== 'approve' && d.verdict !== 'reject')
    ) {
      throw new ReviewError(400, 'BAD_REQUEST', 'invalid decision');
    }
    if (d.verdict === 'reject') {
      if (d.target_id === WILDCARD)
        throw new ReviewError(400, 'BAD_REQUEST', 'reject requires an explicit target_id');
      if (!REJECTABLE.includes(d.target_type as ReviewTargetType))
        throw new ReviewError(400, 'REJECT_NOT_SUPPORTED', `${d.target_type} cannot be rejected`);
    }
    return d as Decision;
  });
}

async function deleteTarget(
  client: DbClient,
  bookId: string,
  type: ReviewTargetType,
  id: string
): Promise<void> {
  const forgetReview = (t: ReviewTargetType, targetId: string) =>
    client.query(
      'DELETE FROM review_records WHERE book_id = $1 AND target_type = $2 AND target_id = $3',
      [bookId, t, targetId]
    );

  if (type === 'character') {
    const relationships = await client.query(
      'SELECT id FROM relationships WHERE book_id = $1 AND (character_a_id = $2 OR character_b_id = $2)',
      [bookId, id]
    );
    for (const r of relationships.rows) await forgetReview('relationship', r.id);
    await client.query(
      'DELETE FROM relationships WHERE book_id = $1 AND (character_a_id = $2 OR character_b_id = $2)',
      [bookId, id]
    );
    const notes = await client.query(
      'SELECT id FROM character_notes WHERE book_id = $1 AND character_id = $2',
      [bookId, id]
    );
    for (const n of notes.rows) await forgetReview('character_note', n.id);
    await client.query('DELETE FROM character_notes WHERE book_id = $1 AND character_id = $2', [
      bookId,
      id,
    ]);
    const aliases = await client.query(
      'SELECT alias FROM aliases WHERE book_id = $1 AND character_id = $2',
      [bookId, id]
    );
    for (const a of aliases.rows) await forgetReview('alias', `${id}::${a.alias}`);
    await client.query('DELETE FROM aliases WHERE book_id = $1 AND character_id = $2', [
      bookId,
      id,
    ]);
    await client.query('DELETE FROM characters WHERE book_id = $1 AND id = $2', [bookId, id]);
  } else if (type === 'chapter_key_point') {
    // 결정 31 — 핵심 한 줄만 비운다. 장 요약 행은 남는다(화면은 요약 첫 문장으로 대신한다)
    await client.query(
      "UPDATE chapter_summaries SET key_point = NULL, key_point_review_status = 'rejected' WHERE book_id = $1 AND chapter_no = $2",
      [bookId, Number(id)]
    );
  } else if (type === 'alias') {
    const split = id.indexOf('::');
    await client.query(
      'DELETE FROM aliases WHERE book_id = $1 AND character_id = $2 AND alias = $3',
      [bookId, id.slice(0, split), id.slice(split + 2)]
    );
  } else {
    const table = {
      character_note: 'character_notes',
      relationship: 'relationships',
      term: 'terms',
      event: 'events',
    }[type as 'character_note' | 'relationship' | 'term' | 'event'];
    await client.query(`DELETE FROM ${table} WHERE book_id = $1 AND id = $2`, [bookId, id]);
  }
  await forgetReview(type, id);
}

function readIntegrity(bookId: string): unknown {
  const file = path.join(
    bookArgsFor({ bookId, filePath: '', title: '', author: '' }).fullDir,
    'integrity-report.json'
  );
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// FR-ADM-005 🚦, FR-ADM-006 🚦
export function createReviewService(deps: {
  db: Db;
  jobs: JobRepository;
  publish?: (client: QueryClient, bookId: string) => Promise<ReviewCompletionReport>;
  loadIntegrity?: (bookId: string) => unknown;
  loadHeld?: (bookId: string) => unknown;
  loadHeldCandidates?: (bookId: string) => unknown;
}): ReviewService {
  const { db, jobs } = deps;
  const publish = deps.publish ?? publishBook;
  const loadIntegrity = deps.loadIntegrity ?? readIntegrity;
  const loadHeld = deps.loadHeld ?? readHeldItems;
  const loadHeldCandidates = deps.loadHeldCandidates ?? readHeldCandidates;

  return {
    async getReview(bookId) {
      const job = await jobs.findByBookId(bookId);
      if (!job) return null;
      const book = (
        await db.query(
          'SELECT book_id, title, author, publish_year, total_pages, publish_status, ssabi_ready FROM books WHERE book_id = $1',
          [bookId]
        )
      ).rows[0];
      if (!book) return null;

      const q = async (sql: string) => (await db.query(sql, [bookId])).rows;
      const [pages, characters, aliases, notes, relationships, summaries, terms, events, extras] =
        await Promise.all([
          q(
            `SELECT p.page_no, left(p.content, ${EXCERPT_LENGTH}) AS excerpt
               FROM pages p JOIN chapters c ON c.book_id = p.book_id AND c.start_page = p.page_no
              WHERE p.book_id = $1 ORDER BY p.page_no`
          ),
          q(
            'SELECT id, name, first_appearance_page FROM characters WHERE book_id = $1 ORDER BY first_appearance_page, name'
          ),
          q(
            'SELECT character_id, alias, alias_type, first_appearance_page FROM aliases WHERE book_id = $1 ORDER BY first_appearance_page'
          ),
          q(
            'SELECT id, character_id, note, source_page FROM character_notes WHERE book_id = $1 ORDER BY source_page'
          ),
          q(
            `SELECT r.id, a.id AS a_id, a.name AS a_name, b.id AS b_id, b.name AS b_name,
                    r.label, r.established_page, r.semantics
               FROM relationships r
               JOIN characters a ON a.id = r.character_a_id
               JOIN characters b ON b.id = r.character_b_id
              WHERE r.book_id = $1 ORDER BY r.established_page, r.id`
          ),
          q(
            'SELECT chapter_no, summary, key_point FROM chapter_summaries WHERE book_id = $1 ORDER BY chapter_no'
          ),
          q(
            'SELECT id, term, definition, first_appearance_page FROM terms WHERE book_id = $1 ORDER BY first_appearance_page'
          ),
          q(
            'SELECT id, event, description, occurrence_page FROM events WHERE book_id = $1 ORDER BY occurrence_page'
          ),
          q('SELECT kind, content FROM background_and_intro WHERE book_id = $1'),
        ]);
      const review = await checkReviewComplete(db, bookId);

      return {
        book,
        job: { job_id: job.job_id, status: job.status, step: job.step, error: job.error },
        pages_preview: pages,
        characters: characters.map((c) => ({
          ...c,
          aliases: aliases.filter((a) => a.character_id === c.id),
          notes: notes.filter((n) => n.character_id === c.id),
        })),
        relationships: relationships.map((r) => {
          const semantics = r.semantics ?? null;
          const reversed = semantics?.direction === 'b_to_a';
          const verification = semantics?.verification;
          return {
            id: r.id,
            from: reversed ? r.b_name : r.a_name,
            to: reversed ? r.a_name : r.b_name,
            from_id: reversed ? r.b_id : r.a_id,
            to_id: reversed ? r.a_id : r.b_id,
            direction: semantics?.direction ?? null,
            label: r.label,
            established_page: r.established_page,
            quote: semantics?.evidence?.quote ?? null,
            quote_page: semantics?.evidence?.source_page ?? null,
            check: verification?.check ?? 'needs_review',
            reasons: verification?.reasons ?? (verification ? [] : ['not_verified']),
          };
        }),
        chapter_summaries: summaries,
        terms,
        events,
        background_and_intro: extras,
        integrity: loadIntegrity(bookId),
        held: loadHeld(bookId),
        held_candidates: loadHeldCandidates(bookId),
        review,
      };
    },

    async applyDecisions(bookId, body) {
      const decisions = parseDecisions(body);
      const job = await jobs.findByBookId(bookId);
      if (!job) throw new ReviewError(404, 'NOT_FOUND', 'Book not found');
      if (job.status !== 'review_ready')
        throw new ReviewError(409, 'JOB_NOT_REVIEWABLE', `job status is ${job.status}`);

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const existing = new Map<ReviewTargetType, Set<string>>();
        const idsOf = async (type: ReviewTargetType) => {
          if (!existing.has(type)) {
            const rows = (await client.query(LIST_SQL[type], [bookId])).rows;
            existing.set(type, new Set(rows.map((r) => r.target_id as string)));
          }
          return existing.get(type)!;
        };

        const approvals = new Map<string, FilledReviewRow>();
        let rejected = 0;
        for (const d of decisions) {
          const known = await idsOf(d.target_type);
          const ids = d.target_id === WILDCARD ? [...known] : [d.target_id];
          for (const id of ids) {
            if (!known.has(id))
              throw new ReviewError(404, 'TARGET_NOT_FOUND', `${d.target_type}:${id}`);
            if (d.verdict === 'reject') {
              await deleteTarget(client, bookId, d.target_type, id);
              known.delete(id);
              approvals.delete(`${d.target_type}::${id}`);
              rejected++;
            } else {
              const criteria: FilledReviewRow['criteria'] = {};
              for (const c of APPLICABLE_CRITERIA[d.target_type]) criteria[c] = true;
              approvals.set(`${d.target_type}::${id}`, {
                target_type: d.target_type,
                target_id: id,
                criteria,
                corrected_content: null,
                correction_note: null,
                reviewer: REVIEWER,
              });
            }
          }
        }

        const rows = [...approvals.values()];
        const relationshipRows = rows.filter((r) => r.target_type === 'relationship');
        if (relationshipRows.length > 0) {
          const snapshots = await client.query(
            `SELECT id, semantics, ${SNAPSHOT_SQL} AS relationship_snapshot FROM relationships WHERE book_id = $1`,
            [bookId]
          );
          for (const row of relationshipRows) {
            const found = snapshots.rows.find((s) => s.id === row.target_id);
            if (found?.semantics) row.relationship_snapshot = found.relationship_snapshot;
          }
        }
        await applyReviewJudgments(client, bookId, rows);
        await client.query('COMMIT');
        return { approved: rows.length, rejected };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async approve(bookId) {
      const job = await jobs.findByBookId(bookId);
      if (!job) return { kind: 'not_found' };
      if (job.status !== 'review_ready') return { kind: 'not_ready', status: job.status };

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const report = await publish(client, bookId);
        if (!report.complete) {
          await client.query('ROLLBACK');
          return { kind: 'incomplete', missing: report.missing };
        }
        await client.query(
          "UPDATE ingest_jobs SET status = 'published', updated_at = now() WHERE job_id = $1",
          [job.job_id]
        );
        await client.query('COMMIT');
        return { kind: 'published' };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
