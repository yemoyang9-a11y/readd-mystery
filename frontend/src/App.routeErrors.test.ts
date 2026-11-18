import { createAppRouter } from './App';

test('모든 최상위 경로에 errorElement 가 있다 — 나눠 받기 실패 시 영어 기본 오류 화면을 막는다', () => {
  for (const isMobile of [true, false]) {
    const routes = createAppRouter(isMobile).routes;
    for (const route of routes) {
      expect({ path: route.path ?? '(layout)', hasError: Boolean((route as { errorElement?: unknown }).errorElement) }).toEqual({
        path: route.path ?? '(layout)',
        hasError: true,
      });
    }
  }
});
