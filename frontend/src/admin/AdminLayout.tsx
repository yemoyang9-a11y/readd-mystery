import { createContext, useCallback, useContext, useMemo, useState, type FormEvent } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { AdminApiError, adminRequest, loadAdminToken, saveAdminToken } from './adminApi';

interface AdminContextValue {
  call: <T = unknown>(
    path: string,
    init?: { method?: string; json?: unknown; text?: string }
  ) => Promise<T>;
  token: string;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin must be used inside AdminLayout');
  return value;
}

function gateMessage(err: unknown): string {
  if (err instanceof AdminApiError) {
    if (err.status === 401) return '토큰이 맞지 않습니다';
    if (err.status === 503) return '서버에 관리자 토큰이 설정되어 있지 않습니다';
    return err.message;
  }
  return '확인하지 못했습니다';
}

function TokenGate({ onAccepted }: { onAccepted: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const token = value.trim();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await adminRequest(token, '/jobs');
      saveAdminToken(token);
      onAccepted(token);
    } catch (err) {
      setError(gateMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-gutter font-sans text-ink">
      <form
        onSubmit={submit}
        className="w-full max-w-[420px] rounded-card border border-line bg-surface p-8 shadow-card"
      >
        <h1 className="font-serif text-[22px] font-extrabold">RE:ADD 관리자</h1>
        <p className="mt-2 text-[13px] text-muted">
          서버에 설정된 관리자 토큰을 입력하세요. 이 브라우저에만 저장됩니다.
        </p>
        <label htmlFor="admin-token" className="mt-6 block text-[13px] font-bold">
          관리자 토큰
        </label>
        <input
          id="admin-token"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-2.5 text-[15px] outline-none focus:border-ink"
        />
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-ssabi">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || value.trim() === ''}
          className="mt-6 w-full rounded-lg bg-ink px-5 py-2.5 text-[13px] font-bold text-white transition-opacity disabled:opacity-40"
        >
          {busy ? '확인 중' : '들어가기'}
        </button>
      </form>
    </main>
  );
}

const NAV_CLASS = ({ isActive }: { isActive: boolean }) =>
  `rounded-pill px-4 py-2 text-[13px] ${
    isActive ? 'bg-active font-bold text-white' : 'border border-line-subtle bg-surface text-faint'
  }`;

// FR-ADM-006 🚦
export default function AdminLayout() {
  const [token, setToken] = useState<string | null>(loadAdminToken);

  const signOut = useCallback(() => {
    saveAdminToken(null);
    setToken(null);
  }, []);

  const value = useMemo<AdminContextValue | null>(() => {
    if (!token) return null;
    return {
      token,
      call: async <T,>(path: string, init?: { method?: string; json?: unknown; text?: string }) => {
        try {
          return await adminRequest<T>(token, path, init);
        } catch (err) {
          if (err instanceof AdminApiError && err.status === 401) signOut();
          throw err;
        }
      },
    };
  }, [token, signOut]);

  if (!token || !value) return <TokenGate onAccepted={setToken} />;

  return (
    <AdminContext.Provider value={value}>
      <div className="min-h-screen bg-canvas font-sans text-ink">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-[1120px] items-center justify-between px-gutter py-4">
            <div className="flex items-center gap-6">
              <span className="font-serif text-[18px] font-extrabold">RE:ADD 관리자</span>
              <nav aria-label="관리자 메뉴" className="flex gap-2">
                <NavLink to="/admin" end className={NAV_CLASS}>
                  이용 현황
                </NavLink>
                <NavLink to="/admin/books" className={NAV_CLASS}>
                  도서 관리
                </NavLink>
              </nav>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="rounded-pill border border-line-subtle bg-surface px-4 py-2 text-[13px] text-faint"
            >
              토큰 지우기
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1120px] px-gutter py-8">
          <Outlet />
        </main>
      </div>
    </AdminContext.Provider>
  );
}
