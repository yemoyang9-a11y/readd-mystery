import { forwardRef, useId, useImperativeHandle, useRef, useState } from 'react';
import TermsSheet from './TermsSheet';
import { LEGAL_DRAFTS } from '../../content/legalDrafts';
import type { ConsentChoice, ConsentKind } from '../../utils/consents';

/**
 * 가입 약관 묶음 — 전체 동의 / [필수] 이용약관 / [필수] 개인정보 수집·이용 / [필수] 만 14세 이상 /
 * [선택] 마케팅 정보 수신 (대표 지시 2026-11-18, 조사: research-2026-11-18-signup-fields.md 4장).
 * 줄마다 "보기"로 문서를 시트로 연다. 이메일 가입과 카카오·구글 첫 로그인 동의 화면이 같이 쓴다.
 */
const ROWS: readonly { kind: ConsentKind; required: boolean; label: string; doc: string }[] = [
  { kind: 'terms', required: true, label: '이용약관 동의', doc: '이용약관' },
  { kind: 'privacy', required: true, label: '개인정보 수집·이용 동의', doc: '개인정보 수집·이용' },
  { kind: 'age14', required: true, label: '만 14세 이상입니다', doc: '만 14세 이상 확인' },
  { kind: 'marketing', required: false, label: '마케팅 정보 수신 동의', doc: '마케팅 정보 수신' },
];

export interface ConsentListHandle {
  focus(kind: ConsentKind): void;
}

const BOX =
  'size-5 shrink-0 cursor-pointer rounded-[4px] accent-[#c4475f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1618] aria-[invalid=true]:outline aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-offset-2 aria-[invalid=true]:outline-[#c4475f]';

const ConsentList = forwardRef<
  ConsentListHandle,
  {
    value: ConsentChoice;
    onChange: (next: ConsentChoice) => void;
    /** 필수 동의가 빠진 채로 눌렀을 때 — 빠진 필수 줄에 aria-invalid 를 단다 */
    invalid?: boolean;
    disabled?: boolean;
  }
>(function ConsentList({ value, onChange, invalid = false, disabled = false }, ref) {
  const idPrefix = useId();
  const boxRefs = useRef<Partial<Record<ConsentKind, HTMLInputElement | null>>>({});
  const openerRef = useRef<HTMLElement | null>(null);
  const [openDoc, setOpenDoc] = useState<ConsentKind | null>(null);

  useImperativeHandle(ref, () => ({ focus: (kind) => boxRefs.current[kind]?.focus() }), []);

  const allChecked = ROWS.every((row) => value[row.kind]);

  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" disabled={disabled}>
      <legend className="sr-only">약관 동의</legend>
      <label
        htmlFor={`${idPrefix}-all`}
        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[10px] border border-[#35292c] bg-[#0d0a0b] px-3.5"
      >
        <input
          id={`${idPrefix}-all`}
          type="checkbox"
          checked={allChecked}
          onChange={(event) => {
            const on = event.target.checked;
            onChange({ terms: on, privacy: on, age14: on, marketing: on });
          }}
          className={BOX}
        />
        <span className="text-[15px] font-bold text-white">전체 동의</span>
      </label>
      <ul className="m-0 mt-1 list-none p-0">
        {ROWS.map((row) => {
          const id = `${idPrefix}-${row.kind}`;
          const missing = invalid && row.required && !value[row.kind];
          return (
            <li key={row.kind} className="flex min-h-11 items-center gap-3 pl-3.5">
              <input
                id={id}
                ref={(el) => {
                  boxRefs.current[row.kind] = el;
                }}
                type="checkbox"
                checked={value[row.kind]}
                aria-invalid={missing || undefined}
                onChange={(event) => onChange({ ...value, [row.kind]: event.target.checked })}
                className={BOX}
              />
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer py-2 text-[14px] leading-snug text-[#ece6e0]">
                <span className={row.required ? 'font-bold text-[#e58a9b]' : 'font-bold text-[#c9bfbb]'}>
                  {row.required ? '[필수]' : '[선택]'}
                </span>{' '}
                {row.label}
              </label>
              <button
                type="button"
                aria-label={`${row.doc} 보기`}
                onClick={(event) => {
                  openerRef.current = event.currentTarget;
                  setOpenDoc(row.kind);
                }}
                className="min-h-11 shrink-0 px-2 text-[13px] font-bold text-[#c9bfbb] underline decoration-[#5a474b] underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
              >
                보기
              </button>
            </li>
          );
        })}
      </ul>
      {openDoc ? (
        <TermsSheet doc={LEGAL_DRAFTS[openDoc]} returnFocusRef={openerRef} onClose={() => setOpenDoc(null)} />
      ) : null}
    </fieldset>
  );
});

export default ConsentList;
