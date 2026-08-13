/* kmz.js — lee un .kmz (zip con un .kml adentro) o un .kml suelto y saca los
   elementos CON SUS ATRIBUTOS.

   Los KMZ del GIS de ELPU no usan <ExtendedData>: meten la ficha completa como
   una tabla HTML dentro de <description>. La versión anterior de este archivo
   solo leía <name>, y como ahí dice "ELPU" en todos los elementos, importaba
   cientos de puntos idénticos y sin un solo dato útil.

   Los nombres de campo se normalizan con data/alias.json, que se genera desde
   el mismo diccionario que usa tools/kmz_to_geojson.py: así el celular y la PC
   no pueden quedar desincronizados. */

const KmzParser = (() => {
  'use strict';

  let alias = null;

  const RE_PLACEMARK = /<Placemark\b[\s\S]*?<\/Placemark>/g;
  const RE_TR = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const RE_TD = /<td[^>]*>([\s\S]*?)<\/td>/g;
  const RE_TAGS = /<[^>]+>/g;
  const RE_ADJUNTO = /\.(jpg|jpeg|png|pdf|dwg|tif)$/i;

  /* Cada capa se reconoce por una palabra en el nombre del archivo.
     El orden importa: "TRAMOS MT" tiene que probarse antes que "MT". */
  const PATRONES_CAPA = [
    ['trafomix', 'trafomix', 'Point'],
    ['tramos mt', 'tramos_mt', 'LineString'],
    ['tramos bt', 'tramos_bt', 'LineString'],
    ['postes mt', 'postes_mt', 'Point'],
    ['postes bt', 'postes_bt', 'Point'],
    ['sed', 'sed', 'Point'],
  ];

  const NOMBRE_CAPA = {
    trafomix: 'Trafomix',
    sed: 'Subestaciones (SED)',
    tramos_mt: 'Tramos de Red MT',
    tramos_bt: 'Tramos de Red BT',
    postes_mt: 'Postes de Media Tensión',
    postes_bt: 'Postes de Baja Tensión',
  };

  async function cargarAlias() {
    if (alias) return alias;
    try {
      alias = await (await fetch('data/alias.json')).json();
    } catch (e) {
      alias = {};   // sin alias igual funciona, solo quedan los nombres crudos
    }
    return alias;
  }

  /* 'Código de Salida MT' -> 'codigo de salida mt' */
  function slug(texto) {
    return texto
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/ñ/g, 'n')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function limpiar(celda) {
    const texto = celda.replace(RE_TAGS, '').replace(/ /g, ' ').trim();
    // El GIS escribe los vacios como "<Nulo>". Hoy RE_TAGS se lo lleva puesto
    // por parecerse a una etiqueta, pero eso es casualidad: dejarlo explicito
    // para que siga coincidiendo con tools/kmz_to_geojson.py.
    return /^<nul[lo]>$/i.test(texto) ? '' : texto;
  }

  function desescapar(s) {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /* Saca los pares campo/valor de la tabla HTML del <description>. */
  function atributosDe(descripcion) {
    const datos = {};
    let adjuntos = 0;
    const html = desescapar(descripcion);
    RE_TR.lastIndex = 0;
    let fila;
    while ((fila = RE_TR.exec(html)) !== null) {
      RE_TD.lastIndex = 0;
      const celdas = [];
      let td;
      while ((td = RE_TD.exec(fila[1])) !== null) celdas.push(limpiar(td[1]));
      // Los adjuntos del GIS (fotos, PDFs) no vienen dentro del KMZ: solo se
      // cuentan. Vienen a veces en filas de una celda y a veces de dos, así
      // que se detectan por la extensión del nombre, no por la forma de la fila.
      const nombresAdjunto = celdas.filter((c) => RE_ADJUNTO.test(c));
      if (nombresAdjunto.length) { adjuntos += nombresAdjunto.length; continue; }
      if (celdas.length !== 2) continue;
      const [etiqueta, valor] = celdas;
      if (!etiqueta) continue;
      const clave = alias[slug(etiqueta)] || slug(etiqueta).replace(/ /g, '_');
      if (datos[clave] === undefined && valor !== '') datos[clave] = valor;
    }
    return { datos, adjuntos };
  }

  function coordenadas(texto) {
    return texto
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => {
        const p = t.split(',').map(Number);
        return [p[0], p[1]];      // GeoJSON: [lon, lat]
      })
      .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  }

  function geometriaDe(xml) {
    const punto = /<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(xml);
    if (punto) {
      const c = coordenadas(punto[1]);
      if (c.length) return { type: 'Point', coordinates: c[0] };
    }
    const linea = /<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(xml);
    if (linea) {
      const c = coordenadas(linea[1]);
      if (c.length >= 2) return { type: 'LineString', coordinates: c };
    }
    return null;
  }

  async function textoKml(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const esZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;   // "PK"
    if (!esZip) return new TextDecoder('utf-8').decode(buf);
    const contenido = fflate.unzipSync(buf);
    const nombre = Object.keys(contenido).find((n) => n.toLowerCase().endsWith('.kml'));
    if (!nombre) throw new Error('El .kmz no contiene ningún .kml adentro.');
    return new TextDecoder('utf-8').decode(contenido[nombre]);
  }

  function capaDeArchivo(nombreArchivo) {
    const s = slug(nombreArchivo.replace(/\.[^.]+$/, ''));
    for (const [clave, capa, geom] of PATRONES_CAPA) {
      if (s.includes(clave)) {
        const alim = /\b(\d{4})\b/.exec(s);
        return { capa, geom, alimentador: alim ? alim[1] : null };
      }
    }
    return { capa: null, geom: null, alimentador: null };
  }

  /* Punto de entrada. Devuelve el archivo ya listo para guardar:
     { capa, alimentador, elementos: [ {geometry, properties} ], adjuntos } */
  async function leer(file) {
    await cargarAlias();
    const kml = await textoKml(file);
    const { capa, alimentador } = capaDeArchivo(file.name);

    const elementos = [];
    let adjuntos = 0;
    let sinGeometria = 0;

    RE_PLACEMARK.lastIndex = 0;
    let pm;
    while ((pm = RE_PLACEMARK.exec(kml)) !== null) {
      const xml = pm[0];
      const geometry = geometriaDe(xml);
      if (!geometry) { sinGeometria++; continue; }
      const desc = /<description>([\s\S]*?)<\/description>/.exec(xml);
      const { datos, adjuntos: n } = desc ? atributosDe(desc[1]) : { datos: {}, adjuntos: 0 };
      adjuntos += n;
      elementos.push({ type: 'Feature', geometry, properties: datos });
    }

    // El alimentador del nombre del archivo solo se usa como respaldo: si el
    // dato viene adentro del KMZ, ese manda.
    if (alimentador) {
      elementos.forEach((e) => {
        if (!e.properties.alimentador) e.properties.alimentador = alimentador;
      });
    }

    const alimentadores = [...new Set(
      elementos.map((e) => e.properties.alimentador).filter(Boolean)
    )];

    return {
      archivo: file.name,
      capa,
      capaNombre: NOMBRE_CAPA[capa] || 'Sin identificar',
      alimentador: alimentadores.length === 1 ? alimentadores[0] : alimentador,
      alimentadores,
      elementos,
      total: elementos.length,
      adjuntos,
      sinGeometria,
    };
  }

  return { leer, capaDeArchivo, NOMBRE_CAPA };
})();

window.KmzParser = KmzParser;
