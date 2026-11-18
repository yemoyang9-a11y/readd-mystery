import { Outlet } from 'react-router-dom';
import Header from './Header';
import RouteFade from './RouteFade';
import TabBar, { TAB_BAR_HEIGHT } from './TabBar';

// NFR-USE
export default function AppShell({
  isMobile,
  nav,
  night = false,
}: {
  isMobile: boolean;
  nav?: boolean;
  /** PC 에서 미스터리 브랜딩(data-night) 화면을 감쌀 때 — 커뮤니티 (E2E #86, DESIGN.md) */
  night?: boolean;
}) {
  const showNav = nav !== false;

  if (isMobile) {
    return (
      <div
        data-mobile="true"
        data-night
        className="min-h-[100dvh] bg-dash-paper font-dashSans text-dash-ink"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <main
          style={{
            paddingBottom: showNav
              ? `calc(${TAB_BAR_HEIGHT}px + var(--safe-bottom))`
              : 'var(--safe-bottom)',
          }}
        >
          <RouteFade>
            <Outlet />
          </RouteFade>
        </main>
        {showNav && <TabBar />}
      </div>
    );
  }

  return (
    <div data-night={night || undefined} className="min-h-screen bg-dash-paper font-dashSans text-dash-ink">
      <Header nav={showNav} />
      <main>
        <RouteFade>
          <Outlet />
        </RouteFade>
      </main>
    </div>
  );
}
