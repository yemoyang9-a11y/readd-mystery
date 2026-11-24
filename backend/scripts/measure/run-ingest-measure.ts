/**
 * 측정용 — 관리자 업로드 작업과 같은 경로(job-repository → runner → createPipelineSteps)로 책 한 권을 등록한다.
 * HTTP 업로드 대신 ingest_jobs 행을 직접 만든다(admin-router POST /books 와 같은 필드).
 * 단계 시작·끝 UTC를 TIMELINE_FILE 에 적는다. 키·결과 숫자는 이 파일에 없다.
 *
 * 사용: BOOK_ID=.. TITLE=.. AUTHOR=.. YEAR=.. SOURCE=<원문> TIMELINE_FILE=<timeline.txt> \
 *   npx ts-node --transpile-only scripts/measure/run-ingest-measure.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { pool } from '../../src/config/database';
import { createPgJobRepository } from '../../src/modules/ingest/job-repository';
import { createJobRunner } from '../../src/modules/ingest/runner';
import { createPipelineSteps, PipelineStepName, STEP_ORDER } from '../../src/modules/ingest/steps';
import { invalidateFailedOutput } from '../../src/modules/ingest/integrity';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} 필요`);
  return v;
};

function stamp(line: string) {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(`[timeline] ${text}`);
  fs.appendFileSync(env('TIMELINE_FILE'), text + '\n');
}

async function main() {
  const bookId = env('BOOK_ID');
  const source = path.resolve(env('SOURCE'));
  const text = fs.readFileSync(source, 'utf-8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const sha = createHash('sha256').update(text, 'utf-8').digest('hex');
  const jobs = createPgJobRepository(pool);
  let job = await jobs.findByBookId(bookId);
  if (!job) {
    const created = await jobs.create({
      job_id: randomUUID(),
      book_id: bookId,
      title: env('TITLE'),
      author: env('AUTHOR'),
      publish_year: process.env.YEAR ? Number(process.env.YEAR) : null,
      source_sha256: sha,
      source_path: source,
    });
    job = created.job;
    stamp(`job_created job_id=${job.job_id} book=${bookId}`);
  } else {
    stamp(`job_exists job_id=${job.job_id} status=${job.status} step=${job.step} (재개)`);
  }

  const real = createPipelineSteps(pool);
  const steps = { ...real } as typeof real;
  for (const name of Object.keys(real) as PipelineStepName[]) {
    steps[name] = async (ctx) => {
      stamp(`${name} START`);
      try {
        await real[name](ctx);
        stamp(`${name} END ok`);
      } catch (e) {
        stamp(`${name} END FAIL ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
        throw e;
      }
    };
  }
  const runner = createJobRunner({
    jobs,
    steps,
    invalidateFailedOutput: ({ args }) => invalidateFailedOutput(args),
  });
  stamp(`ALL START (order: ${STEP_ORDER.join(' > ')})`);
  await runner.startJob(job.job_id);
  const done = await jobs.findById(job.job_id);
  stamp(`ALL END status=${done?.status} step=${done?.step} error=${done?.error ?? ''}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
