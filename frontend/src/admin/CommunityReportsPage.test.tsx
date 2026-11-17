import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import CommunityReportsPage from './CommunityReportsPage';
import { ADMIN_TOKEN_KEY, type ModerationItem } from './adminApi';

const TOKEN = 't'.repeat(40);
const POST_ID = '11111111-1111-4111-8111-111111111111';
const COMMENT_ID = '22222222-2222-4222-8222-222222222222';

const HIDDEN_POST: ModerationItem = {
  target_type: 'post',
  target_id: POST_ID,
  book_id: 'bk-1',
  book_title: '가상범인',
  body: '범인은 집사라고 생각해요. '.repeat(20),
  report_count: 3,
  reports_since_review: 3,
  reasons: ['스포일러', '욕설', '광고'],
  hidden: true,
  deleted: false,
  hidden_at: '2026-11-17T03:00:00.000Z',
  reviewed_at: null,
  last_reported_at: '2026-11-17T03:00:00.000Z',
};
const VISIBLE_COMMENT: ModerationItem = {
  target_type: 'comment',
  target_id: COMMENT_ID,
  book_id: 'bk-1',
  book_title: '가상범인',
  body: '편지가 결정적이었죠',
  report_count: 1,
  reports_since_review: 1,
  reasons: ['도배'],
  hidden: false,
  deleted: false,
  hidden_at: null,
  reviewed_at: null,
  last_reported_at: '2026-11-17T02:00:00.000Z',
};

let items: ModerationItem[];
let calls: { url: string; method: string; auth: string | undefined }[];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(ADMIN_TOKEN_KEY, TOKEN);
  items = [HIDDEN_POST, VISIBLE_COMMENT];
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      calls.push({
        url,
        method,
        auth: (init.headers as Record<string, string>).Authorization,
      });
      if (url.endsWith('/admin/community/moderation')) {
        return new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith(`/admin/community/posts/${POST_ID}/restore`) && method === 'POST') {
        items = [{ ...HIDDEN_POST, hidden: false, reviewed_at: '2026-11-17T04:00:00.000Z' }, VISIBLE_COMMENT];
        return new Response(null, { status: 204 });
      }
      if (url.endsWith(`/admin/community/comments/${COMMENT_ID}`) && method === 'DELETE') {
        items = [HIDDEN_POST, { ...VISIBLE_COMMENT, deleted: true }];
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [{ path: 'community', element: <CommunityReportsPage /> }],
      },
    ],
    { initialEntries: ['/admin/community'] }
  );
  return render(<RouterProvider router={router} />);
}

const rowFor = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

describe('커뮤니티 신고 관리 화면 — 대표 결정 2026-11-17', () => {
  it('메뉴에 "커뮤니티 신고"가 있고, 신고된 글·댓글을 도서·종류·발췌·신고자 수·사유·상태와 함께 보여 준다', async () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: '관리자 메뉴' });
    expect(within(nav).getByRole('link', { name: '커뮤니티 신고' })).toHaveAttribute(
      'href',
      '/admin/community'
    );
    expect(await screen.findByText('편지가 결정적이었죠')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({
      method: 'GET',
      auth: `Bearer ${TOKEN}`,
    });
    expect(calls[0].url).toMatch(/\/admin\/community\/moderation$/);

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    // 1행: 숨긴 글 — 본문은 발췌로 줄인다
    expect(rows[0]).toHaveTextContent('가상범인');
    expect(rows[0]).toHaveTextContent('글');
    expect(rows[0]).toHaveTextContent('3명');
    expect(rows[0]).toHaveTextContent('스포일러');
    expect(rows[0]).toHaveTextContent('광고');
    expect(rows[0]).toHaveTextContent('숨김');
    expect(rows[0].textContent!.length).toBeLessThan(HIDDEN_POST.body!.length);
    // 2행: 보이는 댓글
    expect(rows[1]).toHaveTextContent('댓글');
    expect(rows[1]).toHaveTextContent('1명');
    expect(rows[1]).toHaveTextContent('표시');
  });

  it('복구: 확인하면 복구 요청을 보내고 목록을 다시 불러온다, 취소하면 보내지 않는다', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();
    await screen.findByText('편지가 결정적이었죠');
    const postRow = within(screen.getByRole('table')).getAllByRole('row')[1];

    await user.click(within(postRow).getByRole('button', { name: '복구' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await user.click(within(postRow).getByRole('button', { name: '복구' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
        expect.stringMatching(new RegExp(`/admin/community/posts/${POST_ID}/restore$`)),
      ])
    );
    await waitFor(() => {
      const row = within(screen.getByRole('table')).getAllByRole('row')[1];
      expect(row).toHaveTextContent('표시');
      expect(row).toHaveTextContent('검토함');
    });
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('삭제: 확인하면 댓글 삭제 요청을 보내고 삭제됨으로 바뀐다', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await screen.findByText('편지가 결정적이었죠');
    const commentRow = rowFor('편지가 결정적이었죠');
    expect(within(commentRow).queryByRole('button', { name: '복구' })).not.toBeInTheDocument();

    await user.click(within(commentRow).getByRole('button', { name: '삭제' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
        expect.stringMatching(new RegExp(`/admin/community/comments/${COMMENT_ID}$`)),
      ])
    );
    await waitFor(() => expect(rowFor('편지가 결정적이었죠')).toHaveTextContent('삭제됨'));
    expect(
      within(rowFor('편지가 결정적이었죠')).queryByRole('button', { name: '삭제' })
    ).not.toBeInTheDocument();
  });

  it('신고가 없으면 빈 안내를 보여 준다', async () => {
    items = [];
    renderPage();
    expect(await screen.findByText('신고된 글이 없습니다')).toBeInTheDocument();
  });
});
