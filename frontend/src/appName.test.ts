/**
 * 대표 지시 2026-11-19 — 앱 이름은 RE:ADD.
 * 홈 화면에 추가했을 때의 이름(manifest name·short_name, iOS apple-mobile-web-app-title)과 창 제목(<title>)을 본다.
 * 화면 안 문구의 "싸비" 0건 검사는 uiCopy.noSsabi.test.tsx 가 한다.
 */
// @ts-expect-error 이 프로젝트 tsconfig 에는 node 타입이 없다
import { readFileSync } from 'node:fs';

const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
const read = (path: string): string => readFileSync(`${cwd}/${path}`, 'utf-8');

describe('대표 지시 2026-11-19: 앱 이름 RE:ADD', () => {
  test('manifest 의 name·short_name 이 RE:ADD 다', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as { name: string; short_name: string };
    expect(manifest.name).toBe('RE:ADD');
    expect(manifest.short_name).toBe('RE:ADD');
  });

  test('index.html 의 <title> 과 iOS 홈 화면 이름이 RE:ADD 이고, "싸비"가 0건이다', () => {
    const doc = new DOMParser().parseFromString(read('index.html'), 'text/html');
    expect(doc.title).toBe('RE:ADD');
    expect(doc.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('RE:ADD');
    expect(read('index.html')).not.toContain('싸비');
    expect(read('public/manifest.webmanifest')).not.toContain('싸비');
  });
});
