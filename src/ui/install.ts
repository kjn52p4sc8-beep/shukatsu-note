import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

let promptEvent: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

// Android / PC の Chrome などが「インストールできます」と知らせてきたら覚えておく
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  promptEvent = e as InstallPromptEvent;
  emit();
});
window.addEventListener('appinstalled', () => {
  promptEvent = null;
  emit();
});

/** インストールできる状態なら、インストール画面を出す関数を返す */
export function useInstallPrompt(): (() => void) | null {
  const ev = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => promptEvent,
  );
  if (!ev) return null;
  return () => {
    void ev.prompt();
    promptEvent = null;
    emit();
  };
}
