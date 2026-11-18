import { useState, type FormEvent } from 'react';
import { updatePassword } from '../data/auth';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/toast';

interface Props {
  /** メールの再設定リンクから開いたとき（閉じずに必ず設定してもらう） */
  recovery?: boolean;
  onClose: () => void;
}

export function PasswordDialog({ recovery, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('パスワードは8文字以上で入力してください。');
    setBusy(true);
    setError('');
    try {
      await updatePassword(password);
      toast('パスワードを変更しました');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'うまくいきませんでした。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={recovery ? '新しいパスワードを設定' : 'パスワードを変更'} onClose={onClose} keepOnBackdrop>
      <form className="form" onSubmit={submit} noValidate>
        <div className="fg">
          <label htmlFor="p-new">新しいパスワード（8文字以上）</label>
          <input
            className="field" id="p-new" type="password" autoComplete="new-password" minLength={8}
            value={password} onChange={(e) => setPassword(e.target.value)} autoFocus
          />
        </div>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? '変更中…' : '変更する'}
        </button>
      </form>
    </Modal>
  );
}
