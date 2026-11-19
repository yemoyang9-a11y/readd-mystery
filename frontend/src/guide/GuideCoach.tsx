import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import AmoSherlock from '../components/common/AmoSherlock';
import { CaseLabel, CaseStamp } from '../mobile/components/CaseMotifs';
import type { GuideProgress, GuideStep } from './guideSteps';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 14;
/** 비추지 않는 곳을 덮는 막 — 브랜드 검정(#0d0a0b) 계열 (2026-11-18 미스터리 브랜딩) */
const SCRIM = 'rgba(13, 10, 11, 0.74)';

/** 비춘 요소와 가이드 UI 밖의 입력은 전부 막는다 — 가이드는 정해진 곳을 눌러야만 넘어간다 */
const BLOCKED_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
  'click',
  'dblclick',
  'contextmenu',
] as const;

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}

/** 건너뛰기 버튼이 화면 오른쪽 끝에서 떨어지는 거리(px) — Tailwind right-4 */
const SKIP_EDGE = 16;

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/**
 * 건너뛰기 자리(top, px) — 화면 오른쪽 위가 기본이고, 비춘 곳이나 말풍선과 겹치면
 * 그 아래·위로 옮긴다. 비춘 곳을 가리면 그 단계를 누를 수 없게 되기 때문이다.
 */
function placeSkip({
  hole,
  bubble,
  size,
  viewport,
  safeTop,
  safeBottom,
}: {
  hole: Rect | null;
  bubble: Rect | null;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  safeTop: number;
  safeBottom: number;
}): number {
  const first = safeTop + 12;
  const candidates = [
    first,
    bubble ? bubble.top + bubble.height + 8 : null,
    hole ? hole.top + hole.height + 8 : null,
    viewport.height - safeBottom - 16 - size.height,
    bubble ? bubble.top - 8 - size.height : null,
    hole ? hole.top - 8 - size.height : null,
  ];
  const left = viewport.width - SKIP_EDGE - size.width;
  for (const top of candidates) {
    if (top === null) continue;
    if (top < safeTop + 4 || top + size.height > viewport.height - safeBottom - 4) continue;
    const box = { top, left, width: size.width, height: size.height };
    if (hole && overlaps(box, hole)) continue;
    if (bubble && overlaps(box, bubble)) continue;
    return Math.round(top);
  }
  // 비춘 곳이 화면 대부분을 덮는 단계(사이드 탭 둘러보기)는 비춘 곳과 겹치는 것은 받아들이고
  // 말풍선과만 겹치지 않는 자리를 고른다 — 말풍선의 "다음"과 건너뛰기가 서로 가리지 않게
  for (const top of candidates) {
    if (top === null) continue;
    if (top < safeTop + 4 || top + size.height > viewport.height - safeBottom - 4) continue;
    if (bubble && overlaps({ top, left, width: size.width, height: size.height }, bubble)) continue;
    return Math.round(top);
  }
  return Math.round(first);
}

/** 지금 비출 요소 — try 단계에서 눌러 본 뒤에는 결과까지 담은 넓은 곳(afterTry)이 있으면 그것 */
function currentTarget(step: GuideStep, tried: boolean): Element | null {
  if (tried && step.afterTry) return step.afterTry() ?? step.target();
  return step.target();
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 가이드 코치 마크 — 비춘 곳 하나만 밝게 두고 나머지를 어둡게 덮는다 (2026-11-18 대표 지시).
 *
 * 화면 아래의 실제 컴포넌트는 그대로 둔다. 이 층은 눈에 보이는 막(포인터를 통과시킨다)과
 * window 캡처 단계의 입력 차단 두 겹이다 — 비춘 요소 안의 입력만 통과하고, 그 요소를
 * 누르는 순간(click) 다음 단계로 간다. 말풍선·건너뛰기는 data-guide-ui 라 늘 누를 수 있다.
 *
 * 대표 지시 2026-11-19 — 건너뛰기는 말풍선에서 빼서 화면 오른쪽에 두고, 말풍선 아래 줄의
 * 예전 건너뛰기 자리에는 "다음"을 둔다. "다음"은 비춘 곳을 누른 것과 같은 동작이다(onNext).
 * 마지막 단계는 기존 마무리 버튼(문구·동작)을 그대로 쓴다.
 */
export default function GuideCoach({
  step,
  index,
  total,
  progress,
  onTargetTap,
  onNext,
  onSkip,
  onFinish,
}: {
  step: GuideStep;
  index: number;
  total: number;
  progress: GuideProgress;
  /** 비춘 곳을 눌렀다. tap 단계는 다음 단계로, try 단계는 그 자리에서 가이드 동작(예: 아모 답 보이기)만 한다 */
  onTargetTap: () => void;
  /** 말풍선의 "다음" — tap 단계는 비춘 곳을 누른 것과 같고, try·look 단계는 바로 다음 단계로 간다 */
  onNext: () => void;
  onSkip: () => void;
  onFinish: () => void;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const stepRef = useRef(step);
  stepRef.current = step;
  const tapRef = useRef(onTargetTap);
  tapRef.current = onTargetTap;
  const scrolledFor = useRef<string | null>(null);
  const bubbleRef = useRef<HTMLElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const safeProbe = useRef<HTMLDivElement>(null);
  const [skipTop, setSkipTop] = useState<number | null>(null);
  // try 단계에서 비춘 곳을 한 번 눌러 봤는가 — 눌러 본 뒤에는 결과까지 보이게 넓은 곳(afterTry)을 비춘다
  const [tried, setTried] = useState(false);
  const triedRef = useRef(false);
  triedRef.current = tried;
  useEffect(() => {
    setTried(false);
  }, [step.id]);

  // 비춘 요소의 자리를 매 프레임 따라간다 — 열리는 패널·바뀌는 쪽·스크롤을 별도 신호 없이 따라잡는다
  useLayoutEffect(() => {
    if (step.final) {
      setRect(null);
      return;
    }
    let frame = 0;
    // 단계가 바뀌면 지난 단계의 자리를 버리고 처음부터 잰다
    let last: Rect | null | undefined;
    const measure = () => {
      const el = currentTarget(stepRef.current, triedRef.current);
      let next: Rect | null = null;
      if (el) {
        if (scrolledFor.current !== stepRef.current.id) {
          scrolledFor.current = stepRef.current.id;
          el.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        }
        const r = el.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) next = { top: r.top, left: r.left, width: r.width, height: r.height };
      }
      if (last === undefined || !sameRect(last, next)) {
        last = next;
        setRect(next);
      }
      const skipEl = skipRef.current;
      if (skipEl) {
        const safe = safeProbe.current?.getBoundingClientRect();
        const bubbleBox = bubbleRef.current?.getBoundingClientRect();
        const size = skipEl.getBoundingClientRect();
        const top = placeSkip({
          hole: next
            ? { top: next.top - PAD, left: next.left - PAD, width: next.width + PAD * 2, height: next.height + PAD * 2 }
            : null,
          bubble: bubbleBox && bubbleBox.height > 0 ? bubbleBox : null,
          size: { width: size.width, height: size.height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          safeTop: safe?.top ?? 0,
          safeBottom: safe ? Math.max(0, window.innerHeight - safe.bottom) : 0,
        });
        setSkipTop((prev) => (prev === top ? prev : top));
      }
      if (window.innerWidth !== viewport.width || window.innerHeight !== viewport.height) {
        setViewport({ width: window.innerWidth, height: window.innerHeight });
      }
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    return () => window.cancelAnimationFrame(frame);
  }, [step, tried, viewport.width, viewport.height]);

  useEffect(() => {
    function guard(event: Event) {
      const node = event.target as Node | null;
      if (node instanceof Element && node.closest('[data-guide-ui]')) return;
      const current = stepRef.current;
      const mode = current.mode ?? 'tap';
      const target = mode === 'look' ? null : currentTarget(current, triedRef.current);
      if (target && node && target.contains(node) && !current.final) {
        // 가이드가 대신하는 누르기 — 요소의 원래 동작(입력 칸 채우기·초점)은 막고 가이드 동작만 한다
        const swallow = current.swallowTap && !triedRef.current;
        if (event.type === 'click') {
          if (mode === 'try') {
            if (!triedRef.current) {
              setTried(true);
              window.setTimeout(() => tapRef.current(), 0);
            }
          } else {
            // 비춘 요소 자신의 click 처리가 끝난 뒤에 넘긴다. 바로 넘기면 브라우저가 이 리스너 직후
            // 리렌더해서(마이크로태스크) 다음 단계에서 사라지는 요소(노트에 적기 버튼)가
            // 자기 onClick 을 받기 전에 없어진다.
            window.setTimeout(() => tapRef.current(), 0);
          }
        }
        if (swallow) {
          event.stopPropagation();
          if (event.cancelable) event.preventDefault();
        }
        return;
      }
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
    }
    for (const type of BLOCKED_EVENTS) window.addEventListener(type, guard, { capture: true, passive: false });
    return () => {
      for (const type of BLOCKED_EVENTS) window.removeEventListener(type, guard, { capture: true });
    };
  }, []);

  const text = typeof step.text === 'function' ? step.text(progress) : step.text;
  const counter = (
    <span className="font-dashMono text-[12px] font-medium tracking-[0.14em] text-[#a89e9a]" aria-label={`${total}단계 중 ${index + 1}단계`}>
      <span className="text-[#e58a9b]">{String(index + 1).padStart(2, '0')}</span> / {String(total).padStart(2, '0')}
    </span>
  );
  const nextButton = (
    <button
      type="button"
      onClick={onNext}
      className="min-h-11 rounded-full bg-[#8f1d35] px-5 font-dashSans text-[14px] font-bold text-white transition-colors hover:bg-[#a3243f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1618]"
    >
      다음
    </button>
  );

  if (step.final) {
    return (
      <div data-guide-ui className="fixed inset-0 z-[100] flex items-center justify-center px-4" style={{ background: SCRIM }}>
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="guide-final-title"
          data-testid="guide-bubble"
          className="relative w-full max-w-[358px] animate-pop-in overflow-hidden rounded-[16px] border border-[#35292c] bg-[#1e1618] px-6 pb-5 pt-6 text-center text-[#ece6e0] shadow-[0_24px_48px_rgba(0,0,0,0.5)] motion-reduce:animate-none"
        >
          <CaseStamp className="absolute right-4 top-4 rotate-[8deg] opacity-90">수사 개시</CaseStamp>
          <div className="flex justify-start">
            <CaseLabel>Case file · 001</CaseLabel>
          </div>
          <AmoSherlock className="mx-auto mt-5 h-20 w-auto" />
          <h2 id="guide-final-title" className="m-0 mt-4 break-keep font-dashSerif text-[22px] font-bold leading-snug text-white">
            {step.final.title}
          </h2>
          <p className="m-0 mt-2 break-keep font-amo text-[15px] leading-relaxed text-[#ece6e0]">{text}</p>
          <button
            type="button"
            data-guide-finish
            onClick={onFinish}
            className="mt-6 h-12 w-full rounded-full bg-[#8f1d35] font-dashSans text-[15px] font-bold text-white transition-colors hover:bg-[#a3243f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b] focus-visible:ring-offset-2 focus-visible:ring-offset-[#1e1618]"
          >
            {step.final.action}
          </button>
          <div className="mt-3 flex justify-center">{counter}</div>
        </section>
      </div>
    );
  }

  const hole: CSSProperties | null = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  const place = (tried && step.afterTry ? step.afterTryPlace : step.place) ?? 'auto';
  let bubbleStyle: CSSProperties;
  if (place === 'top' || (!rect && place !== 'bottom')) {
    bubbleStyle = { top: 'calc(var(--safe-top) + 12px)' };
  } else if (place === 'bottom' || !rect) {
    bubbleStyle = { bottom: 'calc(var(--safe-bottom) + 16px)' };
  } else if (rect.top + rect.height / 2 > viewport.height / 2) {
    bubbleStyle = { bottom: Math.max(12, viewport.height - rect.top + PAD + GAP) };
  } else {
    bubbleStyle = { top: Math.min(viewport.height - 160, rect.top + rect.height + PAD + GAP) };
  }

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[100]">
        {hole ? (
          <div
            data-testid="guide-spotlight"
            className="absolute rounded-xl ring-2 ring-[#e58a9b] motion-safe:transition-[top,left,width,height] motion-safe:duration-200"
            style={{ ...hole, boxShadow: `0 0 0 4px rgba(196, 71, 95, 0.28), 0 0 0 200vmax ${SCRIM}` }}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: SCRIM }} />
        )}
      </div>
      <section
        key={step.id}
        data-guide-ui
        role="dialog"
        aria-label="이용 가이드"
        aria-live="polite"
        ref={bubbleRef}
        data-testid="guide-bubble"
        className="fixed inset-x-4 z-[101] mx-auto max-w-[358px] animate-pop-in rounded-[16px] border border-[#35292c] bg-[#1e1618] px-4 pb-2 pt-4 text-[#ece6e0] shadow-[0_18px_40px_rgba(0,0,0,0.5)] motion-reduce:animate-none"
        style={bubbleStyle}
      >
        <div className="flex items-start gap-3">
          <AmoSherlock className="h-12 w-auto shrink-0" />
          <p className="m-0 min-w-0 flex-1 break-keep pt-1 font-amo text-[15px] leading-[1.6] text-[#ece6e0]">{text}</p>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[#35292c] pb-1 pl-1 pt-2">
          {counter}
          {nextButton}
        </div>
      </section>
      <div
        ref={safeProbe}
        aria-hidden="true"
        className="pointer-events-none invisible fixed inset-x-0"
        style={{ top: 'var(--safe-top)', bottom: 'var(--safe-bottom)' }}
      />
      <button
        ref={skipRef}
        type="button"
        data-guide-ui
        data-guide-skip
        onClick={onSkip}
        className="fixed right-4 z-[102] min-h-11 rounded-full border border-[#4a3f41] bg-[#1e1618] px-4 font-dashSans text-[14px] font-bold text-[#ece6e0] shadow-[0_8px_20px_rgba(0,0,0,0.4)] hover:bg-[#2a2224] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
        style={{ top: skipTop ?? 'calc(var(--safe-top) + 12px)' }}
      >
        건너뛰기
      </button>
    </>
  );
}
