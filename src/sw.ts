/// <reference lib="webworker" />
// Service Worker
//  ・アプリ本体をキャッシュして、オフラインでも開けるようにする
//  ・プッシュ通知を受け取って表示する
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// 新しいバージョンは、画面の「更新する」ボタンが押されたら切り替える
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void self.skipWaiting();
});
clientsClaim();

interface PushMessage {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
}

self.addEventListener('push', (event) => {
  let msg: PushMessage = {};
  try {
    msg = event.data ? (event.data.json() as PushMessage) : {};
  } catch {
    msg = { body: event.data ? event.data.text() : '' };
  }
  const scope = self.registration.scope;
  event.waitUntil(
    self.registration.showNotification(msg.title || '就活しめきりボード', {
      body: msg.body || '',
      tag: msg.tag,
      icon: new URL('icon-192.png', scope).href,
      badge: new URL('badge-96.png', scope).href,
      data: { url: new URL(msg.url || './', scope).href },
    }),
  );
});

// 通知をタップしたらアプリを前面に出す
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | null)?.url || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});
