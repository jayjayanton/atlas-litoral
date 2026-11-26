// One active location drives the analysis, even when several pins are visible.
export function initProjectSelection({map, onChange, onMarkerPick, onPlan}) {
  const byId = id => document.getElementById(id);
  const list = byId('selected-projects');
  const single = byId('select-one-project'), multiple = byId('select-several-projects');
  const pins = new Map();
  const details = L.popup({autoPan:false,offset:[0,-15]});
  let items = [], active = null, started = false, pointNumber = 0;

  function fitAll() {
    if (!items.length) return;
    if (items.length === 1) map.setView([active.lat,active.lon],16,{animate:false});
    else map.fitBounds(L.latLngBounds(items.map(item=>[item.lat,item.lon])),{padding:[38,38],maxZoom:16,animate:false});
  }
  function refreshPins() {
    for (const [id,pin] of pins) {
      if (items.some(item=>item.id===id)) continue;
      pin.remove();pins.delete(id);
    }
    items.forEach((item,index)=>{
      let pin = pins.get(item.id);
      if (!pin) {
        pin = L.marker([item.lat,item.lon],{title:item.name,alt:item.name});
        pins.set(item.id,pin);
        pin.bindTooltip(document.createTextNode(item.name),{direction:'top',offset:[0,-15]});
        pin.on('click',()=>{
          if (onMarkerPick(pin.getLatLng())) return;
          const selected = items.find(point=>point.id===item.id);
          if (selected && selected!==active) choose(selected,'stay');
          if(details.getContent())details.setLatLng(pin.getLatLng()).openOn(map);
        });
      }
      const current = active?.id === item.id;
      pin.setIcon(L.divIcon({
        className:'project-map-pin'+(current?' is-current':''),
        html:String(index+1),iconSize:[28,28],iconAnchor:[14,14],popupAnchor:[0,-15]
      }));
      pin.setTooltipContent(document.createTextNode(item.name));
      pin.options.title = item.name;
      pin.setLatLng([item.lat,item.lon]).setZIndexOffset(current?1020:1010).addTo(map);
      const element=pin.getElement();
      element.title=item.name;element.setAttribute('aria-label',item.name+(current?' · ubicación activa':' · ver ficha'));
      element.onkeydown=event=>{
        if(event.key!=='Enter' && event.key!==' ')return;
        event.preventDefault();event.stopPropagation();
        if (onMarkerPick(pin.getLatLng())) return;
        if (active?.id!==item.id) choose(item,'stay');
        pin.getElement()?.focus({preventScroll:true});
        if(details.getContent())details.setLatLng(pin.getLatLng()).openOn(map);
      };
    });
  }
  function draw() {
    const wasFocused = list.contains(document.activeElement) ? document.activeElement : null;
    const focusedIndex = wasFocused ? [...list.children].indexOf(wasFocused.parentElement) : -1;
    list.replaceChildren();
    items.forEach((item,index)=>{
      const row = document.createElement('li');
      const focus = document.createElement('button'), remove = document.createElement('button');
      const badge = document.createElement('span'), name = document.createElement('span');
      const current = item.id === active?.id;
      row.className = current?'is-current':'';
      focus.type=remove.type='button';
      focus.dataset.focusProject=item.id;remove.dataset.removeProject=item.id;
      focus.setAttribute('aria-pressed',String(current));
      focus.setAttribute('aria-label','Ver ficha de '+item.name);
      badge.className='project-key';badge.textContent=String(index+1);badge.setAttribute('aria-hidden','true');
      name.textContent=item.name;
      focus.append(badge,name);
      if (current && items.length>1) {
        const status = document.createElement('small');
        status.textContent='En ficha';focus.append(status);
      }
      remove.textContent='×';remove.setAttribute('aria-label','Quitar '+item.name+' de la selección');
      row.append(focus,remove);list.append(row);
    });
    byId('selection-actions').hidden=!items.length;
    byId('selection-fit').hidden=items.length<2;
    byId('selection-clear').hidden=!items.length;
    byId('selection-mode-help').textContent=multiple.checked
      ?'Añade proyectos o marca varios puntos. Elige un nombre para ver su ficha.'
      :'Cada elección reemplaza el pin anterior.';
    byId('project-selection-status').textContent=active
      ? items.length+(items.length===1?' ubicación. ':' ubicaciones. ')+'Ficha activa de '+active.name+'.'
      :'Sin ubicaciones seleccionadas.';
    if (wasFocused) {
      const key=wasFocused.dataset.focusProject || wasFocused.dataset.removeProject;
      const row=[...list.children].find(el=>el.firstChild.dataset.focusProject===key) ||
        list.children[Math.min(focusedIndex,list.children.length-1)];
      const target=row?(wasFocused.dataset.removeProject?row.lastChild:row.firstChild):byId('building-select');
      target.focus({preventScroll:true});
    }
    refreshPins();
  }
  function changed(view) {
    started=true;draw();onChange(active,view);
    if(view==='all')fitAll();
  }
  function choose(item,view=multiple.checked?'all':'active',replacesId) {
    if (!item) return;
    if (replacesId && replacesId!==item.id) items=items.filter(point=>point.id!==replacesId);
    if (!multiple.checked) items=[item];
    else if (items.some(p=>p.id===item.id)) items=items.map(p=>p.id===item.id?item:p);
    else items=[...items,item];
    active=item;changed(view);
  }
  function point(lat,lon) {
    const existing=items.find(item=>Math.abs(item.lat-lat)<0.0000005 && Math.abs(item.lon-lon)<0.0000005);
    if (existing) return existing;
    return {id:'point-'+crypto.randomUUID(),lat,lon,temporary:true,name:'Punto '+(++pointNumber)};
  }
  list.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if (!button) return;
    if (button.dataset.focusProject) {
      choose(items.find(p=>p.id===button.dataset.focusProject),'active');
      return;
    }
    const id=button.dataset.removeProject;
    items=items.filter(p=>p.id!==id);
    if (id===active?.id) active=items.at(-1)||null;
    changed('stay');
  });
  single.onchange=()=>{
    if(active && items.length>1){items=[active];changed('active');}
    else draw();
  };
  multiple.onchange=draw;
  byId('selection-clear').onclick=()=>{
    items=[];active=null;changed('stay');byId('building-select').focus({preventScroll:true});
  };
  byId('selection-fit').onclick=fitAll;
  byId('plan-selected-project').onclick=()=>{if(active)onPlan(active);};
  single.disabled=multiple.disabled=false;
  draw();
  return {
    choose,point,
    get items(){return items;},get started(){return started;},
    popup(content){details.setContent(content);}
  };
}
