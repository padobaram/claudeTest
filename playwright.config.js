// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 20_000,
  fullyParallel: true,
  reporter: [['list']],
  webServer: { command: 'node e2e/serve.js', url: 'http://localhost:4173/tomorrow-todo.html', reuseExistingServer: true },
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'off',
    // 알림 권한을 미리 허용해 브라우저 알림 경로까지 검증
    permissions: ['notifications'],
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
