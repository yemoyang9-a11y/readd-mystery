// FR-ADM-005 🚦
export type JobStep =
  'split_register' | 'generate' | 'integrity' | 'register_content' | 'embed' | 'review_ready';

export type JobStatus = 'queued' | 'running' | 'failed' | 'review_ready' | 'published';

export interface IngestJob {
  job_id: string;
  book_id: string;
  title: string;
  author: string;
  publish_year: number | null;
  source_sha256: string;
  source_path: string;
  status: JobStatus;
  step: JobStep;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewJob {
  job_id: string;
  book_id: string;
  title: string;
  author: string;
  publish_year: number | null;
  source_sha256: string;
  source_path: string;
}

export type CreateJobResult = { created: boolean; job: IngestJob };

export interface JobPatch {
  status?: JobStatus;
  step?: JobStep;
  error?: string | null;
}

export interface JobRepository {
  create(job: NewJob): Promise<CreateJobResult>;
  findById(jobId: string): Promise<IngestJob | null>;
  findByBookId(bookId: string): Promise<IngestJob | null>;
  list(): Promise<IngestJob[]>;
  listByStatus(statuses: JobStatus[]): Promise<IngestJob[]>;
  update(jobId: string, patch: JobPatch): Promise<IngestJob | null>;
}

interface QueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

const COLUMNS = `job_id, book_id, title, author, publish_year, source_sha256, source_path,
  status, step, error, created_at, updated_at`;

function toJob(row: any): IngestJob {
  return {
    ...row,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

export function createPgJobRepository(db: QueryClient): JobRepository {
  return {
    async create(job) {
      const inserted = await db.query(
        `INSERT INTO ingest_jobs (job_id, book_id, title, author, publish_year, source_sha256, source_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING
         RETURNING ${COLUMNS}`,
        [
          job.job_id,
          job.book_id,
          job.title,
          job.author,
          job.publish_year,
          job.source_sha256,
          job.source_path,
        ]
      );
      if (inserted.rows.length === 1) return { created: true, job: toJob(inserted.rows[0]) };
      const existing = await db.query(
        `SELECT ${COLUMNS} FROM ingest_jobs WHERE source_sha256 = $1 OR book_id = $2`,
        [job.source_sha256, job.book_id]
      );
      return { created: false, job: toJob(existing.rows[0]) };
    },

    async findById(jobId) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM ingest_jobs WHERE job_id = $1`, [
        jobId,
      ]);
      return rows.length === 0 ? null : toJob(rows[0]);
    },

    async findByBookId(bookId) {
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM ingest_jobs WHERE book_id = $1`, [
        bookId,
      ]);
      return rows.length === 0 ? null : toJob(rows[0]);
    },

    async list() {
      const { rows } = await db.query(
        `SELECT ${COLUMNS} FROM ingest_jobs ORDER BY created_at DESC`
      );
      return rows.map(toJob);
    },

    async listByStatus(statuses) {
      const { rows } = await db.query(
        `SELECT ${COLUMNS} FROM ingest_jobs WHERE status = ANY($1::text[]) ORDER BY created_at`,
        [statuses]
      );
      return rows.map(toJob);
    },

    async update(jobId, patch) {
      const { rows } = await db.query(
        `UPDATE ingest_jobs SET
           status = COALESCE($2, status),
           step = COALESCE($3, step),
           error = CASE WHEN $4::boolean THEN $5 ELSE error END,
           updated_at = now()
         WHERE job_id = $1
         RETURNING ${COLUMNS}`,
        [
          jobId,
          patch.status ?? null,
          patch.step ?? null,
          patch.error !== undefined,
          patch.error ?? null,
        ]
      );
      return rows.length === 0 ? null : toJob(rows[0]);
    },
  };
}
