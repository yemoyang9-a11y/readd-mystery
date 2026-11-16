import type { Server } from 'http';
import type { AddressInfo } from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import { createAdminRouter } from '../admin-router';
import { createJobRunner } from '../runner';
import { ApproveResult, ReviewService } from '../review-service';
import { MemoryJobRepository, fakeSteps } from './fakes';

const TOKEN = 'a'.repeat(40);

async function json(res: Response): Promise<any> {
  return res.json();
}
const SOURCE = '1 첫째 장\n\n그는 문을 열었다. 아무도 없었다.\n\n2 둘째 장\n\n비가 내렸다.\n';

describe('admin router', () => {
  let server: Server;
  let baseUrl: string;
  let jobs: MemoryJobRepository;
  let uploadDir: string;
  let startJob: jest.Mock;
  let retryJob: jest.Mock;
  let approve: jest.Mock<Promise<ApproveResult>, [string]>;
  let token: string | undefined;

  beforeEach(async () => {
    jobs = new MemoryJobRepository();
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-'));
    startJob = jest.fn().mockResolvedValue(undefined);
    retryJob = jest.fn().mockResolvedValue(undefined);
    approve = jest.fn();
    token = TOKEN;
    const review: ReviewService = {
      getReview: jest.fn().mockResolvedValue(null),
      applyDecisions: jest.fn(),
      approve,
    };
    const app = express();
    app.use(
      '/admin',
      createAdminRouter({
        jobs,
        runner: { startJob, retryJob },
        review,
        uploadDir,
        getToken: () => token,
      })
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  function upload(
    headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` },
    body: string = SOURCE,
    query = 'title=%EA%B0%80%EC%83%81&author=%EA%B9%80&year=1937'
  ) {
    return fetch(`${baseUrl}/admin/books?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers },
      body,
    });
  }

  test('FR-ADM-006: 관리자 토큰 없음·틀림 → 401, ingest_jobs 0행, 작업 시작 0회', async () => {
    const missing = await upload({});
    const wrong = await upload({ Authorization: `Bearer ${'b'.repeat(40)}` });
    const shortWrong = await upload({ Authorization: 'Bearer x' });

    expect([missing.status, wrong.status, shortWrong.status]).toEqual([401, 401, 401]);
    expect(jobs.jobs).toHaveLength(0);
    expect(startJob).not.toHaveBeenCalled();
    expect(fs.readdirSync(uploadDir)).toHaveLength(0);
  });

  test('FR-ADM-006: 토큰 없이·틀린 토큰으로 승인 호출 → 401, approve 호출 0회', async () => {
    const noToken = await fetch(`${baseUrl}/admin/books/bk-x/approve`, { method: 'POST' });
    const wrong = await fetch(`${baseUrl}/admin/books/bk-x/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${'c'.repeat(40)}` },
    });

    expect([noToken.status, wrong.status]).toEqual([401, 401]);
    expect(approve).not.toHaveBeenCalled();
  });

  test('FR-ADM-006: ADMIN_API_TOKEN 미설정 또는 32자 미만이면 /admin 전부 503', async () => {
    token = undefined;
    expect((await fetch(`${baseUrl}/admin/jobs`)).status).toBe(503);
    token = 'short';
    expect((await upload()).status).toBe(503);
    expect(jobs.jobs).toHaveLength(0);
  });

  test('FR-ADM-005: 업로드 → 201 { book_id, job_id }, bk-+SHA-256 앞 10자, 작업 시작', async () => {
    const res = await upload();
    const body = await json(res);

    expect(res.status).toBe(201);
    expect(body.book_id).toMatch(/^bk-[0-9a-f]{10}$/);
    expect(jobs.jobs[0]).toMatchObject({
      job_id: body.job_id,
      book_id: body.book_id,
      title: '가상',
      author: '김',
      publish_year: 1937,
      status: 'queued',
      step: 'split_register',
    });
    expect(fs.readFileSync(jobs.jobs[0].source_path, 'utf-8')).toBe(SOURCE);
    expect(startJob).toHaveBeenCalledWith(body.job_id);
  });

  test('FR-ADM-005: 같은 원문 재업로드 → 409, 같은 book_id·job_id, 새 작업 없음', async () => {
    const first = await json(await upload());
    const again = await upload();

    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({ book_id: first.book_id, job_id: first.job_id });
    expect(jobs.jobs).toHaveLength(1);
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  test('FR-ADM-005: 줄바꿈만 다른(CRLF) 같은 원문도 같은 책으로 본다', async () => {
    const first = await json(await upload());
    const again = await upload(undefined, SOURCE.replace(/\n/g, '\r\n'));

    expect(again.status).toBe(409);
    expect((await json(again)).book_id).toBe(first.book_id);
  });

  test('FR-ADM-005: 제목·저자 누락, 장 헤더 없음, 본문 비어 있음 → 400, 작업 없음', async () => {
    const noTitle = await upload(undefined, SOURCE, 'author=%EA%B9%80');
    const noChapters = await upload(undefined, '장 헤더가 없는 글');
    const empty = await upload(undefined, '   ');
    const badYear = await upload(undefined, SOURCE, 'title=a&author=b&year=abc');

    expect([noTitle.status, noChapters.status, empty.status, badYear.status]).toEqual([
      400, 400, 400, 400,
    ]);
    expect(jobs.jobs).toHaveLength(0);
  });

  test('FR-ADM-005: 5MB 초과 본문은 413', async () => {
    const res = await upload(undefined, '1 장\n\n' + 'ㄱ'.repeat(2_000_000));
    expect(res.status).toBe(413);
    expect(jobs.jobs).toHaveLength(0);
  });

  test('FR-ADM-005: GET /admin/jobs 와 /admin/jobs/:jobId 응답 형태', async () => {
    const { job_id, book_id } = await json(await upload());

    const list = await json(
      await fetch(`${baseUrl}/admin/jobs`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    );
    expect(list).toEqual([
      {
        job_id,
        book_id,
        title: '가상',
        status: 'queued',
        step: 'split_register',
        error: null,
        updated_at: expect.any(String),
      },
    ]);

    const one = await fetch(`${baseUrl}/admin/jobs/${job_id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(one.status).toBe(200);
    expect(await json(one)).toMatchObject({ job_id, book_id, status: 'queued' });

    const missing = await fetch(`${baseUrl}/admin/jobs/not-a-uuid`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(missing.status).toBe(404);
  });

  test('FR-ADM-006: 미검수가 남은 상태에서 approve → 409 { missing }', async () => {
    approve.mockResolvedValue({
      kind: 'incomplete',
      missing: [{ target_type: 'term', target_id: 't1', missing_criteria: ['hallucination_ok'] }],
    });
    const res = await fetch(`${baseUrl}/admin/books/bk-x/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({
      error: 'REVIEW_INCOMPLETE',
      missing: [{ target_type: 'term', target_id: 't1' }],
    });
  });

  test('FR-ADM-006: 작업이 review_ready가 아니면 approve → 409, 없는 책은 404', async () => {
    approve.mockResolvedValueOnce({ kind: 'not_ready', status: 'running' });
    approve.mockResolvedValueOnce({ kind: 'not_found' });
    const headers = { Authorization: `Bearer ${TOKEN}` };

    const running = await fetch(`${baseUrl}/admin/books/bk-x/approve`, { method: 'POST', headers });
    const missing = await fetch(`${baseUrl}/admin/books/bk-y/approve`, { method: 'POST', headers });

    expect([running.status, missing.status]).toEqual([409, 404]);
  });

  test('FR-ADM-006: 공개 성공 → 200 { book_id, publish_status }', async () => {
    approve.mockResolvedValue({ kind: 'published' });
    const res = await fetch(`${baseUrl}/admin/books/bk-x/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ book_id: 'bk-x', publish_status: 'published' });
  });

  test('FR-ADM-005: 실패한 작업만 retry → 202, 그 외는 409', async () => {
    const { job_id } = await json(await upload());
    const headers = { Authorization: `Bearer ${TOKEN}` };
    const notFailed = await fetch(`${baseUrl}/admin/jobs/${job_id}/retry`, {
      method: 'POST',
      headers,
    });
    await jobs.update(job_id, { status: 'failed' });
    retryJob.mockClear();
    const failed = await fetch(`${baseUrl}/admin/jobs/${job_id}/retry`, {
      method: 'POST',
      headers,
    });

    expect([notFailed.status, failed.status]).toEqual([409, 202]);
    expect(retryJob).toHaveBeenCalledWith(job_id);
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  test('FR-ADM-005: 업로드부터 review_ready까지 실제 러너로 이어진다', async () => {
    const calls: string[] = [];
    const runner = createJobRunner({ jobs, steps: fakeSteps(calls) });
    startJob.mockImplementation((id: string) => runner.startJob(id));

    const { job_id } = await json(await upload());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toEqual(['split_register', 'generate', 'integrity', 'register_content', 'embed']);
    expect((await jobs.findById(job_id))?.status).toBe('review_ready');
  });
});
