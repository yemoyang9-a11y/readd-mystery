import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { APP_ROUTES } from '../../utils/routes';

export const TAB_BAR_HEIGHT = 56;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const TABS = [
  {
    to: APP_ROUTES.home,
    label: '홈',
    end: true,
    icon: (
      <Icon>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </Icon>
    ),
  },
  {
    // 2026-11-18 대표 지시 — 커뮤니티 허브
    to: APP_ROUTES.community,
    label: '커뮤니티',
    end: false,
    icon: (
      <Icon>
        <path d="M4 5h11v8H8l-4 3.5z" />
        <path d="M15 9h5v7.5L17 14h-5" />
      </Icon>
    ),
  },
  {
    to: APP_ROUTES.feedback,
    label: '피드백',
    end: false,
    icon: (
      <Icon>
        <path d="M4 5h16v11H9l-5 4z" />
      </Icon>
    ),
  },
  {
    to: APP_ROUTES.my,
    label: 'MY',
    end: false,
    icon: (
      <Icon>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
      </Icon>
    ),
  },
] as const;

// NFR-USE
export default function TabBar() {
  return (
    <nav
      aria-label="주 메뉴"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-dash-line bg-dash-paper/85 backdrop-blur-xl"
      style={{
        height: `calc(${TAB_BAR_HEIGHT}px + var(--safe-bottom))`,
        paddingBottom: 'var(--safe-bottom)',
      }}
    >
      <ul className="flex h-full">
        {TABS.map((tab) => (
          <li key={tab.to} className="flex flex-1">
            <NavLink
              to={tab.to}
              end={tab.end}
              data-track={`tab-${tab.label}`}
              className={({ isActive }) =>
                `relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 font-dashSans text-[11px] ${
                  isActive
                    ? 'font-bold text-dash-ink before:absolute before:inset-x-6 before:top-0 before:h-0.5 before:rounded-full before:bg-brief-mark'
                    : 'text-dash-muted'
                }`
              }
            >
              {tab.icon}
              <span>{tab.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
