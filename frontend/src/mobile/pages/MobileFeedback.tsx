import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { submitFeedback } from '../../services/feedbackService';

type Status = 'editing' | 'sending' | 'failed' | 'sent';

const MAX_MESSAGE_LENGTH = 2000;

// NFR-USE
export default function MobileFeedback() {
  const inputId = useId();
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('editing');
  const sending = status === 'sending';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending || !message.trim()) return;
    setStatus('sending');
    try {
      await submitFeedback(message);
      setStatus('sent');
    } catch {
      setStatus('failed');
    }
  }

  function writeAnother() {
    setMessage('');
    setStatus('editing');
  }

  return (
    <div className="mx-auto w-full max-w-[560px] px-4 py-5 text-dash-ink">
      <h1 className="font-dashSerif text-[24px] font-bold">피드백</h1>
      <div className="mt-4 rounded-dash-panel border border-dash-line bg-dash-card p-4">
        {status === 'sent' ? (
          <div className="py-8 text-center">
            <p role="status" className="m-0 break-keep text-[17px] font-bold">
              소중한 의견 감사합니다.
            </p>
            <button
              type="button"
              onClick={writeAnother}
              className="mt-5 min-h-12 w-full rounded-full border border-dash-line px-4 text-[15px] font-bold text-dash-ink transition-colors active:bg-dash-ink/10"
            >
              하나 더 남기기
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label htmlFor={inputId} className="sr-only">
              의견
            </label>
            <textarea
              id={inputId}
              value={message}
              disabled={sending}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="의견을 적어 주세요"
              className="block h-52 w-full resize-none rounded-dash-card border border-dash-line bg-dash-paper p-3 text-[16px] leading-relaxed text-dash-ink outline-none placeholder:text-dash-muted focus:border-brief-accent"
            />
            {status === 'failed' ? (
              <p role="alert" className="mt-3 break-keep text-[13px] text-dash-muted">
                의견을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.
              </p>
            ) : null}
            <button
              type="submit"
              disabled={sending || !message.trim()}
              className="mt-3 min-h-12 w-full rounded-full bg-brief-accent text-[15px] font-bold text-brief-on-accent transition-opacity disabled:opacity-40"
            >
              {sending ? '보내는 중' : '제출'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
