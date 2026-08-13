/* xlsx.js — escribe un .xlsx de verdad, sin librerías externas.

   Un .xlsx es un .zip con unos pocos XML adentro, y fflate (que ya estaba
   vendorizado para leer los KMZ) sabe comprimir. Se genera el archivo real y
   no un CSV porque el CSV pierde los acentos según cómo lo abra cada Excel,
   y acá hay columnas como "UBICACIÓN DE CAJATOMA" que quedarían rotas.

   Solo se usa lo mínimo del formato: textos en línea (inlineStr), sin tabla de
   cadenas compartidas ni estilos, salvo negrita para las dos filas de título. */

const XlsxWriter = (() => {
  'use strict';

  function esc(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Excel rechaza el archivo entero si aparece un carácter de control
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  /* 1 -> A, 27 -> AA */
  function columna(n) {
    let s = '';
    while (n > 0) {
      const resto = (n - 1) % 26;
      s = String.fromCharCode(65 + resto) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function celda(ref, valor, estilo) {
    const s = estilo ? ` s="${estilo}"` : '';
    if (valor === null || valor === undefined || valor === '') return `<c r="${ref}"${s}/>`;
    // Los números van como número para que Excel pueda sumarlos y ordenarlos.
    if (typeof valor === 'number' && Number.isFinite(valor)) {
      return `<c r="${ref}"${s}><v>${valor}</v></c>`;
    }
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(valor)}</t></is></c>`;
  }

  function fila(n, valores, estilo) {
    const celdas = valores.map((v, i) => celda(columna(i + 1) + n, v, estilo)).join('');
    return `<row r="${n}">${celdas}</row>`;
  }

  /* merges: [{fila, desde, hasta}] con índices de columna en base 1 */
  function hojaXml({ filas, merges, anchos }) {
    const cols = anchos
      ? `<cols>${anchos.map((a, i) => `<col min="${i + 1}" max="${i + 1}" width="${a}" customWidth="1"/>`).join('')}</cols>`
      : '';
    const fusiones = merges && merges.length
      ? `<mergeCells count="${merges.length}">${merges
          .map((m) => `<mergeCell ref="${columna(m.desde)}${m.fila}:${columna(m.hasta)}${m.fila}"/>`)
          .join('')}</mergeCells>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${cols}<sheetData>${filas.join('')}</sheetData>${fusiones}</worksheet>`;
  }

  const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  /* Devuelve un Uint8Array con el .xlsx listo para descargar. */
  function crear({ nombreHoja, filas, merges, anchos }) {
    const archivos = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(nombreHoja).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      'xl/styles.xml': ESTILOS,
      'xl/worksheets/sheet1.xml': hojaXml({ filas, merges, anchos }),
    };

    const entradas = {};
    Object.keys(archivos).forEach((k) => { entradas[k] = fflate.strToU8(archivos[k]); });
    return fflate.zipSync(entradas, { level: 6 });
  }

  return { crear, fila, columna };
})();

window.XlsxWriter = XlsxWriter;
