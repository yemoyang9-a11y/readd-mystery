/**
 * AI 원가 측정용 — 로컬 DB에서만, 관리자 검수 승인 경로(review-service)로 책을 공개 상태로 만든다.
 * 사람이 검수하지 않고 측정을 위해 일괄 승인한다(대상 종류별 '*' approve → 최종 승인). 운영 DB에 쓰지 않는다.
 * 사용: BOOK_ID=main DB_HOST=/tmp ... npx ts-node --transpile-only scripts/measure/approve-local-main.ts
 */
import { pool } from '../../src/config/database';
import { createPgJobRepository } from '../../src/modules/ingest/job-repository';
import { createReviewService } from '../../src/modules/ingest/review-service';
import { APPLICABLE_CRITERIA } from '../../src/batch/pipeline/review';

async function main(): Promise<void> {
  // 로컬 측정 DB 전용 — config/database.ts 는 DATABASE_URL 이 있으면 그쪽을 먼저 쓰므로 그것도 막는다
  if (
    process.env.DATABASE_URL ||
    process.env.DB_HOST !== '/tmp' ||
    process.env.DB_NAME !== 'readd_measure'
  ) {
    throw new Error('로컬 측정 DB가 아니다 (DATABASE_URL 없이 DB_HOST=/tmp, DB_NAME=readd_measure 만 허용)');
  }
  const bookId = process.env.BOOK_ID as string;
  const review = createReviewService({ db: pool, jobs: createPgJobRepository(pool) });
  const decisions = Object.keys(APPLICABLE_CRITERIA).map((t) => ({
    target_type: t,
    target_id: '*',
    verdict: 'approve',
  }));
  console.log('applyDecisions', await review.applyDecisions(bookId, { decisions }));
  console.log('approve', JSON.stringify(await review.approve(bookId)));
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
