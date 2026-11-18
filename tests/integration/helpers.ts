import { execSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface LocalStack {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

let cached: LocalStack | null = null;
export function stack(): LocalStack {
  cached ??= JSON.parse(execSync('npx supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString()) as LocalStack;
  return cached;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** すべての制限を越えて操作できる管理用クライアント（テストの準備と確認に使う） */
export function admin(): SupabaseClient {
  return createClient(stack().API_URL, stack().SERVICE_ROLE_KEY, noSession);
}

export function anon(): SupabaseClient {
  return createClient(stack().API_URL, stack().ANON_KEY, noSession);
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
}

const created: string[] = [];

/** 新しい利用者を作ってログインした状態のクライアントを返す */
export async function newUser(label = 'user'): Promise<TestUser> {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'test-password-123';
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  return { id: data.user.id, email, password, client: await login(email, password) };
}

/** 同じ利用者で、別の端末としてログインする */
export async function login(email: string, password: string): Promise<SupabaseClient> {
  const client = anon();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

export async function cleanupUsers() {
  for (const id of created.splice(0)) await admin().auth.admin.deleteUser(id);
}
