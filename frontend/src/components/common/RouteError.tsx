import { Link, useRouteError } from 'react-router';

/**
 * 경로 단위 오류 화면.
 *
 * 읽기·브리핑·관리자 화면은 진입할 때 코드를 나눠 받는다(lazy). 새 버전을 배포하면 그 전에 열어 둔
 * 탭은 옛 파일 이름을 찾다가 받기에 실패한다. 이 오류는 바깥 ErrorBoundary 가 아니라 라우터가
 * 잡으므로, errorElement 가 없으면 React Router 의 영어 기본 화면이 뜬다(2026-11-18 PR #2 리뷰).
 */
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|error loading dynamically/i.test(
    message
  );
}

export default function RouteError() {
  const error = useRouteError();
  const stale = isChunkLoadError(error);

  return (
    <main
      role="alert"
      className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-brief-page px-6 text-center text-brief-ink"
    >
      <h1 className="font-dashSerif text-[22px] font-bold">
        {stale ? '새 버전이 나왔어요' : '화면을 불러오지 못했어요'}
      </h1>
      <p className="font-dashSans text-[15px] leading-relaxed text-brief-ink/80">
        {stale ? '새로고침하면 최신 화면으로 이어서 읽을 수 있어요.' : '잠시 뒤 새로고침해 주세요.'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-11 rounded-full bg-brief-accent px-5 font-dashSans text-[14px] font-bold text-white"
        >
          새로고침
        </button>
        {stale ? null : (
          <Link
            to="/"
            reloadDocument
            className="flex min-h-11 items-center rounded-full border border-brief-rule bg-white px-5 font-dashSans text-[14px] font-bold text-brief-ink"
          >
            홈으로
          </Link>
        )}
      </div>
    </main>
  );
}
