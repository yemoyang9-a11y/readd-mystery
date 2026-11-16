import {
  CreateJobResult,
  IngestJob,
  JobPatch,
  JobRepository,
  JobStatus,
  NewJob,
} from '../job-repository';
import { PipelineSteps } from '../steps';

export class MemoryJobRepository implements JobRepository {
  readonly jobs: IngestJob[] = [];

  async create(job: NewJob): Promise<CreateJobResult> {
    const existing = this.jobs.find(
      (j) => j.source_sha256 === job.source_sha256 || j.book_id === job.book_id
    );
    if (existing) return { created: false, job: existing };
    const now = new Date().toISOString();
    const created: IngestJob = {
      ...job,
      status: 'queued',
      step: 'split_register',
      error: null,
      created_at: now,
      updated_at: now,
    };
    this.jobs.push(created);
    return { created: true, job: created };
  }

  async findById(jobId: string) {
    return this.jobs.find((j) => j.job_id === jobId) ?? null;
  }

  async findByBookId(bookId: string) {
    return this.jobs.find((j) => j.book_id === bookId) ?? null;
  }

  async list() {
    return [...this.jobs];
  }

  async listByStatus(statuses: JobStatus[]) {
    return this.jobs.filter((j) => statuses.includes(j.status));
  }

  async update(jobId: string, patch: JobPatch) {
    const job = this.jobs.find((j) => j.job_id === jobId);
    if (!job) return null;
    if (patch.status !== undefined) job.status = patch.status;
    if (patch.step !== undefined) job.step = patch.step;
    if (patch.error !== undefined) job.error = patch.error;
    job.updated_at = new Date().toISOString();
    return job;
  }
}

export function fakeSteps(calls: string[] = []): PipelineSteps {
  const step = (name: string) => async () => {
    calls.push(name);
  };
  return {
    split_register: step('split_register'),
    generate: step('generate'),
    integrity: step('integrity'),
    register_content: step('register_content'),
    embed: step('embed'),
  };
}
