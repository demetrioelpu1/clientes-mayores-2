/* campana.js — Fase 2: elegir dónde se trabaja y ver qué hay que hacer ahí.

   Cascada:  SISTEMA ELÉCTRICO → SET → ALIMENTADOR → clientes mayores

   Los datos de cada alimentador se cargan desde sus KMZ (Tramos MT, Trafomix,
   SED), que el ingeniero manda por Drive o WhatsApp. Cada carga queda con su
   fecha y no pisa a la anterior: en campo hay que poder saber contra qué
   versión del GIS se está comparando.

   Si existe un paquete precompilado en data/set-<slug>.json se usa como
   respaldo mientras no haya KMZ cargados para esa zona. */

const Campana = (() => {
  'use strict';

  const CLAVE_SET = 'catastro:campana:set';
  const CLAVE_ALIM = 'catastro:campana:alimentador';
  const CLAVE_TECNICO = 'catastro:tecnico';

  const CAPAS = ['tramos_mt', 'trafomix', 'sed'];
  const NOMBRE_CAPA = {
    tramos_mt: 'Tramos MT',
    trafomix: 'Trafomix',
    sed: 'SED',
  };

  const COLOR = {
    tramos_mt: '#e0553b',
    sed: '#7a8290',
    pendiente: '#d4af1f',
    borrador: '#f5822a',
    completa: '#3fa85f',
  };

  /* La SED va en triángulo (pedido del ingeniero): es la convención del GIS y
     así no se confunde con los círculos, que son los clientes mayores. */
  const ICONO_SED = L.divIcon({
    className: 'marcador-sed',
    html: '<svg viewBox="0 0 20 18" width="20" height="18" aria-hidden="true">'
      + `<polygon points="10,1 19,17 1,17" fill="${COLOR.sed}" stroke="#ffffff" stroke-width="2"`
      + ' stroke-linejoin="round"/></svg>',
    iconSize: [20, 18],
    iconAnchor: [10, 9],
    tooltipAnchor: [0, -9],
  });

  let catalogo = null;
  let precompilado = null;     // data/set-<slug>.json, si existe
  let setActual = null;        // { slug, nombre, sistema }
  let alimentador = null;
  let capas = {};              // capa -> [features]
  let clientes = [];
  let estados = {};
  let grupos = {};
  let grupoClientes = null;
  let marcadores = {};
  let capaCargando = null;     // capa que espera el archivo del selector

  const $ = (sel) => document.querySelector(sel);
  const map = () => AppBridge.map;

  /* ------------------------------------------------------------------ datos */

  async function cargarCatalogo() {
    if (catalogo) return catalogo;
    const res = await fetch('data/catalogo.json');
    if (!res.ok) throw new Error('No se encontró data/catalogo.json');
    catalogo = await res.json();
    return catalogo;
  }

  function buscarSet(slug) {
    for (const sis of catalogo.sistemas) {
      const s = sis.sets.find((x) => x.slug === slug);
      if (s) return { sistema: sis, set: s };
    }
    return null;
  }

  function zonaActual() {
    return MapDB.zonaKey(setActual.slug, alimentador);
  }

  /* Arma las capas de la zona: manda lo cargado desde KMZ; si no hay nada, se
     usa el paquete precompilado (hoy solo existe para Juliaca). */
  async function cargarCapasDeZona() {
    const paquetes = await MapDB.getPaquetesDeZona(zonaActual());
    capas = {};
    CAPAS.forEach((c) => {
      const activa = paquetes.find((p) => p.capa === c && p.activa);
      capas[c] = activa ? activa.elementos : desdePrecompilado(c);
    });
    clientes = construirClientes();
  }

  function desdePrecompilado(capa) {
    if (!precompilado) return [];
    const equivalencias = { tramos_mt: 'tramos_mt', sed: 'sed_publicas' };
    const fc = (precompilado.capas || {})[equivalencias[capa]];
    if (!fc) return [];
    return fc.features.filter((f) => !alimentador || f.properties.alimentador === alimentador);
  }

  function coordsDe(feature) {
    const g = feature.geometry;
    if (!g) return null;
    if (g.type === 'Point') return { lon: g.coordinates[0], lat: g.coordinates[1] };
    return null;
  }

  /* La unidad de trabajo es el TRAFOMIX: es el punto de medición del cliente
     mayor, y en los KMZ de Ananea todos vienen con propietario = Tercero.
     Si esa capa no está cargada se cae al criterio viejo (SED de terceros),
     que es lo que había en la muestra de Juliaca. */
  function construirClientes() {
    if (capas.trafomix && capas.trafomix.length) {
      /* El nombre del cliente vive en la capa SED. El KMZ de Ananea no trae
         "Código SED", así que se indexa también por etiqueta de campo, que es
         lo que el trafomix guarda en `sed_etiqueta` (SE08390). */
      const nombres = {};
      (capas.sed || []).forEach((f) => {
        const p = f.properties;
        if (!p.nombre) return;
        if (p.sed) nombres[p.sed] = p.nombre;
        if (p.etiqueta) nombres[p.etiqueta] = p.nombre;
      });
      return capas.trafomix.map((f) => {
        const p = f.properties;
        const c = coordsDe(f) || {};
        return {
          sed: p.trafomix || p.sed || p.estructura,   // clave estable de la toma de datos
          tipo: 'trafomix',
          etiqueta: p.trafomix || '',
          nombre: nombres[p.sed] || nombres[p.sed_etiqueta] || p.sed_etiqueta || p.sed || '',
          alimentador: p.alimentador || alimentador,
          sistema: p.sistema || '',
          potencia_kva: p.potencia_tension || '',
          lat: c.lat,
          lon: c.lon,
          gis: p,                                     // referencia para el formulario
        };
      }).filter((c) => c.lat !== undefined);
    }

    if (precompilado && precompilado.clientes) {
      return precompilado.clientes
        .filter((c) => !alimentador || c.alimentador === alimentador)
        .map((c) => Object.assign({ tipo: 'sed', gis: null }, c));
    }
    return [];
  }

  /* ------------------------------------------------- estado de cada toma de datos */

  async function refrescarEstados() {
    estados = await MapDB.getEstadosEncuestas();
    if (setActual && alimentador) {
      redibujar();
      actualizarSubtitulo();
    }
  }

  function estadoDe(cliente) {
    return estados[cliente.sed] || 'pendiente';
  }

  function resumenAvance(lista) {
    return { hechos: lista.filter((c) => estadoDe(c) === 'completa').length, total: lista.length };
  }

  /* ------------------------------------------------------------------- mapa */

  function limpiarMapa() {
    Object.values(grupos).forEach((g) => map().removeLayer(g));
    grupos = {};
    if (grupoClientes) map().removeLayer(grupoClientes);
    grupoClientes = null;
    marcadores = {};
  }

  function fc(features) {
    return { type: 'FeatureCollection', features };
  }

  function redibujar() {
    limpiarMapa();

    if ((capas.tramos_mt || []).length) {
      grupos.tramos_mt = L.geoJSON(fc(capas.tramos_mt), {
        style: { color: COLOR.tramos_mt, weight: 3, opacity: 0.85 },
        onEachFeature: (f, capa) =>
          capa.bindTooltip(`Tramo MT ${f.properties.tramo || ''} · ${f.properties.tension_kv || '—'} kV`,
            { direction: 'top' }),
      }).addTo(map());
    }

    if ((capas.sed || []).length) {
      grupos.sed = L.geoJSON(fc(capas.sed), {
        pointToLayer: (f, latlng) => L.marker(latlng, { icon: ICONO_SED, keyboard: false }),
        onEachFeature: (f, capa) => {
          const p = f.properties;
          capa.bindTooltip(`SED ${p.etiqueta || p.sed || ''} · ${p.potencia_kva || '—'} kVA`,
            { direction: 'top' });
          capa.on('click', () => abrirFichaSed(p, capa.getLatLng()));
        },
      }).addTo(map());
    }

    grupoClientes = L.layerGroup().addTo(map());
    clientes.forEach((c) => {
      const m = L.circleMarker([c.lat, c.lon], {
        radius: 9, weight: 3, color: '#ffffff',
        fillColor: COLOR[estadoDe(c)], fillOpacity: 1,
      });
      m.bindTooltip(`${c.etiqueta || c.sed}${c.nombre ? ' · ' + c.nombre : ''}`, { direction: 'top' });
      m.on('click', () => abrirFicha(c.sed));
      m.addTo(grupoClientes);
      marcadores[c.sed] = m;
    });

    encuadrar();
  }

  function encuadrar() {
    if (clientes.length) {
      map().fitBounds(L.latLngBounds(clientes.map((c) => [c.lat, c.lon])),
        { padding: [40, 40], maxZoom: 16 });
      return;
    }
    if (grupos.tramos_mt) map().fitBounds(grupos.tramos_mt.getBounds(), { padding: [40, 40] });
  }

  /* ------------------------------------------------------- pila de pantallas */

  let pila = [];
  let vistaActual = null;

  function ir(fn) {
    if (vistaActual) pila.push(vistaActual);
    vistaActual = fn;
    fn();
  }
  function reemplazar(fn) { vistaActual = fn; fn(); }
  function atras() {
    const anterior = pila.pop();
    if (!anterior) return false;
    vistaActual = anterior;
    anterior();
    return true;
  }
  function refrescarVista() { if (vistaActual) vistaActual(); }

  function abrirSelector() {
    pila = [];
    vistaActual = null;
    ir(getTecnico() ? renderSistemas : renderTecnico);
    AppBridge.openSheet('#overlay-campana');
  }

  function pintar(titulo, migas, cuerpo) {
    $('#campana-titulo').textContent = titulo;
    $('#campana-migas').innerHTML = migas;
    $('#campana-cuerpo').innerHTML = barraTecnico() + cuerpo;
    $('#campana-atras').hidden = pila.length === 0;
    conectarTecnico();
  }

  /* ------------------------------------------------------------- técnico */

  function getTecnico() { return localStorage.getItem(CLAVE_TECNICO) || ''; }

  function barraTecnico() {
    const nombre = getTecnico();
    if (!nombre) return '';
    return `<div class="campana-tecnico">
        <div>Técnico: <strong>${nombre}</strong></div>
        <span data-cambiar-tecnico>Cambiar</span>
      </div>`;
  }

  function conectarTecnico() {
    const el = $('#campana-cuerpo [data-cambiar-tecnico]');
    if (el) el.addEventListener('click', () => ir(renderTecnico));
  }

  function renderTecnico() {
    const nombre = getTecnico();
    $('#campana-titulo').textContent = '¿Quién está trabajando?';
    $('#campana-migas').innerHTML = '';
    $('#campana-atras').hidden = pila.length === 0;
    $('#campana-cuerpo').innerHTML = `
      <div class="tecnico-caja">
        <p>Escribe tu nombre completo. Queda guardado en este celular y se
           agrega solo a cada toma de datos que registres.</p>
        <input type="text" id="tecnico-input" placeholder="Ej: Juan Pérez Quispe"
               autocomplete="name" value="${nombre}" />
        <button class="btn-primary" id="tecnico-btn" style="width:100%; padding:12px;">Continuar</button>
      </div>`;

    const input = $('#tecnico-input');
    const guardar = () => {
      const valor = input.value.trim();
      if (valor.length < 3) { AppBridge.showToast('Escribe tu nombre para continuar'); return; }
      localStorage.setItem(CLAVE_TECNICO, valor);
      if (!atras()) reemplazar(renderSistemas);
    };
    $('#tecnico-btn').addEventListener('click', guardar);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') guardar(); });
    setTimeout(() => input.focus(), 60);
  }

  /* --------------------------------------------------------- sistemas y SET */

  async function contarCargas() {
    const todos = await MapDB.getTodosLosPaquetes();
    const porSet = {};
    todos.filter((p) => p.activa).forEach((p) => {
      porSet[p.setSlug] = porSet[p.setSlug] || new Set();
      porSet[p.setSlug].add(p.alimentador);
    });
    return porSet;
  }

  async function renderSistemas() {
    const cargas = await contarCargas();
    const filas = catalogo.sistemas
      .filter((s) => !s.rural)
      .map((s) => {
        const conDatos = s.sets.filter((x) => x.disponible || cargas[x.slug]).length;
        const detalle = conDatos
          ? `${conDatos} SET con datos`
          : 'sin datos — cargar KMZ';
        return `
          <div class="campana-fila" data-sistema="${s.codigo}">
            <div class="campana-info">
              <div class="campana-nombre">${s.nombre}</div>
              <div class="campana-detalle">${s.sets.length} SET · ${detalle}</div>
            </div>
            <div class="campana-flecha">›</div>
          </div>`;
      })
      .join('');

    pintar('Sistema eléctrico', '', filas);
    $('#campana-cuerpo').querySelectorAll('[data-sistema]').forEach((el) => {
      el.addEventListener('click', () => elegirSistema(el.dataset.sistema));
    });
  }

  function elegirSistema(codigo) {
    const sis = catalogo.sistemas.find((s) => s.codigo === codigo);
    if (!sis) return;
    if (sis.sets.length === 1) { elegirSet(sis.sets[0].slug); return; }
    ir(() => renderSets(sis));
  }

  async function renderSets(sis) {
    const cargas = await contarCargas();
    const filas = sis.sets.map((s) => {
      const n = cargas[s.slug] ? cargas[s.slug].size : 0;
      const detalle = n ? `${n} alimentador(es) con datos cargados`
        : (s.disponible ? 'paquete precompilado' : 'sin datos — cargar KMZ');
      return `
        <div class="campana-fila" data-set="${s.slug}">
          <div class="campana-info">
            <div class="campana-nombre">SET ${s.nombre}</div>
            <div class="campana-detalle">${s.alimentadores.length} alimentadores · ${detalle}</div>
          </div>
          <div class="campana-flecha">›</div>
        </div>`;
    }).join('');

    pintar('Subestación (SET)',
      `<span data-volver="sistemas">Sistemas</span> › <strong>${sis.nombre}</strong>`, filas);
    conectarMigas();
    $('#campana-cuerpo').querySelectorAll('[data-set]').forEach((el) => {
      el.addEventListener('click', () => elegirSet(el.dataset.set));
    });
  }

  async function elegirSet(slug) {
    const encontrado = buscarSet(slug);
    if (!encontrado) return;
    setActual = { slug, nombre: encontrado.set.nombre, sistema: encontrado.sistema };

    // El precompilado es opcional: si no existe, se trabaja solo con los KMZ.
    precompilado = null;
    if (encontrado.set.disponible) {
      try { precompilado = await (await fetch(`data/set-${slug}.json`)).json(); }
      catch (e) { precompilado = null; }
    }

    alimentador = null;
    localStorage.setItem(CLAVE_SET, slug);
    localStorage.removeItem(CLAVE_ALIM);
    ir(renderAlimentadores);
  }

  /* ----------------------------------------------------------- alimentadores */

  async function renderAlimentadores() {
    const encontrado = buscarSet(setActual.slug);
    const set = encontrado.set;
    const sis = encontrado.sistema;
    const paquetes = await MapDB.getTodosLosPaquetes();

    const filas = set.alimentadores.map((a) => {
      const zona = MapDB.zonaKey(setActual.slug, a.id);
      const activos = paquetes.filter((p) => p.zona === zona && p.activa);
      const capasOk = CAPAS.filter((c) => activos.some((p) => p.capa === c));
      const trafomix = activos.find((p) => p.capa === 'trafomix');

      let detalle;
      if (capasOk.length) {
        detalle = capasOk.map((c) => NOMBRE_CAPA[c]).join(' · ');
        if (trafomix) detalle += ` — ${trafomix.total} clientes mayores`;
      } else if (precompilado) {
        const n = (precompilado.clientes || []).filter((c) => c.alimentador === a.id).length;
        detalle = n ? `${n} clientes mayores (paquete precompilado)` : 'sin clientes mayores';
      } else {
        detalle = 'sin datos — cargar KMZ';
      }

      return `
        <div class="campana-fila" data-alim="${a.id}">
          <div class="campana-info">
            <div class="campana-nombre">Alimentador ${a.id}</div>
            <div class="campana-detalle">${detalle}</div>
          </div>
          <div class="campana-flecha">›</div>
        </div>`;
    }).join('');

    const migas = sis.sets.length > 1
      ? `<span data-volver="sistemas">Sistemas</span> › <span data-volver="sets" data-codigo="${sis.codigo}">${sis.nombre}</span> › <strong>SET ${set.nombre}</strong>`
      : `<span data-volver="sistemas">Sistemas</span> › <strong>SET ${set.nombre}</strong>`;

    pintar('Alimentador', migas, filas);
    conectarMigas();
    $('#campana-cuerpo').querySelectorAll('[data-alim]').forEach((el) => {
      el.addEventListener('click', () => elegirAlimentador(el.dataset.alim));
    });
  }

  async function elegirAlimentador(id) {
    alimentador = id;
    localStorage.setItem(CLAVE_ALIM, id);
    await cargarCapasDeZona();
    actualizarSubtitulo();
    redibujar();
    ir(renderClientes);
  }

  /* --------------------------------------------------------------- clientes */

  async function renderClientes() {
    const paquetes = await MapDB.getPaquetesDeZona(zonaActual());
    const { hechos, total } = resumenAvance(clientes);

    const tira = CAPAS.map((c) => {
      const activa = paquetes.find((p) => p.capa === c && p.activa);
      const n = (capas[c] || []).length;
      const clase = activa ? 'ok' : (n ? 'respaldo' : 'falta');
      const detalle = activa ? `${activa.total}` : (n ? `${n}` : 'sin archivo');
      return `<div class="capa-chip ${clase}" data-capa="${c}">
          <div class="capa-nombre">${NOMBRE_CAPA[c]}</div>
          <div class="capa-detalle">${detalle}</div>
        </div>`;
    }).join('');

    const filas = clientes.map((c) => {
      const estado = estadoDe(c);
      return `
        <div class="campana-fila cliente" data-cliente="${c.sed}">
          <div class="estado-punto ${estado}"></div>
          <div class="campana-info">
            <div class="campana-nombre">${c.nombre || c.etiqueta || '(sin nombre)'}</div>
            <div class="campana-detalle">${c.etiqueta || c.sed}${c.potencia_kva ? ' · ' + c.potencia_kva : ''}</div>
          </div>
          <div class="campana-flecha">›</div>
        </div>`;
    }).join('');

    const encontrado = buscarSet(setActual.slug);
    const migas = `<span data-volver="sistemas">Sistemas</span> › <span data-volver="alimentadores">SET ${encontrado.set.nombre}</span> › <strong>Alim. ${alimentador}</strong>`;

    // El botón cambia según lo que falte: una vez cargadas las tres capas ya no
    // invita a cargar de nuevo, para que nadie duplique cargas por las dudas.
    const faltan = CAPAS.filter((c) => !paquetes.some((p) => p.capa === c && p.activa));
    const botonCarga = faltan.length === 0
      ? `<div class="carga-estado">
           <span class="carga-tilde">✓</span>
           <div>
             <div class="carga-titulo">Datos cargados</div>
             <div class="carga-sub">Las tres capas de este alimentador están listas</div>
           </div>
           <button class="mini" id="btn-cargar-kmz">Agregar</button>
         </div>`
      : `<button class="btn-cargar" id="btn-cargar-kmz">
           <span class="icono">⬆</span>
           <span>Cargar KMZ · falta ${faltan.map((c) => NOMBRE_CAPA[c]).join(', ')}</span>
         </button>`;

    pintar(`Clientes mayores (${hechos}/${total})`, migas, `
      <div class="capa-tira">${tira}</div>
      ${botonCarga}
      ${filas || '<div class="campana-vacio">No hay clientes mayores cargados en este alimentador.</div>'}`);
    conectarMigas();

    $('#btn-cargar-kmz').addEventListener('click', () => pedirArchivos(null));
    $('#campana-cuerpo').querySelectorAll('[data-capa]').forEach((el) => {
      el.addEventListener('click', () => ir(() => renderCargas(el.dataset.capa)));
    });
    $('#campana-cuerpo').querySelectorAll('[data-cliente]').forEach((el) => {
      el.addEventListener('click', () => abrirFicha(el.dataset.cliente));
    });
  }

  /* -------------------------------------------------------- cargas por capa */

  async function renderCargas(capa) {
    const paquetes = (await MapDB.getPaquetesDeZona(zonaActual()))
      .filter((p) => p.capa === capa)
      .sort((a, b) => b.fecha.localeCompare(a.fecha));

    const filas = paquetes.map((p) => `
        <div class="campana-fila" style="cursor:default">
          <div class="campana-info">
            <div class="campana-nombre">${p.etiqueta} ${p.activa ? '<span class="chip-activa">activa</span>' : ''}</div>
            <div class="campana-detalle">${p.total} elementos · ${p.archivo}</div>
          </div>
          <div class="carga-acciones">
            ${p.activa ? '' : `<button class="mini" data-activar="${p.id}">Usar</button>`}
            <button class="mini peligro" data-borrar="${p.id}">Borrar</button>
          </div>
        </div>`).join('');

    const activa = paquetes.find((p) => p.activa);
    const boton = activa
      ? `<div class="carga-estado">
           <span class="carga-tilde">✓</span>
           <div>
             <div class="carga-titulo">${NOMBRE_CAPA[capa]} cargado</div>
             <div class="carga-sub">${activa.total} elementos · ${activa.etiqueta}</div>
           </div>
           <button class="mini" id="btn-cargar-capa">Reemplazar</button>
         </div>`
      : `<button class="btn-cargar" id="btn-cargar-capa">
           <span class="icono">⬆</span>
           <span>Cargar archivo de ${NOMBRE_CAPA[capa]}</span>
         </button>`;

    pintar(`${NOMBRE_CAPA[capa]} · Alim. ${alimentador}`, '', `
      ${boton}
      ${filas || '<div class="campana-vacio">Todavía no se cargó ningún archivo de esta capa.</div>'}`);

    $('#btn-cargar-capa').addEventListener('click', () => pedirArchivos(capa));
    $('#campana-cuerpo').querySelectorAll('[data-activar]').forEach((el) => {
      el.addEventListener('click', async () => {
        await MapDB.activarPaquete(el.dataset.activar);
        await cargarCapasDeZona();
        redibujar();
        actualizarSubtitulo();
        refrescarVista();
      });
    });
    $('#campana-cuerpo').querySelectorAll('[data-borrar]').forEach((el) => {
      el.addEventListener('click', async () => {
        await MapDB.deletePaquete(el.dataset.borrar);
        await cargarCapasDeZona();
        redibujar();
        actualizarSubtitulo();
        refrescarVista();
        AppBridge.showToast('Carga borrada');
      });
    });
  }

  /* ------------------------------------------------------- importar archivos */

  function pedirArchivos(capa) {
    capaCargando = capa;
    const input = $('#carga-input');
    input.value = '';
    input.click();
  }

  async function importarArchivos(archivos) {
    let importados = 0;
    const avisos = [];

    for (const file of archivos) {
      let leido;
      try {
        leido = await KmzParser.leer(file);
      } catch (e) {
        avisos.push(`${file.name}: ${e.message}`);
        continue;
      }

      const capa = capaCargando || leido.capa;
      if (!capa) {
        avisos.push(`${file.name}: no se reconoce la capa por el nombre del archivo`);
        continue;
      }
      if (!CAPAS.includes(capa)) {
        avisos.push(`${file.name}: la capa "${capa}" no se usa en esta pantalla`);
        continue;
      }
      // El archivo puede ser de otro alimentador: se avisa y no se importa,
      // porque mezclarlos deja al técnico trabajando sobre una zona equivocada.
      if (leido.alimentador && leido.alimentador !== alimentador) {
        avisos.push(`${file.name}: es del alimentador ${leido.alimentador}, no del ${alimentador}`);
        continue;
      }

      const ahora = new Date();
      const id = `${zonaActual()}/${capa}/${ahora.getTime()}`;
      await MapDB.putPaquete({
        id,
        zona: zonaActual(),
        setSlug: setActual.slug,
        alimentador,
        capa,
        archivo: file.name,
        fecha: ahora.toISOString(),
        etiqueta: `Carga del ${ahora.toLocaleDateString('es-PE')}`,
        total: leido.total,
        adjuntos: leido.adjuntos,
        activa: true,
        elementos: leido.elementos,
      });
      await MapDB.activarPaquete(id);
      importados++;
    }

    await cargarCapasDeZona();
    redibujar();
    actualizarSubtitulo();
    refrescarVista();

    if (avisos.length) AppBridge.showToast(avisos.join(' · '), 6000);
    else AppBridge.showToast(`${importados} archivo(s) cargado(s)`, 3000);
  }

  /* ----------------------------------------------------------- ficha cliente */

  const ETIQUETAS = {
    trafomix: 'Código Trafomix', sed: 'Código SED', etiqueta: 'Etiqueta',
    serie: 'Serie', marca: 'Marca', modelo: 'Modelo',
    tipo_trafomix: 'Tipo', fases: 'Fases', anio_fabricacion: 'Año de fabricación',
    relacion_tension: 'Relación de tensión', relacion_corriente: 'Relación de corriente',
    potencia_tension: 'Potencia en tensión', potencia_corriente: 'Potencia en corriente',
    estructura: 'Estructura', tramo: 'Tramo MT', localidad: 'Localidad',
    propietario: 'Propietario', potencia_kva: 'Potencia (kVA)', direccion: 'Dirección',
  };

  /* Los campos de la SED que pidió el ingeniero, en su orden. Vienen los 11 en
     el 100% de los registros de Ananea, salvo "etiqueta anterior" (100/118). */
  const ETIQUETAS_SED = {
    alimentador: 'Código de salida MT', etiqueta: 'Etiqueta de campo',
    nombre: 'Nombre SED', direccion: 'Dirección SED', propietario: 'Propietario',
    potencia_kva: 'Potencia instalada (kVA)', fases_primario: 'Fases primario',
    tension_primaria_kv: 'Tensión nominal primario (kV)',
    sistema: 'Código de sistema eléctrico',
    sed_etiqueta_anterior: 'SED: etiqueta anterior', sielse_etiqueta: 'SIELSE: etiqueta',
  };

  function esc(v) {
    return String(v).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function filasDe(fuente, etiquetas) {
    return Object.keys(etiquetas)
      .filter((k) => fuente[k] !== undefined && fuente[k] !== '')
      .map((k) => `<div class="ficha-fila"><span>${etiquetas[k]}</span>`
        + `<strong>${esc(fuente[k])}</strong></div>`)
      .join('');
  }

  /* Ficha de una SED: es solo consulta, acá no se toma ningún dato — lo que se
     inspecciona es el trafomix del cliente. */
  function abrirFichaSed(p, latlng) {
    $('#cliente-nombre').textContent = p.nombre || p.etiqueta || 'SED';
    $('#cliente-sub').textContent =
      `SED ${p.etiqueta || ''} · Alimentador ${p.alimentador || alimentador || ''}`;
    $('#cliente-cuerpo').innerHTML = filasDe(p, ETIQUETAS_SED);

    $('#cliente-ir-btn').hidden = false;
    $('#cliente-ir-btn').onclick = () => {
      AppBridge.closeSheet('#overlay-cliente');
      AppBridge.closeSheet('#overlay-campana');
      map().setView(latlng, 18);
    };
    $('#cliente-encuesta-btn').hidden = true;

    AppBridge.openSheet('#overlay-cliente');
  }

  function abrirFicha(clave) {
    const c = clientes.find((x) => x.sed === clave);
    if (!c) return;
    const fuente = c.gis || c;

    $('#cliente-nombre').textContent = c.nombre || c.etiqueta || c.sed;
    $('#cliente-sub').textContent = `${c.etiqueta || c.sed} · Alimentador ${c.alimentador}`;
    $('#cliente-cuerpo').innerHTML = filasDe(fuente, ETIQUETAS);
    $('#cliente-ir-btn').hidden = false;
    $('#cliente-encuesta-btn').hidden = false;

    $('#cliente-ir-btn').onclick = () => {
      AppBridge.closeSheet('#overlay-cliente');
      AppBridge.closeSheet('#overlay-campana');
      map().setView([c.lat, c.lon], 18);
      if (marcadores[c.sed]) marcadores[c.sed].openTooltip();
    };

    const estado = estadoDe(c);
    const btn = $('#cliente-encuesta-btn');
    btn.textContent = estado === 'pendiente' ? 'Iniciar toma de datos'
      : estado === 'borrador' ? 'Continuar toma de datos' : 'Ver toma de datos';
    btn.onclick = () => {
      AppBridge.closeSheet('#overlay-cliente');
      AppBridge.closeSheet('#overlay-campana');
      Encuesta.abrir(Object.assign({ setSlug: setActual.slug }, c));
    };

    AppBridge.openSheet('#overlay-cliente');
  }

  /* ------------------------------------------------------------------ migas */

  function conectarMigas() {
    $('#campana-migas').querySelectorAll('[data-volver]').forEach((el) => {
      el.addEventListener('click', () => {
        const a = el.dataset.volver;
        if (a === 'sistemas') { pila = []; reemplazar(renderSistemas); }
        else if (a === 'sets') {
          const sis = catalogo.sistemas.find((s) => s.codigo === el.dataset.codigo);
          pila = [renderSistemas];
          reemplazar(() => renderSets(sis));
        } else if (a === 'alimentadores') {
          const sis = buscarSet(setActual.slug).sistema;
          pila = [renderSistemas];
          if (sis.sets.length > 1) pila.push(() => renderSets(sis));
          reemplazar(renderAlimentadores);
        }
      });
    });
  }

  /* ---------------------------------------------------------------- arranque */

  function actualizarSubtitulo() {
    const el = $('#subtitle-text');
    if (!el) return;
    if (!setActual) { el.textContent = 'Elegir zona de trabajo'; return; }
    if (!alimentador) { el.textContent = `SET ${setActual.nombre}`; return; }
    const { hechos, total } = resumenAvance(clientes);
    el.textContent = `Alim. ${alimentador} · ${hechos}/${total}`;
  }

  async function iniciar() {
    try {
      await cargarCatalogo();
    } catch (e) {
      AppBridge.showToast(e.message, 4000);
      return;
    }
    try { estados = await MapDB.getEstadosEncuestas(); }
    catch (e) { console.warn('No se pudieron leer los estados:', e); estados = {}; }

    const slug = localStorage.getItem(CLAVE_SET);
    const alim = localStorage.getItem(CLAVE_ALIM);
    if (slug && buscarSet(slug) && getTecnico()) {
      const encontrado = buscarSet(slug);
      setActual = { slug, nombre: encontrado.set.nombre, sistema: encontrado.sistema };
      if (encontrado.set.disponible) {
        try { precompilado = await (await fetch(`data/set-${slug}.json`)).json(); }
        catch (e) { precompilado = null; }
      }
      if (alim) {
        alimentador = alim;
        await cargarCapasDeZona();
        redibujar();
      }
      actualizarSubtitulo();
      return;
    }
    actualizarSubtitulo();
    abrirSelector();
  }

  function hayZonaActiva() { return !!setActual; }
  function etiquetaActual() {
    if (!setActual) return '';
    return alimentador ? `SET ${setActual.nombre} · Alim. ${alimentador}` : `SET ${setActual.nombre}`;
  }

  return {
    iniciar, abrirSelector, hayZonaActiva, etiquetaActual,
    redibujar, getTecnico, refrescarEstados, atras, importarArchivos,
  };
})();

window.Campana = Campana;

const esVisible = (sel) => document.querySelector(sel).classList.contains('visible');

document.querySelector('#campana-atras').addEventListener('click', () => Campana.atras());
document.querySelector('#cliente-atras').addEventListener('click',
  () => AppBridge.closeSheet('#overlay-cliente'));

document.querySelector('#carga-input').addEventListener('change', (e) => {
  const archivos = [...e.target.files];
  if (archivos.length) Campana.importarArchivos(archivos);
});

/* Botón físico de Android. La toma de datos maneja el suyo (encuesta.js), por
   eso acá se devuelve false cuando ese panel está abierto. */
AppBridge.registrarAtras(() => {
  if (esVisible('#overlay-encuesta')) return false;
  if (esVisible('#overlay-cliente')) {
    AppBridge.closeSheet('#overlay-cliente');
    return true;
  }
  if (!esVisible('#overlay-campana')) return false;
  if (Campana.atras()) return true;
  AppBridge.closeSheet('#overlay-campana');
  return true;
});
