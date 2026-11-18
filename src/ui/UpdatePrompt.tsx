import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { EMBEDDED } from '../data/config';

/** Service Worker を登録し、新しいバージョンが出たら「更新する」ボタンを出す */
export function UpdatePrompt() {
  const [update, setUpdate] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (EMBEDDED) return;
    const updateSW = registerSW({
      onNeedRefresh() {
        setUpdate(() => () => void updateSW(true));
      },
    });
  }, []);

  if (!update) return null;
  return (
    <div className="update" role="status">
      <span>新しいバージョンがあります</span>
      <button className="btn small primary" type="button" onClick={update}>
        更新する
      </button>
    </div>
  );
}
