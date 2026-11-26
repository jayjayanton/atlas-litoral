# Atlas Litoral

[Ver el mapa interactivo](https://jayjayanton.github.io/atlas-litoral/) · [Abrir el análisis de aptitud](https://jayjayanton.github.io/atlas-litoral/#aptitud)

Atlas de acceso a servicios y mercado de vivienda en Guayas y Santa Elena, Ecuador. Selecciona un cantón para consultar sus indicadores o combina escuelas, hospitales y vías en el panel **Aptitud territorial ponderada**. Puedes comparar cómo cambia el resultado al modificar los pesos de cada criterio. La puntuación describe el acceso a servicios. Para evaluar la demanda de vivienda, consulta la fuente, el período y la cobertura de los indicadores de mercado.

## Aptitud desde un punto

En [Aptitud en un punto](https://jayjayanton.github.io/atlas-litoral/?capa=site#explorar), toca el mapa, ingresa latitud y longitud o selecciona un edificio. El pin temporal se puede mover con otro toque y se borra al recargar. La ficha usa esas coordenadas para contar escuelas y hospitales dentro del radio elegido (2, 5 o 10 km), medir la distancia a la vía principal más cercana y calcular el puntaje con los pesos actuales. El perfil identifica también la escuela, el hospital de la red elegida y el atractivo turístico más próximos. Selecciona un resultado para ver su posición y la línea desde el pin. Las distancias se expresan en línea recta.

Turismo se muestra como referencia descriptiva. Los 1.229 puntos del inventario nacional de 2026 permiten buscar también al otro lado de un límite provincial. Consulta el [inventario del IEDG](https://www.iedg.gob.ec/servicios/descargas/) y el [visor geográfico de atractivos](https://visor-iedg.github.io/Atractivos-turisticos/). Ejecuta `python scripts/build_attractions.py` para actualizar el catálogo. El cálculo puntual usa la misma escala regional que la malla. La comparación completa y su CSV están en **Comparar la malla regional** y se cargan al abrir esa opción.

## Campaña por sector y edad

[Consultar el sector de VELIN Tower para edades 45–54](https://jayjayanton.github.io/atlas-litoral/?sectorCampana=090150224002&edad=45-54#campana). Elige directamente un sector por su código INEC de 12 dígitos o por el mapa. La ficha cuenta a todos los residentes de la edad elegida (Censo 2022) y muestra su porcentaje sobre la población total del polígono. Incluye los seis intervalos de edad adulta de Google Ads y rangos censales adicionales como 45–60 inclusive. El punto interior y el círculo de referencia permiten comparar la geometría censal con una posible segmentación por radio. La ficha también permite consultar nombres e identificadores del [catálogo de ubicaciones de Google](https://developers.google.com/google-ads/api/data/geotargets). El extracto del 6 de octubre de 2026 incluye ubicaciones activas con código EC cuyo nombre canónico termina en Guayas o Santa Elena, Ecuador. La lista describe la provincia completa. Google determina la cobertura y disponibilidad actual de cada ubicación.

Para comparar varios sectores, selecciona un edificio y un radio. La ficha lista hasta cinco sectores con punto interior dentro del radio, ordenados por residentes de la edad elegida, población total, cercanía o consultas compatibles del cantón de origen. El CSV indica el año, el denominador y el origen territorial de cada conteo. La distancia al hospital se mide desde el edificio en línea recta. Para reconstruir los datos usa `python scripts/build_campaign.py BDD_CPV2022_SECT_CSV.zip sectores_anonimizados.gpkg docs/data/campaign-residents.json.gz`.

## Demografía

[Consulta las edades por parroquia](https://jayjayanton.github.io/atlas-litoral/?capa=ages#demografia). El rango incluye ambos extremos. Dejar vacío el máximo incluye todas las edades a partir del mínimo. La ficha presenta población total, conteo y porcentaje del rango elegido, y los cinco grupos quinquenales más numerosos. Las 65 unidades con datos en Guayas y Santa Elena son cabeceras cantonales y parroquias rurales del Censo 2022. Una parroquia urbana municipal sin código censal independiente muestra la cobertura disponible.

Para reconstruir los conteos por edad cumplida, ejecuta `python scripts/build_census_ages.py BDD_CPV2022_SECT_CSV.zip docs/data/census-ages.json` con el archivo público nacional de población por sector del INEC.

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

En **Agregar edificio**, escribe un nombre y pega la latitud y la longitud en grados decimales, por ejemplo `-2.18376, -79.97990`. En **Zoom al guardar**, elige **Parroquia** o **Cantón**. El formulario identifica el área y, al guardar, el mapa ajusta el encuadre a su límite y muestra el pin. Fuera de las dos provincias, el mapa se centra en las coordenadas. Cada vez que recargas la página, el mapa vuelve a la vista regional sin un proyecto activo. Usa **Edificios** para volver a un punto guardado o **Compartir ubicación** para abrir el mismo edificio en otro navegador. La aptitud y la accesibilidad se calculan dentro de Guayas y Santa Elena.

Los edificios que agregas desde el mapa se guardan en tu navegador. Para mostrar uno a todos los visitantes, agrega una entrada al [catálogo público de edificios](docs/data/buildings.json) con un `id` único, `name`, `lat` y `lon`, y guarda el cambio en la rama `main`.

## Abrir en tu computadora

Desde la carpeta del repositorio, ejecuta `python -m http.server 8000 --directory docs` y abre <http://localhost:8000/>. En Windows también puedes usar `py -m http.server 8000 --directory docs`.

## Publicación y datos

GitHub Pages sirve la carpeta `docs/` de la rama `main`. El atlas incluye los datos cartográficos y Leaflet, y se ejecuta en el navegador. Las importaciones personales se guardan en el navegador que las realizó.

El panel de fuentes documenta la procedencia y cobertura de las capas. El [catálogo de infraestructura](docs/data/infra/sources.json) incluye los inventarios de escuelas, hospitales y vías. La red vial contiene datos de [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), distribuidos bajo ODbL. Leaflet conserva su [licencia](docs/vendor/LICENSE-Leaflet.txt). Los scripts de la carpeta `scripts/` permiten recalcular los indicadores de accesibilidad y densidad con los insumos correspondientes.
