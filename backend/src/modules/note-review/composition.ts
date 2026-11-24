import type { Pool } from 'pg';
import { createPgCommunityRepository } from '../community/pg-repository';
import { createPgContentRepository } from '../content/pg-repository';
import { call } from '../llm-gateway/gateway';
import { getModelForTask } from '../llm-gateway/model-config';
import { createPgNotesRepository } from '../notes/pg-repository';
import { createReadingStateServices } from '../reading-state/composition';
import { createPgNoteReviewRepository, createPgReviewEvidenceReader } from './pg-repository';
import { createNoteReviewRouter } from './router';
import { createNoteReviewService } from './service';

/** 게이트웨이 작업 이름 — 지표에서 따로 센다. 모델은 챗봇과 같다 (model-config METRIC_TASK_ALIASES) */
export const NOTE_REVIEW_TASK = 'grade_notes';

export function createNoteReviewRoutes(pool: Pool) {
  const db = { query: (sql: string, params?: unknown[]) => pool.query(sql, params) };
  const service = createNoteReviewService({
    scope: createReadingStateServices(pool).cutoffService,
    notes: createPgNotesRepository(db),
    reviews: createPgNoteReviewRepository(db),
    evidence: createPgReviewEvidenceReader(db),
    // 절대 규칙 4번 — 게이트웨이로만
    llm: (prompt, options) => call(NOTE_REVIEW_TASK, prompt, options),
    model: getModelForTask(NOTE_REVIEW_TASK),
    community: createPgCommunityRepository(db),
  });
  return createNoteReviewRouter({ service, content: createPgContentRepository(db) });
}
