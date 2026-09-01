// Service worker: la interfaz (app shell) carga offline; los datos de
// Firestore siguen necesitando red y NO se interceptan.
// v5: catálogo importable desde Excel, exportación a .xlsx y contador de
// pendientes. SheetJS/ExcelJS NO se precachean (pesan ~1 MB cada una): se
// descargan solo cuando Lety usa esas funciones y quedan en cache de runtime.
const CACHE = 'quini-muestristas-v21';

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
  'js/catalogo.js',
  'js/export.js',
  'js/ficha-tecnica.js',
  'js/novedades.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// CDN necesarios para que la app arranque offline (se cachean best-effort)
const CDN_ASSETS = [
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
];

// `cache: 'reload'` obliga a ir a la RED y saltarse el caché del navegador.
// Sin esto, al instalarse una versión nueva se guardaba lo que el navegador
// tuviera guardado de antes (el hosting sirve el JS con max-age=3600), y la
// app se quedaba corriendo código viejo aunque el servidor ya tuviera el
// nuevo. Fue la causa de los "no acepta la ficha" del 2026-08-24.
const desdeLaRed = u => new Request(u, { cache: 'reload' });

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL.map(desdeLaRed));
    // Los CDN pueden fallar sin bloquear la instalación
    await Promise.allSettled(CDN_ASSETS.map(u => cache.add(desdeLaRed(u))));
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

  // El código de la app (nuestro css/js): RED PRIMERO, caché como respaldo.
  // Sin red la app no sirve de todas formas (los datos viven en Firestore),
  // así que la caché aquí es para el arranque offline, no para ahorrar: lo que
  // importa es que una corrección publicada llegue en la siguiente carga y no
  // hasta que al navegador se le venza su propio caché.
  const esCodigoPropio = url.origin === location.origin
    && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.webmanifest'));

  e.respondWith((async () => {
    const guardar = res => {
      if (res && (res.status === 200 || res.type === 'opaque')) {
        caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(() => {});
      }
      return res;
    };
    if (esCodigoPropio) {
      try {
        return guardar(await fetch(e.request));
      } catch (err) {
        return (await caches.match(e.request)) || Response.error();
      }
    }
    // Íconos y librerías de CDN (pesadas y con versión en la URL): caché
    // primero, con actualización en segundo plano.
    const cached = await caches.match(e.request);
    const enRed = fetch(e.request).then(guardar).catch(() => null);
    return cached || (await enRed) || Response.error();
  })());
});
