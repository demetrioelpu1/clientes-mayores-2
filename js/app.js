/* app.js — lógica principal: mapa, capas, descarga offline, geolocalización */

(() => {
  'use strict';

  /* ============ Configuración de capas base ============ */
  const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ESRI_SAT_URL =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const ESRI_LABELS_URL =
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

  const DEFAULT_CENTER = [-15.8402, -70.0219]; // Puno, Perú (referencia de la captura)
  const DEFAULT_ZOOM = 17;

  /* ============ Mapa ============ */
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    maxZoom: 19,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // el zoom control queda oculto detrás de la barra de coordenadas; lo movemos un poco
  document.querySelector('.leaflet-bottom.leaflet-right').style.marginBottom = '84px';

  const osmLayer = L.tileLayer.offline(OSM_URL, {
    layerId: 'osm',
    maxZoom: 19,
    subdomains: 'abc',
    crossOrigin: true,
    attribution: '&copy; OpenStreetMap contributors',
  });

  const satLayer = L.tileLayer.offline(ESRI_SAT_URL, {
    layerId: 'sat',
    maxZoom: 19,
    crossOrigin: true,
    attribution: 'Tiles &copy; Esri',
  });

  const labelsLayer = L.tileLayer.offline(ESRI_LABELS_URL, {
    layerId: 'labels',
    maxZoom: 19,
    crossOrigin: true,
    attribution: 'Esri',
  });

  let currentLayerKey = localStorage.getItem('catastro:lastLayer') || 'osm';

  function setBaseLayer(key) {
    [osmLayer, satLayer, labelsLayer].forEach((l) => map.removeLayer(l));
    if (key === 'osm') {
      osmLayer.addTo(map);
    } else if (key === 'sat') {
      satLayer.addTo(map);
    } else if (key === 'hybrid') {
      satLayer.addTo(map);
      labelsLayer.addTo(map);
    }
    currentLayerKey = key;
    localStorage.setItem('catastro:lastLayer', key);
    document.querySelectorAll('.layer-option').forEach((el) => {
      el.classList.toggle('selected', el.dataset.layer === key);
    });
  }
  setBaseLayer(currentLayerKey);

  /* ============ Utilidades UI ============ */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let toastTimer = null;
  function showToast(msg, duration = 2200) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), duration);
  }

  function openSheet(id) {
    $(id).classList.add('visible');
  }
  function closeSheet(id) {
    $(id).classList.remove('visible');
  }
  $$('.sheet-overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) ov.classList.remove('visible');
    });
  });
  $$('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeSheet('#' + btn.dataset.close));
  });

  /* ============ Panel de capas ============ */
  $('#btn-layers').addEventListener('click', () => openSheet('#overlay-layers'));
  $$('.layer-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      setBaseLayer(opt.dataset.layer);
      closeSheet('#overlay-layers');
    });
  });

  /* ============ Estado de conexión ============ */
  function updateConnectionStatus() {
    const subtitle = $('#subtitle-text');
    if (navigator.onLine) {
      subtitle.textContent = 'Módulo 01 · Mapa de campo';
      subtitle.style.color = '';
    } else {
      subtitle.textContent = 'Sin conexión · usando mapas descargados';
      subtitle.style.color = '#f5822a';
    }
  }
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  updateConnectionStatus();

  /* ============ Selección de área para descarga offline ============ */
  let selectMode = false;
  let selectPoints = [];
  let selectRect = null;
  let selectedBounds = null; // {north, south, east, west}

  function boundsFromLeaflet(llBounds) {
    return {
      north: llBounds.getNorth(),
      south: llBounds.getSouth(),
      east: llBounds.getEast(),
      west: llBounds.getWest(),
    };
  }

  function startSelectMode() {
    selectMode = true;
    selectPoints = [];
    if (selectRect) { map.removeLayer(selectRect); selectRect = null; }
    $('#select-toolbar').classList.add('visible');
    $('#select-hint').textContent = 'Toca dos puntos en el mapa para marcar el área (esquina 1 de 2).';
    $('#select-confirm').disabled = true;
    map.getContainer().style.cursor = 'crosshair';
  }

  function stopSelectMode() {
    selectMode = false;
    $('#select-toolbar').classList.remove('visible');
    map.getContainer().style.cursor = '';
  }

  function drawSelectRect() {
    if (selectRect) map.removeLayer(selectRect);
    if (selectPoints.length === 2) {
      selectRect = L.rectangle(L.latLngBounds(selectPoints[0], selectPoints[1]), {
        color: '#f5822a',
        weight: 2,
        fillOpacity: 0.12,
      }).addTo(map);
    }
  }

  map.on('click', (e) => {
    if (!selectMode) return;
    if (selectPoints.length >= 2) selectPoints = [];
    selectPoints.push(e.latlng);
    drawSelectRect();
    if (selectPoints.length === 1) {
      $('#select-hint').textContent = 'Ahora toca la esquina opuesta (esquina 2 de 2).';
    } else {
      $('#select-hint').textContent = 'Área marcada. Puedes tocar de nuevo para rehacerla, o continuar.';
      $('#select-confirm').disabled = false;
    }
  });

  $('#btn-download').addEventListener('click', () => startSelectMode());
  $('#select-cancel').addEventListener('click', () => {
    stopSelectMode();
    if (selectRect) { map.removeLayer(selectRect); selectRect = null; }
  });
  $('#select-use-view').addEventListener('click', () => {
    selectedBounds = boundsFromLeaflet(map.getBounds());
    if (selectRect) map.removeLayer(selectRect);
    selectRect = L.rectangle(map.getBounds(), { color: '#f5822a', weight: 2, fillOpacity: 0.12 }).addTo(map);
    openDownloadSheet();
  });
  $('#select-confirm').addEventListener('click', () => {
    if (selectPoints.length !== 2) return;
    selectedBounds = boundsFromLeaflet(L.latLngBounds(selectPoints[0], selectPoints[1]));
    openDownloadSheet();
  });

  function openDownloadSheet() {
    stopSelectMode();
    $('#download-step-form').style.display = '';
    $('#download-step-progress').style.display = 'none';
    updateEstimate();
    openSheet('#overlay-download');
  }

  /* ============ Formulario de descarga ============ */
  function getSelectedLayers() {
    return $('#pack-layers').value.split(',');
  }
  function getZoomRange() {
    let min = parseInt($('#pack-zoom-min').value, 10);
    let max = parseInt($('#pack-zoom-max').value, 10);
    if (isNaN(min)) min = 13;
    if (isNaN(max)) max = 17;
    min = Math.max(0, Math.min(19, min));
    max = Math.max(0, Math.min(19, max));
    if (max < min) max = min;
    return { min, max };
  }

  function updateEstimate() {
    const label = $('#pack-estimate');
    if (!selectedBounds) {
      label.textContent = 'Selecciona un área en el mapa primero.';
      return;
    }
    const layers = getSelectedLayers();
    const { min, max } = getZoomRange();
    const count = MapDB.countTilesForPackSpec(selectedBounds, min, max, layers.length);
    const approxMB = ((count * 18) / 1024).toFixed(1); // ~18KB promedio por tile
    label.textContent = `≈ ${count.toLocaleString('es-PE')} tiles · ~${approxMB} MB`;
  }
  ['#pack-layers', '#pack-zoom-min', '#pack-zoom-max'].forEach((sel) => {
    $(sel).addEventListener('input', updateEstimate);
    $(sel).addEventListener('change', updateEstimate);
  });

  let downloadCancelled = false;

  $('#pack-start-btn').addEventListener('click', async () => {
    if (!selectedBounds) { showToast('Primero selecciona un área en el mapa'); return; }
    const name = $('#pack-name').value.trim() || `Recorte ${new Date().toLocaleDateString('es-PE')}`;
    const layers = getSelectedLayers();
    const { min, max } = getZoomRange();
    const totalTiles = MapDB.countTilesForPackSpec(selectedBounds, min, max, layers.length);

    if (totalTiles > 20000) {
      showToast('Área/zoom demasiado grandes (máx. 20,000 tiles). Reduce el área o el rango de zoom.', 3500);
      return;
    }

    downloadCancelled = false;
    $('#download-step-form').style.display = 'none';
    $('#download-step-progress').style.display = '';
    $('#progress-fill').style.width = '0%';
    $('#progress-label').textContent = `Descargando 0 / ${totalTiles} tiles…`;

    let done = 0;
    const CONCURRENCY = 6;

    async function fetchAndStore(layerId, z, x, y, url) {
      if (downloadCancelled) return;
      const key = MapDB.tileKey(layerId, z, x, y);
      try {
        const existing = await MapDB.getTile(key);
        if (!existing) {
          const resp = await fetch(url, { mode: 'cors' });
          if (resp.ok) {
            const blob = await resp.blob();
            await MapDB.putTile(key, blob);
          }
        }
      } catch (e) {
        /* tile no disponible (sin red o fuera de cobertura); se omite */
      }
      done++;
      const pct = Math.round((done / totalTiles) * 100);
      $('#progress-fill').style.width = pct + '%';
      $('#progress-label').textContent = `Descargando ${done} / ${totalTiles} tiles…`;
    }

    function urlFor(layerId, z, x, y) {
      if (layerId === 'osm') {
        const sub = 'abc'[(x + y) % 3];
        return OSM_URL.replace('{s}', sub).replace('{z}', z).replace('{x}', x).replace('{y}', y);
      }
      if (layerId === 'sat') {
        return ESRI_SAT_URL.replace('{z}', z).replace('{y}', y).replace('{x}', x);
      }
      return '';
    }

    // construir la cola de tiles
    const queue = [];
    for (const layerId of layers) {
      for (let z = min; z <= max; z++) {
        const r = MapDB.tileRangeForBoundsAtZoom(selectedBounds, z);
        for (let x = r.minX; x <= r.maxX; x++) {
          for (let y = r.minY; y <= r.maxY; y++) {
            queue.push({ layerId, z, x, y, url: urlFor(layerId, z, x, y) });
          }
        }
      }
    }

    // procesar con concurrencia limitada
    let idx = 0;
    async function worker() {
      while (idx < queue.length && !downloadCancelled) {
        const t = queue[idx++];
        await fetchAndStore(t.layerId, t.z, t.x, t.y, t.url);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    if (downloadCancelled) {
      showToast('Descarga cancelada');
      closeSheet('#overlay-download');
      return;
    }

    const pack = {
      id: 'pack_' + Date.now(),
      name,
      bounds: selectedBounds,
      minZoom: min,
      maxZoom: max,
      layers,
      tileCount: totalTiles,
      createdAt: Date.now(),
    };
    await MapDB.putPack(pack);
    showToast(`"${name}" guardado para uso offline`);
    closeSheet('#overlay-download');
    if (selectRect) { map.removeLayer(selectRect); selectRect = null; }
    selectedBounds = null;
    refreshPacksSummary();
  });

  $('#pack-cancel-btn').addEventListener('click', () => {
    downloadCancelled = true;
  });

  /* ============ Panel de recortes guardados ============ */
  async function refreshPacksSummary() {
    const packs = await MapDB.getPacks();
    $('#packs-count-pill').textContent =
      packs.length === 0 ? 'Sin recortes descargados' : `${packs.length} recorte${packs.length === 1 ? '' : 's'} descargado${packs.length === 1 ? '' : 's'}`;
    const badge = $('#packs-badge');
    if (packs.length > 0) {
      badge.style.display = 'flex';
      badge.textContent = packs.length;
    } else {
      badge.style.display = 'none';
    }
    return packs;
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function layerLabel(layers) {
    const map = { osm: 'OSM', sat: 'Satelital', labels: 'Etiquetas' };
    return layers.map((l) => map[l] || l).join(' + ');
  }

  async function renderPacksList() {
    const packs = await refreshPacksSummary();
    const container = $('#packs-list');
    container.innerHTML = '';
    if (packs.length === 0) {
      container.innerHTML = '<div class="empty-state">Aún no has descargado recortes de mapa.<br/>Usa el botón de descarga (⬇) para guardar zonas de trabajo sin internet.</div>';
      return;
    }
    packs
      .sort((a, b) => b.createdAt - a.createdAt)
      .forEach((pack) => {
        const item = document.createElement('div');
        item.className = 'pack-item';
        item.innerHTML = `
          <div class="pack-name">${pack.name}</div>
          <div class="pack-meta">${layerLabel(pack.layers)} · zoom ${pack.minZoom}-${pack.maxZoom} · ${pack.tileCount.toLocaleString('es-PE')} tiles · ${fmtDate(pack.createdAt)}</div>
          <div class="pack-actions">
            <button class="btn-secondary" data-action="goto">Ir a la zona</button>
            <button class="btn-danger" data-action="delete">Eliminar</button>
          </div>
        `;
        item.querySelector('[data-action="goto"]').addEventListener('click', () => {
          map.fitBounds(L.latLngBounds(
            [pack.bounds.south, pack.bounds.west],
            [pack.bounds.north, pack.bounds.east]
          ));
          closeSheet('#overlay-packs');
        });
        const delBtn = item.querySelector('[data-action="delete"]');
        let confirming = false;
        delBtn.addEventListener('click', async () => {
          if (!confirming) {
            confirming = true;
            delBtn.textContent = '¿Seguro? Toca de nuevo';
            setTimeout(() => { confirming = false; delBtn.textContent = 'Eliminar'; }, 3000);
            return;
          }
          delBtn.textContent = 'Eliminando…';
          await MapDB.deletePackTiles(pack);
          await MapDB.deletePackRecord(pack.id);
          showToast(`"${pack.name}" eliminado`);
          renderPacksList();
        });
        container.appendChild(item);
      });
  }

  $('#btn-packs').addEventListener('click', () => {
    renderPacksList();
    openSheet('#overlay-packs');
  });

  refreshPacksSummary();

  /* ============ Geolocalización (GeolocationService) ============ */
  let watchId = null;
  let following = false;
  let lastPosition = null;
  let posMarker = null;
  let accCircle = null;

  function fmtCoord(v) {
    return v.toFixed(6) + '°';
  }

  function updateBottomBar(coords) {
    $('#val-lat').textContent = fmtCoord(coords.latitude);
    $('#val-lat').classList.remove('stale');
    $('#val-lon').textContent = fmtCoord(coords.longitude);
    $('#val-lon').classList.remove('stale');
    $('#val-acc').textContent = '± ' + Math.round(coords.accuracy) + ' m';
    $('#val-acc').classList.remove('stale');
    if (coords.altitude !== null && coords.altitude !== undefined) {
      $('#val-alt').textContent = Math.round(coords.altitude) + ' m';
    } else {
      $('#val-alt').textContent = 'N/D';
    }
    $('#val-alt').classList.remove('stale');
  }

  function updateMapMarker(lat, lon, accuracy) {
    const latlng = [lat, lon];
    if (!posMarker) {
      posMarker = L.circleMarker(latlng, {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#17d1c8',
        fillOpacity: 1,
      }).addTo(map);
      accCircle = L.circle(latlng, {
        radius: accuracy,
        color: '#17d1c8',
        weight: 1,
        fillColor: '#17d1c8',
        fillOpacity: 0.12,
      }).addTo(map);
    } else {
      posMarker.setLatLng(latlng);
      accCircle.setLatLng(latlng);
      accCircle.setRadius(accuracy);
    }
  }

  function setGpsStatus(state, text) {
    const pill = $('#gps-pill');
    pill.classList.toggle('active', state === 'active');
    $('#gps-status-text').textContent = text;
  }

  function onPosition(pos) {
    lastPosition = pos;
    setGpsStatus('active', 'GPS activo');
    updateBottomBar(pos.coords);
    updateMapMarker(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    if (following) {
      map.setView([pos.coords.latitude, pos.coords.longitude], map.getZoom());
    }
  }

  function onPositionError(err) {
    let msg = 'Error de GPS';
    if (err.code === 1) msg = 'Permiso de ubicación denegado';
    else if (err.code === 2) msg = 'Ubicación no disponible';
    else if (err.code === 3) msg = 'Tiempo de espera agotado';
    setGpsStatus('error', msg);
    showToast(msg, 3000);
  }

  function startWatch() {
    if (!navigator.geolocation) {
      showToast('Este dispositivo no soporta geolocalización');
      return;
    }
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    });
  }

  function stopWatch() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    setGpsStatus('inactive', 'GPS inactivo');
  }

  $('#btn-locate').addEventListener('click', () => {
    if (watchId === null) {
      startWatch();
      following = true;
      $('#btn-locate').classList.add('active');
      showToast('Siguiendo tu ubicación');
    } else if (!following) {
      following = true;
      $('#btn-locate').classList.add('active');
      if (lastPosition) {
        map.setView([lastPosition.coords.latitude, lastPosition.coords.longitude], map.getZoom());
      }
    } else {
      following = false;
      $('#btn-locate').classList.remove('active');
      showToast('Dejaste de seguir tu ubicación (GPS sigue activo)');
    }
  });

  /* ============ Registrar Service Worker ============ */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('No se pudo registrar el Service Worker:', err);
      });
    });
  }
})();
