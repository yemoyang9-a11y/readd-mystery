import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { AdminApiError, uploadBook, type JobStatus, type JobSummary } from './adminApi';
import { useAdmin } from './AdminLayout';

const POLL_MS = 5000;

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: '대기',
  running: '진행 중',
  failed: '실패',
  review_ready: '검수 대기',
  published: '공개됨',
};

const STATUS_STYLE: Record<JobStatus, string> = {
  queued: 'bg-line text-muted',
  running: 'bg-line text-ink',
  failed: 'bg-ssabi-soft text-ssabi',
  review_ready: 'bg-brief-accent-soft text-brief-accent',
  published: 'bg-ink text-white',
};

const STEP_LABEL: Record<string, string> = {
  split_register: '분할·등록',
  generate: '생성',
  integrity: '정합성 검사',
  register_content: '콘텐츠 등록',
  embed: '임베딩',
  review_ready: '검수 준비',
};

function uploadErrorMessage(err: unknown): string {
  if (err instanceof AdminApiError) {
    if (err.status === 409 && err.code === 'DUPLICATE_SOURCE')
      return '이미 올린 파일입니다. 작업 목록을 확인하세요.';
    if (err.status === 413) return '파일이 5MB를 넘습니다.';
    return err.message;
  }
  return '업로드하지 못했습니다';
}

const FIELD =
  'mt-1.5 w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-[15px] outline-none focus:border-ink';

// FR-ADM-005
export default function BooksPage() {
  const { call, token } = useAdmin();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setJobs(await call<JobSummary[]>('/jobs'));
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : '작업 목록을 불러오지 못했습니다');
    }
  }, [call]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      await uploadBook(token, { file, title, author, year });
      setMessage({ kind: 'ok', text: '업로드했습니다. 작업이 시작되었습니다.' });
      setFile(null);
      setTitle('');
      setAuthor('');
      setYear('');
      if (fileInput.current) fileInput.current.value = '';
      await refresh();
    } catch (err) {
      setMessage({ kind: 'error', text: uploadErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function retry(jobId: string) {
    try {
      await call(`/jobs/${jobId}/retry`, { method: 'POST' });
    } catch (err) {
      setListError(err instanceof Error ? err.message : '다시 시도하지 못했습니다');
    }
    await refresh();
  }

  const ready = file !== null && title.trim() !== '' && author.trim() !== '' && !busy;

  return (
    <div className="space-y-8">
      <h1 className="font-serif text-[24px] font-extrabold">도서 관리</h1>

      <form
        onSubmit={submit}
        className="rounded-card border border-line bg-surface p-card"
        aria-label="도서 업로드"
      >
        <h2 className="font-serif text-[16px] font-extrabold">텍스트 파일 올리기</h2>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <div className="col-span-2">
            <label htmlFor="book-file" className="text-[13px] font-bold">
              원문 파일 (.txt, 5MB 이하)
            </label>
            <input
              id="book-file"
              ref={fileInput}
              type="file"
              accept=".txt,text/plain"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="book-title" className="text-[13px] font-bold">
              제목
            </label>
            <input
              id="book-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="book-author" className="text-[13px] font-bold">
              저자
            </label>
            <input
              id="book-author"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="book-year" className="text-[13px] font-bold">
              연도
            </label>
            <input
              id="book-year"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={FIELD}
            />
          </div>
        </div>
        <div className="mt-5 flex items-center gap-4">
          <button
            type="submit"
            disabled={!ready}
            className="rounded-lg bg-ink px-5 py-2.5 text-[13px] font-bold text-white transition-opacity disabled:opacity-40"
          >
            {busy ? '올리는 중' : '업로드'}
          </button>
          {message && (
            <p
              role={message.kind === 'error' ? 'alert' : 'status'}
              className={`text-[13px] ${message.kind === 'error' ? 'text-ssabi' : 'text-brief-accent'}`}
            >
              {message.text}
            </p>
          )}
        </div>
      </form>

      <section className="rounded-card border border-line bg-surface p-card">
        <div className="flex items-baseline justify-between">
          <h2 className="font-serif text-[16px] font-extrabold">작업 목록</h2>
          <span className="text-[12px] text-muted">5초마다 새로 고칩니다</span>
        </div>
        {listError && (
          <p role="alert" className="mt-3 text-[13px] text-ssabi">
            {listError}
          </p>
        )}
        {jobs.length === 0 ? (
          <p className="mt-4 text-[13px] text-muted">올린 도서가 없습니다</p>
        ) : (
          <table className="mt-4 w-full text-left text-[13px]">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-2 font-normal">제목</th>
                <th className="py-2 font-normal">상태</th>
                <th className="py-2 font-normal">단계</th>
                <th className="py-2 font-normal">오류</th>
                <th className="py-2 font-normal">갱신</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.job_id} className="border-b border-line-subtle align-top">
                  <td className="py-3 pr-3 font-bold">{job.title}</td>
                  <td className="py-3 pr-3">
                    <span
                      className={`rounded-pill px-2.5 py-1 text-[12px] ${STATUS_STYLE[job.status]}`}
                    >
                      {STATUS_LABEL[job.status]}
                    </span>
                  </td>
                  <td className="py-3 pr-3">{STEP_LABEL[job.step] ?? job.step}</td>
                  <td className="max-w-[260px] break-words py-3 pr-3 text-ssabi">{job.error}</td>
                  <td className="py-3 pr-3 text-muted">
                    {new Date(job.updated_at).toLocaleString('ko-KR')}
                  </td>
                  <td className="py-3 text-right">
                    {job.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => void retry(job.job_id)}
                        className="rounded-pill border border-line-subtle bg-surface px-4 py-1.5 text-faint"
                      >
                        다시 시도
                      </button>
                    )}
                    {(job.status === 'review_ready' || job.status === 'published') && (
                      <Link
                        to={`/admin/books/${job.book_id}/review`}
                        className="rounded-pill border border-line-subtle bg-surface px-4 py-1.5 text-faint"
                      >
                        검수
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
