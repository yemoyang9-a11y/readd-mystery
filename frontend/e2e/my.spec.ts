import { expect, test } from '@playwright/test';
import { installMockApi } from './support/mockApi';
import { noHorizontalScroll } from './support/layoutChecks';

// 대표 지시 2026-11-18 — MY 비회원 카드의 로그인/회원가입 버튼에서 로그인 창을 띄운다
test('NFR-USE: 비회원 카드의 로그인/회원가입 버튼이 44px 이상이고 가로 넘침이 없다', async ({ page }, testInfo) => {
  await installMockApi(page, { guest: true });
  await page.goto('/my');
  await expect(page.getByText('로그인하지 않은 상태예요')).toBeVisible();
  const entry = page.getByRole('link', { name: '로그인 / 회원가입' });
  const box = (await entry.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await entry.click();
  await expect(page).toHaveURL(/\/login\?next=%2Fmy$/);
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page).toHaveURL(/\/my$/);
  // 휴대폰은 의견 남기기가 MY 가 아니라 별도 화면(/feedback)에 있다 — PC 만 확인한다
  if (testInfo.project.name === 'desktop') {
    await expect(page.getByRole('button', { name: '의견 남기기' })).toBeVisible();
  }
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('로그인 상태를 켜고 열면 표시 이름이 보인다', async ({ page }) => {
  await installMockApi(page, { authMember: true });
  await page.addInitScript(() => {
    localStorage.setItem('ssabi.auth_token', 'e2e-token');
  });
  await page.goto('/my');
  await expect(page.getByText('시험 독자님')).toBeVisible();
  await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
});
