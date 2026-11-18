import { expect, test, type Page } from '@playwright/test';
import { BOOK_ID, bookInfo } from './support/fixtures';
import { installMockApi, type MockApiOptions } from './support/mockApi';
import { noHorizontalScroll } from './support/layoutChecks';

const API = 'http://api.e2e.test';
const BOOK_URL = `/books/${BOOK_ID}`;
const SAFE_BOTTOM = 34;
const MANY_CHAPTERS = Array.from({ length: 20 }, (_, i) => ({
  chapter_no: i + 1,
  title: `${i + 1}번째 장`,
  start_page: i * 10 + 1,
  end_page: (i + 1) * 10,
}));

async function open(page: Page, opts: MockApiOptions = {}) {
  const log = await installMockApi(page, {
    totalPages: 200,
    startPage: 15,
    positions: {
      [BOOK_ID]: { applied_cutoff: 15, current_chapter_no: 2, read_chapter_nos: [1], is_complete: false },
    },
    ...opts,
  });
  await page.route(`${API}/books/${BOOK_ID}/info`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      body: JSON.stringify({ ...bookInfo(200), chapters: MANY_CHAPTERS }),
    })
  );
  await page.goto(BOOK_URL);
  await page.addStyleTag({ content: `:root { --safe-bottom: ${SAFE_BOTTOM}px; }` });
  await expect(page.getByRole('heading', { level: 1, name: '탁류' })).toBeVisible();
  await expect(page.getByRole('button', { name: /20번째 장/ })).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  return log;
}

const readButton = (page: Page) => page.getByRole('button', { name: '이어서 읽기' });

// 2026-11-06 모바일 설계 — 휴대폰에는 작품 페이지가 없다. 작품 주소(/books/:id)를 열면 곧장 그 책의
// 브리핑으로 간다(MobileBookRedirect, 로그인 시점 조사 2026-11-18). 그래서 휴대폰 작품 페이지의
// 고정 읽기 버튼·목차 배치 시험은 PC 작품 페이지 시험(아래)과 브리핑 시험(mobile-briefing.spec)이 맡는다.
test('FR-BRF-001: 작품 주소를 열면 PC는 작품 페이지, 휴대폰은 브리핑이고 진입·진도 요청은 없다', async ({ page }, testInfo) => {
  const log = await installMockApi(page, { totalPages: 200, startPage: 15 });
  await page.goto(BOOK_URL);

  if (testInfo.project.name === 'desktop') {
    await expect(page.getByRole('heading', { level: 1, name: '탁류' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/books/${BOOK_ID}$`));
  } else {
    await expect(page).toHaveURL(new RegExp(`/books/${BOOK_ID}/briefing$`));
    await expect(page.getByTestId('mobile-briefing')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: '탁류' })).toHaveCount(0);
  }
  expect(log.entries).toBe(0);
  expect(log.progress).toEqual([]);
});

test('FR-BRF-001: PC 작품 페이지의 읽기 버튼은 표지 아래에 있고 누르면 브리핑으로 간다', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '데스크톱 프로젝트에서만');
  const log = await open(page, { entryRoute: 'briefing' });

  const title = await page.getByRole('heading', { level: 1, name: '탁류' }).boundingBox();
  const button = await readButton(page).boundingBox();
  expect(button!.y).toBeGreaterThan(title!.y + title!.height);
  expect(await readButton(page).locator('..').evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
  expect(await noHorizontalScroll(page)).toBe(true);

  await readButton(page).click();

  await expect(page).toHaveURL(new RegExp(`/books/${BOOK_ID}/briefing$`));
  expect(log.entries).toBe(1);
  expect(log.progress).toEqual([]);
});
