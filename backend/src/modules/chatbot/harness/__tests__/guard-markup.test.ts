import { guardAnswer } from '../output-guard';

/**
 * NFR-AI-005, FR-QNA-004 🚦 — 화면은 답변을 마크다운으로 그린다(ChatbotTab). 굵게 표시·이모지가
 * 낱말 사이에 끼면 화면에는 "범인은 김철수입니다"로 보이는데 낱말 검사는 놓쳤다.
 * 출력 검사는 화면에 보이는 글자 기준으로 본다.
 */
const pages = [{ page_no: 12, content: '그는 천천히 장갑을 벗었다.' }];

describe('출력 검사는 꾸밈 표지를 뺀 글자로 본다 (NFR-AI-005)', () => {
  test('FR-QNA-004: 굵게 표지로 끊은 범인 지목도 verdict_phrase', () => {
    const r = guardAnswer('범인**은** 김철수입니다.', {
      cutoff: 40,
      pages,
      intent: 'culprit_or_ending',
    });
    expect(r.violations).toContain('verdict_phrase');
  });

  test('FR-QNA-004: 이모지로 끊은 범인 지목도 verdict_phrase', () => {
    const r = guardAnswer('범인은🙂 김철수입니다.', {
      cutoff: 40,
      pages,
      intent: 'culprit_or_ending',
    });
    expect(r.violations).toContain('verdict_phrase');
  });

  test('FR-QNA-004: K=40에서 굵게 쓴 95쪽은 page_beyond_cutoff', () => {
    const r = guardAnswer('그 장면은 **95**쪽에 나와요.', { cutoff: 40, pages, intent: 'fact' });
    expect(r.violations).toContain('page_beyond_cutoff');
  });

  test('FR-QNA-004: K=130에서는 같은 답변이 통과한다 (positive 쌍)', () => {
    const r = guardAnswer('그 장면은 **95**쪽에 나와요.', { cutoff: 130, pages, intent: 'fact' });
    expect(r).toEqual({ ok: true, violations: [] });
  });

  test('NFR-AI-005: 굵게 끊은 다시 보기 권유도 steering_hint', () => {
    const r = guardAnswer('그 장면을 다시 **읽어** 보세요.', { cutoff: 40, pages, intent: 'fact' });
    expect(r.violations).toContain('steering_hint');
  });

  test('NFR-AI-005: 굵게 쓴 사실 서술은 통과한다 (positive 쌍)', () => {
    const r = guardAnswer('12쪽에서 그는 **장갑**을 벗었어요.', {
      cutoff: 40,
      pages,
      intent: 'fact',
    });
    expect(r).toEqual({ ok: true, violations: [] });
  });
});
