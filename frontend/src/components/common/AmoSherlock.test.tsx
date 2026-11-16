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
