/**
 * AI 원가 측정용 — 관리자 업로드와 같은 경로(job-repository + runner + createPipelineSteps)로
 * 도서 1권의 업로드 작업을 처음부터 끝(review_ready)까지 돌린다. 단계마다 시작·끝 UTC를 TIMELINE_FILE에 적는다.
 * 사용: BOOK_ID=main BOOK_TITLE=마인 BOOK_AUTHOR=김내성 BOOK_YEAR=1939 BOOK_FILE=<원문> TIMELINE_FILE=<파일> \
 *       npx ts-node --transpile-only scripts/measure/run-ingest-job-main.ts
 * 측정 전용 — 운영 코드는 건드리지 않는다.
 */
import * as fs from 'fs';
import { createHash, randomUUID } from 'crypto';
import { pool } from '../../src/config/database';
import { createPgJobRepository } from '../../src/modules/ingest/job-repository';
import { createJobRunner } from '../../src/modules/ingest/runner';
import { createPipelineSteps, PipelineSteps, PipelineStepName } from '../../src/modules/ingest/steps';

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} 필요`);
  return v;
};

function stamp(line: string): void {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(`[timeline] ${text}`);
  fs.appendFileSync(env('TIMELINE_FILE'), text + '\n');
}

async function main(): Promise<void> {
  const bookId = env('BOOK_ID');
  const file = env('BOOK_FILE');
  const text = fs.readFileSync(file, 'utf-8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const sha = createHash('sha256').update(text, 'utf-8').digest('hex');
  const jobs = createPgJobRepository(pool);
  const created = await jobs.create({
    job_id: randomUUID(),
    book_id: bookId,
    title: env('BOOK_TITLE'),
    author: env('BOOK_AUTHOR'),
    publish_year: Number(process.env.BOOK_YEAR) || null,
    source_sha256: sha,
    source_path: file,
  });
  console.log(`[job] created=${created.created} job_id=${created.job.job_id} status=${created.job.status} step=${created.job.step}`);

  const base = createPipelineSteps(pool);
  const steps = {} as PipelineSteps;
  for (const name of Object.keys(base) as PipelineStepName[]) {
    steps[name] = async (ctx) => {
      stamp(`START ${name}`);
      try {
        await base[name](ctx);
        stamp(`END ${name} ok`);
      } catch (err) {
        stamp(`END ${name} FAILED ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`);
        throw err;
      }
    };
  }
  const runner = createJobRunner({ jobs, steps });
  await runner.startJob(created.job.job_id);
  const after = await jobs.findById(created.job.job_id);
  stamp(`JOB status=${after?.status} step=${after?.step} error=${(after?.error ?? '').slice(0, 300)}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
