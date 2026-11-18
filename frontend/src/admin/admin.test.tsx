import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import AdminLayout from './AdminLayout';
import AnalyticsPage from './AnalyticsPage';
import BooksPage from './BooksPage';
import ReviewPage from './ReviewPage';
import { ADMIN_TOKEN_KEY } from './adminApi';

const TOKEN = 't'.repeat(40);

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown };
let handler: Handler;
let calls: { url: string; init: RequestInit }[];

function json(status: number, body: unknown) {
  return { status, body };
}

beforeEach(() => {
  calls = [];
  localStorage.clear();
  handler = () => json(200, []);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const { status, body } = handler(url, init);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAdmin(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AnalyticsPage /> },
          { path: 'books', element: <BooksPage /> },
          { path: 'books/:bookId/review', element: <ReviewPage /> },
        ],
      },
    ],
    { initialEntries: [path] }
  );
  return render(<RouterProvider router={router} />);
}

describe('admin gate', () => {
  it('FR-ADM-006: 토큰이 없으면 입력 화면만 보이고 관리자 API를 부르지 않는다', () => {
    renderAdmin('/admin/books');
    expect(screen.getByLabelText('관리자 토큰')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '관리자 메뉴' })).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('FR-ADM-006: 틀린 토큰은 저장하지 않고 안내하며, 맞는 토큰은 저장 후 화면을 연다', async () => {
    const user = userEvent.setup();
    handler = (_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === `Bearer ${TOKEN}`
        ? json(200, [])
        : json(401, { error: 'UNAUTHORIZED', message: 'x' });
    };
    renderAdmin('/admin/books');

    await user.type(screen.getByLabelText('관리자 토큰'), 'wrong');
    await user.click(screen.getByRole('button', { name: '들어가기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('토큰이 맞지 않습니다');
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();

    await user.clear(screen.getByLabelText('관리자 토큰'));
    await user.type(screen.getByLabelText('관리자 토큰'), TOKEN);
    await user.click(screen.getByRole('button', { name: '들어가기' }));
    expect(await screen.findByRole('heading', { name: '도서 관리' })).toBeInTheDocument();
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBe(TOKEN);
  });

  it('FR-ADM-006: 저장된 토큰이 서버에서 401이면 다시 입력 화면으로 돌아간다', async () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, TOKEN);
    handler = () => json(401, { error: 'UNAUTHORIZED', message: 'x' });
    renderAdmin('/admin/books');
    expect(await screen.findByLabelText('관리자 토큰')).toBeInTheDocument();
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });
});

describe('books page', () => {
  beforeEach(() => localStorage.setItem(ADMIN_TOKEN_KEY, TOKEN));

  it('FR-ADM-005: 업로드 제출은 text/plain 본문과 제목·저자·연도 쿼리로 보낸다', async () => {
    const user = userEvent.setup();
    handler = (_url, init) =>
      init.method === 'POST' ? json(201, { book_id: 'bk-1', job_id: 'j-1' }) : json(200, []);
    renderAdmin('/admin/books');
    await screen.findByRole('heading', { name: '도서 관리' });

    const file = new File(['1 첫째 장\n\n본문\n'], 'book.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText(/원문 파일/), file);
    await user.type(screen.getByLabelText('제목'), '가상범인');
    await user.type(screen.getByLabelText('저자'), '김');
    await user.type(screen.getByLabelText('연도'), '1937');
    await user.click(screen.getByRole('button', { name: '업로드' }));

    await screen.findByText(/작업이 시작되었습니다/);
    const post = calls.find((c) => c.init.method === 'POST')!;
    const url = new URL(post.url);
    expect(url.pathname).toBe('/admin/books');
    expect(url.searchParams.get('title')).toBe('가상범인');
    expect(url.searchParams.get('author')).toBe('김');
    expect(url.searchParams.get('year')).toBe('1937');
    const headers = post.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toMatch(/^text\/plain/);
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(post.init.body).toBe('1 첫째 장\n\n본문\n');
  });

  it('FR-ADM-005: 같은 파일 재업로드(409)는 안내 문구를 보인다', async () => {
    const user = userEvent.setup();
    handler = (_url, init) =>
      init.method === 'POST'
        ? json(409, { error: 'DUPLICATE_SOURCE', book_id: 'bk-1', job_id: 'j-1' })
        : json(200, []);
    renderAdmin('/admin/books');
    await screen.findByRole('heading', { name: '도서 관리' });
    await user.upload(
      screen.getByLabelText(/원문 파일/),
      new File(['x'], 'a.txt', { type: 'text/plain' })
    );
    await user.type(screen.getByLabelText('제목'), 'a');
    await user.type(screen.getByLabelText('저자'), 'b');
    await user.click(screen.getByRole('button', { name: '업로드' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 올린 파일');
  });

  it('FR-ADM-005: 작업 목록에 상태·단계·오류를 보이고 실패한 작업만 다시 시도 버튼이 있다', async () => {
    const user = userEvent.setup();
    handler = (_url, init) => {
      if (init.method === 'POST') return json(202, { job_id: 'j-2' });
      return json(200, [
        {
          job_id: 'j-1',
          book_id: 'bk-1',
          title: '진행 책',
          status: 'running',
          step: 'generate',
          error: null,
          updated_at: '2026-11-16T01:00:00Z',
        },
        {
          job_id: 'j-2',
          book_id: 'bk-2',
          title: '실패 책',
          status: 'failed',
          step: 'integrity',
          error: '관계 누락',
          updated_at: '2026-11-16T01:00:00Z',
        },
      ]);
    };
    renderAdmin('/admin/books');
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('진행 중')).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
    expect(within(rows[2]).getByText('관계 누락')).toBeInTheDocument();

    await user.click(within(rows[2]).getByRole('button', { name: '다시 시도' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith('/admin/jobs/j-2/retry') && c.init.method === 'POST')
      ).toBe(true)
    );
  });
});

const REVIEW = {
  book: {
    book_id: 'bk-1',
    title: '가상범인',
    author: '김',
    total_pages: 10,
    publish_status: 'review',
  },
  job: { job_id: 'j-1', status: 'review_ready', step: 'review_ready', error: null },
  pages_preview: [{ page_no: 1, excerpt: '그는 문을 열었다' }],
  characters: [
    {
      id: 'c1',
      name: '홍',
      first_appearance_page: 1,
      aliases: [{ alias: '홍씨', alias_type: 'name' }],
      notes: [],
    },
  ],
  relationships: [
    {
      id: 'r1',
      from: '홍',
      to: '김',
      label: '형제',
      established_page: 3,
      quote: '형이 말했다',
      quote_page: 3,
      check: 'confirmed',
      reasons: [],
    },
    {
      id: 'r2',
      from: '김',
      to: '박',
      label: '친구',
      established_page: 4,
      quote: null,
      quote_page: null,
      check: 'needs_review',
      reasons: ['quote_not_found'],
    },
  ],
  chapter_summaries: [{ chapter_no: 1, summary: '첫 장 요약' }],
  terms: [],
  events: [],
  background_and_intro: [],
  integrity: null,
  held: [{ target_type: 'relationship', label: '박-최', reasons: ['page_out_of_range'] }],
  held_candidates: [{ kind: 'relationship', reason: 'weak_evidence', count: 2 }],
  review: {
    complete: false,
    missing: [
      { target_type: 'relationship', target_id: 'r2', missing_criteria: ['hallucination_ok'] },
    ],
  },
};

describe('review page', () => {
  beforeEach(() => localStorage.setItem(ADMIN_TOKEN_KEY, TOKEN));

  it('FR-ADM-005: 관계의 인용·확립 쪽·검증 배지·사유와 보류 건수를 보인다', async () => {
    handler = () => json(200, REVIEW);
    renderAdmin('/admin/books/bk-1/review');
    const section = await screen.findByRole('region', { name: '관계' });
    expect(within(section).getByText(/형이 말했다/)).toBeInTheDocument();
    expect(within(section).getByText('확인됨')).toBeInTheDocument();
    expect(within(section).getByText('확인 필요')).toBeInTheDocument();
    expect(within(section).getByText(/quote_not_found/)).toBeInTheDocument();
    expect(within(section).getAllByText(/확립 \d쪽/)).toHaveLength(2);
    expect(screen.getByText(/보류 1건 · 보류 후보 2건/)).toBeInTheDocument();
  });

  it('FR-ADM-005: 항목별 거절과 종류별 전체 승인은 올바른 결정을 보낸다', async () => {
    const user = userEvent.setup();
    handler = (_url, init) =>
      init.method === 'POST' ? json(200, { approved: 1, rejected: 0 }) : json(200, REVIEW);
    renderAdmin('/admin/books/bk-1/review');
    const section = await screen.findByRole('region', { name: '관계' });

    await user.click(within(section).getAllByRole('button', { name: '거절' })[1]);
    await waitFor(() => expect(calls.some((c) => c.init.method === 'POST')).toBe(true));
    const reject = calls.find((c) => c.init.method === 'POST')!;
    expect(JSON.parse(String(reject.init.body))).toEqual({
      decisions: [{ target_type: 'relationship', target_id: 'r2', verdict: 'reject' }],
    });

    await user.click(within(section).getByRole('button', { name: '관계 전체 승인' }));
    await waitFor(() => expect(calls.filter((c) => c.init.method === 'POST')).toHaveLength(2));
    expect(JSON.parse(String(calls.filter((c) => c.init.method === 'POST')[1].init.body))).toEqual({
      decisions: [{ target_type: 'relationship', target_id: '*', verdict: 'approve' }],
    });
  });

  it('FR-ADM-006: 검수가 덜 끝나 승인이 409면 미검수 항목 목록을 보인다', async () => {
    const user = userEvent.setup();
    handler = (_url, init) =>
      init.method === 'POST'
        ? json(409, {
            error: 'REVIEW_INCOMPLETE',
            missing: [
              {
                target_type: 'relationship',
                target_id: 'r2',
                missing_criteria: ['hallucination_ok'],
              },
            ],
          })
        : json(200, REVIEW);
    renderAdmin('/admin/books/bk-1/review');
    await screen.findByRole('region', { name: '관계' });
    await user.click(screen.getByRole('button', { name: '최종 승인' }));

    const list = await screen.findByRole('list', { name: '미검수 항목' });
    expect(within(list).getByText(/관계 · r2/)).toBeInTheDocument();
    expect(within(list).getByText(/hallucination_ok/)).toBeInTheDocument();
  });
});

describe('review page — 장 핵심 한 줄 (결정 31)', () => {
  beforeEach(() => localStorage.setItem(ADMIN_TOKEN_KEY, TOKEN));

  const WITH_KEY_POINT = {
    ...REVIEW,
    chapter_summaries: [
      { chapter_no: 1, summary: '첫 장 요약', key_point: '첫 장 핵심 한 줄.' },
      { chapter_no: 2, summary: '둘째 장 요약', key_point: null },
    ],
  };

  it('FR-ADM-005: 핵심 한 줄이 있는 장만 보이고, 거절·전체 승인은 chapter_key_point 결정을 보낸다', async () => {
    const user = userEvent.setup();
    handler = (_url, init) =>
      init.method === 'POST' ? json(200, { approved: 1, rejected: 0 }) : json(200, WITH_KEY_POINT);
    renderAdmin('/admin/books/bk-1/review');
    const section = await screen.findByRole('region', { name: '장 핵심 한 줄' });
    expect(within(section).getByText(/첫 장 핵심 한 줄\./)).toBeInTheDocument();
    expect(within(section).queryByText(/둘째 장/)).not.toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: '거절' }));
    await waitFor(() => expect(calls.some((c) => c.init.method === 'POST')).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init.method === 'POST')!.init.body))).toEqual({
      decisions: [{ target_type: 'chapter_key_point', target_id: '1', verdict: 'reject' }],
    });

    await user.click(screen.getByRole('button', { name: '모든 항목 승인' }));
    await waitFor(() => expect(calls.filter((c) => c.init.method === 'POST')).toHaveLength(2));
    const all = JSON.parse(String(calls.filter((c) => c.init.method === 'POST')[1].init.body));
    expect(all.decisions).toContainEqual({
      target_type: 'chapter_key_point',
      target_id: '*',
      verdict: 'approve',
    });
  });

  it('핵심 한 줄이 하나도 없으면 그 칸을 그리지 않는다', async () => {
    handler = () => json(200, REVIEW);
    renderAdmin('/admin/books/bk-1/review');
    await screen.findByRole('region', { name: '관계' });
    expect(screen.queryByRole('region', { name: '장 핵심 한 줄' })).not.toBeInTheDocument();
  });
});
