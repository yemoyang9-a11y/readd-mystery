import { describe, expect, it } from 'vitest';
import { withRo } from './MobileJumpBar';

describe('withRo — "p.N(으)로 돌아가기"의 조사', () => {
  it('받침 없음·ㄹ받침은 "로", 그 밖은 "으로"', () => {
    expect([1, 2, 4, 5, 7, 8, 9, 12, 21].map(withRo)).toEqual(Array(9).fill('로'));
    expect([3, 6, 10, 13, 40, 100].map(withRo)).toEqual(Array(6).fill('으로'));
  });
});
