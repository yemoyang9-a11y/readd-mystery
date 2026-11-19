import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import MobileBriefing from './MobileBriefing';
import type { BriefingSessionState } from '../../hooks/useBriefingSession';
import type { PositionResponse } from '../../services/positionService';

const positionMock = vi.hoisted(() => ({ current: null as PositionResponse | null }));

vi.mock('../../services/positionService', () => ({
  fetchPosition: () => Promise.resolve(positionMock.current),
}));

vi.mock('../../hooks/useBriefingSession', () => ({
  useBriefingSession: (): BriefingSessionState => ({
    briefing: {
      applied_cutoff: 15,
      recap: '정주사는 미두장에서 재산을 잃었다.',
      current_chapter: { chapter_no: 2, title: '생활 제일과' },
      resume_chapter: { chapter_no: 2, title: '생활 제일과' },
      progress: { current_page: 15, total_pages: 20, percent: 75 },
      last_read_at: null,
    },
    briefingError: false,
    retryBriefing: () => {},
    chapters: [],
    title: '가상범인',
    author: '김내성',
    coverUrl: null,
    lastReadAt: null,
    introduction: null,
    background: null,
    characterNames: [],
    notes: [],
    streamedRecap: '',
    recapStreaming: false,
    recapFailed: false,
    requestFallback: () => {},
    continueReading: () => {},
    selectChapter: () => {},
    goBack: () => {},
  }),
}));

function position(isComplete: boolean): PositionResponse {
  return { applied_cutoff: isComplete ? 20 : 15, current_chapter_no: 2, read_chapter_nos: [1], is_complete: isComplete };
}

function renderBriefing() {
  render(
    <MemoryRouter initialEntries={['/books/gasang/briefing']}>
      <Routes>
        <Route path="/books/:bookId/briefing" element={<MobileBriefing />} />
        <Route path="/books/:bookId/community" element={<p>이 책 커뮤니티</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

// 대표 결정 2026-11-19 "커뮤니티 관문 없애기" — 완독 여부와 관계없이 커뮤니티 버튼을 보인다 (positive 쌍)
describe.each([false, true])('COMMUNITY: 완독 여부(is_complete=%s)와 관계없이', (isComplete) => {
  test('브리핑 화면에 커뮤니티 버튼이 보이고 누르면 그 책 커뮤니티로 간다', async () => {
    positionMock.current = position(isComplete);
    renderBriefing();

    const button = await screen.findByRole('button', { name: /커뮤니티/ });
    expect(button).toHaveAttribute('data-track', 'community-open');
    expect(button.textContent).not.toMatch(/싸비|AI/);

    await userEvent.click(button);
    expect(await screen.findByText('이 책 커뮤니티')).toBeInTheDocument();
  });
});
