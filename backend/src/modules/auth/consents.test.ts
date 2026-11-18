import { CONSENT_VERSION, consentRequired, parseConsents, toConsentRecords } from './consents';

const ALL = { terms: true, privacy: true, age14: true, marketing: false };

describe('가입 약관 동의 검사 — 대표 지시 2026-11-18', () => {
  test('필수 셋(이용약관·개인정보 수집·이용·만 14세 이상)이 모두 true면 통과한다', () => {
    expect(parseConsents(ALL)).toEqual({ ok: true, value: ALL });
  });

  test('마케팅은 선택이다 — 빠지면 false로 받는다', () => {
    expect(parseConsents({ terms: true, privacy: true, age14: true })).toEqual({
      ok: true,
      value: { ...ALL, marketing: false },
    });
    expect(parseConsents({ ...ALL, marketing: true })).toMatchObject({
      ok: true,
      value: { marketing: true },
    });
  });

  test.each([
    [{ privacy: true, age14: true }, ['terms']],
    [{ terms: true, age14: true }, ['privacy']],
    [{ terms: true, privacy: true }, ['age14']],
    [{ terms: true, privacy: 'true', age14: 1 }, ['privacy', 'age14']],
    [undefined, ['terms', 'privacy', 'age14']],
    [null, ['terms', 'privacy', 'age14']],
  ])('필수 동의가 빠지면 거절하고 빠진 종류를 알린다 %#', (input, missing) => {
    expect(parseConsents(input)).toEqual({ ok: false, missing });
  });

  test('저장할 기록은 네 종류 모두 현재 버전으로 남긴다(거절한 마케팅도)', () => {
    expect(toConsentRecords(ALL)).toEqual([
      { kind: 'terms', version: CONSENT_VERSION, agreed: true },
      { kind: 'privacy', version: CONSENT_VERSION, agreed: true },
      { kind: 'age14', version: CONSENT_VERSION, agreed: true },
      { kind: 'marketing', version: CONSENT_VERSION, agreed: false },
    ]);
  });

  test('현재 버전 필수 동의가 하나라도 없으면 동의가 필요하다', () => {
    expect(consentRequired([])).toBe(true);
    expect(consentRequired(toConsentRecords(ALL))).toBe(false);
    expect(consentRequired(toConsentRecords(ALL).filter((record) => record.kind !== 'age14'))).toBe(
      true
    );
    expect(
      consentRequired(toConsentRecords(ALL).map((record) => ({ ...record, version: 'old' })))
    ).toBe(true);
  });
});
