import { Pool } from 'pg';
import { BookArgs, bookArgsFor } from '../../batch/pipeline/run-args';
import { registerSource } from '../../batch/pipeline/run-register';
import { generateFullBook } from '../../batch/pipeline/run-generate-full';
import { sanitizeResolved } from '../../batch/pipeline/sanitize-resolved';
import { runIntegrityStep } from './integrity';
import { registerContent } from '../../batch/pipeline/run-register-content';
import { embedBookPages } from '../../batch/pipeline/run-embed-pages';
import { IngestJob, JobStep } from './job-repository';

// FR-ADM-005 🚦
export const STEP_ORDER: JobStep[] = [
  'split_register',
  'generate',
  'integrity',
  'register_content',
  'embed',
  'review_ready',
];

export type PipelineStepName = Exclude<JobStep, 'review_ready'>;

export interface StepContext {
  job: IngestJob;
  args: BookArgs;
}

export type StepFn = (context: StepContext) => Promise<void>;
export type PipelineSteps = Record<PipelineStepName, StepFn>;

export function argsFromJob(job: IngestJob): BookArgs {
  return bookArgsFor({
    bookId: job.book_id,
    filePath: job.source_path,
    title: job.title,
    author: job.author,
    publishYear: job.publish_year ?? undefined,
  });
}

// FR-ADM-006 🚦
export function createPipelineSteps(db: Pool): PipelineSteps {
  return {
    async split_register({ args }) {
      await registerSource(db, args);
    },
    async generate({ args }) {
      await generateFullBook(args);
    },
    async integrity({ args }) {
      runIntegrityStep(args);
    },
    async register_content({ args }) {
      const existing = await db.query(
        'SELECT 1 FROM chapter_summaries WHERE book_id = $1 LIMIT 1',
        [args.bookId]
      );
      if (existing.rows.length > 0) return;
      await registerContent(
        db,
        args,
        false,
        (data, totalPages) => sanitizeResolved(data, totalPages).data
      );
    },
    async embed({ args }) {
      await embedBookPages(db, args.bookId);
    },
  };
}
