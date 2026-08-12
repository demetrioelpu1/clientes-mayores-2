# Catastro Técnico-Comercial — Mapa de campo (PWA)

Aplicación web instalable (PWA) para trabajo de campo con mapas, pensada para
funcionar sin internet una vez descargadas las zonas de trabajo.

## Qué incluye

- **Mapa OpenStreetMap** y **capa satelital** (Esri World Imagery), con opción
  **híbrida** (satelital + nombres de calles). Botón de capas (ícono de capas) arriba a la derecha.
- **Descarga de recortes offline**: botón de descarga (⬇) → marca un área
  tocando dos esquinas en el mapa (o "Usar vista actual") → elige capas y
  rango de zoom → descarga los tiles y los guarda en el dispositivo
  (IndexedDB). Se puede usar sin internet apenas se vuelve a esa zona.
- **Gestor de recortes** (ícono de líneas): lista los recortes guardados con
  su nombre, capas, zoom, cantidad de tiles y fecha. Permite ir a la zona o
  eliminarla.
- **GeolocationService**: usa `navigator.geolocation.watchPosition` con alta
  precisión. Botón de ubicación (⊕) activa el GPS y el modo "seguir". La
  barra inferior muestra LATITUD, LONGITUD, PRECISIÓN y ALTITUD en vivo, igual
  que en la app de referencia.
- **Funciona offline como app**: un Service Worker cachea la aplicación en sí
  (HTML/CSS/JS), y un manifest permite "instalarla" en la pantalla de inicio
  del celular.

## Cómo probarla / publicarla

Es un sitio 100% estático (HTML/CSS/JS), no necesita backend ni build. Solo
hace falta servirlo por **HTTPS** (o `localhost`) porque los navegadores
exigen HTTPS para usar la geolocalización y los Service Workers.

Opciones más simples, de menor a mayor esfuerzo:

1. **Netlify Drop** (el más rápido, sin cuenta):
   entra a https://app.netlify.com/drop desde tu computadora y arrastra la
   carpeta `catastro-app` completa. Te da una URL `https://algo.netlify.app`
   lista para abrir desde el celular.

2. **GitHub Pages**: sube la carpeta a un repositorio de GitHub y activa
   Pages (Settings → Pages → Deploy from branch). Gratis y con URL estable.

3. **Servidor propio**: cualquier hosting estático (Vercel, Firebase
   Hosting, un VPS con Nginx, etc.) sirviendo la carpeta tal cual.

4. **Probar en tu misma red Wi-Fi sin publicar nada** (solo para pruebas
   rápidas, sin HTTPS real, así que el GPS puede no funcionar en Android):
   desde una PC en la carpeta `catastro-app`, ejecuta:
   ```
   python3 -m http.server 8080
   ```
   y en el celular (misma red Wi-Fi) abre `http://IP-DE-TU-PC:8080`.
   Nota: Chrome en Android normalmente bloquea la geolocalización fuera de
   HTTPS/localhost, así que para probar el GPS real es mejor usar la opción 1 o 2.

## Instalar como app en el celular

Una vez publicada con HTTPS, abre la URL en Chrome (Android) o Safari
(iPhone) y usa "Agregar a pantalla de inicio" / "Instalar aplicación". Con
eso queda como un ícono más, y al abrirla la primera vez con internet, el
Service Worker guarda la app para que abra aunque no haya señal.

## Flujo recomendado antes de ir a campo sin señal

1. Con internet, abre la app y ubica en el mapa la(s) zona(s) donde vas a
   trabajar.
2. Toca el botón de descarga (⬇), marca el área, elige zoom 13–18 (buen
   equilibrio entre detalle y peso) y descarga.
3. Repite para cada zona de trabajo. Puedes revisar el peso aproximado antes
   de descargar (se muestra en tiles y MB estimados).
4. En campo, sin señal, abre la app: los recortes descargados se muestran
   igual, y el GPS (watchPosition) sigue funcionando sin internet porque usa
   el chip GPS del teléfono, no datos móviles.

## Estructura del proyecto

```
catastro-app/
├── index.html          — pantalla principal
├── manifest.json        — metadata de instalación (PWA)
├── sw.js                 — Service Worker (cachea la app, no los tiles)
├── css/
│   ├── app.css            — estilos de la interfaz
│   ├── leaflet.css         — estilos de Leaflet (vendorizado)
│   └── images/              — íconos de Leaflet
├── js/
│   ├── app.js              — lógica principal (mapa, capas, descargas, GPS)
│   ├── db.js                 — acceso a IndexedDB (tiles y recortes)
│   ├── offline-tilelayer.js   — capa de Leaflet con caché offline-first
│   └── vendor/leaflet.js       — Leaflet 1.9.4 (vendorizado)
└── icons/                — íconos de la PWA
```

## Próximos pasos posibles (no incluidos en esta versión)

- Formulario "Nuevo suministro" para registrar puntos en el mapa (como en la
  captura de referencia), con guardado local y exportación (CSV/GeoJSON).
- Capas de red eléctrica (postes, líneas, transformadores) como overlays
  editables.
- Sincronización con un servidor cuando vuelve la conexión.

Si quieres que agregue alguna de estas partes, dímelo y seguimos desde acá.
