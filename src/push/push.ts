import { VAPID_PUBLIC_KEY, cloudEnabled } from '../data/config';
import { supabase } from '../data/supabase';

export type PushAvailability =
  /** 使える */
  | 'ok'
  /** クラウド同期なしのため使えない */
  | 'no-cloud'
  /** サーバー側の通知設定（VAPID鍵）がまだ */
  | 'not-configured'
  /** iPhone / iPad で、ホーム画面に追加していない */
  | 'ios-needs-install'
  /** このブラウザは対応していない */
  | 'unsupported'
  /** 利用者がブラウザの設定で通知をブロックしている */
  | 'blocked';

export const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushAvailability(): PushAvailability {
  if (!cloudEnabled) return 'no-cloud';
  if (!VAPID_PUBLIC_KEY) return 'not-configured';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return isIOS() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return 'ok';
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
  ]);
  if (!reg) throw new Error('アプリの準備ができていません。ページを開き直してからもう一度お試しください。');
  return reg;
}

async function saveSubscription(sub: PushSubscription) {
  const { error } = await supabase!.rpc('register_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: bytesToB64url(sub.getKey('p256dh')),
    p_auth: bytesToB64url(sub.getKey('auth')),
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw new Error('通知先を登録できませんでした。通信状態を確認して、もう一度お試しください。');
}

/** この端末で通知がオンになっているか */
export async function isPushEnabled(): Promise<boolean> {
  if (pushAvailability() !== 'ok' || Notification.permission !== 'granted') return false;
  try {
    const reg = await registration();
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}

/** この端末で通知をオンにする（ブラウザの許可ダイアログが出る） */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? '通知がブロックされています。ブラウザのサイト設定から許可してください。'
        : '通知が許可されませんでした。',
    );
  }
  const reg = await registration();
  const key = b64urlToBytes(VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  // サーバーの鍵が変わっていたら登録し直す
  if (sub && bytesToB64url(sub.options.applicationServerKey) !== bytesToB64url(key.buffer as ArrayBuffer)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
    } catch {
      throw new Error('この端末では通知を登録できませんでした。');
    }
  }
  await saveSubscription(sub);
}

/** この端末の通知をオフにする */
export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

/** アプリを開いたときに、通知先の登録を最新にしておく（宛先が変わることがあるため） */
export async function refreshPushRegistration(): Promise<void> {
  if (pushAvailability() !== 'ok' || Notification.permission !== 'granted') return;
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await saveSubscription(sub);
  } catch {
    // 次に開いたときにやり直す
  }
}

/** 自分の端末にテスト通知を送る。届いた端末の数を返す。 */
export async function sendTestPush(): Promise<number> {
  const { data, error } = await supabase!.functions.invoke('push', { body: { action: 'test' } });
  if (error) throw new Error('テスト通知を送れませんでした。時間をおいてもう一度お試しください。');
  return Number((data as { sent?: number })?.sent ?? 0);
}
