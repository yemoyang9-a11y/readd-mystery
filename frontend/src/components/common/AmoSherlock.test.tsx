import { render } from '@testing-library/react';
import AmoSherlock from './AmoSherlock';

test('아모는 기본 표정과 생각 표정을 그리고 인스턴스마다 id 가 겹치지 않는다', () => {
  const { container } = render(
    <>
      <AmoSherlock />
      <AmoSherlock expression="think" />
    </>
  );
  const faces = container.querySelectorAll('svg[data-amo]');
  expect([...faces].map((svg) => svg.getAttribute('data-amo'))).toEqual(['default', 'think']);
  const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
  expect(new Set(ids).size).toBe(ids.length);
});

// 대표 지시 2026-11-19 — 아모의 손을 모두 없앤다. 모자·몸은 그대로 있어야 한다(쌍)
test('아모에 손 요소 0개 — 몸 양옆(몸 바깥)에 그린 도형이 없다', () => {
  const { container } = render(
    <>
      <AmoSherlock />
      <AmoSherlock expression="think" />
    </>
  );
  const faces = container.querySelectorAll('svg[data-amo]');
  expect(faces).toHaveLength(2);
  for (const svg of faces) {
    // 예전 손 자리 (cx=30·130, cy=148)
    expect(svg.querySelectorAll('[cy="148"]')).toHaveLength(0);
    // 모자 밖에서 몸 폭(x 34~126) 바깥에 놓인 동그라미·타원이 없다
    const outside = [...svg.querySelectorAll('ellipse, circle')].filter((el) => {
      if (el.closest('[data-amo-part="hat"]')) return false;
      const cx = Number(el.getAttribute('cx'));
      return cx < 34 || cx > 126;
    });
    expect(outside).toHaveLength(0);
    expect(svg.querySelector('[data-amo-part="hand"]')).toBeNull();
  }
});

test('아모는 손이 없어도 모자와 몸은 그대로 그린다', () => {
  const { container } = render(<AmoSherlock />);
  const svg = container.querySelector('svg[data-amo]')!;
  expect(svg.querySelector('[data-amo-part="hat"] path')).not.toBeNull();
  expect(svg.querySelector('[data-amo-part="body"]')).not.toBeNull();
  // 눈 두 개
  expect(svg.querySelectorAll('circle[r="8.5"]')).toHaveLength(2);
});
