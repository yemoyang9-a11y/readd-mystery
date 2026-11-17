import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useBriefingSession } from './useBriefingSession';
import type { BriefingResponse } from '../types';

const api = vi.hoisted(() => ({
  fetchBriefing: vi.fn(),
  fetchCatalog: vi.fn(),
  fetchBookInfo: vi.fn(),
}));

vi.mock('../services/recapService', () => ({
  fetchBriefing: api.fetchBriefing,
  streamRecap: async function* () {},
}));
vi.mock('../services/ssabiService', () => ({ fetchGraph: () => new Promise(() => {}) }));
vi.mock('../services/bookService', () => ({
  fetchBookInfo: api.fetchBookInfo,
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
      <p data-testid="background">{session.background ?? '없음'}</p>
      <p data-testid="title">{session.title}</p>
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
  api.fetchBookInfo.mockReset();
  api.fetchBookInfo.mockReturnValue(new Promise(() => {}));
});

const bookInfo = {
  basic_info: { title: '가상범인', author: '김내성', length_note: '68쪽' },
  introduction: '소개',
  background: '1930년대 경성의 극장가.',
  chapters: [],
};

// 2026-11-17 대표 결정 — 첫 방문 브리핑에 배경지식 표시 (R5: 상한 대상 아님)
test('FR-BGK-002 R5: 배경지식은 GET /info 의 background 그대로다', async () => {
  api.fetchBriefing.mockReturnValue(new Promise(() => {}));
  api.fetchBookInfo.mockResolvedValue(bookInfo);
  renderProbe();

  await waitFor(() => expect(screen.getByTestId('background')).toHaveTextContent('1930년대 경성의 극장가.'));
});

test('GET /info 의 background 가 비어 있으면 배경지식은 없다', async () => {
  api.fetchBriefing.mockReturnValue(new Promise(() => {}));
  api.fetchBookInfo.mockResolvedValue({ ...bookInfo, background: '' });
  renderProbe();

  await waitFor(() => expect(screen.getByTestId('title')).toHaveTextContent('가상범인'));
  expect(screen.getByTestId('background')).toHaveTextContent('없음');
});

test('FR-SPL-005: GET /info 조회가 실패하면 배경지식은 없다', async () => {
  api.fetchBriefing.mockReturnValue(new Promise(() => {}));
  api.fetchBookInfo.mockRejectedValue(new Error('down'));
  renderProbe();

  await waitFor(() => expect(api.fetchBookInfo).toHaveBeenCalled());
  await Promise.resolve();
  expect(screen.getByTestId('background')).toHaveTextContent('없음');
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
