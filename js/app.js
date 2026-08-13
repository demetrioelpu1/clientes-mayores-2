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
  // Sin control de zoom +/- visible: se hace zoom con gestos (pellizcar / doble toque / rueda del mouse).

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

  /* ============ Estado de conexión + SET activa en el subtítulo ============ */
  function currentSetLabel() {
    const set = getActiveSet();
    return set ? `${set} · Red eléctrica` : 'Módulo 01 · Mapa de campo';
  }
  function updateConnectionStatus() {
    const subtitle = $('#subtitle-text');
    if (navigator.onLine) {
      subtitle.textContent = currentSetLabel();
      subtitle.style.color = '';
    } else {
      subtitle.textContent = 'Sin conexión · usando mapas descargados';
      subtitle.style.color = '#f5822a';
    }
  }
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);

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
    $('#select-row-corner2').style.display = 'none';
    $('#select-crosshair').classList.remove('visible');
    $('#select-hint').textContent = 'Toca el mapa para marcar la esquina 1 del área a descargar.';
    $('#select-confirm').disabled = true;
  }

  function stopSelectMode() {
    selectMode = false;
    $('#select-toolbar').classList.remove('visible');
    $('#select-row-corner2').style.display = 'none';
    $('#select-crosshair').classList.remove('visible');
  }

  // Dibuja un rectángulo casi transparente entre la esquina 1 y el punto actual.
  // preview=true → mientras se está buscando la esquina 2 (línea punteada, más transparente).
  // preview=false → área ya fijada (línea sólida).
  function updateLiveRect(latlng, preview) {
    if (selectRect) map.removeLayer(selectRect);
    selectRect = L.rectangle(L.latLngBounds(selectPoints[0], latlng), {
      color: '#f5822a',
      weight: 2,
      fillOpacity: preview ? 0.08 : 0.16,
      dashArray: preview ? '6,6' : null,
      interactive: false,
    }).addTo(map);
  }

  function setCorner1(latlng) {
    selectPoints = [latlng];
    $('#select-hint').textContent = 'Mueve el mapa o toca la esquina opuesta para completar el área.';
    $('#select-row-corner2').style.display = '';
    $('#select-crosshair').classList.add('visible');
    $('#select-confirm').disabled = true;
    updateLiveRect(latlng, true);
  }

  function setCorner2(latlng) {
    selectPoints[1] = latlng;
    updateLiveRect(latlng, false);
    $('#select-hint').textContent = 'Área marcada. Toca el mapa para rehacerla o continúa.';
    $('#select-row-corner2').style.display = 'none';
    $('#select-crosshair').classList.remove('visible');
    $('#select-confirm').disabled = false;
  }

  map.on('click', (e) => {
    if (!selectMode) return;
    if (selectPoints.length !== 1) {
      setCorner1(e.latlng);
    } else {
      setCorner2(e.latlng);
    }
  });

  // Vista previa en vivo del rectángulo: por mouse (desktop) y arrastrando el mapa (táctil).
  map.on('mousemove', (e) => {
    if (selectMode && selectPoints.length === 1) updateLiveRect(e.latlng, true);
  });
  map.on('move', () => {
    if (selectMode && selectPoints.length === 1) updateLiveRect(map.getCenter(), true);
  });

  $('#select-place-corner2').addEventListener('click', () => setCorner2(map.getCenter()));

  $('#btn-download').addEventListener('click', () => startSelectMode());
  $('#select-cancel').addEventListener('click', () => {
    stopSelectMode();
    if (selectRect) { map.removeLayer(selectRect); selectRect = null; }
  });
  $('#select-use-view').addEventListener('click', () => {
    selectedBounds = boundsFromLeaflet(map.getBounds());
    if (selectRect) map.removeLayer(selectRect);
    selectRect = L.rectangle(map.getBounds(), { color: '#f5822a', weight: 2, fillOpacity: 0.16, interactive: false }).addTo(map);
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
    $('#progress-sub').textContent = '';

    let done = 0;
    let newCount = 0; // tiles descargados de la red (no existían)
    let reusedCount = 0; // tiles que ya estaban guardados de un recorte anterior (no se vuelven a bajar)
    let failedCount = 0; // tiles que no se pudieron obtener (sin red / fuera de cobertura)
    const CONCURRENCY = 6;

    // IMPORTANTE: cada tile se identifica por "capa/z/x/y". Si dos recortes se
    // solapan, comparten los MISMOS tiles guardados: no se descargan ni se
    // duplican de nuevo, solo se reutiliza lo que ya está. Aquí solo se baja
    // lo que realmente falta (lo "nuevo" respecto a lo ya descargado).
    async function fetchAndStore(layerId, z, x, y, url) {
      if (downloadCancelled) return;
      const key = MapDB.tileKey(layerId, z, x, y);
      try {
        const existing = await MapDB.getTile(key);
        if (existing) {
          reusedCount++;
        } else {
          const resp = await fetch(url, { mode: 'cors' });
          if (resp.ok) {
            const blob = await resp.blob();
            await MapDB.putTile(key, blob);
            newCount++;
          } else {
            failedCount++;
          }
        }
      } catch (e) {
        failedCount++;
        /* tile no disponible (sin red o fuera de cobertura); se omite */
      }
      done++;
      const pct = Math.round((done / totalTiles) * 100);
      $('#progress-fill').style.width = pct + '%';
      $('#progress-label').textContent = `Descargando ${done} / ${totalTiles} tiles…`;
      $('#progress-sub').textContent = `${newCount} nuevos · ${reusedCount} ya estaban descargados${failedCount ? ` · ${failedCount} no disponibles` : ''}`;
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
      newTiles: newCount,
      reusedTiles: reusedCount,
      createdAt: Date.now(),
    };
    await MapDB.putPack(pack);
    const summary = reusedCount > 0
      ? `"${name}" guardado: ${newCount} tiles nuevos, ${reusedCount} ya los tenías de otro recorte (no se duplicaron).`
      : `"${name}" guardado para uso offline (${newCount} tiles nuevos).`;
    showToast(summary, 4200);
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
        const sharedNote = typeof pack.reusedTiles === 'number' && pack.reusedTiles > 0
          ? ` · ${pack.reusedTiles.toLocaleString('es-PE')} compartidos con otro recorte`
          : '';
        item.innerHTML = `
          <div class="pack-name">${pack.name}</div>
          <div class="pack-meta">${layerLabel(pack.layers)} · zoom ${pack.minZoom}-${pack.maxZoom} · ${pack.tileCount.toLocaleString('es-PE')} tiles · ${fmtDate(pack.createdAt)}${sharedNote}</div>
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
          // No borra tiles que otro recorte todavía necesite (áreas que se solapan).
          const allPacks = await MapDB.getPacks();
          const result = await MapDB.deletePackTiles(pack, allPacks);
          await MapDB.deletePackRecord(pack.id);
          const msg = result.keptShared > 0
            ? `"${pack.name}" eliminado (${result.keptShared} tiles se mantuvieron por estar en otro recorte)`
            : `"${pack.name}" eliminado`;
          showToast(msg, 3500);
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

  function updateLocateButtonVisual() {
    const btn = $('#btn-locate');
    btn.classList.toggle('active', following);
    btn.classList.toggle('tracking-paused', watchId !== null && !following);
  }

  function resetBottomBar() {
    ['#val-lat', '#val-lon', '#val-acc', '#val-alt'].forEach((sel) => {
      $(sel).textContent = '— —';
      $(sel).classList.add('stale');
    });
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
    if (err.code === 1) {
      msg = 'Permiso de ubicación denegado';
      deactivateGps();
    } else if (err.code === 2) {
      msg = 'Ubicación no disponible';
      setGpsStatus('error', msg);
    } else if (err.code === 3) {
      msg = 'Tiempo de espera agotado, reintentando…';
      setGpsStatus('error', msg);
    }
    showToast(msg, 3000);
  }

  function startWatch() {
    if (!navigator.geolocation) {
      showToast('Este dispositivo no soporta geolocalización');
      return false;
    }
    if (watchId !== null) return true;
    watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    });
    return true;
  }

  function stopWatch() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    setGpsStatus('inactive', 'GPS inactivo');
  }

  /* Apaga el GPS por completo: deja de escuchar la posición y quita el marcador del mapa. */
  function deactivateGps() {
    stopWatch();
    following = false;
    if (posMarker) { map.removeLayer(posMarker); posMarker = null; }
    if (accCircle) { map.removeLayer(accCircle); accCircle = null; }
    lastPosition = null;
    resetBottomBar();
    updateLocateButtonVisual();
  }

  /* Toque corto: enciende el GPS y sigue tu ubicación / alterna seguir-no seguir. */
  function toggleLocateFollow() {
    if (watchId === null) {
      const ok = startWatch();
      if (!ok) return;
      following = true;
      updateLocateButtonVisual();
      showToast('GPS activado — siguiendo tu ubicación');
    } else if (!following) {
      following = true;
      updateLocateButtonVisual();
      if (lastPosition) {
        map.setView([lastPosition.coords.latitude, lastPosition.coords.longitude], map.getZoom());
      }
      showToast('Siguiendo tu ubicación');
    } else {
      following = false;
      updateLocateButtonVisual();
      showToast('Dejaste de seguir — mueve el mapa libremente. Mantén presionado para apagar el GPS.', 3200);
    }
  }

  // Al arrastrar el mapa se cancela el "seguir" automáticamente, para no pelear con el usuario.
  map.on('dragstart', () => {
    if (following) {
      following = false;
      updateLocateButtonVisual();
    }
  });

  // Toque corto = alternar seguir. Mantener presionado (~600ms) = apagar el GPS por completo.
  const locateBtn = $('#btn-locate');
  let locatePressTimer = null;
  let locateLongPressFired = false;

  function clearLocatePressTimer() {
    if (locatePressTimer) { clearTimeout(locatePressTimer); locatePressTimer = null; }
  }

  locateBtn.addEventListener('pointerdown', () => {
    locateLongPressFired = false;
    clearLocatePressTimer();
    locatePressTimer = setTimeout(() => {
      locateLongPressFired = true;
      if (watchId !== null) {
        deactivateGps();
        showToast('GPS desactivado');
      }
    }, 600);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) => {
    locateBtn.addEventListener(evt, clearLocatePressTimer);
  });
  locateBtn.addEventListener('click', () => {
    if (locateLongPressFired) { locateLongPressFired = false; return; }
    toggleLocateFollow();
  });

  /* ============ SET de trabajo (Subestación Eléctrica de Transformación) ============ */
  const SET_STORAGE_KEY = 'catastro:activeSet';

  function getActiveSet() {
    return localStorage.getItem(SET_STORAGE_KEY) || '';
  }
  function setActiveSet(name) {
    localStorage.setItem(SET_STORAGE_KEY, name);
  }
  function clearActiveSet() {
    localStorage.removeItem(SET_STORAGE_KEY);
  }

  function showSetStartModal() {
    $('#set-name-input').value = '';
    $('#overlay-set-start').classList.add('visible');
    setTimeout(() => $('#set-name-input').focus(), 50);
  }
  function hideSetStartModal() {
    $('#overlay-set-start').classList.remove('visible');
  }

  $('#set-start-btn').addEventListener('click', () => {
    const name = $('#set-name-input').value.trim();
    if (!name) {
      showToast('Escribe el nombre de la SET para comenzar (ej: SET ANANEA)');
      return;
    }
    setActiveSet(name);
    hideSetStartModal();
    updateConnectionStatus();
    showToast(`Trabajando en «${name}»`);
  });
  $('#set-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#set-start-btn').click();
  });

  $('#btn-set-menu').addEventListener('click', async () => {
    const set = getActiveSet();
    const counts = await MapDB.countNetworkFeaturesByLayer();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    $('#set-menu-current').innerHTML =
      `<strong>${set || '(sin SET activa)'}</strong><br/>${total.toLocaleString('es-PE')} elementos de red cargados`;
    openSheet('#overlay-set-menu');
  });

  $('#set-menu-export-btn').addEventListener('click', () => exportNetworkData());

  (() => {
    let confirming = false;
    $('#set-menu-finish-btn').addEventListener('click', async () => {
      const btn = $('#set-menu-finish-btn');
      if (!confirming) {
        confirming = true;
        btn.textContent = '¿Seguro? Se descargará la info y se limpiará. Toca de nuevo.';
        setTimeout(() => { confirming = false; btn.textContent = 'Terminar esta SET y empezar otra'; }, 4000);
        return;
      }
      confirming = false;
      btn.textContent = 'Terminar esta SET y empezar otra';
      const finishedName = getActiveSet();
      const all = await MapDB.getAllNetworkFeatures();
      if (all.length > 0) {
        await exportNetworkData();
      }
      await MapDB.clearAllNetworkFeatures();
      clearNetworkLayersFromMap();
      refreshNetworkPanel();
      clearActiveSet();
      closeSheet('#overlay-set-menu');
      showToast(`«${finishedName}» finalizada`);
      showSetStartModal();
    });
  })();

  /* ============ Red eléctrica base (postes, tramos, subestaciones) ============ */
  const networkLayerGroups = {};
  NetworkLayers.DEFS.forEach((def) => { networkLayerGroups[def.key] = L.layerGroup(); });

  function layerVisibilityKey(key) { return `catastro:netvis:${key}`; }
  function isLayerVisible(key) {
    const v = localStorage.getItem(layerVisibilityKey(key));
    return v === null ? true : v === '1';
  }
  function setLayerVisible(key, visible) {
    localStorage.setItem(layerVisibilityKey(key), visible ? '1' : '0');
    if (visible) {
      networkLayerGroups[key].addTo(map);
    } else {
      map.removeLayer(networkLayerGroups[key]);
    }
  }
  // aplica la visibilidad guardada al iniciar
  NetworkLayers.DEFS.forEach((def) => {
    if (isLayerVisible(def.key)) networkLayerGroups[def.key].addTo(map);
  });

  function addFeatureToMap(feature) {
    const def = NetworkLayers.defOf(feature.layer);
    if (!def) return;
    const group = networkLayerGroups[feature.layer];
    if (feature.geomType === 'point') {
      const m = L.circleMarker(feature.coords[0], {
        radius: 6, weight: 1.5, color: '#ffffff', fillColor: def.color, fillOpacity: 1,
      });
      if (feature.name) m.bindTooltip(feature.name, { direction: 'top' });
      group.addLayer(m);
    } else {
      const line = L.polyline(feature.coords, { color: def.color, weight: 3, opacity: 0.9 });
      if (feature.name) line.bindTooltip(feature.name, { direction: 'top' });
      group.addLayer(line);
    }
  }

  async function loadAllNetworkFeaturesToMap() {
    Object.values(networkLayerGroups).forEach((g) => g.clearLayers());
    const all = await MapDB.getAllNetworkFeatures();
    all.forEach(addFeatureToMap);
  }

  function clearNetworkLayersFromMap() {
    Object.values(networkLayerGroups).forEach((g) => g.clearLayers());
  }

  async function refreshNetworkPanel() {
    const counts = await MapDB.countNetworkFeaturesByLayer();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const badge = $('#network-badge');
    if (total > 0) {
      badge.style.display = 'flex';
      badge.textContent = total > 999 ? '999+' : total;
    } else {
      badge.style.display = 'none';
    }

    const list = $('#network-layers-list');
    list.innerHTML = '';
    NetworkLayers.DEFS.forEach((def) => {
      const n = counts[def.key] || 0;
      const row = document.createElement('div');
      row.className = 'network-layer-row';
      row.innerHTML = `
        <div class="layer-dot ${def.geom === 'line' ? 'dot-line' : ''}" style="background:${def.color};"></div>
        <div class="layer-info">
          <div class="layer-name">${def.label}</div>
          <div class="layer-count ${n > 0 ? 'has-data' : ''}">${n > 0 ? n.toLocaleString('es-PE') + ' elementos' : 'sin datos'}</div>
        </div>
        <label class="switch">
          <input type="checkbox" data-layer-toggle="${def.key}" ${isLayerVisible(def.key) ? 'checked' : ''} />
          <span class="slider"></span>
        </label>
      `;
      list.appendChild(row);
    });
    list.querySelectorAll('[data-layer-toggle]').forEach((input) => {
      input.addEventListener('change', () => setLayerVisible(input.dataset.layerToggle, input.checked));
    });
  }

  $('#btn-network').addEventListener('click', () => {
    refreshNetworkPanel();
    openSheet('#overlay-network');
  });

  (() => {
    let confirming = false;
    $('#network-clear-btn').addEventListener('click', async () => {
      const btn = $('#network-clear-btn');
      if (!confirming) {
        confirming = true;
        btn.textContent = '¿Seguro? Toca de nuevo para borrar todo';
        setTimeout(() => { confirming = false; btn.textContent = '🗑 Limpiar red cargada'; }, 3500);
        return;
      }
      confirming = false;
      btn.textContent = '🗑 Limpiar red cargada';
      await MapDB.clearAllNetworkFeatures();
      clearNetworkLayersFromMap();
      await refreshNetworkPanel();
      showToast('Red eléctrica limpiada. Lista para cargar otra zona.');
    });
  })();

  /* ---- Importar KMZ/KML ---- */
  let pendingKmzFolders = [];
  let pendingKmzFileName = '';

  $('#network-load-btn').addEventListener('click', () => $('#network-file-input').click());
  $('#network-export-btn').addEventListener('click', () => exportNetworkData());
  $('#network-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo después
    if (file) await handleKmzFile(file);
  });

  async function handleKmzFile(file) {
    showToast('Leyendo archivo…', 1500);
    let parsed;
    try {
      parsed = await KmzParser.parseFile(file);
    } catch (err) {
      showToast('No se pudo leer el archivo: ' + err.message, 4000);
      return;
    }
    if (!parsed.folders.length || parsed.totalCount === 0) {
      showToast('No se encontraron postes, tramos o subestaciones en ese archivo.', 3500);
      return;
    }
    pendingKmzFolders = parsed.folders;
    pendingKmzFileName = file.name;
    renderKmzMapSheet();
  }

  function renderKmzMapSheet() {
    $('#kmz-summary').textContent =
      `«${pendingKmzFileName}»: se encontraron ${pendingKmzFolders.reduce((s, f) => s + f.count, 0)} elementos en ${pendingKmzFolders.length} carpeta${pendingKmzFolders.length === 1 ? '' : 's'}. Confirma a qué capa pertenece cada una:`;

    const list = $('#kmz-folder-list');
    list.innerHTML = '';
    pendingKmzFolders.forEach((folder, idx) => {
      const compatibleDefs = NetworkLayers.DEFS.filter((d) => d.geom === folder.geomType);
      const guess = folder.guess && compatibleDefs.some((d) => d.key === folder.guess) ? folder.guess : (compatibleDefs[0] ? compatibleDefs[0].key : '');
      const options = compatibleDefs
        .map((d) => `<option value="${d.key}" ${d.key === guess ? 'selected' : ''}>${d.label}</option>`)
        .join('');
      const row = document.createElement('div');
      row.className = 'kmz-folder-row';
      row.innerHTML = `
        <div class="folder-name">${folder.name}</div>
        <div class="folder-count">${folder.count} ${folder.geomType === 'point' ? 'punto(s)' : 'línea(s)'}</div>
        <select data-folder-idx="${idx}">
          <option value="">No importar esta carpeta</option>
          ${options}
        </select>
      `;
      list.appendChild(row);
    });
    openSheet('#overlay-kmz-map');
  }

  $('#kmz-import-confirm-btn').addEventListener('click', async () => {
    const selects = $$('#kmz-folder-list select');
    const activeSet = getActiveSet();
    const features = [];
    selects.forEach((sel) => {
      const layerKey = sel.value;
      if (!layerKey) return;
      const folder = pendingKmzFolders[Number(sel.dataset.folderIdx)];
      folder.items.forEach((item) => {
        features.push({
          id: NetworkLayers.makeId(),
          setName: activeSet,
          layer: layerKey,
          geomType: item.geomType,
          coords: item.coords,
          name: item.name,
          sourceFile: pendingKmzFileName,
          importedAt: Date.now(),
        });
      });
    });
    if (features.length === 0) {
      showToast('No seleccionaste ninguna capa para importar.');
      return;
    }
    await MapDB.addNetworkFeatures(features);
    features.forEach(addFeatureToMap);
    await refreshNetworkPanel();
    closeSheet('#overlay-kmz-map');
    showToast(`Se importaron ${features.length.toLocaleString('es-PE')} elementos.`);
    pendingKmzFolders = [];
  });

  /* ---- Exportar datos de la SET actual ---- */
  async function exportNetworkData() {
    const all = await MapDB.getAllNetworkFeatures();
    if (all.length === 0) {
      showToast('No hay datos de red cargados para descargar.');
      return;
    }
    const geojson = {
      type: 'FeatureCollection',
      features: all.map((f) => {
        const def = NetworkLayers.defOf(f.layer);
        const geometry = f.geomType === 'point'
          ? { type: 'Point', coordinates: [f.coords[0][1], f.coords[0][0]] }
          : { type: 'LineString', coordinates: f.coords.map((c) => [c[1], c[0]]) };
        return {
          type: 'Feature',
          geometry,
          properties: {
            name: f.name,
            capa: def ? def.label : f.layer,
            set: f.setName || getActiveSet(),
            archivo_origen: f.sourceFile || '',
            importado: new Date(f.importedAt).toISOString(),
          },
        };
      }),
    };
    const setSlug = (getActiveSet() || 'red').replace(/[^a-z0-9]+/gi, '_');
    const dateSlug = new Date().toISOString().slice(0, 10);
    const filename = `${setSlug}_${dateSlug}.geojson`;
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(`Descargando ${filename} (${all.length.toLocaleString('es-PE')} elementos)`);
  }

  /* ---- Recibe el archivo cuando llega por "Compartir" desde WhatsApp ---- */
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

  async function checkPendingSharedFile() {
    const params = new URLSearchParams(location.search);
    if (params.get('sharedImport') !== '1') return;
    // Limpia el parámetro de la URL para que un refresco no lo vuelva a procesar.
    history.replaceState({}, '', location.pathname);
    try {
      const db = await openShareDB();
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(SHARE_STORE, 'readwrite');
        const store = tx.objectStore(SHARE_STORE);
        const getReq = store.get('latest');
        getReq.onsuccess = () => { resolve(getReq.result || null); store.delete('latest'); };
        getReq.onerror = () => reject(getReq.error);
      });
      if (!record) return;
      const file = new File([record.buffer], record.name, { type: record.type });
      if (!getActiveSet()) {
        // hay que saber en qué SET estamos antes de importar la red
        showToast('Primero indica con qué SET vas a trabajar.', 3000);
        const onStart = async () => {
          $('#set-start-btn').removeEventListener('click', onStart);
          await handleKmzFile(file);
        };
        // se importa apenas el usuario confirme el nombre de la SET
        $('#set-start-btn').addEventListener('click', onStart, { once: true });
      } else {
        await handleKmzFile(file);
      }
    } catch (e) {
      console.warn('No se pudo procesar el archivo compartido:', e);
    }
  }

  /* ============ Inicialización ============ */
  updateConnectionStatus();
  loadAllNetworkFeaturesToMap();
  if (!getActiveSet()) {
    showSetStartModal();
  }
  checkPendingSharedFile();

  /* ============ Registrar Service Worker ============ */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('No se pudo registrar el Service Worker:', err);
      });
    });
  }
})();
