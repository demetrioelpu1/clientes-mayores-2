/* sw.js — cachea el "app shell" (HTML/CSS/JS/íconos) para que la app cargue sin internet.
   Los tiles del mapa NO se cachean aquí: eso lo maneja IndexedDB desde app.js/db.js,
   para poder gestionarlos como "recortes" independientes con nombre, borrado, etc. */

const CACHE_NAME = 'catastro-app-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './css/leaflet.css',
  './css/images/layers.png',
  './css/images/layers-2x.png',
  './css/images/marker-icon.png',
  './css/images/marker-icon-2x.png',
  './css/images/marker-shadow.png',
  './js/app.js',
  './js/db.js',
  './js/offline-tilelayer.js',
  './js/vendor/leaflet.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Solo gestionamos peticiones GET del mismo origen (el app shell).
  // Los tiles de OSM/Esri son cross-origin y los maneja IndexedDB desde app.js.
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => cached);
      // cache-first: responde rápido con lo guardado si existe, y refresca en segundo plano
      return cached || network;
    })
  );
});
