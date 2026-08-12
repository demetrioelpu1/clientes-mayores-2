/* db.js — capa de acceso a IndexedDB para tiles de mapa y recortes (packs) offline */

const DB_NAME = 'catastro-map-db';
const DB_VERSION = 1;
const STORE_TILES = 'tiles';
const STORE_PACKS = 'packs';

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

/* Elimina todos los tiles pertenecientes a un pack (recorre su rango de tiles) */
async function deletePackTiles(pack, onProgress) {
  let done = 0;
  for (const layerId of pack.layers) {
    for (let z = pack.minZoom; z <= pack.maxZoom; z++) {
      const range = tileRangeForBoundsAtZoom(pack.bounds, z);
      for (let x = range.minX; x <= range.maxX; x++) {
        for (let y = range.minY; y <= range.maxY; y++) {
          await deleteTile(tileKey(layerId, z, x, y));
          done++;
          if (onProgress) onProgress(done);
        }
      }
    }
  }
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
  tileRangeForBoundsAtZoom,
  countTilesForPackSpec,
};
