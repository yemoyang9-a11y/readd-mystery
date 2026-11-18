/**
 * 가입 약관 동의 종류 — 서버 backend/src/modules/auth/consents.ts 와 같다 (대표 지시 2026-11-18).
 * 조사: docs/context/research-2026-11-18-signup-fields.md 4장.
 */
export type ConsentKind = 'terms' | 'privacy' | 'age14' | 'marketing';
export type ConsentChoice = Record<ConsentKind, boolean>;

/** 필수 — 하나라도 빠지면 가입하지 않는다. 마케팅은 선택 */
export const REQUIRED_CONSENTS: readonly ConsentKind[] = ['terms', 'privacy', 'age14'];

export const EMPTY_CONSENTS: ConsentChoice = { terms: false, privacy: false, age14: false, marketing: false };

export function missingConsents(choice: ConsentChoice): ConsentKind[] {
  return REQUIRED_CONSENTS.filter((kind) => !choice[kind]);
}
