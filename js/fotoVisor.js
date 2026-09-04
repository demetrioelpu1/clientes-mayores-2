/* fotoVisor.js — ver a pantalla completa una foto ya sacada, con Borrar y
   Repetir. Hoy no existe en ningún lado de la app: las miniaturas de los
   grupos de fotos (mediciones/extra) solo tenían la cruz para borrar, tocar
   la miniatura no hacía nada. Genérico y sin estado propio del formulario —
   lo usan encuesta.js y encuestaAp.js por igual, cada uno decide qué hacer
   con el resultado ('borrar' | 'repetir' | null). */

const FotoVisor = (() => {
  'use strict';

  let overlay = null;

  function asegurarDom() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'foto-visor';
    overlay.className = 'foto-visor';
    overlay.innerHTML = `
      <button type="button" class="foto-visor-cerrar" aria-label="Cerrar">&times;</button>
      <img class="foto-visor-img" alt="">
      <div class="foto-visor-acciones">
        <button type="button" class="btn-secondary foto-visor-repetir">Repetir</button>
        <button type="button" class="btn-danger foto-visor-borrar">Borrar</button>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  /* Devuelve una Promise que resuelve en 'borrar' | 'repetir' | null (cerró
     sin elegir nada). `opciones.permiteRepetir: false` esconde ese botón. */
  function abrir(blob, opciones = {}) {
    const dom = asegurarDom();
    const img = dom.querySelector('.foto-visor-img');
    const url = URL.createObjectURL(blob);
    img.src = url;
    dom.querySelector('.foto-visor-repetir').hidden = opciones.permiteRepetir === false;
    dom.classList.add('visible');

    return new Promise((resolve) => {
      const btnCerrar = dom.querySelector('.foto-visor-cerrar');
      const btnBorrar = dom.querySelector('.foto-visor-borrar');
      const btnRepetir = dom.querySelector('.foto-visor-repetir');

      function cerrar(resultado) {
        dom.classList.remove('visible');
        URL.revokeObjectURL(url);
        dom.removeEventListener('click', onOverlayClick);
        btnCerrar.onclick = null;
        btnBorrar.onclick = null;
        btnRepetir.onclick = null;
        resolve(resultado);
      }
      function onOverlayClick(e) { if (e.target === dom) cerrar(null); }

      dom.addEventListener('click', onOverlayClick);
      btnCerrar.onclick = () => cerrar(null);
      btnBorrar.onclick = () => cerrar('borrar');
      btnRepetir.onclick = () => cerrar('repetir');
    });
  }

  return { abrir };
})();

window.FotoVisor = FotoVisor;
