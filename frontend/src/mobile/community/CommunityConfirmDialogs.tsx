import { useState } from 'react';
import type { RefObject } from 'react';
import CommunityDialog from './CommunityDialog';
import { REPORT_REASONS } from './communityFormat';

export function DeleteDialog({
  label,
  returnFocusRef,
  onClose,
  onConfirm,
}: {
  label: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <CommunityDialog title={`${label}을 삭제할까요?`} onClose={onClose} returnFocusRef={returnFocusRef}>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-full border border-[#d9d1cc] bg-white text-[15px] font-bold text-[#1a1415]"
        >
          취소
        </button>
        <button
          type="button"
          data-track="community-delete-confirm"
          onClick={onConfirm}
          className="min-h-11 rounded-full bg-[#8f1d35] text-[15px] font-bold text-white"
        >
          삭제
        </button>
      </div>
    </CommunityDialog>
  );
}

export function ReportDialog({
  returnFocusRef,
  onClose,
  onSubmit,
}: {
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [state, setState] = useState<'idle' | 'sending' | 'failed'>('idle');

  async function submit() {
    setState('sending');
    setState((await onSubmit(reason)) ? 'idle' : 'failed');
  }

  return (
    <CommunityDialog title="신고하기" onClose={onClose} returnFocusRef={returnFocusRef}>
      <div role="radiogroup" aria-label="신고 사유" className="mt-3 flex flex-col gap-2">
        {REPORT_REASONS.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={reason === item}
            onClick={() => setReason(item)}
            className={`min-h-11 rounded-[12px] border px-4 text-left text-[15px] ${
              reason === item
                ? 'border-[#8f1d35] bg-[#f3e3e7] font-bold text-[#8f1d35]'
                : 'border-[#d9d1cc] bg-white text-[#1a1415]'
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      {state === 'failed' ? (
        <p role="alert" className="m-0 mt-2 text-[13px] text-[#8f1d35]">
          신고를 보내지 못했어요. 잠시 후 다시 시도해 주세요.
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
          data-track="community-report-submit"
          disabled={state === 'sending'}
          onClick={submit}
          className="min-h-11 rounded-full bg-[#8f1d35] text-[15px] font-bold text-white disabled:opacity-40"
        >
          신고
        </button>
      </div>
    </CommunityDialog>
  );
}
