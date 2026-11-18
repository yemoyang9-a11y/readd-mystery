// 대표 지시 2026-11-18 — 가입 약관 동의. 항목은 전자책 플랫폼 조사로 정했다
// (docs/context/research-2026-11-18-signup-fields.md 4장).
//
// 약관 문안은 아직 초안이다(법무 문안 대기). 문안이 바뀌면 CONSENT_VERSION 을 올린다 —
// 그러면 기존 계정은 /auth/me 의 consent_required 가 true 가 되어 다시 동의 화면을 거친다.
export const CONSENT_VERSION = '2026-11-18-draft';

/** 필수 — 하나라도 빠지면 가입하지 않는다 (개인정보보호법 제22조·제22조의2) */
export const REQUIRED_CONSENTS = ['terms', 'privacy', 'age14'] as const;
/** 선택 — 거절해도 가입을 막지 않는다 (개인정보보호법 제22조 제5항, 정보통신망법 제50조) */
export const OPTIONAL_CONSENTS = ['marketing'] as const;

export type ConsentKind = (typeof REQUIRED_CONSENTS)[number] | (typeof OPTIONAL_CONSENTS)[number];

export type ConsentChoice = Record<ConsentKind, boolean>;

export interface ConsentRecord {
  kind: ConsentKind;
  version: string;
  agreed: boolean;
}

export type ParsedConsents =
  { ok: true; value: ConsentChoice } | { ok: false; missing: ConsentKind[] };

/** 필수 동의는 JSON true 만 동의로 본다. 마케팅은 true 가 아니면 거절이다 */
export function parseConsents(value: unknown): ParsedConsents {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const missing = REQUIRED_CONSENTS.filter((kind) => input[kind] !== true);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    value: { terms: true, privacy: true, age14: true, marketing: input.marketing === true },
  };
}

export function isConsentComplete(choice: ConsentChoice): boolean {
  return REQUIRED_CONSENTS.every((kind) => choice[kind] === true);
}

const ALL_KINDS: readonly ConsentKind[] = [...REQUIRED_CONSENTS, ...OPTIONAL_CONSENTS];

export function toConsentRecords(choice: ConsentChoice): ConsentRecord[] {
  return ALL_KINDS.map((kind) => ({ kind, version: CONSENT_VERSION, agreed: choice[kind] }));
}

function agreedNow(records: readonly ConsentRecord[], kind: ConsentKind): boolean {
  return records.some((r) => r.kind === kind && r.version === CONSENT_VERSION && r.agreed);
}

/** 현재 버전 필수 동의가 하나라도 없으면 true — 카카오·구글 첫 로그인, 이 변경 전 가입 계정 */
export function consentRequired(records: readonly ConsentRecord[]): boolean {
  return !REQUIRED_CONSENTS.every((kind) => agreedNow(records, kind));
}

export function marketingAgreed(records: readonly ConsentRecord[]): boolean {
  return agreedNow(records, 'marketing');
}
