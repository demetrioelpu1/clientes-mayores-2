/* offline-tilelayer.js — L.TileLayer que sirve tiles desde IndexedDB primero,
   y si no existen los descarga de la red y los guarda para uso futuro sin internet. */

const TRANSPARENT_PNG =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';

L.TileLayer.Offline = L.TileLayer.extend({
  createTile: function (coords, done) {
    const tile = document.createElement('img');

    L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
    L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));

    if (this.options.crossOrigin || this.options.crossOrigin === '') {
      tile.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
    }
    tile.alt = '';

    const url = this.getTileUrl(coords);
    const key = MapDB.tileKey(this.options.layerId, coords.z, coords.x, coords.y);

    this._loadTile(key, url, tile);
    return tile;
  },

  _loadTile: async function (key, url, tile) {
    try {
      const cached = await MapDB.getTile(key);
      if (cached) {
        tile.src = URL.createObjectURL(cached);
        tile.dataset.fromCache = 'true';
        return;
      }
    } catch (e) {
      /* IndexedDB no disponible: seguimos con la red */
    }

    if (!navigator.onLine) {
      tile.src = TRANSPARENT_PNG;
      tile.dataset.offlineMissing = 'true';
      return;
    }

    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      tile.src = URL.createObjectURL(blob);
      MapDB.putTile(key, blob).catch(() => {});
    } catch (e) {
      tile.src = TRANSPARENT_PNG;
      tile.dataset.offlineMissing = 'true';
    }
  },
});

L.tileLayer.offline = function (url, options) {
  return new L.TileLayer.Offline(url, options);
};
