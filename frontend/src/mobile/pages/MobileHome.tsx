import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HOME_SHOWCASE } from '../../data/homeShowcase';
import { useCatalog } from '../../hooks/useCatalog';
import { useEnterBook } from '../../hooks/useEnterBook';
import { pickContinueBook } from '../../utils/homeRows';
import { listableBooks } from '../../utils/listableBooks';
import { bookPath } from '../../utils/routes';
import BookCarousel3D from '../components/BookCarousel3D';

const CTA_CLASS =
  'mx-5 mt-2 flex min-h-[50px] items-center justify-center rounded-full border border-white/15 bg-white/[0.07] text-base font-semibold text-[#e8e8ed] backdrop-blur-xl transition-colors';

// FR-BRW-001 FR-BRF-001 FR-BRW-002 🚦
export default function MobileHome() {
  const navigate = useNavigate();
  const { books } = useCatalog();
  const { enter, busyId } = useEnterBook();
  const [index, setIndex] = useState(0);
  const continueBook = pickContinueBook(listableBooks(books));
  const active = HOME_SHOWCASE[index];

  return (
    <div
      className="flex min-h-[calc(100dvh-56px-var(--safe-top)-var(--safe-bottom))] flex-col overflow-x-clip pb-4 text-dash-ink"
      style={{ background: 'radial-gradient(120% 70% at 50% 38%, #26262a 0%, #141416 45%, #050505 100%)' }}
    >
      <h1 className="sr-only">홈</h1>
      <div className="flex items-center justify-between px-5 pt-3">
        <span className="font-dashSans text-[17px] font-bold tracking-[0.04em]">RE:ADD</span>
        {continueBook ? (
          <button
            type="button"
            data-track="이어 읽기"
            disabled={busyId === continueBook.book_id}
            onClick={() => void enter(continueBook.book_id)}
            className="flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] py-1.5 pl-1.5 pr-3 text-xs text-[#d2d2d7] disabled:opacity-40"
          >
            <i aria-hidden="true" className="h-7 w-5 rounded-[2px] bg-gradient-to-br from-[#2e4a3a] to-[#0f1d16]" />
            {continueBook.progress ? `이어서 읽기 · ${continueBook.progress.percent}%` : '이어서 읽기'}
          </button>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col justify-center">
        <BookCarousel3D
          books={HOME_SHOWCASE}
          index={index}
          onChange={setIndex}
          onOpen={(book) => book.bookId && navigate(bookPath(book.bookId))}
        />

        <div className="px-4">
          <div className="text-center text-xs tracking-[0.02em] text-dash-muted">
            <b className="mb-0.5 block text-[17px] font-bold tracking-[-0.01em] text-dash-ink">{active.title}</b>
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

        <div className="mt-4">
          {active.bookId ? (
            <Link to={bookPath(active.bookId)} data-track="작품 보기" className={`${CTA_CLASS} active:bg-white/[0.14]`}>
              작품 보기
            </Link>
          ) : (
            <p aria-disabled="true" className={`${CTA_CLASS} text-dash-muted`}>
              곧 공개
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
