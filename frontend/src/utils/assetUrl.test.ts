import { withBase } from './assetUrl';

describe('withBase — 하위 주소(/readd-mystery/)에 올려도 public 파일 경로가 깨지지 않는다', () => {
  test('루트 기준 경로에는 배포 기준 경로를 붙인다', () => {
    expect(withBase('/covers/a.webp', '/readd-mystery/')).toBe('/readd-mystery/covers/a.webp');
  });
  test('기준 경로가 / 이면 그대로', () => {
    expect(withBase('/covers/a.webp', '/')).toBe('/covers/a.webp');
  });
  test('이미 기준 경로가 붙었거나 외부 주소·빈 값이면 손대지 않는다', () => {
    expect(withBase('/readd-mystery/covers/a.webp', '/readd-mystery/')).toBe('/readd-mystery/covers/a.webp');
    expect(withBase('https://cdn.example.com/a.webp', '/readd-mystery/')).toBe('https://cdn.example.com/a.webp');
    expect(withBase('//cdn.example.com/a.webp', '/readd-mystery/')).toBe('//cdn.example.com/a.webp');
    expect(withBase('data:image/png;base64,xx', '/readd-mystery/')).toBe('data:image/png;base64,xx');
    expect(withBase('', '/readd-mystery/')).toBe('');
  });
});
