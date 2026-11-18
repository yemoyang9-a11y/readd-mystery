import { useState } from 'react';
import type { FrontierChoice, FrontierConfirmPrompt } from '../../types';

const BUTTON_BASE =
  'min-h-11 rounded-full px-4 font-dashSans text-[13px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brief-accent disabled:opacity-50';

/**
 * 싸비 1회 확인 카드 (2026-11-17, FR-PRG-003 🚦).
 *
 * 확정 기준점보다 뒤 쪽을 열어 본 뒤 아직 답하지 않았을 때 서버가 confirm 을 보내고, 이
 * 카드가 그 값을 그대로 보여준다. 숫자는 서버가 준 그대로 쓴다 — 더하거나 빼지 않는다
 * (FR-BRF-005 🚦). 어떤 답이든 기준점은 서버가 정한다 (절대 규칙 2·8번).
 *
 * 답이 실패하면(onAnswer → false) 카드를 그대로 두고 아무것도 바꾸지 않는다 —
 * 실패 = 미노출 (FR-SPL-005 🚦). 사라지는 것은 컨테이너가 confirm 을 null 로 받았을 때뿐이다.
 */
export default function FrontierConfirmCard({
  prompt,
  onAnswer,
}: {
  prompt: FrontierConfirmPrompt;
  onAnswer: (choice: FrontierChoice) => Promise<boolean> | boolean | void;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function answer(choice: FrontierChoice) {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      if ((await onAnswer(choice)) === false) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-label="읽은 범위 확인"
      className="mx-6 mb-4 rounded-xl border border-brief-accent/40 bg-brief-accent-soft px-4 py-3"
    >
      <p className="font-dashSans text-[13px] leading-relaxed text-brief-ink">
        {prompt.furthest_page}쪽까지 넘겨 보셨어요. 거기까지 읽으셨나요? 지금은 {prompt.applied_cutoff}쪽까지를
        기준으로 보여 드려요.
      </p>
      {failed ? (
        <p role="alert" className="mt-2 font-dashSans text-[13px] text-brief-ink">
          읽은 범위를 저장하지 못했어요. 다시 시도해 주세요.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => void answer('keep')}
          className={`${BUTTON_BASE} border border-brief-rule bg-white text-brief-ink`}
        >
          그대로 둘게요
        </button>
        {prompt.current_page !== null ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void answer('current')}
            className={`${BUTTON_BASE} border border-brief-accent bg-white text-brief-accent`}
          >
            {prompt.current_page}쪽까지 읽었어요
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => void answer('furthest')}
          className={`${BUTTON_BASE} bg-brief-accent text-white`}
        >
          {prompt.furthest_page}쪽까지 읽었어요
        </button>
      </div>
    </section>
  );
}
