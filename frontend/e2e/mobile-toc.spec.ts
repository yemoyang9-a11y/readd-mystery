import { expect, test, type Page } from '@playwright/test';
import { BOOK_ID } from './support/fixtures';
import { installMockApi, type MockApiOptions } from './support/mockApi';
import { swipe } from './support/gestures';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', '모바일 프로젝트에서만');
});

async function open(page: Page, opts: MockApiOptions = {}) {
  const log = await installMockApi(page, opts);
  await page.goto(`/books/${BOOK_ID}/read`);
  await expect(page.getByRole('article')).toContainText(`${opts.startPage ?? 15}쪽.`);
  await expect.poll(() => log.progress.length).toBe(1);
  const { width, height } = page.viewportSize()!;
  return { log, width, height, pageInput: page.getByRole('textbox', { name: '페이지로 이동' }) };
}

test('G10: 목차 손잡이로 리스트를 펼치고, 장을 고르면 이동 후 닫힌다', async ({ page }) => {
  const { log, width, pageInput } = await open(page);
  const handle = page.getByRole('button', { name: /^목차 (열기|닫기)$/ });
  await handle.click();
  const list = page.getByTestId('toc-list');
  await expect(list).toBeVisible();
  expect((await list.boundingBox())!.width).toBeLessThan(width * 0.5);
  const background = await list.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background, '리스트 배경은 불투명').toMatch(/^rgb\(/);
  const current = list.locator('[aria-current="true"]');
  await expect(current).toContainText('생활 제일과');
  await expect(current).toBeInViewport();

  const claims: Array<string | null> = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/books/${BOOK_ID}/progress`)) {
      claims.push((request.postDataJSON() as { claim?: string | null }).claim ?? null);
    }
  });
  await list.getByRole('button', { name: /신판 흥보전/ }).click();
  // 2026-11-17 대표 결정(A + C안) — 기준점(15쪽)보다 뒤 장을 고르면 확인 창이 뜬다. 이동만 하면 읽음 확인은 보내지 않는다
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(pageInput).toHaveValue('15');
  await dialog.getByRole('button', { name: '이동만 하기' }).click();
  await expect(pageInput).toHaveValue('21');
  await expect(list).toHaveCount(0);
  await expect.poll(() => log.progress.at(-1)).toBe(21);
  expect(claims.at(-1)).toBeNull();

  await handle.click();
  await expect(page.getByTestId('toc-list')).toBeVisible();
  await handle.click();
  await expect(page.getByTestId('toc-list')).toHaveCount(0);
});

// 위 G10(이동만 하기 → claim 없음)의 짝 — 독자가 앞부분을 읽었다고 답하면 그 이동에만 claim: read_through 가 실린다.
// 숫자(기준점)는 보내지 않는다 — 인정할 쪽은 서버가 정한다 (절대 규칙 8, FR-PRG-003 🚦)
test('FR-PRG-003: 확인 창에서 "앞부분은 이미 읽었어요"를 고르면 그 쪽 이동에 claim read_through 를 싣는다', async ({ page }) => {
  const { log, pageInput } = await open(page);
  const bodies: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/books/${BOOK_ID}/progress`)) {
      bodies.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.getByRole('button', { name: /^목차 (열기|닫기)$/ }).click();
  await page.getByTestId('toc-list').getByRole('button', { name: /신판 흥보전/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '앞부분은 이미 읽었어요' }).click();
  await expect(pageInput).toHaveValue('21');
  await expect.poll(() => log.progress.at(-1)).toBe(21);
  await expect.poll(() => bodies.at(-1)?.claim).toBe('read_through');
  expect(Object.keys(bodies.at(-1)!)).not.toContain('cutoff');
});

test('G11: 리스트를 연 채로 넘기면 현재 장 강조가 바뀐다', async ({ page }) => {
  const { width, height, pageInput } = await open(page, { startPage: 20 });
  await page.getByRole('button', { name: /^목차 (열기|닫기)$/ }).click();
  const list = page.getByTestId('toc-list');
  await expect(list.locator('[aria-current="true"]')).toContainText('생활 제일과');
  await swipe(page, { fromX: width * 0.9, toX: width * 0.55, y: height * 0.3, durationMs: 400 });
  await expect(pageInput).toHaveValue('21');
  await expect(list.locator('[aria-current="true"]')).toContainText('신판 흥보전');
});

test('C1: 리스트를 연 상태에서 가로 스크롤이 없다', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^목차 (열기|닫기)$/ }).click();
  await expect(page.getByTestId('toc-list')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('목차 리스트가 열린 채로 싸비를 열면 리스트가 싸비 위에 남지 않는다', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^목차 (열기|닫기)$/ }).click();
  await expect(page.getByTestId('toc-list')).toBeVisible();
  await page.getByRole('button', { name: /^사이드 탭 (열기|닫기)$/ }).click();
  await expect(page.getByTestId('mobile-ssabi')).toBeVisible();
  await expect(page.getByTestId('toc-list')).toHaveCount(0);
});

test('FR-NAV-001: 목차 리스트 항목에 장 번호가 제목과 함께 보인다', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^목차 (열기|닫기)$/ }).tap();
  const list = page.getByTestId('toc-list');
  const items = list.getByRole('listitem');
  await expect(items).toHaveCount(3);
  for (const [i, title] of ['인간기념물', '생활 제일과', '신판 흥보전'].entries()) {
    await expect(items.nth(i).getByText(String(i + 1), { exact: true })).toBeVisible();
    await expect(items.nth(i)).toContainText(title);
  }
  const current = list.locator('[aria-current="true"]');
  await expect(current).toContainText('2');
  await expect(current).toContainText('생활 제일과');
});

test('피드백: 목차 리스트는 내려간 손잡이에서 위로 펼쳐지고 화면 안에 있다', async ({ page }) => {
  await open(page);
  const handle = page.getByRole('button', { name: /^목차 (열기|닫기)$/ });
  await handle.click();
  const list = (await page.getByTestId('toc-list').boundingBox())!;
  const h = (await handle.boundingBox())!;
  expect(Math.abs(list.y + list.height - (h.y + h.height))).toBeLessThanOrEqual(2);
  expect(list.y).toBeGreaterThanOrEqual(0);
});
