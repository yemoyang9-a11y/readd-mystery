import { IngestJob, JobRepository } from './job-repository';
import { PipelineSteps, STEP_ORDER, StepContext, argsFromJob } from './steps';

const ERROR_LIMIT = 2000;

export interface JobRunner {
  startJob(jobId: string): Promise<void>;
  retryJob(jobId: string): Promise<void>;
  resumeRunningJobs(): Promise<void>;
}

// FR-ADM-005 🚦, FR-ADM-006 🚦
export function createJobRunner(deps: {
  jobs: JobRepository;
  steps: PipelineSteps;
  contextFor?: (job: IngestJob) => StepContext;
  invalidateFailedOutput?: (context: StepContext) => void;
}): JobRunner {
  const { jobs, steps } = deps;
  const contextFor = deps.contextFor ?? ((job: IngestJob) => ({ job, args: argsFromJob(job) }));
  const active = new Set<string>();

  async function startJob(jobId: string): Promise<void> {
    if (active.has(jobId)) return;
    active.add(jobId);
    try {
      const found = await jobs.findById(jobId);
      if (!found || found.status === 'review_ready' || found.status === 'published') return;
      let job = (await jobs.update(jobId, { status: 'running', error: null })) ?? found;
      for (let i = STEP_ORDER.indexOf(job.step); i < STEP_ORDER.length - 1; i++) {
        const step = STEP_ORDER[i];
        if (step === 'review_ready') break;
        try {
          await steps[step](contextFor(job));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[ingest] ${job.book_id} ${step} 실패`, err);
          await jobs.update(jobId, {
            status: 'failed',
            step,
            error: message.slice(0, ERROR_LIMIT),
          });
          return;
        }
        const next = STEP_ORDER[i + 1];
        job =
          (await jobs.update(jobId, {
            step: next,
            ...(next === 'review_ready' ? { status: 'review_ready' as const } : {}),
          })) ?? job;
      }
    } finally {
      active.delete(jobId);
    }
  }

  // FR-ADM-005 🚦
  async function retryJob(jobId: string): Promise<void> {
    const job = await jobs.findById(jobId);
    if (!job || job.status !== 'failed') return;
    if (job.step === 'generate' || job.step === 'integrity') {
      deps.invalidateFailedOutput?.(contextFor(job));
      await jobs.update(jobId, { step: 'generate' });
    }
    await startJob(jobId);
  }

  async function resumeRunningJobs(): Promise<void> {
    for (const job of await jobs.listByStatus(['running', 'queued'])) {
      await startJob(job.job_id);
    }
  }

  return { startJob, retryJob, resumeRunningJobs };
}
