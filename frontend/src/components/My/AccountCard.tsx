import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { loginPathFor } from '../../utils/authRedirect';
import { APP_ROUTES } from '../../utils/routes';
import { useAuth } from '../../hooks/useAuth';
import { useModalLayer } from '../../hooks/useModalLayer';

const CARD = 'rounded-dash-card border border-dash-line bg-dash-card p-4';
const OUTLINE_BUTTON =
  'inline-flex min-h-11 items-center justify-center rounded-full border border-dash-ink bg-dash-card px-[18px] text-[14px] font-bold text-dash-ink disabled:opacity-40';

function WithdrawDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => Promise<void> }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  function close() {
    if (!busy) onCancel();
  }

  useModalLayer({ active: true, dialogRef, returnFocusRef, onClose: close });

  async function confirm() {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="withdraw-title"
        aria-describedby="withdraw-desc"
        tabIndex={-1}
        className="w-full max-w-[400px] rounded-dash-panel bg-dash-card p-6 font-dashSans text-dash-ink outline-none"
      >
        <h2 id="withdraw-title" className="font-dashSerif text-[18px] font-bold">
          탈퇴
        </h2>
        <p id="withdraw-desc" className="mt-2 break-keep text-[14px] leading-relaxed">
          탈퇴하면 계정과 독서 기록이 함께 삭제되고 되돌릴 수 없습니다.
        </p>
        {failed ? (
          <p role="alert" className="mt-3 break-keep text-[13px] text-dash-muted">
            탈퇴하지 못했습니다. 다시 시도해 주세요.
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={close} disabled={busy} className={OUTLINE_BUTTON}>
            취소
          </button>
          <button type="button" onClick={() => void confirm()} disabled={busy} className={OUTLINE_BUTTON}>
            탈퇴
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AccountCard() {
  const { status, displayName, logout, withdraw } = useAuth();
  const [confirming, setConfirming] = useState(false);

  if (status === 'loading') {
    return <div aria-busy="true" className={`${CARD} min-h-[132px]`} />;
  }

  // 대표 지시 2026-11-18 — MY에서 로그인하려고 할 때 로그인 창을 띄운다. 로그인 방법(이메일·구글·카카오)은
  // 로그인 화면이 서버 설정대로 보여 주고, 로그인하면 MY로 돌아온다
  if (status === 'guest') {
    return (
      <div className={CARD}>
        <p className="text-[15px] font-bold">로그인하지 않은 상태예요</p>
        <Link to={loginPathFor(APP_ROUTES.my)} className={`${OUTLINE_BUTTON} mt-3 w-full`}>
          로그인 / 회원가입
        </Link>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <p className="text-[15px] font-bold">{displayName ? `${displayName}님` : '로그인한 상태예요'}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" onClick={logout} className={OUTLINE_BUTTON}>
          로그아웃
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-11 px-2 text-[13px] text-dash-muted underline underline-offset-2"
        >
          탈퇴
        </button>
      </div>
      {confirming ? <WithdrawDialog onCancel={() => setConfirming(false)} onConfirm={withdraw} /> : null}
    </div>
  );
}
