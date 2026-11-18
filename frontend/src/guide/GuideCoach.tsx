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

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 가이드 코치 마크 — 비춘 곳 하나만 밝게 두고 나머지를 어둡게 덮는다 (2026-11-18 대표 지시).
 *
 * 화면 아래의 실제 컴포넌트는 그대로 둔다. 이 층은 눈에 보이는 막(포인터를 통과시킨다)과
 * window 캡처 단계의 입력 차단 두 겹이다 — 비춘 요소 안의 입력만 통과하고, 그 요소를
 * 누르는 순간(click) 다음 단계로 간다. 말풍선·건너뛰기는 data-guide-ui 라 늘 누를 수 있다.
 */
export default function GuideCoach({
  step,
  index,
  total,
  progress,
  onTargetTap,
  onSkip,
  onFinish,
}: {
  step: GuideStep;
  index: number;
  total: number;
  progress: GuideProgress;
  onTargetTap: () => void;
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
      const el = stepRef.current.target();
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
      if (window.innerWidth !== viewport.width || window.innerHeight !== viewport.height) {
        setViewport({ width: window.innerWidth, height: window.innerHeight });
      }
      frame = window.requestAnimationFrame(measure);
    };
    measure();
    return () => window.cancelAnimationFrame(frame);
  }, [step, viewport.width, viewport.height]);

  useEffect(() => {
    function guard(event: Event) {
      const node = event.target as Node | null;
      if (node instanceof Element && node.closest('[data-guide-ui]')) return;
      const target = stepRef.current.target();
      if (target && node && target.contains(node)) {
        // 비춘 요소 자신의 click 처리가 끝난 뒤에 넘긴다. 바로 넘기면 브라우저가 이 리스너 직후
        // 리렌더해서(마이크로태스크) 다음 단계에서 사라지는 요소(물어보기·노트에 적기 버튼)가
        // 자기 onClick 을 받기 전에 없어진다.
        if (event.type === 'click' && !stepRef.current.doneWhen && !stepRef.current.final) {
          window.setTimeout(() => tapRef.current(), 0);
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
  const skip = (
    <button
      type="button"
      onClick={onSkip}
      className="min-h-11 rounded-full px-3 font-dashSans text-[14px] font-bold text-[#ece6e0] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e58a9b]"
    >
      건너뛰기
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

  const place = step.place ?? 'auto';
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
        data-testid="guide-bubble"
        className="fixed inset-x-4 z-[101] mx-auto max-w-[358px] animate-pop-in rounded-[16px] border border-[#35292c] bg-[#1e1618] px-4 pb-2 pt-4 text-[#ece6e0] shadow-[0_18px_40px_rgba(0,0,0,0.5)] motion-reduce:animate-none"
        style={bubbleStyle}
      >
        <div className="flex items-start gap-3">
          <AmoSherlock className="h-12 w-auto shrink-0" />
          <p className="m-0 min-w-0 flex-1 break-keep pt-1 font-amo text-[15px] leading-[1.6] text-[#ece6e0]">{text}</p>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[#35292c] pl-1">
          {counter}
          {skip}
        </div>
      </section>
    </>
  );
}
