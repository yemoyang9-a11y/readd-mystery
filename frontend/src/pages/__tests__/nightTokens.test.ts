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

  it('검정 틀은 브랜드 값이고 강조는 버건디 계열이다', () => {
    expect(night['dash-paper']).toBe('#0d0a0b');
    expect(night['dash-card']).toBe('#1e1618');
    expect(night['dash-line']).toBe('#35292c');
    expect(night['dash-ink']).toBe('#ece6e0');
    expect(night['dash-muted']).toBe('#a89e9a');
    expect(night['brief-accent']).toBe('#e58a9b');
    expect(night['brief-mark']).toBe('#c4475f');
    expect(contrast(night['brief-ink'], night['brief-card'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['brief-muted'], night['brief-card'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['brief-accent'], night['brief-card'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(night['brief-mark'], night['brief-paper'])).toBeGreaterThanOrEqual(3);
  });
});

describe('모바일 흰 종이 톤 토큰', () => {
  const paper = colorVars('[data-mobile]');
  const desktop = colorVars(':root');

  it('흰 바탕에서 버건디 강조가 브랜드 값이고 글자 대비 4.5:1 이상이다', () => {
    expect(paper['brief-paper']).toBe('#fbfaf9');
    expect(paper['brief-ink']).toBe('#1a1415');
    expect(paper['brief-accent']).toBe('#8f1d35');
    expect(paper['brief-accent-soft']).toBe('#f3e3e7');
    expect(paper['brief-on-accent']).toBe('#ffffff');
    expect(contrast(paper['brief-ink'], paper['brief-paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paper['brief-muted'], paper['brief-paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paper['brief-muted'], paper['brief-accent-soft'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paper['brief-accent'], paper['brief-paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paper['brief-accent'], paper['brief-accent-soft'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(paper['brief-on-accent'], paper['brief-accent'])).toBeGreaterThanOrEqual(4.5);
  });

  it('PC 기본 색은 바꾸지 않는다', () => {
    expect(desktop['brief-accent']).toBe('#4f7052');
    expect(desktop['brief-paper']).toBe('#fdfdfa');
  });
});
