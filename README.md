# Atlas Litoral

[Ver el mapa interactivo](https://jayjayanton.github.io/atlas-litoral/) · [Abrir el análisis de aptitud](https://jayjayanton.github.io/atlas-litoral/#aptitud)

Atlas de acceso a servicios y mercado de vivienda en Guayas y Santa Elena, Ecuador. Selecciona un cantón para consultar sus indicadores o combina escuelas, hospitales y vías en el panel **Aptitud territorial ponderada**. Puedes comparar cómo cambia el resultado al modificar los pesos de cada criterio. La puntuación describe el acceso a servicios. Para evaluar la demanda de vivienda, consulta la fuente, el período y la cobertura de los indicadores de mercado.

## Explorar y compartir territorios

En **Nivel territorial**, elige cantón, parroquia, zona censal o sector censal. Al tocar el mapa se actualiza la ficha del área y se conserva el encuadre. **Buscar un área** permite navegar por nombre o código y **Acercar al área** encuadra la selección. La ficha muestra población y cuatro grupos de edad del Censo 2022 cuando hay desglose. El ingreso mediano mensual corresponde a la provincia, según la ENIGHUR 2024–25.

En **Mostrar en el mapa**, los focos de escuelas y de hospitales MSP muestran establecimientos por 10.000 habitantes en cada cantón. El contorno discontinuo identifica los focos estadísticamente significativos. La capa escolar identifica Balzar y El Empalme. La hospitalaria no registra focos significativos entre los 28 cantones. En **Herramientas de análisis**, abre **Accesibilidad a servicios** para consultar distancias o **Focos de escuelas y hospitales** para ver agrupaciones cantonales. **Cambiar herramienta** muestra un solo análisis a la vez. **Cerrar** vuelve a la lista.

Los límites de zona se reconstruyen desde la cartografía oficial del INEC con `/usr/bin/python3 scripts/build_zone_outlines.py sectores_anonimizados.gpkg` en un entorno con GDAL. El mapa usa el polígono sectorial para identificar la zona en el punto consultado.

**Compartir área** abre un enlace que conserva la selección, incluso sin edificio. Ejemplos: [parroquia Manglaralto](https://jayjayanton.github.io/atlas-litoral/?area=240154#explorar), [zona 001](https://jayjayanton.github.io/atlas-litoral/?area=240154001#explorar) y [sector 002](https://jayjayanton.github.io/atlas-litoral/?area=240154001002#explorar). Los enlaces de edificios centran el mapa en las coordenadas del pin.

## Aptitud desde un punto

En [Aptitud en un punto](https://jayjayanton.github.io/atlas-litoral/?capa=site#explorar), toca el mapa, ingresa coordenadas o selecciona un edificio. Marca los servicios y lugares que quieras incluir: escuelas, hospitales, vías, centros comerciales y centros urbanos. El puntaje de 0 a 100 suma los aportes ponderados. Para escuelas y hospitales, cuenta los registros dentro del radio. Para vías y lugares, la proximidad se compara con el límite indicado. La ficha muestra el aporte de cada criterio y las distancias en línea recta. Los centros comerciales cartografiados y las cabeceras urbanas proceden de OpenStreetMap, extracto del 24 de noviembre de 2026. El inventario turístico IEDG se muestra como referencia separada.

Turismo se muestra como referencia descriptiva. Los 1.229 puntos del inventario nacional de 2026 permiten buscar también al otro lado de un límite provincial. Consulta el [inventario del IEDG](https://www.iedg.gob.ec/servicios/descargas/) y el [visor geográfico de atractivos](https://visor-iedg.github.io/Atractivos-turisticos/). Ejecuta `python scripts/build_attractions.py` para actualizar el catálogo. El cálculo puntual usa la misma escala regional que la malla. La comparación completa y su CSV están en **Comparar la malla regional** y se cargan al abrir esa opción.

## Campaña por sector y edad

[Consultar el sector de VELIN Tower para edades 45–54](https://jayjayanton.github.io/atlas-litoral/?sectorCampana=090150224002&edad=45-54#campana). Elige directamente un sector por su código INEC de 12 dígitos o por el mapa. La ficha cuenta a todos los residentes de la edad elegida (Censo 2022) y muestra su porcentaje sobre la población total del polígono. Incluye los seis intervalos de edad adulta de Google Ads y rangos censales adicionales como 45–60 inclusive. El punto interior y el círculo de referencia permiten comparar la geometría censal con una posible segmentación por radio. La ficha también permite consultar nombres e identificadores del [catálogo de ubicaciones de Google](https://developers.google.com/google-ads/api/data/geotargets). El extracto del 6 de octubre de 2026 incluye ubicaciones activas con código EC cuyo nombre canónico termina en Guayas o Santa Elena, Ecuador. La lista describe la provincia completa. Google determina la cobertura y disponibilidad actual de cada ubicación.

Para comparar varios sectores, selecciona un edificio y un radio. La ficha lista hasta cinco sectores con punto interior dentro del radio, ordenados por residentes de la edad elegida, población total, cercanía o consultas compatibles del cantón de origen. El CSV indica el año, el denominador y el origen territorial de cada conteo. La distancia al hospital se mide desde el edificio en línea recta. Para reconstruir los datos usa `python scripts/build_campaign.py BDD_CPV2022_SECT_CSV.zip sectores_anonimizados.gpkg docs/data/campaign-residents.json.gz`.

## Demografía

[Abrir el mapa de sectores con residentes de 25 a 45 años](https://jayjayanton.github.io/atlas-litoral/?capa=ages&nivel=sector&desde=25&hasta=45#explorar). **Explorar por edad** abre el mapa con ambos extremos incluidos. Elige número de residentes o porcentaje de la población del área. Puedes comparar las dos provincias, una provincia o un cantón, fijar un mínimo de residentes del grupo y cambiar entre cantón, parroquia censal, zona y sector. La tabla ordena las áreas por la misma medida y abre la ficha del área elegida.

La fuente es el Censo 2022 del INEC. Los 12.497 sectores cartografiados cuentan residentes por edad cumplida. Las zonas suman esos sectores. Las parroquias y cantones incluyen también residentes con código sectorial reservado. Las parroquias urbanas de Guayaquil se publican juntas en la cabecera censal. Los quintiles del mapa se calculan entre las unidades que pasan el filtro. El porcentaje depende del total de habitantes de cada unidad.

**Ingreso laboral por edad** permite elegir entre los grupos de 18–24, 25–45, 46–59 y 60 años o más, además de tramos de ingreso mensual como USD 0–499, 500–999, 1.000–1.999 y superiores. La ficha calcula el porcentaje de personas del grupo de edad que cae en el tramo elegido en Guayas o Santa Elena. La cifra local contigua cuenta residentes del grupo en el Censo 2022. La proporción de ingresos se estima solo a escala provincial.

La fuente es la [ENEMDU anual 2025 del INEC](https://www.ecuadorencifras.gob.ec/enemdu-anual/). El cálculo usa `p03`, `prov`, `condact`, `ingrl` y el factor anual `fexp`. La opción de todas las personas incluye desempleados e inactivos. El empleo no remunerado y las pérdidas cuentan por debajo de cualquier umbral permitido. Los ingresos faltantes o desconocidos de otros ocupados se excluyen. La ficha muestra la base muestral en registros y requiere al menos 30. Para reconstruir la tabla provincial agregada, ejecuta `python scripts/build_earnings.py 2_BDD_DATOS_ABIERTOS_ENEMDU_2025_CSV.zip` con la base anual en CSV del INEC.

La ficha del sector también permite consultar la proporción estimada de hogares de cada tramo de ingreso. Esta estimación combina la distribución provincial de ENIGHUR con las edades de los representantes de los hogares de ese sector. La medida se refiere al conjunto de hogares y es independiente del grupo de residentes seleccionado.

Para reconstruir los conteos, ejecuta `python scripts/build_census_ages.py BDD_CPV2022_SECT_CSV.zip docs/data/census-ages.json` y `python scripts/build_sector_ages.py BDD_CPV2022_SECT_CSV.zip` con la base nacional del INEC y las dependencias indicadas en la sección de sectores.

## Mapa descriptivo de ingresos

El [mapa provincial](https://jayjayanton.github.io/atlas-litoral/?capa=income#explorar) muestra la mediana ponderada del ingreso corriente monetario mensual por hogar en la ENIGHUR 2024–2025. El dominio urbano de Guayaquil tiene su propia cifra de referencia en la ficha cantonal.

En el [mapa sectorial](https://jayjayanton.github.io/atlas-litoral/?capa=sector-income&sector=090150224002#explorar), elige un tramo de ingreso para comparar el porcentaje estimado de hogares. El modelo aplica las distribuciones provinciales por edad del representante a los conteos censales de 2022. La leyenda usa los mismos intervalos para ese tramo en ambas provincias. Gris indica que no hay hogares con edad del representante disponible. Los sectores fuera de la zona consultada se dibujan al acercar el mapa. El ingreso se utiliza como estadística descriptiva y queda fuera de los filtros, el ordenamiento y el CSV de campaña.

## Hogares e ingreso por sector censal

[Explorar un sector de Durán](https://jayjayanton.github.io/atlas-litoral/?capa=sectors&sector=090750001001#sectores). Busca un edificio, escuela u hospital por nombre, toca un punto del mapa o abre el selector por cantón, parroquia, zona y sector censal. La ficha identifica la provincia, el cantón y la cabecera o parroquia rural. Al acercarte, el mapa distingue el sector elegido de los demás sectores de su zona y de las zonas vecinas. Los 12.497 sectores con edades publicables cubren Guayas y Santa Elena. Se incluyen todas las partes y huecos de sus polígonos, simplificados a cinco metros para visualización. Hay 1.447 personas y 418 hogares con código sectorial reservado que solo se pueden asignar a niveles superiores.

Para los grupos de hasta 24, 25–45, 46–59 y 60 o más años, la base censal cuenta hogares particulares por edad de su representante (P01 y P03). La tabla Hogar controla el total de hogares particulares. Los hogares sin representante identificable se incluyen en el total y se omiten de la ponderación por edad. En la ENIGHUR 2024–2025 se enlazan las dos tablas de la misma encuesta por Identif_hog, se selecciona el representante con P05 y se usa su edad P04. Cada provincia aporta una distribución de ingreso corriente monetario mensual del hogar (ing_mon_cor, peso Fexp) por grupo de edad. Se conservan los ingresos cero y se omiten las respuestas sin ingreso informado. El atlas calcula la proporción sectorial estimada en cada tramo de ingreso multiplicando las proporciones provinciales por la composición local de hogares. La tabla presenta los cuartiles ponderados, el tamaño de la muestra y el principal de una anualidad de cuota fija bajo los supuestos elegidos. La encuesta y el censo tienen períodos distintos. El modelo supone que dentro de la provincia los hogares del mismo grupo tienen la misma distribución de ingresos.

Para reconstruir los archivos, usa Python 3 con los enlaces de GDAL. Descarga la [base censal sectorial](https://www.ecuadorencifras.gob.ec/documentos/web-inec/bd-censo/sector/BDD_CPV2022_SECT_CSV.zip), la [cartografía sectorial anonimizada](https://www.ecuadorencifras.gob.ec/documentos/web-inec/capa/CapaSectores.zip) y las [bases abiertas ENIGHUR](https://www.ecuadorencifras.gob.ec/documentos/web-inec/Estadisticas_Sociales/enighur/2024-2025/DATOS_ABIERTOS_ENIGHUR_v1.zip). Extrae el GeoPackage y los dos CSV de la encuesta, y ejecuta:

```sh
python scripts/build_sector_profiles.py BDD_CPV2022_SECT_CSV.zip sectores_anonimizados.gpkg ENIGHUR25_HOGARES_AGREGADOS.csv ENIGHUR_F1_PERSONAS.csv docs/data/sectors
```

## Comparar crédito de vivienda

[Abre la comparación por umbral](https://jayjayanton.github.io/atlas-litoral/?capa=credit#credito) para consultar el número de créditos sobre un monto o las áreas cuyo préstamo promedio lo supera. Escribe tu propio umbral en USD. El navegador recuerda el último monto válido, incluso con centavos. Al borrar el campo se elimina esa preferencia. La opción **Usar precio menos entrada del proyecto** ajusta el umbral al escenario del edificio activo.

La comparación cantonal utiliza los créditos originales inmobiliarios, VIS y VIP de la banca privada entre enero y septiembre de 2026. El informe agrupa operaciones. Cuando el conteo exacto sobre el umbral es indeterminado, la tabla muestra los límites compatibles con los montos y conteos publicados.

En **Parroquia · SEPS**, carga el archivo de texto tabulado descomprimido de la base mensual de volumen de crédito. Puedes seleccionar ediciones con meses distintos. Se incluyen hasta los últimos doce meses del archivo, solo operaciones originales de personas naturales de los tipos generales inmobiliario y vivienda. Los intervalos oficiales permiten un conteo exacto para USD 100.000. Se unen los códigos DPA con polígonos disponibles y, para parroquias urbanas de Guayaquil, se coteja también el nombre municipal dentro del cantón. Las filas sin geometría quedan en la tabla. Los resultados importados se guardan en este navegador.

## Agregar un edificio

En **Agregar edificio**, busca por nombre en tus edificios, el catálogo de proyectos y los edificios residenciales colectivos, comerciales y de uso público con nombre en OpenStreetMap en Guayas y Santa Elena. Cuando se repite un nombre, elige la coincidencia por cantón y coordenadas. Para un edificio nuevo, ingresa sus coordenadas o elige el punto en el mapa. El mapa se centra en el pin a escala de calle. La ficha de la derecha muestra provincia, cantón, parroquia, zona y sector censal según los polígonos disponibles. **Ver ficha del sector** abre sus estadísticas. El radio de los cálculos de accesibilidad se puede ajustar en Aptitud. Al recargar la página se borra la selección activa. **Compartir ubicación** abre el pin en otro navegador.

Los edificios que agregas desde el mapa se guardan en tu navegador. Para mostrar uno a todos los visitantes, agrega una entrada al [catálogo público de edificios](docs/data/buildings.json) con un `id` único, `name`, `lat` y `lon`, y guarda el cambio en la rama `main`.

El índice local de edificios se obtiene de las huellas cartografiadas con nombre en el extracto de Ecuador del 24 de noviembre de 2026. Cada ubicación OSM es un punto sobre la superficie del edificio. Para reconstruirlo, usa GDAL y ejecuta `python3 scripts/build_named_buildings.py ecuador-261124.osm.pbf`. [Extracto de Geofabrik](https://download.geofabrik.de/south-america/ecuador/) · [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright).

## Abrir en tu computadora

Desde la carpeta del repositorio, ejecuta `python -m http.server 8000 --directory docs` y abre <http://localhost:8000/>. En Windows también puedes usar `py -m http.server 8000 --directory docs`.

## Publicación y datos

GitHub Pages sirve la carpeta `docs/` de la rama `main`. El atlas incluye los datos cartográficos y Leaflet, y se ejecuta en el navegador. Las importaciones personales se guardan en el navegador que las realizó.

Después de editar el CSS, los módulos JavaScript o la imagen de vista regional, ejecuta `python scripts/version_map_assets.py` y publica también el `docs/index.html` actualizado. Así los navegadores cargan las versiones correspondientes a esa página.

El panel de fuentes documenta la procedencia y cobertura de las capas. El [catálogo de infraestructura](docs/data/infra/sources.json) incluye los inventarios de escuelas, hospitales y vías. La red vial contiene datos de [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), distribuidos bajo ODbL. Leaflet conserva su [licencia](docs/vendor/LICENSE-Leaflet.txt). Los scripts de la carpeta `scripts/` permiten recalcular los indicadores de accesibilidad y densidad con los insumos correspondientes.
