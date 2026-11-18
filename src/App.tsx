import { useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { BoardScreen } from './components/BoardScreen';
import { useAuth, type AuthUser } from './data/auth';
import { cloudEnabled } from './data/config';
import { supabaseRemote } from './data/remote';
import { Store } from './data/store';
import { supabase } from './data/supabase';
import { refreshPushRegistration } from './push/push';

// localStorage 自体へのアクセスが拒否される環境でも、Store 内で失敗を扱う。
const browserStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
  removeItem: (key: string) => window.localStorage.removeItem(key),
};

const LOCAL_KEY = 'shimekiri:data:local';
const userKey = (id: string) => 'shimekiri:data:' + id;

/** 利用者ごとの Store を用意し、通信が戻ったときなどに自動で同期する */
function useStore(user: AuthUser | null): Store | null {
  const userId = user?.id ?? null;
  const [store, setStore] = useState<Store | null>(null);

  useEffect(() => {
    if (cloudEnabled && !userId) return;
    const key = userId ? userKey(userId) : LOCAL_KEY;
    const s = new Store(browserStorage, key, userId && supabase ? supabaseRemote(supabase) : null, Date.now, () => navigator.onLine);
    setStore(s);

    const syncNow = () => s.scheduleSync(0);
    const onVisible = () => {
      if (!document.hidden) syncNow();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) s.reloadFromStorage();
    };
    syncNow();
    const iv = setInterval(onVisible, 60000);
    window.addEventListener('online', syncNow);
    window.addEventListener('offline', syncNow);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onStorage);
    if (userId) void refreshPushRegistration();

    return () => {
      clearInterval(iv);
      window.removeEventListener('online', syncNow);
      window.removeEventListener('offline', syncNow);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
      s.dispose();
      setStore(null);
    };
  }, [userId]);

  return store;
}

function CloudApp() {
  const auth = useAuth();
  const user = auth.status === 'signedIn' ? auth.user : null;
  const store = useStore(user);

  if (auth.status === 'signedOut') return <AuthScreen />;
  if (auth.status === 'loading' || !user || !store || store.key !== userKey(user.id)) return <div className="splash" aria-busy="true" aria-label="読み込み中" />;
  return <BoardScreen key={user.id} store={store} user={user} recovery={auth.recovery} />;
}

function LocalApp() {
  const store = useStore(null);
  if (!store) return null;
  return <BoardScreen store={store} user={null} />;
}

export function App() {
  return cloudEnabled ? <CloudApp /> : <LocalApp />;
}
