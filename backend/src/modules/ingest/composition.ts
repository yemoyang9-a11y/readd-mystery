import * as path from 'path';
import { pool } from '../../config/database';
import { createAdminRouter } from './admin-router';
import { createPgJobRepository } from './job-repository';
import { createJobRunner } from './runner';
import { createReviewService } from './review-service';
import { invalidateFailedOutput } from './integrity';
import { createPipelineSteps } from './steps';

const UPLOAD_DIR = path.join(__dirname, '../../../data/uploads');

const jobs = createPgJobRepository(pool);
const runner = createJobRunner({
  jobs,
  steps: createPipelineSteps(pool),
  invalidateFailedOutput: ({ args }) => invalidateFailedOutput(args),
});

// FR-ADM-006 🚦
export const adminRouter = createAdminRouter({
  jobs,
  runner,
  review: createReviewService({ db: pool, jobs }),
  uploadDir: UPLOAD_DIR,
});

export function resumeIngestJobs(): Promise<void> {
  return runner.resumeRunningJobs();
}
