# Atlas Litoral

[Ver el mapa interactivo](https://jayjayanton.github.io/atlas-litoral/) · [Abrir el análisis de aptitud](https://jayjayanton.github.io/atlas-litoral/#aptitud)

Atlas de acceso a servicios y mercado de vivienda en Guayas y Santa Elena, Ecuador. Selecciona un cantón para consultar sus indicadores o combina escuelas, hospitales y vías en el panel **Aptitud territorial ponderada**. Puedes comparar cómo cambia el resultado al modificar los pesos de cada criterio. La puntuación describe el acceso a servicios. Para evaluar la demanda de vivienda, consulta la fuente, el período y la cobertura de los indicadores de mercado.

## Abrir en tu computadora

Desde la carpeta del repositorio, ejecuta `python -m http.server 8000 --directory docs` y abre <http://localhost:8000/>. En Windows también puedes usar `py -m http.server 8000 --directory docs`.

## Publicación y datos

GitHub Pages sirve la carpeta `docs/` de la rama `main`. El atlas incluye los datos cartográficos y Leaflet, y se ejecuta en el navegador. Las importaciones personales se guardan en el navegador que las realizó.

El panel de fuentes documenta la procedencia y cobertura de las capas. El [catálogo de infraestructura](docs/data/infra/sources.json) incluye los inventarios de escuelas, hospitales y vías. La red vial contiene datos de [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), distribuidos bajo ODbL. Leaflet conserva su [licencia](docs/vendor/LICENSE-Leaflet.txt). Los scripts de la carpeta `scripts/` permiten recalcular los indicadores de accesibilidad y densidad con los insumos correspondientes.
