import { useEffect, useState } from 'react';
import { GOOGLE_LOGIN } from './config';
import { AUTH_STORAGE_KEY, supabase } from './supabase';

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  /** recovery: パスワード再設定のリンクから開いた（新しいパスワードの入力を求める） */
  | { status: 'signedIn'; user: AuthUser; recovery: boolean };

const LAST_USER_KEY = 'shimekiri:last-user';

function readLastUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    const u = raw ? (JSON.parse(raw) as AuthUser) : null;
    return u && typeof u.id === 'string' ? { id: u.id, email: String(u.email ?? '') } : null;
  } catch {
    return null;
  }
}
function writeLastUser(u: AuthUser | null) {
  try {
    if (u) localStorage.setItem(LAST_USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // 保存できなくても続行する
  }
}
function hasStoredSession() {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * ログイン状態を追いかける。
 *
 * オフラインで開いたときはログイン情報の更新ができないが、端末に前回の利用者と
 * ログイン情報が残っていれば、そのままアプリを使えるようにする（同期はつながってから）。
 */
export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>(() => {
    const last = readLastUser();
    return last && hasStoredSession() ? { status: 'signedIn', user: last, recovery: false } : { status: 'loading' };
  });

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const user = { id: session.user.id, email: session.user.email ?? '' };
        writeLastUser(user);
        setState((prev) => ({
          status: 'signedIn',
          user,
          recovery: event === 'PASSWORD_RECOVERY' || (prev.status === 'signedIn' && prev.recovery && event !== 'USER_UPDATED'),
        }));
        return;
      }
      if (event === 'SIGNED_OUT') {
        writeLastUser(null);
        setState({ status: 'signedOut' });
        return;
      }
      // セッションなし。ログイン情報が端末に残っていれば、通信できないだけとみなす
      const last = readLastUser();
      if (last && hasStoredSession()) setState({ status: 'signedIn', user: last, recovery: false });
      else {
        writeLastUser(null);
        setState({ status: 'signedOut' });
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return state;
}

/** 英語のエラーを、利用者に伝わる日本語にする */
export function authErrorText(error: { message?: string; code?: string; status?: number } | null | undefined): string {
  const msg = (error?.message ?? '').toLowerCase();
  const code = error?.code ?? '';
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials'))
    return 'メールアドレスかパスワードが違います。';
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed'))
    return 'メールアドレスの確認がまだです。届いたメールのリンクを開いてください。';
  if (code === 'user_already_exists' || msg.includes('already registered'))
    return 'このメールアドレスはすでに登録されています。ログインしてください。';
  if (code === 'weak_password' || msg.includes('password should be'))
    return 'パスワードは8文字以上にしてください。';
  if (code === 'same_password') return '今と同じパスワードは使えません。';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || error?.status === 429)
    return '短時間に何度も試したため、しばらく使えません。少し待ってからやり直してください。';
  if (code === 'email_address_invalid' || code === 'validation_failed' || msg.includes('invalid email'))
    return 'メールアドレスの形式を確認してください。';
  if (code === 'signup_disabled') return '現在、新しい登録は受け付けていません。';
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed'))
    return '通信できませんでした。電波の状態を確認して、もう一度お試しください。';
  return 'うまくいきませんでした。時間をおいてもう一度お試しください。';
}

/** ログイン後やメールのリンクから戻ってくる先（いま開いているアプリのURL） */
function appUrl() {
  return location.origin + location.pathname;
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase!.auth.signInWithPassword({ email, password });
  if (error) throw new Error(authErrorText(error));
}

/** 戻り値が 'confirm' のときは、確認メールのリンクを開くまでログインできない */
export async function signUp(email: string, password: string): Promise<'signedIn' | 'confirm'> {
  const { data, error } = await supabase!.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
  if (error) throw new Error(authErrorText(error));
  // すでに登録済みのアドレスだと、エラーにならず中身が空の利用者が返ってくる
  if (!data.session && data.user && data.user.identities?.length === 0) {
    throw new Error(authErrorText({ code: 'user_already_exists' }));
  }
  return data.session ? 'signedIn' : 'confirm';
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  if (error) throw new Error(authErrorText(error));
}

export async function updatePassword(password: string) {
  const { error } = await supabase!.auth.updateUser({ password });
  if (error) throw new Error(authErrorText(error));
}

export const googleLoginEnabled = GOOGLE_LOGIN;
export async function signInWithGoogle() {
  const { error } = await supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
  if (error) throw new Error(authErrorText(error));
}

export async function signOut() {
  const { error } = await supabase!.auth.signOut({ scope: 'local' });
  writeLastUser(null);
  if (error) {
    // 通信できないときなどは、この端末のログイン情報を直接消してから開き直す
    // （成功したときはログイン画面に自動で切り替わるので、開き直さない）
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // 消せなくても続行する
    }
    location.reload();
  }
}

export async function deleteAccount() {
  const { error } = await supabase!.rpc('delete_my_account');
  if (error) throw new Error('アカウントを削除できませんでした。通信状態を確認して、もう一度お試しください。');
  await signOut();
}
