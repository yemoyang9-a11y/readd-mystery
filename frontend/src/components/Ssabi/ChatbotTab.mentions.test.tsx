import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ChatbotTab from './ChatbotTab';

// 2026-11-18 대표 승인 시안 — 인물 이름 강조색, 쪽 표시는 괄호 없는 키캡(①), 한 번 누르면 검은 말풍선, 한 번 더 누르면 이동
function setup(onJumpToPage = vi.fn()) {
  render(
    <ChatbotTab
      streaming={false}
      error={null}
      onAsk={vi.fn()}
      turns={[
        { role: 'user', text: '백검사와 관련된 인물을 알려줘' },
        { role: 'assistant', text: '백검사는 임경부와 함께 수사해요(p.13). 공연 뒤에도 만나요 15쪽.' },
      ]}
      mentionNames={['백검사', '임경부']}
      totalPages={68}
      onJumpToPage={onJumpToPage}
    />
  );
  return onJumpToPage;
}

describe('아모 답변 — 인물 강조·쪽 키캡', () => {
  it('인물 이름은 강조 표시로, 독자 말풍선의 이름은 그대로', () => {
    setup();
    const highlighted = document.querySelectorAll('[data-amo-name]');
    expect([...highlighted].map((el) => el.textContent)).toEqual(['백검사', '임경부']);
  });

  it('쪽 언급은 괄호 없이 키캡 버튼으로 — "(p.13)"의 괄호가 화면에 없다', () => {
    setup();
    expect(screen.getByRole('button', { name: 'p.13' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'p.15' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('(p.13)');
  });

  it('한 번 누르면 "p.13 펼치기" 말풍선만 뜨고 이동하지 않는다, 한 번 더 누르면 그 쪽으로 이동', async () => {
    const onJump = setup();
    const key = screen.getByRole('button', { name: 'p.13' });
    await userEvent.click(key);
    expect(screen.getByRole('button', { name: 'p.13 펼치기' })).toBeInTheDocument();
    expect(onJump).not.toHaveBeenCalled();
    await userEvent.click(key);
    expect(onJump).toHaveBeenCalledWith(13);
  });

  it('말풍선을 눌러도 이동한다', async () => {
    const onJump = setup();
    await userEvent.click(screen.getByRole('button', { name: 'p.15' }));
    await userEvent.click(screen.getByRole('button', { name: 'p.15 펼치기' }));
    expect(onJump).toHaveBeenCalledWith(15);
  });

  it('말풍선은 한 번에 하나 — 다른 쪽을 누르면 앞의 말풍선은 닫힌다', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'p.13' }));
    await userEvent.click(screen.getByRole('button', { name: 'p.15' }));
    expect(screen.queryByRole('button', { name: 'p.13 펼치기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'p.15 펼치기' })).toBeInTheDocument();
  });

  it('이동할 곳(onJumpToPage)이 없으면 쪽은 글자로만 보이고 버튼이 아니다', () => {
    render(
      <ChatbotTab
        streaming={false}
        error={null}
        onAsk={vi.fn()}
        turns={[{ role: 'assistant', text: '수사해요(p.13).' }]}
        mentionNames={[]}
        totalPages={68}
      />
    );
    expect(screen.queryByRole('button', { name: 'p.13' })).not.toBeInTheDocument();
    expect(document.body.textContent).toContain('수사해요 p.13.');
  });
});
