import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import * as progressService from '../services/progressService';
import * as notesService from '../services/notesService';
import * as chatbotService from '../services/chatbotService';
import * as recapService from '../services/recapService';
import * as ssabiService from '../services/ssabiService';
import * as positionService from '../services/positionService';
import { api } from '../services/api';
import { markOnboarded } from '../services/onboardingService';
import { SUGGESTED_QUESTIONS } from '../components/Ssabi/ChatbotTab';
import GuidePage from './GuidePage';
import { GUIDE_STEPS } from './guideSteps';
import { DEMO_AMO_ANSWER, DEMO_CLUE, DEMO_QUESTION, DEMO_TIMELINE } from './demoBook';

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

const STEP_ORDER = [
  'open-book',
  'recap',
  'pick-sentence',
  'side-notes',
  'side-timeline',
  'side-relationship',
  'ask-amo',
  'finish',
];

function stepText(step: (typeof GUIDE_STEPS)[number]): string {
  return typeof step.text === 'function' ? step.text({ page: 1 }) : step.text;
}

type User = ReturnType<typeof userEvent.setup>;

async function clickNext(user: User) {
  await user.click(screen.getByRole('button', { name: '다음' }));
}

/** "다음"만 눌러 index 단계까지 간다 */
async function nextUntil(user: User, index: number) {
  for (let i = 0; i < index; i += 1) {
    await waitFor(() => expect(GUIDE_STEPS[i].target()).not.toBeNull());
    await clickNext(user);
    await waitFor(() => expect(stepId()).toBe(GUIDE_STEPS[i + 1].id));
  }
  await waitFor(() => expect(GUIDE_STEPS[index].target()).not.toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
});

// 대표 지시 2026-11-19 — 가이드 8단계 (docs/context/guide-redesign-2026-11-19.md 2장)
test('가이드 8단계: 순서는 홈 → 리캡 → 문장 고르기 → 추리 노트 → 타임라인 → 인물관계도 → 아모 → 마무리', () => {
  expect(GUIDE_STEPS.map((step) => step.id)).toEqual(STEP_ORDER);
  expect(GUIDE_STEPS.map((step) => step.tab ?? null)).toEqual([
    null,
    null,
    null,
    'notes',
    'timeline',
    'relationship',
    'chatbot',
    null,
  ]);
  expect(GUIDE_STEPS[GUIDE_STEPS.length - 1].final).toEqual({ title: '이제 진짜 책을 읽어 볼까요', action: '홈으로' });
});

test('가이드 8단계 문구: "메모하고 싶은 문장"이 있고, "싸비"·"수상한 문장"은 0건, "사이드 탭"으로 쓴다', () => {
  const texts = GUIDE_STEPS.map(stepText);
  expect(texts[2]).toContain('메모하고 싶은 문장');
  expect(texts[2]).toContain('노트에 적거나 아모에게 물을 수 있어요');
  expect(texts.filter((t) => t.includes('싸비'))).toEqual([]);
  expect(texts.filter((t) => t.includes('수상한 문장'))).toEqual([]);
  // 단계마다 알려 주는 기능 하나
  expect(texts[0]).toContain('RE:ADD');
  expect(texts[0]).toContain('차례로 읽은 쪽까지만');
  expect(texts[1]).toContain('지난 줄거리');
  expect(texts[3]).toContain('사이드 탭');
  expect(texts[3]).toContain('추리 노트');
  expect(texts[4]).toContain('타임라인');
  expect(texts[5]).toContain('인물관계도');
  expect(texts[6]).toContain('판정하거나 범인을 말하지 않아요');
  expect(texts[6]).toContain('쪽 번호');
  expect(texts[7]).toContain('완독자 커뮤니티');
  expect(texts[7]).toContain('오른쪽 손잡이');
});

test('가이드: "다음"만 눌러도 8단계를 하나씩 지나고, 화면 문구에 "싸비"·"수상한 문장"이 0건이다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderGuide();

  for (let i = 0; i < GUIDE_STEPS.length - 1; i += 1) {
    await waitFor(() => expect(GUIDE_STEPS[i].target()).not.toBeNull());
    expect(stepId()).toBe(GUIDE_STEPS[i].id);
    expect(screen.getByLabelText(`8단계 중 ${i + 1}단계`)).toHaveTextContent(`0${i + 1} / 08`);
    expect(document.body.textContent).not.toContain('싸비');
    expect(document.body.textContent).not.toContain('수상한 문장');
    await clickNext(user);
    await waitFor(() => expect(stepId()).toBe(GUIDE_STEPS[i + 1].id));
  }

  // 마지막 단계: "다음" 대신 기존 마무리 버튼 문구·동작 그대로, 건너뛰기도 없다
  expect(screen.getByRole('heading', { name: '이제 진짜 책을 읽어 볼까요' })).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('싸비');
  expect(screen.queryByRole('button', { name: '다음' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '건너뛰기' })).not.toBeInTheDocument();
  expect(markOnboarded).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '홈으로' }));
  await screen.findByText('진짜 홈 화면');
  expect(markOnboarded).toHaveBeenCalledTimes(1);
});

test('가이드: 비춘 곳을 한 번씩만 눌러 8단계를 지나고(누르기 7번), 끝나면 완료 표시 후 홈으로 간다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderGuide();
  let taps = 0;

  // 1 홈 — 다른 곳을 눌러도 그대로, 표지를 누르면 브리핑
  await waitFor(() => expect(GUIDE_STEPS[0].target()).not.toBeNull());
  const decoy = decoyFor(GUIDE_STEPS[0].target()!);
  if (decoy) {
    await user.click(decoy);
    expect(stepId()).toBe('open-book');
  }
  await user.click(GUIDE_STEPS[0].target()!);
  taps += 1;
  await waitFor(() => expect(stepId()).toBe('recap'));

  // 2 리캡 — 이어서 읽기
  expect(screen.getByTestId('mobile-briefing')).toBeInTheDocument();
  await user.click(GUIDE_STEPS[1].target()!);
  taps += 1;
  await waitFor(() => expect(stepId()).toBe('pick-sentence'));

  // 3 문장 고르기 — 단서 문장이 이미 골라져 있고 "노트에 적기" 한 번이면 가이드가 저장까지 한다
  expect(document.querySelector('[data-testid="guide-reader"] mark')).toHaveTextContent(DEMO_CLUE);
  expect(screen.queryByTestId('mobile-ssabi')).toBeNull();
  await user.click(GUIDE_STEPS[2].target()!);
  taps += 1;
  await waitFor(() => expect(stepId()).toBe('side-notes'));

  // 4 사이드 탭·추리 노트 — 가이드가 사이드 탭을 열어 두었고, 노트 창 없이 저장된 노트가 보인다. 누르기 없음
  const panel = () => screen.getByTestId('mobile-ssabi');
  expect(within(panel()).getByRole('tab', { name: '추리 노트' })).toHaveAttribute('aria-selected', 'true');
  expect(within(panel()).getAllByText(DEMO_CLUE).length).toBeGreaterThan(0);
  expect(screen.queryByRole('dialog', { name: '단서·가설 적기' })).toBeNull();
  await user.click(GUIDE_STEPS[3].target()!);
  expect(stepId()).toBe('side-notes');
  await clickNext(user);
  await waitFor(() => expect(stepId()).toBe('side-timeline'));

  // 5 타임라인 — 가이드가 탭을 바꿔 두고, 1장을 누르면 사건 카드가 펼쳐진다. 그 자리에 머문다
  expect(within(panel()).getByRole('tab', { name: '타임라인' })).toHaveAttribute('aria-selected', 'true');
  const chapter = GUIDE_STEPS[4].target() as HTMLElement;
  expect(chapter).toHaveTextContent('1장 비 오는 별장');
  expect(chapter).toHaveTextContent('사라진 회중시계, 그리고 열 시 십 분에 멈춘 괘종시계.');
  await user.click(within(chapter).getAllByRole('button')[0]);
  taps += 1;
  expect(chapter.querySelector('[data-chapter-events]')).not.toBeNull();
  expect(within(chapter).getByText('괘종시계가 멈춰 있음')).toBeInTheDocument();
  expect(stepId()).toBe('side-timeline');
  await clickNext(user);
  await waitFor(() => expect(stepId()).toBe('side-relationship'));

  // 6 인물관계도 — 윤미라를 누르면 그 인물의 관계가 펼쳐진다. 그 자리에 머문다
  expect(within(panel()).getByRole('tab', { name: '인물관계도' })).toHaveAttribute('aria-selected', 'true');
  await user.click(GUIDE_STEPS[5].target()!);
  taps += 1;
  expect(stepId()).toBe('side-relationship');
  const relationRow = GUIDE_STEPS[5].target()!.closest('details');
  expect(relationRow?.open || within(panel()).queryByRole('region', { name: '관계 설명' })?.textContent?.includes('윤미라')).toBe(true);
  await clickNext(user);
  await waitFor(() => expect(stepId()).toBe('ask-amo'));

  // 7 아모 — 추천 질문 한 번이면 가이드가 바로 묻고 미리 쓴 답을 곧바로 보여 준다(기다림 없음)
  expect(within(panel()).getByRole('tab', { name: '아모' })).toHaveAttribute('aria-selected', 'true');
  await user.click(GUIDE_STEPS[6].target()!);
  taps += 1;
  expect(within(panel()).getByText(/제가 정하지 않을게요/)).toBeInTheDocument();
  expect(within(panel()).getByRole('button', { name: 'p.4' })).toBeInTheDocument();
  expect(stepId()).toBe('ask-amo');
  await clickNext(user);
  await waitFor(() => expect(stepId()).toBe('finish'));

  // 8 마무리 카드 — "홈으로"
  expect(screen.getByRole('heading', { name: '이제 진짜 책을 읽어 볼까요' })).toBeInTheDocument();
  expect(markOnboarded).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '홈으로' }));
  taps += 1;
  await screen.findByText('진짜 홈 화면');
  expect(markOnboarded).toHaveBeenCalledTimes(1);
  // 독자가 직접 누르는 횟수 7번 (가이드 정리안 2장)
  expect(taps).toBe(7);
});

test('가이드 7단계: 추천 질문을 누르면 입력 칸에 넣지 않고 가이드가 바로 보낸다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderGuide();
  const at = GUIDE_STEPS.findIndex((step) => step.id === 'ask-amo');
  await nextUntil(user, at);
  await user.click(GUIDE_STEPS[at].target()!);
  const panel = screen.getByTestId('mobile-ssabi');
  expect(within(panel).getByText(/제가 정하지 않을게요/)).toBeInTheDocument();
  const input = panel.querySelector<HTMLTextAreaElement>('textarea');
  expect(input).not.toBeNull();
  expect(input!.value).toBe('');
});

test('가이드: 데모 흐름 전체에서 진도·노트·챗봇·리캡·관계도 서비스와 API를 한 번도 부르지 않는다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderGuide();

  for (const step of GUIDE_STEPS.slice(0, -1)) {
    await waitFor(() => expect(step.target()).not.toBeNull());
    const target = step.target()!;
    // 비춘 곳을 눌러 보고(타임라인은 장 버튼), 그 자리에 머무는 단계는 "다음"
    const button = target.matches('li') ? within(target as HTMLElement).getAllByRole('button')[0] : target;
    await user.click(button);
    if (stepId() === step.id) await clickNext(user);
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

test('가이드 7단계 데모 답: 노트를 이어 주되 판정하지 않고 범인을 말하지 않는다 (NFR-AI-005 🚦)', () => {
  expect(DEMO_AMO_ANSWER).toContain(DEMO_CLUE);
  expect(DEMO_AMO_ANSWER).toContain('제가 정하지 않을게요');
  expect(DEMO_AMO_ANSWER).not.toMatch(/범인|맞아요|틀렸어요|정답/);
  expect(SUGGESTED_QUESTIONS as readonly string[]).toContain(DEMO_QUESTION);
});

test('가이드 5단계 데모 타임라인: 다 읽은 1장에만 핵심 한 줄·사건이 있고, 읽는 중인 2장은 비어 있다', () => {
  const [first, second] = DEMO_TIMELINE.chapters;
  expect(first.completed).toBe(true);
  expect(first.key_point).toBeTruthy();
  const inFirst = DEMO_TIMELINE.events.filter(
    (e) => e.occurrence_page >= first.start_page && e.occurrence_page <= first.end_page
  );
  expect(inFirst.length).toBeGreaterThanOrEqual(3);
  // FR-SPL-002 🚦 — 데모여도 기준점(4쪽) 뒤 사건은 0건, 기준점 안 사건은 있다(positive)
  expect(DEMO_TIMELINE.events.filter((e) => e.occurrence_page > DEMO_TIMELINE.applied_cutoff)).toEqual([]);
  expect(DEMO_TIMELINE.events.filter((e) => e.occurrence_page <= DEMO_TIMELINE.applied_cutoff).length).toBeGreaterThan(0);
  expect(second.completed).toBe(false);
  expect(second.summary).toBeNull();
  expect(second.key_point).toBeNull();
});

test('가이드: 건너뛰기를 누르면 완료 표시 후 홈으로 간다', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderGuide();
  expect(stepId()).toBe('open-book');
  await user.click(screen.getByRole('button', { name: '건너뛰기' }));
  await screen.findByText('진짜 홈 화면');
  expect(markOnboarded).toHaveBeenCalledTimes(1);
});

// 대표 지시 2026-11-19 — 건너뛰기는 화면 오른쪽, 말풍선의 예전 건너뛰기 자리에는 "다음"
test('가이드: 말풍선 아래 줄 오른쪽에 "다음"이 있고, 건너뛰기는 말풍선 밖 화면 오른쪽에 있다', async () => {
  renderGuide();
  await waitFor(() => expect(GUIDE_STEPS[0].target()).not.toBeNull());
  const bubble = screen.getByTestId('guide-bubble');
  const next = screen.getByRole('button', { name: '다음' });
  const skip = screen.getByRole('button', { name: '건너뛰기' });

  expect(bubble).toContainElement(next);
  // 아래 줄: 왼쪽 단계 표시, 오른쪽(마지막 자리) "다음"
  const footer = next.parentElement!;
  expect(footer.lastElementChild).toBe(next);
  expect(footer.firstElementChild).toHaveAccessibleName(`${GUIDE_STEPS.length}단계 중 1단계`);

  expect(bubble).not.toContainElement(skip);
  expect(skip.closest('[data-guide-ui]')).not.toBeNull();
  expect(skip).toHaveAttribute('data-guide-skip');
  expect(skip.className).toMatch(/\bfixed\b/);
  expect(skip.className).toMatch(/\bright-4\b/);
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
  expect(stepId()).toBe('recap');
});
