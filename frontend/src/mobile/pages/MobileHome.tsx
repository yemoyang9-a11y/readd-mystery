import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HOME_SHOWCASE } from '../../data/homeShowcase';
import { useCatalog } from '../../hooks/useCatalog';
import { fetchBriefing } from '../../services/recapService';
import { pickContinueBook } from '../../utils/homeRows';
import { listableBooks } from '../../utils/listableBooks';
import { briefingPath } from '../../utils/routes';
import ProgressBar from '../../components/Reader/ProgressBar';
import BookCarousel3D from '../components/BookCarousel3D';
import type { BookSummary, BriefingResponse } from '../../types';
import { withBase } from '../../utils/assetUrl';

const FROM_HOME = { fromHome: true };

/**
 * 홈 이어 읽기 카드 (2026-11-17 대표 결정 — 화면 채우기 우선순위 1)
 *
 * 진도 기록이 있는 책(GET /books 에 progress 가 온 책)이 있을 때만 그린다. 머리 줄의 작은
 * "이어서 읽기 · 13p" 버튼과 같은 곳으로 가므로 그 버튼을 대신한다.
 *
 * 값은 전부 서버 응답 그대로다 — 쪽(progress.current_page)·진도 바(progress.percent)는
 * GET /books, 장 이름은 GET /briefing 의 resume_chapter(이어 읽기 위치의 장 — 쪽과 같은 위치,
 * 2026-11-17 대표 결정. 기준점의 장인 current_chapter 를 쓰면 되돌아가 읽을 때 "제3장 · 5p"처럼
 * 어긋난다). 프론트는 목차에서 장을 찾거나
 * 퍼센트를 나누지 않는다 (절대 규칙 2, FR-BRF-005 🚦). 퍼센트는 숫자로 쓰지 않는다
 * (e25408b — 이어서 읽기에는 퍼센트 대신 쪽).
 *
 * 장 이름 조회가 실패하거나 서버가 장을 못 주면(null) 장 이름만 빠지고 카드는 그대로 뜬다(FR-SPL-005 🚦 — 실패 = 미노출).
 * GET /briefing 은 읽기 전용 조회라 진도·세션을 바꾸지 않는다.
 */
// FR-BRF-001 FR-BRF-005 🚦
function ContinueCard({ book }: { book: BookSummary }) {
  const [chapter, setChapter] = useState<BriefingResponse['resume_chapter']>(null);

  useEffect(() => {
    let cancelled = false;
    setChapter(null);
    Promise.resolve()
      .then(() => fetchBriefing(book.book_id))
      .then((briefing) => {
        if (!cancelled) setChapter(briefing.resume_chapter ?? null);
      })
      .catch(() => {
        if (!cancelled) setChapter(null);
      });
    return () => {
      cancelled = true;
    };
  }, [book.book_id]);

  const progress = book.progress!;
  const where = chapter ? `제${chapter.chapter_no}장 ${chapter.title} · ${progress.current_page}p` : `${progress.current_page}p`;

  return (
    <Link
      to={briefingPath(book.book_id)}
      state={FROM_HOME}
      data-track="이어 읽기"
      data-testid="home-continue-card"
      aria-label={`이어서 읽기, ${book.title}, ${where}`}
      className="mx-5 mt-2 flex items-center gap-3 rounded-brief-panel border border-white/15 bg-white/[0.07] p-2.5 pr-4 backdrop-blur-xl transition-colors active:bg-white/[0.14]"
    >
      {/* 캐러셀·작품 보기 버튼이 첫 화면 밖으로 밀리지 않게 카드 높이를 표지 62px 에 맞춘다 */}
      <span className="h-[62px] w-11 shrink-0 overflow-hidden rounded-[6px]">
        {book.cover_url ? (
          <img src={withBase(book.cover_url)} alt={`${book.title} 표지`} className="size-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-full items-center justify-center bg-brief-card px-1 text-center font-dashSerif text-[10px] font-bold leading-tight text-brief-ink [overflow-wrap:anywhere]"
          >
            {book.title}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <b className="min-w-0 truncate font-dashSerif text-base font-bold leading-snug text-white">{book.title}</b>
          <span className="shrink-0 text-xs font-semibold text-dash-muted">이어서 읽기 ›</span>
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-[#d2d2d7]">{where}</span>
        <span className="mt-2 block">
          <ProgressBar percent={progress.percent} tone="night" />
        </span>
      </span>
    </Link>
  );
}

/**
 * 이어 읽기 카드가 있을 때 입체 책 무대 밖 요소가 차지하는 세로 px.
 * 390×664 실측(카드 없을 때 작품 보기 버튼 아래 끝 580px, 무대 262px → 무대 밖 318px)에
 * 카드 70px·하단 메뉴 56px·여유 12px 를 더했다. 무대 높이 ≤ 화면 높이 - 456.
 */
const CONTINUE_CARD_RESERVE = 456;

const CTA_CLASS =
  'mx-5 flex min-h-[50px] items-center justify-center rounded-full border border-white/15 bg-white/[0.07] text-base font-semibold text-[#e8e8ed] backdrop-blur-xl transition-colors';

// FR-BRW-001 FR-BRF-001 FR-BRW-002 🚦
export default function MobileHome() {
  const navigate = useNavigate();
  const { books } = useCatalog();
  const [index, setIndex] = useState(0);
  const continueBook = pickContinueBook(listableBooks(books));
  const active = HOME_SHOWCASE[index];

  return (
    <div
      className="flex min-h-[calc(100dvh-56px-var(--safe-top)-var(--safe-bottom))] flex-col overflow-x-clip text-dash-ink"
      style={{ background: 'radial-gradient(120% 70% at 50% 38%, #26262a 0%, #141416 45%, #050505 100%)' }}
    >
      <h1 className="sr-only">홈</h1>
      <div className="flex items-center justify-between px-5 pt-3">
        <span className="font-dashSans text-[17px] font-bold tracking-[0.04em]">RE:ADD</span>
      </div>
      {continueBook ? <ContinueCard book={continueBook} /> : null}

      <div className="flex flex-1 flex-col justify-center">
        <BookCarousel3D
          books={HOME_SHOWCASE}
          index={index}
          onChange={setIndex}
          onOpen={(book) => book.bookId && navigate(briefingPath(book.bookId), { state: FROM_HOME })}
          reserve={continueBook ? CONTINUE_CARD_RESERVE : undefined}
        />

        <div className="px-4">
          <div className="text-center text-xs tracking-[0.02em] text-dash-muted">
            <b className="mb-1 block text-[26px] font-extrabold leading-[1.2] tracking-[-0.02em] text-white">{active.title}</b>
            {`${active.author} · ${active.meta}`}
          </div>
          <div data-testid="home-hook" className="mt-2 text-center font-hand text-[#e9e2d3]">
            {active.hook.map((line, i) => (
              <span
                key={line}
                className={`block whitespace-nowrap ${i === 2 ? 'text-[31px] leading-[1.25] text-white' : 'text-[25px] leading-[1.25]'}`}
              >
                {line}
              </span>
            ))}
          </div>
        </div>

      </div>

      <div data-testid="home-cta" className="mt-auto pb-7 pt-4">
        {active.bookId ? (
          <Link
            to={briefingPath(active.bookId)}
            state={FROM_HOME}
            data-track="작품 보기"
            className={`${CTA_CLASS} active:bg-white/[0.14]`}
          >
            작품 보기
          </Link>
        ) : (
          <p aria-disabled="true" className={`${CTA_CLASS} text-dash-muted`}>
            곧 공개
          </p>
        )}
      </div>
    </div>
  );
}
