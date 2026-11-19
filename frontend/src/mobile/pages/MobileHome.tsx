import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { HOME_SHOWCASE } from '../../data/homeShowcase';
import { useCatalog } from '../../hooks/useCatalog';
import { pickContinueBook } from '../../utils/homeRows';
import { listableBooks } from '../../utils/listableBooks';
import { briefingPath } from '../../utils/routes';
import BookCarousel3D from '../components/BookCarousel3D';
import type { BookSummary } from '../../types';

const FROM_HOME = { fromHome: true };

/**
 * 홈 머리 줄 오른쪽의 작은 "이어서 읽기" 버튼 (대표 지시 2026-11-19 — 큰 이어 읽기 카드를 없애고
 * 머리 줄 오른쪽에 작게). 진도 기록이 있는 책(GET /books 에 progress 가 온 책)이 있을 때만 그린다.
 *
 * 쪽(progress.current_page)은 GET /books 응답 그대로다. 프론트는 퍼센트·기준점을 계산하지 않는다
 * (절대 규칙 2, FR-BRF-005 🚦). 누르는 영역은 높이 44px(min-h-11).
 */
// FR-BRF-001 FR-BRF-005 🚦
function ContinueButton({ book }: { book: BookSummary }) {
  const page = book.progress!.current_page;
  return (
    <Link
      to={briefingPath(book.book_id)}
      state={FROM_HOME}
      data-track="이어 읽기"
      data-testid="home-continue"
      aria-label={`이어서 읽기, ${book.title}, ${page}p`}
      className="flex min-h-11 min-w-0 max-w-[62%] items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.07] pl-3.5 pr-3 font-dashSans text-[13px] text-[#e8e8ed] backdrop-blur-xl transition-colors active:bg-white/[0.14]"
    >
      <b className="shrink-0 font-bold">이어서 읽기</b>
      <span aria-hidden="true" className="min-w-0 truncate font-dashSerif text-[12.5px] text-[#d2d2d7]">
        {book.title}
      </span>
      <span aria-hidden="true" className="shrink-0 text-dash-muted">›</span>
    </Link>
  );
}

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
      {/* 대표 지시 2026-11-19 — 왼쪽 위 RE:ADD 워드마크(명조), 오른쪽 위 작은 이어서 읽기 */}
      <div data-testid="home-head" className="flex min-h-11 items-center justify-between gap-3 px-5 pt-3">
        <span data-testid="home-wordmark" className="shrink-0 font-dashSerif text-[21px] font-bold tracking-[0.02em] text-white">
          RE:ADD
        </span>
        {continueBook ? <ContinueButton book={continueBook} /> : null}
      </div>

      <div className="flex flex-1 flex-col justify-center">
        <BookCarousel3D
          books={HOME_SHOWCASE}
          index={index}
          onChange={setIndex}
          onOpen={(book) => book.bookId && navigate(briefingPath(book.bookId), { state: FROM_HOME })}
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
