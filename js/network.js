/* network.js — capas de "Red eléctrica base": postes, tramos y subestaciones
   cargados desde archivos KMZ/KML. Maneja el guardado, el dibujo en el mapa
   y las capas visibles/ocultas. */

const NetworkLayers = (() => {
  'use strict';

  const DEFS = [
    { key: 'postes_bt', label: 'Postes de Baja Tensión', color: '#3b82f6', geom: 'point' },
    { key: 'postes_mt', label: 'Postes de Media Tensión', color: '#e0553b', geom: 'point' },
    { key: 'subestaciones', label: 'Subestaciones', color: '#d4af1f', geom: 'point' },
    { key: 'tramos_mt', label: 'Tramos de Red MT', color: '#e0553b', geom: 'line' },
    { key: 'tramos_bt', label: 'Tramos de Red BT', color: '#3b82f6', geom: 'line' },
  ];

  function defOf(key) {
    return DEFS.find((d) => d.key === key);
  }

  function makeId() {
    return 'feat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  }

  return { DEFS, defOf, makeId };
})();
