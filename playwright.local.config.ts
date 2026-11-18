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
    // 実際の端末と同じく、日本語のファイル名を扱える文字設定（UTF-8）でブラウザを起動する
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    },
  },
  webServer: {
    command: 'npm run dev -- --port 4175 --strictPort',
    url: 'http://localhost:4175',
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  },
});
