import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { DONE_BOOK, installMockApi, NOT_READY_BOOK } from './support/mockApi';
import { noHorizontalScroll } from './support/layoutChecks';
import { BOOK_ID } from './support/fixtures';

// 2026-11-17 입체 책 홈(T2 시안 승인) — 휴대폰 홈은 "이번 달 추리소설" 입체 책 무대와 이어 읽기 카드다.
// 신작·장르 표지 줄은 PC 홈에만 있다. 휴대폰 이어 읽기 카드는 브리핑으로 가는 링크다.
const isDesktop = (testInfo: TestInfo) => testInfo.project.name === 'desktop';

async function press(locator: Locator, mobile: boolean) {
  if (mobile) await locator.tap();
  else await locator.click();
}

const continueTarget = (page: Page, testInfo: TestInfo) =>
  isDesktop(testInfo)
    ? page.getByRole('region', { name: '이어 읽기' }).getByRole('button', { name: '이어서 읽기' })
    : page.getByRole('link', { name: /^이어서 읽기, 탁류,/ });

test.beforeEach(async ({ page }, testInfo) => {
  await installMockApi(page);
  await page.goto('/');
  if (isDesktop(testInfo)) await expect(page.getByRole('region', { name: '신작' })).toBeVisible();
  else await expect(page.getByRole('group', { name: '이번 달 추리소설' })).toBeVisible();
});

test('NFR-USE: 홈은 화면 폭을 넘치지 않는다', async ({ page }) => {
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('NFR-USE: 모바일 홈의 입체 책은 넘겨도 화면 폭을 넘치지 않는다', async ({ page }, testInfo) => {
  test.skip(isDesktop(testInfo), '모바일 프로젝트에서만');
  const stage = page.getByRole('group', { name: '이번 달 추리소설' });
  await expect(page.getByText(/^1번째 책, 총 \d+권\./)).toBeAttached();
  await stage.getByRole('button', { name: '다음 책' }).tap();
  await expect(page.getByText(/^2번째 책, 총 \d+권\./)).toBeAttached();
  expect(await noHorizontalScroll(page)).toBe(true);
});

test('NFR-USE: 이어 읽기 버튼이 44px 이상이다', async ({ page }, testInfo) => {
  const box = await continueTarget(page, testInfo).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
});

test('FR-BRW-001: 표지를 누르면 작품 페이지 주소로 이동한다', async ({ page }, testInfo) => {
  if (isDesktop(testInfo)) {
    const link = page.getByRole('region', { name: '신작' }).getByRole('link', { name: '탁류' });
    await press(link, false);
    await expect(page).toHaveURL(new RegExp(`/books/${BOOK_ID}$`));
    return;
  }
  // 휴대폰은 작품 주소가 곧 브리핑이다(MobileBookRedirect) — 입체 책을 누르면 그 책의 브리핑으로 간다
  const cover = page.getByRole('group', { name: '이번 달 추리소설' }).getByRole('button', { name: /작품 보기$/ });
  await press(cover, true);
  await expect(page).toHaveURL(/\/books\/[^/]+\/briefing$/);
});

test('FR-BRW-002 🚦: 홈과 검색 목록에 미검수 도서는 0권이고 검수된 도서는 보인다', async ({ page }, testInfo) => {
  if (isDesktop(testInfo)) {
    await expect(page.getByRole('region', { name: '신작' }).getByRole('link', { name: '탁류' })).toBeVisible();
    await expect(page.getByRole('link', { name: NOT_READY_BOOK.title })).toHaveCount(0);
  } else {
    // 휴대폰 홈에서 목록을 쓰는 곳은 이어 읽기 카드다. 미검수 도서가 가장 최근에 읽은 책이어도 카드에 0번
    await page.route('http://api.e2e.test/books', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          books: [
            { ...DONE_BOOK, book_id: BOOK_ID, title: '탁류', progress: { ...DONE_BOOK.progress!, is_complete: false } },
            {
              ...NOT_READY_BOOK,
              progress: { current_page: 3, percent: 10, is_complete: false, last_read_at: '2026-12-31T00:00:00.000Z' },
            },
          ],
        }),
      })
    );
    await page.reload();
    await expect(page.getByRole('link', { name: /^이어서 읽기, 탁류,/ })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(NOT_READY_BOOK.title) })).toHaveCount(0);
    await expect(page.getByText(NOT_READY_BOOK.title)).toHaveCount(0);
  }

  await page.goto('/search');
  await expect(page.getByRole('link', { name: /탁류/ })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(NOT_READY_BOOK.title) })).toHaveCount(0);
});
