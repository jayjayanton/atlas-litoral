# Atlas Litoral

[Abrir el planificador de campañas](https://jayjayanton.github.io/atlas-litoral/#campana) · [Explorar el mapa](https://jayjayanton.github.io/atlas-litoral/#explorar) · [Consultar la aptitud de un punto](https://jayjayanton.github.io/atlas-litoral/#aptitud)

Atlas Litoral ayuda a decidir dónde probar una campaña inmobiliaria en Guayas y Santa Elena. Compara los sectores censales alrededor de un proyecto, identifica los primeros que conviene estudiar y permite contrastar el costo observado por consulta calificada o visita agendada. Los mapas de territorio, financiamiento y servicios aportan contexto a esa decisión.

## Explorar y compartir territorios

En [Explorar el mapa](https://jayjayanton.github.io/atlas-litoral/#explorar), elige un proyecto guardado o pulsa **Marcar un punto** y toca su ubicación. **Uno a la vez** sustituye la selección anterior. Con **Varios a la vez**, el mapa conserva pines numerados. Toca un pin o su nombre para activar su ficha. **Ver todos los pines** encuadra la selección y **Limpiar selección** quita los pines del mapa. Los proyectos guardados siguen disponibles en el selector.

**Planificar campaña aquí** compara los sectores alrededor del proyecto o punto activo. Al mostrar varias ubicaciones, cada plan conserva su propio centro y su propio radio. **Mostrar en el mapa** ofrece cuatro vistas iniciales. Puedes ver tus proyectos y los límites territoriales, consultar la población y los hogares de un sector, comparar estimaciones de ingresos de los hogares o evaluar la aptitud de un punto.

En **Nivel territorial**, sobre el mapa, elige **Cantón**, **Parroquia**, **Zona censal** o **Sector censal**. Toca el área que te interesa para abrir su ficha. Si ya conoces el nombre o el código, abre **Buscar un área por nombre o código**. **Acercar al área** encuadra la selección. La ficha incluye población y grupos de edad del Censo 2022 donde existe el desglose. El ingreso mediano mensual corresponde a la provincia, según la ENIGHUR 2024–25.

En **Más análisis** se encuentran los mapas de pensiones escolares, focos de escuelas y hospitales, población por edad, accesibilidad regional y crédito de vivienda. Desde **Demanda observada** puedes importar un archivo y abrir el mapa de solicitudes por cantón de origen. Al abrir un mapa especializado, el selector muestra su nombre y te permite volver a las cuatro vistas iniciales.

Los límites de zona se reconstruyen desde la cartografía oficial del INEC con `/usr/bin/python3 scripts/build_zone_outlines.py sectores_anonimizados.gpkg` en un entorno con GDAL. El mapa usa el polígono sectorial para identificar la zona en el punto consultado.

**Compartir área** abre un enlace que conserva la selección, incluso sin edificio. Ejemplos: [parroquia Manglaralto](https://jayjayanton.github.io/atlas-litoral/?area=240154#explorar), [zona 001](https://jayjayanton.github.io/atlas-litoral/?area=240154001#explorar) y [sector 002](https://jayjayanton.github.io/atlas-litoral/?area=240154001002#explorar). Los enlaces de edificios centran el mapa en las coordenadas del pin.

## Aptitud desde un punto

En [Aptitud del sitio](https://jayjayanton.github.io/atlas-litoral/#aptitud) y en la [ficha del punto en el mapa](https://jayjayanton.github.io/atlas-litoral/?capa=site#explorar), cada criterio tiene una casilla, una barra de 0 a 100, una entrada numérica y su porcentaje del peso activo. Puedes ajustar escuelas, hospitales, vías principales, centros comerciales, centros urbanos y atractivos turísticos. El escenario inicial da el mismo peso a escuelas, hospitales y vías. Un peso cero excluye el criterio. Los pesos se guardan en el navegador.

Los pesos se comparten entre el punto, la malla regional de 500 m, su clasificación y el CSV. Escuelas y hospitales se puntúan según el número de establecimientos dentro del radio frente al máximo regional del mismo escenario. Para las vías se usa la distancia máxima vial. Para las tres clases de lugares se usa el radio de servicios, de 2, 5 o 10 km. Un lugar situado a la mitad de esa distancia obtiene 50 de 100 puntos en el criterio. Dos pesos activos de 30 y 10 reparten el puntaje final en 75 % y 25 %. **Aportes al puntaje** muestra la contribución de cada criterio para el punto elegido.

El catálogo cartografiado incluye 19 centros comerciales y 34 centros urbanos de OpenStreetMap del 24 de noviembre de 2026, y 1.229 atractivos del inventario nacional IEDG 2026. Las distancias se miden en línea recta. El atractivo más cercano también puede consultarse con el criterio turístico desactivado. [Catálogo de fuentes](docs/data/infra/sources.json) · [Visor de atractivos turísticos](https://visor-iedg.github.io/Atractivos-turisticos/).

La tabla y el mapa regional se cargan al abrir **Comparar la malla regional**. Después de actualizar los catálogos o la malla, ejecuta `python scripts/build_amenity_distances.py --verify` con NumPy y SciPy para reconstruir y verificar las distancias. El pin calcula sus distancias desde las coordenadas seleccionadas.

## Planificar una campaña por territorio

El [planificador](https://jayjayanton.github.io/atlas-litoral/#campana) abre con VELIN Tower como ejemplo y usa un punto de acceso aproximado. Puedes agregar tu propio proyecto o seleccionar uno guardado en el navegador. Elige un radio de estudio y uno, tres o cinco sectores para la prueba. Puedes ordenarlos por población residente, cercanía al proyecto o, si activas un grupo de edad, por el número de residentes censados en ese grupo. La ficha compara la selección con todos los sectores cuyo punto interior cae en el radio. Un sector que cruza el límite aporta toda su población censada.

Por ejemplo, los puntos interiores de 3.532 sectores caen dentro de 10 km del acceso de referencia de VELIN Tower. Sus sectores suman 1.493.878 residentes del Censo 2022. Si eliges los tres más poblados, reúnen 4.910 residentes. Los tres más cercanos reúnen 1.560. Con un grupo de edad activo, los porcentajes se calculan dividiendo el total de residentes del grupo entre la población total de la selección o del radio. El número de hogares compradores, la intención actual de compra y la audiencia disponible para un anuncio requieren datos distintos.

Abre el mapa de la selección para ver el proyecto, los polígonos del piloto y de las referencias sugeridas, sus puntos interiores y el radio de estudio. La tabla permite consultar un sector. El CSV incluye todos los sectores elegibles con su orden, las filas de la selección, las referencias sugeridas con su pareja piloto, los totales del radio y la configuración del plan. Si importas solicitudes compatibles, la ficha destaca los principales cantones de origen de los últimos 90 días, incluso cuando difieren de los cantones del piloto. Desde el directorio puedes revisar todos los orígenes cubiertos. En el CSV cada conteo aparece una vez por cantón para que se pueda sumar sin duplicarlo.

Para cada sector piloto se propone, en orden de prioridad, el sector disponible que más se le aproxima en número de residentes. Cada referencia se usa una sola vez. En caso de empate se elige la menor diferencia en distancia al proyecto y, finalmente, el código INEC. La tabla muestra las diferencias para que puedas juzgar si conviene usar esos pares. En el ejemplo de VELIN, la selección por cercanía reúne 1.560 residentes y sus tres referencias suman 1.554. La selección por mayor población reúne 4.910 y sus referencias suman 3.014. La comparación por cercanía está mejor equilibrada en población.

Para medir el piloto, verifica en la plataforma publicitaria qué ubicaciones admite y elige una zona de referencia comparable sin solapamiento con la zona piloto. Usa el mismo proyecto, período, canal, anuncio, oferta y definición de consulta calificada. En **Comparar resultados de la campaña**, ingresa el gasto y los resultados reales de cada zona para ver el costo por consulta y por visita. La calculadora funciona en el navegador y borra sus valores al cambiar de plan o recargar. Para conservar las observaciones de la campaña, usa tu registro comercial.

También puedes [consultar directamente el sector de VELIN Tower para edades 45–54](https://jayjayanton.github.io/atlas-litoral/?sectorCampana=090150224002&edad=45-54#campana), ingresar otro código INEC de 12 dígitos o elegirlo en el mapa. La ficha incluye un círculo de referencia y el [catálogo de ubicaciones de Google Ads](https://developers.google.com/google-ads/api/data/geotargets) del 6 de octubre de 2026 para ambas provincias. Comprueba los límites y la disponibilidad en la plataforma antes de contratar pauta.

Para reconstruir los conteos, ejecuta `python scripts/build_campaign.py BDD_CPV2022_SECT_CSV.zip sectores_anonimizados.gpkg docs/data/campaign-residents.json.gz`. Para comprobar la selección, el orden y los totales del ejemplo publicado, ejecuta `node --test scripts/test_campaign_model.mjs`.

## Demografía

[Abrir el mapa de sectores con residentes de 25 a 45 años](https://jayjayanton.github.io/atlas-litoral/?capa=ages&nivel=sector&desde=25&hasta=45#explorar). Desde **Concentración por edad**, la opción **Ver mapa de concentración** abre el mapa con ambos extremos incluidos. Elige número de residentes o porcentaje de la población del área. Puedes comparar las dos provincias, una provincia o un cantón, fijar un mínimo de residentes del grupo y cambiar entre cantón, parroquia censal, zona y sector. La tabla ordena las áreas por la misma medida y abre la ficha del área elegida.

La fuente es el Censo 2022 del INEC. Los 12.497 sectores cartografiados cuentan residentes por edad cumplida. Las zonas suman esos sectores. Las parroquias y cantones incluyen también residentes con código sectorial reservado. Las parroquias urbanas de Guayaquil se publican juntas en la cabecera censal. Los quintiles del mapa se calculan entre las unidades que pasan el filtro. El porcentaje depende del total de habitantes de cada unidad.

**Ingreso laboral por edad** permite elegir entre los grupos de 18–24, 25–45, 46–59 y 60 años o más, además de tramos de ingreso mensual como USD 0–499, 500–999, 1.000–1.999 y superiores. La ficha calcula el porcentaje de personas del grupo de edad que cae en el tramo elegido en Guayas o Santa Elena. La cifra local contigua cuenta residentes del grupo en el Censo 2022. La proporción de ingresos se estima solo a escala provincial.

La fuente es la [ENEMDU anual 2025 del INEC](https://www.ecuadorencifras.gob.ec/enemdu-anual/). El cálculo usa `p03`, `prov`, `condact`, `ingrl` y el factor anual `fexp`. La opción de todas las personas incluye desempleados e inactivos. El empleo no remunerado y las pérdidas cuentan por debajo de cualquier umbral permitido. Los ingresos faltantes o desconocidos de otros ocupados se excluyen. La ficha muestra la base muestral en registros y requiere al menos 30. Para reconstruir la tabla provincial agregada, ejecuta `python scripts/build_earnings.py 2_BDD_DATOS_ABIERTOS_ENEMDU_2025_CSV.zip` con la base anual en CSV del INEC.

La ficha del sector también permite consultar la proporción estimada de hogares de cada tramo de ingreso. Esta estimación combina la distribución provincial de ENIGHUR con las edades de los representantes de los hogares de ese sector. La medida se refiere al conjunto de hogares y es independiente del grupo de residentes seleccionado.

Para reconstruir los conteos, ejecuta `python scripts/build_census_ages.py BDD_CPV2022_SECT_CSV.zip docs/data/census-ages.json` y `python scripts/build_sector_ages.py BDD_CPV2022_SECT_CSV.zip` con la base nacional del INEC y las dependencias indicadas en la sección de sectores.

## Mapa descriptivo de ingresos

El [mapa provincial](https://jayjayanton.github.io/atlas-litoral/?capa=income#explorar) muestra la mediana ponderada del ingreso corriente monetario mensual por hogar en la ENIGHUR 2024–2025. El dominio urbano de Guayaquil tiene su propia cifra de referencia en la ficha cantonal.

En el [mapa sectorial](https://jayjayanton.github.io/atlas-litoral/?capa=sector-income&sector=090150224002#explorar), elige un tramo de ingreso para comparar el porcentaje estimado de hogares. El modelo aplica las distribuciones provinciales por edad del representante a los conteos censales de 2022. La leyenda usa los mismos intervalos para ese tramo en ambas provincias. Gris indica que no hay hogares con edad del representante disponible. Los sectores fuera de la zona consultada se dibujan al acercar el mapa. El ingreso se utiliza como estadística descriptiva y queda fuera de los filtros, el ordenamiento y el CSV de campaña.

## Hogares e ingreso por sector censal

[Explorar un sector de Durán](https://jayjayanton.github.io/atlas-litoral/?capa=sectors&sector=090750001001#sectores). Busca un edificio, escuela u hospital por nombre, toca un punto del mapa o abre el selector por cantón, parroquia, zona y sector censal. La ficha identifica la provincia, el cantón y la cabecera o parroquia rural. Al elegir un sector, el mapa resalta su polígono y la ficha muestra los residentes y hogares de ese código. Activa **Mostrar sectores vecinos** para ver sus límites como referencia. Tocar otro sector reemplaza la selección. Para consultar la población de toda la zona, elige **Zona censal**. Los 12.497 sectores con edades publicables cubren Guayas y Santa Elena. Se incluyen todas las partes y huecos de sus polígonos, simplificados a cinco metros para visualización. Hay 1.447 personas y 418 hogares con código sectorial reservado que solo se pueden asignar a niveles superiores.

Para los grupos de hasta 24, 25–45, 46–59 y 60 o más años, la base censal cuenta hogares particulares por edad de su representante (P01 y P03). La tabla Hogar controla el total de hogares particulares. Los hogares sin representante identificable se incluyen en el total y se omiten de la ponderación por edad. En la ENIGHUR 2024–2025 se enlazan las dos tablas de la misma encuesta por Identif_hog, se selecciona el representante con P05 y se usa su edad P04. Cada provincia aporta una distribución de ingreso corriente monetario mensual del hogar (ing_mon_cor, peso Fexp) por grupo de edad. Se conservan los ingresos cero y se omiten las respuestas sin ingreso informado. El atlas calcula la proporción sectorial estimada en cada tramo de ingreso multiplicando las proporciones provinciales por la composición local de hogares. La tabla presenta los cuartiles ponderados, el tamaño de la muestra y el principal de una anualidad de cuota fija bajo los supuestos elegidos. La encuesta y el censo tienen períodos distintos. El modelo supone que dentro de la provincia los hogares del mismo grupo tienen la misma distribución de ingresos.

Para reconstruir los archivos, usa Python 3 con los enlaces de GDAL. Descarga la [base censal sectorial](https://www.ecuadorencifras.gob.ec/documentos/web-inec/bd-censo/sector/BDD_CPV2022_SECT_CSV.zip), la [cartografía sectorial anonimizada](https://www.ecuadorencifras.gob.ec/documentos/web-inec/capa/CapaSectores.zip) y las [bases abiertas ENIGHUR](https://www.ecuadorencifras.gob.ec/documentos/web-inec/Estadisticas_Sociales/enighur/2024-2025/DATOS_ABIERTOS_ENIGHUR_v1.zip). Extrae el GeoPackage y los dos CSV de la encuesta, y ejecuta:

```sh
python scripts/build_sector_profiles.py BDD_CPV2022_SECT_CSV.zip sectores_anonimizados.gpkg ENIGHUR25_HOGARES_AGREGADOS.csv ENIGHUR_F1_PERSONAS.csv docs/data/sectors
```

## Comparar crédito de vivienda

[Abre la comparación por umbral](https://jayjayanton.github.io/atlas-litoral/?capa=credit#credito) para consultar el número de créditos sobre un monto o las áreas cuyo préstamo promedio lo supera. Escribe tu propio umbral en USD. El navegador recuerda el último monto válido, incluso con centavos. Al borrar el campo se elimina esa preferencia. La opción **Usar precio menos entrada del proyecto** ajusta el umbral al escenario del edificio activo.

La comparación cantonal utiliza los créditos originales inmobiliarios, VIS y VIP de la banca privada entre enero y septiembre de 2026. El informe agrupa operaciones. Cuando el conteo exacto sobre el umbral es indeterminado, la tabla muestra los límites compatibles con los montos y conteos publicados.

En **Parroquia · SEPS**, carga el archivo de texto tabulado descomprimido de la base mensual de volumen de crédito. Puedes seleccionar ediciones con meses distintos. Se incluyen hasta los últimos doce meses del archivo, solo operaciones originales de personas naturales de los tipos generales inmobiliario y vivienda. Los intervalos oficiales permiten un conteo exacto para USD 100.000. Se unen los códigos DPA con polígonos disponibles y, para parroquias urbanas de Guayaquil, se coteja también el nombre municipal dentro del cantón. Las filas sin geometría quedan en la tabla. Los resultados importados se guardan en este navegador.

## Registrar un proyecto

En **Nuevo proyecto**, busca por nombre en tus edificios, el catálogo de proyectos y los edificios residenciales colectivos, comerciales y de uso público con nombre en OpenStreetMap en Guayas y Santa Elena. Cuando se repite un nombre, elige la coincidencia por cantón y coordenadas. Para un edificio nuevo, ingresa sus coordenadas o elige el punto en el mapa. El mapa se centra en el pin a escala de calle. La ficha de la derecha muestra provincia, cantón, parroquia, zona y sector censal según los polígonos disponibles. **Ver ficha del sector** abre sus estadísticas. El radio de los cálculos de accesibilidad se puede ajustar en Aptitud. Al recargar la página se borra la selección activa. **Compartir ubicación** abre el pin en otro navegador.

Los edificios que agregas desde el mapa se guardan en tu navegador. Para mostrar uno a todos los visitantes, agrega una entrada al [catálogo público de edificios](docs/data/buildings.json) con un `id` único, `name`, `lat` y `lon`, y guarda el cambio en la rama `main`.

El índice local de edificios se obtiene de las huellas cartografiadas con nombre en el extracto de Ecuador del 24 de noviembre de 2026. Cada ubicación OSM es un punto sobre la superficie del edificio. Para reconstruirlo, usa GDAL y ejecuta `python3 scripts/build_named_buildings.py ecuador-261124.osm.pbf`. [Extracto de Geofabrik](https://download.geofabrik.de/south-america/ecuador/) · [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright).

## Mapas de fondo

**Calles** muestra OpenStreetMap y **Satélite** muestra el mosaico anual Sentinel-2 de 2021, con una resolución de 10 m. Al acercar por encima de la resolución disponible se amplía la misma imagen. La vista se puede cambiar en el explorador y en el mapa de zonas de prueba. El enlace de Esri abre su mapa público de calles o de imágenes satelitales con etiquetas en el centro y la escala de la vista. La cartografía local sigue disponible cuando falla un servicio. [OpenStreetMap](https://www.openstreetmap.org/copyright) · [ESA WorldCover](https://esa-worldcover.org/en/data-access) · [Esri Streets](https://www.arcgis.com/home/item.html?id=55ebf90799fa4a3fa57562700a68c405) · [Esri Imagery Hybrid](https://www.arcgis.com/home/item.html?id=28f49811a6974659988fd279de5ce39f)

Para usar los fondos de Esri directamente debajo de los proyectos y los sectores, configura una clave pública de navegador de ArcGIS Location Platform, con acceso a los servicios de teselas estáticas y mapas base, restringida al origen de producción. En el `<head>` de `docs/index.html`, agrega `<meta name="atlas-esri-public-key" content="CLAVE_PUBLICA">`. Las opciones cargarán Esri Streets y World Imagery. Si el servicio rechaza la clave, el mapa vuelve al proveedor abierto e identifica la fuente en pantalla. [Teselas de Esri Streets](https://developers.arcgis.com/rest/static-basemap-tiles/arcgis-streets-tile-get/) · [Fuentes de los mapas base de Esri](https://developers.arcgis.com/rest/basemap-styles/service-data/)

## Abrir en tu computadora

Desde la carpeta del repositorio, ejecuta `python -m http.server 8000 --directory docs` y abre <http://localhost:8000/>. En Windows también puedes usar `py -m http.server 8000 --directory docs`.

## Publicación y datos

GitHub Pages sirve la carpeta `docs/` de la rama `main`. El atlas incluye los datos cartográficos y Leaflet, y se ejecuta en el navegador. Las importaciones personales se guardan en el navegador que las realizó.

Después de editar el CSS, los módulos JavaScript o la imagen de vista regional, ejecuta `python scripts/version_map_assets.py` y publica también el `docs/index.html` actualizado. Así los navegadores cargan las versiones correspondientes a esa página.

El panel de fuentes documenta la procedencia y cobertura de las capas. El [catálogo de infraestructura](docs/data/infra/sources.json) incluye los inventarios de escuelas, hospitales y vías. La red vial contiene datos de [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), distribuidos bajo ODbL. Leaflet conserva su [licencia](docs/vendor/LICENSE-Leaflet.txt). Los scripts de la carpeta `scripts/` permiten recalcular los indicadores de accesibilidad y densidad con los insumos correspondientes.
