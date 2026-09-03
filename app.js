const STORE_KEY = 'viacruz-reisezeit-data-v1';
const SETTINGS_KEY = 'viacruz-reisezeit-settings-v1';

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
        <button class="quick-btn" data-action="new">＋ Neuer Eintrag<span>In wenigen Angaben speichern</span></button>
        <button class="quick-btn" data-special="favorite">★ Favoriten<span>${count(e=>e.favorite)} Einträge</span></button>
        <button class="quick-btn" data-special="want">♡ Möchte ich besuchen<span>${count(e=>e.wantToVisit)} Einträge</span></button>
        <button class="quick-btn" data-route-go="search">⌕ Suche<span>Liste und Filter</span></button>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Zuletzt hinzugefügt</h2><p>Einträge, die du später weiter ergänzen kannst</p></div></div>
      ${recent.length ? `<div class="place-list">${recent.map(placeCard).join('')}</div>` : `<div class="empty">Noch keine Orte gespeichert. Mit „Neuer Eintrag“ legst du den ersten an.</div>`}
    </section>
    <div class="footer-brand">powered by viacruz</div>`;
}

function categoryCard(route,label,num,sub){ return `<button class="category-card" data-route-go="${route}"><div><strong>${label}</strong><small>${sub}</small></div><div class="count">${num}</div></button>`; }
function placeCard(e){
  return `<button class="place-card" data-detail="${e.id}">
    <div class="place-thumb">${typeIcons[e.type] || '●'}</div>
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
  return `<section><div class="section-head"><div><div class="eyebrow">Alle Einträge</div><h2>Suche</h2><p>Die freie Suche berücksichtigt Name, Land, Region, Quelle und eigene Tags.</p></div><button class="btn primary" data-action="new">+ Neu</button></div>
  <div class="toolbar"><input class="searchbox route-search" value="${escapeHtml(state.query)}" placeholder="z. B. Südtirol, Gardasee, Wochenende …"><button class="btn secondary" data-action="clear-search">Löschen</button></div>
  ${items.length?`<div class="place-list">${items.map(placeCard).join('')}</div>`:`<div class="empty">${state.query?'Keine Treffer für diese Suche.':'Noch keine Orte gespeichert.'}</div>`}
  <div class="footer-brand">powered by viacruz</div></section>`;
}

function matchesQuery(e,q){
  if(!q.trim()) return true;
  const hay=[e.name,e.country,e.region,e.town,e.address,e.source,e.sourceType,e.sourceUrl,...(e.tags||[]),...(e.geoTags||[]),...(e.travelRegions||[])].filter(Boolean).join(' ').toLowerCase();
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
    <div class="setting-card"><h3>viacruz Reisezeit</h3><p>Version 0.3.0 · Datenformat 1</p></div>
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
  document.querySelectorAll('[data-action="backup"]').forEach(b=>b.onclick=createBackup);
  document.querySelectorAll('[data-action="restore"]').forEach(b=>b.onclick=restoreBackup);
}
function renderSpecial(kind){
  const app=document.getElementById('app');
  const items=state.entries.filter(e=>!e.deleted && (kind==='favorite'?e.favorite:e.wantToVisit));
  app.innerHTML=`<section><div class="section-head"><div><div class="eyebrow">Schnellzugriff</div><h2>${kind==='favorite'?'Favoriten':'Möchte ich besuchen'}</h2></div><button class="btn secondary" data-route-go="home">Zurück</button></div>${items.length?`<div class="place-list">${items.map(placeCard).join('')}</div>`:`<div class="empty">Noch keine Einträge in dieser Auswahl.</div>`}</section>`;
  wireViewEvents();
}

function openEntryDialog(pretype){
  const dlg=document.getElementById('entryDialog');
  document.getElementById('entryForm').reset();
  if(pretype) document.getElementById('entryType').value=pretype;
  dlg.showModal();
  setTimeout(()=>document.getElementById('entryName').focus(),80);
}

document.getElementById('cancelEntry').onclick=()=>document.getElementById('entryDialog').close();
document.getElementById('entryForm').addEventListener('submit', e=>{
  e.preventDefault();
  const entry={
    id:uid(), type:entryType.value, name:entryName.value.trim(), country:entryCountry.value.trim(), region:entryRegion.value.trim(), source:'', sourceType:entrySourceType.value, sourceUrl:normalizeExternalUrl(entrySourceUrl.value) || entrySourceUrl.value.trim(),
    geoTags:[entryCountry.value.trim(),entryRegion.value.trim()].filter(Boolean), tags:[], favorite:false, wantToVisit:false, visited:false, deleted:false,
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), location:null, accessPoint:null, visits:[], media:[], details:{}
  };
  if(!entry.name) return;
  state.entries.push(entry); saveEntries(); document.getElementById('entryDialog').close(); render(); openDetail(entry.id);
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
  const regions=(e.travelRegions||[]).join(', ');
  const phone=e.phone ? `<a class="contact-link" href="${escapeHtml(phoneHref(e.phone))}">${escapeHtml(e.phone)}</a>` : '';
  const email=e.email ? `<a class="contact-link" href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>` : '';
  const srcLabel=sourceLabel(e);
  const srcUrl=sourceUrl(e);
  const source=srcLabel || srcUrl ? `${escapeHtml(srcLabel||'Internet')}${srcUrl?` <a class="inline-link" href="${escapeHtml(srcUrl)}" target="_blank" rel="noopener noreferrer">öffnen ↗</a>`:''}` : '';

  const basicRows=[
    detailRow('Land',e.country),
    detailRow('Region/Bundesland',e.region),
    detailRow('Gebiet/Reiseregion',regions),
    detailRow('Ort',e.town),
    detailRow('Adresse',e.address),
    detailRow('Telefon',phone,true),
    detailRow('E-Mail',email,true),
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

  return `<div class="detail-accordions">
    <details class="detail-accordion">
      <summary><span><small>Grunddaten</small><strong>${escapeHtml(basicSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary>
      <div class="accordion-body">${basicRows||'<div class="detail-empty">Noch keine weiteren Grunddaten gespeichert.</div>'}</div>
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
  </div>`;
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
  content.innerHTML=`<div class="sheet-head"><div><div class="eyebrow">${typeLabels[e.type]}</div><h2>${escapeHtml(e.name)}</h2><div class="detail-meta">${escapeHtml(locationText(e))}</div></div><button class="icon-btn close" id="closeDetail">×</button></div>
  ${infoCards.length?`<div class="detail-grid">${infoCards.join('')}</div>`:''}
  ${campingDetailCards(e)}
  <div class="detail-actions status-actions"><button class="btn secondary" id="favoriteDetail">${e.favorite?'★ Favorit entfernen':'☆ Als Favorit'}</button><button class="btn secondary" id="wantDetail">${e.wantToVisit?'Wunsch entfernen':'♡ Möchte ich besuchen'}</button></div>
  <div class="detail-actions"><button class="btn secondary" id="visitedDetail">${e.visited?'Besucht ✓':'Als besucht markieren'}</button><button class="btn secondary" id="editBasic">${e.type==='camping'?'Campingplatz bearbeiten':'Grunddaten bearbeiten'}</button></div>
  <div class="detail-actions single-action"><button class="btn danger" id="trashDetail">In Papierkorb</button></div>`;
  const dlg=document.getElementById('detailDialog'); dlg.showModal();
  document.getElementById('closeDetail').onclick=()=>dlg.close();
  document.getElementById('favoriteDetail').onclick=()=>{e.favorite=!e.favorite;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('wantDetail').onclick=()=>{e.wantToVisit=!e.wantToVisit;if(e.wantToVisit)e.visited=false;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('visitedDetail').onclick=()=>{e.visited=!e.visited;if(e.visited)e.wantToVisit=false;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('trashDetail').onclick=()=>{if(confirm('Diesen Eintrag in den Papierkorb verschieben?')){e.deleted=true;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();}};
  document.getElementById('editBasic').onclick=()=>e.type==='camping'?openCampingEditor(e):editBasic(e);
}
function editBasic(e){
  const name=prompt('Name',e.name); if(name===null)return;
  const country=prompt('Land',e.country||''); if(country===null)return;
  const region=prompt('Region/Gebiet',e.region||''); if(region===null)return;
  e.name=name.trim()||e.name; e.country=country.trim(); e.region=region.trim(); e.geoTags=[e.country,e.region].filter(Boolean); e.updatedAt=new Date().toISOString(); saveEntries();
  document.getElementById('detailDialog').close(); render(); openDetail(e.id);
}

function ensureCampingDetails(e){
  e.details=e.details||{};
  e.details.camping=e.details.camping||{};
  e.details.camping.season=e.details.camping.season||{};
  e.details.camping.pitch=e.details.camping.pitch||{};
  e.details.camping.facilities=e.details.camping.facilities||{};
  e.details.camping.location=e.details.camping.location||{};
  e.details.camping.leisure=e.details.camping.leisure||{};
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
function updateLeisureConditionalFields(){
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
  setField('campingEditId',e.id); setField('campingName',e.name); setField('campingCountry',e.country); setField('campingRegion',e.region);
  setField('campingTravelRegions',(e.travelRegions||[]).join(', ')); setField('campingTown',e.town); setField('campingAddress',e.address); setField('campingSourceType',sourceLabel(e)); setField('campingSourceUrl',sourceUrl(e)); setField('campingPhone',e.phone); setField('campingEmail',e.email);
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
['Restaurant','Snack','Bar','Cafe','BeerGarden','IceCream'].forEach(id=>document.getElementById('campingLeisure'+id)?.addEventListener('change',updateLeisureConditionalFields));
document.getElementById('campingLeisureBeach')?.addEventListener('change',updateLeisureConditionalFields);
document.getElementById('campingEditForm').addEventListener('submit',ev=>{
  ev.preventDefault();
  const e=state.entries.find(x=>x.id===document.getElementById('campingEditId').value); if(!e)return;
  const s=ensureCampingDetails(e);
  e.name=document.getElementById('campingName').value.trim()||e.name; e.country=document.getElementById('campingCountry').value.trim(); e.region=document.getElementById('campingRegion').value.trim(); e.travelRegions=splitList(document.getElementById('campingTravelRegions').value); e.town=document.getElementById('campingTown').value.trim(); e.address=document.getElementById('campingAddress').value.trim(); e.source=''; e.sourceType=document.getElementById('campingSourceType').value; e.sourceUrl=normalizeExternalUrl(document.getElementById('campingSourceUrl').value) || document.getElementById('campingSourceUrl').value.trim(); e.phone=document.getElementById('campingPhone').value.trim(); e.email=document.getElementById('campingEmail').value.trim();
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
