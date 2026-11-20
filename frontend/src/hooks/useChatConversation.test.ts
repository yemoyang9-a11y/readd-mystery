import { act, renderHook } from '@testing-library/react';
import { useChatConversation } from './useChatConversation';
import type { SseFrame } from '../types';

const askChatbotMock = vi.fn();
vi.mock('../services/chatbotService', () => ({
  askChatbot: (...args: unknown[]) => askChatbotMock(...args),
  fetchChatConversations: vi.fn(async () => []),
  fetchChatConversationDetail: vi.fn(),
  deleteChatConversation: vi.fn(),
}));

async function* frames(...items: SseFrame[]): AsyncGenerator<SseFrame> {
  for (const item of items) yield item;
}

beforeEach(() => {
  askChatbotMock.mockReset();
  localStorage.clear();
});

/**
 * conversation_id는 백엔드 BIGINT 컬럼에서 나와 항상 문자열로 온다("279") — 숫자만
 * 믿고 typeof로 걸렀다가 conversationId가 절대 안 채워져 매 질문이 새 대화로 갈라지던
 * 버그(2026-08-25, 사용자 재보고 — "아직도 챗봇 대화가 분리되어 저장되는 문제가
 * 있어"). negative(고쳐지기 전 증상)와 positive(고친 뒤 동작)를 쌍으로 확인한다.
 */
describe('useChatConversation — conversationId 문자열 정규화', () => {
  it('positive: done 프레임의 문자열 conversation_id를 정수로 기억한다', async () => {
    askChatbotMock.mockReturnValueOnce(
      frames(
        { type: 'delta', text: '답' },
        { type: 'done', applied_cutoff: 4, conversation_id: '279' }
      )
    );
    const { result } = renderHook(() => useChatConversation('takryu'));

    await act(async () => {
      await result.current.ask('정주사가 누구야', 5, 1);
    });

    expect(result.current.conversationId).toBe(279);
  });

  it('positive: 다음 질문은 그 정수 conversationId를 그대로 실어 보낸다 — 같은 대화로 이어진다', async () => {
    askChatbotMock
      .mockReturnValueOnce(frames({ type: 'done', applied_cutoff: 4, conversation_id: '279' }))
      .mockReturnValueOnce(frames({ type: 'done', applied_cutoff: 4, conversation_id: '279' }));
    const { result } = renderHook(() => useChatConversation('takryu'));

    await act(async () => {
      await result.current.ask('정주사가 누구야', 5, 1);
    });
    await act(async () => {
      await result.current.ask('고태수는 뭐하는 사람이야', 5, 2);
    });

    // askChatbot(bookId, query, page, seq, conversationId, quote, fromPage)
    expect(askChatbotMock).toHaveBeenNthCalledWith(
      2,
      'takryu',
      '고태수는 뭐하는 사람이야',
      5,
      2,
      279,
      undefined,
      // fromPage — 질문에 동봉하는 직전 화면 쪽. 이 시험은 넘기지 않는다 (2026-11-18)
      undefined
    );
  });

  it('negative: conversation_id가 아예 없는 done(구경로)이면 conversationId를 건드리지 않는다', async () => {
    askChatbotMock.mockReturnValueOnce(frames({ type: 'done', applied_cutoff: 4 }));
    const { result } = renderHook(() => useChatConversation('takryu'));

    await act(async () => {
      await result.current.ask('정주사가 누구야', 5, 1);
    });

    expect(result.current.conversationId).toBeNull();
  });
});

describe('useChatConversation — evidence·follow_ups 프레임을 그 답변 턴에 붙인다', () => {
  it('done 앞의 evidence·follow_ups 프레임이 마지막 아모 답변에 붙고 글자는 그대로다', async () => {
    askChatbotMock.mockReturnValueOnce(
      frames(
        { type: 'delta', text: '금붕어는 단서예요 (p.65).' },
        { type: 'evidence', items: [{ page: 65, text: '금붕어 그릇에는 두 마리가 떠 있다.' }] },
        { type: 'follow_ups', questions: ['거울은 무슨 뜻이야?', '알리바이를 정리해 줘'] },
        { type: 'done', applied_cutoff: 66, conversation_id: '3' }
      )
    );
    const { result } = renderHook(() => useChatConversation('takryu'));

    await act(async () => {
      await result.current.ask('금붕어 사진이 왜 중요해?', 66, 1);
    });

    expect(result.current.turns).toEqual([
      { role: 'user', text: '금붕어 사진이 왜 중요해?' },
      {
        role: 'assistant',
        text: '금붕어는 단서예요 (p.65).',
        evidence: [{ page: 65, text: '금붕어 그릇에는 두 마리가 떠 있다.' }],
        followUps: ['거울은 무슨 뜻이야?', '알리바이를 정리해 줘'],
      },
    ]);
    expect(result.current.conversationId).toBe(3);
  });

  it('두 프레임이 없어도 답변은 그대로 — 근거·후속 질문 필드가 생기지 않는다', async () => {
    askChatbotMock.mockReturnValueOnce(
      frames({ type: 'delta', text: '답' }, { type: 'done', applied_cutoff: 4 })
    );
    const { result } = renderHook(() => useChatConversation('takryu'));

    await act(async () => {
      await result.current.ask('질문', 5, 1);
    });

    expect(result.current.turns[1]).toEqual({ role: 'assistant', text: '답' });
  });

  it('새 질문을 보내면 이전 답변의 후속 질문은 이전 턴에 남고 새 턴에는 없다', async () => {
    askChatbotMock
      .mockReturnValueOnce(
        frames(
          { type: 'delta', text: '첫 답' },
          { type: 'follow_ups', questions: ['다음은?'] },
          { type: 'done' }
        )
      )
      .mockReturnValueOnce(frames({ type: 'delta', text: '둘째 답' }, { type: 'done' }));
    const { result } = renderHook(() => useChatConversation('takryu'));

    await act(async () => {
      await result.current.ask('하나', 5, 1);
    });
    await act(async () => {
      await result.current.ask('둘', 5, 2);
    });

    expect(result.current.turns[1].followUps).toEqual(['다음은?']);
    expect(result.current.turns[3]).toEqual({ role: 'assistant', text: '둘째 답' });
  });

  it('error 가 오면 근거·후속 질문이 붙은 조각도 남기지 않는다 (FR-SPL-005)', async () => {
    askChatbotMock.mockReturnValueOnce(
      frames(
        { type: 'delta', text: '조각' },
        { type: 'evidence', items: [{ page: 3, text: '문장' }] },
        { type: 'error', message: '실패' }
      )
    );
    const { result } = renderHook(() => useChatConversation('takryu'));

    await act(async () => {
      await result.current.ask('질문', 5, 1);
    });

    expect(result.current.turns).toEqual([{ role: 'user', text: '질문' }]);
    expect(result.current.error).toBe('실패');
  });
});
