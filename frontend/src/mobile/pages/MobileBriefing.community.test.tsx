import { render, screen } from '@testing-library/react';
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

// 대표 지시 2026-11-20 — 브리핑 화면에는 어떤 경우에도 커뮤니티 버튼을 두지 않는다
describe.each([false, true])('BRIEFING: 완독 여부(is_complete=%s)와 관계없이', (isComplete) => {
  test('브리핑 화면에 커뮤니티 버튼이 없고 이어서 읽기는 있다', async () => {
    positionMock.current = position(isComplete);
    renderBriefing();

    expect(await screen.findByRole('button', { name: '이어서 읽기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /커뮤니티/ })).not.toBeInTheDocument();
    expect(screen.queryByText('다른 독자들과 이야기하기')).not.toBeInTheDocument();
  });
});
