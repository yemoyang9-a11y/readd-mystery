import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as progressService from '../services/progressService';
import * as notesService from '../services/notesService';
import * as chatbotService from '../services/chatbotService';
import * as recapService from '../services/recapService';
import * as ssabiService from '../services/ssabiService';
import * as positionService from '../services/positionService';
import { api } from '../services/api';
import { markOnboarded } from '../services/onboardingService';
import GuidePage from './GuidePage';
import { GUIDE_STEPS } from './guideSteps';
import { DEMO_CLUE } from './demoBook';

vi.mock('../services/progressService');
vi.mock('../services/notesService');
vi.mock('../services/chatbotService');
vi.mock('../services/recapService');
vi.mock('../services/ssabiService');
vi.mock('../services/positionService');
vi.mock('../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), request: vi.fn() },
  ensureDeviceId: vi.fn(() => 'device'),
}));
vi.mock('../services/onboardingService', () => ({ markOnboarded: vi.fn(() => Promise.resolve()) }));

function renderGuide() {
  return render(
    <MemoryRouter initialEntries={['/guide']}>
      <Routes>
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/" element={<p>진짜 홈 화면</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function stepId(): string | undefined {
  return document.querySelector<HTMLElement>('[data-testid="guide-page"]')?.dataset.step;
}

/** 비춘 요소도 가이드 UI도 아닌, 누를 수 있어 보이는 실제 화면 요소 하나 */
function decoyFor(target: Element): Element | undefined {
  return Array.from(document.querySelectorAll('button, [role="button"], [role="tab"], a, mark')).find(
    (el) => !target.contains(el) && !el.contains(target) && !el.closest('[data-guide-ui]')
  );
}

const SERVICES = { progressService, notesService, chatbotService, recapService, ssabiService, positionService };

beforeEach(() => {
  vi.clearAllMocks();
});

test('가이드: 비춘 요소를 누를 때만 다음 단계로 가고, 끝까지 가면 완료 표시 후 홈으로 간다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderGuide();

  for (let i = 0; i < GUIDE_STEPS.length - 1; i += 1) {
    const step = GUIDE_STEPS[i];
    await waitFor(() => expect(step.target()).not.toBeNull());
    expect(screen.getByLabelText(`${GUIDE_STEPS.length}단계 중 ${i + 1}단계`)).toHaveTextContent(
      `${i + 1} / ${GUIDE_STEPS.length}`
    );

    // 다른 곳을 누르면 그대로다
    const decoy = decoyFor(step.target()!);
    if (decoy) {
      await user.click(decoy);
      expect(stepId()).toBe(step.id);
    }

    if (step.doneWhen) {
      while (stepId() === step.id) await user.click(step.target()!);
    } else {
      await user.click(step.target()!);
    }
    await waitFor(() => expect(stepId()).toBe(GUIDE_STEPS[i + 1].id));
  }

  expect(screen.getByRole('heading', { name: '이제 진짜 책을 읽어 볼까요' })).toBeInTheDocument();
  expect(markOnboarded).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '홈으로' }));
  await screen.findByText('진짜 홈 화면');
  expect(markOnboarded).toHaveBeenCalledTimes(1);
});

test('가이드: 데모 흐름 전체에서 진도·노트·챗봇·리캡·관계도 서비스와 API를 한 번도 부르지 않는다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderGuide();

  for (const step of GUIDE_STEPS.slice(0, -1)) {
    await waitFor(() => expect(step.target()).not.toBeNull());
    if (step.doneWhen) {
      while (stepId() === step.id) await user.click(step.target()!);
    } else {
      await user.click(step.target()!);
    }
    await waitFor(() => expect(stepId()).not.toBe(step.id));
  }
  await user.click(screen.getByRole('button', { name: '홈으로' }));
  await screen.findByText('진짜 홈 화면');

  for (const [name, mod] of Object.entries(SERVICES)) {
    for (const [fn, value] of Object.entries(mod)) {
      if (typeof value === 'function') expect(value, `${name}.${fn}`).not.toHaveBeenCalled();
    }
  }
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'request'] as const) {
    expect((api as unknown as Record<string, ReturnType<typeof vi.fn>>)[method], `api.${method}`).not.toHaveBeenCalled();
  }
});

test('가이드: 아모의 데모 답은 노트를 이어 주되 판정하지 않는다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderGuide();
  const until = GUIDE_STEPS.findIndex((step) => step.id === 'close-ssabi');
  for (const step of GUIDE_STEPS.slice(0, until)) {
    await waitFor(() => expect(step.target()).not.toBeNull());
    await user.click(step.target()!);
  }
  expect(await screen.findByText(/제가 정하지 않을게요/)).toBeInTheDocument();
  // 노트에 저장한 단서가 내 노트에 남아 있었다
  expect(screen.getAllByText(DEMO_CLUE).length).toBeGreaterThan(0);
});

test('가이드: 건너뛰기를 누르면 완료 표시 후 홈으로 간다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderGuide();
  expect(stepId()).toBe('open-book');
  await user.click(screen.getByRole('button', { name: '건너뛰기' }));
  await screen.findByText('진짜 홈 화면');
  expect(markOnboarded).toHaveBeenCalledTimes(1);
});

// 대표 지시 2026-11-18 — 작품을 열려다 가입했으면 첫 안내를 마친 뒤 그 작품으로 이어 간다
test('가이드: 가입 전에 열려던 작품(state.next)이 있으면 건너뛴 뒤 그 작품으로 간다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MemoryRouter initialEntries={[{ pathname: '/guide', state: { next: '/books/takryu/briefing' } }]}>
      <Routes>
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/" element={<p>진짜 홈 화면</p>} />
        <Route path="/books/:bookId/briefing" element={<p>작품 브리핑</p>} />
      </Routes>
    </MemoryRouter>
  );
  await user.click(screen.getByRole('button', { name: '건너뛰기' }));
  await screen.findByText('작품 브리핑');
});

test('가이드: 바깥 주소 next 는 따르지 않고 홈으로 간다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MemoryRouter initialEntries={[{ pathname: '/guide', state: { next: '//evil.example' } }]}>
      <Routes>
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/" element={<p>진짜 홈 화면</p>} />
      </Routes>
    </MemoryRouter>
  );
  await user.click(screen.getByRole('button', { name: '건너뛰기' }));
  await screen.findByText('진짜 홈 화면');
});

test('가이드: 홈에서 표지가 아닌 곳(다음 책 화살표)을 눌러도 브리핑으로 넘어가지 않는다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderGuide();
  await user.click(screen.getByRole('button', { name: '다음 책' }));
  await user.click(screen.getByText('작품 보기'));
  expect(stepId()).toBe('open-book');
  expect(screen.queryByTestId('mobile-briefing')).not.toBeInTheDocument();
  await user.click(GUIDE_STEPS[0].target()!);
  expect(await screen.findByTestId('mobile-briefing')).toBeInTheDocument();
  expect(stepId()).toBe('continue');
});
