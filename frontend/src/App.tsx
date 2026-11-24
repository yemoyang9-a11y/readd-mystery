import { useEffect, useState, type ComponentType } from 'react';
// Router 7 — react-router-dom 은 react-router 로 합쳐졌다. RouterProvider 도 여기서 받는다
// (react-router/dom 판은 navigate 의 flushSync 옵션용인데 이 앱은 쓰지 않는다. 테스트에서 두 사본으로 갈라진다).
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import Home from './pages/Home';
import Search from './pages/Search';
import Shelf from './pages/Shelf';
import My from './pages/My';
import BookDetail from './pages/BookDetail';
import NotFound from './pages/NotFound';
import AuthCallback from './pages/AuthCallback';
import Login from './pages/Login';
import Consent from './pages/Consent';
import RequireSession from './components/auth/RequireSession';
import { CONSENT_PATH, LOGIN_PATH, requiresLogin } from './utils/authRedirect';
import { verifyStoredSession } from './services/sessionCheck';
import MobileHome from './mobile/pages/MobileHome';
import MobileFeedback from './mobile/pages/MobileFeedback';
import MobileCommunityHub from './mobile/pages/MobileCommunityHub';
import MobileBookRedirect from './mobile/pages/MobileBookRedirect';
import MobileNotFound from './mobile/pages/MobileNotFound';
import { isMobileDevice } from './mobile/device';
import ErrorBoundary from './components/common/ErrorBoundary';
import RouteError from './components/common/RouteError';
import Loading from './components/common/Loading';
import AppShell from './components/Layout/AppShell';
import RouteFade from './components/Layout/RouteFade';
import { APP_ROUTES, BOOK_ROUTES } from './utils/routes';
import { initAnalytics } from './services/analytics';

// NFR-PERF: 읽기·관계도·관리자 코드는 해당 화면에 진입할 때 받는다.
async function fadedPage(load: Promise<{ default: ComponentType }>) {
  const { default: Page } = await load;
  return { element: <RouteFade><Page /></RouteFade> };
}

// 대표 지시 2026-11-18 — 처음부터 로그인 창을 띄우지 않는다. 작품을 여는 경로(브리핑·읽기·책 이야기방)만
// 세션 토큰이 없으면 /login 으로 보낸다. 나머지(홈·검색·서재·작품 소개·허브·MY·가이드)는 비회원도 연다.
function gate<T extends Pick<RouteObject, 'element' | 'Component'>>(route: T): T {
  const { Component, element } = route;
  if (Component) return { ...route, Component: undefined, element: <RequireSession><Component /></RequireSession> };
  if (element) return { ...route, element: <RequireSession>{element}</RequireSession> };
  return route;
}

function requireSession(route: RouteObject): RouteObject {
  if (route.children) return { ...route, children: route.children.map(requireSession) };
  if (!requiresLogin(route.path)) return route;
  const { lazy } = route;
  if (!lazy) return gate(route);
  // Router 7 은 lazy 를 속성별 객체로도 받는다. 그 형태는 관문을 씌울 수 없으므로 쓰지 않는다.
  if (typeof lazy !== 'function') throw new Error(`로그인 관문 경로는 lazy 함수만 쓴다: ${route.path}`);
  return { ...gate(route), lazy: async () => gate(await lazy()) };
}

/**
 * 라우팅.
 * 브리핑/읽기 분기는 화면이 정하지 않는다 — POST /books/:bookId/entry 응답의 route 를 따른다
 * (FR-BRF-001, 절대 규칙 8번). 경로 패턴은 utils/routes 한 곳에서만 정의한다.
 */
export function createAppRouter(isMobile = isMobileDevice(window.screen)) {
  // 나눠 받기 실패·경로 오류를 한국어 안내로 받는다 — 모든 최상위 경로에 단다
  const routeError = <RouteError />;
  const routes: RouteObject[] = [
    // NFR-USE
    {
      element: <AppShell isMobile={isMobile} />,
      children: [
        { path: APP_ROUTES.home, element: isMobile ? <MobileHome /> : <Home /> },
        { path: APP_ROUTES.search, element: <Search /> },
        { path: APP_ROUTES.shelf, element: <Shelf /> },
        { path: APP_ROUTES.my, element: <My /> },
        { path: APP_ROUTES.feedback, element: isMobile ? <MobileFeedback /> : <NotFound /> },
        ...(isMobile ? [{ path: APP_ROUTES.community, element: <MobileCommunityHub /> }] : []),
      ],
    },
    // E2E #86 — PC 에서도 커뮤니티 허브·책 이야기방을 연다. 위 줄 메뉴 + 미스터리 브랜딩(data-night) 틀.
    // 완독 게이트는 서버가 정한다 — 화면은 완독을 계산하지 않는다 (FR-BRF-005 🚦)
    ...(isMobile
      ? []
      : [
          {
            element: <AppShell isMobile={false} night />,
            children: [
              { path: APP_ROUTES.community, element: <MobileCommunityHub /> },
              {
                path: BOOK_ROUTES.community,
                lazy: async () => ({ Component: (await import('./pages/BookCommunity')).default }),
              },
              // 대표 결정 2026-11-24 — 내 추리 채점. 관문은 서버가 정한다 (FR-QNA-004 🚦)
              {
                path: BOOK_ROUTES.review,
                lazy: async () => ({ Component: (await import('./pages/BookNoteReview')).default }),
              },
            ],
          },
        ]),
    isMobile
      ? { path: APP_ROUTES.book, element: <MobileBookRedirect /> }
      : {
          element: <AppShell isMobile={false} />,
          children: [{ path: APP_ROUTES.book, element: <BookDetail /> }],
        },
    {
      path: BOOK_ROUTES.briefing,
      lazy: () => fadedPage(isMobile ? import('./mobile/pages/MobileBriefing') : import('./pages/Briefing')),
    },
    {
      path: BOOK_ROUTES.reader,
      lazy: () => fadedPage(isMobile ? import('./mobile/pages/MobileReader') : import('./pages/Reader')),
    },
    ...(isMobile
      ? [
          { path: BOOK_ROUTES.community, lazy: () => fadedPage(import('./mobile/pages/MobileCommunity')) },
          { path: BOOK_ROUTES.review, lazy: () => fadedPage(import('./mobile/pages/MobileNoteReview')) },
        ]
      : []),
    { path: LOGIN_PATH, element: <Login /> },
    // 대표 지시 2026-11-18 — 카카오·구글 첫 로그인 뒤 약관 동의 (research-2026-11-18-signup-fields.md 4장)
    { path: CONSENT_PATH, element: <Consent /> },
    { path: '/auth/callback', element: <AuthCallback /> },
    // 2026-11-18 대표 지시 — 데모 책으로 직접 눌러 보는 첫 이용 가이드
    { path: '/guide', lazy: () => fadedPage(import('./guide/GuidePage')) },
    // FR-ADM-006 🚦
    {
      path: '/admin',
      lazy: async () => ({ Component: (await import('./admin/AdminLayout')).default }),
      children: [
        { index: true, lazy: async () => ({ Component: (await import('./admin/AnalyticsPage')).default }) },
        { path: 'books', lazy: async () => ({ Component: (await import('./admin/BooksPage')).default }) },
        { path: 'books/:bookId/review', lazy: async () => ({ Component: (await import('./admin/ReviewPage')).default }) },
        { path: 'community', lazy: async () => ({ Component: (await import('./admin/CommunityReportsPage')).default }) },
      ],
    },
    { path: '*', element: <RouteFade>{isMobile ? <MobileNotFound /> : <NotFound />}</RouteFade> },
  ];
  // GitHub Pages 는 /<저장소>/ 아래에 올라간다 — 빌드 기준 경로(BASE_URL)를 라우터 기준으로 쓴다
  const basename = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || '/';
  // Router 7 — 첫 진입 경로를 나눠 받는 동안 보이던 RouterProvider fallbackElement 가 없어졌다.
  // 같은 <Loading /> 을 최상위 경로마다 hydrateFallbackElement 로 달아 화면을 그대로 둔다.
  const loading = <Loading />;
  return createBrowserRouter(
    routes.map((route) => ({ errorElement: routeError, hydrateFallbackElement: loading, ...requireSession(route) })),
    { basename }
  );
}

export default function App() {
  /**
   * ⚠️ 라우터를 모듈 최상위에서 만들면 안 된다 (2026-09-02 수정).
   *
   * `createBrowserRouter` 는 생성 시점의 `window.location` 으로 **자기 history 를
   * 초기화하고 그 뒤로는 다시 읽지 않는다.** 모듈 최상위에 두면 파일 로드 때 딱 한 번
   * 만들어져 인스턴스가 공유되므로, 테스트가 `window.history.pushState({}, '', '/')` 로
   * 주소를 되돌려도 **라우터 내부 위치는 앞 테스트가 이동한 화면에 그대로 남는다.**
   * 실제로 App 통합 테스트들이 파일의 첫 테스트만 통과하고 나머지가 전부 대시보드 대신
   * 읽기 화면에서 시작해 깨졌다.
   *
   * `<BrowserRouter>` 시절에는 매 마운트마다 `window.location` 을 읽어 이 문제가 없었다.
   * 데이터 라우터로 옮기면서(9b87d2e) 딸려 온 회귀다.
   *
   * `useState` 의 게으른 초기화로 **마운트당 한 번** 만든다 — 프로덕션에서는 App 이
   * 한 번만 마운트되므로 동작이 이전과 같고, 테스트에서는 `render()` 마다 그 시점
   * 주소에서 새로 시작한다.
   */
  const [router] = useState(createAppRouter);

  // FR-ADM-005
  useEffect(() => initAnalytics(router), [router]);
  // E2E #89 — 저장된 토큰이 지워진 계정의 것이면 앱을 열 때 한 번 정리한다(둘러보기 화면에도 관문이 없으므로)
  useEffect(() => {
    void verifyStoredSession();
  }, []);

  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
