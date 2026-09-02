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
function locationText(e){ return [e.region,e.country].filter(Boolean).join(', ') || 'Ort noch nicht ergänzt'; }

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
  const hay=[e.name,e.country,e.region,e.source,...(e.tags||[]),...(e.geoTags||[])].filter(Boolean).join(' ').toLowerCase();
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
    <div class="setting-card"><h3>viacruz Reisezeit</h3><p>Version 0.1.0 · Datenformat 1</p></div>
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
    id:uid(), type:entryType.value, name:entryName.value.trim(), country:entryCountry.value.trim(), region:entryRegion.value.trim(), source:entrySource.value.trim(),
    geoTags:[entryCountry.value.trim(),entryRegion.value.trim()].filter(Boolean), tags:[], favorite:false, wantToVisit:false, visited:false, deleted:false,
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), location:null, accessPoint:null, visits:[], media:[], details:{}
  };
  if(!entry.name) return;
  state.entries.push(entry); saveEntries(); document.getElementById('entryDialog').close(); render(); openDetail(entry.id);
});

document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{state.route=b.dataset.route;state.query='';render();});
document.getElementById('settingsBtn').onclick=()=>{state.route='settings';render();};

function openDetail(id){
  const e=state.entries.find(x=>x.id===id); if(!e)return;
  const content=document.getElementById('detailContent');
  content.innerHTML=`<div class="sheet-head"><div><div class="eyebrow">${typeLabels[e.type]}</div><h2>${escapeHtml(e.name)}</h2><div class="detail-meta">${escapeHtml(locationText(e))}</div></div><button class="icon-btn close" id="closeDetail">×</button></div>
  <div class="detail-grid"><div class="info-card"><small>Status</small><strong>${e.favorite?'★ Favorit':e.wantToVisit?'Möchte ich besuchen':'Noch ohne Status'}</strong></div><div class="info-card"><small>Quelle</small><strong>${escapeHtml(e.source||'Noch nicht hinterlegt')}</strong></div></div>
  <div class="info-card"><small>Technisches Fundament</small><strong>Gemeinsame ID · zentrale Standortfelder · Besuchshistorie · Medienliste · typbezogene Details</strong></div>
  <div class="detail-actions"><button class="btn secondary" id="favoriteDetail">${e.favorite?'★ Favorit entfernen':'☆ Als Favorit'}</button><button class="btn secondary" id="wantDetail">${e.wantToVisit?'Von Wunschliste entfernen':'♡ Möchte ich besuchen'}</button></div>
  <div class="detail-actions"><button class="btn secondary" id="editBasic">Grunddaten bearbeiten</button><button class="btn danger" id="trashDetail">In Papierkorb</button></div>`;
  const dlg=document.getElementById('detailDialog'); dlg.showModal();
  document.getElementById('closeDetail').onclick=()=>dlg.close();
  document.getElementById('favoriteDetail').onclick=()=>{e.favorite=!e.favorite;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('wantDetail').onclick=()=>{e.wantToVisit=!e.wantToVisit;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('trashDetail').onclick=()=>{if(confirm('Diesen Eintrag in den Papierkorb verschieben?')){e.deleted=true;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();}};
  document.getElementById('editBasic').onclick=()=>editBasic(e);
}
function editBasic(e){
  const name=prompt('Name',e.name); if(name===null)return;
  const country=prompt('Land',e.country||''); if(country===null)return;
  const region=prompt('Region/Gebiet',e.region||''); if(region===null)return;
  e.name=name.trim()||e.name; e.country=country.trim(); e.region=region.trim(); e.geoTags=[e.country,e.region].filter(Boolean); e.updatedAt=new Date().toISOString(); saveEntries();
  document.getElementById('detailDialog').close(); render(); openDetail(e.id);
}

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
