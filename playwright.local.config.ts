import { defineConfig } from '@playwright/test';

// Supabase を使わないブラウザ保存モードの画面テスト。
export default defineConfig({
  testDir: 'tests/local',
  workers: 1,
  use: {
    baseURL: 'http://localhost:4175',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npm run dev -- --port 4175 --strictPort',
    url: 'http://localhost:4175',
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  },
});
