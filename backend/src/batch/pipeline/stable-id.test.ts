/**
 * 결정적 ID(uuid v5) 고정 — uuid 패키지 버전을 올려도 이미 저장된 인물·관계·용어·메모
 * ID가 바뀌면 안 된다. 아래 기대값은 uuid@10.0.0으로 계산해 고정했다(2026-11-18).
 * 같은 결과를 RFC 4122 v5 정의(SHA-1, URL 네임스페이스)로 독립 계산해 대조한다.
 */
import { createHash } from 'crypto';
import { v5 as uuidv5 } from 'uuid';
import { createEmptyState, mergeTerms } from './accumulate';

const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

// uuid@10.0.0에서 계산한 값. 바꾸지 않는다.
const PINNED: Array<[unknown[], string]> = [
  [['gasang', 'term', '가상범인'], 'b8401a6b-d561-5098-addb-6b1de34bb791'],
  [['book-1', '유불란'], '9689acde-2375-585c-a5c7-c3d452e99b30'],
  [
    ['book-1', 'relationship', 'a|b', 12, '친구', 'current'],
    '418fb3cd-162e-5428-a9ac-31ead9234162',
  ],
  [['unscoped', 'note', 'x', 3, '메모'], 'e3f8fa73-43f9-502c-a12e-4d1f103cac39'],
];

function rfc4122v5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe('결정적 ID: uuid 버전을 올려도 저장된 ID와 같다', () => {
  it('URL 네임스페이스 상수가 그대로다', () => {
    expect(uuidv5.URL).toBe(URL_NAMESPACE);
  });

  it.each(PINNED)('uuid v5 출력이 고정값과 같다: %j', (parts, expected) => {
    const name = JSON.stringify(parts);
    expect(uuidv5(name, uuidv5.URL)).toBe(expected);
    expect(rfc4122v5(name, URL_NAMESPACE)).toBe(expected);
  });

  it('용어 누적이 만드는 ID가 고정값과 같다', () => {
    const state = createEmptyState('gasang');
    mergeTerms(state, [{ term: ' 가상범인 ', definition: '작품 제목', first_appearance_page: 1 }]);
    expect(state.terms[0].id).toBe('b8401a6b-d561-5098-addb-6b1de34bb791');
  });
});
