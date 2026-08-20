/* sync.js — sube en silencio, apenas hay señal, lo que el técnico ya cargó
   en el aplicativo (datos + fotos) al panel de supervisión. No es un botón
   ni un aviso: corre solo, al abrir la app, al recuperar señal, y en cada
   guardado mientras hay señal. Sin señal, no hace nada — se retoma en la
   próxima conexión, sin reintentos con backoff.

   Como el bookkeeping de "qué ya se subió" (STORE_SYNC_ENCUESTAS/
   STORE_SYNC_FOTOS de db.js) arranca vacío en cada celular, la primera vez
   que corre después de instalar esta versión sube también todo lo que ya
   estaba cargado antes — no hace falta ningún código aparte para eso. */

const Sync = (() => {
  'use strict';

  const URL_BASE = 'https://gis-panel.pwcg-258.workers.dev';
  const API_KEY = '668uDojoDXe6ulto0vNYcoB5ihDxQbeQ';
  const CONCURRENCY = 3; // conexión de campo mala: no competir con el resto de la app

  let corriendo = false;
  let pendienteOtraPasada = false;

  /* El mapa de fotos de un registro es { "bloque/idFoto": true } para una
     foto única, o { "bloque/idFoto": [subId, ...] } para un grupo (mediciones/
     extra/observaciones). Esto lo aplana a una lista de claves relativas al
     cliente: "bloque/idFoto" o "bloque/idFoto/subId". */
  function clavesDeFotos(fotos) {
    const claves = [];
    for (const [clave, valor] of Object.entries(fotos || {})) {
      if (Array.isArray(valor)) valor.forEach((subId) => claves.push(`${clave}/${subId}`));
      else if (valor) claves.push(clave);
    }
    return claves;
  }

  function keyLocalDeFoto(sed, claveFoto) {
    const [bloque, idFoto, subId] = claveFoto.split('/');
    const base = MapDB.fotoKey(sed, bloque, idFoto);
    return subId ? `${base}/${subId}` : base;
  }

  async function subirEncuesta(registro) {
    const res = await fetch(`${URL_BASE}/api/sync/encuestas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
      body: JSON.stringify({ registros: [registro] }),
    });
    if (!res.ok) throw new Error(`sync encuesta: ${res.status}`);
    const { aplicados, rechazados } = await res.json();
    // Si perdió contra una versión más nueva del servidor (dos técnicos en
    // el mismo SED), igual se marca con lo que quedó guardado allá, para no
    // reintentar esa fila para siempre.
    const actualizado = aplicados.includes(registro.sed)
      ? registro.actualizado
      : (rechazados.find((r) => r.sed === registro.sed) || {}).actualizado;
    if (actualizado) await MapDB.putSyncEncuesta(registro.sed, actualizado);
  }

  async function subirFotoClave(sed, claveFoto, keyLocal) {
    const blob = await MapDB.getFoto(keyLocal);
    if (!blob) return; // se borró localmente entre que se armó la lista y ahora
    const res = await fetch(`${URL_BASE}/api/sync/fotos/${encodeURIComponent(`${sed}/${claveFoto}`)}`, {
      method: 'PUT',
      headers: { 'X-Api-Key': API_KEY },
      body: blob,
    });
    if (!res.ok) throw new Error(`sync foto: ${res.status}`);
    await MapDB.marcarFotoSincronizada(keyLocal);
  }

  /* Sincroniza UN cliente: sus datos si cambiaron desde la última subida, y
     las fotos que falten. La usa encuesta.js apenas guarda algo, para no
     esperar a la próxima apertura de la app. */
  async function sincronizarUna(sed) {
    if (!navigator.onLine) return;
    const registro = await MapDB.getEncuesta(sed);
    if (!registro) return;

    const marca = await MapDB.getSyncEncuesta(sed);
    if (!marca || marca.actualizado !== registro.actualizado) {
      try { await subirEncuesta(registro); } catch { /* se reintenta en la próxima pasada */ }
    }

    const claves = clavesDeFotos(registro.fotos);
    let idx = 0;
    async function worker() {
      while (idx < claves.length) {
        const claveFoto = claves[idx++];
        const keyLocal = keyLocalDeFoto(sed, claveFoto);
        if (await MapDB.fotoSincronizada(keyLocal)) continue;
        try { await subirFotoClave(sed, claveFoto, keyLocal); } catch { /* se reintenta en la próxima pasada */ }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  /* Recorre TODAS las tomas de datos del celular. La usa el arranque de la
     app y el evento "online". */
  async function sincronizarTodo() {
    if (!navigator.onLine) return;
    if (corriendo) { pendienteOtraPasada = true; return; }
    corriendo = true;
    try {
      const todas = await MapDB.getAllEncuestas();
      for (const e of todas) await sincronizarUna(e.sed);
    } catch {
      /* sin señal a mitad de camino: se retoma en la próxima pasada */
    } finally {
      corriendo = false;
      if (pendienteOtraPasada) {
        pendienteOtraPasada = false;
        sincronizarTodo();
      }
    }
  }

  window.addEventListener('online', () => sincronizarTodo());
  if (navigator.onLine) sincronizarTodo();

  return { sincronizarUna, sincronizarTodo };
})();

window.Sync = Sync;
