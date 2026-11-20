import type { AmoEvidenceItem } from '../../types';

const PILL =
  "relative inline-flex h-9 items-center gap-1.5 rounded-full border border-brief-rule bg-brief-paper px-3 font-dashSans text-[13px] font-semibold text-brief-ink after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-accent";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function AmoEvidence({ item }: { item: AmoEvidenceItem }) {
  return (
    <div
      data-amo-evidence
      className="mt-[10px] rounded-r-[10px] border-l-2 border-brief-accent bg-[#faf6f4] px-3 py-[10px] font-dashSerif text-[14px] leading-[1.7] text-brief-ink"
    >
      <small className="mb-1 block font-dashSans text-[12px] text-brief-muted">p.{item.page}에서</small>
      {item.text}
    </div>
  );
}

export function AmoActions({
  page,
  saved,
  onSave,
  onJump,
}: {
  page: number;
  saved: boolean;
  onSave?: () => void;
  onJump?: () => void;
}) {
  return (
    <div className="ml-10 mt-[10px] flex gap-2">
      {onSave ? (
        <button
          type="button"
          aria-disabled={saved}
          onClick={() => {
            if (!saved) onSave();
          }}
          className={`${PILL} ${saved ? 'text-brief-muted' : ''}`}
        >
          <Icon>{saved ? <path d="m5 12.5 4.5 4.5L19 7" /> : <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />}</Icon>
          {saved ? '저장됨' : '단서로 저장'}
        </button>
      ) : null}
      {onJump ? (
        <button type="button" onClick={onJump} className={PILL}>
          <Icon>
            <path d="M12 6.5C10.5 5.3 8.5 5 6 5H4v13h2c2.5 0 4.5.3 6 1.5 1.5-1.2 3.5-1.5 6-1.5h2V5h-2c-2.5 0-4.5.3-6 1.5zM12 6.5v13" />
          </Icon>
          p.{page} 펼치기
        </button>
      ) : null}
    </div>
  );
}

export function AmoFollowUps({
  questions,
  onPick,
}: {
  questions: string[];
  onPick: (question: string) => void;
}) {
  return (
    <div role="group" aria-label="이어 묻기" className="ml-10 mt-1.5 flex flex-col items-start gap-1.5">
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onPick(question)}
          className="relative inline-flex h-[38px] items-center gap-1.5 rounded-full border border-brief-rule bg-white px-3.5 text-left font-dashSans text-[14px] text-brief-ink after:absolute after:inset-x-0 after:-inset-y-[3px] after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brief-accent"
        >
          <span className="text-brief-accent">
            <Icon>
              <path d="M5 5v6a3 3 0 0 0 3 3h10M14 10l4 4-4 4" />
            </Icon>
          </span>
          {question}
        </button>
      ))}
    </div>
  );
}
