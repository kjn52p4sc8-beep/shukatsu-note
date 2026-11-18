import { defineConfig } from 'vitest/config';

// ローカルの Supabase（npm run supabase:start と supabase functions serve）に対して行うテスト
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
