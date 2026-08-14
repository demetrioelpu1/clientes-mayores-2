/* db.js — capa de acceso a IndexedDB para tiles de mapa y recortes (packs) offline */

const DB_NAME = 'catastro-map-db';
const DB_VERSION = 5;
const STORE_TILES = 'tiles';
const STORE_PACKS = 'packs';
const STORE_NETWORK = 'network_features'; // postes, tramos, subestaciones cargados desde KMZ/KML
const STORE_ENCUESTAS = 'encuestas';      // una por cliente mayor (Fase 3)
const STORE_FOTOS = 'fotos';              // Blobs aparte: listar encuestas no debe arrastrar MB
const STORE_PAQUETES = 'paquetes';        // KMZ cargados por alimentador, versionados (Fase 2)
const STORE_RUTA = 'ruta';                // migas numeradas que el técnico deja al recorrer

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(STORE_TILES)) {
        db.createObjectStore(STORE_TILES); // key: "layerId/z/x/y", value: Blob
      }
      if (!db.objectStoreNames.contains(STORE_PACKS)) {
        const store = db.createObjectStore(STORE_PACKS, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORE_NETWORK)) {
        const store = db.createObjectStore(STORE_NETWORK, { keyPath: 'id' });
        store.createIndex('layer', 'layer');
        store.createIndex('setName', 'setName');
      }
      if (!db.objectStoreNames.contains(STORE_ENCUESTAS)) {
        // La clave es el código SED del GIS: una encuesta por cliente mayor.
        const store = db.createObjectStore(STORE_ENCUESTAS, { keyPath: 'sed' });
        store.createIndex('setSlug', 'setSlug');
        store.createIndex('alimentador', 'alimentador');
        store.createIndex('estado', 'estado');
      }
      if (!db.objectStoreNames.contains(STORE_FOTOS)) {
        // key: "<sed>/<bloque>/<idFoto>", value: Blob ya comprimido
        db.createObjectStore(STORE_FOTOS);
      }
      if (!db.objectStoreNames.contains(STORE_PAQUETES)) {
        // Cada KMZ cargado queda como una "carga" con su fecha. No se
        // sobrescribe: la anterior queda archivada hasta que alguien la borre,
        // así se puede saber contra qué versión del GIS se comparó en campo.
        const store = db.createObjectStore(STORE_PAQUETES, { keyPath: 'id' });
        store.createIndex('zona', 'zona');
      }
      if (!db.objectStoreNames.contains(STORE_RUTA)) {
        // Un punto por cada vez que el técnico toca la pantalla mientras
        // recorre. El número solo avanza: si vuelve sobre sus pasos, el punto
        // nuevo lleva el número siguiente, no repite el viejo.
        const store = db.createObjectStore(STORE_RUTA, { keyPath: 'id' });
        store.createIndex('zona', 'zona');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

/* ---- tiles ---- */

function tileKey(layerId, z, x, y) {
  return `${layerId}/${z}/${x}/${y}`;
}

async function putTile(key, blob) {
  const store = await tx(STORE_TILES, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(blob, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getTile(key) {
  const store = await tx(STORE_TILES, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteTile(key) {
  const store = await tx(STORE_TILES, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function countAllTiles() {
  const store = await tx(STORE_TILES, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function estimateStorageUsage() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage, quota };
    } catch (e) {
      return null;
    }
  }
  return null;
}

/* ---- packs (recortes descargados) ---- */

async function putPack(pack) {
  const store = await tx(STORE_PACKS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(pack);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getPacks() {
  const store = await tx(STORE_PACKS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getPack(id) {
  const store = await tx(STORE_PACKS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deletePackRecord(id) {
  const store = await tx(STORE_PACKS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* Devuelve el conjunto (Set) de claves de tile "layerId/z/x/y" que cubre un pack. */
function tileKeysForPack(pack) {
  const keys = new Set();
  for (const layerId of pack.layers) {
    for (let z = pack.minZoom; z <= pack.maxZoom; z++) {
      const range = tileRangeForBoundsAtZoom(pack.bounds, z);
      for (let x = range.minX; x <= range.maxX; x++) {
        for (let y = range.minY; y <= range.maxY; y++) {
          keys.add(tileKey(layerId, z, x, y));
        }
      }
    }
  }
  return keys;
}

/* Elimina los tiles de un pack, SIN borrar los que otro pack todavía necesita
   (dos recortes que se solapan comparten los mismos tiles en el almacenamiento;
   si uno se borra, el otro debe seguir viéndose offline). */
async function deletePackTiles(pack, otherPacks, onProgress) {
  const keepKeys = new Set();
  for (const other of otherPacks || []) {
    if (other.id === pack.id) continue;
    for (const k of tileKeysForPack(other)) keepKeys.add(k);
  }
  const myKeys = tileKeysForPack(pack);
  let done = 0;
  let skipped = 0;
  for (const key of myKeys) {
    if (keepKeys.has(key)) {
      skipped++;
    } else {
      await deleteTile(key);
    }
    done++;
    if (onProgress) onProgress(done, myKeys.size, skipped);
  }
  return { deleted: done - skipped, keptShared: skipped };
}

/* Calcula el rango de tiles (x,y) que cubren unos bounds {north,south,east,west} en un zoom dado */
function tileRangeForBoundsAtZoom(bounds, z) {
  const n = Math.pow(2, z);
  const lon2x = (lon) => Math.floor(((lon + 180) / 360) * n);
  const lat2y = (lat) => {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
    );
  };
  const minX = lon2x(bounds.west);
  const maxX = lon2x(bounds.east);
  const minY = lat2y(bounds.north);
  const maxY = lat2y(bounds.south);
  return { minX, maxX, minY, maxY };
}

function countTilesForPackSpec(bounds, minZoom, maxZoom, layerCount) {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = tileRangeForBoundsAtZoom(bounds, z);
    total += (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
  }
  return total * layerCount;
}

/* ---- network_features (postes, tramos, subestaciones cargados desde KMZ/KML) ---- */

async function addNetworkFeatures(features) {
  const store = await tx(STORE_NETWORK, 'readwrite');
  return new Promise((resolve, reject) => {
    let remaining = features.length;
    if (remaining === 0) return resolve();
    features.forEach((f) => {
      const req = store.put(f);
      req.onsuccess = () => { remaining--; if (remaining === 0) resolve(); };
      req.onerror = () => reject(req.error);
    });
  });
}

async function getAllNetworkFeatures() {
  const store = await tx(STORE_NETWORK, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getNetworkFeaturesByLayer(layer) {
  const store = await tx(STORE_NETWORK, 'readonly');
  return new Promise((resolve, reject) => {
    const idx = store.index('layer');
    const req = idx.getAll(layer);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function countNetworkFeaturesByLayer() {
  const all = await getAllNetworkFeatures();
  const counts = {};
  for (const f of all) counts[f.layer] = (counts[f.layer] || 0) + 1;
  return counts;
}

async function clearAllNetworkFeatures() {
  const store = await tx(STORE_NETWORK, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ---- encuestas (Fase 3) ---- */

async function putEncuesta(encuesta) {
  const store = await tx(STORE_ENCUESTAS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(encuesta);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getEncuesta(sed) {
  const store = await tx(STORE_ENCUESTAS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(sed);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getAllEncuestas() {
  const store = await tx(STORE_ENCUESTAS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* Solo {sed: estado} — para pintar la lista sin traer las encuestas enteras. */
async function getEstadosEncuestas() {
  const todas = await getAllEncuestas();
  const mapa = {};
  todas.forEach((e) => { mapa[e.sed] = e.estado; });
  return mapa;
}

async function deleteEncuesta(sed) {
  const store = await tx(STORE_ENCUESTAS, 'readwrite');
  await new Promise((resolve, reject) => {
    const req = store.delete(sed);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  return deleteFotosDe(sed);
}

/* ---- fotos ---- */

function fotoKey(sed, bloque, idFoto) {
  return `${sed}/${bloque}/${idFoto}`;
}

async function putFoto(key, blob) {
  const store = await tx(STORE_FOTOS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(blob, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getFoto(key) {
  const store = await tx(STORE_FOTOS, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteFoto(key) {
  const store = await tx(STORE_FOTOS, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function listarFotoKeys(sed) {
  const store = await tx(STORE_FOTOS, 'readonly');
  return new Promise((resolve, reject) => {
    const rango = IDBKeyRange.bound(`${sed}/`, `${sed}/￿`);
    const req = store.getAllKeys(rango);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function deleteFotosDe(sed) {
  const keys = await listarFotoKeys(sed);
  for (const k of keys) await deleteFoto(k);
}

/* ---- paquetes de datos del GIS cargados desde KMZ (Fase 2) ---- */

function zonaKey(setSlug, alimentador) {
  return `${setSlug}/${alimentador}`;
}

async function putPaquete(paquete) {
  const store = await tx(STORE_PAQUETES, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(paquete);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getPaquetesDeZona(zona) {
  const store = await tx(STORE_PAQUETES, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.index('zona').getAll(zona);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* ---- ruta: migas numeradas del recorrido del técnico ---- */

async function getRutaDeZona(zona) {
  const store = await tx(STORE_RUTA, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.index('zona').getAll(zona);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.n - b.n));
    req.onerror = () => reject(req.error);
  });
}

/* Los puntos de una toma de datos, indexados por bloque: { trafomix: {...} } */
async function getPuntosDeToma(sed) {
  const store = await tx(STORE_RUTA, 'readonly');
  const todos = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  const mapa = {};
  todos.filter((p) => p.sed === sed).forEach((p) => { mapa[p.bloque] = p; });
  return mapa;
}

async function putPuntoRuta(punto) {
  const store = await tx(STORE_RUTA, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(punto);
    req.onsuccess = () => resolve(punto.id);
    req.onerror = () => reject(req.error);
  });
}

async function deletePuntoRuta(id) {
  const store = await tx(STORE_RUTA, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getTodosLosPaquetes() {
  const store = await tx(STORE_PAQUETES, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* Solo puede haber una carga activa por zona y capa: al activar una, se
   desactivan las demás de esa misma capa. */
async function activarPaquete(id) {
  const store = await tx(STORE_PAQUETES, 'readonly');
  const paquete = await new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!paquete) return;
  const hermanos = await getPaquetesDeZona(paquete.zona);
  for (const p of hermanos) {
    if (p.capa !== paquete.capa) continue;
    const activa = p.id === id;
    if (p.activa !== activa) await putPaquete(Object.assign({}, p, { activa }));
  }
}

async function deletePaquete(id) {
  const store = await tx(STORE_PAQUETES, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

window.MapDB = {
  tileKey,
  putTile,
  getTile,
  deleteTile,
  countAllTiles,
  estimateStorageUsage,
  putPack,
  getPacks,
  getPack,
  deletePackRecord,
  deletePackTiles,
  tileKeysForPack,
  tileRangeForBoundsAtZoom,
  countTilesForPackSpec,
  addNetworkFeatures,
  getAllNetworkFeatures,
  getNetworkFeaturesByLayer,
  countNetworkFeaturesByLayer,
  clearAllNetworkFeatures,
  putEncuesta,
  getEncuesta,
  getAllEncuestas,
  getEstadosEncuestas,
  deleteEncuesta,
  fotoKey,
  putFoto,
  getFoto,
  deleteFoto,
  listarFotoKeys,
  zonaKey,
  putPaquete,
  getPaquetesDeZona,
  getRutaDeZona,
  getPuntosDeToma,
  putPuntoRuta,
  deletePuntoRuta,
  getTodosLosPaquetes,
  activarPaquete,
  deletePaquete,
};
