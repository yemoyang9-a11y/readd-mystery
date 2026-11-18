/**
 * 닫힌 관계 유형 표 — FR-CHR-001 🚦
 * 큰 종류(kind)·방향·대칭은 표에서 파생된다. 표에는 한 번 일어난 행동이 없다.
 */
import {
  CATEGORY_STORAGE_KIND,
  RELATION_CATEGORIES,
  RELATION_TYPES,
  relationType,
  storageKind,
} from './relationship-taxonomy';
import { evaluativeWord } from './semantic-guards';

describe('FR-CHR-001: 관계 유형 표', () => {
  test('대표가 짚은 관계(동료·의심·적대)와 기본 가족·감정 유형이 표에 있다', () => {
    const keys = RELATION_TYPES.map((t) => t.key);
    for (const key of [
      'colleague',
      'suspicion',
      'hostility',
      'marriage',
      'parenthood',
      'sibling',
      'friendship',
      'employment',
      'affection',
      'romance',
      'jealousy',
      'hatred',
      'trust',
      'fear',
      'wariness',
    ])
      expect(keys).toContain(key);
  });

  test('FR-CHR-001: 한 번 일어난 행동 유형(action·손잡음·구함)은 표에 0건', () => {
    const actionLike = RELATION_TYPES.filter(
      (t) =>
        storageKind(t) === 'action' ||
        /physical_contact|rescue|visit|meet|hit/.test(t.key) ||
        /손을 잡|구하|찾아가|때리/.test(t.label)
    );
    expect(actionLike).toEqual([]);
  });

  test('유형 키는 저장 계약(relation_key 형식)을 따르고 중복이 없다', () => {
    const keys = RELATION_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_:-]{1,79}$/);
  });

  test('저장 kind는 큰 종류에서만 파생되고 DB 제약 값(family/social/emotion) 안에 있다', () => {
    for (const c of RELATION_CATEGORIES)
      expect(['family', 'social', 'emotion']).toContain(CATEGORY_STORAGE_KIND[c]);
    expect(storageKind(relationType('colleague')!)).toBe('social');
    expect(storageKind(relationType('suspicion')!)).toBe('emotion');
    expect(storageKind(relationType('marriage')!)).toBe('family');
  });

  test('방향 있는 유형은 주체·대상 역할이 있고, 대칭 유형은 없다', () => {
    for (const t of RELATION_TYPES) {
      if (t.directionality === 'directed') expect(t.roles).toBeDefined();
      else expect(t.roles).toBeUndefined();
    }
    expect(relationType('colleague')!.directionality).toBe('symmetric');
    expect(relationType('suspicion')!.directionality).toBe('directed');
  });

  test('제외 질문이 가리키는 유형은 표 안에 있고, 라벨은 추상 명사·평가어가 아니다', () => {
    for (const t of RELATION_TYPES) {
      for (const x of t.exclusions) if (x.instead) expect(relationType(x.instead)).toBeDefined();
      expect(t.label).not.toMatch(/^(?:욕망|관계|감정|관심|연결|인연|애정|갈등|적대|사랑)$/u);
      expect(evaluativeWord(`${t.label} ${t.definition}`)).toBeUndefined();
      expect(t.question).toMatch(/원문이 말하는가\?$/u);
      expect(t.sources.length).toBeGreaterThan(0);
    }
  });

  test('표 밖의 키는 유형이 아니다', () => {
    expect(relationType('physical_contact')).toBeUndefined();
    expect(relationType('rescue')).toBeUndefined();
    expect(relationType(undefined)).toBeUndefined();
  });
});
