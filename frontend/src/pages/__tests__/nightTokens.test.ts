import { describe, expect, it } from 'vitest';
import { colorVars } from './rootColors';

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('모바일 어두운 톤 토큰', () => {
  const night = colorVars('[data-night]');

  it('본문·보조 글자와 강조색이 배경에 대해 대비 4.5:1 이상이다', () => {
    expect(contrast(night['dash-ink'], night['dash-paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['dash-muted'], night['dash-paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['dash-muted'], night['dash-card'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['brief-ink'], night['brief-paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['brief-muted'], night['brief-paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['brief-accent'], night['brief-paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['brief-accent'], night['brief-accent-soft'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['brief-on-accent'], night['brief-accent'])).toBeGreaterThanOrEqual(4.5);
  });
});
