import { EMBEDDED } from '../data/config';
import { isIOS, isStandalone } from '../push/push';

/**
 * ファイルとして保存する。保存できなかった場合は false を返す
 * （呼び出し側で内容をコピーできる画面を出す）。
 */
export async function saveFile(filename: string, text: string, mime: string): Promise<boolean> {
  // 埋め込み先ではダウンロードが止められているので、内容をコピーする画面に任せる
  if (EMBEDDED) return false;
  try {
    // ホーム画面から開いた iPhone ではダウンロードができないため、共有シート経由で渡す
    if (isIOS() && isStandalone() && typeof navigator.canShare === 'function') {
      const file = new File([text], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return true;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return true;
        }
      }
    }
    const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  } catch {
    return false;
  }
}

export const fileSafe = (s: string) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);

/** Excel/Wordなどのバイナリ形式は、実ファイルとして共有・保存する。 */
export async function saveBinary(filename: string, blob: Blob): Promise<void> {
  if (EMBEDDED) throw new Error('この埋め込み画面では保存できません。公開アプリで開いて書き出してください。');
  const file = new File([blob], filename, { type: blob.type });
  if (isIOS() && isStandalone() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e instanceof DOMException && e.name === 'AbortError') throw new Error('共有をキャンセルしました。'); }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
