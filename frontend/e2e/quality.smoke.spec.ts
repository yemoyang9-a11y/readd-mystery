import { expect, test } from '@playwright/test';
import { BOOK_ID } from './support/fixtures';
import { installMockApi } from './support/mockApi';

test('홈·검색: 작은 화면에서도 탐색하고 미검수 도서를 숨긴다', async ({ page }, info) => {
  await installMockApi(page);
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByText('RE:ADD', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('검수 전 도서')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('home.png'), fullPage: true });
  await page.goto('/search');
  await page.getByRole('searchbox', { name: '작품, 작가 검색' }).fill('탁류');
  await expect(page.getByRole('list', { name: '검색 결과' }).getByRole('link', { name: /탁류/ })).toBeVisible();
  await page.getByRole('searchbox').fill('없는작품');
  await expect(page.getByText('찾는 작품이 없습니다')).toBeVisible();
});

test('읽기·확인 창: 기준점 변경은 명시적 선택 뒤에만 적용된다', async ({ page }, info) => {
  const log = await installMockApi(page);
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
