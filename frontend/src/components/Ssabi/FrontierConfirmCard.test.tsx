import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FrontierConfirmCard from './FrontierConfirmCard';
import SsabiPanel from './SsabiPanel';
import type { FrontierConfirmPrompt } from '../../types';

const PROMPT: FrontierConfirmPrompt = { applied_cutoff: 40, current_page: 120, furthest_page: 200 };

describe('FrontierConfirmCard — 넘겨 본 쪽 확인 (FR-PRG-003 🚦)', () => {
  test('FR-PRG-003: 서버가 준 숫자를 그대로 넣은 문구와 세 버튼을 보여준다', () => {
    render(<FrontierConfirmCard prompt={PROMPT} onAnswer={vi.fn()} />);

    const card = screen.getByRole('region', { name: '읽은 범위 확인' });
    expect(card).toHaveTextContent(
      '200쪽까지 넘겨 보셨어요. 거기까지 읽으셨나요? 지금은 40쪽까지를 기준으로 보여 드려요.'
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '그대로 둘게요',
      '120쪽까지 읽었어요',
      '200쪽까지 읽었어요',
    ]);
  });

  test('FR-PRG-003: current_page가 null이면 중간 선택지를 보여주지 않는다', () => {
    render(<FrontierConfirmCard prompt={{ ...PROMPT, current_page: null }} onAnswer={vi.fn()} />);

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '그대로 둘게요',
      '200쪽까지 읽었어요',
    ]);
  });

  test.each([
    ['그대로 둘게요', 'keep'],
    ['120쪽까지 읽었어요', 'current'],
    ['200쪽까지 읽었어요', 'furthest'],
  ] as const)('FR-PRG-003: "%s"는 choice=%s 하나만 보낸다', async (label, choice) => {
    const onAnswer = vi.fn().mockResolvedValue(true);
    render(<FrontierConfirmCard prompt={PROMPT} onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole('button', { name: label }));

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(choice);
  });

  test('FR-SPL-005: 답이 실패하면 카드와 버튼을 그대로 두고 다시 고를 수 있다', async () => {
    const onAnswer = vi.fn().mockResolvedValue(false);
    render(<FrontierConfirmCard prompt={PROMPT} onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole('button', { name: '200쪽까지 읽었어요' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '200쪽까지 읽었어요' })).toBeEnabled());
    expect(screen.getByRole('region', { name: '읽은 범위 확인' })).toBeInTheDocument();
  });

  test('FR-PRG-003: 답을 기다리는 동안 버튼을 다시 누를 수 없다', async () => {
    let release!: (ok: boolean) => void;
    const onAnswer = vi.fn(() => new Promise<boolean>((resolve) => (release = resolve)));
    render(<FrontierConfirmCard prompt={PROMPT} onAnswer={onAnswer} />);

    await userEvent.click(screen.getByRole('button', { name: '그대로 둘게요' }));

    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    release(false);
    await waitFor(() => expect(screen.getByRole('button', { name: '그대로 둘게요' })).toBeEnabled());
  });

  test('NFR-USE: 버튼은 최소 44px 높이다', () => {
    render(<FrontierConfirmCard prompt={PROMPT} onAnswer={vi.fn()} />);

    for (const button of screen.getAllByRole('button')) expect(button.className).toContain('min-h-11');
  });
});

const panelProps = {
  sessionEpoch: 7,
  onTabChange: () => {},
  onCharacterModeChange: () => {},
  graph: { nodes: [], edges: [] },
  graphFailed: false,
  notes: [],
  notesFailed: false,
  currentPage: 120 as number | null,
  onAddNote: async () => true,
  onEditNote: async () => true,
  onRemoveNote: async () => true,
  onJumpToNote: () => {},
  chatTurns: [],
  chatStreaming: false,
  chatError: null,
  chatConversations: [],
  chatHistoryOpen: false,
  onAsk: () => {},
  onNewChat: () => {},
  onToggleChatHistory: () => {},
  onSelectChatConversation: () => {},
};

describe('싸비 패널의 확인 카드', () => {
  test('FR-PRG-003: 확인 요청이 있으면 패널 위쪽에 카드를 보여준다', async () => {
    const onFrontierConfirm = vi.fn().mockResolvedValue(true);
    render(<SsabiPanel {...panelProps} frontierConfirm={PROMPT} onFrontierConfirm={onFrontierConfirm} />);

    expect(screen.getByRole('region', { name: '읽은 범위 확인' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '200쪽까지 읽었어요' }));
    expect(onFrontierConfirm).toHaveBeenCalledWith('furthest');
  });

  test('FR-PRG-003: 확인 요청이 없으면(null) 카드를 그리지 않는다', () => {
    render(<SsabiPanel {...panelProps} frontierConfirm={null} onFrontierConfirm={vi.fn()} />);

    expect(screen.queryByRole('region', { name: '읽은 범위 확인' })).not.toBeInTheDocument();
  });
});
