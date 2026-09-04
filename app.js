const STORE_KEY = 'viacruz-reisezeit-data-v1';
const SETTINGS_KEY = 'viacruz-reisezeit-settings-v1';

function loadSettings(){
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch { return {}; }
}
function updateSetting(key,value){
  const settings=loadSettings();
  settings[key]=value;
  localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));
}

const typeLabels = {
  camping: 'Campingplatz', stellplatz: 'Stellplatz', hotel: 'Hotel',
  ferien: 'Ferienwohnung/Ferienhaus', besonders: 'Besondere Unterkunft', reiseziel: 'Reiseziel/Ausflugsziel'
};
const typeIcons = {camping:'△', stellplatz:'▣', hotel:'H', ferien:'⌂', besonders:'◇', reiseziel:'◎'};

const state = {
  route: 'home',
  holidayFilter: 'all',
  query: '',
  entries: loadEntries()
};

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
let campingMediaDraft=[];
let campingTitleImageDraft=null;
let stellplatzSeasonPriceDraft=[];

function cloneMediaList(media){
  return Array.isArray(media)?media.map(m=>({...m})):[];
}
function imageById(e,id){
  return (e.media||[]).find(m=>m.id===id);
}
function campingTitleMedia(e){
  return imageById(e,e.titleImageId) || null;
}
async function imageFileToDataUrl(file){
  const raw=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
  const img=await new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=reject;
    image.src=raw;
  });
  const maxSide=1600;
  const scale=Math.min(1,maxSide/Math.max(img.width,img.height));
  const w=Math.max(1,Math.round(img.width*scale));
  const h=Math.max(1,Math.round(img.height*scale));
  const canvas=document.createElement('canvas');
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');
  ctx.drawImage(img,0,0,w,h);
  return canvas.toDataURL('image/jpeg',0.82);
}
function renderCampingMediaEditor(){
  const wrap=document.getElementById('campingMediaEditor'); if(!wrap)return;
  if(!campingMediaDraft.length){
    wrap.innerHTML='<div class="media-empty">Noch keine Bilder gespeichert.</div>';
    return;
  }
  wrap.innerHTML=campingMediaDraft.map(m=>{
    const isTitle=m.id===campingTitleImageDraft;
    return `<div class="media-edit-card" data-media-id="${escapeHtml(m.id)}">
      <div class="media-edit-image-wrap">
        <img src="${m.dataUrl}" alt="${escapeHtml(m.description||'Gespeichertes Bild')}" />
        ${isTitle?'<span class="media-title-badge">Titelbild</span>':''}
      </div>
      <input class="media-description" type="text" value="${escapeHtml(m.description||'')}" placeholder="Kurze Beschreibung, optional" />
      <div class="media-card-actions">
        <button type="button" class="btn secondary media-set-title">${isTitle?'Titelbild':'Als Titelbild'}</button>
        <button type="button" class="btn danger media-delete">Löschen</button>
      </div>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.media-description').forEach(input=>{
    input.addEventListener('input',()=>{
      const card=input.closest('.media-edit-card');
      const m=campingMediaDraft.find(x=>x.id===card?.dataset.mediaId);
      if(m)m.description=input.value;
    });
  });
  wrap.querySelectorAll('.media-set-title').forEach(btn=>{
    btn.onclick=()=>{
      const id=btn.closest('.media-edit-card')?.dataset.mediaId;
      campingTitleImageDraft=id||null;
      renderCampingMediaEditor();
    };
  });
  wrap.querySelectorAll('.media-delete').forEach(btn=>{
    btn.onclick=()=>{
      const id=btn.closest('.media-edit-card')?.dataset.mediaId;
      campingMediaDraft=campingMediaDraft.filter(m=>m.id!==id);
      if(campingTitleImageDraft===id)campingTitleImageDraft=null;
      renderCampingMediaEditor();
    };
  });
}
async function addCampingMediaFiles(files){
  const selected=[...files].filter(f=>f.type.startsWith('image/'));
  if(!selected.length)return;
  const button=document.getElementById('addCampingMedia');
  if(button){button.disabled=true;button.textContent='Bilder werden vorbereitet …';}
  try{
    for(const file of selected){
      const dataUrl=await imageFileToDataUrl(file);
      const item={id:uid(),kind:'image',name:file.name||'Bild',description:'',dataUrl,createdAt:new Date().toISOString()};
      campingMediaDraft.push(item);
      if(!campingTitleImageDraft)campingTitleImageDraft=item.id;
    }
    renderCampingMediaEditor();
  }catch(err){
    alert('Mindestens ein Bild konnte nicht verarbeitet werden.');
  }finally{
    if(button){button.disabled=false;button.textContent='+ Bilder auswählen';}
    const input=document.getElementById('campingMediaInput'); if(input)input.value='';
  }
}
function campingHeroHtml(e){
  const title=campingTitleMedia(e);
  if(title?.dataUrl){
    return `<div class="detail-title-image"><img src="${title.dataUrl}" alt="${escapeHtml(title.description||e.name||'Campingplatz')}" /></div>`;
  }
  return `<div class="detail-title-image detail-title-placeholder"><span>△</span><strong>Campingplatz</strong></div>`;
}
function campingGalleryHtml(e){
  const media=Array.isArray(e.media)?e.media.filter(m=>m.kind==='image'&&m.dataUrl):[];
  if(!media.length)return '';
  return `<section class="detail-gallery-section"><div class="detail-gallery-head"><small>Bilder</small><strong>${media.length} ${media.length===1?'Bild':'Bilder'}</strong></div>
    <div class="detail-gallery">${media.map(m=>`<figure class="gallery-item ${m.id===e.titleImageId?'is-title':''}"><img src="${m.dataUrl}" alt="${escapeHtml(m.description||'Gespeichertes Bild')}" />${m.id===e.titleImageId?'<span>Titelbild</span>':''}${m.description?`<figcaption>${escapeHtml(m.description)}</figcaption>`:''}</figure>`).join('')}</div>
  </section>`;
}

function loadEntries(){
  try { return JSON.parse(localStorage.getItem(STORE_KEY))?.entries || []; }
  catch { return []; }
}
function saveEntries(){
  localStorage.setItem(STORE_KEY, JSON.stringify({ dataVersion:1, updatedAt:new Date().toISOString(), entries:state.entries }));
}
function escapeHtml(v=''){ return String(v).replace(/[&<>'"]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])); }
function count(predicate){ return state.entries.filter(e => !e.deleted && predicate(e)).length; }
function locationText(e){ return [e.town,e.region,e.country].filter(Boolean).join(', ') || 'Ort noch nicht ergänzt'; }
function splitList(v=''){ return String(v).split(',').map(x=>x.trim()).filter(Boolean); }
function valueLabel(value,map,fallback='Unbekannt'){ return map[value] || fallback; }
function yesNoUnknown(value){ return valueLabel(value,{yes:'Möglich',no:'Nicht möglich',unknown:'Unbekannt'}); }
function formatDate(value){ if(!value)return ''; const d=new Date(value+'T00:00:00'); return Number.isNaN(d.getTime())?value:d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}); }
function detailRow(label,value,rawHtml=false){
  if(value===undefined || value===null || value==='') return '';
  return `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${rawHtml?value:escapeHtml(value)}</strong></div>`;
}
function knownYesNo(value,yes='Ja',no='Nein'){
  if(value==='yes') return yes;
  if(value==='no') return no;
  return '';
}
function phoneHref(value=''){
  const clean=String(value||'').trim().replace(/[^\d+]/g,'');
  return clean ? `tel:${clean}` : '';
}
function normalizeExternalUrl(value=''){
  const raw=String(value||'').trim();
  if(!raw) return '';
  if(/^https?:\/\//i.test(raw)) return raw;
  if(/^www\./i.test(raw)) return `https://${raw}`;
  if(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/:?#].*)?$/i.test(raw)) return `https://${raw}`;
  return '';
}
function sourceLabel(e){ return e.sourceType || (e.source && !normalizeExternalUrl(e.source) ? e.source : ''); }
function sourceUrl(e){ return normalizeExternalUrl(e.sourceUrl || (e.source && normalizeExternalUrl(e.source) ? e.source : '')); }

function render(){
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.route===state.route));
  const app = document.getElementById('app');
  if(state.route==='home') app.innerHTML = homeView();
  else if(state.route==='camping') app.innerHTML = listView('camping','Campingplätze');
  else if(state.route==='stellplatz') app.innerHTML = listView('stellplatz','Stellplätze');
  else if(state.route==='urlaub') app.innerHTML = holidayView();
  else if(state.route==='search') app.innerHTML = searchView();
  else if(state.route==='settings') app.innerHTML = settingsView();
  wireViewEvents();
}

function homeView(){
  const recent = state.entries.filter(e=>!e.deleted).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,4);
  const recentOpen=loadSettings().homeRecentOpen !== false;
  return `
    <section class="hero">
      <div class="hero-card">
        <div class="eyebrow">Deine persönliche Reisesammlung</div>
        <h1>Orte merken.<br>Später entdecken.</h1>
        <p>Campingplätze, Stellplätze, Unterkünfte und Reiseziele schnell speichern und später in Ruhe ergänzen.</p>
        <button class="btn primary" data-action="new" style="margin-top:18px">+ Neuer Eintrag</button>
      </div>
      <div class="hero-icon"><img src="assets/icon-512.png" alt="viacruz Reisezeit App-Icon"></div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Deine Bereiche</h2><p>Aktueller Stand deiner Sammlung</p></div></div>
      <div class="cards-3">
        ${categoryCard('camping','Campingplätze',count(e=>e.type==='camping'),'gespeicherte Plätze')}
        ${categoryCard('stellplatz','Stellplätze',count(e=>e.type==='stellplatz'),'gespeicherte Plätze')}
        ${categoryCard('urlaub','Urlaub',count(e=>['hotel','ferien','besonders','reiseziel'].includes(e.type)),'Unterkünfte & Ziele')}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Schnellzugriff</h2><p>Ohne Umwege zu deinen wichtigsten Ansichten</p></div></div>
      <div class="quick-grid">
        <button class="quick-btn" data-special="favorite">★ Favoriten<span>${count(e=>e.favorite)} Einträge</span></button>
        <button class="quick-btn" data-special="want">♡ Möchte ich besuchen<span>${count(e=>e.wantToVisit)} Einträge</span></button>
        <button class="quick-btn" data-special="visited">✓ Besucht<span>${count(e=>e.visited)} Einträge</span></button>
        <button class="quick-btn" data-route-go="search">⌕ Suche<span>Liste und Filter</span></button>
      </div>
    </section>

    <section class="section recent-section">
      <button class="section-collapse-head" type="button" data-action="toggle-recent" aria-expanded="${recentOpen?'true':'false'}">
        <span><strong>Zuletzt hinzugefügt</strong><small>Einträge, die du später weiter ergänzen kannst</small></span>
        <span class="section-collapse-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="recent-content" ${recentOpen?'':'hidden'}>
        ${recent.length ? `<div class="place-list">${recent.map(placeCard).join('')}</div>` : `<div class="empty">Noch keine Orte gespeichert. Mit „Neuer Eintrag“ legst du den ersten an.</div>`}
      </div>
    </section>
    <div class="footer-brand">powered by viacruz</div>`;
}

function categoryCard(route,label,num,sub){ return `<button class="category-card" data-route-go="${route}"><div><strong>${label}</strong><small>${sub}</small></div><div class="count">${num}</div></button>`; }
function placeCard(e){
  const titleMedia=imageById(e,e.titleImageId);
  const thumb=titleMedia?.dataUrl
    ? `<img src="${titleMedia.dataUrl}" alt="" />`
    : `${typeIcons[e.type] || '●'}`;
  return `<button class="place-card" data-detail="${e.id}">
    <div class="place-thumb ${titleMedia?.dataUrl?'has-image':''}">${thumb}</div>
    <div class="place-main"><strong>${escapeHtml(e.name)}</strong><span>${escapeHtml(locationText(e))}</span>
      <div class="badge-row"><span class="badge">${typeLabels[e.type]}</span>${e.favorite?'<span class="badge">★ Favorit</span>':''}${e.wantToVisit?'<span class="badge">Möchte ich besuchen</span>':''}</div>
    </div><div class="chev">›</div>
  </button>`;
}

function listView(type,title){
  const items = state.entries.filter(e=>!e.deleted && e.type===type && matchesQuery(e,state.query));
  return `<section><div class="section-head"><div><div class="eyebrow">Sammlung</div><h2>${title}</h2></div><button class="btn primary" data-action="new" data-pretype="${type}">+ Neu</button></div>
  <div class="toolbar"><input class="searchbox route-search" value="${escapeHtml(state.query)}" placeholder="${title} durchsuchen …"><button class="btn secondary" data-action="clear-search">Löschen</button></div>
  ${items.length?`<div class="place-list">${items.map(placeCard).join('')}</div>`:`<div class="empty">Keine passenden Einträge vorhanden.</div>`}<div class="footer-brand">powered by viacruz</div></section>`;
}

function holidayView(){
  const types = ['hotel','ferien','besonders','reiseziel'];
  const items = state.entries.filter(e=>!e.deleted && types.includes(e.type) && (state.holidayFilter==='all'||e.type===state.holidayFilter) && matchesQuery(e,state.query));
  return `<section><div class="section-head"><div><div class="eyebrow">Sammlung</div><h2>Urlaub</h2></div><button class="btn primary" data-action="new">+ Neu</button></div>
  <div class="subtabs"><button data-holiday="all" class="${state.holidayFilter==='all'?'active':''}">Alle</button><button data-holiday="hotel" class="${state.holidayFilter==='hotel'?'active':''}">Hotels</button><button data-holiday="ferien" class="${state.holidayFilter==='ferien'?'active':''}">Ferienwohnung/-haus</button><button data-holiday="besonders" class="${state.holidayFilter==='besonders'?'active':''}">Besondere Unterkunft</button><button data-holiday="reiseziel" class="${state.holidayFilter==='reiseziel'?'active':''}">Reiseziele</button></div>
  <div class="toolbar"><input class="searchbox route-search" value="${escapeHtml(state.query)}" placeholder="Urlaub durchsuchen …"><button class="btn secondary" data-action="clear-search">Löschen</button></div>
  ${items.length?`<div class="place-list">${items.map(placeCard).join('')}</div>`:`<div class="empty">Keine passenden Einträge vorhanden.</div>`}<div class="footer-brand">powered by viacruz</div></section>`;
}

function searchView(){
  const items = state.entries.filter(e=>!e.deleted && matchesQuery(e,state.query));
  return `<section><div class="section-head"><div><div class="eyebrow">Alle Einträge</div><h2>Suche</h2><p>Die freie Suche berücksichtigt Name, Land, Region, Quelle und eigene Tags.</p></div></div>
  <div class="toolbar"><input class="searchbox route-search" value="${escapeHtml(state.query)}" placeholder="z. B. Südtirol, Gardasee, Wochenende …"><button class="btn secondary" data-action="clear-search">Löschen</button></div>
  ${items.length?`<div class="place-list">${items.map(placeCard).join('')}</div>`:`<div class="empty">${state.query?'Keine Treffer für diese Suche.':'Noch keine Orte gespeichert.'}</div>`}
  <div class="footer-brand">powered by viacruz</div></section>`;
}

function matchesQuery(e,q){
  if(!q.trim()) return true;
  const hay=[e.name,e.country,e.region,e.town,e.address,e.website,e.source,e.sourceType,e.sourceUrl,...(e.tags||[]),...(e.geoTags||[]),...(e.travelRegions||[])].filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().trim().split(/\s+/).every(part=>hay.includes(part));
}

function settingsView(){
  const trash=count(e=>e.deleted);
  return `<section><div class="section-head"><div><div class="eyebrow">App</div><h2>Einstellungen</h2></div><button class="btn secondary" data-route-go="home">Fertig</button></div>
  <div class="settings-list">
    <div class="setting-card"><h3>Datensicherung erstellen</h3><p>Exportiert deine lokalen Reisezeit-Daten als JSON-Datei. Die Struktur ist bereits versioniert.</p><button class="btn primary" data-action="backup">Datensicherung erstellen</button></div>
    <div class="setting-card"><h3>Datensicherung wiederherstellen</h3><p>Importiert eine zuvor erstellte Reisezeit-Datensicherung. Bestehende Daten werden erst nach Bestätigung ersetzt.</p><input id="restoreFile" type="file" accept="application/json" style="height:auto;padding:10px"><button class="btn secondary" data-action="restore" style="margin-top:10px">Wiederherstellen</button></div>
    <div class="setting-card"><h3>Papierkorb</h3><p>${trash} gelöschte Einträge. In dieser Grundversion werden gelöschte Orte zunächst nur markiert und nicht sofort endgültig entfernt.</p></div>
    <div class="setting-card"><h3>Navigation</h3><p>Die Auswahl der Standard-Navigationsapp und die Karten-/Markerlogik folgen im nächsten Ausbauschritt auf dieser gemeinsamen Datenbasis.</p></div>
    <div class="setting-card"><h3>viacruz Reisezeit</h3><p>Version 0.3.9 · Datenformat 1</p></div>
  </div><div class="footer-brand">powered by viacruz</div></section>`;
}

function wireViewEvents(){
  document.querySelectorAll('[data-route-go]').forEach(b=>b.onclick=()=>{state.route=b.dataset.routeGo;state.query='';render();});
  document.querySelectorAll('[data-action="new"]').forEach(b=>b.onclick=()=>openEntryDialog(b.dataset.pretype));
  document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openDetail(b.dataset.detail));
  document.querySelectorAll('.route-search').forEach(i=>i.oninput=()=>{state.query=i.value;render(); const next=document.querySelector('.route-search'); if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length)}});
  document.querySelectorAll('[data-action="clear-search"]').forEach(b=>b.onclick=()=>{state.query='';render();});
  document.querySelectorAll('[data-holiday]').forEach(b=>b.onclick=()=>{state.holidayFilter=b.dataset.holiday;render();});
  document.querySelectorAll('[data-special="favorite"]').forEach(b=>b.onclick=()=>{state.route='search';state.query='';renderSpecial('favorite')});
  document.querySelectorAll('[data-special="want"]').forEach(b=>b.onclick=()=>{state.route='search';state.query='';renderSpecial('want')});
  document.querySelectorAll('[data-special="visited"]').forEach(b=>b.onclick=()=>{state.route='search';state.query='';renderSpecial('visited')});
  document.querySelectorAll('[data-action="toggle-recent"]').forEach(b=>b.onclick=()=>{
    const content=b.closest('.recent-section')?.querySelector('.recent-content');
    if(!content)return;
    const willOpen=content.hasAttribute('hidden');
    content.toggleAttribute('hidden',!willOpen);
    b.setAttribute('aria-expanded',String(willOpen));
    updateSetting('homeRecentOpen',willOpen);
  });
  document.querySelectorAll('[data-action="backup"]').forEach(b=>b.onclick=createBackup);
  document.querySelectorAll('[data-action="restore"]').forEach(b=>b.onclick=restoreBackup);
}
function renderSpecial(kind){
  const app=document.getElementById('app');
  const items=state.entries.filter(e=>!e.deleted && (kind==='favorite'?e.favorite:kind==='visited'?e.visited:e.wantToVisit));
  const title=kind==='favorite'?'Favoriten':kind==='visited'?'Besucht':'Möchte ich besuchen';
  app.innerHTML=`<section><div class="section-head"><div><div class="eyebrow">Schnellzugriff</div><h2>${title}</h2></div><button class="btn secondary" data-route-go="home">Zurück</button></div>${items.length?`<div class="place-list">${items.map(placeCard).join('')}</div>`:`<div class="empty">Noch keine Einträge in dieser Auswahl.</div>`}</section>`;
  wireViewEvents();
}

let entryDialogMode='create';
let entryDialogEditId=null;

function hasMeaningfulDetails(value){
  if(value===null || value===undefined || value==='') return false;
  if(Array.isArray(value)) return value.some(hasMeaningfulDetails);
  if(typeof value==='object') return Object.values(value).some(hasMeaningfulDetails);
  if(typeof value==='string') return !['unknown','none'].includes(value);
  if(typeof value==='boolean') return value;
  return true;
}
function compatibleCampingToStellplatz(camping){
  const c=camping||{}, p=c.pitch||{}, f=c.facilities||{};
  return {
    season:c.season?structuredClone(c.season):{},
    pitch:{
      area:p.area??null,length:p.length??null,width:p.width??null,largeMotorhome:p.largeMotorhome||'unknown',surface:[...(p.surface||[])],level:p.level||'unknown',
      electricity:p.electricity||'unknown',electricityBilling:p.electricityBilling||'unknown',electricityPrice:p.electricityPrice??null,electricityKwhPrice:p.electricityKwhPrice??null,
      freshWater:p.freshWater||'unknown',wasteWater:p.wasteWater||'unknown',wifi:p.wifi||'unknown',wifiBilling:p.wifiBilling||'unknown',wifiPrice:p.wifiPrice??null,
      access:p.access||'unknown',maxVehicleLength:p.maxVehicleLength??null,maxVehicleHeight:p.maxVehicleHeight??null,maxVehicleWeight:p.maxVehicleWeight??null
    },
    facilities:{
      wc:f.wc||'unknown',showers:f.showers||'unknown',washer:f.washer||'unknown',dryer:f.dryer||'unknown',freshWater:f.freshWaterPoint||'unknown',greyWater:f.greyWater||'unknown',
      chemicalToilet:f.chemicalToilet||'unknown',floorInlet:f.floorDrain||'unknown',garbage:f.wasteDisposal||'unknown',wasteSeparation:f.wasteSeparation||'unknown'
    },
    location:c.location?structuredClone(c.location):{},
    dog:c.dog?structuredClone(c.dog):{},
    prices:c.prices?{year:c.prices.year??null,feeStatus:c.prices.base!=null?'paid':'unknown',billing:c.prices.base!=null?'night':'unknown',amount:c.prices.base??null,seasonPrices:[],touristTax:c.prices.touristTax??null,touristTaxBilling:c.prices.touristTax!=null?'personNight':'unknown',reservationFee:c.prices.reservationFee??null,otherLabel:c.prices.otherLabel||'',otherAmount:c.prices.otherAmount??null,included:c.prices.included||'',notes:c.prices.notes||''}:{}
  };
}
function compatibleStellplatzToCamping(stellplatz){
  const s=stellplatz||{}, p=s.pitch||{}, f=s.facilities||{};
  return {
    season:s.season?structuredClone(s.season):{},
    pitch:{...structuredClone(p)},
    facilities:{...structuredClone(f)},
    location:s.location?structuredClone(s.location):{},
    dog:s.dog?structuredClone(s.dog):{},
    prices:s.prices?{year:s.prices.year??null,base:(s.prices.feeStatus==='paid'&&s.prices.billing==='night')?s.prices.amount??null:null,touristTax:s.prices.touristTaxBilling==='personNight'?s.prices.touristTax??null:null,reservationFee:s.prices.reservationFee??null,otherLabel:s.prices.otherLabel||'',otherAmount:s.prices.otherAmount??null,included:s.prices.included||'',notes:s.prices.notes||''}:{},
    leisure:{},personal:{}
  };
}
function convertEntryType(e,newType,skipConfirm=false){
  const oldType=e.type;
  if(!newType || newType===oldType) return true;
  const oldDetails=e.details||{};
  const hasOldSpecific=hasMeaningfulDetails(oldDetails[oldType]);
  if(hasOldSpecific && !skipConfirm){
    const ok=confirm(`Art wirklich von „${typeLabels[oldType]}“ zu „${typeLabels[newType]}“ ändern?\n\nGemeinsame und kompatible Angaben bleiben erhalten. Nicht passende Detailangaben werden entfernt.`);
    if(!ok) return false;
  }
  let nextDetails={};
  if(oldType==='camping' && newType==='stellplatz') nextDetails.stellplatz=compatibleCampingToStellplatz(oldDetails.camping);
  else if(oldType==='stellplatz' && newType==='camping') nextDetails.camping=compatibleStellplatzToCamping(oldDetails.stellplatz);
  e.type=newType;
  e.details=nextDetails;
  return true;
}

function openEntryDialog(pretype,editEntry){
  const dlg=document.getElementById('entryDialog');
  document.getElementById('entryForm').reset();
  entryDialogMode=editEntry?'edit':'create';
  entryDialogEditId=editEntry?.id||null;
  document.getElementById('entryDialogTitle').textContent=editEntry?'Grunddaten bearbeiten':'Neuen Ort speichern';
  document.getElementById('entrySubmitBtn').textContent=editEntry?'Änderungen speichern':'Speichern';
  if(editEntry){
    document.getElementById('entryType').value=editEntry.type;
    document.getElementById('entryName').value=editEntry.name||'';
    document.getElementById('entryCountry').value=editEntry.country||'';
    document.getElementById('entryRegion').value=editEntry.region||'';
    document.getElementById('entrySourceType').value=editEntry.sourceType||'';
    document.getElementById('entrySourceUrl').value=sourceUrl(editEntry)||'';
  }else if(pretype) document.getElementById('entryType').value=pretype;
  dlg.showModal();
  setTimeout(()=>document.getElementById('entryName').focus(),80);
}
function closeEntryDialog(){
  const dlg=document.getElementById('entryDialog');
  if(dlg.open) dlg.close();
  entryDialogMode='create';
  entryDialogEditId=null;
}
document.getElementById('closeEntry').onclick=closeEntryDialog;
document.getElementById('cancelEntry').onclick=closeEntryDialog;
document.getElementById('entryForm').addEventListener('submit', e=>{
  e.preventDefault();
  const newType=document.getElementById('entryType').value;
  if(entryDialogMode==='edit'){
    const entry=state.entries.find(x=>x.id===entryDialogEditId); if(!entry)return;
    if(!convertEntryType(entry,newType)) return;
    entry.name=entryName.value.trim()||entry.name;
    entry.country=entryCountry.value.trim();
    entry.region=entryRegion.value.trim();
    entry.source='';
    entry.sourceType=entrySourceType.value;
    entry.sourceUrl=normalizeExternalUrl(entrySourceUrl.value) || entrySourceUrl.value.trim();
    entry.geoTags=[entry.country,entry.region,entry.town,...(entry.travelRegions||[])].filter(Boolean);
    entry.updatedAt=new Date().toISOString();
    saveEntries(); closeEntryDialog(); render(); openDetail(entry.id); return;
  }
  const entry={
    id:uid(), type:newType, name:entryName.value.trim(), country:entryCountry.value.trim(), region:entryRegion.value.trim(), source:'', sourceType:entrySourceType.value, sourceUrl:normalizeExternalUrl(entrySourceUrl.value) || entrySourceUrl.value.trim(),
    geoTags:[entryCountry.value.trim(),entryRegion.value.trim()].filter(Boolean), tags:[], favorite:false, wantToVisit:false, visited:false, deleted:false,
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), location:null, accessPoint:null, visits:[], media:[], details:{}
  };
  if(!entry.name) return;
  state.entries.push(entry); saveEntries(); closeEntryDialog(); render(); openDetail(entry.id);
});

document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{state.route=b.dataset.route;state.query='';render();});
document.getElementById('settingsBtn').onclick=()=>{state.route='settings';render();};

function campingDetailCards(e){
  if(e.type!=='camping') return `<div class="info-card"><small>Technisches Fundament</small><strong>Gemeinsame ID · zentrale Standortfelder · Besuchshistorie · Medienliste · typbezogene Details</strong></div>`;
  const season=e.details?.camping?.season || {};
  const pitch=e.details?.camping?.pitch || {};
  const facilities=e.details?.camping?.facilities || {};
  const location=e.details?.camping?.location || {};
  const leisure=e.details?.camping?.leisure || {};
  const dog=e.details?.camping?.dog || {};
  const prices=e.details?.camping?.prices || {};
  const personal=e.details?.camping?.personal || {};
  const regions=(e.travelRegions||[]).join(', ');
  const phone=e.phone ? `<a class="contact-link" href="${escapeHtml(phoneHref(e.phone))}">${escapeHtml(e.phone)}</a>` : '';
  const email=e.email ? `<a class="contact-link" href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>` : '';
  const srcLabel=sourceLabel(e);
  const srcUrl=sourceUrl(e);
  const source=srcLabel || srcUrl ? `${escapeHtml(srcLabel||'Internet')}${srcUrl?` <a class="inline-link" href="${escapeHtml(srcUrl)}" target="_blank" rel="noopener noreferrer">öffnen ↗</a>`:''}` : '';
  const websiteUrl=normalizeExternalUrl(e.website);
  const website=e.website ? (websiteUrl?`<a class="inline-link" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.website)} ↗</a>`:escapeHtml(e.website)) : '';

  const basicRows=[
    detailRow('Land',e.country),
    detailRow('Region/Bundesland',e.region),
    detailRow('Gebiet/Reiseregion',regions),
    detailRow('Ort',e.town),
    detailRow('Adresse',e.address),
    detailRow('Telefon',phone,true),
    detailRow('E-Mail',email,true),
    detailRow('Website',website,true),
    detailRow('Quelle',source,true)
  ].filter(Boolean).join('');

  const op=valueLabel(season.operationType,{unknown:'','year-round':'Ganzjährig',seasonal:'Saisonal'},'');
  const period=season.operationType==='seasonal' && (season.openFrom||season.openTo)
    ? `${formatDate(season.openFrom)||'–'} bis ${formatDate(season.openTo)||'–'}` : '';
  const reservation=valueLabel(season.reservation,{unknown:'','not-needed':'Nicht nötig',possible:'Möglich',recommended:'Empfohlen',required:'Erforderlich'},'');
  const spontaneous=knownYesNo(season.spontaneousArrival,'Möglich','Nicht möglich');
  const summer=knownYesNo(season.summerCamping,'Möglich','Nicht möglich');
  const winter=knownYesNo(season.winterCamping,'Möglich','Nicht möglich');
  const arrival=(season.arrivalFrom||season.arrivalTo)?`${season.arrivalFrom||'–'} bis ${season.arrivalTo||'–'}`:'';
  const departure=(season.departureFrom||season.departureTo)?`${season.departureFrom||'–'} bis ${season.departureTo||'–'}`:'';
  const stayRows=[
    detailRow('Betriebsart',op),
    detailRow('Geöffnet',period),
    detailRow('Sommercamping',summer),
    detailRow('Wintercamping',winter),
    detailRow('Mindestaufenthalt',season.minStay?`${season.minStay} ${Number(season.minStay)===1?'Nacht':'Nächte'}`:''),
    detailRow('Reservierung',reservation),
    detailRow('Spontane Anreise',spontaneous),
    detailRow('Anreise',arrival),
    detailRow('Abreise',departure),
    season.notes?`<div class="detail-note"><span>Besondere Hinweise</span><p>${escapeHtml(season.notes).replace(/\n/g,'<br>')}</p></div>`:''
  ].filter(Boolean).join('');

  const surfaceLabels={grass:'Rasen',gravel:'Schotter',asphalt:'Asphalt',paving:'Pflaster',hardened:'Befestigt',natural:'Naturboden'};
  const locationFeatureLabels={waterfront:'Direkt am Wasser','water-view':'Wasserblick',quiet:'Ruhige Lage',central:'Zentrale Lage',terraced:'Terrassiert'};
  const pitchType=valueLabel(pitch.type,{unknown:'',parcel:'Parzelle','free-choice':'Freie Platzwahl'},'');
  const pitchSurface=(pitch.surface||[]).map(v=>surfaceLabels[v]).filter(Boolean).join(', ');
  const pitchLevel=valueLabel(pitch.level,{unknown:'',level:'Eben','partly-uneven':'Teilweise uneben'},'');
  const pitchShade=valueLabel(pitch.shade,{unknown:'',sunny:'Sonnig','partly-shaded':'Teilweise schattig',shaded:'Schattig'},'');
  const pitchFeatures=(pitch.locationFeatures||[]).map(v=>locationFeatureLabels[v]).filter(Boolean).join(', ');
  const electricity=knownYesNo(pitch.electricity,'Vorhanden','Nicht vorhanden');
  const electricityBilling=pitch.electricity==='yes'?valueLabel(pitch.electricityBilling,{unknown:'Preis unbekannt',included:'Inklusive',flat:'Pauschale',consumption:'Nach Verbrauch'},''):'';
  const wifi=knownYesNo(pitch.wifi,'Vorhanden','Nicht vorhanden');
  const wifiBilling=pitch.wifi==='yes'?valueLabel(pitch.wifiBilling,{unknown:'Preis unbekannt',included:'Inklusive',paid:'Kostenpflichtig'},''):'';
  const access=valueLabel(pitch.access,{unknown:'',easy:'Problemlos',narrow:'Eng',steep:'Steil',difficult:'Schwierig'},'');
  const pitchRows=[
    detailRow('Platzart',pitchType),
    detailRow('Fläche',pitch.area!=null?`${formatNumber(pitch.area)} m²`:''),
    detailRow('Länge',pitch.length!=null?`${formatNumber(pitch.length)} m`:''),
    detailRow('Breite',pitch.width!=null?`${formatNumber(pitch.width)} m`:''),
    detailRow('Große Wohnmobile',knownYesNo(pitch.largeMotorhome,'Geeignet','Nicht geeignet')),
    detailRow('Untergrund',pitchSurface),
    detailRow('Ebenheit',pitchLevel),
    detailRow('Sonne / Schatten',pitchShade),
    detailRow('Besondere Lage',pitchFeatures),
    detailRow('Strom direkt am Platz',electricity),
    detailRow('Strom-Abrechnung',electricityBilling),
    detailRow('Strompreis',pitch.electricityPrice!=null?`${formatNumber(pitch.electricityPrice)} €`:''),
    detailRow('Strompreis pro kWh',pitch.electricityKwhPrice!=null?`${formatNumber(pitch.electricityKwhPrice)} €/kWh`:''),
    detailRow('Frischwasser direkt am Platz',knownYesNo(pitch.freshWater,'Vorhanden','Nicht vorhanden')),
    detailRow('Abwasser direkt am Platz',knownYesNo(pitch.wasteWater,'Vorhanden','Nicht vorhanden')),
    detailRow('TV-Anschluss',knownYesNo(pitch.tv,'Vorhanden','Nicht vorhanden')),
    detailRow('WLAN',wifi),
    detailRow('WLAN-Kosten',wifiBilling),
    detailRow('WLAN-Preis',pitch.wifiPrice!=null?`${formatNumber(pitch.wifiPrice)} €`:''),
    detailRow('Zufahrt',access),
    detailRow('Max. Fahrzeuglänge',pitch.maxVehicleLength!=null?`${formatNumber(pitch.maxVehicleLength)} m`:''),
    detailRow('Max. Fahrzeughöhe',pitch.maxVehicleHeight!=null?`${formatNumber(pitch.maxVehicleHeight)} m`:''),
    detailRow('Gewichtslimit',pitch.maxVehicleWeight!=null?`${formatNumber(pitch.maxVehicleWeight)} t`:''),
    detailRow('Bevorzugte Parzelle',pitch.preferredNumber),
    pitch.notes?`<div class="detail-note"><span>Hinweise zur Stellplatzwahl</span><p>${escapeHtml(pitch.notes).replace(/\n/g,'<br>')}</p></div>`:''
  ].filter(Boolean).join('');

  const costLabel=(state,price)=>{
    if(state==='included') return 'Inklusive';
    if(state==='paid') return price!=null?`Kostenpflichtig · ${formatNumber(price)} €`:'Kostenpflichtig';
    if(state==='unknown') return 'Preis unbekannt';
    return '';
  };
  const breadSeason=valueLabel(facilities.breadSeason,{unknown:'','year-round':'Ganzjährig',seasonal:'Saisonal'},'');
  const facilityRows=[
    detailRow('WC',knownYesNo(facilities.wc,'Vorhanden','Nicht vorhanden')),
    detailRow('Duschen',knownYesNo(facilities.showers,'Vorhanden','Nicht vorhanden')),
    facilities.showers==='yes'?detailRow('Duschen Kosten',costLabel(facilities.showerBilling,facilities.showerPrice)):'',
    detailRow('Einzelwaschkabinen',knownYesNo(facilities.washCubicles,'Vorhanden','Nicht vorhanden')),
    detailRow('Familienbad',knownYesNo(facilities.familyBath,'Vorhanden','Nicht vorhanden')),
    detailRow('Barrierefreies Sanitär',knownYesNo(facilities.accessibleSanitary,'Vorhanden','Nicht vorhanden')),
    detailRow('Baby-/Kinder-Sanitär',knownYesNo(facilities.childrenSanitary,'Vorhanden','Nicht vorhanden')),
    detailRow('Privatbad / Mietbad',knownYesNo(facilities.privateBath,'Vorhanden','Nicht vorhanden')),
    detailRow('Sanitär beheizt',knownYesNo(facilities.heatedSanitary,'Ja','Nein')),
    detailRow('Waschmaschine',knownYesNo(facilities.washer,'Vorhanden','Nicht vorhanden')),
    facilities.washer==='yes'?detailRow('Waschmaschine Kosten',costLabel(facilities.washerBilling,facilities.washerPrice)):'',
    detailRow('Trockner',knownYesNo(facilities.dryer,'Vorhanden','Nicht vorhanden')),
    facilities.dryer==='yes'?detailRow('Trockner Kosten',costLabel(facilities.dryerBilling,facilities.dryerPrice)):'',
    detailRow('Geschirrspülbereich',knownYesNo(facilities.dishwashing,'Vorhanden','Nicht vorhanden')),
    detailRow('Frischwasser-Entnahmestelle',knownYesNo(facilities.freshWaterPoint,'Vorhanden','Nicht vorhanden')),
    detailRow('Grauwasserentsorgung',knownYesNo(facilities.greyWater,'Vorhanden','Nicht vorhanden')),
    detailRow('Chemietoiletten-Entsorgung',knownYesNo(facilities.chemicalToilet,'Vorhanden','Nicht vorhanden')),
    detailRow('Bodeneinlass für Wohnmobile',knownYesNo(facilities.floorDrain,'Vorhanden','Nicht vorhanden')),
    detailRow('Müllentsorgung',knownYesNo(facilities.wasteDisposal,'Vorhanden','Nicht vorhanden')),
    detailRow('Mülltrennung',knownYesNo(facilities.wasteSeparation,'Ja','Nein')),
    detailRow('Shop / Laden',knownYesNo(facilities.shop,'Vorhanden','Nicht vorhanden')),
    detailRow('Brötchenservice',knownYesNo(facilities.breadService,'Vorhanden','Nicht vorhanden')),
    facilities.breadService==='yes'?detailRow('Brötchenservice verfügbar',breadSeason):'',
    detailRow('Camping-/Zubehörshop',knownYesNo(facilities.campingShop,'Vorhanden','Nicht vorhanden')),
    detailRow('Gasflaschentausch / Gasversorgung',knownYesNo(facilities.gasSupply,'Vorhanden','Nicht vorhanden')),
    detailRow('E-Bike-Lademöglichkeit',knownYesNo(facilities.ebikeCharging,'Vorhanden','Nicht vorhanden')),
    detailRow('E-Auto-Lademöglichkeit',knownYesNo(facilities.evCharging,'Vorhanden','Nicht vorhanden'))
  ].filter(Boolean).join('');

  const campingLocationLabels={sea:'Meer',lake:'See',river:'Fluss',mountains:'Berge',forest:'Wald',rural:'Ländlich',city:'Stadt','city-edge':'Stadtrand','beach-nearby':'Strandnähe',waterfront:'Direkt am Wasser','water-nearby':'Wasser in der Nähe','town-centre':'Direkt am Ortszentrum',remote:'Abgelegen'};
  const locationFeatures=(location.features||[]).map(v=>campingLocationLabels[v]).filter(Boolean).join(', ');
  const ld=location.distances||{};
  const distanceText=(item)=>{
    if(!item) return '';
    const parts=[];
    if(item.km!=null) parts.push(`${formatNumber(item.km)} km`);
    if(item.walkable==='yes') parts.push('fußläufig');
    else if(item.walkable==='no') parts.push('nicht fußläufig');
    return parts.join(' · ');
  };
  const lm=location.mobility||{};
  const locationRows=[
    detailRow('Lage',locationFeatures),
    detailRow('Ortszentrum',distanceText(ld.centre)),
    detailRow('Supermarkt',distanceText(ld.supermarket)),
    detailRow('Restaurant',distanceText(ld.restaurant)),
    detailRow('Bäckerei',distanceText(ld.bakery)),
    detailRow('Strand / See',distanceText(ld.water)),
    detailRow('Sehenswürdigkeiten',distanceText(ld.sights)),
    detailRow('ÖPNV',knownYesNo(lm.publicTransport,'Vorhanden','Nicht vorhanden')),
    detailRow('Bushaltestelle',knownYesNo(lm.bus,'Vorhanden','Nicht vorhanden')),
    detailRow('Bahnhof',knownYesNo(lm.train,'Vorhanden','Nicht vorhanden')),
    detailRow('Radwege',knownYesNo(lm.cycle,'Vorhanden','Nicht vorhanden')),
    detailRow('Wanderwege',knownYesNo(lm.hiking,'Vorhanden','Nicht vorhanden')),
    detailRow('Seilbahn',knownYesNo(lm.cableCar,'Vorhanden','Nicht vorhanden')),
    detailRow('Fähranleger / Hafen',knownYesNo(lm.ferry,'Vorhanden','Nicht vorhanden')),
    location.notes?`<div class="detail-note"><span>Ausflugsziele / Hinweise zur Umgebung</span><p>${escapeHtml(location.notes).replace(/\n/g,'<br>')}</p></div>`:''
  ].filter(Boolean).join('');

  const gastro=leisure.gastronomy||{}, bw=leisure.bathingWellness||{}, sport=leisure.sport||{};
  const seasonText=v=>v==='year-round'?'ganzjährig':v==='seasonal'?'saisonal':'';
  const gastroText=x=>!x||!x.status||x.status==='unknown'?'':x.status==='no'?'Nicht vorhanden':['Vorhanden',seasonText(x.season)].filter(Boolean).join(' · ');
  const beachLabels={sand:'Sandstrand',pebble:'Kiesstrand',rock:'Felsstrand',lawn:'Liegewiese'};
  const beachText=()=>{const b=knownYesNo(bw.beach,'Vorhanden','Nicht vorhanden');if(!b||bw.beach!=='yes')return b;const t=(bw.beachTypes||[]).map(v=>beachLabels[v]).filter(Boolean).join(', ');return [b,t].filter(Boolean).join(' · ');};
  const characterLabels={quiet:'Ruhig',lively:'Lebhaft',family:'Familienfreundlich',nature:'Naturnah',comfort:'Komfortorientiert',rustic:'Rustikal'}, sizeLabels={small:'Klein',medium:'Mittel',large:'Groß'};
  const leisureRows=[
    detailRow('Restaurant',gastroText(gastro.restaurant)),detailRow('Imbiss',gastroText(gastro.snack)),detailRow('Bar',gastroText(gastro.bar)),detailRow('Café',gastroText(gastro.cafe)),detailRow('Biergarten',gastroText(gastro.beerGarden)),detailRow('Eisdiele',gastroText(gastro.iceCream)),
    detailRow('Schwimmbad / Freibad',knownYesNo(bw.outdoorPool,'Vorhanden','Nicht vorhanden')),detailRow('Hallenbad',knownYesNo(bw.indoorPool,'Vorhanden','Nicht vorhanden')),detailRow('Sauna',knownYesNo(bw.sauna,'Vorhanden','Nicht vorhanden')),detailRow('Wellnessbereich',knownYesNo(bw.wellness,'Vorhanden','Nicht vorhanden')),detailRow('Direkte Bademöglichkeit',knownYesNo(bw.swimmingAccess,'Vorhanden','Nicht vorhanden')),detailRow('Strand',beachText()),
    detailRow('Spielplatz',knownYesNo(sport.playground,'Vorhanden','Nicht vorhanden')),detailRow('Tischtennis',knownYesNo(sport.tableTennis,'Vorhanden','Nicht vorhanden')),detailRow('Tennis',knownYesNo(sport.tennis,'Vorhanden','Nicht vorhanden')),detailRow('Minigolf',knownYesNo(sport.miniGolf,'Vorhanden','Nicht vorhanden')),detailRow('Fitness',knownYesNo(sport.fitness,'Vorhanden','Nicht vorhanden')),detailRow('Fahrradverleih',knownYesNo(sport.bikeRental,'Vorhanden','Nicht vorhanden')),detailRow('E-Bike-Verleih',knownYesNo(sport.eBikeRental,'Vorhanden','Nicht vorhanden')),detailRow('Wassersport',knownYesNo(sport.waterSports,'Vorhanden','Nicht vorhanden')),detailRow('Animation / Unterhaltung',knownYesNo(sport.entertainment,'Vorhanden','Nicht vorhanden')),detailRow('Kinderprogramm',knownYesNo(sport.kidsProgram,'Vorhanden','Nicht vorhanden')),
    detailRow('Charakter',(leisure.character||[]).map(v=>characterLabels[v]).filter(Boolean).join(', ')),detailRow('Größe',leisure.size&&leisure.size!=='unknown'?sizeLabels[leisure.size]:''),detailRow('Anzahl Stellplätze',leisure.pitchCount!=null?String(leisure.pitchCount):'')
  ].filter(Boolean).join('');

  const dogFeeText=dog.feeType==='free'?'Kostenlos':dog.feeType==='paid'?(dog.fee!=null?`${formatNumber(dog.fee)} € / Hund / Nacht`:'Kostenpflichtig'):'';
  const dogRows=dog.allowed==='unknown'||!dog.allowed?'':[detailRow('Hunde erlaubt',dog.allowed==='yes'?'Ja':'Nein'),dog.allowed==='yes'?detailRow('Maximale Anzahl Hunde',dog.maxCount!=null?String(dog.maxCount):''):'',dog.allowed==='yes'?detailRow('Hundekosten',dogFeeText):'',dog.allowed==='yes'?detailRow('Leinenpflicht',knownYesNo(dog.leash,'Ja','Nein')):'',dog.allowed==='yes'?detailRow('Eingeschränkte Bereiche',knownYesNo(dog.restricted,'Ja','Nein')):'',dog.allowed==='yes'?detailRow('Hundeauslauf / Hundewiese',knownYesNo(dog.run,'Vorhanden','Nicht vorhanden')):'',dog.allowed==='yes'?detailRow('Hundestrand',knownYesNo(dog.beach,'Vorhanden','Nicht vorhanden')):'',dog.allowed==='yes'?detailRow('Bademöglichkeit für Hunde',knownYesNo(dog.swimming,'Vorhanden','Nicht vorhanden')):'',dog.allowed==='yes'?detailRow('Hundedusche',knownYesNo(dog.shower,'Vorhanden','Nicht vorhanden')):'',dog.allowed==='yes'?detailRow('Hunde im Restaurant erlaubt',knownYesNo(dog.restaurant,'Ja','Nein')):'',dog.allowed==='yes'&&dog.notes?`<div class="detail-note"><span>Hinweise für Hunde</span><p>${escapeHtml(dog.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');

  const euroValue=v=>v!==null&&v!==undefined&&v!==''?`${formatNumber(v)} €`:'';
  const priceRange=(prices.from!=null||prices.to!=null)?`${prices.from!=null?formatNumber(prices.from):'–'}–${prices.to!=null?formatNumber(prices.to):'–'} € / Nacht`:'';
  const electricityCost=pitch.electricity==='yes'?(pitch.electricityBilling==='included'?'Strom inklusive':pitch.electricityBilling==='flat'?(pitch.electricityPrice!=null?`Strom ${formatNumber(pitch.electricityPrice)} € pauschal`:'Strom pauschal'):pitch.electricityBilling==='consumption'?(pitch.electricityKwhPrice!=null?`Strom ${formatNumber(pitch.electricityKwhPrice)} € / kWh`:'Strom nach Verbrauch'):'Strom vorhanden'):'';
  const dogCost=dog.allowed==='yes'?(dog.feeType==='free'?'Hund kostenlos':dog.feeType==='paid'?(dog.fee!=null?`Hund ${formatNumber(dog.fee)} € / Nacht`:'Hund kostenpflichtig'):''):'';
  const priceRows=[
    detailRow('Preisstand / Jahr',prices.year!=null?String(prices.year):''),
    detailRow('Preis von / bis',priceRange),
    detailRow('Grundpreis pro Nacht',euroValue(prices.base)),
    detailRow('Grundpreis gilt für Personen',prices.basePersons!=null?String(prices.basePersons):''),
    detailRow('Zusätzliche Person pro Nacht',euroValue(prices.extraPerson)),
    detailRow('Kind pro Nacht',euroValue(prices.child)),
    detailRow('Ungefährer Gesamtpreis pro Nacht für uns',euroValue(prices.approxTotal)),
    detailRow('Kurtaxe / Tourismusabgabe',prices.touristTax!=null?`${formatNumber(prices.touristTax)} € / Person / Nacht`:''),
    detailRow('Reservierungsgebühr',euroValue(prices.reservationFee)),
    detailRow(prices.otherLabel||'Sonstige Gebühr',euroValue(prices.otherAmount)),
    detailRow('Stromkosten',electricityCost),
    detailRow('Hundekosten',dogCost),
    prices.included?`<div class="detail-note"><span>Im Grundpreis enthalten</span><p>${escapeHtml(prices.included).replace(/\n/g,'<br>')}</p></div>`:'',
    prices.notes?`<div class="detail-note"><span>Hinweise zu Preisen</span><p>${escapeHtml(prices.notes).replace(/\n/g,'<br>')}</p></div>`:''
  ].filter(Boolean).join('');
  const priceSummary=[priceRange,prices.approxTotal!=null?`ca. ${formatNumber(prices.approxTotal)} € / Nacht`:'',prices.year!=null?`Preisstand ${prices.year}`:'',electricityCost==='Strom inklusive'?'Strom inklusive':''].filter(Boolean).slice(0,2).join(' · ') || 'Preise & Gebühren';

  const statusText=e.visited?'Besucht':e.wantToVisit?'Möchte ich besuchen':'';
  const favoriteText=e.favorite?'★ Favorit':'';
  const returnText=valueLabel(personal.returnIntent,{unknown:'',yes:'Ja',maybe:'Vielleicht',no:'Nein'},'');
  const ratingLabels=[
    ['Gesamt',personal.ratings?.overall],['Lage',personal.ratings?.location],['Ruhe',personal.ratings?.quiet],
    ['Sauberkeit',personal.ratings?.cleanliness],['Sanitär',personal.ratings?.sanitary],['Preis-Leistung',personal.ratings?.value]
  ];
  const ratingRows=ratingLabels.map(([label,val])=>detailRow(label,val!=null?`${formatNumber(val,1)} / 5`:'' )).filter(Boolean).join('');
  const visits=Array.isArray(e.visits)?e.visits:[];
  const visitRows=visits.length?`<div class="visit-history">${visits.map((v,index)=>{
    const nights=visitNights(v.arrival,v.departure);
    const dateText=(v.arrival||v.departure)?`${formatDate(v.arrival)||'–'} bis ${formatDate(v.departure)||'–'}`:'Datum nicht angegeben';
    const meta=[nights!=null?`${nights} ${nights===1?'Nacht':'Nächte'}`:'',v.pitch?`Platz ${v.pitch}`:''].filter(Boolean).join(' · ');
    return `<div class="visit-history-card"><div class="visit-history-head"><strong>Aufenthalt ${index+1}</strong><span>${escapeHtml(dateText)}</span></div>${meta?`<small>${escapeHtml(meta)}</small>`:''}${v.note?`<p>${escapeHtml(v.note).replace(/\n/g,'<br>')}</p>`:''}</div>`;
  }).join('')}</div>`:'';
  const personalRows=[
    detailRow('Status',[statusText,favoriteText].filter(Boolean).join(' · ')),
    e.why?`<div class="detail-note"><span>Warum gespeichert?</span><p>${escapeHtml(e.why).replace(/\n/g,'<br>')}</p></div>`:'',
    ratingRows,
    detailRow('Würde ich wiederkommen?',returnText),
    visits.length?`<div class="detail-note"><span>Besuchshistorie</span>${visitRows}</div>`:'',
    e.notes?`<div class="detail-note"><span>Persönliche Notizen</span><p>${escapeHtml(e.notes).replace(/\n/g,'<br>')}</p></div>`:''
  ].filter(Boolean).join('');
  const ratingAverage=personalRatingAverage(personal);
  const personalSummary=[
    statusText,
    favoriteText,
    ratingAverage!=null?`${formatNumber(ratingAverage,1)} / 5`:'',
    visits.length?`${visits.length} ${visits.length===1?'Besuch':'Besuche'}`:''
  ].filter(Boolean).slice(0,3).join(' · ') || 'Persönlich';

  const basicSummary=[e.town||e.region||e.country,regions].filter(Boolean).slice(0,2).join(' · ') || 'Grunddaten';
  const staySummary=[op,period,reservation].filter(Boolean).slice(0,2).join(' · ') || 'Aufenthalt';
  const pitchSummaryParts=[
    pitchType,
    pitch.area!=null?`${formatNumber(pitch.area)} m²`:'',
    pitchSurface?pitchSurface.split(', ')[0]:'',
    pitchShade
  ].filter(Boolean);
  const pitchSummary=pitchSummaryParts.slice(0,4).join(' · ') || 'Stellplatz & Parzelle';
  const facilitySummary=[
    facilities.wc==='yes'?'WC':'',
    facilities.showers==='yes'?'Duschen':'',
    facilities.washer==='yes'?'Waschmaschine':'',
    facilities.breadService==='yes'?'Brötchenservice':''
  ].filter(Boolean).slice(0,3).join(' · ') || 'Sanitär & Versorgung';
  const locationSummary=[
    ...(location.features||[]).map(v=>campingLocationLabels[v]).filter(Boolean),
    ld.centre?.km!=null?`Zentrum ${formatNumber(ld.centre.km)} km`:''
  ].filter(Boolean).slice(0,3).join(' · ') || 'Lage & Umgebung';
  const leisureSummary=[gastro.restaurant?.status==='yes'?'Restaurant':'',bw.outdoorPool==='yes'?'Freibad':'',bw.indoorPool==='yes'?'Hallenbad':'',sport.playground==='yes'?'Spielplatz':'',...(leisure.character||[]).map(v=>characterLabels[v]).filter(Boolean)].filter(Boolean).slice(0,3).join(' · ') || 'Freizeit & Gastronomie';
  const dogSummary=dog.allowed==='yes'?['Hunde erlaubt',dog.feeType==='free'?'kostenlos':'',dog.run==='yes'?'Hundewiese':''].filter(Boolean).join(' · '):dog.allowed==='no'?'Hunde nicht erlaubt':'Hund';

  return `<div class="detail-accordions">
    <details class="detail-accordion">
      <summary><span><small>Grunddaten</small><strong>${escapeHtml(basicSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary>
      <div class="accordion-body">${basicRows||'<div class="detail-empty">Noch keine weiteren Grunddaten gespeichert.</div>'}</div>
    </details>
    <details class="detail-accordion">
      <summary><span><small>Preise &amp; Gebühren</small><strong>${escapeHtml(priceSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary>
      <div class="accordion-body">${priceRows||'<div class="detail-empty">Noch keine Preisangaben gespeichert.</div>'}</div>
    </details>
    <details class="detail-accordion">
      <summary><span><small>Persönlich</small><strong>${escapeHtml(personalSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary>
      <div class="accordion-body">${personalRows||'<div class="detail-empty">Noch keine persönlichen Angaben gespeichert.</div>'}</div>
    </details>
    <details class="detail-accordion">
      <summary><span><small>Saison & Aufenthalt</small><strong>${escapeHtml(staySummary)}</strong></span><span class="accordion-chevron">⌄</span></summary>
      <div class="accordion-body">${stayRows||'<div class="detail-empty">Noch keine Angaben zu Saison und Aufenthalt gespeichert.</div>'}</div>
    </details>
    <details class="detail-accordion">
      <summary><span><small>Stellplatz &amp; Parzelle</small><strong>${escapeHtml(pitchSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary>
      <div class="accordion-body">${pitchRows||'<div class="detail-empty">Noch keine Angaben zu Stellplatz und Parzelle gespeichert.</div>'}</div>
    </details>
    <details class="detail-accordion">
      <summary><span><small>Sanitär &amp; Versorgung</small><strong>${escapeHtml(facilitySummary)}</strong></span><span class="accordion-chevron">⌄</span></summary>
      <div class="accordion-body">${facilityRows||'<div class="detail-empty">Noch keine Angaben zu Sanitär und Versorgung gespeichert.</div>'}</div>
    </details>
    <details class="detail-accordion">
      <summary><span><small>Lage &amp; Umgebung</small><strong>${escapeHtml(locationSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary>
      <div class="accordion-body">${locationRows||'<div class="detail-empty">Noch keine Angaben zu Lage und Umgebung gespeichert.</div>'}</div>
    </details>
    <details class="detail-accordion">
      <summary><span><small>Freizeit &amp; Gastronomie</small><strong>${escapeHtml(leisureSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary>
      <div class="accordion-body">${leisureRows||'<div class="detail-empty">Noch keine Angaben zu Freizeit und Gastronomie gespeichert.</div>'}</div>
    </details>
    <details class="detail-accordion">
      <summary><span><small>Hund</small><strong>${escapeHtml(dogSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary>
      <div class="accordion-body">${dogRows||'<div class="detail-empty">Noch keine Angaben zu Hunden gespeichert.</div>'}</div>
    </details>
  </div>`;
}


function ensureStellplatzDetails(e){
  e.details=e.details||{};
  e.details.stellplatz=e.details.stellplatz||{};
  e.details.stellplatz.prices=e.details.stellplatz.prices||{};
  return e.details.stellplatz;
}
function ensureStellplatzPrices(e){return ensureStellplatzDetails(e).prices;}
function stellplatzFeeBillingLabel(v){return ({night:'pro Nacht','24h':'pro 24 Stunden',hour:'pro Stunde',day:'Tagespauschale'})[v]||'';}
function touristTaxBillingLabel(v){return ({personNight:'pro Person / Nacht',personStay:'pro Person / Aufenthalt',flat:'pauschal'})[v]||'';}
function seasonPriceLabel(row){
  const name=(row?.name||'Saisonpreis').trim();
  const dates=[row?.from,row?.to].filter(Boolean).join(' – ');
  const amount=row?.amount!=null?`${formatNumber(row.amount)} €`:'';
  const billing=stellplatzFeeBillingLabel(row?.billing);
  return [name,dates,[amount,billing].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
}
function updateStellplatzPaidFields(){
  const box=document.getElementById('stellplatzPaidFields');
  if(box) box.hidden=document.getElementById('stellplatzFeeStatus')?.value!=='paid';
}
function renderStellplatzSeasonPrices(){
  const host=document.getElementById('stellplatzSeasonPrices'); if(!host)return;
  if(!stellplatzSeasonPriceDraft.length){host.innerHTML='<div class="detail-empty">Keine Saisonpreise angelegt.</div>';return;}
  host.innerHTML=stellplatzSeasonPriceDraft.map((r,i)=>`<div class="visit-editor-card" data-season-index="${i}">
    <div class="visit-editor-head"><strong>Saisonpreis ${i+1}</strong><button type="button" class="btn danger compact remove-season-price" data-index="${i}">Entfernen</button></div>
    <label>Bezeichnung<input class="season-name" value="${escapeHtml(r.name||'')}" placeholder="z. B. Hauptsaison" /></label>
    <div class="grid-2"><label>Von<input class="season-from" type="date" value="${escapeHtml(r.from||'')}" /></label><label>Bis<input class="season-to" type="date" value="${escapeHtml(r.to||'')}" /></label></div>
    <div class="grid-2"><label>Preis (€)<input class="season-amount" type="number" inputmode="decimal" min="0" step="0.01" value="${r.amount??''}" /></label><label>Abrechnung<select class="season-billing"><option value="unknown">Unbekannt</option><option value="night" ${r.billing==='night'?'selected':''}>pro Nacht</option><option value="24h" ${r.billing==='24h'?'selected':''}>pro 24 Stunden</option><option value="hour" ${r.billing==='hour'?'selected':''}>pro Stunde</option><option value="day" ${r.billing==='day'?'selected':''}>Tagespauschale</option></select></label></div>
  </div>`).join('');
  host.querySelectorAll('.remove-season-price').forEach(btn=>btn.onclick=()=>{stellplatzSeasonPriceDraft.splice(Number(btn.dataset.index),1);renderStellplatzSeasonPrices();});
}
function collectStellplatzSeasonPrices(){
  const host=document.getElementById('stellplatzSeasonPrices'); if(!host)return [];
  return [...host.querySelectorAll('.visit-editor-card')].map(card=>{
    const n=card.querySelector('.season-amount')?.value;
    return {id:stellplatzSeasonPriceDraft[Number(card.dataset.seasonIndex)]?.id||uid(),name:card.querySelector('.season-name')?.value.trim()||'',from:card.querySelector('.season-from')?.value||'',to:card.querySelector('.season-to')?.value||'',amount:n===''?null:Number(n),billing:card.querySelector('.season-billing')?.value||'unknown'};
  }).filter(r=>r.name||r.from||r.to||r.amount!=null||r.billing!=='unknown');
}

function stellplatzDetailCards(e){
  if(e.type!=='stellplatz') return '';
  const euroValue=v=>v!==null&&v!==undefined&&v!==''?`${formatNumber(v)} €`:'';
  const regions=(e.travelRegions||[]).join(', ');
  const phone=e.phone ? `<a class="contact-link" href="${escapeHtml(phoneHref(e.phone))}">${escapeHtml(e.phone)}</a>` : '';
  const email=e.email ? `<a class="contact-link" href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>` : '';
  const srcLabel=sourceLabel(e), srcUrl=sourceUrl(e);
  const source=srcLabel || srcUrl ? `${escapeHtml(srcLabel||'Internet')}${srcUrl?` <a class="inline-link" href="${escapeHtml(srcUrl)}" target="_blank" rel="noopener noreferrer">öffnen ↗</a>`:''}` : '';
  const websiteUrl=normalizeExternalUrl(e.website);
  const website=e.website ? (websiteUrl?`<a class="inline-link" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.website)} ↗</a>`:escapeHtml(e.website)) : '';
  const basicRows=[detailRow('Land',e.country),detailRow('Region/Bundesland',e.region),detailRow('Gebiet/Reiseregion',regions),detailRow('Ort',e.town),detailRow('Adresse',e.address),detailRow('Telefon',phone,true),detailRow('E-Mail',email,true),detailRow('Website',website,true),detailRow('Quelle',source,true)].filter(Boolean).join('');
  const basicSummary=[e.town||e.region||e.country,regions].filter(Boolean).slice(0,2).join(' · ') || 'Grunddaten';
  const p=e.details?.stellplatz?.prices||{};
  const feeStatus=p.feeStatus==='free'?'Kostenlos':p.feeStatus==='paid'?'Kostenpflichtig':'';
  const mainFee=p.feeStatus==='paid'&&p.amount!=null?`${formatNumber(p.amount)} €${stellplatzFeeBillingLabel(p.billing)?` ${stellplatzFeeBillingLabel(p.billing)}`:''}`:feeStatus;
  const seasonRows=(p.seasonPrices||[]).map((r,i)=>detailRow(r.name||`Saisonpreis ${i+1}`,seasonPriceLabel({...r,name:''}))).filter(Boolean).join('');
  const tax=p.touristTax!=null?`${formatNumber(p.touristTax)} €${touristTaxBillingLabel(p.touristTaxBilling)?` ${touristTaxBillingLabel(p.touristTaxBilling)}`:''}`:'';
  const priceRows=[detailRow('Preisstand / Jahr',p.year!=null?String(p.year):''),detailRow('Stellplatzgebühr',feeStatus),detailRow('Preis',p.feeStatus==='paid'?mainFee:''),seasonRows,detailRow('Kurtaxe / Tourismusabgabe',tax),detailRow('Reservierungsgebühr',euroValue(p.reservationFee)),detailRow(p.otherLabel||'Sonstige Gebühr',euroValue(p.otherAmount)),p.included?`<div class="detail-note"><span>Im Stellplatzpreis enthalten</span><p>${escapeHtml(p.included).replace(/\n/g,'<br>')}</p></div>`:'',p.notes?`<div class="detail-note"><span>Hinweise zu Preisen</span><p>${escapeHtml(p.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
  const priceSummary=[mainFee,p.year!=null?`Preisstand ${p.year}`:''].filter(Boolean).join(' · ')||'Preise & Gebühren';
  return `<div class="detail-accordions">
    <details class="detail-accordion"><summary><span><small>Grunddaten</small><strong>${escapeHtml(basicSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${basicRows||'<div class="detail-empty">Noch keine weiteren Grunddaten gespeichert.</div>'}</div></details>
    <details class="detail-accordion"><summary><span><small>Preise & Gebühren</small><strong>${escapeHtml(priceSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${priceRows||'<div class="detail-empty">Noch keine Preise oder Gebühren gespeichert.</div>'}</div></details>
  </div>`;
}
function entryTypeDetailCards(e){
  if(e.type==='camping') return campingDetailCards(e);
  if(e.type==='stellplatz') return stellplatzDetailCards(e);
  return `<div class="info-card"><small>Technisches Fundament</small><strong>Gemeinsame ID · zentrale Standortfelder · Besuchshistorie · Medienliste · typbezogene Details</strong></div>`;
}

function campingPdfActionHtml(){
  return `<div class="pdf-action-card">
    <div class="pdf-action-copy"><small>Campingplatz als PDF</small><strong>Drucken · Speichern · Teilen</strong><span>Erstellt eine übersichtliche A4-Zusammenfassung aller gespeicherten Angaben.</span></div>
    <button class="btn primary pdf-action-btn" id="campingPdfDetail">PDF erstellen</button>
  </div>`;
}
function campingPrintSectionsHtml(e){
  const holder=document.createElement('div');
  holder.innerHTML=campingDetailCards(e);
  holder.querySelectorAll('.detail-empty').forEach(node=>node.remove());
  holder.querySelectorAll('details.detail-accordion').forEach(section=>{
    const body=section.querySelector('.accordion-body');
    if(!body || !body.textContent.trim()){
      section.remove();
      return;
    }
    section.setAttribute('open','');
    const summary=section.querySelector('summary');
    const label=summary?.querySelector('small')?.textContent?.trim() || '';
    if(summary) summary.innerHTML=`<h2>${escapeHtml(label)}</h2>`;
    section.querySelectorAll('.accordion-chevron').forEach(node=>node.remove());
  });
  return holder.innerHTML;
}
function campingPrintGalleryHtml(e){
  const media=(Array.isArray(e.media)?e.media:[]).filter(m=>m.kind==='image'&&m.dataUrl&&m.id!==e.titleImageId).slice(0,4);
  if(!media.length)return '';
  return `<section class="print-gallery-section"><h2>Weitere Bilder</h2><div class="print-gallery">${media.map(m=>`<figure><img src="${m.dataUrl}" alt="${escapeHtml(m.description||'Campingplatz-Bild')}" />${m.description?`<figcaption>${escapeHtml(m.description)}</figcaption>`:''}</figure>`).join('')}</div></section>`;
}
function openCampingPrint(e){
  if(!e || e.type!=='camping')return;
  const printWindow=window.open('','_blank');
  if(!printWindow){
    alert('Die PDF-Ansicht konnte nicht geöffnet werden. Bitte Pop-ups für diese Seite erlauben.');
    return;
  }
  const title=campingTitleMedia(e);
  const hero=title?.dataUrl?`<div class="print-hero"><img src="${title.dataUrl}" alt="${escapeHtml(title.description||e.name||'Campingplatz')}" /></div>`:'';
  const sections=campingPrintSectionsHtml(e);
  const gallery=campingPrintGalleryHtml(e);
  const docTitle=`${e.name||'Campingplatz'} - viacruz Reisezeit`;
  const generated=new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(docTitle)}</title><style>
    :root{--text:#173126;--muted:#66756e;--line:#dce5dd;--soft:#f6f9f5;--accent:#2f6a4f}
    *{box-sizing:border-box}html,body{margin:0;padding:0;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:#eef2ee}body{padding:20px}
    .toolbar{max-width:210mm;margin:0 auto 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:white;border:1px solid var(--line);border-radius:14px;padding:12px 14px}.toolbar div{min-width:0}.toolbar strong{display:block;font-size:14px}.toolbar span{display:block;margin-top:2px;color:var(--muted);font-size:12px}.toolbar button{border:0;border-radius:11px;background:var(--accent);color:white;font-weight:800;padding:11px 15px;white-space:nowrap;cursor:pointer}.toolbar-actions{display:flex;gap:8px;align-items:center}.toolbar .back-button{background:#eef3ef;color:var(--text);border:1px solid var(--line)}
    .print-page{width:min(210mm,100%);margin:0 auto;background:white;padding:14mm 15mm 13mm;box-shadow:0 10px 40px rgba(17,45,31,.12)}
    .print-hero{height:62mm;margin:-14mm -15mm 10mm;overflow:hidden}.print-hero img{width:100%;height:100%;object-fit:cover;display:block}
    .print-kicker{font-size:10px;font-weight:850;letter-spacing:.11em;text-transform:uppercase;color:var(--accent)}h1{font-size:27px;line-height:1.08;margin:3px 0 4px}.print-location{font-size:13px;color:var(--muted);margin-bottom:8mm}.print-meta{font-size:9px;color:var(--muted);text-align:right;margin-bottom:4mm}
    .detail-accordions{display:block}.detail-accordion{display:block;border:1px solid var(--line);border-radius:10px;margin:0 0 5mm;overflow:hidden;break-inside:auto;page-break-inside:auto}.detail-accordion summary{display:block;list-style:none;padding:4mm 4.5mm 3.2mm;background:var(--soft);border-bottom:1px solid var(--line);break-after:avoid;page-break-after:avoid}.detail-accordion summary::-webkit-details-marker{display:none}.detail-accordion summary h2,.print-gallery-section h2{font-size:14px;line-height:1.2;margin:0}.accordion-body{padding:2mm 4.5mm 3mm}.detail-row{display:grid;grid-template-columns:minmax(46mm,42%) 1fr;gap:5mm;padding:2.2mm 0;border-bottom:1px solid #edf1ed;align-items:start}.detail-row:last-child{border-bottom:0}.detail-row{break-inside:avoid;page-break-inside:avoid}.detail-row span{font-size:9.4px;color:var(--muted)}.detail-row strong{font-size:9.8px;line-height:1.35;text-align:right;overflow-wrap:anywhere}.detail-row a,.inline-link,.contact-link{color:var(--accent);text-decoration:none}
    .detail-note{padding:2.8mm 0;border-bottom:1px solid #edf1ed;break-inside:avoid;page-break-inside:avoid}.detail-note:last-child{border-bottom:0}.detail-note>span{display:block;font-size:9.4px;color:var(--muted);margin-bottom:1mm}.detail-note p{font-size:9.8px;line-height:1.45;margin:0;white-space:normal}.visit-history{display:grid;gap:2.2mm;margin-top:2mm}.visit-history-card{border:1px solid var(--line);border-radius:7px;padding:2.5mm;break-inside:avoid;page-break-inside:avoid}.visit-history-head{display:flex;justify-content:space-between;gap:5mm;font-size:9.5px}.visit-history-card small{display:block;color:var(--muted);font-size:8.8px;margin-top:1mm}.visit-history-card p{margin-top:1.5mm}
    .print-gallery-section{border:1px solid var(--line);border-radius:10px;padding:4mm 4.5mm;margin-top:5mm;break-inside:avoid-page}.print-gallery{display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin-top:3mm}.print-gallery figure{margin:0;break-inside:avoid}.print-gallery img{width:100%;height:47mm;object-fit:cover;display:block;border-radius:7px}.print-gallery figcaption{font-size:8.7px;line-height:1.3;color:var(--muted);padding-top:1.2mm}
    .print-footer{margin-top:8mm;padding-top:3mm;border-top:1px solid var(--line);font-size:8.7px;color:var(--muted);display:flex;justify-content:space-between;gap:10mm}.brand{font-weight:800;color:#53675c}.print-empty{padding:8mm;text-align:center;color:var(--muted);font-size:10px}
    @page{size:A4;margin:11mm 0 10mm}@media print{body{background:white;padding:0}.toolbar{display:none!important}.print-page{width:100%;margin:0;box-shadow:none;padding:8mm 15mm 3mm}.print-hero{margin:-8mm -15mm 8mm;height:58mm}.detail-accordion{break-inside:auto;page-break-inside:auto}.print-gallery-section{break-inside:avoid-page;page-break-inside:avoid}.print-footer{position:relative}.print-meta{margin-bottom:3mm}}
    @media(max-width:640px){body{padding:8px}.toolbar{align-items:stretch;flex-direction:column}.toolbar-actions{display:grid;grid-template-columns:1fr}.toolbar button{width:100%}.print-page{padding:10mm 7mm}.print-hero{margin:-10mm -7mm 8mm;height:54mm}.detail-row{grid-template-columns:1fr;gap:1mm}.detail-row strong{text-align:left}.print-gallery{grid-template-columns:1fr}}
  </style></head><body><div class="toolbar"><div><strong>Campingplatz als PDF</strong><span>Drucken, als PDF sichern oder über die Systemfunktionen teilen.</span></div><div class="toolbar-actions"><button class="back-button" id="backToApp">← Zurück zur App</button><button id="printNow">Drucken / PDF speichern</button></div></div><main class="print-page">${hero}<div class="print-kicker">Campingplatz</div><h1>${escapeHtml(e.name||'Campingplatz')}</h1><div class="print-location">${escapeHtml(locationText(e))}</div><div class="print-meta">Erstellt am ${escapeHtml(generated)}</div>${sections||'<div class="print-empty">Keine weiteren Angaben gespeichert.</div>'}${gallery}<footer class="print-footer"><span>Deine persönliche Campingplatz-Zusammenfassung</span><span class="brand">powered by viacruz</span></footer></main><script>
    document.getElementById('printNow').addEventListener('click',()=>window.print());
    document.getElementById('backToApp').addEventListener('click',()=>{
      if(window.opener && !window.opener.closed){window.opener.focus();window.close();return;}
      if(history.length>1){history.back();return;}
      window.close();
    });
  <\/script></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(()=>{try{printWindow.print()}catch(_){}},550);
}

function openDetail(id){
  const e=state.entries.find(x=>x.id===id); if(!e)return;
  const content=document.getElementById('detailContent');
  const statusParts=[];
  if(e.visited) statusParts.push('Besucht');
  else if(e.wantToVisit) statusParts.push('Möchte ich besuchen');
  if(e.favorite) statusParts.push('★ Favorit');
  const srcLabel=sourceLabel(e);
  const srcUrl=sourceUrl(e);
  const infoCards=[];
  if(statusParts.length) infoCards.push(`<div class="info-card"><small>Status</small><strong>${escapeHtml(statusParts.join(' · '))}</strong></div>`);
  if(srcLabel || srcUrl){
    const sourceText=srcLabel || 'Internet';
    infoCards.push(`<div class="info-card source-card"><small>Quelle</small><strong>${escapeHtml(sourceText)}</strong>${srcUrl?`<a class="source-link" href="${escapeHtml(srcUrl)}" target="_blank" rel="noopener noreferrer">Quelle öffnen ↗</a>`:''}</div>`);
  }
  content.innerHTML=`${e.type==='camping'?campingHeroHtml(e):''}<div class="sheet-head"><div><div class="eyebrow">${typeLabels[e.type]}</div><h2>${escapeHtml(e.name)}</h2><div class="detail-meta">${escapeHtml(locationText(e))}</div></div><button class="icon-btn close" id="closeDetail">×</button></div>
  ${e.type==='camping'?campingPdfActionHtml():''}
  ${infoCards.length?`<div class="detail-grid">${infoCards.join('')}</div>`:''}
  ${entryTypeDetailCards(e)}
  ${e.type==='camping'?campingGalleryHtml(e):''}
  <div class="detail-actions status-actions"><button class="btn secondary" id="favoriteDetail">${e.favorite?'★ Favorit entfernen':'☆ Als Favorit'}</button><button class="btn secondary" id="wantDetail">${e.wantToVisit?'Wunsch entfernen':'♡ Möchte ich besuchen'}</button></div>
  <div class="detail-actions"><button class="btn secondary" id="visitedDetail">${e.visited?'Besucht ✓':'Als besucht markieren'}</button><button class="btn secondary" id="editBasic">${e.type==='camping'?'Campingplatz bearbeiten':e.type==='stellplatz'?'Stellplatz bearbeiten':'Grunddaten bearbeiten'}</button></div>
  <div class="detail-actions single-action"><button class="btn danger" id="trashDetail">In Papierkorb</button></div>`;
  const dlg=document.getElementById('detailDialog'); dlg.showModal();
  document.getElementById('closeDetail').onclick=()=>dlg.close();
  if(e.type==='camping'){const pdfButton=document.getElementById('campingPdfDetail');if(pdfButton)pdfButton.onclick=()=>openCampingPrint(e);}
  document.getElementById('favoriteDetail').onclick=()=>{e.favorite=!e.favorite;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('wantDetail').onclick=()=>{e.wantToVisit=!e.wantToVisit;if(e.wantToVisit)e.visited=false;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('visitedDetail').onclick=()=>{e.visited=!e.visited;if(e.visited)e.wantToVisit=false;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('trashDetail').onclick=()=>{if(confirm('Diesen Eintrag in den Papierkorb verschieben?')){e.deleted=true;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();}};
  document.getElementById('editBasic').onclick=()=>e.type==='camping'?openCampingEditor(e):e.type==='stellplatz'?openStellplatzEditor(e):editBasic(e);
  content.querySelectorAll('.gallery-item img').forEach(img=>img.onclick=()=>{const win=window.open();if(win){win.document.write(`<img src="${img.src}" style="max-width:100%;height:auto;display:block;margin:auto">`);win.document.close();}});
}
function editBasic(e){
  document.getElementById('detailDialog').close();
  openEntryDialog(null,e);
}


function openStellplatzEditor(e){
  setField('stellplatzEditId',e.id);
  setField('stellplatzEntryType',e.type);
  setField('stellplatzName',e.name);
  setField('stellplatzCountry',e.country);
  setField('stellplatzRegion',e.region);
  setField('stellplatzTravelRegions',(e.travelRegions||[]).join(', '));
  setField('stellplatzTown',e.town);
  setField('stellplatzAddress',e.address);
  setField('stellplatzSourceType',sourceLabel(e));
  setField('stellplatzSourceUrl',sourceUrl(e));
  setField('stellplatzWebsite',e.website);
  setField('stellplatzPhone',e.phone);
  setField('stellplatzEmail',e.email);
  const prices=ensureStellplatzPrices(e);
  setField('stellplatzPriceYear',prices.year);setField('stellplatzFeeStatus',prices.feeStatus||'unknown');setField('stellplatzFeeBilling',prices.billing||'unknown');setField('stellplatzFeeAmount',prices.amount);setField('stellplatzTouristTax',prices.touristTax);setField('stellplatzTouristTaxBilling',prices.touristTaxBilling||'unknown');setField('stellplatzReservationFee',prices.reservationFee);setField('stellplatzOtherLabel',prices.otherLabel);setField('stellplatzOtherAmount',prices.otherAmount);setField('stellplatzPriceIncluded',prices.included);setField('stellplatzPriceNotes',prices.notes);
  stellplatzSeasonPriceDraft=Array.isArray(prices.seasonPrices)?structuredClone(prices.seasonPrices):[];
  renderStellplatzSeasonPrices();updateStellplatzPaidFields();
  document.getElementById('detailDialog').close();
  document.getElementById('stellplatzEditDialog').showModal();
}
function closeStellplatzEditor(){
  const dlg=document.getElementById('stellplatzEditDialog');
  if(dlg?.open) dlg.close();
}
document.getElementById('closeStellplatzEdit').onclick=closeStellplatzEditor;
document.getElementById('cancelStellplatzEdit').onclick=closeStellplatzEditor;
document.getElementById('stellplatzFeeStatus').onchange=updateStellplatzPaidFields;
document.getElementById('addStellplatzSeasonPrice').onclick=()=>{stellplatzSeasonPriceDraft=collectStellplatzSeasonPrices();stellplatzSeasonPriceDraft.push({id:uid(),name:'',from:'',to:'',amount:null,billing:'unknown'});renderStellplatzSeasonPrices();};
document.getElementById('stellplatzEditForm').addEventListener('submit',ev=>{
  ev.preventDefault();
  const e=state.entries.find(x=>x.id===document.getElementById('stellplatzEditId').value); if(!e)return;
  const requestedType=document.getElementById('stellplatzEntryType').value;
  if(!convertEntryType(e,requestedType)){
    document.getElementById('stellplatzEntryType').value=e.type;
    return;
  }
  e.name=document.getElementById('stellplatzName').value.trim()||e.name;
  e.country=document.getElementById('stellplatzCountry').value.trim();
  e.region=document.getElementById('stellplatzRegion').value.trim();
  e.travelRegions=splitList(document.getElementById('stellplatzTravelRegions').value);
  e.town=document.getElementById('stellplatzTown').value.trim();
  e.address=document.getElementById('stellplatzAddress').value.trim();
  e.source='';
  e.sourceType=document.getElementById('stellplatzSourceType').value;
  e.sourceUrl=normalizeExternalUrl(document.getElementById('stellplatzSourceUrl').value) || document.getElementById('stellplatzSourceUrl').value.trim();
  e.website=normalizeExternalUrl(document.getElementById('stellplatzWebsite').value) || document.getElementById('stellplatzWebsite').value.trim();
  e.phone=document.getElementById('stellplatzPhone').value.trim();
  e.email=document.getElementById('stellplatzEmail').value.trim();
  e.geoTags=[e.country,e.region,e.town,...e.travelRegions].filter(Boolean);
  const prices=ensureStellplatzPrices(e);
  prices.year=numericField('stellplatzPriceYear');prices.feeStatus=document.getElementById('stellplatzFeeStatus').value;prices.billing=prices.feeStatus==='paid'?document.getElementById('stellplatzFeeBilling').value:'unknown';prices.amount=prices.feeStatus==='paid'?numericField('stellplatzFeeAmount'):null;prices.seasonPrices=collectStellplatzSeasonPrices();prices.touristTax=numericField('stellplatzTouristTax');prices.touristTaxBilling=document.getElementById('stellplatzTouristTaxBilling').value;prices.reservationFee=numericField('stellplatzReservationFee');prices.otherLabel=document.getElementById('stellplatzOtherLabel').value.trim();prices.otherAmount=numericField('stellplatzOtherAmount');prices.included=document.getElementById('stellplatzPriceIncluded').value.trim();prices.notes=document.getElementById('stellplatzPriceNotes').value.trim();
  e.updatedAt=new Date().toISOString();
  saveEntries();
  closeStellplatzEditor();
  render();
  openDetail(e.id);
});

function ensureCampingDetails(e){
  e.details=e.details||{};
  e.details.camping=e.details.camping||{};
  e.details.camping.season=e.details.camping.season||{};
  e.details.camping.pitch=e.details.camping.pitch||{};
  e.details.camping.facilities=e.details.camping.facilities||{};
  e.details.camping.location=e.details.camping.location||{};
  e.details.camping.leisure=e.details.camping.leisure||{};
  e.details.camping.dog=e.details.camping.dog||{};
  e.details.camping.prices=e.details.camping.prices||{};
  e.details.camping.personal=e.details.camping.personal||{};
  return e.details.camping.season;
}
function ensureCampingLocation(e){
  ensureCampingDetails(e);
  return e.details.camping.location;
}
function ensureCampingLeisure(e){
  ensureCampingDetails(e);
  return e.details.camping.leisure;
}
function ensureCampingDog(e){ensureCampingDetails(e);return e.details.camping.dog;}
function ensureCampingPrices(e){ensureCampingDetails(e);return e.details.camping.prices;}
function ensureCampingPersonal(e){ensureCampingDetails(e);return e.details.camping.personal;}
function ensureCampingFacilities(e){
  ensureCampingDetails(e);
  return e.details.camping.facilities;
}
function ensureCampingPitch(e){
  ensureCampingDetails(e);
  return e.details.camping.pitch;
}
function setCheckboxGroup(id,values=[]){
  const selected=new Set(Array.isArray(values)?values:[]);
  document.querySelectorAll(`#${id} input[type="checkbox"]`).forEach(el=>{el.checked=selected.has(el.value);});
}
function getCheckboxGroup(id){
  return [...document.querySelectorAll(`#${id} input[type="checkbox"]:checked`)].map(el=>el.value);
}
function numericField(id){
  const v=document.getElementById(id)?.value;
  return v!=='' && v!=null ? Number(v) : null;
}
function formatNumber(value,max=2){
  if(value===null || value===undefined || value==='') return '';
  return Number(value).toLocaleString('de-DE',{maximumFractionDigits:max});
}
function setField(id,value=''){ const el=document.getElementById(id); if(el) el.value=value??''; }
function visitNights(arrival,departure){
  if(!arrival||!departure)return null;
  const a=new Date(arrival+'T00:00:00Z'),d=new Date(departure+'T00:00:00Z');
  const n=Math.round((d-a)/86400000);
  return Number.isFinite(n)&&n>=0?n:null;
}
function ratingValue(id){
  const v=document.getElementById(id)?.value;
  return v?Number(v):null;
}
function personalRatingAverage(personal){
  const r=personal?.ratings||{};
  const values=[r.overall,r.location,r.quiet,r.cleanliness,r.sanitary,r.value].filter(v=>Number.isFinite(Number(v))).map(Number);
  if(!values.length)return null;
  return values.reduce((a,b)=>a+b,0)/values.length;
}
function renderCampingVisitEditor(visits=[]){
  const list=document.getElementById('campingVisitList'); if(!list)return;
  const normalized=Array.isArray(visits)?visits:[];
  list.innerHTML=normalized.length?normalized.map(v=>`
    <div class="visit-editor-card" data-visit-id="${escapeHtml(v.id||uid())}">
      <div class="visit-card-head"><strong>Aufenthalt</strong><button type="button" class="visit-remove" aria-label="Besuch entfernen">Entfernen</button></div>
      <div class="grid-2">
        <label>Anreise<input class="visit-arrival" type="date" value="${escapeHtml(v.arrival||'')}" /></label>
        <label>Abreise<input class="visit-departure" type="date" value="${escapeHtml(v.departure||'')}" /></label>
      </div>
      <label>Stellplatz / Parzellennummer<input class="visit-pitch" type="text" value="${escapeHtml(v.pitch||'')}" placeholder="z. B. 114" /></label>
      <label>Persönliche Besuchsnotiz<textarea class="visit-note" rows="3" placeholder="Was war bei diesem Aufenthalt besonders?">${escapeHtml(v.note||'')}</textarea></label>
    </div>`).join(''):'<div class="visit-editor-empty">Noch kein Aufenthalt gespeichert.</div>';
  list.querySelectorAll('.visit-remove').forEach(btn=>btn.onclick=()=>{btn.closest('.visit-editor-card')?.remove();if(!list.querySelector('.visit-editor-card'))list.innerHTML='<div class="visit-editor-empty">Noch kein Aufenthalt gespeichert.</div>';});
}
function addCampingVisitEditor(){
  const current=collectCampingVisits();
  current.push({id:uid(),arrival:'',departure:'',pitch:'',note:'',createdAt:new Date().toISOString()});
  renderCampingVisitEditor(current);
  document.querySelector('#campingVisitList .visit-editor-card:last-child')?.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function collectCampingVisits(){
  return [...document.querySelectorAll('#campingVisitList .visit-editor-card')].map(card=>({
    id:card.dataset.visitId||uid(),
    arrival:card.querySelector('.visit-arrival')?.value||'',
    departure:card.querySelector('.visit-departure')?.value||'',
    pitch:card.querySelector('.visit-pitch')?.value.trim()||'',
    note:card.querySelector('.visit-note')?.value.trim()||'',
    createdAt:card.dataset.createdAt||new Date().toISOString()
  })).filter(v=>v.arrival||v.departure||v.pitch||v.note);
}

function toggleSeasonDateFields(){
  const seasonal=document.getElementById('campingOperationType')?.value==='seasonal';
  const wrap=document.getElementById('campingSeasonDates'); if(!wrap)return;
  wrap.classList.toggle('is-disabled',!seasonal);
  wrap.querySelectorAll('input').forEach(i=>i.disabled=!seasonal);
}
function togglePitchConditionalFields(){
  const electricity=document.getElementById('campingPitchElectricity')?.value==='yes';
  const eWrap=document.getElementById('campingPitchElectricityDetails');
  if(eWrap){eWrap.classList.toggle('is-disabled',!electricity);eWrap.querySelectorAll('input,select').forEach(el=>el.disabled=!electricity);}
  const wifi=document.getElementById('campingPitchWifi')?.value==='yes';
  const wWrap=document.getElementById('campingPitchWifiDetails');
  if(wWrap){wWrap.classList.toggle('is-disabled',!wifi);wWrap.querySelectorAll('input,select').forEach(el=>el.disabled=!wifi);}
}
function toggleFacilitiesConditionalFields(){
  const pairs=[
    ['campingFacilitiesShowers','campingFacilitiesShowerDetails'],
    ['campingFacilitiesWasher','campingFacilitiesWasherDetails'],
    ['campingFacilitiesDryer','campingFacilitiesDryerDetails'],
    ['campingFacilitiesBread','campingFacilitiesBreadDetails']
  ];
  pairs.forEach(([selectId,wrapId])=>{
    const active=document.getElementById(selectId)?.value==='yes';
    const wrap=document.getElementById(wrapId);
    if(wrap){wrap.classList.toggle('is-disabled',!active);wrap.querySelectorAll('input,select').forEach(el=>el.disabled=!active);}
  });
}
function updateDogConditionalFields(){const a=document.getElementById('campingDogAllowed'),d=document.getElementById('campingDogDetails');if(d)d.hidden=!a||a.value!=='yes';const f=document.getElementById('campingDogFeeType'),w=document.getElementById('campingDogFeeWrap');if(w)w.hidden=!f||f.value!=='paid';}
function updateLeisureConditionalFields(){
  document.getElementById('campingDogAllowed')?.addEventListener('change',updateDogConditionalFields);
document.getElementById('campingDogFeeType')?.addEventListener('change',updateDogConditionalFields);
['Restaurant','Snack','Bar','Cafe','BeerGarden','IceCream'].forEach(id=>{
    const status=document.getElementById('campingLeisure'+id);
    const label=document.querySelector(`[data-leisure-season="${id}"]`);
    if(label) label.hidden=!status || status.value!=='yes';
  });
  const beach=document.getElementById('campingLeisureBeach');
  const wrap=document.getElementById('campingBeachTypesWrap');
  if(wrap) wrap.hidden=!beach || beach.value!=='yes';
}
function openCampingEditor(e){
  const s=ensureCampingDetails(e);
  const p=ensureCampingPitch(e);
  const f=ensureCampingFacilities(e);
  const l=ensureCampingLocation(e);
  const personal=ensureCampingPersonal(e);
  setField('campingEditId',e.id); setField('campingEntryType',e.type); setField('campingName',e.name); setField('campingCountry',e.country); setField('campingRegion',e.region);
  setField('campingTravelRegions',(e.travelRegions||[]).join(', ')); setField('campingTown',e.town); setField('campingAddress',e.address); setField('campingSourceType',sourceLabel(e)); setField('campingSourceUrl',sourceUrl(e)); setField('campingWebsite',e.website); setField('campingPhone',e.phone); setField('campingEmail',e.email);
  campingMediaDraft=cloneMediaList(e.media); campingTitleImageDraft=e.titleImageId||null; renderCampingMediaEditor();
  setField('campingOperationType',s.operationType||'unknown'); setField('campingOpenFrom',s.openFrom); setField('campingOpenTo',s.openTo); setField('campingSummer',s.summerCamping||'unknown'); setField('campingWinter',s.winterCamping||'unknown'); setField('campingMinStay',s.minStay); setField('campingReservation',s.reservation||'unknown'); setField('campingSpontaneous',s.spontaneousArrival||'unknown'); setField('campingArrivalFrom',s.arrivalFrom); setField('campingArrivalTo',s.arrivalTo); setField('campingDepartureFrom',s.departureFrom); setField('campingDepartureTo',s.departureTo); setField('campingSeasonNotes',s.notes);

  setField('campingPitchType',p.type||'unknown');
  setField('campingPitchArea',p.area);
  setField('campingPitchLength',p.length);
  setField('campingPitchWidth',p.width);
  setField('campingPitchLargeMotorhome',p.largeMotorhome||'unknown');
  setCheckboxGroup('campingPitchSurface',p.surface);
  setField('campingPitchLevel',p.level||'unknown');
  setField('campingPitchShade',p.shade||'unknown');
  setCheckboxGroup('campingPitchLocationFeatures',p.locationFeatures);
  setField('campingPitchElectricity',p.electricity||'unknown');
  setField('campingPitchElectricityBilling',p.electricityBilling||'unknown');
  setField('campingPitchElectricityPrice',p.electricityPrice);
  setField('campingPitchElectricityKwhPrice',p.electricityKwhPrice);
  setField('campingPitchFreshWater',p.freshWater||'unknown');
  setField('campingPitchWasteWater',p.wasteWater||'unknown');
  setField('campingPitchTv',p.tv||'unknown');
  setField('campingPitchWifi',p.wifi||'unknown');
  setField('campingPitchWifiBilling',p.wifiBilling||'unknown');
  setField('campingPitchWifiPrice',p.wifiPrice);
  setField('campingPitchAccess',p.access||'unknown');
  setField('campingPitchMaxLength',p.maxVehicleLength);
  setField('campingPitchMaxHeight',p.maxVehicleHeight);
  setField('campingPitchMaxWeight',p.maxVehicleWeight);
  setField('campingPitchPreferredNumber',p.preferredNumber);
  setField('campingPitchNotes',p.notes);

  setField('campingFacilitiesWc',f.wc||'unknown');
  setField('campingFacilitiesShowers',f.showers||'unknown');
  setField('campingFacilitiesShowerBilling',f.showerBilling||'unknown');
  setField('campingFacilitiesShowerPrice',f.showerPrice);
  setField('campingFacilitiesWashCubicles',f.washCubicles||'unknown');
  setField('campingFacilitiesFamilyBath',f.familyBath||'unknown');
  setField('campingFacilitiesAccessible',f.accessibleSanitary||'unknown');
  setField('campingFacilitiesChildren',f.childrenSanitary||'unknown');
  setField('campingFacilitiesPrivateBath',f.privateBath||'unknown');
  setField('campingFacilitiesHeated',f.heatedSanitary||'unknown');
  setField('campingFacilitiesWasher',f.washer||'unknown');
  setField('campingFacilitiesWasherBilling',f.washerBilling||'unknown');
  setField('campingFacilitiesWasherPrice',f.washerPrice);
  setField('campingFacilitiesDryer',f.dryer||'unknown');
  setField('campingFacilitiesDryerBilling',f.dryerBilling||'unknown');
  setField('campingFacilitiesDryerPrice',f.dryerPrice);
  setField('campingFacilitiesDishwashing',f.dishwashing||'unknown');
  setField('campingFacilitiesFreshWaterPoint',f.freshWaterPoint||'unknown');
  setField('campingFacilitiesGreyWater',f.greyWater||'unknown');
  setField('campingFacilitiesChemicalToilet',f.chemicalToilet||'unknown');
  setField('campingFacilitiesFloorDrain',f.floorDrain||'unknown');
  setField('campingFacilitiesWaste',f.wasteDisposal||'unknown');
  setField('campingFacilitiesWasteSeparation',f.wasteSeparation||'unknown');
  setField('campingFacilitiesShop',f.shop||'unknown');
  setField('campingFacilitiesBread',f.breadService||'unknown');
  setField('campingFacilitiesBreadSeason',f.breadSeason||'unknown');
  setField('campingFacilitiesCampingShop',f.campingShop||'unknown');
  setField('campingFacilitiesGas',f.gasSupply||'unknown');
  setField('campingFacilitiesEbike',f.ebikeCharging||'unknown');
  setField('campingFacilitiesEv',f.evCharging||'unknown');

  setCheckboxGroup('campingLocationFeatures',l.features);
  const d=l.distances||{};
  setField('campingDistanceCentre',d.centre?.km); setField('campingWalkCentre',d.centre?.walkable||'unknown');
  setField('campingDistanceSupermarket',d.supermarket?.km); setField('campingWalkSupermarket',d.supermarket?.walkable||'unknown');
  setField('campingDistanceRestaurant',d.restaurant?.km); setField('campingWalkRestaurant',d.restaurant?.walkable||'unknown');
  setField('campingDistanceBakery',d.bakery?.km); setField('campingWalkBakery',d.bakery?.walkable||'unknown');
  setField('campingDistanceWater',d.water?.km); setField('campingWalkWater',d.water?.walkable||'unknown');
  setField('campingDistanceSights',d.sights?.km); setField('campingWalkSights',d.sights?.walkable||'unknown');
  const m=l.mobility||{};
  setField('campingMobilityPublicTransport',m.publicTransport||'unknown'); setField('campingMobilityBus',m.bus||'unknown');
  setField('campingMobilityTrain',m.train||'unknown'); setField('campingMobilityCycle',m.cycle||'unknown');
  setField('campingMobilityHiking',m.hiking||'unknown'); setField('campingMobilityCableCar',m.cableCar||'unknown');
  setField('campingMobilityFerry',m.ferry||'unknown'); setField('campingLocationNotes',l.notes);

  const leisure=ensureCampingLeisure(e), gastro=leisure.gastronomy||{};
  const gastroIds={restaurant:'Restaurant',snack:'Snack',bar:'Bar',cafe:'Cafe',beerGarden:'BeerGarden',iceCream:'IceCream'};
  Object.entries(gastroIds).forEach(([key,id])=>{setField('campingLeisure'+id,gastro[key]?.status||'unknown');setField('campingLeisure'+id+'Season',gastro[key]?.season||'unknown');});
  const bw=leisure.bathingWellness||{};
  setField('campingLeisureOutdoorPool',bw.outdoorPool||'unknown');setField('campingLeisureIndoorPool',bw.indoorPool||'unknown');setField('campingLeisureSauna',bw.sauna||'unknown');setField('campingLeisureWellness',bw.wellness||'unknown');setField('campingLeisureSwimmingAccess',bw.swimmingAccess||'unknown');setField('campingLeisureBeach',bw.beach||'unknown');setCheckboxGroup('campingBeachTypes',bw.beachTypes);
  const sport=leisure.sport||{}, sportIds={playground:'Playground',tableTennis:'TableTennis',tennis:'Tennis',miniGolf:'MiniGolf',fitness:'Fitness',bikeRental:'BikeRental',eBikeRental:'EBikeRental',waterSports:'WaterSports',entertainment:'Entertainment',kidsProgram:'KidsProgram'};
  Object.entries(sportIds).forEach(([key,id])=>setField('campingLeisure'+id,sport[key]||'unknown'));
  setCheckboxGroup('campingLeisureCharacter',leisure.character);setField('campingLeisureSize',leisure.size||'unknown');setField('campingLeisurePitchCount',leisure.pitchCount);
  updateLeisureConditionalFields();
  const dog=ensureCampingDog(e);setField('campingDogAllowed',dog.allowed||'unknown');setField('campingDogMaxCount',dog.maxCount);setField('campingDogFeeType',dog.feeType||'unknown');setField('campingDogFee',dog.fee);setField('campingDogLeash',dog.leash||'unknown');setField('campingDogRestricted',dog.restricted||'unknown');setField('campingDogRun',dog.run||'unknown');setField('campingDogBeach',dog.beach||'unknown');setField('campingDogSwimming',dog.swimming||'unknown');setField('campingDogShower',dog.shower||'unknown');setField('campingDogRestaurant',dog.restaurant||'unknown');setField('campingDogNotes',dog.notes);updateDogConditionalFields();
  const prices=ensureCampingPrices(e);
  setField('campingPriceYear',prices.year);setField('campingPriceApproxTotal',prices.approxTotal);setField('campingPriceFrom',prices.from);setField('campingPriceTo',prices.to);setField('campingPriceBase',prices.base);setField('campingPriceBasePersons',prices.basePersons);setField('campingPriceExtraPerson',prices.extraPerson);setField('campingPriceChild',prices.child);setField('campingPriceTouristTax',prices.touristTax);setField('campingPriceReservationFee',prices.reservationFee);setField('campingPriceOtherLabel',prices.otherLabel);setField('campingPriceOtherAmount',prices.otherAmount);setField('campingPriceIncluded',prices.included);setField('campingPriceNotes',prices.notes);
  setField('campingPersonalStatus',e.visited?'visited':e.wantToVisit?'want':'none');
  const favoriteEl=document.getElementById('campingPersonalFavorite'); if(favoriteEl) favoriteEl.checked=!!e.favorite;
  setField('campingPersonalWhy',e.why||'');
  setField('campingRatingOverall',personal.ratings?.overall);
  setField('campingRatingLocation',personal.ratings?.location);
  setField('campingRatingQuiet',personal.ratings?.quiet);
  setField('campingRatingCleanliness',personal.ratings?.cleanliness);
  setField('campingRatingSanitary',personal.ratings?.sanitary);
  setField('campingRatingValue',personal.ratings?.value);
  setField('campingPersonalReturn',personal.returnIntent||'unknown');
  setField('campingPersonalNotes',e.notes||'');
  renderCampingVisitEditor(e.visits||[]);

  document.getElementById('detailDialog').close();
  toggleSeasonDateFields();
  togglePitchConditionalFields();
  toggleFacilitiesConditionalFields();
  document.getElementById('campingEditDialog').showModal();
}

document.getElementById('campingOperationType').addEventListener('change',toggleSeasonDateFields);
document.getElementById('campingPitchElectricity').addEventListener('change',togglePitchConditionalFields);
document.getElementById('campingPitchWifi').addEventListener('change',togglePitchConditionalFields);
document.getElementById('campingFacilitiesShowers').addEventListener('change',toggleFacilitiesConditionalFields);
document.getElementById('campingFacilitiesWasher').addEventListener('change',toggleFacilitiesConditionalFields);
document.getElementById('campingFacilitiesDryer').addEventListener('change',toggleFacilitiesConditionalFields);
document.getElementById('campingFacilitiesBread').addEventListener('change',toggleFacilitiesConditionalFields);
document.getElementById('closeCampingEdit').onclick=()=>document.getElementById('campingEditDialog').close();
document.getElementById('cancelCampingEdit').onclick=()=>document.getElementById('campingEditDialog').close();
document.getElementById('addCampingVisit')?.addEventListener('click',addCampingVisitEditor);
document.getElementById('addCampingMedia')?.addEventListener('click',()=>document.getElementById('campingMediaInput')?.click());
document.getElementById('campingMediaInput')?.addEventListener('change',ev=>addCampingMediaFiles(ev.target.files));
['Restaurant','Snack','Bar','Cafe','BeerGarden','IceCream'].forEach(id=>document.getElementById('campingLeisure'+id)?.addEventListener('change',updateLeisureConditionalFields));
document.getElementById('campingLeisureBeach')?.addEventListener('change',updateLeisureConditionalFields);
document.getElementById('campingEditForm').addEventListener('submit',ev=>{
  ev.preventDefault();
  const e=state.entries.find(x=>x.id===document.getElementById('campingEditId').value); if(!e)return;
  const requestedType=document.getElementById('campingEntryType').value;
  if(requestedType!==e.type && hasMeaningfulDetails((e.details||{})[e.type])){
    const ok=confirm(`Art wirklich von „${typeLabels[e.type]}“ zu „${typeLabels[requestedType]}“ ändern?\n\nGemeinsame und kompatible Angaben bleiben erhalten. Nicht passende Detailangaben werden entfernt.`);
    if(!ok){ document.getElementById('campingEntryType').value=e.type; return; }
  }
  const s=ensureCampingDetails(e);
  e.name=document.getElementById('campingName').value.trim()||e.name; e.country=document.getElementById('campingCountry').value.trim(); e.region=document.getElementById('campingRegion').value.trim(); e.travelRegions=splitList(document.getElementById('campingTravelRegions').value); e.town=document.getElementById('campingTown').value.trim(); e.address=document.getElementById('campingAddress').value.trim(); e.source=''; e.sourceType=document.getElementById('campingSourceType').value; e.sourceUrl=normalizeExternalUrl(document.getElementById('campingSourceUrl').value) || document.getElementById('campingSourceUrl').value.trim(); e.website=normalizeExternalUrl(document.getElementById('campingWebsite').value) || document.getElementById('campingWebsite').value.trim(); e.media=cloneMediaList(campingMediaDraft); e.titleImageId=campingTitleImageDraft; e.phone=document.getElementById('campingPhone').value.trim(); e.email=document.getElementById('campingEmail').value.trim();
  e.geoTags=[e.country,e.region,e.town,...e.travelRegions].filter(Boolean);
  s.operationType=document.getElementById('campingOperationType').value; s.openFrom=s.operationType==='seasonal'?document.getElementById('campingOpenFrom').value:''; s.openTo=s.operationType==='seasonal'?document.getElementById('campingOpenTo').value:''; s.summerCamping=document.getElementById('campingSummer').value; s.winterCamping=document.getElementById('campingWinter').value; s.minStay=document.getElementById('campingMinStay').value?Number(document.getElementById('campingMinStay').value):null; s.reservation=document.getElementById('campingReservation').value; s.spontaneousArrival=document.getElementById('campingSpontaneous').value; s.arrivalFrom=document.getElementById('campingArrivalFrom').value; s.arrivalTo=document.getElementById('campingArrivalTo').value; s.departureFrom=document.getElementById('campingDepartureFrom').value; s.departureTo=document.getElementById('campingDepartureTo').value; s.notes=document.getElementById('campingSeasonNotes').value.trim();
  const p=ensureCampingPitch(e);
  p.type=document.getElementById('campingPitchType').value;
  p.area=numericField('campingPitchArea');
  p.length=numericField('campingPitchLength');
  p.width=numericField('campingPitchWidth');
  p.largeMotorhome=document.getElementById('campingPitchLargeMotorhome').value;
  p.surface=getCheckboxGroup('campingPitchSurface');
  p.level=document.getElementById('campingPitchLevel').value;
  p.shade=document.getElementById('campingPitchShade').value;
  p.locationFeatures=getCheckboxGroup('campingPitchLocationFeatures');
  p.electricity=document.getElementById('campingPitchElectricity').value;
  p.electricityBilling=p.electricity==='yes'?document.getElementById('campingPitchElectricityBilling').value:'unknown';
  p.electricityPrice=p.electricity==='yes'?numericField('campingPitchElectricityPrice'):null;
  p.electricityKwhPrice=p.electricity==='yes'?numericField('campingPitchElectricityKwhPrice'):null;
  p.freshWater=document.getElementById('campingPitchFreshWater').value;
  p.wasteWater=document.getElementById('campingPitchWasteWater').value;
  p.tv=document.getElementById('campingPitchTv').value;
  p.wifi=document.getElementById('campingPitchWifi').value;
  p.wifiBilling=p.wifi==='yes'?document.getElementById('campingPitchWifiBilling').value:'unknown';
  p.wifiPrice=p.wifi==='yes'?numericField('campingPitchWifiPrice'):null;
  p.access=document.getElementById('campingPitchAccess').value;
  p.maxVehicleLength=numericField('campingPitchMaxLength');
  p.maxVehicleHeight=numericField('campingPitchMaxHeight');
  p.maxVehicleWeight=numericField('campingPitchMaxWeight');
  p.preferredNumber=document.getElementById('campingPitchPreferredNumber').value.trim();
  p.notes=document.getElementById('campingPitchNotes').value.trim();

  const f=ensureCampingFacilities(e);
  f.wc=document.getElementById('campingFacilitiesWc').value;
  f.showers=document.getElementById('campingFacilitiesShowers').value;
  f.showerBilling=f.showers==='yes'?document.getElementById('campingFacilitiesShowerBilling').value:'unknown';
  f.showerPrice=f.showers==='yes'?numericField('campingFacilitiesShowerPrice'):null;
  f.washCubicles=document.getElementById('campingFacilitiesWashCubicles').value;
  f.familyBath=document.getElementById('campingFacilitiesFamilyBath').value;
  f.accessibleSanitary=document.getElementById('campingFacilitiesAccessible').value;
  f.childrenSanitary=document.getElementById('campingFacilitiesChildren').value;
  f.privateBath=document.getElementById('campingFacilitiesPrivateBath').value;
  f.heatedSanitary=document.getElementById('campingFacilitiesHeated').value;
  f.washer=document.getElementById('campingFacilitiesWasher').value;
  f.washerBilling=f.washer==='yes'?document.getElementById('campingFacilitiesWasherBilling').value:'unknown';
  f.washerPrice=f.washer==='yes'?numericField('campingFacilitiesWasherPrice'):null;
  f.dryer=document.getElementById('campingFacilitiesDryer').value;
  f.dryerBilling=f.dryer==='yes'?document.getElementById('campingFacilitiesDryerBilling').value:'unknown';
  f.dryerPrice=f.dryer==='yes'?numericField('campingFacilitiesDryerPrice'):null;
  f.dishwashing=document.getElementById('campingFacilitiesDishwashing').value;
  f.freshWaterPoint=document.getElementById('campingFacilitiesFreshWaterPoint').value;
  f.greyWater=document.getElementById('campingFacilitiesGreyWater').value;
  f.chemicalToilet=document.getElementById('campingFacilitiesChemicalToilet').value;
  f.floorDrain=document.getElementById('campingFacilitiesFloorDrain').value;
  f.wasteDisposal=document.getElementById('campingFacilitiesWaste').value;
  f.wasteSeparation=document.getElementById('campingFacilitiesWasteSeparation').value;
  f.shop=document.getElementById('campingFacilitiesShop').value;
  f.breadService=document.getElementById('campingFacilitiesBread').value;
  f.breadSeason=f.breadService==='yes'?document.getElementById('campingFacilitiesBreadSeason').value:'unknown';
  f.campingShop=document.getElementById('campingFacilitiesCampingShop').value;
  f.gasSupply=document.getElementById('campingFacilitiesGas').value;
  f.ebikeCharging=document.getElementById('campingFacilitiesEbike').value;
  f.evCharging=document.getElementById('campingFacilitiesEv').value;

  const l=ensureCampingLocation(e);
  l.features=getCheckboxGroup('campingLocationFeatures');
  l.distances={
    centre:{km:numericField('campingDistanceCentre'),walkable:document.getElementById('campingWalkCentre').value},
    supermarket:{km:numericField('campingDistanceSupermarket'),walkable:document.getElementById('campingWalkSupermarket').value},
    restaurant:{km:numericField('campingDistanceRestaurant'),walkable:document.getElementById('campingWalkRestaurant').value},
    bakery:{km:numericField('campingDistanceBakery'),walkable:document.getElementById('campingWalkBakery').value},
    water:{km:numericField('campingDistanceWater'),walkable:document.getElementById('campingWalkWater').value},
    sights:{km:numericField('campingDistanceSights'),walkable:document.getElementById('campingWalkSights').value}
  };
  l.mobility={
    publicTransport:document.getElementById('campingMobilityPublicTransport').value,
    bus:document.getElementById('campingMobilityBus').value,
    train:document.getElementById('campingMobilityTrain').value,
    cycle:document.getElementById('campingMobilityCycle').value,
    hiking:document.getElementById('campingMobilityHiking').value,
    cableCar:document.getElementById('campingMobilityCableCar').value,
    ferry:document.getElementById('campingMobilityFerry').value
  };
  l.notes=document.getElementById('campingLocationNotes').value.trim();

  const leisure=ensureCampingLeisure(e), gastroIds={restaurant:'Restaurant',snack:'Snack',bar:'Bar',cafe:'Cafe',beerGarden:'BeerGarden',iceCream:'IceCream'};
  leisure.gastronomy={}; Object.entries(gastroIds).forEach(([key,id])=>{const status=document.getElementById('campingLeisure'+id).value;leisure.gastronomy[key]={status,season:status==='yes'?document.getElementById('campingLeisure'+id+'Season').value:'unknown'};});
  const beach=document.getElementById('campingLeisureBeach').value;
  leisure.bathingWellness={outdoorPool:document.getElementById('campingLeisureOutdoorPool').value,indoorPool:document.getElementById('campingLeisureIndoorPool').value,sauna:document.getElementById('campingLeisureSauna').value,wellness:document.getElementById('campingLeisureWellness').value,swimmingAccess:document.getElementById('campingLeisureSwimmingAccess').value,beach,beachTypes:beach==='yes'?getCheckboxGroup('campingBeachTypes'):[]};
  const sportIds={playground:'Playground',tableTennis:'TableTennis',tennis:'Tennis',miniGolf:'MiniGolf',fitness:'Fitness',bikeRental:'BikeRental',eBikeRental:'EBikeRental',waterSports:'WaterSports',entertainment:'Entertainment',kidsProgram:'KidsProgram'};
  leisure.sport={};Object.entries(sportIds).forEach(([key,id])=>leisure.sport[key]=document.getElementById('campingLeisure'+id).value);
  leisure.character=getCheckboxGroup('campingLeisureCharacter');leisure.size=document.getElementById('campingLeisureSize').value;leisure.pitchCount=numericField('campingLeisurePitchCount');
  const dog=ensureCampingDog(e);dog.allowed=document.getElementById('campingDogAllowed').value;
  if(dog.allowed==='yes'){dog.maxCount=numericField('campingDogMaxCount');dog.feeType=document.getElementById('campingDogFeeType').value;dog.fee=dog.feeType==='paid'?numericField('campingDogFee'):null;dog.leash=document.getElementById('campingDogLeash').value;dog.restricted=document.getElementById('campingDogRestricted').value;dog.run=document.getElementById('campingDogRun').value;dog.beach=document.getElementById('campingDogBeach').value;dog.swimming=document.getElementById('campingDogSwimming').value;dog.shower=document.getElementById('campingDogShower').value;dog.restaurant=document.getElementById('campingDogRestaurant').value;dog.notes=document.getElementById('campingDogNotes').value.trim();}else{dog.maxCount=null;dog.feeType='unknown';dog.fee=null;dog.leash='unknown';dog.restricted='unknown';dog.run='unknown';dog.beach='unknown';dog.swimming='unknown';dog.shower='unknown';dog.restaurant='unknown';dog.notes='';}

  const personal=ensureCampingPersonal(e);
  const personalStatus=document.getElementById('campingPersonalStatus').value;
  e.visited=personalStatus==='visited';
  e.wantToVisit=personalStatus==='want';
  e.favorite=!!document.getElementById('campingPersonalFavorite').checked;
  e.why=document.getElementById('campingPersonalWhy').value.trim();
  personal.ratings={
    overall:ratingValue('campingRatingOverall'),
    location:ratingValue('campingRatingLocation'),
    quiet:ratingValue('campingRatingQuiet'),
    cleanliness:ratingValue('campingRatingCleanliness'),
    sanitary:ratingValue('campingRatingSanitary'),
    value:ratingValue('campingRatingValue')
  };
  personal.returnIntent=document.getElementById('campingPersonalReturn').value;
  e.visits=collectCampingVisits();
  e.notes=document.getElementById('campingPersonalNotes').value.trim();

  const prices=ensureCampingPrices(e);
  prices.year=numericField('campingPriceYear');prices.approxTotal=numericField('campingPriceApproxTotal');prices.from=numericField('campingPriceFrom');prices.to=numericField('campingPriceTo');prices.base=numericField('campingPriceBase');prices.basePersons=numericField('campingPriceBasePersons');prices.extraPerson=numericField('campingPriceExtraPerson');prices.child=numericField('campingPriceChild');prices.touristTax=numericField('campingPriceTouristTax');prices.reservationFee=numericField('campingPriceReservationFee');prices.otherLabel=document.getElementById('campingPriceOtherLabel').value.trim();prices.otherAmount=numericField('campingPriceOtherAmount');prices.included=document.getElementById('campingPriceIncluded').value.trim();prices.notes=document.getElementById('campingPriceNotes').value.trim();

  convertEntryType(e,requestedType,true);
  e.updatedAt=new Date().toISOString(); saveEntries(); document.getElementById('campingEditDialog').close(); render(); openDetail(e.id);
});

function createBackup(){
  const payload={app:'viacruz Reisezeit',dataVersion:1,createdAt:new Date().toISOString(),entries:state.entries,settings:JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`viacruz-Reisezeit-Backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href);
}
async function restoreBackup(){
  const input=document.getElementById('restoreFile'); const file=input?.files?.[0]; if(!file){alert('Bitte zuerst eine Datensicherungsdatei auswählen.');return;}
  try{const data=JSON.parse(await file.text()); if(data.app!=='viacruz Reisezeit'||!Array.isArray(data.entries))throw new Error('Ungültige Datei'); if(!confirm(`Datensicherung mit ${data.entries.length} Einträgen wiederherstellen? Die aktuellen lokalen Daten werden ersetzt.`))return; state.entries=data.entries;saveEntries();render();alert('Datensicherung wurde wiederhergestellt.');}catch(err){alert('Die Datei konnte nicht als gültige Reisezeit-Datensicherung gelesen werden.');}
}

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));}
render();
