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
  let seleccionadas = new Set();   // seds marcados con el check, para bajar/borrar solo esos

  const $ = (sel) => document.querySelector(sel);

  async function cargarEsquema() {
    if (esquema) return esquema;
    esquema = await (await fetch(rutaData('encuesta.json'))).json();
    tipos = {};
    esquema.bloques.forEach((b) =>
      b.pasos.forEach((p) =>
        (p.campos || []).forEach((c) => { tipos[`${b.id}.${c.id}`] = c; })));
    return esquema;
  }

  /* ------------------------------------------------------------------ panel */

  async function abrir() {
    await cargarEsquema();
    seleccionadas = new Set();
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

    const cabeceraLista = todas.length
      ? `<div class="section-label res-lista-cabecera">
           <span>TOMAS DE DATOS</span>
           <label class="res-sel-todo">
             <input type="checkbox" class="res-check" id="res-check-todo">
             Seleccionar todo
           </label>
         </div>`
      : '';

    const lista = todas.length
      ? cabeceraLista +
        todas
          .slice()
          .sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''))
          .map((e) => `
            <div class="campana-fila" data-ver="${e.sed}"
                 data-set="${e.setSlug || ''}" data-alim="${e.alimentador || ''}">
              <input type="checkbox" class="res-check" data-sel="${e.sed}"
                     ${seleccionadas.has(e.sed) ? 'checked' : ''}>
              <div class="estado-punto ${e.estado === 'completa' ? 'completa' : 'borrador'}"></div>
              <div class="campana-info">
                <div class="campana-nombre">${e.nombre || e.etiqueta || e.sed}</div>
                <div class="campana-detalle">Alim. ${e.alimentador} · ${e.tecnico || '—'} · ${fecha(e.actualizado)}</div>
              </div>
              <div class="campana-flecha">›</div>
            </div>`).join('')
      : '<div class="campana-vacio">Todavía no hay ninguna toma de datos registrada.</div>';

    const barraSeleccion = seleccionadas.size
      ? `<div class="res-acciones">
           <button class="mini peligro" id="resultados-borrar-sel" style="flex:1;padding:10px;">
             🗑 Borrar ${seleccionadas.size} seleccionada(s)
           </button>
         </div>`
      : '';

    $('#resultados-cuerpo').innerHTML = resumen + porSetHtml + lista + barraSeleccion;

    $('#resultados-excel').disabled = todas.length === 0;
    $('#resultados-zip').disabled = todas.length === 0;
    // Los botones bajan solo la selección si hay alguna marcada; si no hay
    // ninguna, siguen bajando todo como siempre (no hace falta seleccionar
    // nada para el uso de siempre).
    $('#resultados-excel').textContent = seleccionadas.size
      ? `⬇ Solo Excel (${seleccionadas.size})` : '⬇ Solo Excel';
    $('#resultados-zip').textContent = seleccionadas.size
      ? `⬇ Excel + fotos (${seleccionadas.size})` : '⬇ Excel + fotos';

    /* El check no tiene que disparar la navegación de la fila (data-ver). */
    $('#resultados-cuerpo').querySelectorAll('[data-sel]').forEach((chk) => {
      chk.addEventListener('click', (ev) => ev.stopPropagation());
      chk.addEventListener('change', () => {
        if (chk.checked) seleccionadas.add(chk.dataset.sel);
        else seleccionadas.delete(chk.dataset.sel);
        render(todas);
      });
    });
    const checkTodo = $('#res-check-todo');
    if (checkTodo) {
      checkTodo.addEventListener('click', (ev) => ev.stopPropagation());
      checkTodo.addEventListener('change', () => {
        seleccionadas = checkTodo.checked ? new Set(todas.map((e) => e.sed)) : new Set();
        render(todas);
      });
    }
    const btnBorrarSel = $('#resultados-borrar-sel');
    if (btnBorrarSel) {
      // Doble toque para confirmar, mismo patrón que "Eliminar" en los
      // recortes de mapa (app.js) — nada de confirm() nativo en una PWA táctil.
      let confirmando = false;
      btnBorrarSel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!confirmando) {
          confirmando = true;
          btnBorrarSel.textContent = '¿Seguro? Tocá de nuevo';
          setTimeout(() => {
            confirmando = false;
            if (document.body.contains(btnBorrarSel)) {
              btnBorrarSel.textContent = `🗑 Borrar ${seleccionadas.size} seleccionada(s)`;
            }
          }, 3000);
          return;
        }
        borrarSeleccionadas();
      });
    }

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

  /* Borra la toma de datos completa (registro + fotos + su punto de
     recorrido), igual que "Borrar" en un equipo nuevo de la lista de
     clientes (campana.js). El doble toque de confirmación está en el botón
     (ver render): acá puede ser más de una toma, y a diferencia del equipo
     "nuevo" puede tratarse de tomas ya sincronizadas — no es tan reversible. */
  async function borrarSeleccionadas() {
    const seds = [...seleccionadas];
    if (!seds.length) return;
    for (const sed of seds) {
      await MapDB.deleteEncuesta(sed);
      if (window.Ruta) await Ruta.borrarTodos(sed);
    }
    seleccionadas = new Set();
    const todas = await MapDB.getAllEncuestas();
    render(todas);
    AppBridge.showToast(`${seds.length} toma(s) borrada(s)`, 3000);
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
    if (col.origen === 'observaciones') {
      // No es un campo de texto único: es la lista que arma el técnico. Van
      // todas juntas en la misma columna (no se agrega una 49.ª), numeradas
      // como texto — es la única forma sin tocar el formato de 48 columnas.
      // El número es la posición real en la lista, la misma que llevan sus
      // fotos en el .zip, así "Observación 2" dice lo mismo en los dos lados
      // aunque alguna observación se haya quedado sin texto (solo fotos).
      const lista = ((encuesta.datos.observaciones || {}).lista) || [];
      return lista
        .map((o, i) => ({ n: i + 1, texto: (o.texto || '').trim() }))
        .filter((o) => o.texto)
        .map((o) => `${o.n}. ${o.texto}`)
        .join('\n');
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

  /* `conFotos` solo es true en el paquete .zip: en el Excel suelto los enlaces
     apuntarían a una carpeta que no está y darían error al tocarlos. */
  function construirLibro(todas, conFotos) {
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

    /* El nombre del cliente lleva el enlace a su carpeta de fotos. Va en una
       columna que ya existe: agregar una 49.ª rompería el formato de Ananea. */
    const colNombre = cols.findIndex((c) => c.origen === 'gis.nombre');
    const enlaces = [];

    todas.forEach((e, n) => {
      const valores = cols.map((c) => valorDe(e, c, n + 1));
      const estilos = {};
      if (conFotos && colNombre >= 0 && Object.keys(e.fotos || {}).length) {
        estilos[colNombre] = 2;                       // azul subrayado
        enlaces.push({
          ref: XlsxWriter.columna(colNombre + 1) + (n + 3),
          destino: `fotos/${nombreCarpeta(e)}/`,
        });
      }
      filas.push(XlsxWriter.fila(n + 3, valores, null, estilos));
    });

    const anchos = cols.map((c) => Math.min(38, Math.max(12, c.header.length + 3)));
    return XlsxWriter.crear({
      nombreHoja: esquema.exportacion.hoja,
      filas,
      merges,
      anchos,
      enlaces,
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

  /* Si hay algo marcado con el check, exporta solo eso — así se puede bajar
     de a partes cuando ya hay demasiadas tomas/fotos para armar todo junto
     (ver descargarTodo). Sin nada marcado, se sigue bajando todo como
     siempre. */
  async function paraExportar() {
    const todas = await MapDB.getAllEncuestas();
    return seleccionadas.size ? todas.filter((e) => seleccionadas.has(e.sed)) : todas;
  }

  async function descargarExcel() {
    const elegidas = await paraExportar();
    if (!elegidas.length) return;
    try {
      const bytes = construirLibro(elegidas);
      bajar(bytes, `${nombreBase(elegidas)}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      AppBridge.showToast(`Excel con ${elegidas.length} fila(s) descargado`, 3000);
    } catch (err) {
      console.error(err);
      AppBridge.showToast('No se pudo armar el Excel. Probá de nuevo o con menos tomas seleccionadas.', 6000);
    }
  }

  /* Carpeta por cliente, con el nombre de la foto tal como lo pide el formato. */
  /* Lo que identifica al equipo en un nombre de archivo: el código de ruta que
     el técnico leyó de la etiqueta pegada, y si no lo escribió, la clave. */
  function identificador(e) {
    const ruta = (e.datos.cliente || {}).codigo_ruta;
    return String(ruta || e.sed).replace(/[\\/:*?"<>|]/g, '-').slice(0, 30);
  }

  function nombreCarpeta(e) {
    const ruta = (e.datos.cliente || {}).codigo_ruta;
    const base = ruta ? `${ruta} - ${e.nombre || e.sed}` : (e.nombre || e.sed);
    return base.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60);
  }

  function etiquetaFoto(bloqueId, fotoId, e) {
    // Las fotos de una observación no salen de un esquema fijo: la lista la
    // arma el técnico. El número es la posición real en esa lista, la misma
    // que ya lleva en la columna OBSERVACIÓN del Excel.
    if (bloqueId === 'observaciones' && fotoId.startsWith('obs_')) {
      const obsId = fotoId.slice(4);
      const lista = ((e.datos.observaciones || {}).lista) || [];
      const i = lista.findIndex((o) => o.id === obsId);
      return { n: i + 1, label: i >= 0 ? `Observación ${i + 1}` : 'Observación' };
    }
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
    const elegidas = await paraExportar();
    if (!elegidas.length) return;

    AppBridge.showToast('Armando el paquete…', 8000);
    try {
      const entradas = {};
      entradas[`${nombreBase(elegidas)}.xlsx`] = construirLibro(elegidas, true);

      let nFotos = 0;
      for (const e of elegidas) {
        const carpeta = nombreCarpeta(e);
        for (const clave of Object.keys(e.fotos || {})) {
          const [bloqueId, fotoId] = clave.split('/');
          const valor = e.fotos[clave];
          const { n, label } = etiquetaFoto(bloqueId, fotoId, e);
          const limpio = label.replace(/[\\/:*?"<>|]/g, '-');
          const base = MapDB.fotoKey(e.sed, bloqueId, fotoId);
          /* El nombre del archivo lleva el identificador del equipo además de la
             carpeta: si una foto se saca de su carpeta —se reenvía suelta por
             WhatsApp, se copia a otro lado— tiene que seguir diciendo de quién es. */
          const nombreBase = `fotos/${carpeta}/${identificador(e)} - ${bloqueId} ${String(n).padStart(2, '0')} ${limpio}`;

          // "mediciones"/"extra" son grupos: cero, una o varias fotos guardadas
          // como lista de sub-ids, no una sola como el resto de los campos.
          const subIds = Array.isArray(valor) ? valor : null;
          if (subIds) {
            for (let i = 0; i < subIds.length; i++) {
              const blob = await MapDB.getFoto(`${base}/${subIds[i]}`);
              if (!blob) continue;
              entradas[`${nombreBase} ${i + 1}.jpg`] = new Uint8Array(await blob.arrayBuffer());
              nFotos++;
            }
            continue;
          }

          const blob = await MapDB.getFoto(base);
          if (!blob) continue;
          entradas[`${nombreBase}.jpg`] = new Uint8Array(await blob.arrayBuffer());
          nFotos++;
        }
      }

      // Las fotos ya son JPEG: recomprimirlas no gana nada y tarda mucho.
      const zip = fflate.zipSync(entradas, { level: 0 });
      bajar(zip, `${nombreBase(elegidas)}.zip`, 'application/zip');
      AppBridge.showToast(`Paquete listo: ${elegidas.length} toma(s) y ${nFotos} foto(s)`, 4000);
    } catch (err) {
      // Con muchas tomas y fotos reales el paquete puede pesar cientos de MB:
      // en un celular de gama baja `zipSync` puede quedarse sin memoria. Sin
      // este catch, esto fallaba en silencio (el toast de "Armando..." se
      // apagaba solo y no pasaba nada más) — para el técnico eso se ve
      // igual que "no me deja descargar".
      console.error(err);
      AppBridge.showToast(
        'No se pudo armar el paquete (probablemente por el tamaño). Marcá menos tomas con el check y probá de nuevo.',
        7000);
    }
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
