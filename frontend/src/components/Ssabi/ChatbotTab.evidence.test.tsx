import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ChatbotTab from './ChatbotTab';
import type { ChatbotConversationTurn } from '../../types';

const ANSWER = '촬영 시점을 가려내는 단서예요 (p.65). 거울에 비친 모습으로 따져요 (p.66).';

const answered: ChatbotConversationTurn[] = [
  { role: 'user', text: '금붕어 사진이 왜 중요해?' },
  {
    role: 'assistant',
    text: ANSWER,
    evidence: [
      { page: 65, text: '그 금붕어 그릇에는 두 마리의 금붕어가 떠 있을 것이다.' },
      { page: 66, text: '거울에 비친 얼굴을 보면 알 수 있다.' },
    ],
    followUps: ['거울에 비친 얼굴은 무슨 뜻이야?', '나용귀의 알리바이를 정리해 줘'],
  },
];

type Props = Partial<Parameters<typeof ChatbotTab>[0]>;

function setup(props: Props = {}, { mobile = true }: { mobile?: boolean } = {}) {
  const onAsk = vi.fn();
  const onJumpToPage = vi.fn();
  const onSaveClue = vi.fn().mockResolvedValue(true);
  const ui = (p: Props) => (
    <div data-mobile={mobile ? 'true' : undefined}>
      <ChatbotTab
        streaming={false}
        error={null}
        onAsk={onAsk}
        turns={answered}
        onJumpToPage={onJumpToPage}
        onSaveClue={onSaveClue}
        {...p}
      />
    </div>
  );
  const view = render(ui(props));
  return { onAsk, onJumpToPage, onSaveClue, rerender: (p: Props) => view.rerender(ui(p)) };
}

describe('아모 답변 — 쪽 키캡을 누르면 근거 문장이 바로 펼쳐진다 (모바일)', () => {
  it('답이 끝나면 첫 번째 쪽 키캡이 선택되어 그 쪽의 근거 문장이 보인다', () => {
    setup();
    expect(screen.getByRole('button', { name: 'p.65' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'p.66' })).toHaveAttribute('aria-pressed', 'false');
    const quote = document.querySelector('[data-amo-evidence]') as HTMLElement;
    expect(quote).toHaveTextContent('p.65에서');
    expect(quote).toHaveTextContent('그 금붕어 그릇에는 두 마리의 금붕어가 떠 있을 것이다.');
  });

  it('다른 키캡을 누르면 근거가 그 쪽 것으로 바뀌고 한 번에 하나만 보인다, 말풍선은 없다', async () => {
    const { onJumpToPage } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'p.66' }));
    expect(screen.getByRole('button', { name: 'p.66' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'p.65' })).toHaveAttribute('aria-pressed', 'false');
    const quotes = document.querySelectorAll('[data-amo-evidence]');
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toHaveTextContent('p.66에서');
    expect(quotes[0]).toHaveTextContent('거울에 비친 얼굴을 보면 알 수 있다.');
    expect(document.querySelector('.amo-page-tip')).toBeNull();
    expect(onJumpToPage).not.toHaveBeenCalled();
  });

  it('스트리밍 중에는 아직 아무 키캡도 선택하지 않고 근거도 펼치지 않는다', () => {
    setup({ streaming: true });
    expect(document.querySelector('[data-amo-evidence]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'p.65', pressed: true })).toBeNull();
  });

  it('evidence 에 없는 쪽은 근거를 지어내지 않는다 — 기존처럼 "펼치기" 말풍선을 거쳐 한 번 더 눌러야 이동한다', async () => {
    const { onJumpToPage } = setup({
      turns: [answered[0], { ...answered[1], evidence: [{ page: 65, text: '그 금붕어 그릇' }] }],
    });
    expect(screen.getByRole('button', { name: 'p.66' })).not.toHaveAttribute('aria-pressed');
    await userEvent.click(screen.getByRole('button', { name: 'p.66' }));
    expect(document.querySelectorAll('[data-amo-evidence]')).toHaveLength(1);
    expect(document.querySelector('[data-amo-evidence]')).toHaveTextContent('p.65에서');
    expect(screen.getByRole('button', { name: 'p.65', pressed: true })).toBeInTheDocument();
    expect(onJumpToPage).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'p.66 펼치기' }));
    expect(onJumpToPage).toHaveBeenCalledWith(66);
  });

  it('evidence 가 아예 없는 답(지난 대화)은 근거 펼침·행동 줄·후속 질문이 없다', () => {
    setup({ turns: [answered[0], { role: 'assistant', text: ANSWER }] });
    expect(document.querySelector('[data-amo-evidence]')).toBeNull();
    expect(screen.queryByRole('button', { name: '단서로 저장' })).toBeNull();
    expect(screen.queryByRole('button', { name: /펼치기/ })).toBeNull();
  });

  it('키캡 터치 영역은 투명 영역으로 44px 이상으로 넓힌다', () => {
    setup();
    const key = screen.getByRole('button', { name: 'p.65' });
    expect(key.className).toMatch(/after:-inset-y-\[9px\]/);
    expect(key.className).toMatch(/h-\[26px\]/);
  });

  it('데스크톱(data-mobile 밖)은 예전 그대로 — 한 번 누르면 "펼치기" 말풍선, 근거 블록은 없다', async () => {
    setup({}, { mobile: false });
    expect(document.querySelector('[data-amo-evidence]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'p.65' }));
    expect(screen.getByRole('button', { name: 'p.65 펼치기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '단서로 저장' })).toBeNull();
    expect(screen.queryByRole('group', { name: '이어 묻기' })).toBeNull();
  });
});

describe('아모 답변 아래 행동 줄 — 단서로 저장 · 쪽 펼치기 (모바일)', () => {
  it('선택된 쪽의 근거로 추리 노트에 단서를 저장하고, 성공하면 "저장됨"으로 바뀌어 다시 못 누른다', async () => {
    const { onSaveClue } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'p.66' }));
    await userEvent.click(screen.getByRole('button', { name: '단서로 저장' }));
    expect(onSaveClue).toHaveBeenCalledTimes(1);
    expect(onSaveClue).toHaveBeenCalledWith(66, '거울에 비친 얼굴을 보면 알 수 있다.');
    const saved = await screen.findByRole('button', { name: '저장됨' });
    expect(saved).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(saved);
    expect(onSaveClue).toHaveBeenCalledTimes(1);
  });

  it('저장에 실패하면 버튼은 그대로이고 다시 누를 수 있다', async () => {
    const { onSaveClue } = setup();
    onSaveClue.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: '단서로 저장' }));
    await waitFor(() => expect(onSaveClue).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: '저장됨' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '단서로 저장' }));
    expect(onSaveClue).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: '저장됨' })).toBeInTheDocument();
  });

  it('같은 쪽·같은 문장은 저장 중에 또 눌러도 한 번만 저장한다, 다른 쪽은 따로 저장된다', async () => {
    let resolve: (ok: boolean) => void = () => {};
    const { onSaveClue } = setup();
    onSaveClue.mockReturnValueOnce(new Promise<boolean>((r) => (resolve = r)));
    const button = screen.getByRole('button', { name: '단서로 저장' });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(onSaveClue).toHaveBeenCalledTimes(1);
    resolve(true);
    await screen.findByRole('button', { name: '저장됨' });
    await userEvent.click(screen.getByRole('button', { name: 'p.66' }));
    await userEvent.click(screen.getByRole('button', { name: '단서로 저장' }));
    expect(onSaveClue).toHaveBeenLastCalledWith(66, '거울에 비친 얼굴을 보면 알 수 있다.');
  });

  it('"p.N 펼치기"는 선택된 쪽으로 이동만 한다 — onJumpToPage 한 번, 질문 전송 없음 (FR-PRG-003, R1)', async () => {
    const { onJumpToPage, onAsk } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'p.66' }));
    await userEvent.click(screen.getByRole('button', { name: 'p.66 펼치기' }));
    expect(onJumpToPage).toHaveBeenCalledTimes(1);
    expect(onJumpToPage).toHaveBeenCalledWith(66);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('가장 마지막 아모 답변에만 행동 줄이 있다, 지난 답변에는 근거 펼침만', () => {
    setup({
      turns: [
        { role: 'user', text: '앞 질문' },
        {
          role: 'assistant',
          text: '앞 답 (p.3).',
          evidence: [{ page: 3, text: '세 번째 쪽 문장' }],
          followUps: ['옛 질문'],
        },
        ...answered,
      ],
    });
    expect(screen.getAllByRole('button', { name: '단서로 저장' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^p\.\d+ 펼치기$/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '옛 질문' })).toBeNull();
    expect(screen.getAllByText('세 번째 쪽 문장')).toHaveLength(1);
  });

  it('스트리밍 중이면 행동 줄이 없다', () => {
    setup({ streaming: true });
    expect(screen.queryByRole('button', { name: '단서로 저장' })).toBeNull();
  });

  it('저장 함수(onSaveClue)가 없으면 저장 버튼 없이 쪽 펼치기만 남는다', () => {
    setup({ onSaveClue: undefined });
    expect(screen.queryByRole('button', { name: '단서로 저장' })).toBeNull();
    expect(screen.getByRole('button', { name: 'p.65 펼치기' })).toBeInTheDocument();
  });
});

describe('이어 묻기 질문 (모바일)', () => {
  it('질문 칩 둘을 누르면 입력창을 거치지 않고 바로 전송한다', async () => {
    const { onAsk } = setup();
    const group = screen.getByRole('group', { name: '이어 묻기' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '거울에 비친 얼굴은 무슨 뜻이야?',
      '나용귀의 알리바이를 정리해 줘',
    ]);
    await userEvent.click(
      within(group).getByRole('button', { name: '나용귀의 알리바이를 정리해 줘' })
    );
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk.mock.calls[0][0]).toBe('나용귀의 알리바이를 정리해 줘');
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('후속 질문이 없으면 칩을 그리지 않는다', () => {
    setup({ turns: [answered[0], { ...answered[1], followUps: undefined }] });
    expect(screen.queryByRole('group', { name: '이어 묻기' })).toBeNull();
  });

  it('스트리밍 중에는 칩을 그리지 않는다', () => {
    setup({ streaming: true });
    expect(screen.queryByRole('group', { name: '이어 묻기' })).toBeNull();
  });

  it('새 질문이 시작되면(새 답변 턴) 이전 칩은 사라진다', () => {
    const { rerender } = setup();
    expect(screen.getByRole('group', { name: '이어 묻기' })).toBeInTheDocument();
    rerender({
      streaming: true,
      turns: [...answered, { role: 'user', text: '새 질문' }, { role: 'assistant', text: '' }],
    });
    expect(screen.queryByRole('group', { name: '이어 묻기' })).toBeNull();
  });

  it('대화가 비어 있을 때의 추천 질문은 그대로 입력칸만 채운다', async () => {
    const { onAsk } = setup({ turns: [] });
    await userEvent.click(screen.getByRole('button', { name: '지금까지 나온 인물 정리해 줘' }));
    expect(onAsk).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('지금까지 나온 인물 정리해 줘');
  });
});
