import { createReviewService, ReviewError } from '../review-service';
import { MemoryJobRepository } from './fakes';

interface Call {
  sql: string;
  params?: unknown[];
}

function fakeDb(rowsFor: (sql: string) => unknown[] = () => []) {
  const calls: Call[] = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows: rowsFor(sql) as any[] };
    },
    release: jest.fn(),
  };
  return {
    calls,
    client,
    db: { query: client.query, connect: async () => client },
  };
}

async function reviewReadyJobs() {
  const jobs = new MemoryJobRepository();
  const { job } = await jobs.create({
    job_id: '11111111-1111-4111-8111-111111111111',
    book_id: 'bk-abc',
    title: 't',
    author: 'a',
    publish_year: null,
    source_sha256: 's',
    source_path: '/x',
  });
  await jobs.update(job.job_id, { status: 'review_ready', step: 'review_ready' });
  return jobs;
}

describe('review service', () => {
  test('FR-ADM-006: 미검수 남은 상태 approve → incomplete, 롤백, publish_status·작업 상태 변화 없음', async () => {
    const jobs = await reviewReadyJobs();
    const { db, calls } = fakeDb();
    const publish = jest.fn().mockImplementation(async (client) => {
      await client.query("UPDATE books SET publish_status = 'published'");
      return {
        complete: false,
        missing: [{ target_type: 'term', target_id: 't1', missing_criteria: ['hallucination_ok'] }],
      };
    });
    const service = createReviewService({ db, jobs, publish });

    const result = await service.approve('bk-abc');

    expect(result).toMatchObject({ kind: 'incomplete', missing: [{ target_id: 't1' }] });
    const sqls = calls.map((c) => c.sql);
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(sqls.some((s) => s.includes('ingest_jobs'))).toBe(false);
    expect((await jobs.findByBookId('bk-abc'))?.status).toBe('review_ready');
  });

  test('FR-ADM-006: 전부 검수되면 approve → 공개 전환과 작업 published를 한 트랜잭션으로 커밋', async () => {
    const jobs = await reviewReadyJobs();
    const { db, calls } = fakeDb();
    const publish = jest.fn().mockResolvedValue({ complete: true, missing: [] });

    const result = await createReviewService({ db, jobs, publish }).approve('bk-abc');

    expect(result).toEqual({ kind: 'published' });
    const sqls = calls.map((c) => c.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.some((s) => s.includes("UPDATE ingest_jobs SET status = 'published'"))).toBe(true);
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(publish).toHaveBeenCalledWith(expect.anything(), 'bk-abc');
  });

  test('FR-ADM-006: 생성이 끝나지 않은 작업(running·failed)은 검수 항목이 비어 있어도 공개하지 않는다', async () => {
    const jobs = await reviewReadyJobs();
    const publish = jest.fn().mockResolvedValue({ complete: true, missing: [] });
    const { db } = fakeDb();
    const service = createReviewService({ db, jobs, publish });

    for (const status of ['queued', 'running', 'failed'] as const) {
      await jobs.update('11111111-1111-4111-8111-111111111111', { status });
      expect(await service.approve('bk-abc')).toEqual({ kind: 'not_ready', status });
    }
    expect(await service.approve('bk-none')).toEqual({ kind: 'not_found' });
    expect(publish).not.toHaveBeenCalled();
  });

  test('FR-ADM-006: 이미 published인 작업은 다시 approve할 수 없다', async () => {
    const jobs = await reviewReadyJobs();
    await jobs.update('11111111-1111-4111-8111-111111111111', { status: 'published' });
    const publish = jest.fn();

    const result = await createReviewService({ db: fakeDb().db, jobs, publish }).approve('bk-abc');

    expect(result).toEqual({ kind: 'not_ready', status: 'published' });
    expect(publish).not.toHaveBeenCalled();
  });

  test('FR-ADM-005: 검수 화면은 보류된 항목(held)과 보류 후보 집계를 함께 돌려준다', async () => {
    const jobs = await reviewReadyJobs();
    const { db } = fakeDb((sql) =>
      sql.includes('FROM books WHERE book_id') ? [{ book_id: 'bk-abc' }] : []
    );
    const held = [{ target_type: 'term', label: '미두장', reasons: ['page_out_of_range: 0'] }];
    const candidates = [{ kind: 'relationship', reason: 'r', count: 3 }];
    const service = createReviewService({
      db,
      jobs,
      loadIntegrity: () => null,
      loadHeld: () => held,
      loadHeldCandidates: () => candidates,
    });

    const view = await service.getReview('bk-abc');

    expect(view).toMatchObject({ held, held_candidates: candidates });
  });

  test('FR-ADM-005: 잘못된 decisions 본문은 400이고 DB에 접근하지 않는다', async () => {
    const jobs = await reviewReadyJobs();
    const { db, calls } = fakeDb();
    const service = createReviewService({ db, jobs });
    const bad: unknown[] = [
      undefined,
      {},
      { decisions: [] },
      { decisions: [{ target_type: 'term', target_id: 't1', verdict: 'maybe' }] },
      { decisions: [{ target_type: 'nope', target_id: 't1', verdict: 'approve' }] },
      { decisions: [{ target_type: 'term', target_id: '*', verdict: 'reject' }] },
      { decisions: [{ target_type: 'background', target_id: 'background', verdict: 'reject' }] },
    ];

    for (const body of bad) {
      await expect(service.applyDecisions('bk-abc', body)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(calls).toHaveLength(0);
  });

  test('FR-ADM-005: 검수 결정은 review_ready 작업에만 받는다', async () => {
    const jobs = await reviewReadyJobs();
    await jobs.update('11111111-1111-4111-8111-111111111111', { status: 'running' });
    const service = createReviewService({ db: fakeDb().db, jobs });

    await expect(
      service.applyDecisions('bk-abc', {
        decisions: [{ target_type: 'term', target_id: 't1', verdict: 'approve' }],
      })
    ).rejects.toMatchObject({ status: 409, code: 'JOB_NOT_REVIEWABLE' });
  });

  test('FR-ADM-005: 승인 결정은 적용 항목 전부 TRUE인 review_records를 만들고 거절은 대상을 삭제한다', async () => {
    const jobs = await reviewReadyJobs();
    const { db, calls } = fakeDb((sql) => {
      if (sql.includes('FROM terms WHERE book_id'))
        return [{ target_id: 't1' }, { target_id: 't2' }];
      return [];
    });
    const service = createReviewService({ db, jobs });

    const result = await service.applyDecisions('bk-abc', {
      decisions: [
        { target_type: 'term', target_id: '*', verdict: 'approve' },
        { target_type: 'term', target_id: 't2', verdict: 'reject' },
      ],
    });

    expect(result).toEqual({ approved: 1, rejected: 1 });
    const insert = calls.find((c) => c.sql.includes('INSERT INTO review_records'));
    expect(insert?.params?.slice(2, 5)).toEqual(['term', 't1', true]);
    expect(insert?.params?.[6]).toBe(true);
    expect(insert?.params?.[8]).toBe(true);
    expect(calls.some((c) => c.sql.startsWith('DELETE FROM terms') && c.params?.[1] === 't2')).toBe(
      true
    );
    expect(calls.map((c) => c.sql)).toContain('COMMIT');
  });

  test('FR-ADM-005: 없는 대상을 결정하면 404이고 롤백한다', async () => {
    const jobs = await reviewReadyJobs();
    const { db, calls } = fakeDb();
    const service = createReviewService({ db, jobs });

    const error = await service
      .applyDecisions('bk-abc', {
        decisions: [{ target_type: 'term', target_id: 'ghost', verdict: 'approve' }],
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ReviewError);
    expect(error.status).toBe(404);
    expect(calls.map((c) => c.sql)).toContain('ROLLBACK');
    expect(calls.some((c) => c.sql.includes('INSERT INTO review_records'))).toBe(false);
  });
});

describe('review service — 장 핵심 한 줄 (결정 31)', () => {
  test('FR-ADM-005: 핵심 한 줄 거절은 문장을 비우고 rejected 로 둔다 — 장 요약은 그대로', async () => {
    const jobs = await reviewReadyJobs();
    const { db, calls } = fakeDb((sql) =>
      sql.includes('key_point IS NOT NULL') ? [{ target_id: '1' }, { target_id: '2' }] : []
    );
    const service = createReviewService({ db, jobs });

    const result = await service.applyDecisions('bk-abc', {
      decisions: [
        { target_type: 'chapter_key_point', target_id: '*', verdict: 'approve' },
        { target_type: 'chapter_key_point', target_id: '2', verdict: 'reject' },
      ],
    });

    expect(result).toEqual({ approved: 1, rejected: 1 });
    const clear = calls.find((c) => /UPDATE chapter_summaries/.test(c.sql));
    expect(clear?.sql).toMatch(/key_point = NULL/);
    expect(clear?.sql).toMatch(/key_point_review_status = 'rejected'/);
    expect(clear?.params).toEqual(['bk-abc', 2]);
    expect(calls.some((c) => /DELETE FROM chapter_summaries/.test(c.sql))).toBe(false);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO review_records'));
    expect(insert?.params?.slice(2, 4)).toEqual(['chapter_key_point', '1']);
  });

  test('FR-ADM-005: 검수 화면은 장 요약과 함께 핵심 한 줄을 보여 준다', async () => {
    const jobs = await reviewReadyJobs();
    const { db, calls } = fakeDb((sql) =>
      sql.includes('FROM books WHERE book_id') ? [{ book_id: 'bk-abc' }] : []
    );
    const service = createReviewService({
      db,
      jobs,
      loadIntegrity: () => null,
      loadHeld: () => [],
      loadHeldCandidates: () => [],
    });
    await service.getReview('bk-abc');
    expect(
      calls.some((c) => /SELECT chapter_no, summary, key_point FROM chapter_summaries/.test(c.sql))
    ).toBe(true);
  });
});
