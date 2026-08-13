# Catastro Técnico-Comercial — Mapa de campo (PWA)

Aplicación web instalable (PWA) para trabajo de campo con mapas, pensada para
funcionar sin internet una vez descargadas las zonas de trabajo.

## Qué incluye

- **Mapa OpenStreetMap** y **capa satelital** (Esri World Imagery), con opción
  **híbrida** (satelital + nombres de calles). Botón de capas (ícono de capas) arriba a la derecha.
- **Descarga de recortes offline**: botón de descarga (⬇) → toca la esquina 1
  del área → mientras mueves el mapa o el mouse aparece un **rectángulo
  punteado casi transparente** mostrando en vivo de qué punto a qué punto
  estás recortando → toca la esquina opuesta (o usa el botón "Fijar esquina 2
  en el centro", útil en celular) → elige capas y rango de zoom → descarga
  los tiles y los guarda en el dispositivo (IndexedDB). También puedes usar
  "Usar vista actual" para descargar directo lo que ves en pantalla. Se puede
  usar sin internet apenas se vuelve a esa zona.
- **Gestor de recortes** (ícono de líneas): lista los recortes guardados con
  su nombre, capas, zoom, cantidad de tiles y fecha. Permite ir a la zona o
  eliminarla.
- **GeolocationService**: usa `navigator.geolocation.watchPosition` con alta
  precisión.
  - **Toque corto** en el botón de ubicación (⊕): enciende el GPS y activa
    "seguir" (el mapa se centra solo en tu posición). Un segundo toque deja
    de seguir sin apagar el GPS (puedes desplazar el mapa libremente); otro
    toque vuelve a centrar.
  - **Arrastrar el mapa** mientras está en modo "seguir" cancela el
    seguimiento automáticamente, para que nunca "jale" el mapa mientras
    estás trabajando.
  - **Mantener presionado** (~0.6 s) el botón de ubicación apaga el GPS por
    completo (deja de escuchar la posición y quita el marcador del mapa).
  - La barra inferior muestra LATITUD, LONGITUD, PRECISIÓN y ALTITUD en vivo,
    igual que en la app de referencia.
- Sin controles de zoom +/- en pantalla: se hace zoom con gestos (pellizcar,
  doble toque, o la rueda del mouse en escritorio).
- **Funciona offline como app**: un Service Worker cachea la aplicación en sí
  (HTML/CSS/JS), y un manifest permite "instalarla" en la pantalla de inicio
  del celular.
- **Flujo de trabajo por SET** (Subestación Eléctrica de Transformación):
  - Al abrir la app (o después de terminar una SET) aparece "¿Con qué SET
    desea iniciar?" — se escribe, por ejemplo, `SET ANANEA`, y esa SET queda
    activa (se muestra en la barra superior).
  - Tocando el nombre de la SET arriba se abre un menú con "Descargar
    información de esta SET" y "Terminar esta SET y empezar otra" — esta
    última descarga automáticamente lo cargado (GeoJSON), limpia la red y
    vuelve a preguntar el nombre de la siguiente SET, tal como se trabaja en
    campo: una SET a la vez, se cierra, se pasa a la otra.
- **Red eléctrica base** (ícono de red, junto al de recortes): panel con 5
  capas — Postes de Baja Tensión, Postes de Media Tensión, Subestaciones,
  Tramos de Red MT y Tramos de Red BT — cada una con su color, su contador de
  elementos y un interruptor para mostrarla u ocultarla en el mapa.
  - **"Cargar archivo KMZ / KML"**: elige un archivo desde el celular (el que
    hayas guardado de WhatsApp, Google Earth, etc.). La app lo lee, agrupa
    los elementos por carpeta y te muestra a qué capa corresponde cada
    carpeta (adivinado por el nombre — "Postes BT", "TRAFOMIX", "SED", etc. —
    pero siempre editable antes de importar, y puedes marcar "No importar
    esta carpeta"). Cada archivo se SUMA a lo que ya había; nada se
    reemplaza.
  - **Compartir directo desde WhatsApp**: una vez instalada la app en el
    celular, el botón "Compartir" de WhatsApp sobre un archivo `.kmz`/`.kml`
    debería mostrar esta app como destino (usa la Web Share Target API de
    Android). Lo probé simulando el envío y funciona de punta a punta en el
    navegador, pero **te recomiendo probarlo una vez en tu celular real**
    después de instalar la versión actualizada, porque el share-sheet de
    Android solo se puede verificar en un dispositivo real. Si por algún
    motivo tu celular no lo ofrece como opción, la alternativa 100% segura es
    guardar el archivo (desde WhatsApp: ⋮ → Guardar) y usar "Cargar archivo
    KMZ / KML" dentro de la app.
  - **"Descargar datos"**: exporta todo lo cargado como un archivo
    `.geojson` (abrible en QGIS, Google Earth, etc.), nombrado con la SET y
    la fecha.
  - **"Limpiar red cargada"**: borra todo lo cargado (con doble toque de
    confirmación) para empezar una zona nueva.

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

   **Primera vez (crear el repositorio):**
   1. Entra a https://github.com → botón verde "New" (nuevo repositorio).
   2. Ponle un nombre (ej. `catastro-app`), marca "Public", NO marques
      "Add a README" → "Create repository".
   3. En la página del repo vacío, haz clic en "uploading an existing file".
   4. Descomprime el .zip en tu computadora primero. Arrastra **el
      contenido** de la carpeta `catastro-app` (index.html, manifest.json,
      sw.js, y las carpetas css/ js/ icons/) a la zona de carga — no arrastres
      el .zip ni una carpeta contenedora, los archivos deben quedar en la
      raíz del repositorio.
   5. Baja y haz clic en "Commit changes".
   6. Ve a Settings → Pages → en "Branch" elige `main` y carpeta `/ (root)`
      → Save. Espera ~1 minuto y arriba te muestra la URL
      (`https://tu-usuario.github.io/catastro-app/`).

   **Para actualizar los archivos más adelante** (cuando yo te mande una
   versión nueva): entra al repositorio → "Add file" → "Upload files" →
   arrastra de nuevo todos los archivos actualizados (los que tengan el
   mismo nombre se reemplazan automáticamente al hacer commit) → "Commit
   changes". GitHub Pages se actualiza solo, en un minuto aprox.

   **Importante sobre la caché**: esta app usa un Service Worker que guarda
   los archivos para que abra sin internet. Si ya la abriste una vez en el
   celular y luego subes una actualización, puede tardar en notarse el
   cambio. Cada vez que suba una versión nueva, yo cambio el número de
   versión dentro de `sw.js` (la línea `CACHE_NAME`) para forzar a que el
   celular baje los archivos nuevos la próxima vez que abras la app con
   internet — no necesitas hacer nada manual, solo abrir la app una vez
   con datos/Wi-Fi después de actualizar.

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
├── share-kmz.html        — destino del botón "Compartir" (Web Share Target)
├── manifest.json        — metadata de instalación (PWA)
├── sw.js                 — Service Worker (cachea la app, recibe archivos compartidos)
├── css/
│   ├── app.css            — estilos de la interfaz
│   ├── leaflet.css         — estilos de Leaflet (vendorizado)
│   └── images/              — íconos de Leaflet
├── js/
│   ├── app.js              — lógica principal (mapa, capas, descargas, GPS, SET, red)
│   ├── db.js                 — acceso a IndexedDB (tiles, recortes, red eléctrica)
│   ├── offline-tilelayer.js   — capa de Leaflet con caché offline-first
│   ├── kmz.js                  — lector de archivos KMZ/KML
│   ├── network.js               — definición de las 5 capas de red eléctrica
│   └── vendor/leaflet.js, fflate.js — librerías vendorizadas
└── icons/                — íconos de la PWA
```

## Próximos pasos posibles (no incluidos en esta versión)

- Formulario "Nuevo suministro" para registrar puntos nuevos en el mapa
  (como en tu primera captura de referencia), con guardado local.
- Registrar varias SET guardadas en paralelo (hoy es una a la vez: se
  termina, se descarga y se limpia antes de pasar a la siguiente, tal como
  me indicaste que trabajan en campo).
- Exportar también en formato KML (hoy exporta GeoJSON, que abre en QGIS,
  Google Earth Pro, geojson.io, etc.).

Si quieres que agregue alguna de estas partes, dímelo y seguimos desde acá.
