# Atlas Litoral

[Ver el mapa interactivo](https://jayjayanton.github.io/atlas-litoral/) · [Abrir el análisis de aptitud](https://jayjayanton.github.io/atlas-litoral/#aptitud)

Atlas de acceso a servicios y mercado de vivienda en Guayas y Santa Elena, Ecuador. Selecciona un cantón para consultar sus indicadores o combina escuelas, hospitales y vías en el panel **Aptitud territorial ponderada**. Puedes comparar cómo cambia el resultado al modificar los pesos de cada criterio. La puntuación describe el acceso a servicios. Para evaluar la demanda de vivienda, consulta la fuente, el período y la cobertura de los indicadores de mercado.

## Comparar crédito de vivienda

[Abre la comparación por umbral](https://jayjayanton.github.io/atlas-litoral/?capa=credit#credito) para consultar el número de créditos sobre un monto o las áreas cuyo préstamo promedio lo supera. El umbral inicial es USD 100.000. La opción **Usar precio menos entrada del proyecto** ajusta el umbral al escenario del edificio activo.

La comparación cantonal utiliza los créditos originales inmobiliarios, VIS y VIP de la banca privada entre enero y septiembre de 2026. El informe agrupa operaciones. Cuando el conteo exacto sobre el umbral es indeterminado, la tabla muestra los límites compatibles con los montos y conteos publicados.

En **Parroquia · SEPS**, carga el archivo de texto tabulado descomprimido de la base mensual de volumen de crédito. Puedes seleccionar ediciones con meses distintos. Se incluyen hasta los últimos doce meses del archivo, solo operaciones originales de personas naturales de los tipos generales inmobiliario y vivienda. Los intervalos oficiales permiten un conteo exacto para USD 100.000. Se unen los códigos DPA con polígonos disponibles y, para parroquias urbanas de Guayaquil, se coteja también el nombre municipal dentro del cantón. Las filas sin geometría quedan en la tabla. Los resultados importados se guardan en este navegador.

## Agregar un edificio

En **Agregar edificio**, escribe un nombre y pega la latitud y la longitud en grados decimales, por ejemplo `-2.18376, -79.97990`. En **Zoom al guardar**, elige **Parroquia** o **Cantón**. El formulario identifica el área y, al guardar, el mapa ajusta el encuadre a su límite y muestra el pin. Fuera de las dos provincias, el mapa se centra en las coordenadas. Cada vez que recargas la página, el mapa vuelve a la vista regional sin un proyecto activo. Usa **Edificios** para volver a un punto guardado o **Compartir ubicación** para abrir el mismo edificio en otro navegador. La aptitud y la accesibilidad se calculan dentro de Guayas y Santa Elena.

Los edificios que agregas desde el mapa se guardan en tu navegador. Para mostrar uno a todos los visitantes, agrega una entrada al [catálogo público de edificios](docs/data/buildings.json) con un `id` único, `name`, `lat` y `lon`, y guarda el cambio en la rama `main`.

## Abrir en tu computadora

Desde la carpeta del repositorio, ejecuta `python -m http.server 8000 --directory docs` y abre <http://localhost:8000/>. En Windows también puedes usar `py -m http.server 8000 --directory docs`.

## Publicación y datos

GitHub Pages sirve la carpeta `docs/` de la rama `main`. El atlas incluye los datos cartográficos y Leaflet, y se ejecuta en el navegador. Las importaciones personales se guardan en el navegador que las realizó.

El panel de fuentes documenta la procedencia y cobertura de las capas. El [catálogo de infraestructura](docs/data/infra/sources.json) incluye los inventarios de escuelas, hospitales y vías. La red vial contiene datos de [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), distribuidos bajo ODbL. Leaflet conserva su [licencia](docs/vendor/LICENSE-Leaflet.txt). Los scripts de la carpeta `scripts/` permiten recalcular los indicadores de accesibilidad y densidad con los insumos correspondientes.
