// Service worker: la interfaz (app shell) carga offline; los datos de
// Firestore siguen necesitando red y NO se interceptan.
const CACHE = 'quini-muestristas-v1';

const APP_SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/main.js',
  'js/state.js',
  'js/utils.js',
  'js/fb.js',
  'js/timers.js',
  'js/auth.js',
  'js/muestrista.js',
  'js/captura.js',
  'js/firma.js',
  'js/admin.js',
  'js/dashboard.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// CDN necesarios para que la app arranque offline (se cachean best-effort)
const CDN_ASSETS = [
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    // Los CDN pueden fallar sin bloquear la instalación
    await Promise.allSettled(CDN_ASSETS.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Firestore / APIs de Google: siempre red, nunca cache
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebaseinstallations.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com')) return;

  // Navegación: red primero (para recibir actualizaciones), cache si falla
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(e.request);
        const cache = await caches.open(CACHE);
        cache.put('index.html', fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match('index.html')) || Response.error();
      }
    })());
    return;
  }

  // Resto (css/js/fuentes/CDN): cache primero, con actualización en segundo plano
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    const fetchAndUpdate = fetch(e.request).then(res => {
      if (res && (res.status === 200 || res.type === 'opaque')) {
        caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return cached || (await fetchAndUpdate) || Response.error();
  })());
});
