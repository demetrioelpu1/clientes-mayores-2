/* kmz.js — lee archivos .kmz (zip con un .kml adentro) o .kml directos,
   y extrae los Placemarks (postes, tramos, subestaciones) agrupados por carpeta. */

const KmzParser = (() => {
  'use strict';

  function stripAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /* Lee el archivo y devuelve el texto XML del KML (descomprimiendo si es .kmz) */
  async function extractKmlText(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; // firma "PK"
    if (!isZip) {
      // .kml plano
      return new TextDecoder('utf-8').decode(buf);
    }
    const unzipped = fflate.unzipSync(buf);
    const kmlName = Object.keys(unzipped).find((n) => n.toLowerCase().endsWith('.kml'));
    if (!kmlName) throw new Error('El archivo .kmz no contiene ningún .kml adentro.');
    return new TextDecoder('utf-8').decode(unzipped[kmlName]);
  }

  function parseCoordinatesText(text) {
    // "lon,lat[,alt] lon,lat[,alt] ..." separado por espacios/saltos de línea
    return text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((triplet) => {
        const parts = triplet.split(',').map(Number);
        const lon = parts[0];
        const lat = parts[1];
        return [lat, lon]; // Leaflet usa [lat, lon]
      })
      .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  }

  function getGeometryFromPlacemark(pmEl) {
    const point = pmEl.querySelector(':scope > Point > coordinates');
    if (point) {
      const coords = parseCoordinatesText(point.textContent);
      if (coords.length) return { geomType: 'point', coords: [coords[0]] };
    }
    const line = pmEl.querySelector(':scope > LineString > coordinates');
    if (line) {
      const coords = parseCoordinatesText(line.textContent);
      if (coords.length >= 2) return { geomType: 'line', coords };
    }
    const polygon = pmEl.querySelector(':scope > Polygon coordinates');
    if (polygon) {
      const coords = parseCoordinatesText(polygon.textContent);
      if (coords.length >= 2) return { geomType: 'line', coords }; // se dibuja como línea de borde
    }
    // MultiGeometry: toma la primera geometría soportada que encuentre adentro
    const mgPoint = pmEl.querySelector('MultiGeometry Point > coordinates');
    if (mgPoint) {
      const coords = parseCoordinatesText(mgPoint.textContent);
      if (coords.length) return { geomType: 'point', coords: [coords[0]] };
    }
    const mgLine = pmEl.querySelector('MultiGeometry LineString > coordinates');
    if (mgLine) {
      const coords = parseCoordinatesText(mgLine.textContent);
      if (coords.length >= 2) return { geomType: 'line', coords };
    }
    return null;
  }

  /* Recorre el documento y agrupa los Placemarks por la carpeta (Folder) que los contiene */
  function extractPlacemarksByFolder(xmlDoc) {
    const groups = new Map(); // folderPath -> [{name, geomType, coords}]

    function folderNameOf(el) {
      let node = el.parentElement;
      while (node) {
        if (node.tagName === 'Folder' || node.tagName === 'Document') {
          const nameEl = node.querySelector(':scope > name');
          if (nameEl && nameEl.textContent.trim()) return nameEl.textContent.trim();
        }
        node = node.parentElement;
      }
      return 'Sin carpeta';
    }

    const placemarks = xmlDoc.querySelectorAll('Placemark');
    placemarks.forEach((pm) => {
      const geometry = getGeometryFromPlacemark(pm);
      if (!geometry) return; // placemark sin geometría soportada (o vacío)
      const nameEl = pm.querySelector(':scope > name');
      const name = nameEl ? nameEl.textContent.trim() : '(sin nombre)';
      const folder = folderNameOf(pm);
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push({ name, geomType: geometry.geomType, coords: geometry.coords });
    });

    return groups;
  }

  /* Adivina a qué capa de la app pertenece una carpeta, según palabras clave en su nombre. */
  function guessLayerForFolder(folderName) {
    const n = stripAccents(folderName.toLowerCase());
    const hasBT = /\bbt\b|baja/.test(n);
    const hasMT = /\bmt\b|media/.test(n);
    const hasTramo = /tramo|linea|l[ií]nea|red/.test(n);
    const hasPoste = /poste/.test(n);
    const hasSub = /subesta|\bsed\b|\bset\b|trafo/.test(n);

    if (hasTramo && hasMT) return 'tramos_mt';
    if (hasTramo && hasBT) return 'tramos_bt';
    if (hasPoste && hasMT) return 'postes_mt';
    if (hasPoste && hasBT) return 'postes_bt';
    if (hasSub) return 'subestaciones';
    if (hasTramo) return null; // ambiguo: no sabemos si es MT o BT
    if (hasPoste) return null; // ambiguo
    return null; // desconocido, hay que preguntar
  }

  /* Punto de entrada: lee el archivo y devuelve { folders: [{name, count, guess, geomType, items}] } */
  async function parseFile(file) {
    const kmlText = await extractKmlText(file);
    const xmlDoc = new DOMParser().parseFromString(kmlText, 'text/xml');
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) throw new Error('No se pudo leer el KML: el archivo parece dañado o no es un KML válido.');

    const groups = extractPlacemarksByFolder(xmlDoc);
    const folders = [];
    groups.forEach((items, name) => {
      // determina el tipo de geometría dominante del grupo
      const geomType = items[0] ? items[0].geomType : 'point';
      folders.push({
        name,
        count: items.length,
        guess: guessLayerForFolder(name),
        geomType,
        items,
      });
    });
    return { folders, totalCount: folders.reduce((s, f) => s + f.count, 0) };
  }

  return { parseFile, guessLayerForFolder };
})();
