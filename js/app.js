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

  /* Botón físico "Atrás" de Android: sin esto, el técnico lo toca esperando
     volver un paso y se le cierra la app entera. Se deja un estado centinela
     en el historial mientras haya un panel abierto; al volver atrás se avisa a
     los módulos y se repone el centinela. */
  const manejadoresAtras = [];

  function ponerCentinela() {
    if (!history.state || !history.state.panelAbierto) {
      history.pushState({ panelAbierto: true }, '');
    }
  }

  window.addEventListener('popstate', () => {
    const manejado = manejadoresAtras.some((fn) => fn());
    if (manejado) history.pushState({ panelAbierto: true }, '');
  });

  function openSheet(id) {
    $(id).classList.add('visible');
    ponerCentinela();
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

  /* ============ Puente para los módulos externos (campana.js) ============
     app.js vive dentro de una IIFE: esto es lo único que se comparte afuera. */
  window.AppBridge = {
    map, showToast, openSheet, closeSheet,
    // fn() debe devolver true si consumió el "atrás"
    registrarAtras: (fn) => manejadoresAtras.push(fn),
  };

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
    // La zona de trabajo la maneja campana.js (Fase 2).
    const zona = window.Campana && Campana.hayZonaActiva() ? Campana.etiquetaActual() : '';
    return zona || 'Elegir zona de trabajo';
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
    // Marcar la ubicación de un equipo se atiende primero: mientras el técnico
    // está marcando, el toque es para eso y nada más debe reaccionar.
    if (window.Ruta && Ruta.marcando()) { Ruta.tocoElMapa(e.latlng); return; }
    if (!selectMode) return;
    if (selectPoints.length !== 1) {
      setCorner1(e.latlng);
    } else {
      setCorner2(e.latlng);
    }
  });

  /* ---- Recorrido: el FAB solo lo muestra u oculta. Los puntos se marcan desde
     el formulario, que es lo único que sabe de qué cliente y de qué equipo es
     cada uno. ---- */
  $('#btn-ruta').addEventListener('click', () => {
    if (!Ruta.cuantos()) {
      showToast('Todavía no hay recorrido. Se marca desde la toma de datos.', 4000);
      return;
    }
    const visible = Ruta.alternarVisible();
    showToast(visible ? 'Recorrido visible' : 'Recorrido oculto', 1500);
  });
  $('#ruta-cancelar').addEventListener('click', () => Ruta.cancelarMarcado());

  Ruta.alCambiarPuntos((n, visible) => {
    const badge = $('#ruta-badge');
    badge.textContent = n;
    badge.style.display = n ? 'flex' : 'none';
    $('#btn-ruta').classList.toggle('active', n > 0 && visible);
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
    // La zona la fija campana.js; el localStorage queda solo como respaldo
    // para lo que se importó a mano por KMZ antes de tener catálogo.
    if (window.Campana && Campana.hayZonaActiva()) return Campana.etiquetaActual();
    return localStorage.getItem(SET_STORAGE_KEY) || '';
  }
  function setActiveSet(name) {
    localStorage.setItem(SET_STORAGE_KEY, name);
  }
  function clearActiveSet() {
    localStorage.removeItem(SET_STORAGE_KEY);
  }

  // La SET ya no se escribe a mano: se elige de la cascada de campana.js.
  function showSetStartModal() {
    if (window.Campana) Campana.abrirSelector();
  }

  // El subtítulo de la barra superior y el botón flotante abren lo mismo:
  // la cascada para cambiar de zona de trabajo.
  $('#btn-set-menu').addEventListener('click', () => {
    if (window.Campana) Campana.abrirSelector();
  });
  $('#btn-campana').addEventListener('click', () => {
    if (window.Campana) Campana.abrirSelector();
  });

  /* El panel "Red eléctrica base" y su flujo de importación por carpetas se
     eliminaron el 14/08/2026. Lo reemplazó la carga por alimentador de
     campana.js, que guarda paquetes versionados por zona y capa.

     El FAB estaba marcado con hidden desde hacía semanas, pero nunca se
     ocultó: .fab define display:flex y eso le gana al atributo. El panel
     siguió accesible y su código llamaba a KmzParser.parseFile(), que dejó de
     existir al reescribir el lector — de ahí el "parseFile is not a function".

     El store network_features de db.js se deja en su lugar: sacarlo obliga a
     migrar la base y no gana nada. */

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

  /* Compartir desde WhatsApp es la vía MÁS confiable en Android: el service
     worker recibe los bytes dentro del POST, así que no hay ningún puntero a un
     proveedor de documentos que pueda vencerse — que es lo que hace fallar al
     selector de archivos con "el teléfono no pudo abrir el archivo".

     Los archivos van a la carga por alimentador, la misma que usa el botón de
     la app. Antes iban al flujo de "Red eléctrica base", que ya no existe. */
  function leerBuzon() {
    return openShareDB().then((db) => new Promise((resolve, reject) => {
      const req = db.transaction(SHARE_STORE, 'readonly').objectStore(SHARE_STORE).get('latest');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
  }

  function vaciarBuzon() {
    return openShareDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readwrite');
      tx.objectStore(SHARE_STORE).delete('latest');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  /* Se revisa SIEMPRE al arrancar, no solo cuando viene ?sharedImport=1. Si el
     técnico compartió los archivos y cerró la app antes de elegir el
     alimentador, el parámetro se pierde pero los archivos siguen en el buzón:
     así se cargan en el próximo arranque en vez de evaporarse. */
  async function checkPendingSharedFile() {
    const recienCompartido = new URLSearchParams(location.search).get('sharedImport') === '1';
    // Limpia el parámetro para que un refresco no repita el aviso.
    if (recienCompartido) history.replaceState({}, '', location.pathname);
    try {
      const registros = await leerBuzon();
      if (!registros) return;

      // Antes se guardaba un solo archivo; ahora una lista. Se acepta el formato
      // viejo por si quedó algo pendiente de una versión anterior.
      const lista = Array.isArray(registros) ? registros : [registros];
      const archivos = lista
        .filter((r) => r && r.buffer)
        .map((r) => new File([r.buffer], r.name, { type: r.type }));
      if (!archivos.length) { await vaciarBuzon(); return; }

      await importarCompartidos(archivos);
    } catch (e) {
      console.warn('No se pudo procesar el archivo compartido:', e);
    }
  }

  /* Los KMZ se cargan dentro de un alimentador. Si el técnico compartió los
     archivos antes de elegir en qué zona trabaja, no hay dónde ponerlos: se
     avisa, se abre la zona de trabajo y se importan apenas la elija.

     El buzón se vacía DESPUÉS de importar, nunca antes: si se vaciara al leer y
     el técnico no llegara a elegir zona, los archivos se perderían en silencio
     y él creería que ya los cargó. */
  async function importarCompartidos(archivos) {
    // Hay que esperar a que campana.js restaure la zona guardada, o siempre
    // parece que no hay ninguna elegida.
    if (window.Campana && Campana.listo) await Campana.listo;

    const cuantos = archivos.length === 1
      ? `«${archivos[0].name}»`
      : `${archivos.length} archivos`;

    const cargar = async () => {
      await Campana.importarArchivos(archivos);
      await vaciarBuzon();
    };

    if (!window.Campana || !Campana.hayZonaElegida()) {
      showToast(`${cuantos} recibido(s). Elegí el alimentador donde cargarlos.`, 8000);
      if (window.Campana) Campana.abrirSelector({ alElegirZona: cargar });
      return;
    }
    showToast(`${cuantos} recibido(s) desde Compartir. Cargando…`, 3000);
    await cargar();
  }

  /* El GPS arranca solo. La barra de abajo existe para mostrar dónde está
     parado el técnico, y antes quedaba vacía hasta que alguien se acordaba de
     tocar el botón — que además está pensado para "seguir mi ubicación", no
     para encender el aparato.

     Arranca SIN seguir: llena las coordenadas y dibuja la posición, pero no
     mueve el mapa solo. Seguir sigue siendo cosa del botón. */
  function encenderGpsAlArrancar() {
    if (!navigator.geolocation) return;
    const ok = startWatch();
    if (ok) {
      following = false;
      updateLocateButtonVisual();
      setGpsStatus('buscando', 'Buscando GPS…');
    }
  }

  /* ============ Inicialización ============ */
  updateConnectionStatus();
  encenderGpsAlArrancar();
  // La zona de trabajo la abre campana.js al iniciar (ver index.html).
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
