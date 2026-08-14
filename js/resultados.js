/* resultados.js — Fase 4: ver lo levantado y descargarlo.

   El Excel se arma desde `exportacion.columnas` del esquema, así que las 48
   columnas del formato de Ananea salen en su orden original y sin que nadie
   las transcriba a mano en el código.

   Las fotos NO van dentro del Excel: 16 por cliente a ~250 KB harían un archivo
   imposible de abrir. Van en un .zip, una carpeta por cliente, junto al Excel. */

const Resultados = (() => {
  'use strict';

  let esquema = null;
  let tipos = null;   // "bloque.campo" -> definición, para saber qué es número

  const $ = (sel) => document.querySelector(sel);

  async function cargarEsquema() {
    if (esquema) return esquema;
    esquema = await (await fetch('data/encuesta.json')).json();
    tipos = {};
    esquema.bloques.forEach((b) =>
      b.pasos.forEach((p) =>
        (p.campos || []).forEach((c) => { tipos[`${b.id}.${c.id}`] = c; })));
    return esquema;
  }

  /* ------------------------------------------------------------------ panel */

  async function abrir() {
    await cargarEsquema();
    const todas = await MapDB.getAllEncuestas();
    render(todas);
    AppBridge.openSheet('#overlay-resultados');
  }

  function render(todas) {
    const completas = todas.filter((e) => e.estado === 'completa');
    const borradores = todas.filter((e) => e.estado !== 'completa');

    const porSet = {};
    todas.forEach((e) => {
      const k = e.setSlug || '(sin SET)';
      porSet[k] = porSet[k] || { completas: 0, borradores: 0 };
      porSet[k][e.estado === 'completa' ? 'completas' : 'borradores']++;
    });

    const resumen = `
      <div class="res-tarjetas">
        <div class="res-tarjeta"><div class="res-num verde">${completas.length}</div><div class="res-lbl">completas</div></div>
        <div class="res-tarjeta"><div class="res-num naranja">${borradores.length}</div><div class="res-lbl">a medias</div></div>
        <div class="res-tarjeta"><div class="res-num">${todas.length}</div><div class="res-lbl">en total</div></div>
      </div>`;

    const porSetHtml = Object.keys(porSet).length
      ? `<div class="section-label">POR SET</div>` +
        Object.entries(porSet).map(([slug, n]) => `
          <div class="campana-fila" style="cursor:default">
            <div class="campana-info">
              <div class="campana-nombre">${slug}</div>
              <div class="campana-detalle">${n.completas} completa(s) · ${n.borradores} a medias</div>
            </div>
          </div>`).join('')
      : '';

    const lista = todas.length
      ? `<div class="section-label">TOMAS DE DATOS</div>` +
        todas
          .slice()
          .sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''))
          .map((e) => `
            <div class="campana-fila" data-ver="${e.sed}"
                 data-set="${e.setSlug || ''}" data-alim="${e.alimentador || ''}">
              <div class="estado-punto ${e.estado === 'completa' ? 'completa' : 'borrador'}"></div>
              <div class="campana-info">
                <div class="campana-nombre">${e.nombre || e.etiqueta || e.sed}</div>
                <div class="campana-detalle">Alim. ${e.alimentador} · ${e.tecnico || '—'} · ${fecha(e.actualizado)}</div>
              </div>
              <div class="campana-flecha">›</div>
            </div>`).join('')
      : '<div class="campana-vacio">Todavía no hay ninguna toma de datos registrada.</div>';

    $('#resultados-cuerpo').innerHTML = resumen + porSetHtml + lista;

    $('#resultados-excel').disabled = todas.length === 0;
    $('#resultados-zip').disabled = todas.length === 0;

    /* Tocar una toma de datos lleva al equipo en el mapa y abre el formulario
       en el primer bloque que le falte. Sirve sobre todo para las que quedaron
       a medias: desde acá se ve cuáles son y se va derecho a terminarlas. */
    $('#resultados-cuerpo').querySelectorAll('[data-ver]').forEach((el) => {
      el.addEventListener('click', async () => {
        const cliente = await Campana.irACliente(el.dataset.set, el.dataset.alim, el.dataset.ver);
        if (!cliente) {
          AppBridge.showToast(
            'No encuentro ese equipo en el mapa. Cargá el KMZ de ese alimentador y volvé a intentar.', 6000);
          return;
        }
        AppBridge.closeSheet('#overlay-resultados');
        AppBridge.closeSheet('#overlay-campana');
        Encuesta.abrir(cliente);
      });
    });
  }

  function fecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /* ------------------------------------------------------- armado del Excel */

  function valorDe(encuesta, col, item) {
    if (col.origen === 'item') return item;
    if (col.origen === 'gis.nombre') return encuesta.nombre || '';
    if (col.origen === 'coordenadas') {
      const c = encuesta.datos.cliente || {};
      if (c.latitud === undefined || c.latitud === null) return '';
      return `${c.latitud}, ${c.longitud}`;
    }
    if (!col.campo) return '';

    const [bloque, campo] = col.campo.split('.');
    let v = (encuesta.datos[bloque] || {})[campo];
    if (v === undefined || v === null || v === '') return '';

    // "0,5" y "0.5" tienen que caer en el mismo valor al ordenar o agrupar.
    if (col.normalizar === 'decimal') {
      const n = Number(String(v).replace(',', '.'));
      return Number.isFinite(n) ? n : v;
    }
    const def = tipos[col.campo];
    if (def && (def.tipo === 'decimal' || def.tipo === 'entero')) {
      const n = Number(String(v).replace(',', '.'));
      return Number.isFinite(n) ? n : v;
    }
    return v;
  }

  function construirLibro(todas) {
    const cols = esquema.exportacion.columnas;

    // Fila 1: grupos (TRAFOMIX, SISTEMA DE MEDICIÓN, …) fusionados.
    const grupos = cols.map((c) => c.grupo || '');
    const merges = [];
    let i = 0;
    while (i < grupos.length) {
      const g = grupos[i];
      let j = i;
      while (j + 1 < grupos.length && grupos[j + 1] === g) j++;
      if (g && j > i) merges.push({ fila: 1, desde: i + 1, hasta: j + 1 });
      i = j + 1;
    }

    const filas = [
      XlsxWriter.fila(1, grupos, 1),
      XlsxWriter.fila(2, cols.map((c) => c.header), 1),
    ];

    todas.forEach((e, n) => {
      filas.push(XlsxWriter.fila(n + 3, cols.map((c) => valorDe(e, c, n + 1))));
    });

    const anchos = cols.map((c) => Math.min(38, Math.max(12, c.header.length + 3)));
    return XlsxWriter.crear({
      nombreHoja: esquema.exportacion.hoja,
      filas,
      merges,
      anchos,
    });
  }

  /* ---------------------------------------------------------------- descarga */

  function bajar(bytes, nombre, tipo) {
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function nombreBase(todas) {
    const sets = [...new Set(todas.map((e) => e.setSlug).filter(Boolean))];
    const zona = sets.length === 1 ? sets[0] : 'varias-set';
    const hoy = new Date().toISOString().slice(0, 10);
    return `Toma de datos - ${zona} - ${hoy}`;
  }

  async function descargarExcel() {
    const todas = await MapDB.getAllEncuestas();
    if (!todas.length) return;
    const bytes = construirLibro(todas);
    bajar(bytes, `${nombreBase(todas)}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    AppBridge.showToast(`Excel con ${todas.length} fila(s) descargado`, 3000);
  }

  /* Carpeta por cliente, con el nombre de la foto tal como lo pide el formato. */
  function nombreCarpeta(e) {
    const ruta = (e.datos.cliente || {}).codigo_ruta;
    const base = ruta ? `${ruta} - ${e.nombre || e.sed}` : (e.nombre || e.sed);
    return base.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
  }

  function etiquetaFoto(bloqueId, fotoId) {
    for (const b of esquema.bloques) {
      if (b.id !== bloqueId) continue;
      for (const p of b.pasos) {
        const f = (p.fotos || []).find((x) => x.id === fotoId);
        if (f) return { n: f.n, label: f.label };
      }
    }
    return { n: 0, label: fotoId };
  }

  async function descargarTodo() {
    const todas = await MapDB.getAllEncuestas();
    if (!todas.length) return;

    AppBridge.showToast('Armando el paquete…', 8000);
    const entradas = {};
    entradas[`${nombreBase(todas)}.xlsx`] = construirLibro(todas);

    let nFotos = 0;
    for (const e of todas) {
      const carpeta = nombreCarpeta(e);
      for (const clave of Object.keys(e.fotos || {})) {
        const [bloqueId, fotoId] = clave.split('/');
        const blob = await MapDB.getFoto(MapDB.fotoKey(e.sed, bloqueId, fotoId));
        if (!blob) continue;
        const { n, label } = etiquetaFoto(bloqueId, fotoId);
        const limpio = label.replace(/[\\/:*?"<>|]/g, '-');
        const nombre = `fotos/${carpeta}/${bloqueId} ${String(n).padStart(2, '0')} ${limpio}.jpg`;
        entradas[nombre] = new Uint8Array(await blob.arrayBuffer());
        nFotos++;
      }
    }

    // Las fotos ya son JPEG: recomprimirlas no gana nada y tarda mucho.
    const zip = fflate.zipSync(entradas, { level: 0 });
    bajar(zip, `${nombreBase(todas)}.zip`, 'application/zip');
    AppBridge.showToast(`Paquete listo: ${todas.length} toma(s) y ${nFotos} foto(s)`, 4000);
  }

  return { abrir, descargarExcel, descargarTodo };
})();

window.Resultados = Resultados;

document.querySelector('#btn-resultados').addEventListener('click', () => Resultados.abrir());
/* El recorrido va acá y no en el mapa: es algo que se entrega, como el Excel. */
document.querySelector('#resultados-geojson').addEventListener('click', () => {
  if (!window.Ruta || !Ruta.cuantos()) {
    AppBridge.showToast('Todavía no hay recorrido marcado en este alimentador.', 4000);
    return;
  }
  const gj = Ruta.geojson();
  const blob = new Blob([JSON.stringify(gj, null, 1)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `recorrido ${Campana.etiquetaActual() || ''}.geojson`.replace(/\s+/g, ' ').trim();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  AppBridge.showToast(`Descargando el recorrido (${Ruta.cuantos()} puntos)`, 3000);
});

document.querySelector('#resultados-excel').addEventListener('click', () => Resultados.descargarExcel());
document.querySelector('#resultados-zip').addEventListener('click', () => Resultados.descargarTodo());
