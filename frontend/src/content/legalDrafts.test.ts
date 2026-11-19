import { describe, expect, it } from 'vitest';
import { LEGAL_DRAFTS } from './legalDrafts';

// 2026-11-19 대표 지시 — 화면 문구에는 "AI"를 쓰지 않지만, 이용약관에는 아모·요약·관계도가 AI로 만들어진다는 사실을 밝힌다
describe('이용약관 초안 — 인공지능(AI) 사용 고지', () => {
  it('이용약관 서비스 내용에 아모가 인공지능(AI)이라는 것과 AI가 만든 내용은 틀릴 수 있다는 것을 적는다', () => {
    const text = LEGAL_DRAFTS.terms.sections.flatMap((s) => s.body).join('\n');
    expect(text).toMatch(/아모는 인공지능\(AI\)/);
    expect(text).toMatch(/틀릴 수 있습니다/);
  });
});
