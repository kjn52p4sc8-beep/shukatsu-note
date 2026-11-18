import { useEffect, useState } from 'react';
import { disablePush, enablePush, isPushEnabled, pushAvailability, sendTestPush } from '../push/push';
import { toast } from '../ui/toast';
import { ReminderChecks } from './Reminders';

interface Props {
  offsets: number[];
  onOffsets: (next: number[]) => void;
}

/** 設定画面の「通知」 */
export function PushSection({ offsets, onOffsets }: Props) {
  const [availability, setAvailability] = useState(pushAvailability);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void isPushEnabled().then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'うまくいきませんでした。');
    } finally {
      setAvailability(pushAvailability());
      setEnabled(await isPushEnabled());
      setBusy(false);
    }
  };

  return (
    <section>
      <h3>締切の通知</h3>
      {availability === 'no-cloud' && (
        <p className="muted">
          アプリを閉じていても届く通知は、ログインして使う版で利用できます。この版では、大事な締切は「カレンダーに追加」でカレンダー側のリマインダーを使ってください。
        </p>
      )}
      {availability === 'not-configured' && (
        <p className="muted">このアプリでは、プッシュ通知をまだ利用できません。カレンダーに追加して通知を設定してください。</p>
      )}
      {availability === 'ios-needs-install' && (
        <p className="muted">
          iPhone・iPad では、このアプリを<b>ホーム画面に追加</b>してから開くと通知を受け取れます（Safari の共有ボタン →「ホーム画面に追加」）。
        </p>
      )}
      {availability === 'unsupported' && <p className="muted">このブラウザはプッシュ通知に対応していません。</p>}

      {(availability === 'ok' || availability === 'blocked') && (
        <>
          <p>
            未提出のまま締切が近づくと、<b>アプリを閉じていても</b>この端末に通知が届きます。通知は端末ごとにオンにしてください。
          </p>
          {availability === 'blocked' && (
            <p className="err">通知がブロックされています。ブラウザ（または端末）のサイト設定から、このアプリの通知を許可してください。</p>
          )}
          <div className="row">
            {enabled ? (
              <>
                <span className="state on">この端末の通知はオンです</span>
                <button className="btn small" type="button" disabled={busy} onClick={() => run(disablePush)}>
                  オフにする
                </button>
                <button
                  className="btn small" type="button" disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const n = await sendTestPush();
                      toast(n > 0 ? 'テスト通知を送りました' : '通知を送れる端末がありませんでした');
                    })
                  }
                >
                  テスト通知を送る
                </button>
              </>
            ) : (
              <button
                className="btn small primary" type="button"
                disabled={busy || enabled === null || availability === 'blocked'}
                onClick={() =>
                  run(async () => {
                    await enablePush();
                    toast('この端末の通知をオンにしました');
                  })
                }
              >
                この端末で通知を受け取る
              </button>
            )}
          </div>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          <div className="fg">
            <span className="lbl">通知するタイミング（締切の…）</span>
            <ReminderChecks value={offsets} onChange={onOffsets} label="通知するタイミング" />
            <span className="hint">
              時刻が未定の締切は、「前日」は前日の朝9時、「3時間前」は当日の21時ごろに届きます。通知は数分ずれることがあります。
            </span>
          </div>
        </>
      )}
    </section>
  );
}
