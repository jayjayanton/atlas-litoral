const $=id=>document.getElementById(id);
const number=new Intl.NumberFormat('es-EC',{maximumFractionDigits:2});
const titles={school:'Escuela',hospital:'Hospital',road:'Vía principal',tourism:'Atractivo turístico'};
const distance=km=>km<1?number.format(Math.round(km*1000))+' m':number.format(km)+' km';

export function initSiteView(map){
  const overlay=L.layerGroup(),connection=L.layerGroup();
  let current;
  function display(active){
    for(const group of [overlay,connection]){
      if(active&&!map.hasLayer(group))group.addTo(map);
      if(!active&&map.hasLayer(group))group.remove();
    }
  }
  function legend(){
    $('legend-title').textContent=current?.canton?'Aptitud del punto · '+current.score+' / 100':'Aptitud del sitio';
    $('legend').textContent=current?.canton?'Servicios contados a '+current.radius+' km':current?'Punto fuera de cobertura':'Toca una ubicación en el mapa.';
  }
  function render(data){
    current=data;overlay.clearLayers();connection.clearLayers();
    $('site-result').hidden=!data;$('site-nearest').replaceChildren();
    if(!data)return;
    const {site,canton,score,counts,near,parts}=data;
    const ll=[site.lat,site.lon];
    if(site.temporary)L.marker(ll,{interactive:false,keyboard:false,title:'Punto de análisis',icon:L.divIcon({className:'',html:'<span class="pm">●</span>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(overlay);
    $('site-location').textContent=[site.name,canton?.name,canton?.province,site.lat.toFixed(5)+', '+site.lon.toFixed(5)].filter(Boolean).join(' · ');
    $('site-summary').textContent=canton?'Aptitud del sitio · '+score+' / 100':'Fuera de la cobertura de Guayas y Santa Elena';
    $('site-counts').textContent=counts;
    $('site-breakdown').hidden=!parts.length;
    $('site-parts').replaceChildren(...parts.map(text=>{
      const row=document.createElement('li');row.textContent=text;return row;
    }));
    $('site-distance-note').hidden=!canton;
    if(!canton)return;
    for(const [key,title] of Object.entries(titles)){
      const row=document.createElement('li'),record=near[key];
      if(record){
        const button=document.createElement('button'),item=record.item;
        button.type='button';button.className='linkbutton';
        const name=item.name||item.ref||item.class||'Tramo sin nombre';
        button.textContent=title+' · '+distance(record.km)+' · '+name;
        button.onclick=()=>{
          const end=[record.lat??item.lat,record.lon??item.lon];
          connection.clearLayers();
          L.polyline([ll,end],{color:'#51416c',weight:3,dashArray:'5 4',interactive:false}).addTo(connection);
          const label=document.createElement('span');label.textContent=title+' · '+name;
          L.circleMarker(end,{radius:6,color:'#fff',weight:2,fillColor:'#51416c',fillOpacity:1}).bindTooltip(label).addTo(connection);
          map.fitBounds(L.latLngBounds([ll,end]),{padding:[35,40],maxZoom:16,animate:false});
          $('map').scrollIntoView({block:'center'});
        };
        row.append(button);
      }else row.textContent=title+' · Sin dato en el inventario';
      $('site-nearest').append(row);
    }
  }
  return {display,render,legend};
}
