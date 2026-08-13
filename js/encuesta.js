/* encuesta.js — Fase 3: la TOMA DE DATOS de campo.

   Se recorre paso a paso (2-4 campos por pantalla) en vez de un formulario
   largo con scroll: en campo, con el celular en una mano, una pantalla corta
   con un botón grande de Siguiente es mucho más rápida y se salta menos campos.

   No hay campos escritos a mano acá: todo sale de data/encuesta.json (copia de
   schema/encuesta.json). Si el ingeniero cambia una columna, se corrige el
   esquema y el formulario y el Excel salen solos. */

const Encuesta = (() => {
  'use strict';

  /* Una foto de celular pesa 3-5 MB. Con 16 fotos por cliente eso son ~64 MB
     por toma de datos y el técnico se queda sin espacio a mitad de campaña.
     A 1600 px y calidad 0.7 una placa o un número de precinto se siguen
     leyendo perfecto y cada foto queda en ~250 KB. */
  const FOTO_LADO_MAX = 1600;
  const FOTO_CALIDAD = 0.7;

  let esquema = null;
  let pasos = [];          // lista plana: {bloque, paso}
  let indice = 0;
  let cliente = null;
  let datos = null;        // { bloque: { campo: valor } }
  let fotos = null;        // { "bloque/idFoto": true } — los Blobs viven en IndexedDB
  let guardadoPendiente = null;

  const $ = (sel) => document.querySelector(sel);

  async function cargarEsquema() {
    if (esquema) return esquema;
    const res = await fetch('data/encuesta.json');
    if (!res.ok) throw new Error('No se encontró data/encuesta.json');
    esquema = await res.json();
    pasos = [];
    esquema.bloques.forEach((bloque) => {
      bloque.pasos.forEach((paso) => pasos.push({ bloque, paso }));
    });
    return esquema;
  }

  /* ------------------------------------------------------------------ abrir */

  async function abrir(clienteGis) {
    await cargarEsquema();
    cliente = clienteGis;

    const guardada = await MapDB.getEncuesta(cliente.sed);
    datos = guardada ? guardada.datos : {};
    fotos = guardada ? guardada.fotos || {} : {};

    autocompletar();
    indice = primerPasoIncompleto();
    render();
    AppBridge.openSheet('#overlay-encuesta');
  }

  /* Al continuar una toma de datos a medias, se abre en el primer bloque que
     todavía tenga algo pendiente. */
  function primerPasoIncompleto() {
    const i = esquema.bloques.findIndex((b) => {
      const c = contarBloque(b);
      return c.llenos < c.total || c.fotos < c.totalFotos;
    });
    return i === -1 ? 0 : i;
  }

  /* Lo que la app ya sabe no se le pregunta al técnico. */
  function autocompletar() {
    datos.cliente = datos.cliente || {};
    const c = datos.cliente;
    if (!c.responsable) c.responsable = Campana.getTecnico();
    if (!c.fecha_inspeccion) c.fecha_inspeccion = new Date().toISOString().slice(0, 10);
    c.alimentador = cliente.alimentador || '';
    c.sistema_electrico = cliente.sistema || '';
    if (!c.latitud) { c.latitud = cliente.lat; c.longitud = cliente.lon; }
    tomarGps();
  }

  function tomarGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        datos.cliente.latitud = +pos.coords.latitude.toFixed(7);
        datos.cliente.longitud = +pos.coords.longitude.toFixed(7);
        datos.cliente.precision_gps = Math.round(pos.coords.accuracy);
        guardar();
        pintarAutomaticos();
      },
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  }

  /* Los campos automáticos no son inputs: se muestran como ficha de solo
     lectura. Así no puede pasar que el dato interno y lo que se ve en
     pantalla queden distintos. */
  function pintarAutomaticos() {
    const caja = $('#encuesta-auto');
    if (!caja) return;
    const c = datos.cliente || {};
    const gps = c.precision_gps === undefined
      ? `${c.latitud}, ${c.longitud} <em>(del GIS — buscando señal GPS…)</em>`
      : `${c.latitud}, ${c.longitud} · ±${c.precision_gps} m`;
    caja.innerHTML = `
      <div><span>Técnico</span><strong>${c.responsable || '—'}</strong></div>
      <div><span>Fecha</span><strong>${c.fecha_inspeccion || '—'}</strong></div>
      <div><span>Alimentador</span><strong>${c.alimentador || '—'}</strong></div>
      <div><span>Sistema</span><strong>${c.sistema_electrico || '—'}</strong></div>
      <div class="ancho"><span>Ubicación</span><strong>${gps}</strong></div>`;
  }

  /* ---------------------------------------------------------------- dibujar */

  /* Se navega por BLOQUE (5), no por paso (22): el desplegable de 22 opciones
     que había antes se volvía una lista interminable en el celular. Adentro de
     cada bloque los grupos siguen separados, pero todos a la vista y en una
     sola pantalla que se recorre bajando. */
  function render() {
    const bloque = esquema.bloques[indice];

    $('#encuesta-titulo').textContent = cliente.nombre || cliente.etiqueta || cliente.sed;
    $('#encuesta-sub').textContent =
      `${cliente.etiqueta || cliente.sed} · Alim. ${cliente.alimentador} · ${cliente.potencia_kva || '—'} kVA`;

    renderSelector();
    $('#encuesta-barra-relleno').style.width = `${((indice + 1) / esquema.bloques.length) * 100}%`;

    const grupos = bloque.pasos.map((paso) => renderGrupo(bloque, paso)).join('');
    $('#encuesta-cuerpo').innerHTML =
      grupos + (indice === 0 ? '<div class="auto-ficha" id="encuesta-auto"></div>' : '');

    $('#encuesta-atras').disabled = indice === 0;
    $('#encuesta-siguiente').textContent =
      indice === esquema.bloques.length - 1 ? 'Terminar' : 'Siguiente';

    if (indice === 0) pintarAutomaticos();
    conectar();
    actualizarProgreso();
    bloque.pasos.forEach((paso) => { if (paso.fotos) pintarFotosGuardadas(bloque, paso); });
  }

  function renderGrupo(bloque, paso) {
    const ayuda = paso.ayuda ? `<div class="grupo-ayuda">${paso.ayuda}</div>` : '';
    const cuerpo = paso.fotos
      ? `<div class="foto-grilla">${paso.fotos.map((f) => renderFoto(bloque, f)).join('')}</div>`
      : (paso.campos || []).map((campo) => renderCampo(bloque, campo)).join('');
    return `
      <div class="grupo">
        <div class="grupo-titulo">${paso.titulo}</div>
        ${ayuda}
        ${cuerpo}
      </div>`;
  }

  function contarBloque(bloque) {
    let llenos = 0, total = 0, fotosOk = 0, totalFotos = 0;
    bloque.pasos.forEach((paso) => {
      const c = contarPaso({ bloque, paso });
      llenos += c.llenos; total += c.total;
      fotosOk += c.fotos; totalFotos += c.totalFotos;
    });
    return { llenos, total, fotos: fotosOk, totalFotos };
  }

  function resumenBloque(bloque) {
    const c = contarBloque(bloque);
    const partes = [`${c.llenos}/${c.total}`];
    if (c.totalFotos) partes.push(`${c.fotos}/${c.totalFotos} fotos`);
    return { texto: partes.join(' · '), completo: c.llenos === c.total && c.fotos === c.totalFotos };
  }

  /* Desplegable propio: el <select> nativo de Android se abre como una lista
     a pantalla completa que no se puede estilar. */
  function renderSelector() {
    const bloque = esquema.bloques[indice];
    const r = resumenBloque(bloque);
    $('#bloque-actual').innerHTML = `
      <span class="bloque-nom">${bloque.titulo}</span>
      <span class="bloque-cont ${r.completo ? 'completo' : ''}">${r.texto}</span>
      <span class="bloque-caret">▾</span>`;

    $('#bloque-lista').innerHTML = esquema.bloques.map((b, i) => {
      const rb = resumenBloque(b);
      return `
        <div class="bloque-op ${i === indice ? 'actual' : ''}" data-bloque-idx="${i}">
          <span class="bloque-marca">${rb.completo ? '✓' : '○'}</span>
          <span class="bloque-nom">${b.titulo}</span>
          <span class="bloque-cont ${rb.completo ? 'completo' : ''}">${rb.texto}</span>
        </div>`;
    }).join('');

    $('#bloque-lista').querySelectorAll('[data-bloque-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        cerrarSelector();
        irA(+el.dataset.bloqueIdx);
      });
    });
  }

  function abrirSelector() { $('#bloque-lista').hidden = false; $('#bloque-actual').classList.add('abierto'); }
  function cerrarSelector() { $('#bloque-lista').hidden = true; $('#bloque-actual').classList.remove('abierto'); }
  function alternarSelector() {
    if ($('#bloque-lista').hidden) abrirSelector(); else cerrarSelector();
  }

  function renderCampo(bloque, campo) {
    const valor = (datos[bloque.id] || {})[campo.id];
    const v = valor === undefined || valor === null ? '' : String(valor);

    if (campo.tipo === 'lista') {
      const opciones = ['<option value=""></option>']
        .concat(campo.opciones.map((o) => `<option value="${o}" ${v === o ? 'selected' : ''}>${o}</option>`))
        .join('');
      return `
        <div class="campo">
          <label>${campo.label}</label>
          <select data-bloque="${bloque.id}" data-campo="${campo.id}">${opciones}</select>
        </div>`;
    }

    if (campo.tipo === 'texto_largo') {
      return `
        <div class="campo">
          <label>${campo.label}</label>
          <textarea rows="4" data-bloque="${bloque.id}" data-campo="${campo.id}">${v}</textarea>
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
        ${renderReferencia(campo, v)}
      </div>`;
  }

  /* --------------------------------------------------- referencia del GIS

     A propósito NO se rellena el campo con el dato del GIS: el técnico escribe
     lo que ve en la placa y la app marca si no coincide. Si viniera rellenado,
     bastaría con tocar "Siguiente" para que la campaña devolviera exactamente
     lo que ya estaba registrado, que es justo lo que se quiere verificar. */

  function valorGis(campo) {
    if (!campo.gis || !cliente.gis) return null;
    const v = cliente.gis[campo.gis];
    return v === undefined || v === '' ? null : String(v);
  }

  function coincide(escrito, gis) {
    const norm = (x) => String(x).trim().toLowerCase().replace(',', '.');
    if (norm(escrito) === norm(gis)) return true;
    const a = Number(norm(escrito));
    const b = Number(norm(gis));
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
  }

  function renderReferencia(campo, valor) {
    if (!campo.gis || !cliente.gis) return '';
    const gis = valorGis(campo);
    if (gis === null) {
      return `<div class="campo-gis vacio" data-gis-de="${campo.id}">Sin dato en el GIS</div>`;
    }
    return `<div class="campo-gis ${claseGis(valor, gis)}" data-gis-de="${campo.id}">${textoGis(valor, gis)}</div>`;
  }

  function claseGis(valor, gis) {
    if (!String(valor).trim()) return '';
    return coincide(valor, gis) ? 'igual' : 'distinto';
  }

  function textoGis(valor, gis) {
    if (!String(valor).trim()) return `GIS: ${gis}`;
    return coincide(valor, gis) ? `GIS: ${gis} · coincide` : `GIS: ${gis} · NO coincide`;
  }

  function actualizarReferencia(el, campo) {
    const caja = el.parentElement.querySelector('[data-gis-de]');
    if (!caja || !campo.gis) return;
    const gis = valorGis(campo);
    if (gis === null) return;
    caja.className = `campo-gis ${claseGis(el.value, gis)}`;
    caja.textContent = textoGis(el.value, gis);
  }

  /* Cuántos campos difieren del GIS: es el resultado que importa de la campaña. */
  function diferencias() {
    if (!cliente.gis) return [];
    const out = [];
    pasos.forEach(({ bloque, paso }) => {
      (paso.campos || []).forEach((campo) => {
        const gis = valorGis(campo);
        if (gis === null) return;
        const escrito = (datos[bloque.id] || {})[campo.id];
        if (!escrito || !String(escrito).trim()) return;
        if (!coincide(escrito, gis)) out.push({ campo: campo.label, gis, escrito });
      });
    });
    return out;
  }

  function renderFoto(bloque, foto) {
    const clave = `${bloque.id}/${foto.id}`;
    const tomada = !!fotos[clave];
    return `
      <div class="foto ${tomada ? 'tomada' : ''}" data-foto="${clave}">
        <div class="foto-vista" data-vista="${clave}"><span class="foto-numero">${foto.n}</span></div>
        <div class="foto-label">${foto.label}</div>
        <input type="file" accept="image/*" capture="environment"
               data-input-foto="${clave}" style="display:none" />
      </div>`;
  }

  /* ----------------------------------------------------------------- eventos */

  function conectar() {
    const defs = {};
    esquema.bloques[indice].pasos.forEach((paso) => {
      (paso.campos || []).forEach((c) => { defs[c.id] = c; });
    });

    $('#encuesta-cuerpo').querySelectorAll('[data-campo]').forEach((el) => {
      el.addEventListener('input', () => {
        const b = el.dataset.bloque;
        datos[b] = datos[b] || {};
        datos[b][el.dataset.campo] = el.value;
        const campo = defs[el.dataset.campo];
        if (campo) actualizarReferencia(el, campo);
        actualizarProgreso();
        guardar();
      });
    });

    $('#encuesta-cuerpo').querySelectorAll('[data-vista]').forEach((el) => {
      el.addEventListener('click', () => $(`[data-input-foto="${el.dataset.vista}"]`).click());
    });

    $('#encuesta-cuerpo').querySelectorAll('[data-input-foto]').forEach((input) => {
      input.addEventListener('change', async () => {
        const archivo = input.files && input.files[0];
        if (!archivo) return;
        const clave = input.dataset.inputFoto;
        const [bloque, idFoto] = clave.split('/');
        try {
          const blob = await comprimir(archivo);
          await MapDB.putFoto(MapDB.fotoKey(cliente.sed, bloque, idFoto), blob);
          fotos[clave] = true;
          await guardar();
          mostrarFoto(clave, blob);
          actualizarProgreso();
        } catch (e) {
          AppBridge.showToast('No se pudo guardar la foto: ' + e.message, 3500);
        }
        input.value = '';
      });
    });
  }

  /* Redimensiona y recomprime en el propio celular antes de guardar. */
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
        lienzo.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('el navegador no pudo comprimirla'))),
          'image/jpeg',
          FOTO_CALIDAD
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('el archivo no es una imagen válida'));
      };
      img.src = url;
    });
  }

  function mostrarFoto(clave, blob) {
    const vista = $(`[data-vista="${clave}"]`);
    if (!vista) return;
    vista.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
    vista.closest('.foto').classList.add('tomada');
  }

  async function pintarFotosGuardadas(bloque, paso) {
    for (const f of paso.fotos) {
      const clave = `${bloque.id}/${f.id}`;
      if (!fotos[clave]) continue;
      const blob = await MapDB.getFoto(MapDB.fotoKey(cliente.sed, bloque.id, f.id));
      if (blob) mostrarFoto(clave, blob);
    }
  }

  /* --------------------------------------------------------------- navegación */

  function irA(i) {
    indice = Math.max(0, Math.min(esquema.bloques.length - 1, i));
    render();
    $('#overlay-encuesta .sheet').scrollTop = 0;
  }

  /* ---------------------------------------------------------------- progreso */

  /* Solo cuentan los campos que llena el técnico. Los automáticos (GIS, GPS,
     fecha) no son responsabilidad suya: si contaran, una toma de datos sin
     señal GPS nunca podría quedar completa. */
  function camposDe(paso) {
    return (paso.campos || []).filter((c) => !c.origen || c.origen === 'usuario');
  }

  function contarPaso({ bloque, paso }) {
    const valores = datos[bloque.id] || {};
    const campos = camposDe(paso);
    const llenos = campos.filter((c) => {
      const v = valores[c.id];
      return v !== undefined && v !== null && String(v).trim() !== '';
    }).length;
    const listaFotos = paso.fotos || [];
    const fotosOk = listaFotos.filter((f) => fotos[`${bloque.id}/${f.id}`]).length;
    return { llenos, total: campos.length, fotos: fotosOk, totalFotos: listaFotos.length };
  }

  function pasoCompleto(p) {
    const c = contarPaso(p);
    return c.llenos === c.total && c.fotos === c.totalFotos;
  }

  function actualizarProgreso() {
    let campos = 0, camposTotal = 0, fotosOk = 0, fotosTotal = 0;
    pasos.forEach((p) => {
      const c = contarPaso(p);
      campos += c.llenos; camposTotal += c.total;
      fotosOk += c.fotos; fotosTotal += c.totalFotos;
    });
    const dif = diferencias().length;
    $('#encuesta-progreso').innerHTML =
      `${campos}/${camposTotal} campos · ${fotosOk}/${fotosTotal} fotos`
      + (dif ? ` · <b class="dif">${dif} ${dif === 1 ? 'diferencia' : 'diferencias'} con el GIS</b>` : '');
    // El contador del bloque activo vive en la cabecera: hay que refrescarlo
    // en cada tecla, no solo al cambiar de bloque.
    if (esquema && $('#bloque-actual')) {
      const r = resumenBloque(esquema.bloques[indice]);
      const cont = $('#bloque-actual .bloque-cont');
      if (cont) {
        cont.textContent = r.texto;
        cont.classList.toggle('completo', r.completo);
      }
    }
    return { campos, camposTotal, fotosOk, fotosTotal };
  }

  /* ---------------------------------------------------------------- guardado */

  function estadoActual() {
    const p = actualizarProgreso();
    return p.campos === p.camposTotal && p.fotosOk === p.fotosTotal ? 'completa' : 'borrador';
  }

  function registro() {
    return {
      sed: cliente.sed,
      setSlug: cliente.setSlug || '',
      alimentador: cliente.alimentador || '',
      etiqueta: cliente.etiqueta || '',
      nombre: cliente.nombre || '',
      tecnico: Campana.getTecnico(),
      estado: estadoActual(),
      actualizado: new Date().toISOString(),
      datos,
      fotos,
      // Se guardan para poder reportarlas después sin recalcular ni volver a
      // necesitar el paquete del GIS, que puede haberse borrado o cambiado.
      diferencias: diferencias(),
    };
  }

  /* Se llama en cada tecla: se agrupa para no escribir en disco 40 veces por segundo. */
  function guardar() {
    clearTimeout(guardadoPendiente);
    return new Promise((resolve) => {
      guardadoPendiente = setTimeout(async () => {
        await MapDB.putEncuesta(registro());
        resolve();
      }, 400);
    });
  }

  async function cerrar() {
    clearTimeout(guardadoPendiente);
    await MapDB.putEncuesta(registro());
    AppBridge.closeSheet('#overlay-encuesta');
    await Campana.refrescarEstados();
  }

  function faltantes() {
    const falta = [];
    esquema.bloques.forEach((bloque) => {
      let campos = 0, fotosF = 0;
      bloque.pasos.forEach((paso) => {
        const c = contarPaso({ bloque, paso });
        campos += c.total - c.llenos;
        fotosF += c.totalFotos - c.fotos;
      });
      if (campos || fotosF) {
        const partes = [];
        if (campos) partes.push(`${campos} campo(s)`);
        if (fotosF) partes.push(`${fotosF} foto(s)`);
        falta.push(`${bloque.titulo}: ${partes.join(' y ')}`);
      }
    });
    return falta;
  }

  return { abrir, cerrar, faltantes, estadoActual, irA, diferencias, alternarSelector,
           siguiente: () => irA(indice + 1), atras: () => irA(indice - 1),
           pasoActual: () => indice, totalPasos: () => (esquema ? esquema.bloques.length : 0) };
})();

window.Encuesta = Encuesta;

document.querySelector('#encuesta-siguiente').addEventListener('click', async () => {
  if (Encuesta.pasoActual() < Encuesta.totalPasos() - 1) {
    Encuesta.siguiente();
    return;
  }
  const falta = Encuesta.faltantes();
  const dif = Encuesta.diferencias();
  await Encuesta.cerrar();
  const aviso = dif.length
    ? ` · ${dif.length} diferencia(s) con el GIS: ${dif.map((d) => d.campo).join(', ')}`
    : '';
  if (!falta.length) AppBridge.showToast(`Toma de datos completa y guardada${aviso}`, 4500);
  else AppBridge.showToast(`Guardado. Falta — ${falta.join(' · ')}${aviso}`, 5500);
});

document.querySelector('#encuesta-atras').addEventListener('click', () => Encuesta.atras());

/* La flecha de la cabecera y el botón físico de Android hacen lo mismo:
   retroceden un paso, y desde el primero cierran guardando. */
async function atrasEncuesta() {
  if (Encuesta.pasoActual() > 0) Encuesta.atras();
  else await Encuesta.cerrar();
}
document.querySelector('#encuesta-atras-cab').addEventListener('click', atrasEncuesta);

AppBridge.registrarAtras(() => {
  if (!document.querySelector('#overlay-encuesta').classList.contains('visible')) return false;
  atrasEncuesta();
  return true;
});
document.querySelector('#bloque-actual').addEventListener('click', () => Encuesta.alternarSelector());
document.querySelector('#encuesta-cerrar').addEventListener('click', () => Encuesta.cerrar());
