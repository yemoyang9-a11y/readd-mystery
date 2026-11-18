import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatbotTab from './ChatbotTab';

// 2026-11-18 대표 지시 — 입력칸 문구·보내기 버튼 다시 디자인
describe('ChatbotTab 입력칸', () => {
  it('입력칸 문구는 짧은 "아모에게 물어보세요"이고 예전 문구는 없다', () => {
    render(<ChatbotTab answer="" streaming={false} error={null} onAsk={() => {}} />);
    expect(screen.getByPlaceholderText('아모에게 물어보세요')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/스포일러 없이 답해줄게요/)).toBeNull();
  });

  it('보내기 버튼은 위쪽 화살표 아이콘이고, 글이 없으면 회색·글이 있으면 강조색이다', async () => {
    render(<ChatbotTab answer="" streaming={false} error={null} onAsk={() => {}} />);
    const button = screen.getByRole('button', { name: '질문 보내기' });
    expect(button.querySelector('svg[data-icon="arrow-up"]')).not.toBeNull();
    expect(button.className).toContain('bg-brief-rule');
    expect(button.className).not.toContain('opacity');

    await userEvent.type(screen.getByLabelText('질문'), '정 주사는 누구야?');
    expect(button.className).toContain('bg-brief-accent');
  });
});
