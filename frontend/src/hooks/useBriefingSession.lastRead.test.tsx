import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useBriefingSession } from './useBriefingSession';
import type { BriefingResponse } from '../types';

const api = vi.hoisted(() => ({
  fetchBriefing: vi.fn(),
  fetchCatalog: vi.fn(),
}));

vi.mock('../services/recapService', () => ({
  fetchBriefing: api.fetchBriefing,
  streamRecap: async function* () {},
}));
vi.mock('../services/ssabiService', () => ({ fetchGraph: () => new Promise(() => {}) }));
vi.mock('../services/bookService', () => ({
  fetchBookInfo: () => new Promise(() => {}),
  fetchCatalog: api.fetchCatalog,
}));

const serverBriefing: BriefingResponse = {
  applied_cutoff: 13,
  recap: '리캡',
  current_chapter: { chapter_no: 2, title: '해왕좌의 밤' },
  resume_chapter: { chapter_no: 2, title: '해왕좌의 밤' },
  progress: { current_page: 13, total_pages: 68, percent: 19.1 },
  last_read_at: '2026-11-14T09:00:00.000Z',
};

function Probe() {
  const session = useBriefingSession('bk-1');
  return (
    <div>
      <p data-testid="loaded">{session.briefing ? 'yes' : 'no'}</p>
      <p data-testid="last-read">{session.lastReadAt ?? '없음'}</p>
    </div>
  );
}

function renderProbe() {
  render(
    <MemoryRouter initialEntries={['/books/bk-1/briefing']}>
      <Routes>
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.fetchBriefing.mockReset();
  api.fetchCatalog.mockReset();
  api.fetchCatalog.mockResolvedValue({ books: [] });
});

// 2026-11-17 대표 결정 — 브리핑 응답이 마지막 읽은 시각을 싣는다
test('FR-BRF-005: 마지막 읽은 시각은 브리핑 응답의 last_read_at 그대로이고 GET /books 를 부르지 않는다', async () => {
  api.fetchBriefing.mockResolvedValue(serverBriefing);
  renderProbe();

  await waitFor(() => expect(screen.getByTestId('last-read')).toHaveTextContent('2026-11-14T09:00:00.000Z'));
  expect(api.fetchCatalog).not.toHaveBeenCalled();
});

test('브리핑 응답의 last_read_at 이 null 이면 마지막 읽은 시각도 없다 — 다른 값으로 채우지 않는다', async () => {
  api.fetchBriefing.mockResolvedValue({ ...serverBriefing, last_read_at: null });
  renderProbe();

  await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('yes'));
  expect(screen.getByTestId('last-read')).toHaveTextContent('없음');
  expect(api.fetchCatalog).not.toHaveBeenCalled();
});

test('FR-SPL-005: 브리핑 조회가 실패하면 마지막 읽은 시각도 없다', async () => {
  api.fetchBriefing.mockRejectedValue(new Error('down'));
  renderProbe();

  await waitFor(() => expect(api.fetchBriefing).toHaveBeenCalled());
  expect(screen.getByTestId('last-read')).toHaveTextContent('없음');
  expect(api.fetchCatalog).not.toHaveBeenCalled();
});
