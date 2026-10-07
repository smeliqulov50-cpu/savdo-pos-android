const CACHE_NAME = 'sardor-pos-v1791406327328';
const CORE_ASSETS = ['./manifest.json', './icon-192.png', './icon-512.png'];

// --- Firebase Cloud Messaging (background push) ------------------------
// This lets a push notification show up even when the app/tab is fully
// closed, as long as the OS/browser has this service worker registered
// (it already is, via navigator.serviceWorker.register('./sw.js') in
// index.html). If loading the Firebase scripts fails (e.g. offline at
// install time), the rest of the service worker — caching, offline
// support — still works fine; only push is affected.
try{
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: "AIzaSyC-bVU6F68d_kZJ6PforUphA2m7COtn2QY",
    authDomain: "sardor-pos.firebaseapp.com",
    projectId: "sardor-pos",
    storageBucket: "sardor-pos.firebasestorage.app",
    messagingSenderId: "111665947161",
    appId: "1:111665947161:web:9027b84e9e07e9c2364088"
  });
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload)=>{
    const title = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || 'Savdo Pos';
    const body = (payload.notification && payload.notification.body) || (payload.data && payload.data.body) || '';
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      tag: 'savdo-pos-push-' + Date.now(),
      data: { url: './' }
    });
  });
}catch(e){ /* messaging unsupported in this context — caching still works */ }

self.addEventListener('notificationclick', (event)=>{
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type:'window', includeUncontrolled:true}).then((list)=>{
      for(const client of list){ if('focus' in client) return client.focus(); }
      if(self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // The main HTML document is never cached — always fetch it fresh so
  // updates are visible immediately, with no stale-app risk. `cache:
  // 'no-store'` additionally bypasses the browser's own HTTP cache layer
  // entirely (not just this service worker's Cache Storage) — without it,
  // a normal fetch() here can still be silently satisfied from the
  // browser's disk cache even though this handler "intends" to always go
  // to the network, which is exactly what let an already-deployed fix
  // stay invisible on a device after a fresh Netlify upload.
  if (event.request.mode === 'navigate' || event.request.url.endsWith('/index.html')) {
    event.respondWith(fetch(event.request, {cache: 'no-store'}));
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
