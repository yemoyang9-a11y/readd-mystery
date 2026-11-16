import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TocJumpDialog from './TocJumpDialog';

describe('TocJumpDialog', () => {
  it('FR-PRG-003: 안내 문구와 취소·이동 버튼을 보여준다', () => {
    render(<TocJumpDialog onConfirm={() => {}} onCancel={() => {}} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText('여기로 이동하면 관계도와 챗봇이 이 쪽까지의 내용을 다룹니다')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이동' })).toBeInTheDocument();
  });

  it('FR-PRG-003: 이동을 누르면 onConfirm, 취소를 누르면 onCancel만 호출한다', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<TocJumpDialog onConfirm={onConfirm} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '이동' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('FR-PRG-003: Escape는 취소다', async () => {
    const onCancel = vi.fn();
    render(<TocJumpDialog onConfirm={() => {}} onCancel={onCancel} />);

    await userEvent.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
