/* encuestaAp.js — toma de datos de Alumbrado Público (AP), un modo aparte
   del de clientes mayores (Encuesta). La unidad acá es el SED, no el
   trafomix: se abre desde la lista de SED de un alimentador (modo AP de la
   cascada, ver campana.js), no desde la lista de clientes.

   Módulo paralelo a encuesta.js, no una generalización de él: Encuesta tiene
   demasiado supuesto sobre el esquema de clientes (bloques cliente/trafomix/
   medidor/transformador hardcodeados en varios lados) para servir de base a
   un segundo esquema sin arriesgar romper el formulario que ya está en uso
   real. Se reusa el PATRÓN de renderizado (paso a paso, fotos múltiples,
   observaciones), no el código — decisión tomada con el usuario. */

const EncuestaAp = (() => {
  'use strict';

  const FOTO_LADO_MAX = 1600;
  const FOTO_CALIDAD = 0.7;

  let esquema = null;
  let referencia = {};     // ap-referencia.json: por etiqueta, lo que ya se sabe del AP
  let sed = null;          // { sed, etiqueta, nombre, alimentador, setSlug, sistema, lat, lon }
  let orden = 0;
  let datos = null;        // { responsable, fecha_inspeccion, ..., ap: {...} }
  let fotos = null;        // { "ap/fotos": [subId, ...], "ap/obs_<id>": [...] }
  let guardadoPendiente = null;

  const $ = (sel) => document.querySelector(sel);

  async function cargarEsquema() {
    if (esquema) return esquema;
    const res = await fetch(rutaData('encuesta-ap.json'));
    if (!res.ok) throw new Error('No se encontró data/encuesta-ap.json');
    esquema = await res.json();
    return esquema;
  }

  async function cargarReferencia() {
    try {
      const res = await fetch(rutaData('ap-referencia.json'));
      referencia = res.ok ? await res.json() : {};
    } catch {
      referencia = {};
    }
  }

  /* Mismo criterio que Encuesta.siguienteOrden(), pero contra STORE_AP: es
     una numeración aparte, el AP no comparte fila de Excel con el cliente. */
  async function siguienteOrden() {
    const todas = await MapDB.getAllAp();
    const delAlim = todas.filter((e) => e.setSlug === sed.setSlug && e.alimentador === sed.alimentador);
    return delAlim.reduce((max, e) => Math.max(max, e.orden || 0), 0) + 1;
  }

  /* ------------------------------------------------------------------ abrir */

  async function abrir(sedGis) {
    await cargarEsquema();
    await cargarReferencia();
    sed = sedGis;

    const guardada = await MapDB.getAp(sed.sed);
    datos = guardada ? guardada.datos : {};
    fotos = guardada ? guardada.fotos || {} : {};
    orden = guardada && guardada.orden ? guardada.orden : await siguienteOrden();

    autocompletar();
    await registrarPuntoAutomatico();

    document.querySelector('#overlay-encuesta-ap').classList.remove('minimizado');
    document.querySelector('#overlay-encuesta-ap .sheet').classList.remove('minimizada');
    render();
    AppBridge.openSheet('#overlay-encuesta-ap');
  }

  function autocompletar() {
    if (!datos.responsable) datos.responsable = Campana.getTecnico();
    if (!datos.fecha_inspeccion) datos.fecha_inspeccion = new Date().toISOString().slice(0, 10);
    datos.alimentador = sed.alimentador || '';
    datos.sistema_electrico = sed.sistema || '';
    if (datos.latitud === undefined) { datos.latitud = sed.lat; datos.longitud = sed.lon; }

    // Si la oficina ya tiene un AP registrado para este SED, se precarga
    // editable (el técnico corrobora o corrige) — no se vuelve a preguntar
    // si ya se guardó algo antes en esta misma toma.
    datos.ap = datos.ap || {};
    const ref = referencia[sed.etiqueta];
    if (ref && datos.ap.tiene_ap === undefined) {
      datos.ap.tiene_ap = 'Sí';
      datos.ap.marca = ref.marca || '';
      datos.ap.serie = ref.serie || '';
      datos.ap.relacion_transformacion = ref.relacion_transformacion || '';
      if (ref.anio_fabricacion) datos.ap.anio = String(ref.anio_fabricacion);
    }
    // La fecha de la lectura arranca en hoy — el técnico la cambia si tomó
    // el dato otro día (ej. cargó la toma más tarde).
    if (!datos.ap.fecha_lectura) datos.ap.fecha_lectura = new Date().toISOString().slice(0, 10);
    tomarGps();
  }

  function tomarGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        datos.latitud = +pos.coords.latitude.toFixed(7);
        datos.longitud = +pos.coords.longitude.toFixed(7);
        datos.precision_gps = Math.round(pos.coords.accuracy);
        guardar();
        pintarAutomaticos();
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  }

  /* El SED ya tiene coordenadas del GIS — a diferencia del trafomix, no hace
     falta que el técnico toque el mapa para "marcarlo": se registra solo,
     en la coordenada del SED, apenas se abre el formulario. Alimenta el
     mismo recorrido numerado (y su sync al panel) que ya usan los clientes,
     sin que el técnico tenga que hacer nada aparte.

     Nota: esto capta la posición al abrir cada SED, no un rastreo continuo
     en segundo plano — un PWA no puede mantener el GPS activo de forma
     confiable con la pantalla apagada o la app minimizada. */
  async function registrarPuntoAutomatico() {
    if (sed.lat == null || sed.lon == null) return;
    const existentes = await MapDB.getPuntosDeToma(sed.sed);
    if (existentes.ap) return;
    await Ruta.guardarPuntoDirecto(
      { sed: sed.sed, bloque: 'ap', orden, etiqueta: sed.etiqueta || sed.sed },
      { lat: sed.lat, lng: sed.lon }
    );
  }

  /* Respaldo para cuando el SED no tiene coordenada del GIS (la mayoría de
     los que tienen AP, según lo que se encontró en los KMZ de Ananea): se
     usa el GPS de la PRIMERA foto que el técnico saca en esta toma —está
     parado al lado del equipo, así que es tan buena ubicación como
     cualquiera. No pisa una coordenada del GIS si ya existe (esa es del
     equipo fijo, más precisa que un GPS de celular), ni un punto que ya se
     haya registrado antes por cualquiera de las dos vías. */
  async function registrarPuntoDesdeFoto(gps) {
    if (!gps) return;
    const existentes = await MapDB.getPuntosDeToma(sed.sed);
    if (existentes.ap) return;
    await Ruta.guardarPuntoDirecto(
      { sed: sed.sed, bloque: 'ap', orden, etiqueta: sed.etiqueta || sed.sed },
      { lat: gps.lat, lng: gps.lon }
    );
  }

  function pintarAutomaticos() {
    const caja = $('#ap-auto');
    if (!caja) return;
    const gps = datos.precision_gps === undefined
      ? (datos.latitud != null
          ? `${datos.latitud}, ${datos.longitud} <em>(del GIS — buscando señal GPS…)</em>`
          : '<em>Sin coordenadas del GIS — buscando señal GPS…</em>')
      : `${datos.latitud}, ${datos.longitud} · ±${datos.precision_gps} m`;
    const ref = referencia[sed.etiqueta];
    const filaRef = ref
      ? `<div class="ancho"><span>Lectura de referencia</span><strong>${ref.lectura_referencia} (${ref.lectura_referencia_mes || '—'})</strong></div>`
      : '';
    caja.innerHTML = `
      <div><span>Técnico</span><strong>${datos.responsable || '—'}</strong></div>
      <div><span>Fecha</span><strong>${datos.fecha_inspeccion || '—'}</strong></div>
      <div><span>Alimentador</span><strong>${datos.alimentador || '—'}</strong></div>
      <div class="ancho"><span>Ubicación</span><strong>${gps}</strong></div>
      ${filaRef}
      <div class="ancho">
        <button type="button" class="mini peligro" data-borrar-ap style="margin-top:6px">🗑 Borrar esta toma de AP</button>
      </div>`;
  }

  /* Para cuando el técnico marcó un SED por error (código equivocado, o un
     SED que en realidad no correspondía revisar). Sin confirmación a
     propósito — mismo criterio que borrar/rehacer un punto de ruta: es
     reversible (se puede volver a marcar) y en el cerro un diálogo de más
     estorba. Limpia el registro, sus fotos y su punto en el mapa. */
  async function borrar() {
    const sedActual = sed.sed;
    await MapDB.deleteAp(sedActual);
    await Ruta.borrar(sedActual, 'ap');
    AppBridge.closeSheet('#overlay-encuesta-ap');
    AppBridge.showToast('Toma de AP borrada.', 3000);
    if (window.Campana && Campana.refrescarEstados) await Campana.refrescarEstados();
  }

  /* ---------------------------------------------------------------- dibujar */

  /* Un solo bloque ("ap"), varios pasos: no hace falta la paginación por
     bloque de Encuesta — todo entra en una pantalla que se recorre bajando.
     El control de flujo es por `condicion` ({campo, igual}) — sirve tanto
     para pasos enteros (tiene_ap: Sí/No) como para campos sueltos dentro de
     un paso (estado_lectura: Lectura correcta/ilegible/Otros, cada una
     pide un campo distinto). Mismo shape, mismo chequeo. */
  function cumpleCondicion(bloqueId, obj) {
    if (!obj.condicion) return true;
    return (datos[bloqueId] || {})[obj.condicion.campo] === obj.condicion.igual;
  }

  function render() {
    const bloque = esquema.bloques[0];
    $('#ap-titulo').textContent = sed.nombre || sed.etiqueta || sed.sed;
    $('#ap-sub').textContent = `${sed.etiqueta || sed.sed} · Alim. ${sed.alimentador || '—'}`;

    const pasosVisibles = bloque.pasos.filter((p) => cumpleCondicion(bloque.id, p));
    const grupos = pasosVisibles.map((paso) => renderGrupo(bloque, paso)).join('');
    $('#ap-cuerpo').innerHTML = '<div class="auto-ficha" id="ap-auto"></div>' + grupos;

    pintarAutomaticos();
    conectar();
    actualizarProgreso();
    pasosVisibles.forEach((paso) => {
      if (paso.fotos) pintarFotosGuardadas(bloque, paso);
      if (paso.observaciones) pintarFotosObservaciones(bloque);
    });
  }

  /* En los pasos de lectura, si la oficina ya tenía un valor para este SED,
     se muestra arriba de los campos — así el técnico ve "antes vs. lo que
     estoy por cargar" en el mismo lugar, no tiene que subir hasta la ficha
     automática para acordarse. */
  function ayudaConReferencia(paso) {
    const base = paso.ayuda ? `<div class="grupo-ayuda">${paso.ayuda}</div>` : '';
    if (paso.id !== 'ap_lectura' && paso.id !== 'ap_sin_ap') return base;
    const ref = referencia[sed.etiqueta];
    if (!ref) return base;
    return base + `<div class="campo-referencia">Lectura anterior (oficina): <strong>${ref.lectura_referencia}</strong> — ${ref.lectura_referencia_mes || 'sin fecha'}</div>`;
  }

  function renderGrupo(bloque, paso) {
    const ayuda = ayudaConReferencia(paso);
    const cuerpo = paso.observaciones
      ? renderObservaciones(bloque)
      : paso.fotos
      ? `<div class="foto-grilla">${paso.fotos.map((f) => renderFotoMultiple(f, `${bloque.id}/${f.id}`)).join('')}</div>`
      : (paso.campos || []).filter((c) => cumpleCondicion(bloque.id, c)).map((campo) => renderCampo(bloque, campo)).join('');
    return `
      <div class="grupo">
        <div class="grupo-titulo">${paso.titulo}</div>
        ${ayuda}
        ${cuerpo}
      </div>`;
  }

  function renderCampo(bloque, campo) {
    const valor = (datos[bloque.id] || {})[campo.id];
    const v = valor === undefined || valor === null ? '' : String(valor);

    if (campo.tipo === 'lista') {
      const opciones = ['<option value=""></option>']
        .concat(campo.opciones.map((o) => `<option value="${o}" ${v === String(o) ? 'selected' : ''}>${o}</option>`))
        .join('');
      return `
        <div class="campo">
          <label>${campo.label}${campo.requerido ? ' <b>*</b>' : ''}</label>
          <select data-bloque="${bloque.id}" data-campo="${campo.id}">${opciones}</select>
        </div>`;
    }

    if (campo.tipo === 'texto_largo') {
      return `
        <div class="campo">
          <label>${campo.label}${campo.requerido ? ' <b>*</b>' : ''}</label>
          <textarea rows="3" data-bloque="${bloque.id}" data-campo="${campo.id}">${v}</textarea>
        </div>`;
    }

    const tipoHtml = campo.tipo === 'fecha' ? 'date' : 'text';
    const modo = campo.tipo === 'entero' ? 'numeric' : campo.tipo === 'decimal' ? 'decimal' : 'text';
    return `
      <div class="campo">
        <label>${campo.label}${campo.requerido ? ' <b>*</b>' : ''}</label>
        <input type="${tipoHtml}" inputmode="${modo}"
               data-bloque="${bloque.id}" data-campo="${campo.id}"
               placeholder="${campo.placeholder || ''}"
               value="${v.replace(/"/g, '&quot;')}" />
      </div>`;
  }

  /* Igual mecanismo que encuesta.js: una casilla por foto ya sacada (con su
     cruz para quitarla) más una casilla "+" para seguir agregando. */
  function renderFotoMultiple(foto, clave) {
    const subIds = Array.isArray(fotos[clave]) ? fotos[clave] : [];
    const tomadas = subIds.map((subId, i) => `
      <div class="foto tomada" data-foto-multi="${clave}/${subId}">
        <div class="foto-vista" data-vista-multi="${clave}/${subId}">
          <span class="foto-numero">${i + 1}</span>
          <button type="button" class="foto-quitar" data-quitar-foto="${clave}/${subId}" aria-label="Quitar foto">✕</button>
        </div>
        <div class="foto-label">${foto.label}</div>
      </div>`).join('');
    const requerido = foto.minimo || 0;
    const faltan = requerido ? Math.max(0, requerido - subIds.length) : 0;
    const etiquetaMas = faltan ? `Faltan ${faltan}` : (requerido ? 'Agregar' : foto.label);
    const agregar = `
      <div class="foto agregar" data-foto="${clave}">
        <div class="foto-vista" data-agregar-foto="${clave}"><span class="foto-mas">＋</span></div>
        <div class="foto-label">${etiquetaMas}</div>
        <input type="file" accept="image/*" capture="environment"
               data-input-foto-multi="${clave}" style="display:none" />
      </div>`;
    return tomadas + agregar;
  }

  function renderObservaciones(bloque) {
    const lista = ((datos[bloque.id] || {}).lista) || [];
    const filas = lista.map((obs, i) => {
      const clave = `${bloque.id}/obs_${obs.id}`;
      const texto = (obs.texto || '').replace(/</g, '&lt;');
      return `
        <div class="observacion">
          <div class="observacion-cab">
            <span class="observacion-num">Observación ${i + 1}</span>
            <button type="button" class="mini peligro" data-quitar-observacion="${obs.id}">Borrar</button>
          </div>
          <textarea rows="3" placeholder="¿Qué encontraste?" data-obs-texto="${obs.id}">${texto}</textarea>
          <div class="foto-grilla">${renderFotoMultiple({ label: `Observación ${i + 1}` }, clave)}</div>
        </div>`;
    }).join('');
    return `
      <div class="observaciones-lista">${filas}</div>
      <button type="button" class="btn-secondary" id="ap-agregar-observacion" style="width:100%">＋ Agregar observación</button>`;
  }

  /* -------------------------------------------------------------- fotos: eventos */

  async function guardarGpsDeFoto(key) {
    const pos = window.AppBridge && AppBridge.getGpsActual && AppBridge.getGpsActual();
    if (!pos) return null;
    const gps = { lat: pos.coords.latitude, lon: pos.coords.longitude, precision: Math.round(pos.coords.accuracy) };
    await MapDB.putFotoGps(key, gps);
    return gps;
  }

  function timbrarFoto(lienzo) {
    const ctx = lienzo.getContext('2d');
    const ahora = new Date();
    const lineas = [`${ahora.toLocaleDateString('es-PE')} ${ahora.toLocaleTimeString('es-PE', { hour12: false })}`];
    const pos = window.AppBridge && AppBridge.getGpsActual && AppBridge.getGpsActual();
    if (pos) {
      const { latitude, longitude, accuracy } = pos.coords;
      lineas.push(`${latitude.toFixed(6)}, ${longitude.toFixed(6)} ±${Math.round(accuracy)} m`);
    } else {
      lineas.push('GPS sin señal');
    }
    const fontSize = Math.max(16, Math.round(lienzo.width * 0.026));
    const lineHeight = Math.round(fontSize * 1.35);
    const pad = Math.round(fontSize * 0.5);
    const franja = lineHeight * lineas.length + pad * 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, lienzo.height - franja, lienzo.width, franja);
    ctx.font = `600 ${fontSize}px sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'bottom';
    lineas.forEach((linea, i) => {
      const y = lienzo.height - pad - (lineas.length - 1 - i) * lineHeight;
      ctx.fillText(linea, pad, y);
    });
  }

  function comprimir(archivo) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(archivo);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const escala = Math.min(1, FOTO_LADO_MAX / Math.max(img.width, img.height));
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.round(img.width * escala);
        lienzo.height = Math.round(img.height * escala);
        lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
        timbrarFoto(lienzo);
        lienzo.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo comprimir'))),
          'image/jpeg', FOTO_CALIDAD);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
      img.src = url;
    });
  }

  function mostrarFotoMulti(claveSub, blob) {
    const vista = $(`[data-vista-multi="${claveSub}"]`);
    if (vista) vista.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
  }

  async function pintarFotosGuardadas(bloque, paso) {
    for (const f of paso.fotos) {
      const clave = `${bloque.id}/${f.id}`;
      const subIds = Array.isArray(fotos[clave]) ? fotos[clave] : [];
      for (const subId of subIds) {
        const blob = await MapDB.getFoto(`${MapDB.fotoKey(sed.sed, bloque.id, f.id)}/${subId}`);
        if (blob) mostrarFotoMulti(`${clave}/${subId}`, blob);
      }
    }
  }

  async function pintarFotosObservaciones(bloque) {
    const lista = ((datos[bloque.id] || {}).lista) || [];
    for (const obs of lista) {
      const idFoto = `obs_${obs.id}`;
      const clave = `${bloque.id}/${idFoto}`;
      const subIds = Array.isArray(fotos[clave]) ? fotos[clave] : [];
      for (const subId of subIds) {
        const blob = await MapDB.getFoto(`${MapDB.fotoKey(sed.sed, bloque.id, idFoto)}/${subId}`);
        if (blob) mostrarFotoMulti(`${clave}/${subId}`, blob);
      }
    }
  }

  /* ----------------------------------------------------------------- eventos */

  function conectar() {
    $('#ap-cuerpo').querySelectorAll('[data-campo]').forEach((el) => {
      el.addEventListener('input', () => {
        const b = el.dataset.bloque;
        datos[b] = datos[b] || {};
        datos[b][el.dataset.campo] = el.value;
        actualizarProgreso();
        guardar();
        // Ambos son <select>: el evento "input" dispara una sola vez al
        // elegir, no por tecla — está bien volver a renderizar entero.
        if (el.dataset.campo === 'tiene_ap' || el.dataset.campo === 'estado_lectura') render();
      });
      el.addEventListener('change', () => {
        if (el.dataset.campo === 'tiene_ap' || el.dataset.campo === 'estado_lectura') { el.blur(); }
      });
    });

    $('#ap-cuerpo').querySelectorAll('[data-agregar-foto]').forEach((el) => {
      el.addEventListener('click', () => $(`[data-input-foto-multi="${el.dataset.agregarFoto}"]`).click());
    });

    $('#ap-cuerpo').querySelectorAll('[data-input-foto-multi]').forEach((input) => {
      input.addEventListener('change', async () => {
        const archivo = input.files && input.files[0];
        if (!archivo) return;
        const clave = input.dataset.inputFotoMulti;
        const [bloque, idFoto] = clave.split('/');
        try {
          const blob = await comprimir(archivo);
          const subId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const key = `${MapDB.fotoKey(sed.sed, bloque, idFoto)}/${subId}`;
          await MapDB.putFoto(key, blob);
          const gps = await guardarGpsDeFoto(key);
          await registrarPuntoDesdeFoto(gps);  // respaldo si el SED no tenía coordenada del GIS
          fotos[clave] = (Array.isArray(fotos[clave]) ? fotos[clave] : []).concat(subId);
          await guardar();
          render();
        } catch (e) {
          AppBridge.showToast('No se pudo guardar la foto: ' + e.message, 3500);
        }
        input.value = '';
      });
    });

    $('#ap-cuerpo').querySelectorAll('[data-quitar-foto]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const partes = el.dataset.quitarFoto.split('/');
        const subId = partes.pop();
        const clave = partes.join('/');
        const [bloque, idFoto] = clave.split('/');
        await MapDB.deleteFoto(`${MapDB.fotoKey(sed.sed, bloque, idFoto)}/${subId}`);
        fotos[clave] = (fotos[clave] || []).filter((x) => x !== subId);
        await guardar();
        render();
      });
    });

    $('#ap-cuerpo').querySelectorAll('[data-vista-multi]').forEach((el) => {
      el.addEventListener('click', async () => {
        const partes = el.dataset.vistaMulti.split('/');
        const subId = partes.pop();
        const clave = partes.join('/');
        const [bloque, idFoto] = clave.split('/');
        const key = `${MapDB.fotoKey(sed.sed, bloque, idFoto)}/${subId}`;
        const blob = await MapDB.getFoto(key);
        if (!blob) return;
        const resultado = await FotoVisor.abrir(blob, { permiteRepetir: true });
        if (resultado === 'borrar' || resultado === 'repetir') {
          await MapDB.deleteFoto(key);
          fotos[clave] = (fotos[clave] || []).filter((x) => x !== subId);
          await guardar();
          render();
          if (resultado === 'repetir') $(`[data-input-foto-multi="${clave}"]`)?.click();
        }
      });
    });

    const btnBorrarAp = $('[data-borrar-ap]');
    if (btnBorrarAp) btnBorrarAp.addEventListener('click', () => borrar());

    const btnAgregarObs = $('#ap-agregar-observacion');
    if (btnAgregarObs) btnAgregarObs.addEventListener('click', () => {
      const bloque = esquema.bloques[0];
      datos[bloque.id] = datos[bloque.id] || {};
      datos[bloque.id].lista = (datos[bloque.id].lista || []).concat({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        texto: '',
      });
      guardar();
      render();
    });

    $('#ap-cuerpo').querySelectorAll('[data-obs-texto]').forEach((el) => {
      el.addEventListener('input', () => {
        const bloque = esquema.bloques[0];
        const lista = (datos[bloque.id] || {}).lista || [];
        const obs = lista.find((o) => o.id === el.dataset.obsTexto);
        if (obs) obs.texto = el.value;
        guardar();
      });
    });

    $('#ap-cuerpo').querySelectorAll('[data-quitar-observacion]').forEach((el) => {
      el.addEventListener('click', async () => {
        const bloque = esquema.bloques[0];
        const id = el.dataset.quitarObservacion;
        const clave = `${bloque.id}/obs_${id}`;
        for (const subId of (fotos[clave] || [])) {
          await MapDB.deleteFoto(`${MapDB.fotoKey(sed.sed, bloque.id, `obs_${id}`)}/${subId}`);
        }
        delete fotos[clave];
        datos[bloque.id].lista = (datos[bloque.id].lista || []).filter((o) => o.id !== id);
        await guardar();
        render();
      });
    });
  }

  /* ---------------------------------------------------------------- progreso */

  function camposDe(bloque, paso) {
    if (!cumpleCondicion(bloque.id, paso)) return [];
    return (paso.campos || []).filter((c) => cumpleCondicion(bloque.id, c));
  }

  function contarPaso(bloque, paso) {
    const valores = datos[bloque.id] || {};
    const campos = camposDe(bloque, paso);
    const llenos = campos.filter((c) => {
      const v = valores[c.id];
      return v !== undefined && v !== null && String(v).trim() !== '';
    }).length;

    if (!cumpleCondicion(bloque.id, paso)) return { llenos: 0, total: 0, fotos: 0, totalFotos: 0 };

    let fotosOk = 0, totalFotos = 0;
    (paso.fotos || []).forEach((f) => {
      const val = fotos[`${bloque.id}/${f.id}`];
      const requerido = f.minimo || 0;
      if (!requerido) return;
      totalFotos += requerido;
      fotosOk += Math.min(requerido, Array.isArray(val) ? val.length : 0);
    });
    return { llenos, total: campos.length, fotos: fotosOk, totalFotos };
  }

  function actualizarProgreso() {
    const bloque = esquema.bloques[0];
    let campos = 0, camposTotal = 0, fotosOk = 0, fotosTotal = 0;
    bloque.pasos.forEach((paso) => {
      const c = contarPaso(bloque, paso);
      campos += c.llenos; camposTotal += c.total;
      fotosOk += c.fotos; fotosTotal += c.totalFotos;
    });
    const el = $('#ap-progreso');
    if (el) el.textContent = `${campos}/${camposTotal} campos · ${fotosOk}/${fotosTotal} fotos`;
    return { campos, camposTotal, fotosOk, fotosTotal };
  }

  /* ---------------------------------------------------------------- guardado */

  function estadoActual() {
    const bloque = esquema.bloques[0];
    if (!(datos[bloque.id] || {}).tiene_ap) return 'borrador';
    const p = actualizarProgreso();
    return p.campos === p.camposTotal && p.fotosOk === p.fotosTotal ? 'completa' : 'borrador';
  }

  function registro() {
    const ref = referencia[sed.etiqueta];
    return {
      sed: sed.sed,
      orden,
      setSlug: sed.setSlug || '',
      alimentador: sed.alimentador || '',
      etiqueta: sed.etiqueta || '',
      nombre: sed.nombre || '',
      tecnico: Campana.getTecnico(),
      estado: estadoActual(),
      actualizado: new Date().toISOString(),
      datos,
      fotos,
      // La lectura de referencia de oficina (si el SED la tenía) viaja
      // aparte de `datos`: no es algo que el técnico haya escrito, es
      // contexto para que el panel la muestre al lado de lo medido.
      ...(ref ? { referencia: { lectura_referencia: ref.lectura_referencia, lectura_referencia_mes: ref.lectura_referencia_mes } } : {}),
    };
  }

  function dispararSync() {
    if (window.Sync && Sync.sincronizarUnaAp && sed) Sync.sincronizarUnaAp(sed.sed);
  }

  function guardar() {
    clearTimeout(guardadoPendiente);
    return new Promise((resolve) => {
      guardadoPendiente = setTimeout(async () => {
        await MapDB.putAp(registro());
        dispararSync();
        resolve();
      }, 400);
    });
  }

  async function cerrar() {
    clearTimeout(guardadoPendiente);
    await MapDB.putAp(registro());
    dispararSync();
    AppBridge.closeSheet('#overlay-encuesta-ap');
    if (window.Campana && Campana.refrescarEstados) await Campana.refrescarEstados();
  }

  return { abrir, cerrar, estadoActual };
})();

window.EncuestaAp = EncuestaAp;

document.querySelector('#ap-cerrar').addEventListener('click', () => EncuestaAp.cerrar());
document.querySelector('#ap-atras-cab').addEventListener('click', () => EncuestaAp.cerrar());

AppBridge.registrarAtras(() => {
  if (!document.querySelector('#overlay-encuesta-ap').classList.contains('visible')) return false;
  EncuestaAp.cerrar();
  return true;
});
AppBridge.alCerrarPanel('#overlay-encuesta-ap', () => EncuestaAp.cerrar());
