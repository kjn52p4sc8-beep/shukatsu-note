import { useState, type FormEvent } from 'react';
import { googleLoginEnabled, sendPasswordReset, signIn, signInWithGoogle, signUp } from '../data/auth';

type Mode = 'signin' | 'signup' | 'reset';

/** ログイン・新規登録・パスワード再設定の画面 */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setNotice('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    const mail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(mail)) return setError('メールアドレスを入力してください。');
    if (mode !== 'reset' && password.length < 8) return setError('パスワードは8文字以上で入力してください。');
    setBusy(true);
    try {
      if (mode === 'signin') await signIn(mail, password);
      else if (mode === 'signup') {
        if ((await signUp(mail, password)) === 'confirm') {
          setNotice('確認メールを送りました。メールの中のリンクを開くと登録が完了します。');
          setPassword('');
        }
      } else {
        await sendPasswordReset(mail);
        setNotice('パスワード再設定のメールを送りました。メールの中のリンクを開いてください。');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'うまくいきませんでした。');
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError('');
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'うまくいきませんでした。');
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-hero">
        <img src="icon-192.png" alt="" width="64" height="64" />
        <h1>就活しめきりボード</h1>
        <p>複数の就活サイトのエントリーと締切を1画面で。スマホでもPCでも同じデータを見られて、締切前には通知でお知らせします。</p>
      </div>

      <div className="auth-card">
        {mode !== 'reset' && (
          <div className="tabs" role="tablist" aria-label="ログインまたは新規登録">
            <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => switchMode('signin')}>
              ログイン
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => switchMode('signup')}>
              はじめての方
            </button>
          </div>
        )}
        {mode === 'reset' && <h2 className="auth-title">パスワードを再設定</h2>}

        <form className="form" onSubmit={submit} noValidate>
          <div className="fg">
            <label htmlFor="a-email">メールアドレス</label>
            <input
              className="field" id="a-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
              value={email} onChange={(e) => setEmail(e.target.value)} required
            />
          </div>
          {mode !== 'reset' && (
            <div className="fg">
              <label htmlFor="a-password">パスワード{mode === 'signup' ? '（8文字以上）' : ''}</label>
              <input
                className="field" id="a-password" type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
              />
            </div>
          )}
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="ok" role="status">
              {notice}
            </p>
          )}
          <button className="btn primary big" type="submit" disabled={busy}>
            {busy ? '送信中…' : mode === 'signin' ? 'ログイン' : mode === 'signup' ? '登録して始める' : '再設定メールを送る'}
          </button>
        </form>

        {mode === 'signin' && (
          <button className="link" type="button" onClick={() => switchMode('reset')}>
            パスワードを忘れた
          </button>
        )}
        {mode === 'reset' && (
          <button className="link" type="button" onClick={() => switchMode('signin')}>
            ログインに戻る
          </button>
        )}

        {googleLoginEnabled && mode !== 'reset' && (
          <>
            <div className="or">または</div>
            <button className="btn big" type="button" onClick={google} disabled={busy}>
              Googleでログイン
            </button>
          </>
        )}
      </div>

      <p className="foot">
        登録した内容は、ログインした本人だけが見られます。就活サイトのIDやパスワードは保存しません。
      </p>
    </main>
  );
}
