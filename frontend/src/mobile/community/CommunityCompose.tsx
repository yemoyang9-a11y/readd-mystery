import { useId, useState } from 'react';
import type { RefObject } from 'react';
import type { CommunityKind } from '../../types';
import { classifyCommunityError, createCommunityPost, type CommunityFailure } from '../../services/communityService';
import CommunityDialog from './CommunityDialog';
import { KIND_LABEL } from './communityFormat';

const MAX_LENGTH = 2000;
const KINDS: CommunityKind[] = ['theory', 'review'];

// COMMUNITY
export default function CommunityCompose({
  bookId,
  initialKind,
  returnFocusRef,
  onClose,
  onPosted,
  onFailure,
}: {
  bookId: string;
  initialKind: CommunityKind;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onPosted: () => void;
  onFailure: (failure: CommunityFailure) => void;
}) {
  const fieldId = useId();
  const [kind, setKind] = useState<CommunityKind>(initialKind);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = body.trim().length > 0 && !sending;

  async function submit() {
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    try {
      await createCommunityPost(bookId, kind, body.trim());
      onPosted();
    } catch (cause) {
      const failure = classifyCommunityError(cause);
      if (failure === 'locked') {
        onFailure(failure);
        return;
      }
      setError(
        failure === 'rate_limited'
          ? '글은 1시간에 10개까지 올릴 수 있어요. 잠시 후 다시 시도해 주세요.'
          : '글을 올리지 못했어요. 잠시 후 다시 시도해 주세요.'
      );
      setSending(false);
    }
  }

  return (
    <CommunityDialog title="이야기 남기기" onClose={onClose} returnFocusRef={returnFocusRef}>
      <div role="radiogroup" aria-label="글 종류" className="mt-4 grid grid-cols-2 gap-2">
        {KINDS.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={kind === item}
            onClick={() => setKind(item)}
            className={`min-h-11 rounded-full border text-[14px] font-bold ${
              kind === item
                ? 'border-[#8f1d35] bg-[#f3e3e7] text-[#8f1d35]'
                : 'border-[#d9d1cc] bg-white text-[#5b4f51]'
            }`}
          >
            {KIND_LABEL[item]}
          </button>
        ))}
      </div>
      <label htmlFor={fieldId} className="mt-4 block text-[13px] font-bold text-[#5b4f51]">
        내용
      </label>
      <textarea
        id={fieldId}
        value={body}
        maxLength={MAX_LENGTH}
        onChange={(event) => setBody(event.target.value)}
        placeholder={kind === 'theory' ? '범인과 그렇게 생각한 이유를 적어 보세요' : '읽고 난 감상을 적어 보세요'}
        className="mt-1.5 block h-44 w-full resize-none rounded-[12px] border border-[#d9d1cc] bg-white p-3 text-[16px] leading-relaxed text-[#1a1415] outline-none placeholder:text-[#8a7f81] focus:border-[#8f1d35] focus-visible:ring-2 focus-visible:ring-[#8f1d35]/30"
      />
      <p className="m-0 mt-1 text-right text-[12px] text-[#6f6466]">
        {body.length} / {MAX_LENGTH}
      </p>
      {error ? (
        <p role="alert" className="m-0 mt-2 break-keep text-[13px] text-[#8f1d35]">
          {error}
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-full border border-[#d9d1cc] bg-white text-[15px] font-bold text-[#1a1415]"
        >
          취소
        </button>
        <button
          type="button"
          data-track="community-submit"
          disabled={!canSubmit}
          onClick={submit}
          className="min-h-11 rounded-full bg-[#8f1d35] text-[15px] font-bold text-white disabled:opacity-40"
        >
          {sending ? '올리는 중' : '등록'}
        </button>
      </div>
    </CommunityDialog>
  );
}
