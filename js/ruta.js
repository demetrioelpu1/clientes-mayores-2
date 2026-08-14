/* ruta.js — el recorrido numerado de la inspección.

   Cada punto pertenece a una toma de datos y a un bloque del formulario. El
   número es el de la inspección, así que los tres puntos de un mismo cliente
   —trafomix, medidor y transformador— llevan el MISMO número, y ese número es
   la fila del Excel. Una vez asignado no se mueve.

   El técnico marca tocando la pantalla, no con el GPS: puede estar del otro
   lado de un alambrado y el equipo a quince metros. El GPS se guarda junto al
   punto, con su precisión, como respaldo y control de dónde estaba parado.

   La línea NO une los puntos en recta: sigue los tramos de MT. La red del
   alimentador resultó ser un árbol perfectamente conectado (en el 3001, 555
   tramos y 556 nodos en una sola componente), así que entre dos puntos hay un
   único camino posible y no hay que elegir nada. */

const Ruta = (() => {
  'use strict';

  const COLOR = '#7cff6b';
  const ORDEN_BLOQUE = { trafomix: 0, medidor: 1, transformador: 2 };

  let puntos = [];
  let grupo = null;
  let zona = null;
  let visible = true;
  let esperando = null;        // resolve() del marcado en curso
  let alCambiar = null;

  const map = () => AppBridge.map;

  function icono(n, bloque) {
    return L.divIcon({
      className: `marcador-ruta bloque-${bloque}`,
      html: `<span>${n}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  /* ------------------------------------------------------- grafo de la red */

  let grafo = null;            // nodo -> [{ vecino, coords }]

  const clave = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

  function armarGrafo() {
    grafo = new Map();
    const tramos = (window.Campana && Campana.getTramos()) || [];
    tramos.forEach((f) => {
      const c = f.geometry && f.geometry.coordinates;
      if (!c || c.length < 2) return;
      const a = clave(c[0]);
      const b = clave(c[c.length - 1]);
      if (a === b) return;
      if (!grafo.has(a)) grafo.set(a, []);
      if (!grafo.has(b)) grafo.set(b, []);
      grafo.get(a).push({ vecino: b, coords: c });
      grafo.get(b).push({ vecino: a, coords: [...c].reverse() });
    });
    return grafo;
  }

  function metros(a, b) {
    return Math.hypot((a[0] - b[0]) * 107700, (a[1] - b[1]) * 110570);
  }

  function nodoMasCercano(lonlat) {
    let mejor = null, mejorD = Infinity;
    grafo.forEach((_, k) => {
      const p = k.split(',').map(Number);
      const d = metros(p, lonlat);
      if (d < mejorD) { mejorD = d; mejor = k; }
    });
    return { nodo: mejor, dist: mejorD };
  }

  /* Camino entre dos nodos. La red es un árbol, así que un BFS simple da el
     único camino que existe; no hace falta Dijkstra ni pesos. */
  function caminoEntre(desde, hasta) {
    if (desde === hasta) return [];
    const previo = new Map([[desde, null]]);
    const cola = [desde];
    while (cola.length) {
      const n = cola.shift();
      if (n === hasta) break;
      for (const arista of (grafo.get(n) || [])) {
        if (previo.has(arista.vecino)) continue;
        previo.set(arista.vecino, { de: n, coords: arista.coords });
        cola.push(arista.vecino);
      }
    }
    if (!previo.has(hasta)) return null;      // sin camino: red incompleta
    const tramos = [];
    let n = hasta;
    while (previo.get(n)) {
      tramos.unshift(previo.get(n).coords);
      n = previo.get(n).de;
    }
    return tramos;
  }

  /* Devuelve la polilínea entre dos puntos: el ramal desde cada uno hasta la
     red, y el camino por los tramos entre medio. */
  function tramoEntre(a, b) {
    const A = [a.lon, a.lat], B = [b.lon, b.lat];
    if (!grafo || !grafo.size) return [A, B];
    const na = nodoMasCercano(A), nb = nodoMasCercano(B);
    const camino = caminoEntre(na.nodo, nb.nodo);
    if (!camino) return [A, B];
    const linea = [A];
    camino.forEach((coords) => coords.forEach((c) => linea.push(c)));
    linea.push(B);
    return linea;
  }

  /* ---------------------------------------------------------------- dibujo */

  function ordenados() {
    return [...puntos].sort((x, y) =>
      (x.orden - y.orden) || (ORDEN_BLOQUE[x.bloque] - ORDEN_BLOQUE[y.bloque]));
  }

  function limpiarCapa() {
    if (grupo) map().removeLayer(grupo);
    grupo = null;
  }

  function redibujar() {
    limpiarCapa();
    avisarCambio();
    if (!visible || !puntos.length) return;

    grupo = L.layerGroup().addTo(map());
    armarGrafo();

    const lista = ordenados();
    for (let i = 1; i < lista.length; i++) {
      const linea = tramoEntre(lista[i - 1], lista[i]);
      L.polyline(linea.map((c) => [c[1], c[0]]), {
        color: COLOR, weight: 4, opacity: 0.85,
      }).addTo(grupo);
    }

    lista.forEach((p) => {
      L.marker([p.lat, p.lon], { icon: icono(p.orden, p.bloque), keyboard: false, zIndexOffset: 700 })
        .bindTooltip(`Punto ${p.orden} · ${p.bloque} · ${p.etiqueta || ''}`, { direction: 'top' })
        .on('click', () => abrirToma(p))
        .addTo(grupo);
    });
  }

  /* La chapita es la puerta de entrada a su toma de datos: el técnico la ve en
     el mapa, la toca y sigue llenando ese equipo. Abre en el bloque del punto
     que tocó —si tocó la del medidor, arranca en MEDIDOR—, no en el primero
     incompleto: si tocó ese punto es porque quiere ese equipo. */
  async function abrirToma(p) {
    const [slug, alim] = String(p.zona).split('/');
    const cliente = await Campana.irACliente(slug, alim, p.sed);
    if (!cliente) {
      AppBridge.showToast('No encuentro ese equipo en el mapa. Cargá el KMZ de ese alimentador.', 5000);
      return;
    }
    AppBridge.closeSheet('#overlay-cliente');
    AppBridge.closeSheet('#overlay-campana');
    await Encuesta.abrir(cliente, p.bloque);
  }

  /* -------------------------------------------------------------- marcado */

  function posicionGps() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: +pos.coords.latitude.toFixed(7),
          lon: +pos.coords.longitude.toFixed(7),
          precision: Math.round(pos.coords.accuracy),
        }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      );
    });
  }

  /* Abre el mapa para que el técnico toque. Devuelve el punto, o null si
     canceló. Lo llama encuesta.js desde el bloque correspondiente. */
  function marcar(ctx) {
    return new Promise((resolve) => {
      esperando = { ctx, resolve };
      document.querySelector('#ruta-estado').textContent =
        `Tocá en el mapa dónde está ${ctx.que} — punto ${ctx.orden}`;
      document.querySelector('#ruta-toolbar').classList.add('visible');
      map().getContainer().classList.add('marcando-ruta');
      // Centra en la posición del técnico para que toque ahí nomás.
      posicionGps().then((g) => {
        if (esperando && g) map().setView([g.lat, g.lon], Math.max(map().getZoom(), 18));
      });
    });
  }

  function cancelarMarcado() {
    if (!esperando) return;
    const { resolve } = esperando;
    cerrarMarcado();
    resolve(null);
  }

  function cerrarMarcado() {
    esperando = null;
    document.querySelector('#ruta-toolbar').classList.remove('visible');
    map().getContainer().classList.remove('marcando-ruta');
  }

  function marcando() { return Boolean(esperando); }

  async function tocoElMapa(latlng) {
    if (!esperando) return;
    const { ctx, resolve } = esperando;
    const gps = await posicionGps();
    const punto = {
      id: `${zona}/${ctx.sed}/${ctx.bloque}`,
      zona,
      sed: ctx.sed,
      bloque: ctx.bloque,
      orden: ctx.orden,
      etiqueta: ctx.etiqueta || '',
      lat: +latlng.lat.toFixed(7),
      lon: +latlng.lng.toFixed(7),
      gps,
      fecha: new Date().toISOString(),
      tecnico: (window.Campana && Campana.getTecnico()) || '',
    };
    await MapDB.putPuntoRuta(punto);
    puntos = puntos.filter((p) => p.id !== punto.id).concat(punto);
    cerrarMarcado();
    redibujar();

    if (gps) {
      const lejos = Math.round(metros([punto.lon, punto.lat], [gps.lon, gps.lat]));
      if (lejos > 100) {
        AppBridge.showToast(`Marcaste a ${lejos} m de donde estás parado. Si te equivocaste, rehacelo.`, 6000);
      }
    }
    resolve(punto);
  }

  /* --------------------------------------------------------------- estado */

  /* Borra el punto de un equipo. No pide confirmación a propósito: el número
     vive en la toma de datos, así que volver a marcar devuelve el mismo. Es
     reversible en dos toques y en el cerro un diálogo de más estorba. */
  async function borrar(sed, bloque) {
    const p = puntos.find((x) => x.sed === sed && x.bloque === bloque);
    if (!p) return false;
    await MapDB.deletePuntoRuta(p.id);
    puntos = puntos.filter((x) => x.id !== p.id);
    redibujar();
    AppBridge.showToast(`Punto ${p.orden} borrado. Podés volver a marcarlo.`, 4000);
    return true;
  }

  async function cargarZona(nuevaZona) {
    zona = nuevaZona;
    puntos = zona ? await MapDB.getRutaDeZona(zona) : [];
    grafo = null;
    redibujar();
  }

  function alternarVisible() {
    visible = !visible;
    redibujar();
    return visible;
  }

  function avisarCambio() {
    if (alCambiar) alCambiar(puntos.length, visible);
  }

  function geojson() {
    const lista = ordenados();
    const features = lista.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        orden: p.orden, bloque: p.bloque, cliente: p.etiqueta, sed: p.sed,
        fecha: p.fecha, tecnico: p.tecnico,
        gps_lat: p.gps ? p.gps.lat : null,
        gps_lon: p.gps ? p.gps.lon : null,
        gps_precision_m: p.gps ? p.gps.precision : null,
      },
    }));
    if (lista.length > 1) {
      if (!grafo) armarGrafo();
      const linea = [];
      for (let i = 1; i < lista.length; i++) {
        tramoEntre(lista[i - 1], lista[i]).forEach((c) => linea.push(c));
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: linea },
        properties: { tipo: 'recorrido', puntos: lista.length, zona },
      });
    }
    return { type: 'FeatureCollection', features };
  }

  function cuantos() { return puntos.length; }
  function alCambiarPuntos(fn) { alCambiar = fn; }

  return { cargarZona, marcar, borrar, cancelarMarcado, marcando, tocoElMapa,
           alternarVisible, geojson, cuantos, alCambiarPuntos, redibujar };
})();

window.Ruta = Ruta;
