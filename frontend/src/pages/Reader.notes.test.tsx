import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import Reader from './Reader';

// 2026-11-15 추리 전환
let streamCalls = 0;

vi.mock('../../mocks/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../mocks/server')>();
  return {
    ...actual,
    mockStreamFrames: (text: string) => {
      streamCalls += 1;
      return actual.mockStreamFrames(text);
    },
  };
});

function renderReader() {
  return render(
    <MemoryRouter initialEntries={['/books/takryu/read']}>
      <Routes>
        <Route path="/books/:bookId/read" element={<Reader />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Reader — 추리 노트 탭', () => {
  beforeEach(() => {
    streamCalls = 0;
  });

  it('패널 탭은 추리 노트·타임라인·인물관계도·AI 챗봇 넷이고 리캡 생성은 호출되지 않는다 (결정 31)', async () => {
    const user = userEvent.setup();
    renderReader();
    await screen.findByRole('article');

    await user.click(screen.getByRole('button', { name: '싸비 열기' }));
    await user.click(screen.getByRole('tab', { name: '추리 노트' }));
    await user.click(screen.getByRole('button', { name: '다음 페이지' }));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      '추리 노트',
      '타임라인',
      '인물관계도',
      'AI 챗봇',
    ]);
    expect(streamCalls).toBe(0);
  });

  it('노트를 적으면 목록에 생기고, 쪽수 칩을 누르면 그 쪽으로 이동해 돌아가기 바가 뜬다', async () => {
    const user = userEvent.setup();
    renderReader();
    await screen.findByRole('article');
    await user.click(screen.getByRole('button', { name: '다음 페이지' }));
    await user.click(screen.getByRole('button', { name: '싸비 열기' }));
    await user.click(screen.getByRole('tab', { name: '추리 노트' }));

    await user.click(screen.getByRole('button', { name: '단서·가설 적기' }));
    const dialog = screen.getByRole('dialog', { name: '단서·가설 적기' });
    const page = within(dialog).getByLabelText('쪽수') as HTMLInputElement;
    const startPage = Number(page.value);
    await user.clear(page);
    await user.type(page, '1');
    await user.type(within(dialog).getByLabelText('내용'), '첫 쪽의 수상한 장면');
    await user.click(within(dialog).getByRole('button', { name: '저장' }));

    expect(await screen.findByText('첫 쪽의 수상한 장면')).toBeInTheDocument();

    expect(startPage).toBeGreaterThan(1);
    await user.click(screen.getByRole('button', { name: '1쪽으로 이동' }));
    await waitFor(() => expect(screen.getByText(`${startPage}쪽에서 옮겨 왔어요`)).toBeInTheDocument());
  });
});
