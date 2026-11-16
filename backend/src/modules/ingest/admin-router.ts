import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import express, { ErrorRequestHandler, Request, RequestHandler, Response, Router } from 'express';
import { parseChapters } from '../../batch/pipeline/split';
import { adminAuth } from './admin-auth';
import { IngestJob, JobRepository } from './job-repository';
import { JobRunner } from './runner';
import { ReviewError, ReviewService } from './review-service';

const UPLOAD_LIMIT = '5mb';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function summary(job: IngestJob) {
  return {
    job_id: job.job_id,
    book_id: job.book_id,
    title: job.title,
    status: job.status,
    step: job.step,
    error: job.error,
    updated_at: job.updated_at,
  };
}

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;

function handle(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: 'BAD_REQUEST', message });
}

// FR-ADM-005 🚦, FR-ADM-006 🚦
export function createAdminRouter(deps: {
  jobs: JobRepository;
  runner: Pick<JobRunner, 'startJob' | 'retryJob'>;
  review: ReviewService;
  uploadDir: string;
  getToken?: () => string | undefined;
}): Router {
  const { jobs, runner, review, uploadDir } = deps;
  const router = Router();

  router.use(adminAuth(deps.getToken));
  router.use(express.json());

  router.post(
    '/books',
    express.text({ type: 'text/plain', limit: UPLOAD_LIMIT }),
    handle(async (req: Request, res: Response) => {
      const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';
      const author = typeof req.query.author === 'string' ? req.query.author.trim() : '';
      const yearParam = typeof req.query.year === 'string' ? req.query.year.trim() : '';
      if (!title || !author) return badRequest(res, 'title and author are required');
      const year = yearParam === '' ? null : Number(yearParam);
      if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 3000))
        return badRequest(res, 'year must be an integer');
      if (typeof req.body !== 'string' || req.body.trim() === '')
        return badRequest(res, 'text/plain body is required');

      const text = req.body.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      if (parseChapters(text).length === 0)
        return badRequest(res, 'no chapter headers ("번호 제목") found in text');

      const sha = createHash('sha256').update(text, 'utf-8').digest('hex');
      const bookId = `bk-${sha.slice(0, 10)}`;
      const sourcePath = path.join(uploadDir, `${bookId}.txt`);
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(sourcePath, text, 'utf-8');

      const result = await jobs.create({
        job_id: randomUUID(),
        book_id: bookId,
        title,
        author,
        publish_year: year,
        source_sha256: sha,
        source_path: sourcePath,
      });
      if (!result.created) {
        return res.status(409).json({
          error: 'DUPLICATE_SOURCE',
          book_id: result.job.book_id,
          job_id: result.job.job_id,
        });
      }
      void runner.startJob(result.job.job_id);
      return res.status(201).json({ book_id: result.job.book_id, job_id: result.job.job_id });
    })
  );

  router.get(
    '/jobs',
    handle(async (_req, res) => {
      res.json((await jobs.list()).map(summary));
    })
  );

  router.get(
    '/jobs/:jobId',
    handle(async (req, res) => {
      const job = UUID_RE.test(req.params.jobId) ? await jobs.findById(req.params.jobId) : null;
      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Job not found' });
      return res.json({
        ...summary(job),
        author: job.author,
        publish_year: job.publish_year,
        created_at: job.created_at,
      });
    })
  );

  router.post(
    '/jobs/:jobId/retry',
    handle(async (req, res) => {
      const job = UUID_RE.test(req.params.jobId) ? await jobs.findById(req.params.jobId) : null;
      if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'Job not found' });
      if (job.status !== 'failed')
        return res
          .status(409)
          .json({ error: 'NOT_FAILED', message: `job status is ${job.status}` });
      void runner.retryJob(job.job_id);
      return res.status(202).json({ job_id: job.job_id });
    })
  );

  router.get(
    '/books/:bookId/review',
    handle(async (req, res) => {
      const view = await review.getReview(req.params.bookId);
      if (!view) return res.status(404).json({ error: 'NOT_FOUND', message: 'Book not found' });
      return res.json(view);
    })
  );

  router.post(
    '/books/:bookId/review',
    handle(async (req, res) => {
      const result = await review.applyDecisions(req.params.bookId, req.body);
      return res.json(result);
    })
  );

  router.post(
    '/books/:bookId/approve',
    handle(async (req, res) => {
      const result = await review.approve(req.params.bookId);
      switch (result.kind) {
        case 'published':
          return res.json({ book_id: req.params.bookId, publish_status: 'published' });
        case 'not_found':
          return res.status(404).json({ error: 'NOT_FOUND', message: 'Book not found' });
        case 'not_ready':
          return res
            .status(409)
            .json({ error: 'JOB_NOT_REVIEWABLE', message: `job status is ${result.status}` });
        case 'incomplete':
          return res.status(409).json({ error: 'REVIEW_INCOMPLETE', missing: result.missing });
      }
    })
  );

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ReviewError) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
    }
    const status = typeof err?.status === 'number' ? err.status : 500;
    if (status < 500)
      return res.status(status).json({ error: 'BAD_REQUEST', message: err.message });
    console.error('[admin] error', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  };
  router.use(onError);

  return router;
}
