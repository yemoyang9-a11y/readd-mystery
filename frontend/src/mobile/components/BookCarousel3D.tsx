import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import type { ShowcaseBook } from '../../data/homeShowcase';
import './book3d.css';

const SWIPE_MIN = 40;
const MOVE_MIN = 8;

/**
 * 입체 책 자세 (2026-11-17 시안 home-3d-c-v6). 회전 방향은 모두 양수라 넘길 때 0도를 지나지 않는다.
 * 어둡게(--b3d-b)·숨기기(--b3d-o)는 책 상자가 아니라 면마다 걸린다 — preserve-3d 상자에
 * filter/opacity가 걸리면 3D가 납작해진다(lessons.md 2026-11-17).
 */
function poseOf(d: number): { transform: string; brightness: number; opacity: number } {
  if (d === 0) {
    return { transform: 'translateX(8px) translateZ(30px) rotateY(24deg) rotateX(4deg)', brightness: 1, opacity: 1 };
  }
  if (Math.abs(d) === 1) {
    return {
      transform: `translateX(${d > 0 ? 150 : -158}px) translateZ(-190px) rotateY(${d > 0 ? 44 : 52}deg) rotateX(4deg) scale(.86)`,
      brightness: 0.45,
      opacity: 1,
    };
  }
  return {
    transform: `translateX(${Math.sign(d) * 200}px) translateZ(-260px) rotateY(50deg) rotateX(4deg) scale(.8)`,
    brightness: 0.45,
    opacity: 0,
  };
}

function Cover({ book }: { book: ShowcaseBook }) {
  return (
    <img
      src={book.cover}
      alt=""
      draggable={false}
    />
  );
}

function Arrow({ direction, onClick }: { direction: -1 | 1; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={direction < 0 ? '이전 책' : '다음 책'}
      onClick={onClick}
      className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brief-accent active:scale-95"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={direction < 0 ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'} />
      </svg>
    </button>
  );
}

const STAGE_HEIGHT = 300;

function useStageScale(): number {
  const read = () => Math.min(Math.max(Math.min(window.innerHeight / 760, window.innerWidth / 390), 0.85), 1.25);
  const [scale, setScale] = useState(read);
  useEffect(() => {
    const onResize = () => setScale(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

export default function BookCarousel3D({
  books,
  index,
  onChange,
  onOpen,
}: {
  books: ShowcaseBook[];
  index: number;
  onChange: (next: number) => void;
  onOpen: (book: ShowcaseBook) => void;
}) {
  const count = books.length;
  const startX = useRef<number | null>(null);
  const moved = useRef(false);
  const scale = useStageScale();

  function relative(i: number): number {
    let d = (((i - index) % count) + count) % count;
    if (d > count / 2) d -= count;
    return d;
  }

  function step(delta: number) {
    onChange((index + delta + count) % count);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    startX.current = event.clientX;
    moved.current = false;
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (startX.current !== null && Math.abs(event.clientX - startX.current) > MOVE_MIN) moved.current = true;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (startX.current === null) return;
    const dx = event.clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) > SWIPE_MIN) {
      moved.current = true;
      step(dx < 0 ? 1 : -1);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
    else return;
    event.preventDefault();
  }

  const active = books[index];

  return (
    <div>
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label="이번 달 추리소설"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          startX.current = null;
        }}
        data-testid="book-carousel"
        className="b3d-stage focus-visible:outline-none"
        style={{ height: STAGE_HEIGHT * scale }}
      >
        <div className="b3d-spot" style={{ top: 226 * scale, transform: `scaleX(${scale})` }} />
        <div className="b3d-world" style={{ transform: `scale(${scale})`, transformOrigin: '50% 0' }}>
          {books.map((book, i) => {
            const d = relative(i);
            const centered = d === 0;
            const pose = poseOf(d);
            const label = centered
              ? book.bookId
                ? `${book.title} 작품 보기`
                : `${book.title}, 곧 공개`
              : `${book.title} 보기`;
            return (
              <div
                key={book.slug}
                role="button"
                tabIndex={-1}
                aria-label={label}
                aria-disabled={centered && !book.bookId ? true : undefined}
                data-active={centered}
                className="b3d-book"
                onClick={() => {
                  if (moved.current) return;
                  if (!centered) onChange(i);
                  else if (book.bookId) onOpen(book);
                }}
                style={
                  {
                    transform: pose.transform,
                    zIndex: 3 - Math.min(Math.abs(d), 2),
                    '--b3d-b': pose.brightness,
                    '--b3d-o': pose.opacity,
                    '--sp': book.spine,
                    '--spt': book.spineText,
                  } as CSSProperties
                }
              >
                <div className="b3d-face b3d-front">
                  <Cover book={book} />
                </div>
                <div className="b3d-face b3d-back" />
                <div className="b3d-face b3d-spine">
                  <span aria-hidden="true" className="b3d-spine-title">
                    {book.title}
                  </span>
                </div>
                <div className="b3d-face b3d-pages" />
                <div className="b3d-face b3d-topface" />
              </div>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-x-1 flex justify-between" style={{ top: 122 * scale }}>
          <Arrow direction={-1} onClick={() => step(-1)} />
          <Arrow direction={1} onClick={() => step(1)} />
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {`${index + 1}번째 책, 총 ${count}권. ${active.title}${active.bookId ? '' : ', 곧 공개'}`}
      </p>

      <div className="-mt-3 flex justify-center">
        {books.map((book, i) => (
          <button
            key={book.slug}
            type="button"
            aria-label={`${i + 1}번째 책 ${book.title}`}
            aria-current={i === index ? 'true' : undefined}
            onClick={() => onChange(i)}
            className="group flex h-11 w-[26px] items-center justify-center focus-visible:outline-none"
          >
            <i
              className={`block h-1.5 rounded-full transition-all duration-300 group-focus-visible:ring-2 group-focus-visible:ring-brief-accent group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-black motion-reduce:transition-none ${
                i === index ? 'w-[18px] bg-brief-mark' : 'w-1.5 bg-[#48484a]'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
