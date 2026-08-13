/* campana.js — Fase 2: elegir dónde se trabaja y ver qué hay que hacer ahí.

   Cascada:  SISTEMA ELÉCTRICO → SET → ALIMENTADOR → clientes mayores

   Los datos salen de archivos preparados en la PC (data/catalogo.json y
   data/set-<slug>.json). El celular nunca lee un KMZ: eso ya se convirtió
   antes con tools/build_app_data.py. */

const Campana = (() => {
  'use strict';

  const CLAVE_SET = 'catastro:campana:set';
  const CLAVE_ALIM = 'catastro:campana:alimentador';
  const CLAVE_TECNICO = 'catastro:tecnico';

  const COLOR = {
    tramos_mt: '#e0553b',
    postes_mt: '#e0553b',
    sed_publicas: '#7a8290',
    pendiente: '#d4af1f',
    borrador: '#f5822a',
    completa: '#3fa85f',
  };

  let catalogo = null;
  let paquete = null;          // paquete de la SET activa
  let alimentador = null;      // código del alimentador activo, o null = todos
  let grupos = {};             // capas Leaflet de la red
  let grupoClientes = null;
  let marcadores = {};         // código SED -> marcador

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

  async function cargarPaquete(slug) {
    const res = await fetch(`data/set-${slug}.json`);
    if (!res.ok) throw new Error(`No hay datos descargados para esta SET`);
    return res.json();
  }

  function buscarSet(slug) {
    for (const sis of catalogo.sistemas) {
      const s = sis.sets.find((x) => x.slug === slug);
      if (s) return { sistema: sis, set: s };
    }
    return null;
  }

  /* Clientes visibles según el alimentador elegido. */
  function clientesVisibles() {
    if (!paquete) return [];
    if (!alimentador) return paquete.clientes;
    return paquete.clientes.filter((c) => c.alimentador === alimentador);
  }

  /* ------------------------------------------------- estado de cada encuesta

     pendiente = ni empezada · borrador = empezada · completa = todo lleno.
     Se lee una sola vez de IndexedDB y se guarda en memoria: la lista y los
     marcadores se pintan sin esperar al disco. */

  let estados = {};

  async function refrescarEstados() {
    estados = await MapDB.getEstadosEncuestas();
    if (paquete) {
      redibujar();
      actualizarSubtitulo();
    }
  }

  function estadoDe(cliente) {
    return estados[cliente.sed] || 'pendiente';
  }

  function resumenAvance(lista) {
    const hechos = lista.filter((c) => estadoDe(c) === 'completa').length;
    return { hechos, total: lista.length };
  }

  /* ------------------------------------------------------------------- mapa */

  function limpiarMapa() {
    Object.values(grupos).forEach((g) => map().removeLayer(g));
    grupos = {};
    if (grupoClientes) map().removeLayer(grupoClientes);
    grupoClientes = null;
    marcadores = {};
  }

  function dibujarRed() {
    const capas = paquete.capas || {};

    if (capas.tramos_mt) {
      grupos.tramos_mt = L.geoJSON(filtrarPorAlimentador(capas.tramos_mt), {
        style: { color: COLOR.tramos_mt, weight: 3, opacity: 0.85 },
        onEachFeature: (f, capa) => {
          const p = f.properties;
          capa.bindTooltip(`Tramo MT ${p.tramo || ''} · ${p.tension_kv || '—'} kV`, { direction: 'top' });
        },
      }).addTo(map());
    }

    if (capas.postes_mt) {
      grupos.postes_mt = L.geoJSON(filtrarPorAlimentador(capas.postes_mt), {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, {
          radius: 3, weight: 1, color: '#ffffff', fillColor: COLOR.postes_mt, fillOpacity: 0.9,
        }),
        onEachFeature: (f, capa) => {
          capa.bindTooltip(`Poste MT ${f.properties.estructura || ''}`, { direction: 'top' });
        },
      }).addTo(map());
    }

    if (capas.sed_publicas) {
      grupos.sed_publicas = L.geoJSON(filtrarPorAlimentador(capas.sed_publicas), {
        pointToLayer: (f, latlng) => L.circleMarker(latlng, {
          radius: 4, weight: 1, color: '#ffffff', fillColor: COLOR.sed_publicas, fillOpacity: 0.85,
        }),
        onEachFeature: (f, capa) => {
          const p = f.properties;
          capa.bindTooltip(`SED ${p.etiqueta || p.sed} · ${p.potencia_kva || '—'} kVA (Electro Puno)`, { direction: 'top' });
        },
      }).addTo(map());
    }
  }

  function filtrarPorAlimentador(fc) {
    if (!alimentador) return fc;
    return {
      type: 'FeatureCollection',
      features: fc.features.filter((f) => f.properties.alimentador === alimentador),
    };
  }

  function dibujarClientes() {
    grupoClientes = L.layerGroup().addTo(map());
    clientesVisibles().forEach((c) => {
      const estado = estadoDe(c);
      const m = L.circleMarker([c.lat, c.lon], {
        radius: 9,
        weight: 3,
        color: '#ffffff',
        fillColor: COLOR[estado],
        fillOpacity: 1,
      });
      m.bindTooltip(`${c.etiqueta || c.sed} · ${c.nombre || ''}`, { direction: 'top' });
      m.on('click', () => abrirFicha(c.sed));
      m.addTo(grupoClientes);
      marcadores[c.sed] = m;
    });
  }

  function redibujar() {
    limpiarMapa();
    if (!paquete) return;
    dibujarRed();
    dibujarClientes();
    encuadrar();
  }

  function encuadrar() {
    const lista = clientesVisibles();
    if (!lista.length) return;
    const bounds = L.latLngBounds(lista.map((c) => [c.lat, c.lon]));
    map().fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }

  function irACliente(cliente) {
    map().setView([cliente.lat, cliente.lon], 18);
    const m = marcadores[cliente.sed];
    if (m) m.openTooltip();
  }

  /* --------------------------------------------------------------- selector */

  /* ------------------------------------------------------- pila de pantallas

     En celular no alcanza con las migas de pan (texto de 11 px): hace falta
     una flecha de Atrás con área de toque real y que el botón físico de
     Android haga lo mismo. Cada pantalla es una función que sabe dibujarse,
     así volver es simplemente llamar a la anterior. */

  let pila = [];
  let vistaActual = null;

  function ir(fn) {
    if (vistaActual) pila.push(vistaActual);
    vistaActual = fn;
    fn();
  }

  function reemplazar(fn) {
    vistaActual = fn;
    fn();
  }

  function atras() {
    const anterior = pila.pop();
    if (!anterior) return false;
    vistaActual = anterior;
    anterior();
    return true;
  }

  function abrirSelector() {
    pila = [];
    vistaActual = null;
    // Antes de elegir la zona hay que saber quién está trabajando: ese nombre
    // va en cada toma de datos (bloque CLIENTE del formato de campo).
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

  function getTecnico() {
    return localStorage.getItem(CLAVE_TECNICO) || '';
  }

  function barraTecnico() {
    const nombre = getTecnico();
    if (!nombre) return '';
    return `
      <div class="campana-tecnico">
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
           agrega solo a cada encuesta que registres.</p>
        <input type="text" id="tecnico-input" placeholder="Ej: Juan Pérez Quispe"
               autocomplete="name" value="${nombre}" />
        <button class="btn-primary" id="tecnico-btn" style="width:100%; padding:12px;">Continuar</button>
      </div>`;

    const input = $('#tecnico-input');
    const guardar = () => {
      const valor = input.value.trim();
      if (valor.length < 3) {
        AppBridge.showToast('Escribe tu nombre para continuar');
        return;
      }
      localStorage.setItem(CLAVE_TECNICO, valor);
      // Si vino de "Cambiar", vuelve a donde estaba; si es el arranque, sigue.
      if (!atras()) reemplazar(renderSistemas);
    };
    $('#tecnico-btn').addEventListener('click', guardar);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') guardar(); });
    setTimeout(() => input.focus(), 60);
  }

  function renderSistemas() {
    const filas = catalogo.sistemas
      .filter((s) => !s.rural)
      .map((s) => {
        const conDatos = s.sets.filter((x) => x.disponible).length;
        const clientes = s.sets.reduce((a, x) => a + (x.clientes || 0), 0);
        const detalle = conDatos
          ? `${clientes} cliente(s) mayor(es)`
          : 'sin datos — falta el KMZ';
        return `
          <div class="campana-fila ${conDatos ? '' : 'sin-datos'}" data-sistema="${s.codigo}">
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
    // Si el sistema tiene una sola SET, no tiene sentido preguntar: se salta.
    if (sis.sets.length === 1) {
      elegirSet(sis.sets[0].slug);
      return;
    }
    ir(() => renderSets(sis));
  }

  function renderSets(sis) {
    const filas = sis.sets
      .map((s) => {
        const detalle = s.disponible
          ? `${s.clientes} cliente(s) mayor(es) · ${s.kb} KB`
          : 'sin datos — falta el KMZ';
        return `
          <div class="campana-fila ${s.disponible ? '' : 'sin-datos'}" data-set="${s.slug}">
            <div class="campana-info">
              <div class="campana-nombre">SET ${s.nombre}</div>
              <div class="campana-detalle">${s.alimentadores.length} alimentadores · ${detalle}</div>
            </div>
            <div class="campana-flecha">›</div>
          </div>`;
      })
      .join('');

    pintar('Subestación (SET)', `<span data-volver="sistemas">Sistemas</span> › <strong>${sis.nombre}</strong>`, filas);
    conectarMigas();

    $('#campana-cuerpo').querySelectorAll('[data-set]').forEach((el) => {
      el.addEventListener('click', () => elegirSet(el.dataset.set));
    });
  }

  async function elegirSet(slug) {
    const encontrado = buscarSet(slug);
    if (!encontrado) return;
    if (!encontrado.set.disponible) {
      AppBridge.showToast('Esta SET todavía no tiene datos cargados', 2800);
      return;
    }
    try {
      paquete = await cargarPaquete(slug);
    } catch (e) {
      AppBridge.showToast(e.message, 3000);
      return;
    }
    alimentador = null;
    localStorage.setItem(CLAVE_SET, slug);
    localStorage.removeItem(CLAVE_ALIM);
    actualizarSubtitulo();
    redibujar();
    ir(renderAlimentadores);
  }

  function renderAlimentadores() {
    const encontrado = buscarSet(paquete.slug);
    const set = encontrado.set;
    const sis = encontrado.sistema;

    const todos = resumenAvance(paquete.clientes);
    const filas = set.alimentadores
      .map((a) => {
        const lista = paquete.clientes.filter((c) => c.alimentador === a.id);
        const { hechos, total } = resumenAvance(lista);
        if (!total) {
          return `
            <div class="campana-fila sin-datos">
              <div class="campana-info">
                <div class="campana-nombre">Alimentador ${a.id}</div>
                <div class="campana-detalle">sin clientes mayores</div>
              </div>
            </div>`;
        }
        return `
          <div class="campana-fila" data-alim="${a.id}">
            <div class="campana-info">
              <div class="campana-nombre">Alimentador ${a.id}</div>
              <div class="campana-detalle">${total} cliente(s) mayor(es) · ${hechos} hecho(s)</div>
            </div>
            <div class="campana-flecha">›</div>
          </div>`;
      })
      .join('');

    const migas = sis.sets.length > 1
      ? `<span data-volver="sistemas">Sistemas</span> › <span data-volver="sets" data-codigo="${sis.codigo}">${sis.nombre}</span> › <strong>SET ${set.nombre}</strong>`
      : `<span data-volver="sistemas">Sistemas</span> › <strong>SET ${set.nombre}</strong>`;

    const todosFila = `
      <div class="campana-fila destacada" data-alim="">
        <div class="campana-info">
          <div class="campana-nombre">Toda la SET</div>
          <div class="campana-detalle">${todos.total} cliente(s) mayor(es) · ${todos.hechos} hecho(s)</div>
        </div>
        <div class="campana-flecha">›</div>
      </div>`;

    pintar('Alimentador', migas, todosFila + filas);
    conectarMigas();

    $('#campana-cuerpo').querySelectorAll('[data-alim]').forEach((el) => {
      el.addEventListener('click', () => elegirAlimentador(el.dataset.alim || null));
    });
  }

  function elegirAlimentador(id) {
    alimentador = id;
    if (id) localStorage.setItem(CLAVE_ALIM, id);
    else localStorage.removeItem(CLAVE_ALIM);
    actualizarSubtitulo();
    redibujar();
    ir(renderClientes);
  }

  function renderClientes() {
    const lista = clientesVisibles();
    const encontrado = buscarSet(paquete.slug);
    const { hechos, total } = resumenAvance(lista);

    const filas = lista
      .map((c) => {
        const estado = estadoDe(c);
        return `
          <div class="campana-fila cliente" data-cliente="${c.sed}">
            <div class="estado-punto ${estado}"></div>
            <div class="campana-info">
              <div class="campana-nombre">${c.nombre || '(sin nombre)'} ${c.dudoso ? '<span class="etiqueta-dudoso">verificar</span>' : ''}</div>
              <div class="campana-detalle">${c.etiqueta || c.sed} · Alim. ${c.alimentador} · ${c.potencia_kva || '—'} kVA</div>
            </div>
            <div class="campana-flecha">›</div>
          </div>`;
      })
      .join('');

    const migas = `<span data-volver="sistemas">Sistemas</span> › <span data-volver="alimentadores">SET ${encontrado.set.nombre}</span> › <strong>${alimentador ? 'Alim. ' + alimentador : 'Toda la SET'}</strong>`;

    pintar(
      `Clientes mayores (${hechos}/${total})`,
      migas,
      filas || '<div class="campana-vacio">No hay clientes mayores en este alimentador.</div>'
    );
    conectarMigas();

    $('#campana-cuerpo').querySelectorAll('[data-cliente]').forEach((el) => {
      el.addEventListener('click', () => abrirFicha(el.dataset.cliente));
    });
  }

  /* Las migas saltan varios niveles de una vez, así que rearman la pila para
     que la flecha de Atrás siga siendo coherente después del salto. */
  function conectarMigas() {
    $('#campana-migas').querySelectorAll('[data-volver]').forEach((el) => {
      el.addEventListener('click', () => {
        const a = el.dataset.volver;
        if (a === 'sistemas') {
          pila = [];
          reemplazar(renderSistemas);
        } else if (a === 'sets') {
          const sis = catalogo.sistemas.find((s) => s.codigo === el.dataset.codigo);
          pila = [renderSistemas];
          reemplazar(() => renderSets(sis));
        } else if (a === 'alimentadores') {
          const sis = buscarSet(paquete.slug).sistema;
          pila = [renderSistemas];
          if (sis.sets.length > 1) pila.push(() => renderSets(sis));
          reemplazar(renderAlimentadores);
        }
      });
    });
  }

  /* ----------------------------------------------------------- ficha cliente */

  const ETIQUETAS = {
    sed: 'Código SED', etiqueta: 'Etiqueta de campo', nombre: 'Nombre',
    direccion: 'Dirección', alimentador: 'Alimentador', potencia_kva: 'Potencia (kVA)',
    tipo_sed: 'Tipo de SED', tipo_instalacion: 'Instalación', fases_primario: 'Fases primario',
    tension_primaria_kv: 'Tensión primaria (kV)', tension_secundaria_ff_kv: 'Tensión secundaria F-F (kV)',
    n_transformadores: 'N.° de transformadores', codigo_tecnico: 'Código técnico',
    estructura: 'Estructura', tramo: 'Tramo MT', localidad: 'Localidad', propietario: 'Propietario',
  };

  function abrirFicha(codigoSed) {
    const c = paquete.clientes.find((x) => x.sed === codigoSed);
    if (!c) return;

    const filas = Object.keys(ETIQUETAS)
      .filter((k) => c[k] !== undefined && c[k] !== '')
      .map((k) => `<div class="ficha-fila"><span>${ETIQUETAS[k]}</span><strong>${c[k]}</strong></div>`)
      .join('');

    const aviso = c.dudoso
      ? `<div class="ficha-aviso">Este punto figura como uso de utilización pero el propietario
         registrado es «${c.propietario}». Confirmar en campo si corresponde a un cliente mayor.</div>`
      : '';

    $('#cliente-nombre').textContent = c.nombre || c.etiqueta || c.sed;
    $('#cliente-sub').textContent = `${c.etiqueta || c.sed} · Alimentador ${c.alimentador}`;
    $('#cliente-cuerpo').innerHTML = aviso + filas;
    $('#cliente-ir-btn').onclick = () => {
      AppBridge.closeSheet('#overlay-cliente');
      AppBridge.closeSheet('#overlay-campana');
      irACliente(c);
    };
    const estado = estadoDe(c);
    const btn = $('#cliente-encuesta-btn');
    btn.textContent = estado === 'pendiente' ? 'Iniciar toma de datos'
      : estado === 'borrador' ? 'Continuar toma de datos' : 'Ver toma de datos';
    btn.onclick = () => {
      AppBridge.closeSheet('#overlay-cliente');
      AppBridge.closeSheet('#overlay-campana');
      // El slug de la SET va en la encuesta para poder exportar por zona (Fase 4).
      Encuesta.abrir(Object.assign({ setSlug: paquete.slug }, c));
    };

    AppBridge.openSheet('#overlay-cliente');
  }

  /* ----------------------------------------------------------------- arranque */

  function actualizarSubtitulo() {
    const el = document.querySelector('#subtitle-text');
    if (!el) return;
    if (!paquete) {
      el.textContent = 'Elegir zona de trabajo';
      return;
    }
    const lista = clientesVisibles();
    const { hechos, total } = resumenAvance(lista);
    const donde = alimentador ? `Alim. ${alimentador}` : `SET ${paquete.set}`;
    el.textContent = `${donde} · ${hechos}/${total}`;
  }

  async function iniciar() {
    try {
      await cargarCatalogo();
    } catch (e) {
      AppBridge.showToast(e.message, 4000);
      return;
    }
    // Si los estados no se pueden leer, la app igual tiene que abrir: se
    // muestran todos como pendientes en vez de dejar la pantalla vacía.
    try {
      estados = await MapDB.getEstadosEncuestas();
    } catch (e) {
      console.warn('No se pudieron leer los estados de las encuestas:', e);
      estados = {};
    }

    const slug = localStorage.getItem(CLAVE_SET);
    if (slug && buscarSet(slug) && getTecnico()) {
      try {
        paquete = await cargarPaquete(slug);
        alimentador = localStorage.getItem(CLAVE_ALIM) || null;
        actualizarSubtitulo();
        redibujar();
        return;
      } catch (e) {
        // el paquete ya no está: se vuelve a preguntar
      }
    }
    actualizarSubtitulo();
    abrirSelector();
  }

  function terminar() {
    paquete = null;
    alimentador = null;
    localStorage.removeItem(CLAVE_SET);
    localStorage.removeItem(CLAVE_ALIM);
    limpiarMapa();
    actualizarSubtitulo();
    abrirSelector();
  }

  function hayZonaActiva() {
    return !!paquete;
  }

  function etiquetaActual() {
    if (!paquete) return '';
    return alimentador ? `SET ${paquete.set} · Alim. ${alimentador}` : `SET ${paquete.set}`;
  }

  return {
    iniciar, abrirSelector, terminar, hayZonaActiva, etiquetaActual,
    redibujar, getTecnico, refrescarEstados, atras,
  };
})();

/* `const` en un script clásico NO crea una propiedad de window: sin esta línea,
   los `if (window.Campana)` de app.js dan falso y los botones no hacen nada. */
window.Campana = Campana;

const esVisible = (sel) => document.querySelector(sel).classList.contains('visible');

document.querySelector('#campana-atras').addEventListener('click', () => Campana.atras());
document.querySelector('#cliente-atras').addEventListener('click',
  () => AppBridge.closeSheet('#overlay-cliente'));

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
