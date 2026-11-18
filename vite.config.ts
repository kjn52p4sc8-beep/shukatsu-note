import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 本番ビルドの index.html に Content-Security-Policy を入れる。
 * 読み込めるスクリプトは自分のサイトのものだけ、通信先は自分のサイトと Supabase だけに絞る。
 */
function contentSecurityPolicy(supabaseUrl: string): Plugin {
  let connect = "'self'";
  try {
    const u = new URL(supabaseUrl);
    connect += ` ${u.origin} ${u.origin.replace(/^http/, 'ws')}`;
  } catch {
    // Supabase を使わない（この端末だけに保存する）ビルド
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'shimekiri-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig(({ mode }) => ({
  // 相対パスで出力する（サブフォルダに置いても動くように）
  base: './',
  plugins: [
    react(),
    contentSecurityPolicy(loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL ?? ''),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'badge-96.png'],
      manifest: {
        name: '就活しめきりボード',
        short_name: '就活しめきり',
        description: '複数の就活サイトのエントリーと締切を1画面で管理',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#faf7f2',
        theme_color: '#6f9077',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 700 },
  server: { port: 5173 },
  preview: { port: 4173 },
}));
