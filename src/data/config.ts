// ビルド時に .env から読み込む設定。どれも公開してよい値（秘密の鍵は入れない）。
const env = import.meta.env;

export const SUPABASE_URL: string = (env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_KEY: string = (env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
export const VAPID_PUBLIC_KEY: string = (env.VITE_VAPID_PUBLIC_KEY ?? '').trim();
export const GOOGLE_LOGIN: boolean = String(env.VITE_AUTH_GOOGLE ?? '') === 'true';

/** claude.ai のページの中など、ファイル保存やオフライン機能が使えない場所に埋め込むビルド */
export const EMBEDDED: boolean = String(env.VITE_EMBED ?? '') === 'true';

/** Supabase の接続先が設定されていればクラウド同期あり。なければこの端末だけに保存する。 */
export const cloudEnabled = SUPABASE_URL !== '' && SUPABASE_KEY !== '';
