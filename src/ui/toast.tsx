import { useEffect, useState } from 'react';

type Action = { label: string; run: () => void };
type Notice = { msg: string; action?: Action };
let listener: ((notice: Notice) => void) | null = null;

/** 画面下に短いお知らせと、必要なら取り消し操作を出す */
export function toast(msg: string, action?: Action) {
  listener?.({ msg, action });
}

export function ToastHost() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    listener = (n) => {
      setNotice(n);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), n.action ? 8000 : 5000);
    };
    return () => {
      listener = null;
      clearTimeout(timer);
    };
  }, []);
  return (
    <div className="toast" role="status" hidden={!notice}>
      {notice?.msg}
      {notice?.action && (
        <button type="button" onClick={() => { notice.action!.run(); setNotice(null); }}>
          {notice.action.label}
        </button>
      )}
    </div>
  );
}
