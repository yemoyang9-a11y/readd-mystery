import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// PR 검증용: 외부 DB·AI 키와 OS별 스크린샷 기준 파일에 의존하지 않는다.
const launchOptions = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
  : {};
export default defineConfig(base, {
  testMatch: '**/quality.smoke.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  use: { ...base.use, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'iphone-se', use: { ...devices['iPhone SE'], browserName: 'chromium' } },
    { name: 'iphone-pro-max', use: { ...devices['iPhone 15 Pro Max'], browserName: 'chromium' } },
  ],
});
