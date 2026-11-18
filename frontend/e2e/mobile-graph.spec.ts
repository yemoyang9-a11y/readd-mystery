import { expect, test, type Page } from '@playwright/test';
import { BOOK_ID } from './support/fixtures';
import { installMockApi, type ApiLog } from './support/mockApi';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', '모바일 프로젝트에서만');
});

async function openGraph(page: Page): Promise<ApiLog> {
  const log = await installMockApi(page);
  await page.goto(`/books/${BOOK_ID}/read`);
  await expect(page.getByRole('article')).toContainText('15쪽.');
  await expect.poll(() => log.progress.length).toBe(1);
  await page.getByRole('button', { name: /^싸비 (열기|닫기)$/ }).click();
  await expect(page.getByRole('tab', { name: '인물관계도' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('svg[data-graph-canvas]')).toBeVisible();
  return log;
}

async function pointers(page: Page, steps: { id: number; type: string; x: number; y: number }[]) {
  await page.locator('div.touch-none').first().evaluate((el, steps) => {
    for (const s of steps)
      el.dispatchEvent(
        new PointerEvent(s.type, { pointerId: s.id, pointerType: 'touch', isPrimary: s.id === 1, bubbles: true, clientX: s.x, clientY: s.y })
      );
  }, steps);
}

// 2026-11-18 승인 시안 — 배율 % 표시·확대 버튼이 없으므로 확대는 그래프 viewBox 폭이 줄었는지로 본다
const viewBoxWidth = (page: Page) =>
  page.locator('svg[data-graph-canvas]').evaluate((el) => Number(el.getAttribute('viewBox')!.split(' ')[2]));

test('G14: 두 손가락으로 벌리면 그래프가 확대된다', async ({ page }) => {
  await openGraph(page);
  const before = await viewBoxWidth(page);
  const box = (await page.locator('div.touch-none').first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 3;
  await pointers(page, [
    { id: 1, type: 'pointerdown', x: cx - 20, y: cy },
    { id: 2, type: 'pointerdown', x: cx + 20, y: cy },
    { id: 1, type: 'pointermove', x: cx - 40, y: cy },
    { id: 2, type: 'pointermove', x: cx + 40, y: cy },
    { id: 1, type: 'pointerup', x: cx - 40, y: cy },
    { id: 2, type: 'pointerup', x: cx + 40, y: cy },
  ]);
  await expect.poll(() => viewBoxWidth(page)).toBeLessThan(before);
});

test('G14: 한 손가락으로 그래프를 끌어도 페이지 진도 요청이 생기지 않는다', async ({ page }) => {
  const log = await openGraph(page);
  const box = (await page.locator('div.touch-none').first().boundingBox())!;
  const y = box.y + box.height / 3;
  await pointers(page, [
    { id: 1, type: 'pointerdown', x: box.x + box.width * 0.8, y },
    { id: 1, type: 'pointermove', x: box.x + box.width * 0.5, y },
    { id: 1, type: 'pointermove', x: box.x + box.width * 0.2, y },
    { id: 1, type: 'pointerup', x: box.x + box.width * 0.2, y },
  ]);
  await page.waitForTimeout(500);
  expect(log.progress).toEqual([15]);
  await expect(page.getByRole('textbox', { name: '페이지로 이동' })).toHaveValue('15');
});
