import { render, screen, within } from '@testing-library/react';
import ChatbotTab from './ChatbotTab';
import type { ChatbotConversationTurn } from '../../types';

/**
 * 2026-11-18 대표 지시 — 답을 만드는 동안 아모가 둘(빈 말풍선 옆 큰 아모 + 작은 아모 "답하는 중")로
 * 보였다. 아모는 말풍선 옆 하나만 두고, 빈 말풍선 안에 점 세 개 입력 표시를 그린다. "답하는 중"은
 * 화면 읽기 프로그램용 상태 문구로만 남긴다(눈에는 안 보임).
 */
const asking: ChatbotConversationTurn[] = [
  { role: 'user', text: '내 노트 보여?' },
  { role: 'assistant', text: '' },
];

function amoAvatars(container: HTMLElement) {
  return container.querySelectorAll('svg[data-amo]');
}

describe('ChatbotTab — 답하는 중 (2026-11-18 대표 지시)', () => {
  it('답을 만드는 동안 아모는 하나이고, 빈 말풍선 안에 점 세 개가 있다', () => {
    const { container } = render(
      <ChatbotTab turns={asking} streaming={true} error={null} onAsk={() => {}} />
    );
    expect(amoAvatars(container)).toHaveLength(1);
    const typing = screen.getByTestId('amo-typing');
    expect(typing.querySelectorAll('[data-typing-dot]')).toHaveLength(3);
    // 점은 아모 말풍선 안에 있다
    expect(typing.closest('.border-progress')).not.toBeNull();
  });

  it('"답하는 중"은 화면 읽기 프로그램용 상태로만 남고 눈에 보이는 줄로 그리지 않는다', () => {
    const { container } = render(
      <ChatbotTab turns={asking} streaming={true} error={null} onAsk={() => {}} />
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('답하는 중');
    expect(status).toHaveClass('sr-only');
    expect(within(status).queryByText('답하는 중')).not.toBeNull();
    expect(status.querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('svg[data-amo="think"]')).toHaveLength(0);
  });

  it('답 글자가 오기 시작하면 점 표시 대신 글자를 보여 주고, 아모는 여전히 하나다 (positive 쌍)', () => {
    const { container } = render(
      <ChatbotTab
        turns={[asking[0], { role: 'assistant', text: '2쪽에 노트가 하나 있어요.' }]}
        streaming={true}
        error={null}
        onAsk={() => {}}
      />
    );
    expect(screen.queryByTestId('amo-typing')).toBeNull();
    // 쪽 언급은 p.N 으로 보인다(2026-11-18 승인 시안) — 글자 내용은 같다
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'P' && el.textContent === 'p.2에 노트가 하나 있어요.'
      )
    ).toBeInTheDocument();
    expect(amoAvatars(container)).toHaveLength(1);
  });

  it('답이 끝나면 상태 문구도 점 표시도 없다', () => {
    render(
      <ChatbotTab
        turns={[asking[0], { role: 'assistant', text: '2쪽에 노트가 하나 있어요.' }]}
        streaming={false}
        error={null}
        onAsk={() => {}}
      />
    );
    expect(screen.queryByTestId('amo-typing')).toBeNull();
    expect(screen.queryByText('답하는 중')).toBeNull();
  });
});
