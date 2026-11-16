import { createJobRunner } from '../runner';
import { JobStep } from '../job-repository';
import { MemoryJobRepository, fakeSteps } from './fakes';

const JOB_ID = '11111111-1111-4111-8111-111111111111';

async function seed(jobs: MemoryJobRepository, step: JobStep = 'split_register') {
  const { job } = await jobs.create({
    job_id: JOB_ID,
    book_id: 'bk-abc',
    title: '가상범인',
    author: '김내성',
    publish_year: 1937,
    source_sha256: 'abc',
    source_path: '/tmp/none.txt',
  });
  await jobs.update(job.job_id, { step });
  return job;
}

describe('ingest job runner', () => {
  test('FR-ADM-005: 모든 단계를 순서대로 실행하고 review_ready에서 멈춘다', async () => {
    const jobs = new MemoryJobRepository();
    const calls: string[] = [];
    await seed(jobs);
    await createJobRunner({ jobs, steps: fakeSteps(calls) }).startJob(JOB_ID);

    expect(calls).toEqual(['split_register', 'generate', 'integrity', 'register_content', 'embed']);
    expect(jobs.jobs[0]).toMatchObject({
      status: 'review_ready',
      step: 'review_ready',
      error: null,
    });
  });

  test('FR-ADM-006: generate 단계에서 실패 → status=failed, 다음 단계 미실행(공개 전환 단계 없음)', async () => {
    const jobs = new MemoryJobRepository();
    const calls: string[] = [];
    const steps = fakeSteps(calls);
    steps.generate = async () => {
      calls.push('generate');
      throw new Error('LLM 호출 실패');
    };
    await seed(jobs);
    await createJobRunner({ jobs, steps }).startJob(JOB_ID);

    expect(calls).toEqual(['split_register', 'generate']);
    expect(jobs.jobs[0]).toMatchObject({
      status: 'failed',
      step: 'generate',
      error: 'LLM 호출 실패',
    });
  });

  test('FR-ADM-005: split_register 완료 후 재시작 → split을 다시 호출하지 않고 generate부터', async () => {
    const jobs = new MemoryJobRepository();
    const calls: string[] = [];
    await seed(jobs, 'generate');
    await jobs.update(JOB_ID, { status: 'running' });

    await createJobRunner({ jobs, steps: fakeSteps(calls) }).resumeRunningJobs();

    expect(calls).not.toContain('split_register');
    expect(calls).toEqual(['generate', 'integrity', 'register_content', 'embed']);
    expect(jobs.jobs[0].status).toBe('review_ready');
  });

  test('FR-ADM-005: 실패한 작업을 다시 시작하면 실패한 단계부터 이어 간다', async () => {
    const jobs = new MemoryJobRepository();
    const calls: string[] = [];
    const steps = fakeSteps(calls);
    let failOnce = true;
    steps.integrity = async () => {
      calls.push('integrity');
      if (failOnce) {
        failOnce = false;
        throw new Error('hard 위반');
      }
    };
    await seed(jobs);
    const runner = createJobRunner({ jobs, steps });
    await runner.startJob(JOB_ID);
    expect(jobs.jobs[0]).toMatchObject({ status: 'failed', step: 'integrity' });

    await runner.startJob(JOB_ID);

    expect(calls).toEqual([
      'split_register',
      'generate',
      'integrity',
      'integrity',
      'register_content',
      'embed',
    ]);
    expect(jobs.jobs[0]).toMatchObject({ status: 'review_ready', error: null });
  });

  test('FR-ADM-005: integrity에서 실패한 작업을 retry하면 캐시를 무효화하고 generate부터 다시 한다', async () => {
    const jobs = new MemoryJobRepository();
    const calls: string[] = [];
    const steps = fakeSteps(calls);
    let failOnce = true;
    steps.integrity = async () => {
      calls.push('integrity');
      if (failOnce) {
        failOnce = false;
        throw new Error('zero characters');
      }
    };
    const invalidate = jest.fn();
    await seed(jobs);
    const runner = createJobRunner({ jobs, steps, invalidateFailedOutput: invalidate });
    await runner.startJob(JOB_ID);
    calls.length = 0;

    await runner.retryJob(JOB_ID);

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['generate', 'integrity', 'register_content', 'embed']);
    expect(jobs.jobs[0].status).toBe('review_ready');
  });

  test('FR-ADM-005: register_content에서 실패한 작업을 retry하면 캐시는 그대로 두고 그 단계부터 이어 간다', async () => {
    const jobs = new MemoryJobRepository();
    const calls: string[] = [];
    const steps = fakeSteps(calls);
    let failOnce = true;
    steps.register_content = async () => {
      calls.push('register_content');
      if (failOnce) {
        failOnce = false;
        throw new Error('db down');
      }
    };
    const invalidate = jest.fn();
    await seed(jobs);
    const runner = createJobRunner({ jobs, steps, invalidateFailedOutput: invalidate });
    await runner.startJob(JOB_ID);
    calls.length = 0;

    await runner.retryJob(JOB_ID);

    expect(invalidate).not.toHaveBeenCalled();
    expect(calls).toEqual(['register_content', 'embed']);
  });

  test('FR-ADM-005: 실패 상태가 아닌 작업은 retry해도 아무것도 하지 않는다', async () => {
    const jobs = new MemoryJobRepository();
    const calls: string[] = [];
    await seed(jobs);
    await createJobRunner({ jobs, steps: fakeSteps(calls) }).startJob(JOB_ID);
    calls.length = 0;

    await createJobRunner({ jobs, steps: fakeSteps(calls) }).retryJob(JOB_ID);

    expect(calls).toEqual([]);
  });

  test('FR-ADM-005: 같은 작업을 동시에 두 번 시작해도 단계는 한 번씩만 실행된다', async () => {
    const jobs = new MemoryJobRepository();
    const calls: string[] = [];
    await seed(jobs);
    const runner = createJobRunner({ jobs, steps: fakeSteps(calls) });

    await Promise.all([runner.startJob(JOB_ID), runner.startJob(JOB_ID)]);

    expect(calls.filter((c) => c === 'generate')).toHaveLength(1);
  });

  test('FR-ADM-006: review_ready·published 작업은 다시 실행하지 않는다', async () => {
    const jobs = new MemoryJobRepository();
    const calls: string[] = [];
    await seed(jobs);
    await jobs.update(JOB_ID, { status: 'published', step: 'review_ready' });

    await createJobRunner({ jobs, steps: fakeSteps(calls) }).startJob(JOB_ID);

    expect(calls).toEqual([]);
  });
});
