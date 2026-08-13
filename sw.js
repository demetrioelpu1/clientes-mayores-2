/* sw.js — cachea el "app shell" (HTML/CSS/JS/íconos) para que la app cargue sin internet.
   Los tiles del mapa NO se cachean aquí: eso lo maneja IndexedDB desde app.js/db.js,
   para poder gestionarlos como "recortes" independientes con nombre, borrado, etc. */

const CACHE_NAME = 'catastro-app-shell-v12';
const APP_SHELL = [
  './',
  './index.html',
  './share-kmz.html',
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
  './js/kmz.js',
  './js/network.js',
  './js/campana.js',
  './js/encuesta.js',
  './js/xlsx.js',
  './js/resultados.js',
  // El catálogo es chico y hace falta siempre; los set-*.json se cachean solos
  // la primera vez que se abre esa SET (el fetch de abajo es cache-first).
  './data/catalogo.json',
  './data/encuesta.json',
  './data/alias.json',
  './js/vendor/leaflet.js',
  './js/vendor/fflate.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ---- Base de datos mínima, separada, solo para "entregar" a la app el
   archivo que llega por el botón Compartir de WhatsApp (Web Share Target).
   Es independiente de catastro-map-db para no pelear por la versión del
   esquema entre el Service Worker y la página. ---- */
const SHARE_DB_NAME = 'catastro-share-handoff';
const SHARE_STORE = 'pending';

function openShareDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SHARE_STORE)) {
        req.result.createObjectStore(SHARE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function savePendingShare(name, type, buffer) {
  const db = await openShareDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE, 'readwrite');
    tx.objectStore(SHARE_STORE).put({ name, type, buffer }, 'latest');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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

/* Cuando el usuario comparte un KMZ/KML desde WhatsApp ("Compartir" → esta
   app), el navegador hace un POST a share_target.action (share-kmz.html).
   Lo interceptamos, guardamos el archivo, y redirigimos a la app normal con
   una señal para que abra el flujo de "Confirmar capas" automáticamente. */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (
    url.origin === self.location.origin &&
    event.request.method === 'POST' &&
    url.pathname.endsWith('/share-kmz.html')
  ) {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get('kmzfile');
          if (file && typeof file.arrayBuffer === 'function') {
            const buffer = await file.arrayBuffer();
            await savePendingShare(file.name || 'compartido.kmz', file.type || '', buffer);
            return Response.redirect('./index.html?sharedImport=1', 303);
          }
          return Response.redirect('./index.html', 303);
        } catch (e) {
          return Response.redirect('./index.html', 303);
        }
      })()
    );
    return;
  }

  // Solo gestionamos peticiones GET del mismo origen (el app shell).
  // Los tiles de OSM/Esri son cross-origin y los maneja IndexedDB desde app.js.
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

  /* El código de la app va NETWORK-FIRST y los datos CACHE-FIRST.

     Con cache-first para todo, el celular seguía corriendo la versión anterior
     hasta el segundo refresco: se publicaba una corrección y en campo no se
     notaba. Ahora, habiendo señal, siempre se ejecuta la última versión
     publicada; sin señal, se responde con lo cacheado y la app abre igual.

     Cache-first va SOLO para los paquetes set-*.json: son cientos de KB y no
     cambian entre versiones. El resto de data/ (catalogo, esquema del
     formulario, alias de campos) cambia junto con el código y tiene que
     seguir la misma regla, o la app corre con un esquema viejo. */
  const esPaquete = /\/data\/set-[^/]+\.json$/.test(url.pathname);
  const esCodigo = !esPaquete;

  const guardar = (resp) => {
    if (resp && resp.ok) {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
    }
    return resp;
  };

  if (esCodigo) {
    event.respondWith(
      fetch(event.request)
        .then(guardar)
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const red = fetch(event.request).then(guardar).catch(() => cached);
      return cached || red;
    })
  );
});
