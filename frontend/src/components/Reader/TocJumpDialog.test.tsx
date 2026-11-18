import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TocJumpDialog from './TocJumpDialog';

function renderDialog(overrides: Partial<Parameters<typeof TocJumpDialog>[0]> = {}) {
  const props = {
    targetPage: 200,
    onMoveOnly: vi.fn(),
    onReadThrough: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<TocJumpDialog {...props} />);
  return props;
}

describe('TocJumpDialog', () => {
  it('FR-PRG-003: 목표 쪽 번호와 안내 문구, 세 버튼을 보여준다', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      '200쪽으로 이동합니다. 앞부분을 이미 읽으셨다면 관계도와 챗봇이 이 쪽까지 다룹니다. 이동만 하면 지금까지 차례로 읽은 쪽까지만 다룹니다.'
    );
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['취소', '이동만 하기', '앞부분은 이미 읽었어요']);
  });

  it('FR-PRG-003: 버튼마다 자기 콜백 하나만 부른다', async () => {
    const props = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onMoveOnly).not.toHaveBeenCalled();
    expect(props.onReadThrough).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '이동만 하기' }));
    expect(props.onMoveOnly).toHaveBeenCalledTimes(1);
    expect(props.onReadThrough).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '앞부분은 이미 읽었어요' }));
    expect(props.onReadThrough).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onMoveOnly).toHaveBeenCalledTimes(1);
  });

  it('FR-PRG-003: 처음 초점은 취소에 있다', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: '취소' })).toHaveFocus();
  });

  it('FR-PRG-003: Escape는 취소다', async () => {
    const props = renderDialog();

    await userEvent.keyboard('{Escape}');

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onMoveOnly).not.toHaveBeenCalled();
    expect(props.onReadThrough).not.toHaveBeenCalled();
  });

  it('NFR-USE: 버튼은 좁은 화면에서 한 줄씩 꽉 차게 쌓이고 최소 44px 높이다', () => {
    renderDialog();

    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('w-full');
    }
  });
});

it('NFR-USE: Tab과 Shift+Tab은 확인 창 안에서 순환한다', async () => {
  renderDialog();
  await userEvent.tab({ shift: true });
  expect(screen.getByRole('button', { name: '앞부분은 이미 읽었어요' })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: '취소' })).toHaveFocus();
});

it('NFR-USE: 부모가 다시 렌더되어도 사용자가 고른 초점을 유지한다', async () => {
  const { rerender } = render(<TocJumpDialog targetPage={200} onCancel={() => {}} onMoveOnly={() => {}} onReadThrough={() => {}} />);
  await userEvent.tab();
  expect(screen.getByRole('button', { name: '이동만 하기' })).toHaveFocus();
  rerender(<TocJumpDialog targetPage={200} onCancel={() => {}} onMoveOnly={() => {}} onReadThrough={() => {}} />);
  expect(screen.getByRole('button', { name: '이동만 하기' })).toHaveFocus();
});
