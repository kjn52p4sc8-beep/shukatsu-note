import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 入力途中の内容を失わないよう、背景をタップしても閉じないようにする */
  keepOnBackdrop?: boolean;
  /** 閉じるボタンを出さない（必ず操作してもらう画面） */
  noClose?: boolean;
}

/** 画面に重ねて出すダイアログ。表示している間だけ描画する。 */
export function Modal({ title, onClose, children, keepOnBackdrop, noClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!noClose) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !keepOnBackdrop && !noClose) onClose();
      }}
    >
      <div className="dlg">
        <div className="dlg-head">
          <h2 id={titleId}>{title}</h2>
          {!noClose && (
            <button className="btn small ghost" type="button" onClick={onClose}>
              閉じる
            </button>
          )}
        </div>
        {children}
      </div>
    </dialog>
  );
}
