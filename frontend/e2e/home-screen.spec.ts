import { expect, test } from '@playwright/test';

// 대표 지시 2026-11-19 — 앱 이름은 RE:ADD (홈 화면 아이콘 이름·창 제목)
test('결정 10: 홈 화면 추가 manifest는 standalone이고 이름이 RE:ADD다', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  // 2026-11-18 대표 결정 — 화면을 GitHub Pages 하위 경로로 배포하므로 manifest 의 주소는 상대 경로(./)다.
  // 상대 주소는 manifest 파일 주소 기준으로 풀어서 앱 첫 화면(/)을 가리키는지 본다
  const manifestUrl = new URL(href!, page.url());
  const response = await request.get(manifestUrl.href);
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.orientation, '태블릿 PC 화면을 세로로 고정하지 않는다').toBeUndefined();
  expect(manifest.name).toBe('RE:ADD');
  expect(manifest.short_name).toBe('RE:ADD');
  expect(new URL(manifest.start_url, manifestUrl).pathname).toBe('/');
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(new URL(icon.src, manifestUrl).href)).status(), icon.src).toBe(200);
  }
});

test('결정 10: iOS 홈 화면 메타와 아이콘이 있다', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'default');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'RE:ADD');
  await expect(page).toHaveTitle('RE:ADD');
  const icon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const response = await request.get(icon!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/png');
});
