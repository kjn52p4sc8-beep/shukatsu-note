import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, cloudEnabled } from './config';

/** ログイン情報の保存キー。これが残っていれば「ログインしたまま」と判断できる。 */
export const AUTH_STORAGE_KEY = 'shimekiri-auth';

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
