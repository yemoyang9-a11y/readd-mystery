import { expect, test } from '@playwright/test';
import { BOOK_ID } from './support/fixtures';
import { installMockApi } from './support/mockApi';

test('홈·검색: 작은 화면에서도 탐색하고 미검수 도서를 숨긴다', async ({ page }, info) => {
  await installMockApi(page);
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  if (info.project.name === 'desktop') {
    // PC의 콜론은 북마크 SVG이므로 실제 텍스트는 READD다.
    await expect(page.getByRole('banner')).toContainText('READD');
  } else {
    await expect(page.getByText('RE:ADD', { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('탁류', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('검수 전 도서')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('home.png'), fullPage: true });
  await page.goto('/search');
  await page.getByRole('searchbox', { name: '작품, 작가 검색' }).fill('탁류');
  await expect(page.getByRole('list', { name: '검색 결과' }).getByRole('link', { name: /탁류/ })).toBeVisible();
  await page.getByRole('searchbox').fill('없는작품');
  await expect(page.getByText('찾는 작품이 없습니다')).toBeVisible();
});

test('읽기·확인 창: 이동만 하기는 읽음 확인을 전송하지 않는다', async ({ page }, info) => {
  const log = await installMockApi(page);
  const sent: Array<{ page: number; claim?: string | null }> = [];
  // 기존 공용 fixture는 이동 쪽을 cutoff로 쓰므로 이 시험에서는 현재 계약을 고정한다.
  await page.route(`**/books/${BOOK_ID}/progress`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const event = route.request().postDataJSON() as { page: number; claim?: string | null };
    sent.push(event);
    log.progress.push(event.page);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      body: JSON.stringify({ success: true, applied_cutoff: 15, confirm: null }),
    });
  });
  await page.goto(`/books/${BOOK_ID}/read`);
  await expect(page.getByRole('article')).toContainText('15쪽.');
  await expect.poll(() => log.progress.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: /^목차 (열기|닫기)$/ }).click();
  await page.getByRole('button', { name: /신판 흥보전/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '취소', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '앞부분은 이미 읽었어요' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '취소', exact: true })).toBeFocused();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: info.outputPath('reading-confirm.png') });
  expect(log.progress).not.toContain(21);
  await dialog.getByRole('button', { name: '이동만 하기' }).click();
  await expect(page.getByRole('article')).toContainText('21쪽.');
  await expect.poll(() => log.progress.at(-1)).toBe(21);
  expect(sent.at(-1)?.claim ?? null).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('보기 설정: 닫으면 열었던 버튼으로 초점이 돌아온다', async ({ page }) => {
  await installMockApi(page);
  await page.goto(`/books/${BOOK_ID}/read`);
  await expect(page.getByRole('article')).toContainText('15쪽.');
  const open = page.getByRole('button', { name: '보기 설정' });
  await open.click();
  const dialog = page.getByRole('dialog', { name: '보기 설정' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('관리자: 별도 화면 코드를 불러와도 인증 화면을 거친다', async ({ page }) => {
  await installMockApi(page);
  await page.goto('/admin/books');
  await expect(page.getByRole('heading', { name: 'RE:ADD 관리자' })).toBeVisible();
  await expect(page.getByLabel('관리자 토큰')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('첫 접속: 로그인하지 않은 독자에게는 로그인·회원가입 화면이 먼저 뜬다', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: '로그인' }).first()).toBeVisible();
  await expect(page.getByText('회원가입').first()).toBeVisible();
  await context.close();
});

test('E2E #89: 저장된 토큰의 계정이 없으면(401) 앱을 열 때 로그인 화면으로 간다', async ({ page }) => {
  await installMockApi(page, { authRejected: true });
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('login-screen')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ssabi.auth_token'))).toBeNull();
});

test('E2E #89: /auth/me 가 네트워크 오류면 로그아웃시키지 않는다', async ({ page }) => {
  await installMockApi(page);
  await page.route('**/auth/me', (route) => route.abort('internetdisconnected'));
  await page.goto('/');
  await expect(page.getByText('탁류', { exact: true }).first()).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
  expect(await page.evaluate(() => localStorage.getItem('ssabi.auth_token'))).not.toBeNull();
});

test('E2E #81: MY에서 로그아웃하면 next 없이 /login 으로 간다', async ({ page }) => {
  await installMockApi(page, { authMember: true });
  await page.goto('/my');
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('login-screen')).toBeVisible();
});
