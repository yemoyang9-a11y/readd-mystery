import { describe, expect, it } from 'vitest';
import { mentionNames, splitMentions } from './chatMentions';
import type { GraphResponse } from '../../types';

const graph: GraphResponse = {
  nodes: [
    { id: 'b', name: '백검사', first_appearance_page: 10, aliases: ['백검사께서'] },
    { id: 'y', name: '유불란', first_appearance_page: 1, aliases: ['탐정소설가', '유불란 씨'] },
    { id: 'm', name: '이몽란', first_appearance_page: 1, aliases: ['부인', '배우'] },
  ],
  edges: [],
};

describe('mentionNames — 강조할 인물 이름 (2026-11-18 승인 시안)', () => {
  it('대표명과 대표명이 들어간 별칭만, 긴 것부터', () => {
    expect(mentionNames(graph)).toEqual(['백검사께서', '유불란 씨', '백검사', '유불란', '이몽란']);
  });
  it('"부인"·"배우"·"탐정소설가" 같은 일반 명사 별칭은 강조하지 않는다', () => {
    const names = mentionNames(graph);
    expect(names).not.toContain('부인');
    expect(names).not.toContain('배우');
    expect(names).not.toContain('탐정소설가');
  });
  it('FR-SPL-005 🚦: 관계도 응답이 없으면(조회 전·실패) 강조 0건', () => {
    expect(mentionNames(null)).toEqual([]);
  });
});

describe('splitMentions — 답변 글자를 이름·쪽 조각으로 나눈다(글자는 바꾸지 않고 괄호만 뺀다)', () => {
  const names = mentionNames(graph);

  it('"(p.13)"은 괄호를 빼고 쪽 조각 하나로', () => {
    expect(splitMentions('함께 수사해요(p.13).', names, 68)).toEqual([
      { kind: 'text', text: '함께 수사해요 ' },
      { kind: 'page', page: 13, label: 'p.13' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('"13쪽", "p. 13", "pp.13-15"도 쪽 조각으로 — 범위는 첫 쪽으로 이동', () => {
    const parts = splitMentions('13쪽과 p. 20, (pp.13–15)', names, 68).filter((p) => p.kind === 'page');
    expect(parts).toEqual([
      { kind: 'page', page: 13, label: 'p.13' },
      { kind: 'page', page: 20, label: 'p.20' },
      { kind: 'page', page: 13, label: 'p.13–15' },
    ]);
  });

  it('책에 없는 쪽(0쪽, 마지막 쪽 뒤)은 링크로 만들지 않고 글자 그대로 둔다', () => {
    expect(splitMentions('p.0 그리고 p.999', names, 68)).toEqual([{ kind: 'text', text: 'p.0 그리고 p.999' }]);
  });

  it('인물 이름은 이름 조각으로 — 긴 별칭을 먼저 맞춘다', () => {
    expect(splitMentions('백검사께서 유불란 씨를 불렀다', names, 68)).toEqual([
      { kind: 'name', text: '백검사께서' },
      { kind: 'text', text: ' ' },
      { kind: 'name', text: '유불란 씨' },
      { kind: 'text', text: '를 불렀다' },
    ]);
  });

  it('이름도 쪽도 없으면 글자 그대로 한 조각', () => {
    expect(splitMentions('아무 일도 없었어요.', names, 68)).toEqual([{ kind: 'text', text: '아무 일도 없었어요.' }]);
  });

  it('조각을 이어 붙이면 괄호만 빠진 원래 글자와 같다 — 답변 내용은 바꾸지 않는다', () => {
    const text = '백검사는 임경부와 함께 수사해요(p.13). 이몽란은 13쪽에서 떠나요.';
    const joined = splitMentions(text, names, 68)
      .map((p) => (p.kind === 'page' ? p.label : p.text))
      .join('');
    expect(joined).toBe('백검사는 임경부와 함께 수사해요 p.13. 이몽란은 p.13에서 떠나요.');
  });
});
