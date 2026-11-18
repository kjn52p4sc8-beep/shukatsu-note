import { defineConfig } from '@playwright/test';
import local from './playwright.local.config';
// 本番ビルドのCSP下でExcel/Wordなどの遅延読込も検証する。
export default defineConfig({
  ...local,
  webServer: {
    command: 'npm run build && npm run preview -- --port 4175 --strictPort',
    url: 'http://localhost:4175',
    timeout: 120000,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  },
});
