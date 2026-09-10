const STORE_KEY = 'viacruz-reisezeit-data-v1';
const SETTINGS_KEY = 'viacruz-reisezeit-settings-v1';

const MEDIA_DB_NAME = 'viacruz-reisezeit-media-v1';
const MEDIA_DB_STORE = 'images';
let mediaDbPromise = null;

function openMediaDb(){
  if(mediaDbPromise)return mediaDbPromise;
  mediaDbPromise=new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){reject(new Error('IndexedDB wird nicht unterstützt.'));return;}
    const req=indexedDB.open(MEDIA_DB_NAME,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(MEDIA_DB_STORE))db.createObjectStore(MEDIA_DB_STORE,{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Bildspeicher konnte nicht geöffnet werden.'));
  });
  return mediaDbPromise;
}
function dataUrlToBlob(dataUrl){
  const parts=String(dataUrl||'').split(',');
  const meta=parts[0]||'';
  const mime=(meta.match(/data:([^;]+)/)||[])[1]||'image/jpeg';
  const binary=atob(parts[1]||'');
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error||new Error('Bild konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}
async function mediaDbPutDataUrl(id,dataUrl){
  if(!id||!dataUrl)return;
  const db=await openMediaDb();
  const blob=dataUrlToBlob(dataUrl);
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(MEDIA_DB_STORE,'readwrite');
    tx.objectStore(MEDIA_DB_STORE).put({id,blob,updatedAt:new Date().toISOString()});
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error('Bild konnte nicht gespeichert werden.'));
    tx.onabort=()=>reject(tx.error||new Error('Bildspeicherung wurde abgebrochen.'));
  });
}
async function mediaDbGetDataUrl(id){
  if(!id)return '';
  const db=await openMediaDb();
  const rec=await new Promise((resolve,reject)=>{
    const tx=db.transaction(MEDIA_DB_STORE,'readonly');
    const req=tx.objectStore(MEDIA_DB_STORE).get(id);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error||new Error('Bild konnte nicht geladen werden.'));
  });
  return rec?.blob?await blobToDataUrl(rec.blob):'';
}
async function mediaDbDelete(id){
  if(!id)return;
  const db=await openMediaDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(MEDIA_DB_STORE,'readwrite');
    tx.objectStore(MEDIA_DB_STORE).delete(id);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error('Bild konnte nicht gelöscht werden.'));
  });
}
async function migrateLegacyMediaToIndexedDb(){
  let migrated=false;
  for(const entry of state.entries){
    if(!Array.isArray(entry.media))continue;
    for(const media of entry.media){
      if(media?.id&&media?.dataUrl){
        await mediaDbPutDataUrl(media.id,media.dataUrl);
        migrated=true;
      }
    }
  }
  if(migrated)saveEntries();
}
async function hydrateAllEntryMedia(){
  for(const entry of state.entries){
    if(!Array.isArray(entry.media))continue;
    for(const media of entry.media){
      if(media?.id&&!media.dataUrl){
        try{media.dataUrl=await mediaDbGetDataUrl(media.id);}catch(err){console.warn('Bild konnte nicht geladen werden:',media.id,err);}
      }
    }
  }
}
async function pruneMediaStore(){
  try{
    const keep=new Set(state.entries.flatMap(e=>Array.isArray(e.media)?e.media.map(m=>m?.id).filter(Boolean):[]));
    const db=await openMediaDb();
    const ids=await new Promise((resolve,reject)=>{
      const tx=db.transaction(MEDIA_DB_STORE,'readonly');
      const req=tx.objectStore(MEDIA_DB_STORE).getAllKeys();
      req.onsuccess=()=>resolve(req.result||[]);
      req.onerror=()=>reject(req.error);
    });
    for(const id of ids)if(!keep.has(id))await mediaDbDelete(id);
  }catch(err){console.warn('Bildspeicher konnte nicht bereinigt werden:',err);}
}
function entriesForLocalStorage(){
  return state.entries.map(entry=>({
    ...entry,
    media:Array.isArray(entry.media)?entry.media.map(media=>{
      const {dataUrl,...meta}=media||{};
      return meta;
    }):[]
  }));
}
async function entriesForBackup(){
  const out=[];
  for(const entry of state.entries){
    const copy={...entry,media:[]};
    for(const media of (Array.isArray(entry.media)?entry.media:[])){
      let dataUrl=media?.dataUrl||'';
      if(!dataUrl&&media?.id){
        try{dataUrl=await mediaDbGetDataUrl(media.id);}catch(_){}
      }
      copy.media.push({...media,dataUrl});
    }
    out.push(copy);
  }
  return out;
}
async function persistImportedMedia(entries){
  for(const entry of entries){
    if(!Array.isArray(entry.media))continue;
    for(const media of entry.media){
      if(media?.id&&media?.dataUrl)await mediaDbPutDataUrl(media.id,media.dataUrl);
    }
  }
}

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
  ferienwohnung: 'Ferienwohnung', ferienhaus: 'Ferienhaus', ferien: 'Ferienwohnung/Ferienhaus',
  besonders: 'Besondere Unterkunft', reiseziel: 'Reiseziel/Ausflugsziel'
};
const typeIcons = {camping:'△', stellplatz:'▣', hotel:'H', ferienwohnung:'⌂', ferienhaus:'⌂', ferien:'⌂', besonders:'◇', reiseziel:'◎'};

const HOLIDAY_DESTINATION_CATEGORIES = [
  ['city','Stadt / Ort'],['sight','Sehenswürdigkeit'],['nature','Natur / Landschaft'],['lake','See'],['coast','Strand / Küste'],
  ['mountain','Berg / Aussichtspunkt'],['castle','Burg / Schloss'],['museum','Museum'],['church','Kirche / Kloster'],['spa','Therme / Bad'],
  ['amusement','Freizeitpark'],['zoo','Tierpark / Zoo'],['christmas','Weihnachtsmarkt'],['event','Veranstaltung / Event'],
  ['scenic-road','Panoramastraße'],['hiking','Wanderziel'],['cycling','Radziel'],['shopping','Shopping'],['culinary','Kulinarik'],['other','Sonstiges']
];
const HOLIDAY_DESTINATION_CHARACTERS = [
  ['nature','Natur'],['culture','Kultur'],['history','Geschichte'],['relaxation','Erholung'],['active','Aktiv'],
  ['family','Familie'],['romantic','Romantisch'],['culinary','Kulinarisch'],['unusual','Außergewöhnlich']
];
const HOLIDAY_DESTINATION_SCOPE_LABELS={single:'Einzelnes Ziel',city:'Ort / Stadt',region:'Gebiet / Region',route:'Route / Strecke',event:'Veranstaltung'};
const HOLIDAY_DESTINATION_ACTIVITIES = [
  ['sightseeing','Sehenswürdigkeiten'],['hiking','Wandern'],['cycling','Radfahren'],['swimming','Baden / Schwimmen'],['wellness','Wellness / Therme'],
  ['boat','Boot / Schifffahrt'],['panorama','Aussicht / Panorama'],['photo','Fotospot'],['culinary','Essen & Kulinarik'],['shopping','Shopping'],
  ['family','Familienaktivitäten'],['winter_sports','Wintersport'],['event','Veranstaltung / Event'],['nature','Natur erleben'],['culture_history','Kultur & Geschichte']
];
function customActivityValue(label){return `custom:${String(label||'').trim()}`;}
function customActivityLabel(value){return String(value||'').startsWith('custom:')?String(value).slice(7):'';}
function holidayDestinationActivityLabel(value){const found=HOLIDAY_DESTINATION_ACTIVITIES.find(([key])=>key===value);return found?found[1]:(customActivityLabel(value)||value||'');}
function customDestinationValue(label){return `custom:${String(label||'').trim()}`;}
function customDestinationLabel(value){return String(value||'').startsWith('custom:')?String(value).slice(7):'';}
function holidayDestinationChoiceLabel(value,kind){
  const list=kind==='character'?HOLIDAY_DESTINATION_CHARACTERS:HOLIDAY_DESTINATION_CATEGORIES;
  const found=list.find(([key])=>key===value);
  return found?found[1]:(customDestinationLabel(value)||value||'');
}

const state = {
  route: 'home',
  holidayFilter: 'all',
  query: '',
  searchSort: 'relevance',
  entries: loadEntries()
};

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
let campingMediaDraft=[];
let campingTitleImageDraft=null;
let stellplatzMediaDraft=[];
let stellplatzTitleImageDraft=null;
let holidayMediaDraft=[];
let holidayTitleImageDraft=null;
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
      await mediaDbPutDataUrl(item.id,dataUrl);
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
function renderStellplatzMediaEditor(){
  const wrap=document.getElementById('stellplatzMediaEditor'); if(!wrap)return;
  if(!stellplatzMediaDraft.length){
    wrap.innerHTML='<div class="media-empty">Noch keine Bilder gespeichert.</div>';
    return;
  }
  wrap.innerHTML=stellplatzMediaDraft.map(m=>{
    const isTitle=m.id===stellplatzTitleImageDraft;
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
      const m=stellplatzMediaDraft.find(x=>x.id===card?.dataset.mediaId);
      if(m)m.description=input.value;
    });
  });
  wrap.querySelectorAll('.media-set-title').forEach(btn=>{
    btn.onclick=()=>{
      const id=btn.closest('.media-edit-card')?.dataset.mediaId;
      stellplatzTitleImageDraft=id||null;
      renderStellplatzMediaEditor();
    };
  });
  wrap.querySelectorAll('.media-delete').forEach(btn=>{
    btn.onclick=()=>{
      const id=btn.closest('.media-edit-card')?.dataset.mediaId;
      stellplatzMediaDraft=stellplatzMediaDraft.filter(m=>m.id!==id);
      if(stellplatzTitleImageDraft===id)stellplatzTitleImageDraft=null;
      renderStellplatzMediaEditor();
    };
  });
}
async function addStellplatzMediaFiles(files){
  const selected=[...files].filter(f=>f.type.startsWith('image/'));
  if(!selected.length)return;
  const button=document.getElementById('addStellplatzMedia');
  if(button){button.disabled=true;button.textContent='Bilder werden vorbereitet …';}
  try{
    for(const file of selected){
      const dataUrl=await imageFileToDataUrl(file);
      const item={id:uid(),kind:'image',name:file.name||'Bild',description:'',dataUrl,createdAt:new Date().toISOString()};
      await mediaDbPutDataUrl(item.id,dataUrl);
      stellplatzMediaDraft.push(item);
      if(!stellplatzTitleImageDraft)stellplatzTitleImageDraft=item.id;
    }
    renderStellplatzMediaEditor();
  }catch(err){
    alert('Mindestens ein Bild konnte nicht verarbeitet werden.');
  }finally{
    if(button){button.disabled=false;button.textContent='+ Bilder auswählen';}
    const input=document.getElementById('stellplatzMediaInput'); if(input)input.value='';
  }
}

function renderHolidayMediaEditor(){
  const wrap=document.getElementById('holidayMediaEditor'); if(!wrap)return;
  if(!holidayMediaDraft.length){
    wrap.innerHTML='<div class="media-empty">Noch keine Bilder gespeichert.</div>';
    return;
  }
  wrap.innerHTML=holidayMediaDraft.map(m=>{
    const isTitle=m.id===holidayTitleImageDraft;
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
      const id=input.closest('.media-edit-card')?.dataset.mediaId;
      const m=holidayMediaDraft.find(x=>x.id===id);
      if(m)m.description=input.value;
    });
  });
  wrap.querySelectorAll('.media-set-title').forEach(btn=>{
    btn.onclick=()=>{holidayTitleImageDraft=btn.closest('.media-edit-card')?.dataset.mediaId||null;renderHolidayMediaEditor();};
  });
  wrap.querySelectorAll('.media-delete').forEach(btn=>{
    btn.onclick=()=>{
      const id=btn.closest('.media-edit-card')?.dataset.mediaId;
      holidayMediaDraft=holidayMediaDraft.filter(m=>m.id!==id);
      if(holidayTitleImageDraft===id)holidayTitleImageDraft=null;
      renderHolidayMediaEditor();
    };
  });
}
async function holidayImageFileToDataUrl(file){
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

  // Die App optimiert Urlaub-/Reisezielbilder automatisch für den lokalen Speicher.
  // Ziel: gute Darstellung in Titelbild/Galerie, ohne dass der Nutzer Bilder selbst
  // verkleinern muss. Wir reduzieren Auflösung und JPEG-Qualität schrittweise,
  // bis eine robuste Zielgröße erreicht ist.
  const targetChars=180000; // ca. 135 KB Binärdaten pro Bild als Data-URL
  let maxSide=1200;
  let quality=0.76;
  let result='';

  for(let attempt=0;attempt<14;attempt++){
    const scale=Math.min(1,maxSide/Math.max(img.width,img.height));
    const w=Math.max(1,Math.round(img.width*scale));
    const h=Math.max(1,Math.round(img.height*scale));
    const canvas=document.createElement('canvas');
    canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext('2d',{alpha:false});
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,w,h);
    ctx.drawImage(img,0,0,w,h);
    result=canvas.toDataURL('image/jpeg',quality);
    if(result.length<=targetChars)break;

    if(quality>0.48){
      quality=Math.max(0.48,quality-0.07);
    }else{
      maxSide=Math.max(640,Math.round(maxSide*0.82));
      quality=0.62;
    }
  }
  return result;
}
async function addHolidayMediaFiles(files){
  const selected=[...files].filter(f=>f.type.startsWith('image/'));
  if(!selected.length)return;
  const button=document.getElementById('addHolidayMedia');
  if(button){button.disabled=true;button.textContent='Bilder werden vorbereitet …';}
  try{
    for(const file of selected){
      const dataUrl=await holidayImageFileToDataUrl(file);
      const item={id:uid(),kind:'image',name:file.name||'Bild',description:'',dataUrl,createdAt:new Date().toISOString()};
      await mediaDbPutDataUrl(item.id,dataUrl);
      holidayMediaDraft.push(item);
      if(!holidayTitleImageDraft)holidayTitleImageDraft=item.id;
    }
    renderHolidayMediaEditor();
  }catch(err){
    console.error('Urlaub-Bild konnte nicht verarbeitet werden:',err);
    alert('Mindestens ein Bild konnte nicht verarbeitet werden.');
  }finally{
    if(button){button.disabled=false;button.textContent='+ Bilder auswählen';}
    const input=document.getElementById('holidayMediaInput'); if(input)input.value='';
  }
}
function holidayHeroHtml(e){
  const title=imageById(e,e.titleImageId);
  if(title?.dataUrl)return `<div class="detail-title-image"><img src="${title.dataUrl}" alt="${escapeHtml(title.description||e.name||typeLabels[e.type]||'Urlaub')}" /></div>`;
  return `<div class="detail-title-image detail-title-placeholder"><span>${escapeHtml(typeIcons[e.type]||'◎')}</span><strong>${escapeHtml(typeLabels[e.type]||'Urlaub')}</strong></div>`;
}
function holidayGalleryHtml(e){
  const media=Array.isArray(e.media)?e.media.filter(m=>m.kind==='image'&&m.dataUrl):[];
  if(!media.length)return '';
  return `<section class="detail-gallery-section"><div class="detail-gallery-head"><small>Bilder</small><strong>${media.length} ${media.length===1?'Bild':'Bilder'}</strong></div>
    <div class="detail-gallery">${media.map(m=>`<figure class="gallery-item ${m.id===e.titleImageId?'is-title':''}"><img src="${m.dataUrl}" alt="${escapeHtml(m.description||'Gespeichertes Bild')}" />${m.id===e.titleImageId?'<span>Titelbild</span>':''}${m.description?`<figcaption>${escapeHtml(m.description)}</figcaption>`:''}</figure>`).join('')}</div>
  </section>`;
}

function stellplatzHeroHtml(e){
  const title=imageById(e,e.titleImageId);
  if(title?.dataUrl){
    return `<div class="detail-title-image"><img src="${title.dataUrl}" alt="${escapeHtml(title.description||e.name||'Stellplatz')}" /></div>`;
  }
  return `<div class="detail-title-image detail-title-placeholder"><span>▣</span><strong>Stellplatz</strong></div>`;
}
function stellplatzGalleryHtml(e){
  const media=Array.isArray(e.media)?e.media.filter(m=>m.kind==='image'&&m.dataUrl):[];
  if(!media.length)return '';
  return `<section class="detail-gallery-section"><div class="detail-gallery-head"><small>Bilder</small><strong>${media.length} ${media.length===1?'Bild':'Bilder'}</strong></div>
    <div class="detail-gallery">${media.map(m=>`<figure class="gallery-item ${m.id===e.titleImageId?'is-title':''}"><img src="${m.dataUrl}" alt="${escapeHtml(m.description||'Gespeichertes Bild')}" />${m.id===e.titleImageId?'<span>Titelbild</span>':''}${m.description?`<figcaption>${escapeHtml(m.description)}</figcaption>`:''}</figure>`).join('')}</div>
  </section>`;
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
  const payload={dataVersion:1,updatedAt:new Date().toISOString(),entries:entriesForLocalStorage()};
  localStorage.setItem(STORE_KEY,JSON.stringify(payload));
  window.setTimeout(()=>pruneMediaStore(),0);
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
        ${categoryCard('urlaub','Urlaub',count(e=>['hotel','ferienwohnung','ferienhaus','ferien','besonders','reiseziel'].includes(e.type)),'Unterkünfte & Ziele')}
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
  const types = ['hotel','ferienwohnung','ferienhaus','ferien','besonders','reiseziel'];
  const items = state.entries.filter(e=>!e.deleted && types.includes(e.type) && (state.holidayFilter==='all'||e.type===state.holidayFilter) && matchesQuery(e,state.query));
  return `<section><div class="section-head"><div><div class="eyebrow">Sammlung</div><h2>Urlaub</h2></div><button class="btn primary" data-action="new">+ Neu</button></div>
  <div class="subtabs"><button data-holiday="all" class="${state.holidayFilter==='all'?'active':''}">Alle</button><button data-holiday="hotel" class="${state.holidayFilter==='hotel'?'active':''}">Hotels</button><button data-holiday="ferienwohnung" class="${state.holidayFilter==='ferienwohnung'?'active':''}">Ferienwohnungen</button><button data-holiday="ferienhaus" class="${state.holidayFilter==='ferienhaus'?'active':''}">Ferienhäuser</button><button data-holiday="besonders" class="${state.holidayFilter==='besonders'?'active':''}">Besondere Unterkunft</button><button data-holiday="reiseziel" class="${state.holidayFilter==='reiseziel'?'active':''}">Reiseziele</button></div>
  <div class="toolbar"><input class="searchbox route-search" value="${escapeHtml(state.query)}" placeholder="Urlaub durchsuchen …"><button class="btn secondary" data-action="clear-search">Löschen</button></div>
  ${items.length?`<div class="place-list">${items.map(placeCard).join('')}</div>`:`<div class="empty">Keine passenden Einträge vorhanden.</div>`}<div class="footer-brand">powered by viacruz</div></section>`;
}

function normalizeSearchText(value=''){
  return String(value||'').toLowerCase().replace(/ß/g,'ss').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function searchTokens(value=''){return normalizeSearchText(value).split(' ').filter(Boolean);}
function safeHolidayDetails(e){return e?.details?.[e.type]||{};}
function entryRatingAverage(e){
  if(e.type==='camping')return personalRatingAverage(e.details?.camping?.personal||{});
  if(e.type==='stellplatz')return personalRatingAverage(e.details?.stellplatz?.personal||{});
  if(['hotel','ferienwohnung','ferienhaus','ferien','besonders','reiseziel'].includes(e.type))return holidayPersonalRatingAverage(safeHolidayDetails(e).personal||{});
  return null;
}
function entryStars(e){
  if(e.type!=='hotel')return null;
  const value=safeHolidayDetails(e).accommodation?.hotelStars;
  return value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;
}
function collectSearchStrings(value,out,path='',depth=0){
  if(depth>7||value===null||value===undefined)return;
  if(typeof value==='string'){
    const key=path.split('.').pop()||'';
    if(!['id','entryId','titleImageId','createdAt','updatedAt','deletedAt','dataUrl'].includes(key)&&!/^https?:/i.test(value))out.push(value);
    return;
  }
  if(Array.isArray(value)){value.forEach((item,i)=>collectSearchStrings(item,out,`${path}.${i}`,depth+1));return;}
  if(typeof value==='object')Object.entries(value).forEach(([key,item])=>collectSearchStrings(item,out,path?`${path}.${key}`:key,depth+1));
}
function truthyFeature(value){return value===true||value==='yes'||value==='available'||value==='included'||value==='free'||value==='paid';}
function featureSearchLabels(e){
  const labels=[];
  const add=(condition,...values)=>{if(condition)values.forEach(v=>v&&!labels.includes(v)&&labels.push(v));};
  const camp=e.details?.camping||{};
  const stell=e.details?.stellplatz||{};
  const holiday=safeHolidayDetails(e);
  const cbw=camp.leisure?.bathingWellness||{};
  const sbw=stell.leisure?.bathingWellness||{};
  const hl=holiday.leisure||{};
  add(cbw.outdoorPool==='yes'||cbw.indoorPool==='yes'||sbw.outdoorPool==='yes'||sbw.indoorPool==='yes'||hl.outdoorPool==='yes'||hl.indoorPool==='yes','Pool','Schwimmbad');
  add(cbw.outdoorPool==='yes'||sbw.outdoorPool==='yes'||hl.outdoorPool==='yes','Außenpool','Freibad');
  add(cbw.indoorPool==='yes'||sbw.indoorPool==='yes'||hl.indoorPool==='yes','Innenpool','Hallenbad');
  add(cbw.sauna==='yes'||sbw.sauna==='yes'||hl.sauna==='yes','Sauna');
  add(cbw.wellness==='yes'||sbw.wellness==='yes'||truthyFeature(hl.wellness),'Wellness','Spa');
  add(hl.whirlpool==='yes','Whirlpool');
  add(truthyFeature(hl.massage),'Massage','Anwendungen');
  add(truthyFeature(hl.bathingAccess)||cbw.swimmingAccess==='yes'||sbw.swimmingAccess==='yes','Baden','Bademöglichkeit');
  add(truthyFeature(hl.privateBeach)||cbw.beach==='yes'||sbw.beach==='yes','Strand');
  add(truthyFeature(hl.fitness)||stell.leisure?.sport?.fitness==='yes'||camp.leisure?.sport?.fitness==='yes','Fitness');
  add(truthyFeature(hl.bikeRental)||truthyFeature(hl.eBikeRental)||stell.leisure?.sport?.bikeRental==='yes'||camp.leisure?.sport?.bikeRental==='yes','Fahrrad','Radfahren','Fahrradverleih');
  add((camp.dog?.allowed==='yes')||(stell.dog?.allowed==='yes')||(holiday.dog?.allowed==='yes'),'Hund','Hunde erlaubt','Hundefreundlich');
  const facilities=[camp.facilities||{},stell.facilities||{},holiday.accommodation||{}];
  const hasKey=(keys)=>facilities.some(obj=>keys.some(k=>truthyFeature(obj?.[k])))||keys.some(k=>truthyFeature(holiday.accommodation?.[k]));
  add(hasKey(['wifi','wlan']),'WLAN','WiFi','Internet');
  add(hasKey(['washingMachine','washer']),'Waschmaschine');
  add(hasKey(['dryer']),'Trockner');
  add(hasKey(['dishwasher']),'Geschirrspüler');
  add(hasKey(['kitchen'])||holiday.accommodation?.kitchen==='yes','Küche');
  if(e.type==='reiseziel'){
    const d=holiday.destination||{};
    (d.categories||[]).map(v=>holidayDestinationChoiceLabel(v,'category')).filter(Boolean).forEach(v=>add(true,v));
    (d.characters||[]).map(v=>holidayDestinationChoiceLabel(v,'character')).filter(Boolean).forEach(v=>add(true,v));
    add(!!HOLIDAY_DESTINATION_SCOPE_LABELS[d.scope],HOLIDAY_DESTINATION_SCOPE_LABELS[d.scope]);
    (holiday.highlights?.activities||[]).map(holidayDestinationActivityLabel).filter(Boolean).forEach(v=>add(true,v));
  }
  return labels;
}
function buildSearchDocument(e){
  const generic=[]; collectSearchStrings(e,generic);
  const type=typeLabels[e.type]||e.type||'';
  const location=[e.country,e.region,...(e.travelRegions||[]),e.town].filter(Boolean);
  const features=featureSearchLabels(e);
  const stars=entryStars(e);
  const rating=entryRatingAverage(e);
  const starText=stars!=null?[`${formatNumber(stars,1)} Sterne`,`${Math.round(stars)} Sterne`]:[];
  const ratingText=rating!=null?[`${formatNumber(rating,1)} Bewertung`,`${formatNumber(rating,1)} von 5`]:[];
  const groups={name:[e.name||''],type:[type,e.type||''],location,features,stars:starText,rating:ratingText,generic};
  const normalized={}; Object.entries(groups).forEach(([key,vals])=>normalized[key]=normalizeSearchText(vals.join(' ')));
  const fullText=Object.values(normalized).join(' ');
  return {groups,normalized,fullText,features,stars,rating};
}
function smartSearchMatch(e,q){
  const terms=searchTokens(q); const doc=buildSearchDocument(e);
  if(!terms.length)return {match:true,score:0,reasons:[],doc};
  if(!terms.every(term=>doc.fullText.includes(term)))return {match:false,score:0,reasons:[],doc};
  let score=0;
  const weights={name:12,type:9,location:7,features:6,stars:4,rating:3,generic:1};
  terms.forEach(term=>Object.entries(doc.normalized).forEach(([key,text])=>{if(text.includes(term))score+=weights[key]||1;}));
  const phrase=normalizeSearchText(q);
  if(phrase&&doc.normalized.name.includes(phrase))score+=25;
  else if(phrase&&doc.fullText.includes(phrase))score+=5;
  const reasons=[];
  const addReason=v=>{if(v&&!reasons.includes(v)&&reasons.length<4)reasons.push(v);};
  if(terms.some(t=>doc.normalized.type.includes(t)))addReason(typeLabels[e.type]||e.type);
  doc.groups.location.forEach(v=>{const n=normalizeSearchText(v);if(terms.some(t=>n.includes(t)))addReason(v);});
  doc.features.forEach(v=>{const n=normalizeSearchText(v);if(terms.some(t=>n.includes(t)))addReason(v);});
  if(doc.stars!=null&&terms.some(t=>doc.normalized.stars.includes(t)))addReason(`${formatNumber(doc.stars,1)} Sterne`);
  return {match:true,score,reasons,doc};
}
function searchResultCard(result){
  const e=result.entry;
  const titleMedia=imageById(e,e.titleImageId);
  const thumb=titleMedia?.dataUrl?`<img src="${titleMedia.dataUrl}" alt="" />`:`${typeIcons[e.type]||'●'}`;
  const meta=[];
  if(result.doc.stars!=null)meta.push(`${formatNumber(result.doc.stars,1)} ★`);
  if(result.doc.rating!=null)meta.push(`Bewertung ${formatNumber(result.doc.rating,1)} / 5`);
  const reasonBadges=result.reasons.map(v=>`<span class="search-match-badge">${escapeHtml(v)}</span>`).join('');
  return `<button class="place-card search-result-card" data-detail="${e.id}">
    <div class="place-thumb ${titleMedia?.dataUrl?'has-image':''}">${thumb}</div>
    <div class="place-main"><strong>${escapeHtml(e.name)}</strong><span>${escapeHtml(locationText(e))}</span>
      <div class="badge-row"><span class="badge">${escapeHtml(typeLabels[e.type]||e.type)}</span>${meta.map(v=>`<span class="badge">${escapeHtml(v)}</span>`).join('')}${e.favorite?'<span class="badge">★ Favorit</span>':''}${e.wantToVisit?'<span class="badge">Möchte ich besuchen</span>':''}${e.visited?'<span class="badge">✓ Besucht</span>':''}</div>
      ${reasonBadges?`<div class="search-match-row"><small>Passt zu deiner Suche:</small>${reasonBadges}</div>`:''}
    </div><div class="chev">›</div>
  </button>`;
}
function searchView(){
  const results=state.entries.filter(e=>!e.deleted).map(entry=>({entry,...smartSearchMatch(entry,state.query)})).filter(r=>r.match);
  if(state.searchSort==='rating')results.sort((a,b)=>(b.doc.rating??-1)-(a.doc.rating??-1)||(a.entry.name||'').localeCompare(b.entry.name||'','de'));
  else if(state.searchSort==='name')results.sort((a,b)=>(a.entry.name||'').localeCompare(b.entry.name||'','de'));
  else if(state.query.trim())results.sort((a,b)=>b.score-a.score||(a.entry.name||'').localeCompare(b.entry.name||'','de'));
  const countLabel=`${results.length} ${results.length===1?'Treffer':'Treffer'}`;
  return `<section><div class="section-head"><div><div class="eyebrow">Alle Einträge</div><h2>Suche</h2><p>Mehrere Wörter werden kombiniert. Beispiel: Campingplatz Bayern Wellness.</p></div></div>
  <div class="toolbar search-toolbar"><input class="searchbox route-search" value="${escapeHtml(state.query)}" placeholder="z. B. Campingplatz Bayern Wellness …"><button class="btn secondary" data-action="clear-search">Zurücksetzen</button></div>
  <div class="search-result-head"><strong>${countLabel}</strong><label>Sortierung<select id="searchSort"><option value="relevance" ${state.searchSort==='relevance'?'selected':''}>Relevanz</option><option value="rating" ${state.searchSort==='rating'?'selected':''}>Bewertung</option><option value="name" ${state.searchSort==='name'?'selected':''}>Name</option></select></label></div>
  ${results.length?`<div class="place-list">${results.map(searchResultCard).join('')}</div>`:`<div class="empty">${state.query?'Keine Treffer. Prüfe die Schreibweise oder verwende weniger Suchbegriffe.':'Noch keine Orte gespeichert.'}</div>`}
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
    <div class="setting-card"><h3>viacruz Reisezeit</h3><p>Version 0.3.47 · Datenformat 1</p></div>
  </div><div class="footer-brand">powered by viacruz</div></section>`;
}

function wireViewEvents(){
  document.querySelectorAll('[data-route-go]').forEach(b=>b.onclick=()=>{state.route=b.dataset.routeGo;state.query='';render();});
  document.querySelectorAll('[data-action="new"]').forEach(b=>b.onclick=()=>{
    if(state.route==='urlaub' && !b.dataset.pretype) openHolidayEditor();
    else openEntryDialog(b.dataset.pretype);
  });
  document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openDetail(b.dataset.detail));
  document.querySelectorAll('.route-search').forEach(i=>i.oninput=()=>{state.query=i.value;render(); const next=document.querySelector('.route-search'); if(next){next.focus();next.setSelectionRange(next.value.length,next.value.length)}});
  document.querySelectorAll('[data-action="clear-search"]').forEach(b=>b.onclick=()=>{state.query='';render();});
  document.getElementById('searchSort')?.addEventListener('change',ev=>{state.searchSort=ev.target.value||'relevance';render();});
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
    season:c.season?{operationType:c.season.operationType||'unknown',openFrom:c.season.openFrom||'',openTo:c.season.openTo||'',arrival24h:'unknown',accessFrom:'',accessTo:'',maxStayValue:null,maxStayUnit:'',reservation:c.season.reservation||'unknown',spontaneousArrival:c.season.spontaneousArrival||'unknown',notes:c.season.notes||''}:{},
    pitch:{
      type:p.type||'unknown',vehicleTypes:[],area:p.area??null,length:p.length??null,width:p.width??null,largeMotorhome:p.largeMotorhome||'unknown',surface:[...(p.surface||[])],level:p.level||'unknown',shade:p.shade||'unknown',locationFeatures:[...(p.locationFeatures||[])],
      electricity:p.electricity||'unknown',electricityBilling:p.electricityBilling||'unknown',electricityPrice:p.electricityPrice??null,electricityKwhPrice:p.electricityKwhPrice??null,
      freshWater:p.freshWater||'unknown',wasteWater:p.wasteWater||'unknown',tv:p.tv||'unknown',wifi:p.wifi||'unknown',wifiBilling:p.wifiBilling||'unknown',wifiPrice:p.wifiPrice??null,
      access:p.access||'unknown',maxVehicleLength:p.maxVehicleLength??null,maxVehicleHeight:p.maxVehicleHeight??null,maxVehicleWeight:p.maxVehicleWeight??null,preferredNumber:p.preferredNumber||'',notes:p.notes||''
    },
    facilities:{
      wc:f.wc||'unknown',showers:f.showers||'unknown',washer:f.washer||'unknown',dryer:f.dryer||'unknown',freshWater:f.freshWaterPoint||'unknown',greyWater:f.greyWater||'unknown',
      chemicalToilet:f.chemicalToilet||'unknown',floorInlet:f.floorDrain||'unknown',garbage:f.wasteDisposal||'unknown',wasteSeparation:f.wasteSeparation||'unknown'
    },
    location:c.location?structuredClone(c.location):{},
    dog:c.dog?structuredClone(c.dog):{},
    prices:c.prices?{year:c.prices.year??null,feeStatus:c.prices.base!=null?'paid':'unknown',billing:c.prices.base!=null?'night':'unknown',amount:c.prices.base??null,seasonPrices:[],touristTax:c.prices.touristTax??null,touristTaxBilling:c.prices.touristTax!=null?'personNight':'unknown',reservationFee:c.prices.reservationFee??null,otherLabel:c.prices.otherLabel||'',otherAmount:c.prices.otherAmount??null,included:c.prices.included||'',notes:c.prices.notes||''}:{},
    personal:c.personal?structuredClone(c.personal):{},
    leisure:c.leisure?structuredClone(c.leisure):{},
    usage:{}
  };
}
function compatibleStellplatzToCamping(stellplatz){
  const s=stellplatz||{}, p=s.pitch||{}, f=s.facilities||{};
  return {
    season:s.season?{operationType:s.season.operationType||'unknown',openFrom:s.season.openFrom||'',openTo:s.season.openTo||'',summerCamping:'unknown',winterCamping:'unknown',minStay:null,reservation:s.season.reservation||'unknown',spontaneousArrival:s.season.spontaneousArrival||'unknown',arrivalFrom:'',arrivalTo:'',departureFrom:'',departureTo:'',notes:s.season.notes||''}:{},
    pitch:{...structuredClone(p)},
    facilities:{...structuredClone(f)},
    location:s.location?structuredClone(s.location):{},
    dog:s.dog?structuredClone(s.dog):{},
    prices:s.prices?{year:s.prices.year??null,base:(s.prices.feeStatus==='paid'&&s.prices.billing==='night')?s.prices.amount??null:null,touristTax:s.prices.touristTaxBilling==='personNight'?s.prices.touristTax??null:null,reservationFee:s.prices.reservationFee??null,otherLabel:s.prices.otherLabel||'',otherAmount:s.prices.otherAmount??null,included:s.prices.included||'',notes:s.prices.notes||''}:{},
    leisure:s.leisure?structuredClone(s.leisure):{},personal:s.personal?structuredClone(s.personal):{}
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
    detailRow('WLAN-Preis',pitch.wifi==='yes'&&pitch.wifiBilling==='paid'&&pitch.wifiPrice!=null?`${formatNumber(pitch.wifiPrice)} €`:''),
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
  e.details.stellplatz.personal=e.details.stellplatz.personal||{};
  e.details.stellplatz.usage=e.details.stellplatz.usage||{};
  e.details.stellplatz.season=e.details.stellplatz.season||{};
  e.details.stellplatz.pitch=e.details.stellplatz.pitch||{};
  e.details.stellplatz.facilities=e.details.stellplatz.facilities||{};
  e.details.stellplatz.location=e.details.stellplatz.location||{};
  e.details.stellplatz.leisure=e.details.stellplatz.leisure||{};
  e.details.stellplatz.dog=e.details.stellplatz.dog||{};
  return e.details.stellplatz;
}
function ensureStellplatzPrices(e){return ensureStellplatzDetails(e).prices;}
function ensureStellplatzPersonal(e){return ensureStellplatzDetails(e).personal;}
function ensureStellplatzUsage(e){return ensureStellplatzDetails(e).usage;}
function ensureStellplatzSeason(e){return ensureStellplatzDetails(e).season;}
function ensureStellplatzPitch(e){return ensureStellplatzDetails(e).pitch;}
function ensureStellplatzFacilities(e){return ensureStellplatzDetails(e).facilities;}
function ensureStellplatzLocation(e){return ensureStellplatzDetails(e).location;}
function ensureStellplatzLeisure(e){return ensureStellplatzDetails(e).leisure;}
function ensureStellplatzDog(e){return ensureStellplatzDetails(e).dog;}
function updateStellplatzDogConditionalFields(){const a=document.getElementById('stellplatzDogAllowed'),d=document.getElementById('stellplatzDogDetails');if(d)d.hidden=!a||a.value!=='yes';const f=document.getElementById('stellplatzDogFeeType'),w=document.getElementById('stellplatzDogFeeWrap');if(w)w.hidden=!f||f.value!=='paid';}

function updateStellplatzLeisureConditionalFields(){
  ['Restaurant','Snack','Bar','Cafe','BeerGarden','IceCream'].forEach(id=>{
    const status=document.getElementById('stellplatzLeisure'+id);
    const label=document.querySelector(`[data-stellplatz-leisure-season="${id}"]`);
    if(label){const active=status?.value==='yes';label.hidden=!active;const select=label.querySelector('select');if(select)select.disabled=!active;}
  });
  const beach=document.getElementById('stellplatzLeisureBeach');
  const wrap=document.getElementById('stellplatzBeachTypesWrap');
  if(wrap){const active=beach?.value==='yes';wrap.hidden=!active;wrap.querySelectorAll('input').forEach(el=>el.disabled=!active);}
}
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


function stellplatzUsageTypeLabel(v){return ({classic:'Klassischer Wohnmobilstellplatz',municipal:'Kommunaler Stellplatz',private:'Privater Stellplatz','farm-winery':'Bauernhof / Winzer',restaurant:'Restaurant / Gasthof',marina:'Marina / Hafen','thermal-pool':'Therme / Freizeitbad','at-campsite':'Stellplatz am Campingplatz','overnight-parking':'Parkplatz mit erlaubter Übernachtung',other:'Sonstiger Stellplatz'})[v]||v;}
function stellplatzPurposeLabel(v){return ({overnight:'Durchreise / Übernachtung',short:'Kurzaufenthalt','multi-day':'Mehrtägiger Aufenthalt'})[v]||v;}
function stellplatzPaymentLabel(v){return ({machine:'Automat',reception:'Rezeption',operator:'Betreiber / Platzwart','tourist-info':'Tourist-Information',restaurant:'Restaurant / Gasthof',app:'App',online:'Online',other:'Sonstige'})[v]||v;}
function stellplatzCheckInLabel(v){return ({operator:'Betreiber / Platzwart',reception:'Rezeption','tourist-info':'Tourist-Information',restaurant:'Restaurant / Gasthof','farm-winery':'Bauernhof / Winzer',online:'Online',app:'App',other:'Sonstige'})[v]||v;}
function stellplatzAccessLabel(v){return ({'ticket-barrier':'Schranke mit Ticket','plate-recognition':'Kennzeichenerkennung',pin:'PIN / Zugangscode','card-chip':'Zugangskarte / Chip',app:'App',other:'Sonstiges'})[v]||v;}
function updateStellplatzUsageConditionalFields(){
  const paid=document.getElementById('stellplatzFeeStatus')?.value==='paid';
  const paymentWrap=document.getElementById('stellplatzPaymentFields');
  if(paymentWrap){paymentWrap.hidden=!paid;paymentWrap.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=!paid);}
  const appSelected=paid && getCheckboxGroup('stellplatzPaymentMethods').includes('app');
  const appWrap=document.getElementById('stellplatzPaymentAppFields');
  if(appWrap){appWrap.hidden=!appSelected;appWrap.querySelectorAll('input').forEach(el=>el.disabled=!appSelected);}
  const checkIn=document.getElementById('stellplatzCheckInRequired')?.value==='yes';
  const checkWrap=document.getElementById('stellplatzCheckInFields');
  if(checkWrap){checkWrap.hidden=!checkIn;checkWrap.querySelectorAll('input').forEach(el=>el.disabled=!checkIn);}
  const access=document.getElementById('stellplatzAccessSystem')?.value==='yes';
  const accessWrap=document.getElementById('stellplatzAccessFields');
  if(accessWrap){accessWrap.hidden=!access;accessWrap.querySelectorAll('input,textarea').forEach(el=>el.disabled=!access);}
  const condition=document.getElementById('stellplatzConditionRequired')?.value==='yes';
  const conditionWrap=document.getElementById('stellplatzConditionFields');
  if(conditionWrap){conditionWrap.hidden=!condition;conditionWrap.querySelectorAll('textarea').forEach(el=>el.disabled=!condition);}
}

function updateStellplatzSeasonConditionalFields(){
  const seasonal=document.getElementById('stellplatzOperationType')?.value==='seasonal';
  const seasonDates=document.getElementById('stellplatzSeasonDates');
  if(seasonDates){seasonDates.hidden=!seasonal;seasonDates.querySelectorAll('input').forEach(el=>el.disabled=!seasonal);}
  const limited=document.getElementById('stellplatzArrival24h')?.value==='no';
  const accessTimes=document.getElementById('stellplatzAccessTimes');
  if(accessTimes){accessTimes.hidden=!limited;accessTimes.querySelectorAll('input').forEach(el=>el.disabled=!limited);}
}
function stellplatzMaxStayText(season){
  if(season?.maxStayValue==null || !season?.maxStayUnit) return '';
  const v=formatNumber(season.maxStayValue);
  if(season.maxStayUnit==='hours') return `${v} ${Number(season.maxStayValue)===1?'Stunde':'Stunden'}`;
  if(season.maxStayUnit==='days') return `${v} ${Number(season.maxStayValue)===1?'Tag':'Tage'}`;
  return v;
}

function renderStellplatzVisitEditor(visits=[]){
  const list=document.getElementById('stellplatzVisitList'); if(!list)return;
  const normalized=Array.isArray(visits)?visits:[];
  list.innerHTML=normalized.length?normalized.map(v=>`
    <div class="visit-editor-card" data-visit-id="${escapeHtml(v.id||uid())}">
      <div class="visit-card-head"><strong>Aufenthalt</strong><button type="button" class="visit-remove" aria-label="Besuch entfernen">Entfernen</button></div>
      <div class="grid-2">
        <label>Anreise<input class="visit-arrival" type="date" value="${escapeHtml(v.arrival||'')}" /></label>
        <label>Abreise<input class="visit-departure" type="date" value="${escapeHtml(v.departure||'')}" /></label>
      </div>
      <label>Stellplatz / Parzellennummer<input class="visit-pitch" type="text" value="${escapeHtml(v.pitch||'')}" placeholder="z. B. 12" /></label>
      <label>Persönliche Besuchsnotiz<textarea class="visit-note" rows="3" placeholder="Was war bei diesem Aufenthalt besonders?">${escapeHtml(v.note||'')}</textarea></label>
    </div>`).join(''):'<div class="visit-editor-empty">Noch kein Aufenthalt gespeichert.</div>';
  list.querySelectorAll('.visit-remove').forEach(btn=>btn.onclick=()=>{btn.closest('.visit-editor-card')?.remove();if(!list.querySelector('.visit-editor-card'))list.innerHTML='<div class="visit-editor-empty">Noch kein Aufenthalt gespeichert.</div>';});
}
function collectStellplatzVisits(){
  return [...document.querySelectorAll('#stellplatzVisitList .visit-editor-card')].map(card=>({
    id:card.dataset.visitId||uid(),arrival:card.querySelector('.visit-arrival')?.value||'',departure:card.querySelector('.visit-departure')?.value||'',pitch:card.querySelector('.visit-pitch')?.value.trim()||'',note:card.querySelector('.visit-note')?.value.trim()||'',createdAt:new Date().toISOString()
  })).filter(v=>v.arrival||v.departure||v.pitch||v.note);
}
function addStellplatzVisitEditor(){
  const current=collectStellplatzVisits();
  current.push({id:uid(),arrival:'',departure:'',pitch:'',note:'',createdAt:new Date().toISOString()});
  renderStellplatzVisitEditor(current);
  document.querySelector('#stellplatzVisitList .visit-editor-card:last-child')?.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function updateStellplatzPitchConditionalFields(){
  const electricity=document.getElementById('stellplatzPitchElectricity')?.value==='yes';
  const eWrap=document.getElementById('stellplatzPitchElectricityDetails');
  if(eWrap){eWrap.classList.toggle('is-disabled',!electricity);eWrap.querySelectorAll('input,select').forEach(el=>el.disabled=!electricity);}

  const billing=document.getElementById('stellplatzPitchElectricityBilling')?.value||'unknown';
  const flatField=document.getElementById('stellplatzPitchElectricityFlatPriceField');
  const kwhField=document.getElementById('stellplatzPitchElectricityKwhPriceField');
  const flatInput=document.getElementById('stellplatzPitchElectricityPrice');
  const kwhInput=document.getElementById('stellplatzPitchElectricityKwhPrice');
  const showFlat=electricity&&billing==='flat';
  const showKwh=electricity&&billing==='consumption';
  if(flatField) flatField.hidden=!showFlat;
  if(kwhField) kwhField.hidden=!showKwh;
  if(flatInput) flatInput.disabled=!showFlat;
  if(kwhInput) kwhInput.disabled=!showKwh;

  const wifi=document.getElementById('stellplatzPitchWifi')?.value==='yes';
  const wWrap=document.getElementById('stellplatzPitchWifiDetails');
  if(wWrap){wWrap.classList.toggle('is-disabled',!wifi);wWrap.querySelectorAll('input,select').forEach(el=>el.disabled=!wifi);}
  const wifiBilling=document.getElementById('stellplatzPitchWifiBilling')?.value||'unknown';
  const wifiPriceField=document.getElementById('stellplatzPitchWifiPriceField');
  const wifiPriceInput=document.getElementById('stellplatzPitchWifiPrice');
  const showWifiPrice=wifi&&wifiBilling==='paid';
  if(wifiPriceField) wifiPriceField.hidden=!showWifiPrice;
  if(wifiPriceInput) wifiPriceInput.disabled=!showWifiPrice;
}
function stellplatzVehicleLabel(v){return ({motorhome:'Wohnmobil',caravan:'Wohnwagen / Gespann',campervan:'Campervan','panel-van':'Kastenwagen'})[v]||v;}
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
  const personal=e.details?.stellplatz?.personal||{};
  const statusText=e.visited?'Besucht':e.wantToVisit?'Möchte ich besuchen':'';
  const favoriteText=e.favorite?'★ Favorit':'';
  const returnText=valueLabel(personal.returnIntent,{unknown:'',yes:'Ja',maybe:'Vielleicht',no:'Nein'},'');
  const ratingLabels=[['Gesamt',personal.ratings?.overall],['Lage',personal.ratings?.location],['Ruhe',personal.ratings?.quiet],['Sauberkeit',personal.ratings?.cleanliness],['Sanitär',personal.ratings?.sanitary],['Preis-Leistung',personal.ratings?.value]];
  const ratingRows=ratingLabels.map(([label,val])=>detailRow(label,val!=null?`${formatNumber(val,1)} / 5`:'' )).filter(Boolean).join('');
  const visits=Array.isArray(e.visits)?e.visits:[];
  const visitRows=visits.length?`<div class="visit-history">${visits.map((v,index)=>{const nights=visitNights(v.arrival,v.departure);const dateText=(v.arrival||v.departure)?`${formatDate(v.arrival)||'–'} bis ${formatDate(v.departure)||'–'}`:'Datum nicht angegeben';const meta=[nights!=null?`${nights} ${nights===1?'Nacht':'Nächte'}`:'',v.pitch?`Platz ${v.pitch}`:''].filter(Boolean).join(' · ');return `<div class="visit-history-card"><div class="visit-history-head"><strong>Aufenthalt ${index+1}</strong><span>${escapeHtml(dateText)}</span></div>${meta?`<small>${escapeHtml(meta)}</small>`:''}${v.note?`<p>${escapeHtml(v.note).replace(/\n/g,'<br>')}</p>`:''}</div>`;}).join('')}</div>`:'';
  const personalRows=[detailRow('Status',[statusText,favoriteText].filter(Boolean).join(' · ')),e.why?`<div class="detail-note"><span>Warum gespeichert?</span><p>${escapeHtml(e.why).replace(/\n/g,'<br>')}</p></div>`:'',ratingRows,detailRow('Würde ich wiederkommen?',returnText),visits.length?`<div class="detail-note"><span>Besuchshistorie</span>${visitRows}</div>`:'',e.notes?`<div class="detail-note"><span>Persönliche Notizen</span><p>${escapeHtml(e.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
  const ratingAverage=personalRatingAverage(personal);
  const personalSummary=[statusText,favoriteText,ratingAverage!=null?`${formatNumber(ratingAverage,1)} / 5`:'',visits.length?`${visits.length} ${visits.length===1?'Besuch':'Besuche'}`:''].filter(Boolean).slice(0,3).join(' · ')||'Persönlich';
  const usage=e.details?.stellplatz?.usage||{};
  const usageTypeText=(usage.types||[]).map(stellplatzUsageTypeLabel).join(', ');
  const purposeText=(usage.purposes||[]).map(stellplatzPurposeLabel).join(', ');
  const paymentText=p.feeStatus==='paid'?(usage.paymentMethods||[]).map(stellplatzPaymentLabel).join(', '):'';
  const paymentApp=paymentText&&usage.paymentMethods?.includes('app')&&usage.paymentAppName?`App: ${usage.paymentAppName}`:'';
  const checkInText=valueLabel(usage.checkInRequired,{unknown:'',yes:'Ja',no:'Nein'},'');
  const checkInAt=(usage.checkInAt||[]).map(stellplatzCheckInLabel).join(', ');
  const accessText=valueLabel(usage.accessSystem,{unknown:'',yes:'Vorhanden',no:'Nicht vorhanden'},'');
  const accessMethods=(usage.accessMethods||[]).map(stellplatzAccessLabel).join(', ');
  const conditionText=valueLabel(usage.conditionRequired,{unknown:'',yes:'Ja',no:'Nein'},'');
  const usageRows=[detailRow('Art des Stellplatzes',usageTypeText),detailRow('Geeignet für',purposeText),detailRow('Bezahlung bei/über',paymentText),detailRow('Bezahl-App',paymentApp),detailRow('Anmeldung / Check-in erforderlich',checkInText),detailRow('Anmeldung bei',usage.checkInRequired==='yes'?checkInAt:''),detailRow('Schranke / Zugangssystem',accessText),detailRow('Art des Zugangssystems',usage.accessSystem==='yes'?accessMethods:''),usage.accessSystem==='yes'&&usage.accessNotes?`<div class="detail-note"><span>Hinweise zum Zugang</span><p>${escapeHtml(usage.accessNotes).replace(/\n/g,'<br>')}</p></div>`:'',detailRow('Nutzung an Bedingung geknüpft',conditionText),usage.conditionRequired==='yes'&&usage.conditionText?`<div class="detail-note"><span>Bedingung / Voraussetzung</span><p>${escapeHtml(usage.conditionText).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
  const usageSummary=[usageTypeText,purposeText,checkInText?`Check-in ${checkInText.toLowerCase()}`:''].filter(Boolean).slice(0,2).join(' · ')||'Stellplatz & Nutzung';
  const season=e.details?.stellplatz?.season||{};
  const operation=valueLabel(season.operationType,{unknown:'','year-round':'Ganzjährig',seasonal:'Saisonal'},'');
  const openPeriod=season.operationType==='seasonal'&&(season.openFrom||season.openTo)?`${formatDate(season.openFrom)||'–'} bis ${formatDate(season.openTo)||'–'}`:'';
  const arrival24h=valueLabel(season.arrival24h,{unknown:'',yes:'Ja',no:'Nein'},'');
  const accessPeriod=season.arrival24h==='no'&&(season.accessFrom||season.accessTo)?`${season.accessFrom||'–'} bis ${season.accessTo||'–'}`:'';
  const reservation=valueLabel(season.reservation,{unknown:'','not-needed':'Nicht erforderlich',possible:'Möglich',recommended:'Empfohlen',required:'Erforderlich'},'');
  const spontaneous=knownYesNo(season.spontaneousArrival,'Möglich','Nicht möglich');
  const stayRowsSp=[detailRow('Betriebsart',operation),detailRow('Geöffnet',openPeriod),detailRow('24-Stunden-Anreise möglich',arrival24h),detailRow('Zufahrt möglich',accessPeriod),detailRow('Maximale Aufenthaltsdauer',stellplatzMaxStayText(season)),detailRow('Reservierung',reservation),detailRow('Spontane Anreise',spontaneous),season.notes?`<div class="detail-note"><span>Hinweise Aufenthalt / Zufahrt</span><p>${escapeHtml(season.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
  const seasonSummary=[operation,arrival24h?`24h-Anreise ${arrival24h.toLowerCase()}`:'',stellplatzMaxStayText(season)].filter(Boolean).slice(0,2).join(' · ')||'Saison & Aufenthalt';
  const pitch=e.details?.stellplatz?.pitch||{};
  const surfaceLabels={grass:'Rasen',gravel:'Schotter',asphalt:'Asphalt',paving:'Pflaster',hardened:'Befestigt',natural:'Naturboden'};const locationFeatureLabels={waterfront:'Direkt am Wasser','water-view':'Wasserblick',quiet:'Ruhige Lage',central:'Zentrale Lage',terraced:'Terrassiert'};
  const pitchType=valueLabel(pitch.type,{unknown:'',parcel:'Parzellierte Stellplätze','free-choice':'Freie Platzwahl'},'');const vehicleTypes=(pitch.vehicleTypes||[]).map(stellplatzVehicleLabel).join(', ');const pitchSurface=(pitch.surface||[]).map(v=>surfaceLabels[v]).filter(Boolean).join(', ');const pitchLevel=valueLabel(pitch.level,{unknown:'',level:'Eben','partly-uneven':'Teilweise uneben'},'');const pitchShade=valueLabel(pitch.shade,{unknown:'',sunny:'Sonnig','partly-shaded':'Teilweise schattig',shaded:'Schattig'},'');const pitchFeatures=(pitch.locationFeatures||[]).map(v=>locationFeatureLabels[v]).filter(Boolean).join(', ');const electricity=knownYesNo(pitch.electricity,'Vorhanden','Nicht vorhanden');const electricityBilling=pitch.electricity==='yes'?valueLabel(pitch.electricityBilling,{unknown:'Preis unbekannt',included:'Inklusive',flat:'Pauschale',consumption:'Nach Verbrauch'},''):'';const wifi=knownYesNo(pitch.wifi,'Vorhanden','Nicht vorhanden');const wifiBilling=pitch.wifi==='yes'?valueLabel(pitch.wifiBilling,{unknown:'Preis unbekannt',included:'Inklusive',paid:'Kostenpflichtig'},''):'';const access=valueLabel(pitch.access,{unknown:'',easy:'Problemlos',narrow:'Eng',steep:'Steil',difficult:'Schwierig'},'');
  const pitchRows=[detailRow('Aufteilung der Stellflächen',pitchType),detailRow('Zugelassene Fahrzeugarten',vehicleTypes),detailRow('Fläche',pitch.area!=null?`${formatNumber(pitch.area)} m²`:''),detailRow('Länge',pitch.length!=null?`${formatNumber(pitch.length)} m`:''),detailRow('Breite',pitch.width!=null?`${formatNumber(pitch.width)} m`:''),detailRow('Große Wohnmobile',knownYesNo(pitch.largeMotorhome,'Geeignet','Nicht geeignet')),detailRow('Untergrund',pitchSurface),detailRow('Ebenheit',pitchLevel),detailRow('Sonne / Schatten',pitchShade),detailRow('Besondere Lage',pitchFeatures),detailRow('Strom direkt am Platz',electricity),detailRow('Strom-Abrechnung',electricityBilling),detailRow('Strompreis',pitch.electricity==='yes'&&pitch.electricityBilling==='flat'&&pitch.electricityPrice!=null?`${formatNumber(pitch.electricityPrice)} €`:''),detailRow('Strompreis pro kWh',pitch.electricity==='yes'&&pitch.electricityBilling==='consumption'&&pitch.electricityKwhPrice!=null?`${formatNumber(pitch.electricityKwhPrice)} €/kWh`:''),detailRow('Frischwasser direkt am Platz',knownYesNo(pitch.freshWater,'Vorhanden','Nicht vorhanden')),detailRow('Abwasser direkt am Platz',knownYesNo(pitch.wasteWater,'Vorhanden','Nicht vorhanden')),detailRow('TV-Anschluss',knownYesNo(pitch.tv,'Vorhanden','Nicht vorhanden')),detailRow('WLAN',wifi),detailRow('WLAN-Kosten',wifiBilling),detailRow('WLAN-Preis',pitch.wifi==='yes'&&pitch.wifiBilling==='paid'&&pitch.wifiPrice!=null?`${formatNumber(pitch.wifiPrice)} €`:''),detailRow('Zufahrt',access),detailRow('Max. Fahrzeuglänge',pitch.maxVehicleLength!=null?`${formatNumber(pitch.maxVehicleLength)} m`:''),detailRow('Max. Fahrzeughöhe',pitch.maxVehicleHeight!=null?`${formatNumber(pitch.maxVehicleHeight)} m`:''),detailRow('Gewichtslimit',pitch.maxVehicleWeight!=null?`${formatNumber(pitch.maxVehicleWeight)} t`:''),detailRow('Bevorzugter Stellplatz',pitch.preferredNumber),pitch.notes?`<div class="detail-note"><span>Hinweise zur Stellplatzwahl</span><p>${escapeHtml(pitch.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
  const pitchSummary=[pitchType,vehicleTypes,pitchSurface].filter(Boolean).slice(0,2).join(' · ')||'Stellplatz & Parzelle';
  const facilities=e.details?.stellplatz?.facilities||{};
  const facilityCostLabel=(state,price)=>{if(state==='included')return 'Inklusive';if(state==='paid')return price!=null?`Kostenpflichtig · ${formatNumber(price)} €`:'Kostenpflichtig';if(state==='unknown')return 'Preis unbekannt';return '';};
  const breadSeason=valueLabel(facilities.breadSeason,{unknown:'','year-round':'Ganzjährig',seasonal:'Saisonal'},'');
  const facilityRows=[detailRow('WC',knownYesNo(facilities.wc,'Vorhanden','Nicht vorhanden')),detailRow('Duschen',knownYesNo(facilities.showers,'Vorhanden','Nicht vorhanden')),facilities.showers==='yes'?detailRow('Duschen Kosten',facilityCostLabel(facilities.showerBilling,facilities.showerPrice)):'',detailRow('Einzelwaschkabinen',knownYesNo(facilities.washCubicles,'Vorhanden','Nicht vorhanden')),detailRow('Familienbad',knownYesNo(facilities.familyBath,'Vorhanden','Nicht vorhanden')),detailRow('Barrierefreies Sanitär',knownYesNo(facilities.accessibleSanitary,'Vorhanden','Nicht vorhanden')),detailRow('Baby-/Kinder-Sanitär',knownYesNo(facilities.childrenSanitary,'Vorhanden','Nicht vorhanden')),detailRow('Privatbad / Mietbad',knownYesNo(facilities.privateBath,'Vorhanden','Nicht vorhanden')),detailRow('Sanitär beheizt',knownYesNo(facilities.heatedSanitary,'Ja','Nein')),detailRow('Waschmaschine',knownYesNo(facilities.washer,'Vorhanden','Nicht vorhanden')),facilities.washer==='yes'?detailRow('Waschmaschine Kosten',facilityCostLabel(facilities.washerBilling,facilities.washerPrice)):'',detailRow('Trockner',knownYesNo(facilities.dryer,'Vorhanden','Nicht vorhanden')),facilities.dryer==='yes'?detailRow('Trockner Kosten',facilityCostLabel(facilities.dryerBilling,facilities.dryerPrice)):'',detailRow('Geschirrspülbereich',knownYesNo(facilities.dishwashing,'Vorhanden','Nicht vorhanden')),detailRow('Frischwasser-Entnahmestelle',knownYesNo(facilities.freshWaterPoint,'Vorhanden','Nicht vorhanden')),detailRow('Grauwasserentsorgung',knownYesNo(facilities.greyWater,'Vorhanden','Nicht vorhanden')),detailRow('Chemietoiletten-Entsorgung',knownYesNo(facilities.chemicalToilet,'Vorhanden','Nicht vorhanden')),detailRow('Bodeneinlass für Wohnmobile',knownYesNo(facilities.floorDrain,'Vorhanden','Nicht vorhanden')),detailRow('Müllentsorgung',knownYesNo(facilities.wasteDisposal,'Vorhanden','Nicht vorhanden')),detailRow('Mülltrennung',knownYesNo(facilities.wasteSeparation,'Ja','Nein')),detailRow('Shop / Laden',knownYesNo(facilities.shop,'Vorhanden','Nicht vorhanden')),detailRow('Brötchenservice',knownYesNo(facilities.breadService,'Vorhanden','Nicht vorhanden')),facilities.breadService==='yes'?detailRow('Brötchenservice verfügbar',breadSeason):'',detailRow('Camping-/Zubehörshop',knownYesNo(facilities.campingShop,'Vorhanden','Nicht vorhanden')),detailRow('Gasflaschentausch / Gasversorgung',knownYesNo(facilities.gasSupply,'Vorhanden','Nicht vorhanden')),detailRow('E-Bike-Lademöglichkeit',knownYesNo(facilities.ebikeCharging,'Vorhanden','Nicht vorhanden')),detailRow('E-Auto-Lademöglichkeit',knownYesNo(facilities.evCharging,'Vorhanden','Nicht vorhanden'))].filter(Boolean).join('');
  const facilitiesSummary=[facilities.wc==='yes'?'WC':'',facilities.showers==='yes'?'Duschen':'',facilities.freshWaterPoint==='yes'?'Frischwasser':''].filter(Boolean).join(' · ')||'Sanitär & Versorgung';
  const location=e.details?.stellplatz?.location||{};const locationLabels={sea:'Meer',lake:'See',river:'Fluss',mountains:'Berge',forest:'Wald',rural:'Ländlich',city:'Stadt','city-edge':'Stadtrand','beach-nearby':'Strandnähe',waterfront:'Direkt am Wasser','water-nearby':'Wasser in der Nähe','town-centre':'Direkt am Ortszentrum',remote:'Abgelegen'};const locationFeatures=(location.features||[]).map(v=>locationLabels[v]).filter(Boolean).join(', ');const ld=location.distances||{};const distanceText=item=>{if(!item)return '';const parts=[];if(item.km!=null)parts.push(`${formatNumber(item.km)} km`);if(item.walkable==='yes')parts.push('fußläufig');else if(item.walkable==='no')parts.push('nicht fußläufig');return parts.join(' · ');};const lm=location.mobility||{};const locationRows=[detailRow('Lage',locationFeatures),detailRow('Ortszentrum',distanceText(ld.centre)),detailRow('Supermarkt',distanceText(ld.supermarket)),detailRow('Restaurant',distanceText(ld.restaurant)),detailRow('Bäckerei',distanceText(ld.bakery)),detailRow('Strand / See',distanceText(ld.water)),detailRow('Sehenswürdigkeiten',distanceText(ld.sights)),detailRow('Entfernung zur Autobahn',location.motorwayDistance!=null?`${formatNumber(location.motorwayDistance)} km`:''),detailRow('Autobahn / Anschlussstelle',location.motorwayJunction),detailRow('ÖPNV',knownYesNo(lm.publicTransport,'Vorhanden','Nicht vorhanden')),detailRow('Bushaltestelle',knownYesNo(lm.bus,'Vorhanden','Nicht vorhanden')),detailRow('Bahnhof',knownYesNo(lm.train,'Vorhanden','Nicht vorhanden')),detailRow('Radwege',knownYesNo(lm.cycle,'Vorhanden','Nicht vorhanden')),detailRow('Wanderwege',knownYesNo(lm.hiking,'Vorhanden','Nicht vorhanden')),detailRow('Seilbahn',knownYesNo(lm.cableCar,'Vorhanden','Nicht vorhanden')),detailRow('Fähranleger / Hafen',knownYesNo(lm.ferry,'Vorhanden','Nicht vorhanden')),location.notes?`<div class="detail-note"><span>Ausflugsziele / Hinweise zur Umgebung</span><p>${escapeHtml(location.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');const locationSummary=[locationFeatures,location.motorwayDistance!=null?`${formatNumber(location.motorwayDistance)} km zur Autobahn`:''].filter(Boolean).slice(0,2).join(' · ')||'Lage & Umgebung';
  const leisure=e.details?.stellplatz?.leisure||{}, gastro=leisure.gastronomy||{}, bw=leisure.bathingWellness||{}, sport=leisure.sport||{};
  const gastroStatus=(key,label)=>gastro[key]?.status==='yes'?`${label}${gastro[key]?.season==='year-round'?' · ganzjährig':gastro[key]?.season==='seasonal'?' · saisonal':''}`:gastro[key]?.status==='no'?`${label} nicht vorhanden`:'';
  const beachTypes=(bw.beachTypes||[]).map(v=>({sand:'Sandstrand',pebble:'Kiesstrand',rock:'Felsstrand',lawn:'Liegewiese'})[v]).filter(Boolean).join(', ');
  const leisureRows=[detailRow('Restaurant',gastroStatus('restaurant','Vorhanden')),detailRow('Imbiss',gastroStatus('snack','Vorhanden')),detailRow('Bar',gastroStatus('bar','Vorhanden')),detailRow('Café',gastroStatus('cafe','Vorhanden')),detailRow('Biergarten',gastroStatus('beerGarden','Vorhanden')),detailRow('Eisdiele',gastroStatus('iceCream','Vorhanden')),detailRow('Schwimmbad / Freibad',knownYesNo(bw.outdoorPool,'Vorhanden','Nicht vorhanden')),detailRow('Hallenbad',knownYesNo(bw.indoorPool,'Vorhanden','Nicht vorhanden')),detailRow('Sauna',knownYesNo(bw.sauna,'Vorhanden','Nicht vorhanden')),detailRow('Wellnessbereich',knownYesNo(bw.wellness,'Vorhanden','Nicht vorhanden')),detailRow('Direkte Bademöglichkeit',knownYesNo(bw.swimmingAccess,'Vorhanden','Nicht vorhanden')),detailRow('Strand',knownYesNo(bw.beach,'Vorhanden','Nicht vorhanden')),bw.beach==='yes'?detailRow('Strandart',beachTypes):'',detailRow('Spielplatz',knownYesNo(sport.playground,'Vorhanden','Nicht vorhanden')),detailRow('Tischtennis',knownYesNo(sport.tableTennis,'Vorhanden','Nicht vorhanden')),detailRow('Tennis',knownYesNo(sport.tennis,'Vorhanden','Nicht vorhanden')),detailRow('Minigolf',knownYesNo(sport.miniGolf,'Vorhanden','Nicht vorhanden')),detailRow('Fitness',knownYesNo(sport.fitness,'Vorhanden','Nicht vorhanden')),detailRow('Fahrradverleih',knownYesNo(sport.bikeRental,'Vorhanden','Nicht vorhanden')),detailRow('E-Bike-Verleih',knownYesNo(sport.eBikeRental,'Vorhanden','Nicht vorhanden')),detailRow('Wassersport',knownYesNo(sport.waterSports,'Vorhanden','Nicht vorhanden')),detailRow('Charakter',(leisure.character||[]).map(v=>({quiet:'Ruhig',lively:'Lebhaft',family:'Familienfreundlich',nature:'Naturnah',comfort:'Komfortorientiert',rustic:'Rustikal'})[v]).filter(Boolean).join(', ')),detailRow('Größe',({small:'Klein',medium:'Mittel',large:'Groß'})[leisure.size]||''),detailRow('Anzahl Stellplätze',leisure.pitchCount!=null?String(leisure.pitchCount):'')].filter(Boolean).join('');
  const leisureSummary=[gastro.restaurant?.status==='yes'?'Restaurant':'',bw.sauna==='yes'?'Sauna':'',bw.swimmingAccess==='yes'?'Baden':'',sport.playground==='yes'?'Spielplatz':'',...(leisure.character||[]).map(v=>({quiet:'Ruhig',lively:'Lebhaft',family:'Familienfreundlich',nature:'Naturnah',comfort:'Komfortorientiert',rustic:'Rustikal'})[v]).filter(Boolean)].filter(Boolean).slice(0,3).join(' · ')||'Freizeit & Gastronomie';
  const dog=e.details?.stellplatz?.dog||{};
  const dogFeeText=dog.feeType==='free'?'Kostenlos':dog.feeType==='paid'?(dog.fee!=null?`${formatNumber(dog.fee)} € / Hund / Nacht`:'Kostenpflichtig'):'';
  const dogRows=dog.allowed==='unknown'||!dog.allowed?'':[detailRow('Hunde erlaubt',dog.allowed==='yes'?'Ja':'Nein'),dog.allowed==='yes'?detailRow('Maximale Anzahl Hunde',dog.maxCount!=null?String(dog.maxCount):''):'',dog.allowed==='yes'?detailRow('Hundekosten',dogFeeText):'',dog.allowed==='yes'?detailRow('Leinenpflicht',knownYesNo(dog.leash,'Ja','Nein')):'',dog.allowed==='yes'?detailRow('Eingeschränkte Bereiche',knownYesNo(dog.restricted,'Ja','Nein')):'',dog.allowed==='yes'?detailRow('Hundeauslauf / Hundewiese',knownYesNo(dog.run,'Vorhanden','Nicht vorhanden')):'',dog.allowed==='yes'?detailRow('Hundestrand',knownYesNo(dog.beach,'Vorhanden','Nicht vorhanden')):'',dog.allowed==='yes'?detailRow('Bademöglichkeit für Hunde',knownYesNo(dog.swimming,'Vorhanden','Nicht vorhanden')):'',dog.allowed==='yes'?detailRow('Hundedusche',knownYesNo(dog.shower,'Vorhanden','Nicht vorhanden')):'',dog.allowed==='yes'?detailRow('Hunde im Restaurant erlaubt',knownYesNo(dog.restaurant,'Ja','Nein')):'',dog.allowed==='yes'&&dog.notes?`<div class="detail-note"><span>Hinweise für Hunde</span><p>${escapeHtml(dog.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
  const dogSummary=dog.allowed==='yes'?['Hunde erlaubt',dog.feeType==='free'?'kostenlos':'',dog.run==='yes'?'Hundewiese':''].filter(Boolean).join(' · '):dog.allowed==='no'?'Hunde nicht erlaubt':'Hund';
  return `<div class="detail-accordions">
    <details class="detail-accordion"><summary><span><small>Grunddaten</small><strong>${escapeHtml(basicSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${basicRows||'<div class="detail-empty">Noch keine weiteren Grunddaten gespeichert.</div>'}</div></details>
    <details class="detail-accordion"><summary><span><small>Preise & Gebühren</small><strong>${escapeHtml(priceSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${priceRows||'<div class="detail-empty">Noch keine Preise oder Gebühren gespeichert.</div>'}</div></details>
    <details class="detail-accordion"><summary><span><small>Persönlich</small><strong>${escapeHtml(personalSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${personalRows||'<div class="detail-empty">Noch keine persönlichen Angaben gespeichert.</div>'}</div></details>
    <details class="detail-accordion"><summary><span><small>Stellplatz & Nutzung</small><strong>${escapeHtml(usageSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${usageRows||'<div class="detail-empty">Noch keine Angaben zur Nutzung gespeichert.</div>'}</div></details>
    <details class="detail-accordion"><summary><span><small>Saison & Aufenthalt</small><strong>${escapeHtml(seasonSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${stayRowsSp||'<div class="detail-empty">Noch keine Angaben zu Saison oder Aufenthalt gespeichert.</div>'}</div></details>
    <details class="detail-accordion"><summary><span><small>Stellplatz & Parzelle</small><strong>${escapeHtml(pitchSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${pitchRows||'<div class="detail-empty">Noch keine Angaben zu Stellplatz und Parzelle gespeichert.</div>'}</div></details>
    <details class="detail-accordion"><summary><span><small>Sanitär & Versorgung</small><strong>${escapeHtml(facilitiesSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${facilityRows||'<div class="detail-empty">Noch keine Angaben zu Sanitär und Versorgung gespeichert.</div>'}</div></details>
    <details class="detail-accordion"><summary><span><small>Lage & Umgebung</small><strong>${escapeHtml(locationSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${locationRows||'<div class="detail-empty">Noch keine Angaben zu Lage und Umgebung gespeichert.</div>'}</div></details>
    <details class="detail-accordion"><summary><span><small>Freizeit & Gastronomie</small><strong>${escapeHtml(leisureSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${leisureRows||'<div class="detail-empty">Noch keine Angaben zu Freizeit und Gastronomie gespeichert.</div>'}</div></details>
    <details class="detail-accordion"><summary><span><small>Hund</small><strong>${escapeHtml(dogSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${dogRows||'<div class="detail-empty">Noch keine Angaben zu Hunden gespeichert.</div>'}</div></details>
  </div>`;
}
function reverseLinkedDestinationsCard(e){
  if(!isLinkableAccommodationType(e.type))return '';
  const linked=state.entries.filter(destination=>destination.type==='reiseziel'&&!destination.deleted).map(destination=>{
    const links=destination.details?.reiseziel?.links?.accommodations;
    const link=Array.isArray(links)?links.find(item=>item?.entryId===e.id):null;
    return link?{destination,link}:null;
  }).filter(Boolean);
  if(!linked.length)return '';
  const cards=linked.map(({destination,link})=>{
    const media=imageById(destination,destination.titleImageId);
    const thumb=media?.dataUrl?`<img src="${media.dataUrl}" alt="${escapeHtml(media.description||destination.name||'Reiseziel')}" />`:`<span class="linked-entry-placeholder">${escapeHtml(typeIcons[destination.type]||'◎')}</span>`;
    return `<div class="linked-entry-detail"><button type="button" class="linked-entry-open" data-open-entry-id="${escapeHtml(destination.id)}"><span class="linked-entry-image">${thumb}</span><span class="linked-entry-copy"><strong>${escapeHtml(destination.name||'Ohne Namen')}</strong><small>${escapeHtml(typeLabels[destination.type]||destination.type)}${linkedEntryLocation(destination)?` · ${escapeHtml(linkedEntryLocation(destination))}`:''}</small></span><span class="linked-entry-arrow">›</span></button>${link.note?`<p>${escapeHtml(link.note).replace(/\n/g,'<br>')}</p>`:''}</div>`;
  }).join('');
  const summary=`${linked.length} ${linked.length===1?'Reiseziel':'Reiseziele'} verknüpft`;
  return `<div class="detail-accordions linked-destinations-accordions"><details class="detail-accordion"><summary><span><small>Verknüpfte Reiseziele</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${cards}</div></details></div>`;
}
function entryTypeDetailCards(e){
  let html='';
  if(e.type==='camping') html=campingDetailCards(e);
  else if(e.type==='stellplatz') html=stellplatzDetailCards(e);
  else if(isHolidayType(e.type)) html=holidayDetailCards(e);
  else html=`<div class="info-card"><small>Technisches Fundament</small><strong>Gemeinsame ID · zentrale Standortfelder · Besuchshistorie · Medienliste · typbezogene Details</strong></div>`;
  return html+reverseLinkedDestinationsCard(e);
}


function isHolidayType(type){
  return ['hotel','ferienwohnung','ferienhaus','ferien','besonders','reiseziel'].includes(type);
}
function isAccommodationHolidayType(type){
  return ['hotel','ferienwohnung','ferienhaus','ferien','besonders'].includes(type);
}
function holidayDetailCards(e){
  const regions=(e.travelRegions||[]).join(', ');
  const phone=e.phone ? `<a class="contact-link" href="${escapeHtml(phoneHref(e.phone))}">${escapeHtml(e.phone)}</a>` : '';
  const email=e.email ? `<a class="contact-link" href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>` : '';
  const srcLabel=sourceLabel(e);
  const srcUrl=sourceUrl(e);
  const source=srcLabel || srcUrl ? `${escapeHtml(srcLabel||'Internet')}${srcUrl?` <a class="inline-link" href="${escapeHtml(srcUrl)}" target="_blank" rel="noopener noreferrer">öffnen ↗</a>`:''}` : '';
  const websiteUrl=normalizeExternalUrl(e.website);
  const website=e.website ? (websiteUrl?`<a class="inline-link" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.website)} ↗</a>`:escapeHtml(e.website)) : '';
  const bookingUrl=normalizeExternalUrl(e.bookingUrl);
  const booking=e.bookingUrl ? (bookingUrl?`<a class="inline-link" href="${escapeHtml(bookingUrl)}" target="_blank" rel="noopener noreferrer">Buchungsseite öffnen ↗</a>`:escapeHtml(e.bookingUrl)) : '';
  const basicRows=[
    detailRow('Art des Eintrags',typeLabels[e.type]||e.type),
    detailRow('Land',e.country),
    detailRow('Region/Bundesland',e.region),
    detailRow('Gebiet/Reiseregion',regions),
    detailRow('Ort',e.town),
    detailRow('Adresse',e.address),
    detailRow('Website',website,true),
    detailRow('Telefon',phone,true),
    detailRow('E-Mail',email,true),
    detailRow('Quelle',source,true),
    isAccommodationHolidayType(e.type)?detailRow('Buchungsseite',booking,true):''
  ].filter(Boolean).join('');
  const basicSummary=[e.town||e.region||e.country,regions].filter(Boolean).slice(0,2).join(' · ') || 'Grunddaten';
  let accommodationCard='';
  if(isAccommodationHolidayType(e.type)){
    const a=ensureHolidayAccommodation(e);
    const yes=[]; [['Klimaanlage',a.aircon],['Heizung',a.heating],['Balkon',a.balcony],['Terrasse',a.terrace],['Garten / Gartenmitbenutzung',a.garden],['Aufzug',a.elevator],['Barrierefrei',a.accessible],['Waschmaschine',a.washer],['Trockner',a.dryer]].forEach(([l,v])=>{if(v)yes.push(l)});
    const wifi=a.wifi==='yes'?(a.wifiBilling==='included'?'Vorhanden · inklusive':a.wifiBilling==='paid'?(a.wifiPrice!=null?`Vorhanden · ${formatNumber(a.wifiPrice)} €`:'Vorhanden · kostenpflichtig'):'Vorhanden'):a.wifi==='no'?'Nicht vorhanden':'';
    const bath=holidayAccommodationLabel(a.bathroomType,{private:'Eigenes Bad',shared:'Gemeinschaftsbad'});
    const room=holidayAccommodationLabel(a.roomType,{single:'Einzelzimmer',double:'Doppelzimmer',family:'Familienzimmer',suite:'Suite',apartment:'Apartment',other:'Sonstiges'});
    const house=holidayAccommodationLabel(a.houseType,{detached:'Freistehend',semi:'Doppelhaushälfte',row:'Reihenhaus',other:'Sonstiges'});
    const special=holidayAccommodationLabel(a.specialType,{treehouse:'Baumhaus',houseboat:'Hausboot',castle:'Schloss / Gutshaus',mill:'Mühle',tinyhouse:'Tiny House',glamping:'Glamping',hut:'Berghütte',farm:'Bauernhof',winery:'Weingut',specialhotel:'Außergewöhnliches Hotel / Zimmer',other:'Sonstiges'});
    const linen=holidayAccommodationLabel(a.linen,{included:'Inklusive',paid:a.linenPrice!=null?`Kostenpflichtig · ${formatNumber(a.linenPrice)} €`:'Kostenpflichtig',bring:'Selbst mitbringen'}); const towels=holidayAccommodationLabel(a.towels,{included:'Inklusive',paid:a.towelsPrice!=null?`Kostenpflichtig · ${formatNumber(a.towelsPrice)} €`:'Kostenpflichtig',bring:'Selbst mitbringen'});
    const kitchenItems=[]; [['Herd',a.stove],['Backofen',a.oven],['Mikrowelle',a.microwave],['Kühlschrank',a.fridge],['Gefrierfach / Gefrierschrank',a.freezer],['Geschirrspüler',a.dishwasher],['Kaffeemaschine',a.coffee],['Wasserkocher',a.kettle],['Toaster',a.toaster]].forEach(([l,v])=>{if(v)kitchenItems.push(l)});
    const hotelItems=[]; [['Rezeption',a.reception],['24-h-Rezeption',a.reception24],['Zimmerservice',a.roomService],['Zimmerreinigung',a.roomCleaning],['Safe',a.safe],['Minibar / Kühlschrank',a.minibar],['Kaffee-/Teezubereitung',a.coffeeTea]].forEach(([l,v])=>{if(v)hotelItems.push(l)});
    const rows=[detailRow('Max. Personen',a.maxPersons!=null?formatNumber(a.maxPersons,0):''),detailRow('Schlafzimmer',a.bedrooms!=null?formatNumber(a.bedrooms,0):''),detailRow('Betten',a.beds!=null?formatNumber(a.beds,0):''),detailRow('Badezimmer',a.bathrooms!=null?formatNumber(a.bathrooms,0):''),detailRow('Größe',a.size!=null?`${formatNumber(a.size,1)} m²`:''),detailRow('Badart',bath),detailRow('WLAN',wifi),yes.length?detailRow('Ausstattung',yes.join(' · ')):'',e.type==='hotel'?detailRow('Kategorie / Sterne',a.hotelStars!=null?`${formatNumber(a.hotelStars,1)} Sterne`:''):'',e.type==='hotel'?detailRow('Zimmertyp',room):'',hotelItems.length?detailRow('Hotel- & Resortservice',hotelItems.join(' · ')):'',detailRow('Küche',a.kitchen==='yes'?'Vorhanden':a.kitchen==='no'?'Nicht vorhanden':''),a.kitchen==='yes'&&kitchenItems.length?detailRow('Küchenausstattung',kitchenItems.join(' · ')):'',e.type==='ferienhaus'?detailRow('Hausart',house):'',e.type==='ferienwohnung'?detailRow('Etage',a.floor||''):'',e.type==='besonders'?detailRow('Art der Unterkunft',special):'',detailRow('Bettwäsche',linen), detailRow('Handtücher',towels)].filter(Boolean).join('');
    const summary=[a.maxPersons!=null?`bis ${formatNumber(a.maxPersons,0)} Pers.`:'',a.size!=null?`${formatNumber(a.size,1)} m²`:'',special||room||house].filter(Boolean).join(' · ')||'Unterkunft & Ausstattung';
    accommodationCard=`<details class="detail-accordion"><summary><span><small>Unterkunft &amp; Ausstattung</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Angaben zur Ausstattung gespeichert.</div>'}</div></details>`;
  }
  let priceCard='';
  if(isAccommodationHolidayType(e.type)){
    const p=ensureHolidayPrices(e);
    const billing=holidayPriceBillingLabel(p.billing);
    const basis=holidayPriceBasisLabel(p.basis);
    const priceFrom=p.priceFrom!=null?`${formatNumber(p.priceFrom)} €${billing?` ${billing}`:''}`:'';
    let roomFor='';
    if(e.type==='hotel'){
      roomFor=p.hotelOccupancy==='1'?'1 Person':p.hotelOccupancy==='2'?'2 Personen':p.hotelOccupancy==='other'&&p.hotelOccupancyOther!=null?`${formatNumber(p.hotelOccupancyOther,0)} Personen`:'';
    }
    const reservation=({possible:'Möglich',recommended:'Empfohlen',required:'Erforderlich'})[p.reservationStatus]||'';
    const cancellation=p.freeCancellation==='yes'?(p.cancellationUntil?`Ja · bis ${p.cancellationUntil}`:'Ja'):p.freeCancellation==='no'?'Nein':'';
    const nights=visitNights(p.offer?.arrival,p.offer?.departure);
    const offerPeriod=[p.offer?.arrival,p.offer?.departure].filter(Boolean).join(' – ');
    const offerDetails=[offerPeriod,nights!=null?`${nights} ${nights===1?'Nacht':'Nächte'}`:'',p.offer?.persons!=null?`${formatNumber(p.offer.persons,0)} ${Number(p.offer.persons)===1?'Person':'Personen'}`:''].filter(Boolean).join(' · ');
    const priceRows=[
      detailRow('Preisstand / Jahr',p.year!=null?String(p.year):''),
      detailRow('Preis ab',priceFrom),
      detailRow('Preis gilt für',basis),
      e.type==='hotel'?detailRow('Zimmerpreis für',roomFor):'',
      detailRow('Kurtaxe / Tourismusabgabe',p.touristTax!=null?`${formatNumber(p.touristTax)} €`:''),
      detailRow('Endreinigung',p.cleaningFee!=null?`${formatNumber(p.cleaningFee)} €`:''),
      detailRow('Reservierungs-/Buchungsgebühr',p.bookingFee!=null?`${formatNumber(p.bookingFee)} €`:''),
      detailRow(p.otherFeeLabel||'Sonstige Gebühr',p.otherFee!=null?`${formatNumber(p.otherFee)} €`:''),
      detailRow('Buchung / Reservierung',reservation),
      detailRow('Kostenlose Stornierung',cancellation),
      p.offer?.total!=null?`<div class="detail-note"><span>Gefundener Preis für unsere Reise</span><p>${offerDetails?`${escapeHtml(offerDetails)}<br>`:''}<strong>${formatNumber(p.offer.total)} € gesamt</strong></p></div>`:'',
      p.notes?`<div class="detail-note"><span>Hinweise zu Preis &amp; Buchung</span><p>${escapeHtml(p.notes).replace(/\n/g,'<br>')}</p></div>`:''
    ].filter(Boolean).join('');
    const priceSummary=[priceFrom,p.year!=null?`Preisstand ${p.year}`:''].filter(Boolean).join(' · ')||'Preise & Buchung';
    priceCard=`<details class="detail-accordion"><summary><span><small>Preise &amp; Buchung</small><strong>${escapeHtml(priceSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${priceRows||'<div class="detail-empty">Noch keine Preise oder Buchungsangaben gespeichert.</div>'}</div></details>`;
  }
  let stayCard='';
  if(isAccommodationHolidayType(e.type)){
    const st=ensureHolidayStay(e);
    const checkinType=({reception:'Rezeption',host:'Gastgeber persönlich',keybox:'Schlüsselbox',keysafe:'Schlüsseltresor',code:'Code / PIN',app:'App',self:'Selbst-Check-in',other:'Sonstiges'})[st.checkinType]||'';
    const parking=st.parking==='yes'?[({included:'Inklusive',paid:'Kostenpflichtig',unknown:'Preis unbekannt'})[st.parkingBilling]||'',st.parkingBilling==='paid'&&st.parkingPrice!=null?`${formatNumber(st.parkingPrice)} €`:''].filter(Boolean).join(' · '):st.parking==='no'?'Nicht vorhanden':'';
    const parkingType=({property:'Auf dem Grundstück',parking:'Parkplatz',garage:'Parkhaus / Tiefgarage',public:'Straße / öffentlich',other:'Sonstiges'})[st.parkingType]||'';
    const deposit=st.deposit==='none'?'Keine':st.deposit==='required'?[st.depositAmount!=null?`${formatNumber(st.depositAmount)} €`:'Erforderlich',({cash:'Bar',card:'Kreditkarte',transfer:'Überweisung',other:'Sonstiges'})[st.depositMethod]||''].filter(Boolean).join(' · '):'';
    const rows=[detailRow('Check-in ab',st.checkinFrom||''),detailRow('Check-in bis',st.checkinUntil||''),detailRow('Check-out bis',st.checkoutUntil||''),detailRow('Art des Check-ins',checkinType),detailRow('Mindestaufenthalt',st.minNights!=null?`${formatNumber(st.minNights,0)} ${Number(st.minNights)===1?'Nacht':'Nächte'}`:''),detailRow('Anreise flexibel möglich',st.flexible==='yes'?'Ja':st.flexible==='no'?'Nein':''),detailRow('Späte Anreise möglich',st.late==='yes'?'Ja':st.late==='no'?'Nein':''),detailRow('Parkplatz',parking),detailRow('Parkplatzart',parkingType),detailRow('Kaution',deposit),st.arrivalNotes?`<div class="detail-note"><span>Schlüsselübergabe / Hinweise zur Anreise</span><p>${escapeHtml(st.arrivalNotes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
    const summary=[st.checkinFrom?`Check-in ab ${st.checkinFrom}`:'',st.checkoutUntil?`Check-out bis ${st.checkoutUntil}`:'',parking].filter(Boolean).slice(0,2).join(' · ')||'Aufenthalt & Anreise';
    stayCard=`<details class="detail-accordion"><summary><span><small>Aufenthalt &amp; Anreise</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Angaben zu Aufenthalt oder Anreise gespeichert.</div>'}</div></details>`;
  }
  let foodCard='';
  if(isAccommodationHolidayType(e.type)){
    const f=ensureHolidayFood(e);
    const plans=[f.none?'Ohne Verpflegung':'',f.breakfast?'Frühstück':'',f.halfBoard?'Halbpension':'',f.fullBoard?'Vollpension':'',f.allInclusive?'All Inclusive':''].filter(Boolean);
    const status=({included:'Im Preis enthalten',optional:'Zubuchbar',both:'Beides möglich'})[f.status]||'';
    const services=[f.restaurant?'Restaurant':'',f.bar?'Bar':'',f.cafe?'Café':'',f.breakfastService?'Frühstücksservice':'',f.breadService?'Brötchenservice':'',f.farmShop?'Hofladen':'',f.groceries?'Lebensmittelangebot':'',f.regional?'Regionale / eigene Produkte':''].filter(Boolean);
    const priceParts=[f.breakfastPrice!=null?`Frühstück ${formatNumber(f.breakfastPrice)} € / Person / Tag`:'',f.halfBoardPrice!=null?`Halbpension ${formatNumber(f.halfBoardPrice)} € / Person / Tag`:'',f.fullBoardPrice!=null?`Vollpension ${formatNumber(f.fullBoardPrice)} € / Person / Tag`:'',f.allInclusivePrice!=null?`All Inclusive ${formatNumber(f.allInclusivePrice)} € / Person / Tag`:''].filter(Boolean);
    const rows=[detailRow('Verfügbare Verpflegung',plans.join(' · ')),detailRow('Verpflegungsstatus',status),detailRow('Zubuchbare Preise',priceParts.join(' · ')),detailRow('Gastronomie & Service',services.join(' · ')),f.notes?`<div class="detail-note"><span>Hinweise zur Verpflegung</span><p>${escapeHtml(f.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
    const summary=[plans.slice(0,2).join(' · '),status].filter(Boolean).join(' · ')||'Verpflegung';
    foodCard=`<details class="detail-accordion"><summary><span><small>Verpflegung</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Angaben zur Verpflegung gespeichert.</div>'}</div></details>`;
  }
  let holidayLeisureCard='';
  if(isAccommodationHolidayType(e.type)){
    const l=ensureHolidayLeisure(e);
    const use=v=>({private:'Privat',shared:'Gemeinschaftlich'})[v]||'';
    const pool=[];
    if(l.outdoorPool==='yes')pool.push(`Außenpool${use(l.outdoorPoolUse)?` · ${use(l.outdoorPoolUse)}`:''}`);
    if(l.indoorPool==='yes')pool.push(`Innenpool${use(l.indoorPoolUse)?` · ${use(l.indoorPoolUse)}`:''}`);
    if((l.outdoorPool==='yes'||l.indoorPool==='yes')&&l.poolHeated)pool.push('Pool beheizt');
    if((l.outdoorPool==='yes'||l.indoorPool==='yes')&&l.poolSeasonal)pool.push('Pool saisonal');
    if(l.sauna==='yes')pool.push(`Sauna${use(l.saunaUse)?` · ${use(l.saunaUse)}`:''}`);
    if(l.whirlpool==='yes')pool.push(`Whirlpool${use(l.whirlpoolUse)?` · ${use(l.whirlpoolUse)}`:''}`);
    [['Wellness / Spa',l.wellness],['Massage / Anwendungen',l.massage],['Direkter Badezugang',l.bathingAccess],['Eigener Strand / Strandzugang',l.privateBeach]].forEach(([a,b])=>{if(b)pool.push(a)});
    const sport=[]; [['Fitness',l.fitness],['Fahrradverleih',l.bikeRental],['E-Bike-Verleih',l.eBikeRental],['Tennis',l.tennis],['Tischtennis',l.tableTennis],['Minigolf',l.miniGolf],['Wassersport',l.waterSports],['Skiraum',l.skiRoom],['Ski-in / Ski-out',l.skiInOut]].forEach(([a,b])=>{if(b)sport.push(a)});
    const family=[]; [['Spielplatz',l.playground],['Spielzimmer',l.playroom],['Kinderbetreuung',l.childcare],['Animation / Abendunterhaltung',l.entertainment],['Kinderprogramm',l.kidsProgram]].forEach(([a,b])=>{if(b)family.push(a)});
    const rows=[detailRow('Wellness & Baden',pool.join(' · ')),detailRow('Sport & Aktiv',sport.join(' · ')),detailRow('Familie & Unterhaltung',family.join(' · ')),l.notes?`<div class="detail-note"><span>Besondere Angebote / Hinweise</span><p>${escapeHtml(l.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
    const summary=[pool[0]||'',sport[0]||'',family[0]||''].filter(Boolean).slice(0,3).join(' · ')||'Freizeit & Angebote';
    holidayLeisureCard=`<details class="detail-accordion"><summary><span><small>Freizeit &amp; Angebote</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Freizeit- oder Angebotsangaben gespeichert.</div>'}</div></details>`;
  }
  let holidayLocationCard='';
  if(isAccommodationHolidayType(e.type)){
    const location=ensureHolidayLocation(e);
    const featureLabels={sea:'Meer',lake:'See',river:'Fluss',mountains:'Berge',forest:'Wald',rural:'Ländlich',city:'Stadt / Innenstadt','city-edge':'Stadtrand','beach-nearby':'Strandnähe',waterfront:'Direkt am Wasser',remote:'Abgelegen / ruhig'};
    const features=(location.features||[]).map(v=>featureLabels[v]).filter(Boolean);
    const d=location.distances||{};
    const distanceText=item=>{if(!item)return '';const parts=[];if(item.km!=null)parts.push(`${formatNumber(item.km)} km`);if(item.walkable==='yes')parts.push('fußläufig');else if(item.walkable==='no')parts.push('nicht fußläufig');return parts.join(' · ');};
    const m=location.mobility||{};
    const rows=[detailRow('Lage',features.join(' · ')),detailRow('Orts-/Stadtzentrum',distanceText(d.centre)),detailRow('Supermarkt',distanceText(d.supermarket)),detailRow('Restaurant',distanceText(d.restaurant)),detailRow('Bäckerei',distanceText(d.bakery)),detailRow('Strand / See',distanceText(d.water)),detailRow('Sehenswürdigkeiten',distanceText(d.sights)),detailRow('Entfernung zum Flughafen',location.airportDistance!=null?`${formatNumber(location.airportDistance)} km`:''),detailRow('Entfernung zur Autobahn',location.motorwayDistance!=null?`${formatNumber(location.motorwayDistance)} km`:''),detailRow('Autobahn / Anschlussstelle',location.motorwayJunction),detailRow('ÖPNV',knownYesNo(m.publicTransport,'Vorhanden','Nicht vorhanden')),detailRow('Bushaltestelle',knownYesNo(m.bus,'Vorhanden','Nicht vorhanden')),detailRow('Bahnhof',knownYesNo(m.train,'Vorhanden','Nicht vorhanden')),detailRow('Radwege',knownYesNo(m.cycle,'Vorhanden','Nicht vorhanden')),detailRow('Wanderwege',knownYesNo(m.hiking,'Vorhanden','Nicht vorhanden')),detailRow('Seilbahn',knownYesNo(m.cableCar,'Vorhanden','Nicht vorhanden')),detailRow('Fähranleger / Hafen',knownYesNo(m.ferry,'Vorhanden','Nicht vorhanden')),location.notes?`<div class="detail-note"><span>Ausflugsziele / Hinweise zur Umgebung</span><p>${escapeHtml(location.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
    const summary=[features.slice(0,2).join(' · '),location.motorwayDistance!=null?`${formatNumber(location.motorwayDistance)} km zur Autobahn`:'',location.airportDistance!=null?`${formatNumber(location.airportDistance)} km zum Flughafen`:''].filter(Boolean).slice(0,2).join(' · ')||'Lage & Umgebung';
    holidayLocationCard=`<details class="detail-accordion"><summary><span><small>Lage &amp; Umgebung</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Angaben zu Lage und Umgebung gespeichert.</div>'}</div></details>`;
  }
  let holidayDogCard='';
  if(isAccommodationHolidayType(e.type)){
    const dog=ensureHolidayDog(e);
    const fee=dog.feeType==='free'?'Kostenlos':dog.feeType==='paid'?(dog.fee!=null?`${formatNumber(dog.fee)} € / Hund / Nacht`:'Kostenpflichtig'):'';
    const alone=({yes:'Ja',no:'Nein',conditional:'Nur unter Bedingungen'})[dog.alone]||'';
    const rows=dog.allowed==='unknown'||!dog.allowed?'':[
      detailRow('Hunde erlaubt',dog.allowed==='yes'?'Ja':'Nein'),
      dog.allowed==='yes'?detailRow('Maximale Anzahl Hunde',dog.maxCount!=null?String(dog.maxCount):''):'',
      dog.allowed==='yes'?detailRow('Hundekosten',fee):'',
      dog.allowed==='yes'?detailRow('Maximale Größe / Gewicht',dog.sizeWeight||''):'',
      dog.allowed==='yes'?detailRow('Nur bestimmte Zimmer / Unterkünfte',knownYesNo(dog.restrictedUnits,'Ja','Nein')):'',
      dog.allowed==='yes'?detailRow('Leinenpflicht auf dem Gelände',knownYesNo(dog.leash,'Ja','Nein')):'',
      dog.allowed==='yes'?detailRow('Hund darf allein in der Unterkunft bleiben',alone):'',
      dog.allowed==='yes'&&dog.alone==='conditional'&&dog.aloneNotes?`<div class="detail-note"><span>Bedingungen für das Alleinbleiben</span><p>${escapeHtml(dog.aloneNotes).replace(/\n/g,'<br>')}</p></div>`:'',
      dog.allowed==='yes'?detailRow('Hundeauslauf / Hundewiese',knownYesNo(dog.run,'Vorhanden','Nicht vorhanden')):'',
      dog.allowed==='yes'?detailRow('Hundestrand',knownYesNo(dog.beach,'Vorhanden','Nicht vorhanden')):'',
      dog.allowed==='yes'?detailRow('Bademöglichkeit für Hunde',knownYesNo(dog.swimming,'Vorhanden','Nicht vorhanden')):'',
      dog.allowed==='yes'?detailRow('Hundedusche',knownYesNo(dog.shower,'Vorhanden','Nicht vorhanden')):'',
      dog.allowed==='yes'?detailRow('Hunde im Restaurant erlaubt',knownYesNo(dog.restaurant,'Ja','Nein')):'',
      dog.allowed==='yes'&&dog.notes?`<div class="detail-note"><span>Hinweise für Hunde</span><p>${escapeHtml(dog.notes).replace(/\n/g,'<br>')}</p></div>`:''
    ].filter(Boolean).join('');
    const summary=dog.allowed==='yes'?['Hunde erlaubt',fee,dog.alone==='yes'?'darf allein bleiben':''].filter(Boolean).slice(0,2).join(' · '):dog.allowed==='no'?'Hunde nicht erlaubt':'Hund';
    holidayDogCard=`<details class="detail-accordion"><summary><span><small>Hund</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Angaben zu Hunden gespeichert.</div>'}</div></details>`;
  }
  let destinationCard='';
  if(e.type==='reiseziel'){
    const destination=ensureHolidayDestination(e);
    const scope=HOLIDAY_DESTINATION_SCOPE_LABELS[destination.scope]||'';
    const categories=(destination.categories||[]).map(v=>holidayDestinationChoiceLabel(v,'category')).filter(Boolean);
    const characters=(destination.characters||[]).map(v=>holidayDestinationChoiceLabel(v,'character')).filter(Boolean);
    const rows=[detailRow('Umfang des Reiseziels',scope),detailRow('Art des Reiseziels',categories.join(' · ')),detailRow('Charakter',characters.join(' · ')),destination.wish?`<div class="detail-note"><span>Was möchte ich dort sehen / erleben?</span><p>${escapeHtml(destination.wish).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
    const summary=[scope,categories.slice(0,2).join(' · ')].filter(Boolean).join(' · ')||'Reiseziel & Kategorie';
    destinationCard=`<details class="detail-accordion"><summary><span><small>Reiseziel &amp; Kategorie</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Kategorien oder Merkmale gespeichert.</div>'}</div></details>`;
  }
  let visitPlanningCard='';
  if(e.type==='reiseziel'){
    const v=ensureHolidayVisitPlanning(e);
    const yesNo={yes:'Ja',no:'Nein'};
    const ticketLabels={not_required:'Nicht erforderlich',possible:'Möglich',recommended:'Empfohlen',required:'Erforderlich'};
    const bestLabels={spring:'Frühling',summer:'Sommer',autumn:'Herbst',winter:'Winter',advent:'Weihnachten / Advent',year_round:'Ganzjährig'};
    const duration=v.duration!=null?`${formatNumber(v.duration)} ${v.durationUnit==='days'?(Number(v.duration)===1?'Tag':'Tage'):(Number(v.duration)===1?'Stunde':'Stunden')}`:'';
    const season=v.yearRound==='no'?[formatDate(v.seasonFrom),formatDate(v.seasonUntil)].filter(Boolean).join(' bis '):'';
    const best=(v.bestTime||[]).map(x=>bestLabels[x]||x).join(' · ');
    const rows=[detailRow('Ganzjährig besuchbar',yesNo[v.yearRound]||''),detailRow('Saison',season),detailRow('Öffnungszeiten bekannt',yesNo[v.hoursKnown]||''),v.hours?`<div class="detail-note"><span>Öffnungszeiten</span><p>${escapeHtml(v.hours).replace(/\n/g,'<br>')}</p></div>`:'',detailRow('Empfohlene Aufenthaltsdauer',duration),detailRow('Reservierung / Ticket vorab',ticketLabels[v.ticket]||''),detailRow('Beste Reise- / Besuchszeit',best),v.notes?`<div class="detail-note"><span>Hinweise zum Besuch</span><p>${escapeHtml(v.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
    const summary=[duration,ticketLabels[v.ticket],best].filter(Boolean).slice(0,2).join(' · ')||'Besuch & Öffnungszeiten';
    visitPlanningCard=`<details class="detail-accordion"><summary><span><small>Besuch &amp; Öffnungszeiten</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Angaben zum Besuch gespeichert.</div>'}</div></details>`;
  }
  let destinationCostsCard='';
  if(e.type==='reiseziel'){
    const c=ensureHolidayDestinationCosts(e);
    const admissionLabel=c.admission==='free'?'Kostenlos':c.admission==='paid'?'Kostenpflichtig':'';
    const parkingLabel=c.parking==='free'?'Kostenlos':c.parking==='paid'?'Kostenpflichtig':'';
    const money=v=>v!=null?`${formatNumber(v)} €`:'';
    const rows=[
      detailRow('Eintritt',admissionLabel),
      c.admission==='paid'?detailRow('Erwachsene',money(c.adultPrice)):'',
      c.admission==='paid'?detailRow('Kinder',money(c.childPrice)):'',
      c.admission==='paid'?detailRow('Familie',money(c.familyPrice)):'',
      c.admission==='paid'?detailRow('Ermäßigt',money(c.reducedPrice)):'',
      detailRow('Parken',parkingLabel),
      c.parking==='paid'?detailRow('Parkgebühr',money(c.parkingPrice)):'',
      c.otherCosts?`<div class="detail-note"><span>Weitere Kosten / Gebühren</span><p>${escapeHtml(c.otherCosts).replace(/\n/g,'<br>')}</p></div>`:'',
      detailRow('Preisjahr',c.priceYear!=null?String(c.priceYear):''),
      c.notes?`<div class="detail-note"><span>Hinweise zu Preisen &amp; Tickets</span><p>${escapeHtml(c.notes).replace(/\n/g,'<br>')}</p></div>`:''
    ].filter(Boolean).join('');
    const summary=[admissionLabel,c.admission==='paid'&&c.adultPrice!=null?`Erwachsene ${money(c.adultPrice)}`:'',parkingLabel?`Parken ${parkingLabel.toLowerCase()}`:''].filter(Boolean).slice(0,2).join(' · ')||'Eintritt & Kosten';
    destinationCostsCard=`<details class="detail-accordion"><summary><span><small>Eintritt &amp; Kosten</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Angaben zu Eintritt und Kosten gespeichert.</div>'}</div></details>`;
  }
  let destinationArrivalCard='';
  if(e.type==='reiseziel'){
    const a=ensureHolidayDestinationArrival(e);
    const accessLabels={easy:'Einfach',restricted:'Eingeschränkt'};
    const yesNo={yes:'Ja',no:'Nein'};
    const transportLabels={bus:'Bus',tram:'Straßenbahn',subway:'U-Bahn',train:'Bahnhof / Zug',ferry:'Fähre / Hafen',cable_car:'Seilbahn / Bergbahn'};
    const transport=(a.transport||[]).map(x=>transportLabels[x]||x).join(' · ');
    const motorway=[a.motorwayDistance!=null?`${formatNumber(a.motorwayDistance)} km`:'',a.motorwayJunction||''].filter(Boolean).join(' · ');
    const walk=[a.walkDistance!=null?`${formatNumber(a.walkDistance)} m`:'',a.walkMinutes!=null?`${formatNumber(a.walkMinutes)} Min.`:''].filter(Boolean).join(' · ');
    const rows=[
      detailRow('Autobahn / Anschlussstelle',motorway),
      detailRow('Anfahrt',accessLabels[a.access]||''),
      a.access==='restricted'&&a.accessNotes?`<div class="detail-note"><span>Hinweis zur eingeschränkten Anfahrt</span><p>${escapeHtml(a.accessNotes).replace(/\n/g,'<br>')}</p></div>`:'',
      detailRow('Parkplatz vorhanden',yesNo[a.parkingAvailable]||''),
      a.parkingAvailable==='yes'&&a.parkingNotes?`<div class="detail-note"><span>Parkplatz / Hinweis</span><p>${escapeHtml(a.parkingNotes).replace(/\n/g,'<br>')}</p></div>`:'',
      detailRow('Wohnmobil-Parkmöglichkeit',yesNo[a.motorhomeParking]||''),
      a.motorhomeParking==='yes'&&a.motorhomeNotes?`<div class="detail-note"><span>Hinweis Wohnmobil</span><p>${escapeHtml(a.motorhomeNotes).replace(/\n/g,'<br>')}</p></div>`:'',
      detailRow('Öffentliche Verkehrsmittel & weitere Anreise',transport),
      a.transportNotes?`<div class="detail-note"><span>Hinweise zu ÖPNV &amp; Anreise</span><p>${escapeHtml(a.transportNotes).replace(/\n/g,'<br>')}</p></div>`:'',
      detailRow('Vom Parkplatz / Ankunftspunkt zum Ziel',walk)
    ].filter(Boolean).join('');
    const summary=[accessLabels[a.access],a.parkingAvailable==='yes'?'Parkplatz vorhanden':'',a.motorhomeParking==='yes'?'Wohnmobil möglich':''].filter(Boolean).slice(0,2).join(' · ')||'Lage & Anreise';
    destinationArrivalCard=`<details class="detail-accordion"><summary><span><small>Lage &amp; Anreise</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Angaben zu Lage und Anreise gespeichert.</div>'}</div></details>`;
  }
  let destinationHighlightsCard='';
  if(e.type==='reiseziel'){
    const h=ensureHolidayDestinationHighlights(e);
    const activities=(h.activities||[]).map(holidayDestinationActivityLabel).filter(Boolean);
    const rows=[detailRow('Aktivitäten & Möglichkeiten',activities.join(' · ')),h.highlights?`<div class="detail-note"><span>Highlights – Was möchte ich sehen?</span><p>${escapeHtml(h.highlights).replace(/\n/g,'<br>')}</p></div>`:'',h.plans?`<div class="detail-note"><span>Was möchte ich dort machen?</span><p>${escapeHtml(h.plans).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
    const summary=activities.slice(0,3).join(' · ')||'Highlights & Aktivitäten';
    destinationHighlightsCard=`<details class="detail-accordion"><summary><span><small>Highlights &amp; Aktivitäten</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Highlights oder Aktivitäten gespeichert.</div>'}</div></details>`;
  }
  let destinationLinksCard='';
  if(e.type==='reiseziel'){
    const links=ensureHolidayDestinationLinks(e).accommodations||[];
    const valid=links.map(link=>({link,entry:linkedAccommodationEntry(link.entryId)})).filter(item=>item.entry);
    const cards=valid.map(({link,entry})=>{
      const media=imageById(entry,entry.titleImageId);
      const thumb=media?.dataUrl?`<img src="${media.dataUrl}" alt="${escapeHtml(media.description||entry.name||'Unterkunft')}" />`:`<span class="linked-entry-placeholder">${escapeHtml(typeIcons[entry.type]||'⌂')}</span>`;
      return `<div class="linked-entry-detail"><button type="button" class="linked-entry-open" data-open-entry-id="${escapeHtml(entry.id)}"><span class="linked-entry-image">${thumb}</span><span class="linked-entry-copy"><strong>${escapeHtml(entry.name||'Ohne Namen')}</strong><small>${escapeHtml(typeLabels[entry.type]||entry.type)}${linkedEntryLocation(entry)?` · ${escapeHtml(linkedEntryLocation(entry))}`:''}</small></span><span class="linked-entry-arrow">›</span></button>${link.note?`<p>${escapeHtml(link.note).replace(/\n/g,'<br>')}</p>`:''}</div>`;
    }).join('');
    const summary=valid.length?`${valid.length} ${valid.length===1?'Unterkunft':'Unterkünfte'} verknüpft`:'Unterkunft & Verknüpfungen';
    destinationLinksCard=`<details class="detail-accordion"><summary><span><small>Unterkunft &amp; Verknüpfungen</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${cards||'<div class="detail-empty">Noch keine Unterkunft verknüpft.</div>'}</div></details>`;
  }
  let destinationNotesCard='';
  if(e.type==='reiseziel'){
    const n=ensureHolidayDestinationNotes(e);
    const rows=[
      n.important?`<div class="detail-note"><span>Wichtige Hinweise</span><p>${escapeHtml(n.important).replace(/\n/g,'<br>')}</p></div>`:'',
      n.bring?`<div class="detail-note"><span>Was sollte ich mitnehmen / beachten?</span><p>${escapeHtml(n.bring).replace(/\n/g,'<br>')}</p></div>`:'',
      n.insider?`<div class="detail-note"><span>Insider-Tipps</span><p>${escapeHtml(n.insider).replace(/\n/g,'<br>')}</p></div>`:''
    ].filter(Boolean).join('');
    const summary=[n.important?'Wichtige Hinweise':'',n.bring?'Mitnehmen & beachten':'',n.insider?'Insider-Tipps':''].filter(Boolean).slice(0,2).join(' · ')||'Hinweise';
    destinationNotesCard=`<details class="detail-accordion"><summary><span><small>Hinweise</small><strong>${escapeHtml(summary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${rows||'<div class="detail-empty">Noch keine Hinweise gespeichert.</div>'}</div></details>`;
  }
  const personal=ensureHolidayPersonal(e);
  const statusText=e.visited?'Besucht':e.wantToVisit?'Möchte ich besuchen':'';
  const favoriteText=e.favorite?'Favorit':'';
  const returnText=holidayReturnLabel(personal.returnIntent);
  const ratingLabels=[['Lage',personal.ratings?.location],['Ruhe',personal.ratings?.quiet],['Sauberkeit',personal.ratings?.cleanliness],['Ausstattung',personal.ratings?.equipment],['Service / Gastgeber',personal.ratings?.service],['Preis-Leistung',personal.ratings?.value],['Erlebnis',personal.ratings?.experience],['Sehenswert',personal.ratings?.sightseeing]];
  const ratingAverage=holidayPersonalRatingAverage(personal);
  const ratingRows=ratingLabels.map(([label,val])=>detailRow(label,val!=null?`${formatNumber(val,1)} / 5`:'' )).filter(Boolean).join('')+(ratingAverage!=null?detailRow('Gesamtbewertung',`${formatNumber(ratingAverage,1)} / 5`):'');
  const visits=Array.isArray(e.visits)?e.visits:[];
  const visitRows=visits.length?`<div class="visit-history">${visits.map((v,index)=>{
    if(e.type==='reiseziel'){
      const dateText=formatDate(v.date||v.arrival)||'Datum nicht angegeben';
      return `<div class="visit-history-card"><div class="visit-history-head"><strong>Besuch ${index+1}</strong><span>${escapeHtml(dateText)}</span></div>${v.note?`<p>${escapeHtml(v.note).replace(/\n/g,'<br>')}</p>`:''}</div>`;
    }
    const nights=visitNights(v.arrival,v.departure);
    const dateText=(v.arrival||v.departure)?`${formatDate(v.arrival)||'–'} bis ${formatDate(v.departure)||'–'}`:'Datum nicht angegeben';
    const meta=[nights!=null?`${nights} ${nights===1?'Nacht':'Nächte'}`:'',v.unit?`${v.unit}`:''].filter(Boolean).join(' · ');
    return `<div class="visit-history-card"><div class="visit-history-head"><strong>Aufenthalt ${index+1}</strong><span>${escapeHtml(dateText)}</span></div>${meta?`<small>${escapeHtml(meta)}</small>`:''}${v.note?`<p>${escapeHtml(v.note).replace(/\n/g,'<br>')}</p>`:''}</div>`;
  }).join('')}</div>`:'';
  const personalRows=[detailRow('Status',[statusText,favoriteText].filter(Boolean).join(' · ')),e.why?`<div class="detail-note"><span>Warum gespeichert?</span><p>${escapeHtml(e.why).replace(/\n/g,'<br>')}</p></div>`:'',ratingRows,detailRow('Würde ich wiederkommen?',returnText),visits.length?`<div class="detail-note"><span>Besuchshistorie</span>${visitRows}</div>`:'',e.notes?`<div class="detail-note"><span>Persönliche Notizen</span><p>${escapeHtml(e.notes).replace(/\n/g,'<br>')}</p></div>`:''].filter(Boolean).join('');
  const personalSummary=[statusText,favoriteText,ratingAverage!=null?`${formatNumber(ratingAverage,1)} / 5`:'',visits.length?`${visits.length} ${visits.length===1?'Besuch':'Besuche'}`:''].filter(Boolean).slice(0,3).join(' · ')||'Persönlich';
  const personalCard=`<details class="detail-accordion"><summary><span><small>Persönlich</small><strong>${escapeHtml(personalSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${personalRows||'<div class="detail-empty">Noch keine persönlichen Angaben gespeichert.</div>'}</div></details>`;
  return `<div class="detail-accordions"><details class="detail-accordion"><summary><span><small>Grunddaten</small><strong>${escapeHtml(basicSummary)}</strong></span><span class="accordion-chevron">⌄</span></summary><div class="accordion-body">${basicRows||'<div class="detail-empty">Noch keine weiteren Grunddaten gespeichert.</div>'}</div></details>${destinationCard}${visitPlanningCard}${destinationCostsCard}${destinationArrivalCard}${destinationHighlightsCard}${destinationLinksCard}${destinationNotesCard}${accommodationCard}${priceCard}${stayCard}${foodCard}${holidayLeisureCard}${holidayLocationCard}${holidayDogCard}${personalCard}</div>`;
}

let holidayEditMode='create';
function ensureHolidayDetails(e){
  if(!e.details||typeof e.details!=='object')e.details={};
  if(!e.details[e.type]||typeof e.details[e.type]!=='object')e.details[e.type]={};
  return e.details[e.type];
}
function ensureHolidayStay(e){
  const d=ensureHolidayDetails(e);
  if(!d.stay||typeof d.stay!=='object')d.stay={};
  return d.stay;
}
function ensureHolidayPrices(e){
  const d=ensureHolidayDetails(e);
  if(!d.prices||typeof d.prices!=='object')d.prices={};
  return d.prices;
}
function ensureHolidayFood(e){
  const d=ensureHolidayDetails(e);
  if(!d.food||typeof d.food!=='object')d.food={};
  return d.food;
}
function ensureHolidayLeisure(e){
  const d=ensureHolidayDetails(e);
  if(!d.leisure||typeof d.leisure!=='object')d.leisure={};
  return d.leisure;
}
function ensureHolidayLocation(e){
  const d=ensureHolidayDetails(e);
  if(!d.location||typeof d.location!=='object')d.location={};
  if(!d.location.distances||typeof d.location.distances!=='object')d.location.distances={};
  if(!d.location.mobility||typeof d.location.mobility!=='object')d.location.mobility={};
  return d.location;
}
function ensureHolidayDog(e){
  const d=ensureHolidayDetails(e);
  if(!d.dog||typeof d.dog!=='object')d.dog={};
  return d.dog;
}
function ensureHolidayAccommodation(e){
  const d=ensureHolidayDetails(e);
  if(!d.accommodation||typeof d.accommodation!=='object')d.accommodation={};
  return d.accommodation;
}
function setChecked(id,value){const el=document.getElementById(id);if(el)el.checked=!!value;}
function holidayAccommodationLabel(value,map){return map[value]||'';}
function holidayPriceBillingLabel(value){return ({night:'pro Nacht',stay:'pro Aufenthalt',week:'pro Woche'})[value]||'';}
function holidayPriceBasisLabel(value){return ({unit:'Unterkunft / Zimmer',person:'pro Person'})[value]||'';}
function ensureHolidayPersonal(e){
  const d=ensureHolidayDetails(e);
  if(!d.personal || typeof d.personal!=='object') d.personal={ratings:{},returnIntent:'unknown'};
  if(!d.personal.ratings || typeof d.personal.ratings!=='object') d.personal.ratings={};
  return d.personal;
}
function holidayReturnLabel(value){return ({yes:'Ja',maybe:'Vielleicht',no:'Nein'})[value]||'';}
function renderHolidayVisitEditor(visits=[],type=document.getElementById('holidayEntryType')?.value||'hotel'){
  const list=document.getElementById('holidayVisitList'); if(!list)return;
  const accommodation=isAccommodationHolidayType(type);
  const normalized=Array.isArray(visits)?visits:[];
  list.innerHTML=normalized.length?normalized.map(v=>{
    if(accommodation){
      const arrival=v.arrival||v.date||'';
      return `<div class="visit-editor-card holiday-visit-accommodation" data-visit-id="${escapeHtml(v.id||uid())}">
        <div class="visit-card-head"><strong>Aufenthalt</strong><button type="button" class="visit-remove" aria-label="Besuch entfernen">Entfernen</button></div>
        <div class="grid-2"><label>Anreise<input class="visit-arrival" type="date" value="${escapeHtml(arrival)}" /></label><label>Abreise<input class="visit-departure" type="date" value="${escapeHtml(v.departure||'')}" /></label></div>
        <label>Zimmer / Wohnung / Haus – Nummer oder Bezeichnung<input class="visit-unit" type="text" value="${escapeHtml(v.unit||v.pitch||'')}" placeholder="z. B. Zimmer 214 oder Haus Seeblick" /></label>
        <label>Persönliche Besuchsnotiz<textarea class="visit-note" rows="3" placeholder="Was war bei diesem Aufenthalt besonders?">${escapeHtml(v.note||'')}</textarea></label>
      </div>`;
    }
    const date=v.date||v.arrival||'';
    return `<div class="visit-editor-card holiday-visit-destination" data-visit-id="${escapeHtml(v.id||uid())}">
      <div class="visit-card-head"><strong>Besuch</strong><button type="button" class="visit-remove" aria-label="Besuch entfernen">Entfernen</button></div>
      <label>Besuchsdatum<input class="visit-date" type="date" value="${escapeHtml(date)}" /></label>
      <label>Persönliche Besuchsnotiz<textarea class="visit-note" rows="3" placeholder="Was war bei diesem Besuch besonders?">${escapeHtml(v.note||'')}</textarea></label>
    </div>`;
  }).join(''):'<div class="visit-editor-empty">Noch kein Besuch gespeichert.</div>';
  list.querySelectorAll('.visit-remove').forEach(btn=>btn.onclick=()=>{btn.closest('.visit-editor-card')?.remove();if(!list.querySelector('.visit-editor-card'))list.innerHTML='<div class="visit-editor-empty">Noch kein Besuch gespeichert.</div>';});
}
function collectHolidayVisits(){
  return [...document.querySelectorAll('#holidayVisitList .visit-editor-card')].map(card=>{
    const base={id:card.dataset.visitId||uid(),note:card.querySelector('.visit-note')?.value.trim()||'',createdAt:new Date().toISOString()};
    if(card.classList.contains('holiday-visit-destination')) return {...base,date:card.querySelector('.visit-date')?.value||''};
    return {...base,arrival:card.querySelector('.visit-arrival')?.value||'',departure:card.querySelector('.visit-departure')?.value||'',unit:card.querySelector('.visit-unit')?.value.trim()||''};
  });
}
function addHolidayVisit(){
  const visits=collectHolidayVisits();
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  visits.push(isAccommodationHolidayType(type)?{id:uid(),arrival:'',departure:'',unit:'',note:''}:{id:uid(),date:'',note:''});
  renderHolidayVisitEditor(visits,type);
  document.querySelector('#holidayVisitList .visit-editor-card:last-child')?.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function updateHolidayPersonalConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const destination=type==='reiseziel';
  const help=document.getElementById('holidayVisitHelp');
  if(help) help.textContent=destination?'Mehrere Besuche bleiben mit Datum und Notiz getrennt erhalten.':'Mehrere Aufenthalte bleiben getrennt erhalten.';
  updateHolidayRatingAverage();
}
function updateHolidayAccommodationConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const accommodation=isAccommodationHolidayType(type);
  const section=document.getElementById('holidayAccommodationSection'); if(section)section.hidden=!accommodation;
  const accommodationType=document.getElementById('holidayAccommodationType');
  if(accommodationType && accommodation && accommodationType.value!==type) accommodationType.value=type;
  const hotel=document.getElementById('holidayAccHotelFields'); if(hotel)hotel.hidden=type!=='hotel';
  const house=document.getElementById('holidayAccHouseFields'); if(house)house.hidden=type!=='ferienhaus';
  const apartment=document.getElementById('holidayAccApartmentFields'); if(apartment)apartment.hidden=type!=='ferienwohnung';
  const special=document.getElementById('holidayAccSpecialFields'); if(special)special.hidden=type!=='besonders';
  const wifiBilling=document.getElementById('holidayAccWifiBillingWrap'); if(wifiBilling)wifiBilling.hidden=document.getElementById('holidayAccWifi')?.value!=='yes';
  const wifiPrice=document.getElementById('holidayAccWifiPriceWrap'); if(wifiPrice)wifiPrice.hidden=document.getElementById('holidayAccWifi')?.value!=='yes'||document.getElementById('holidayAccWifiBilling')?.value!=='paid';
  const kitchenEquipment=document.getElementById('holidayAccKitchenEquipment'); if(kitchenEquipment)kitchenEquipment.hidden=document.getElementById('holidayAccKitchen')?.value!=='yes';
  const linenPrice=document.getElementById('holidayAccLinenPriceWrap'); if(linenPrice)linenPrice.hidden=document.getElementById('holidayAccLinen')?.value!=='paid';
  const towelsPrice=document.getElementById('holidayAccTowelsPriceWrap'); if(towelsPrice)towelsPrice.hidden=document.getElementById('holidayAccTowels')?.value!=='paid';
}
function updateHolidayPriceConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const section=document.getElementById('holidayPricesSection');
  if(section)section.hidden=!isAccommodationHolidayType(type);
  const occupancy=document.getElementById('holidayHotelOccupancyWrap');
  if(occupancy)occupancy.hidden=type!=='hotel';
  const other=document.getElementById('holidayHotelOccupancyOtherWrap');
  if(other)other.hidden=type!=='hotel'||document.getElementById('holidayHotelOccupancy')?.value!=='other';
  const cancellation=document.getElementById('holidayCancellationUntilWrap');
  if(cancellation)cancellation.hidden=document.getElementById('holidayFreeCancellation')?.value!=='yes';
}
function updateHolidayStayConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const accommodation=isAccommodationHolidayType(type);
  const section=document.getElementById('holidayStaySection'); if(section)section.hidden=!accommodation;
  const parking=document.getElementById('holidayStayParking')?.value;
  const parkingBilling=document.getElementById('holidayStayParkingBillingWrap'); if(parkingBilling)parkingBilling.hidden=parking!=='yes';
  const parkingDetails=document.getElementById('holidayStayParkingDetailsWrap'); if(parkingDetails)parkingDetails.hidden=parking!=='yes';
  const parkingPrice=document.getElementById('holidayStayParkingPriceWrap'); if(parkingPrice)parkingPrice.hidden=parking!=='yes'||document.getElementById('holidayStayParkingBilling')?.value!=='paid';
  const deposit=document.getElementById('holidayStayDepositDetails'); if(deposit)deposit.hidden=document.getElementById('holidayStayDeposit')?.value!=='required';
}
function updateHolidayFoodConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const accommodation=isAccommodationHolidayType(type);
  const section=document.getElementById('holidayFoodSection'); if(section)section.hidden=!accommodation;
  const status=document.getElementById('holidayFoodStatus')?.value||'unknown';
  const prices=document.getElementById('holidayFoodPriceFields'); if(prices)prices.hidden=!['optional','both'].includes(status);
}
function updateHolidayLeisureConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const accommodation=isAccommodationHolidayType(type);
  const section=document.getElementById('holidayLeisureSection'); if(section)section.hidden=!accommodation;
  document.querySelectorAll('#holidayLeisureSection .holiday-hotel-only').forEach(el=>el.hidden=type!=='hotel');
  const outdoor=document.getElementById('holidayLeisureOutdoorPool')?.value==='yes';
  const indoor=document.getElementById('holidayLeisureIndoorPool')?.value==='yes';
  const poolOptions=document.getElementById('holidayLeisurePoolOptions'); if(poolOptions)poolOptions.hidden=!(outdoor||indoor);
  const poolRows=document.getElementById('holidayLeisurePoolUseRows'); if(poolRows)poolRows.hidden=!(outdoor||indoor);
  const outdoorUse=document.getElementById('holidayLeisureOutdoorPoolUseWrap'); if(outdoorUse)outdoorUse.hidden=!outdoor;
  const indoorUse=document.getElementById('holidayLeisureIndoorPoolUseWrap'); if(indoorUse)indoorUse.hidden=!indoor;
  const sauna=document.getElementById('holidayLeisureSaunaUseWrap'); if(sauna)sauna.hidden=document.getElementById('holidayLeisureSauna')?.value!=='yes';
  const whirl=document.getElementById('holidayLeisureWhirlpoolUseWrap'); if(whirl)whirl.hidden=document.getElementById('holidayLeisureWhirlpool')?.value!=='yes';
}
function updateHolidayLocationConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const section=document.getElementById('holidayLocationSection');
  if(section)section.hidden=!isAccommodationHolidayType(type);
}
function updateHolidayDogConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const accommodation=isAccommodationHolidayType(type);
  const section=document.getElementById('holidayDogSection'); if(section)section.hidden=!accommodation;
  const allowed=document.getElementById('holidayDogAllowed')?.value==='yes';
  const details=document.getElementById('holidayDogDetails'); if(details)details.hidden=!allowed;
  const feeWrap=document.getElementById('holidayDogFeeWrap'); if(feeWrap)feeWrap.hidden=!allowed||document.getElementById('holidayDogFeeType')?.value!=='paid';
  const aloneWrap=document.getElementById('holidayDogAloneNotesWrap'); if(aloneWrap)aloneWrap.hidden=!allowed||document.getElementById('holidayDogAlone')?.value!=='conditional';
}
function ensureHolidayDestination(e){
  const d=ensureHolidayDetails(e);
  if(!d.destination||typeof d.destination!=='object')d.destination={};
  if(!Array.isArray(d.destination.categories))d.destination.categories=[];
  if(!Array.isArray(d.destination.characters))d.destination.characters=[];
  return d.destination;
}
function ensureHolidayVisitPlanning(e){
  const d=ensureHolidayDetails(e);
  if(!d.visitPlanning||typeof d.visitPlanning!=='object')d.visitPlanning={};
  if(!Array.isArray(d.visitPlanning.bestTime))d.visitPlanning.bestTime=[];
  return d.visitPlanning;
}
function ensureHolidayDestinationCosts(e){
  const d=ensureHolidayDetails(e);
  if(!d.costs||typeof d.costs!=='object')d.costs={};
  return d.costs;
}
function ensureHolidayDestinationArrival(e){
  const d=ensureHolidayDetails(e);
  if(!d.arrival||typeof d.arrival!=='object')d.arrival={};
  if(!Array.isArray(d.arrival.transport))d.arrival.transport=[];
  return d.arrival;
}
function ensureHolidayDestinationHighlights(e){
  const d=ensureHolidayDetails(e);
  if(!d.highlights||typeof d.highlights!=='object')d.highlights={};
  if(!Array.isArray(d.highlights.activities))d.highlights.activities=[];
  return d.highlights;
}
function ensureHolidayDestinationNotes(e){
  const d=ensureHolidayDetails(e);
  if(!d.destinationNotes||typeof d.destinationNotes!=='object')d.destinationNotes={};
  return d.destinationNotes;
}
function ensureHolidayDestinationLinks(e){
  const d=ensureHolidayDetails(e);
  if(!d.links||typeof d.links!=='object')d.links={};
  if(!Array.isArray(d.links.accommodations))d.links.accommodations=[];
  d.links.accommodations=d.links.accommodations
    .filter(link=>link&&typeof link.entryId==='string'&&link.entryId)
    .map(link=>({entryId:link.entryId,note:String(link.note||'')}));
  return d.links;
}
function isLinkableAccommodationType(type){
  return type==='camping'||type==='stellplatz'||isAccommodationHolidayType(type);
}
function currentHolidayDestinationLinks(){
  return [...document.querySelectorAll('#holidayDestinationLinkedList .destination-link-editor-card')].map(card=>({
    entryId:card.dataset.entryId||'',
    note:card.querySelector('.destination-link-note')?.value.trim()||''
  })).filter(link=>link.entryId);
}
function linkedAccommodationEntry(id){
  return state.entries.find(e=>e.id===id&&!e.deleted&&isLinkableAccommodationType(e.type))||null;
}
function linkedEntryLocation(e){
  return [e?.town,e?.region,e?.country].filter(Boolean).join(' · ');
}
function renderHolidayDestinationLinksEditor(linksInput=null){
  const list=document.getElementById('holidayDestinationLinkedList');
  const select=document.getElementById('holidayDestinationLinkSelect');
  if(!list||!select)return;
  const links=Array.isArray(linksInput)?linksInput:currentHolidayDestinationLinks();
  const unique=[]; const seen=new Set();
  links.forEach(link=>{if(link?.entryId&&!seen.has(link.entryId)){seen.add(link.entryId);unique.push({entryId:link.entryId,note:String(link.note||'')});}});
  if(!unique.length){
    list.innerHTML='<div class="visit-editor-empty">Noch keine Unterkunft verknüpft.</div>';
  }else{
    list.innerHTML=unique.map(link=>{
      const entry=linkedAccommodationEntry(link.entryId);
      if(!entry){
        return `<div class="destination-link-editor-card missing" data-entry-id="${escapeHtml(link.entryId)}"><div class="destination-link-editor-main"><div class="destination-link-thumb placeholder">?</div><div class="destination-link-editor-text"><strong>Unterkunft nicht mehr verfügbar</strong><small>Die Verknüpfung kann entfernt werden.</small></div><button type="button" class="destination-link-remove" data-remove-destination-link="${escapeHtml(link.entryId)}">Entfernen</button></div><label>Hinweis zur Verbindung<textarea class="destination-link-note" rows="2" placeholder="z. B. guter Ausgangspunkt …">${escapeHtml(link.note)}</textarea></label></div>`;
      }
      const media=imageById(entry,entry.titleImageId);
      const thumb=media?.dataUrl?`<img class="destination-link-thumb" src="${media.dataUrl}" alt="${escapeHtml(media.description||entry.name||'Unterkunft')}" />`:`<div class="destination-link-thumb placeholder">${escapeHtml(typeIcons[entry.type]||'⌂')}</div>`;
      return `<div class="destination-link-editor-card" data-entry-id="${escapeHtml(entry.id)}"><div class="destination-link-editor-main">${thumb}<div class="destination-link-editor-text"><strong>${escapeHtml(entry.name||'Ohne Namen')}</strong><small>${escapeHtml(typeLabels[entry.type]||entry.type)}${linkedEntryLocation(entry)?` · ${escapeHtml(linkedEntryLocation(entry))}`:''}</small></div><button type="button" class="destination-link-remove" data-remove-destination-link="${escapeHtml(entry.id)}">Entfernen</button></div><label>Hinweis zur Verbindung<textarea class="destination-link-note" rows="2" placeholder="z. B. 5 km vom Ziel, guter Ausgangspunkt …">${escapeHtml(link.note)}</textarea></label></div>`;
    }).join('');
  }
  const linkedIds=new Set(unique.map(link=>link.entryId));
  const candidates=state.entries.filter(e=>!e.deleted&&isLinkableAccommodationType(e.type)&&!linkedIds.has(e.id)).sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'));
  select.innerHTML='<option value="">Unterkunft auswählen …</option>'+candidates.map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.name||'Ohne Namen')} · ${escapeHtml(typeLabels[e.type]||e.type)}${linkedEntryLocation(e)?` · ${escapeHtml(linkedEntryLocation(e))}`:''}</option>`).join('');
  select.disabled=!candidates.length;
  const add=document.getElementById('addHolidayDestinationLink'); if(add)add.disabled=!candidates.length;
  const help=document.getElementById('holidayDestinationLinkHelp');
  if(help)help.textContent=candidates.length?'Es werden nur bereits gespeicherte Unterkünfte angeboten.':'Alle verfügbaren Unterkünfte sind bereits verknüpft oder es ist noch keine Unterkunft gespeichert.';
}
function addHolidayDestinationLink(){
  const select=document.getElementById('holidayDestinationLinkSelect'); if(!select?.value)return;
  const links=currentHolidayDestinationLinks();
  if(!links.some(link=>link.entryId===select.value))links.push({entryId:select.value,note:''});
  renderHolidayDestinationLinksEditor(links);
}
function holidayDestinationActivitySettings(){
  const value=loadSettings().holidayDestinationCustomActivities;
  return Array.isArray(value)?value.filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()):[];
}
function setHolidayDestinationActivitySettings(values){updateSetting('holidayDestinationCustomActivities',[...new Set(values.map(v=>String(v).trim()).filter(Boolean))]);}
function currentHolidayDestinationActivities(){return [...document.querySelectorAll('#holidayDestinationActivityOptions input[type="checkbox"]:checked')].map(el=>el.value);}
function renderHolidayDestinationActivities(selectedInput=null){
  const container=document.getElementById('holidayDestinationActivityOptions'); if(!container)return;
  const selected=new Set(selectedInput??currentHolidayDestinationActivities());
  const custom=holidayDestinationActivitySettings();
  const selectedCustom=[...selected].map(customActivityLabel).filter(Boolean);
  const customLabels=[...new Set([...custom,...selectedCustom])];
  const standardHtml=HOLIDAY_DESTINATION_ACTIVITIES.map(([value,label])=>`<label class="check-option"><input type="checkbox" value="${escapeHtml(value)}" ${selected.has(value)?'checked':''}/> ${escapeHtml(label)}</label>`).join('');
  const customHtml=customLabels.map(label=>{const value=customActivityValue(label);return `<div class="destination-custom-choice"><label class="check-option"><input type="checkbox" value="${escapeHtml(value)}" ${selected.has(value)?'checked':''}/> ${escapeHtml(label)}</label><button type="button" class="destination-delete-choice" data-destination-activity-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)} löschen">×</button></div>`;}).join('');
  container.innerHTML=standardHtml+customHtml;
}
function addHolidayDestinationActivity(){
  const input=document.getElementById('holidayDestinationNewActivity'); if(!input)return;
  const label=input.value.trim().replace(/\s+/g,' '); if(!label)return;
  const existing=[...HOLIDAY_DESTINATION_ACTIVITIES.map(x=>x[1]),...holidayDestinationActivitySettings()];
  if(existing.some(x=>x.toLocaleLowerCase('de-DE')===label.toLocaleLowerCase('de-DE'))){alert('Diese Aktivität ist bereits vorhanden.');return;}
  const selected=currentHolidayDestinationActivities(); setHolidayDestinationActivitySettings([...holidayDestinationActivitySettings(),label]); selected.push(customActivityValue(label)); renderHolidayDestinationActivities(selected); input.value=''; input.focus();
}
function deleteHolidayDestinationActivity(label){
  const value=customActivityValue(label);
  const used=state.entries.filter(e=>e.type==='reiseziel'&&!e.deleted).filter(e=>Array.isArray(e.details?.reiseziel?.highlights?.activities)&&e.details.reiseziel.highlights.activities.includes(value));
  if(used.length){alert(`„${label}“ wird noch in ${used.length} ${used.length===1?'Reiseziel':'Reisezielen'} verwendet. Entferne die Auswahl dort zuerst, bevor du sie löschst.`);return;}
  if(!confirm(`Eigene Aktivität „${label}“ wirklich löschen?`))return;
  const selected=currentHolidayDestinationActivities().filter(v=>v!==value); setHolidayDestinationActivitySettings(holidayDestinationActivitySettings().filter(x=>x!==label)); renderHolidayDestinationActivities(selected);
}
function holidayDestinationSettings(kind){
  const key=kind==='character'?'holidayDestinationCustomCharacters':'holidayDestinationCustomCategories';
  const value=loadSettings()[key];
  return Array.isArray(value)?value.filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()):[];
}
function setHolidayDestinationSettings(kind,values){
  const key=kind==='character'?'holidayDestinationCustomCharacters':'holidayDestinationCustomCategories';
  updateSetting(key,[...new Set(values.map(v=>String(v).trim()).filter(Boolean))]);
}
function currentHolidayDestinationSelections(kind){
  const id=kind==='character'?'holidayDestinationCharacterOptions':'holidayDestinationCategoryOptions';
  return [...document.querySelectorAll(`#${id} input[type="checkbox"]:checked`)].map(el=>el.value);
}
function renderHolidayDestinationChoices(categorySelected=null,characterSelected=null){
  const renderKind=(kind,selectedInput)=>{
    const container=document.getElementById(kind==='character'?'holidayDestinationCharacterOptions':'holidayDestinationCategoryOptions');
    if(!container)return;
    const selected=new Set(selectedInput??currentHolidayDestinationSelections(kind));
    const standards=kind==='character'?HOLIDAY_DESTINATION_CHARACTERS:HOLIDAY_DESTINATION_CATEGORIES;
    const custom=holidayDestinationSettings(kind);
    const selectedCustom=[...selected].map(customDestinationLabel).filter(Boolean);
    const customLabels=[...new Set([...custom,...selectedCustom])];
    const standardHtml=standards.map(([value,label])=>`<label class="check-option"><input type="checkbox" value="${escapeHtml(value)}" ${selected.has(value)?'checked':''}/> ${escapeHtml(label)}</label>`).join('');
    const customHtml=customLabels.map(label=>{
      const value=customDestinationValue(label);
      return `<div class="destination-custom-choice"><label class="check-option"><input type="checkbox" value="${escapeHtml(value)}" ${selected.has(value)?'checked':''}/> ${escapeHtml(label)}</label><button type="button" class="destination-delete-choice" data-destination-kind="${kind}" data-destination-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)} löschen">×</button></div>`;
    }).join('');
    container.innerHTML=standardHtml+customHtml;
  };
  renderKind('category',categorySelected);
  renderKind('character',characterSelected);
}
function addHolidayDestinationCustom(kind){
  const input=document.getElementById(kind==='character'?'holidayDestinationNewCharacter':'holidayDestinationNewCategory');
  if(!input)return;
  const label=input.value.trim().replace(/\s+/g,' ');
  if(!label)return;
  const standards=kind==='character'?HOLIDAY_DESTINATION_CHARACTERS:HOLIDAY_DESTINATION_CATEGORIES;
  const existingLabels=[...standards.map(x=>x[1]),...holidayDestinationSettings(kind)];
  if(existingLabels.some(x=>x.toLocaleLowerCase('de-DE')===label.toLocaleLowerCase('de-DE'))){
    alert('Diese Auswahl ist bereits vorhanden.'); return;
  }
  const cats=currentHolidayDestinationSelections('category');
  const chars=currentHolidayDestinationSelections('character');
  setHolidayDestinationSettings(kind,[...holidayDestinationSettings(kind),label]);
  const value=customDestinationValue(label);
  if(kind==='category')cats.push(value);else chars.push(value);
  renderHolidayDestinationChoices(cats,chars);
  input.value=''; input.focus();
}
function deleteHolidayDestinationCustom(kind,label){
  const value=customDestinationValue(label);
  const used=state.entries.filter(e=>e.type==='reiseziel'&&!e.deleted).filter(e=>{
    const destination=e.details?.reiseziel?.destination||{};
    const values=kind==='character'?destination.characters:destination.categories;
    return Array.isArray(values)&&values.includes(value);
  });
  if(used.length){
    alert(`„${label}“ wird noch in ${used.length} ${used.length===1?'Reiseziel':'Reisezielen'} verwendet. Entferne die Auswahl dort zuerst, bevor du sie löschst.`);
    return;
  }
  if(!confirm(`Eigene ${kind==='character'?'Charakter-Auswahl':'Kategorie'} „${label}“ wirklich löschen?`))return;
  const cats=currentHolidayDestinationSelections('category').filter(v=>v!==value);
  const chars=currentHolidayDestinationSelections('character').filter(v=>v!==value);
  setHolidayDestinationSettings(kind,holidayDestinationSettings(kind).filter(x=>x!==label));
  renderHolidayDestinationChoices(cats,chars);
}
function updateHolidayDestinationConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const section=document.getElementById('holidayDestinationSection');
  if(section)section.hidden=type!=='reiseziel';
}
function updateHolidayVisitPlanningConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const section=document.getElementById('holidayVisitPlanningSection');
  if(section)section.hidden=type!=='reiseziel';
  const yearRound=document.getElementById('holidayVisitYearRound')?.value||'unknown';
  const seasonWrap=document.getElementById('holidayVisitSeasonWrap');
  if(seasonWrap)seasonWrap.hidden=yearRound!=='no';
  const hoursKnown=document.getElementById('holidayVisitHoursKnown')?.value||'unknown';
  const hoursWrap=document.getElementById('holidayVisitHoursWrap');
  if(hoursWrap)hoursWrap.hidden=hoursKnown!=='yes';
}
function updateHolidayDestinationCostsConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const section=document.getElementById('holidayDestinationCostsSection');
  if(section)section.hidden=type!=='reiseziel';
  const admission=document.getElementById('holidayDestinationAdmission')?.value||'unknown';
  const prices=document.getElementById('holidayDestinationAdmissionPrices');
  if(prices)prices.hidden=admission!=='paid';
  const parking=document.getElementById('holidayDestinationParkingCost')?.value||'unknown';
  const parkingPrice=document.getElementById('holidayDestinationParkingPriceWrap');
  if(parkingPrice)parkingPrice.hidden=parking!=='paid';
}
function updateHolidayDestinationArrivalConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const section=document.getElementById('holidayDestinationArrivalSection');
  if(section)section.hidden=type!=='reiseziel';
  const access=document.getElementById('holidayDestinationAccess')?.value||'unknown';
  const accessNotes=document.getElementById('holidayDestinationAccessNotesWrap');
  if(accessNotes)accessNotes.hidden=access!=='restricted';
  const parking=document.getElementById('holidayDestinationParkingAvailable')?.value||'unknown';
  const parkingNotes=document.getElementById('holidayDestinationParkingNotesWrap');
  if(parkingNotes)parkingNotes.hidden=parking!=='yes';
  const motorhome=document.getElementById('holidayDestinationMotorhomeParking')?.value||'unknown';
  const motorhomeNotes=document.getElementById('holidayDestinationMotorhomeNotesWrap');
  if(motorhomeNotes)motorhomeNotes.hidden=motorhome!=='yes';
}
function updateHolidayDestinationHighlightsConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const section=document.getElementById('holidayDestinationHighlightsSection'); if(section)section.hidden=type!=='reiseziel';
}
function updateHolidayDestinationLinksConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const section=document.getElementById('holidayDestinationLinksSection'); if(section)section.hidden=type!=='reiseziel';
}
function updateHolidayDestinationNotesConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const section=document.getElementById('holidayDestinationNotesSection'); if(section)section.hidden=type!=='reiseziel';
}
function updateHolidayBasicConditionalFields(){
  const type=document.getElementById('holidayEntryType')?.value||'hotel';
  const booking=document.getElementById('holidayBookingWrap');
  const websiteLabel=document.getElementById('holidayWebsiteLabel');
  if(booking) booking.hidden=!isAccommodationHolidayType(type);
  if(websiteLabel){
    websiteLabel.childNodes[0].nodeValue=type==='reiseziel'?'Website des Reiseziels\n          ':'Website der Unterkunft\n          ';
  }
  updateHolidayDestinationConditionalFields();
  updateHolidayVisitPlanningConditionalFields();
  updateHolidayDestinationCostsConditionalFields();
  updateHolidayDestinationArrivalConditionalFields();
  updateHolidayDestinationHighlightsConditionalFields();
  updateHolidayDestinationLinksConditionalFields();
  updateHolidayDestinationNotesConditionalFields();
  updateHolidayAccommodationConditionalFields();
  updateHolidayPriceConditionalFields();
  updateHolidayStayConditionalFields();
  updateHolidayFoodConditionalFields();
  updateHolidayLeisureConditionalFields();
  updateHolidayLocationConditionalFields();
  updateHolidayDogConditionalFields();
  updateHolidayPersonalConditionalFields();
}
function openHolidayEditor(entry=null,pretype='hotel'){
  const dlg=document.getElementById('holidayEditDialog');
  const form=document.getElementById('holidayEditForm');
  if(!dlg||!form)return;
  form.reset();
  holidayEditMode=entry?'edit':'create';
  setField('holidayEditId',entry?.id||'');
  document.getElementById('holidayEditTitle').textContent=entry?'Urlaub bearbeiten':'Urlaub eintragen';
  document.getElementById('holidaySubmitBtn').textContent=entry?'Änderungen speichern':'Speichern';
  let type=entry?.type||pretype||'hotel';
  if(type==='ferien') type='ferienwohnung';
  setField('holidayEntryType',type);
  if(isAccommodationHolidayType(type)) setField('holidayAccommodationType',type);
  setField('holidayName',entry?.name||'');
  setField('holidayCountry',entry?.country||'');
  setField('holidayRegion',entry?.region||'');
  setField('holidayTravelRegions',(entry?.travelRegions||[]).join(', '));
  setField('holidayTown',entry?.town||'');
  setField('holidayAddress',entry?.address||'');
  setField('holidayWebsite',entry?.website||'');
  setField('holidayPhone',entry?.phone||'');
  setField('holidayEmail',entry?.email||'');
  setField('holidaySourceType',entry?.sourceType||'');
  setField('holidaySourceUrl',sourceUrl(entry||{}));
  setField('holidayBookingUrl',entry?.bookingUrl||'');
  const destination=entry&&type==='reiseziel'?ensureHolidayDestination(entry):{};
  setField('holidayDestinationScope',destination.scope||'unknown');
  setField('holidayDestinationWish',destination.wish||'');
  renderHolidayDestinationChoices(destination.categories||[],destination.characters||[]);
  const visitPlanning=entry&&type==='reiseziel'?ensureHolidayVisitPlanning(entry):{};
  setField('holidayVisitYearRound',visitPlanning.yearRound||'unknown');
  setField('holidayVisitSeasonFrom',visitPlanning.seasonFrom||'');
  setField('holidayVisitSeasonUntil',visitPlanning.seasonUntil||'');
  setField('holidayVisitHoursKnown',visitPlanning.hoursKnown||'unknown');
  setField('holidayVisitHours',visitPlanning.hours||'');
  setField('holidayVisitDuration',visitPlanning.duration);
  setField('holidayVisitDurationUnit',visitPlanning.durationUnit||'hours');
  setField('holidayVisitTicket',visitPlanning.ticket||'unknown');
  setCheckboxGroup('holidayVisitBestTime',visitPlanning.bestTime||[]);
  setField('holidayVisitNotes',visitPlanning.notes||'');
  const destinationCosts=entry&&type==='reiseziel'?ensureHolidayDestinationCosts(entry):{};
  setField('holidayDestinationAdmission',destinationCosts.admission||'unknown');
  setField('holidayDestinationAdultPrice',destinationCosts.adultPrice);
  setField('holidayDestinationChildPrice',destinationCosts.childPrice);
  setField('holidayDestinationFamilyPrice',destinationCosts.familyPrice);
  setField('holidayDestinationReducedPrice',destinationCosts.reducedPrice);
  setField('holidayDestinationParkingCost',destinationCosts.parking||'unknown');
  setField('holidayDestinationParkingPrice',destinationCosts.parkingPrice);
  setField('holidayDestinationOtherCosts',destinationCosts.otherCosts||'');
  setField('holidayDestinationPriceYear',destinationCosts.priceYear);
  setField('holidayDestinationCostNotes',destinationCosts.notes||'');
  const destinationArrival=entry&&type==='reiseziel'?ensureHolidayDestinationArrival(entry):{};
  setField('holidayDestinationMotorwayDistance',destinationArrival.motorwayDistance);
  setField('holidayDestinationMotorwayJunction',destinationArrival.motorwayJunction||'');
  setField('holidayDestinationAccess',destinationArrival.access||'unknown');
  setField('holidayDestinationAccessNotes',destinationArrival.accessNotes||'');
  setField('holidayDestinationParkingAvailable',destinationArrival.parkingAvailable||'unknown');
  setField('holidayDestinationParkingNotes',destinationArrival.parkingNotes||'');
  setField('holidayDestinationMotorhomeParking',destinationArrival.motorhomeParking||'unknown');
  setField('holidayDestinationMotorhomeNotes',destinationArrival.motorhomeNotes||'');
  setCheckboxGroup('holidayDestinationTransport',destinationArrival.transport||[]);
  setField('holidayDestinationTransportNotes',destinationArrival.transportNotes||'');
  setField('holidayDestinationWalkDistance',destinationArrival.walkDistance);
  setField('holidayDestinationWalkMinutes',destinationArrival.walkMinutes);
  const destinationHighlights=entry&&type==='reiseziel'?ensureHolidayDestinationHighlights(entry):{};
  renderHolidayDestinationActivities(destinationHighlights.activities||[]);
  setField('holidayDestinationHighlights',destinationHighlights.highlights||'');
  setField('holidayDestinationPlans',destinationHighlights.plans||'');
  const destinationLinks=entry&&type==='reiseziel'?ensureHolidayDestinationLinks(entry):{};
  renderHolidayDestinationLinksEditor(destinationLinks.accommodations||[]);
  const destinationNotes=entry&&type==='reiseziel'?ensureHolidayDestinationNotes(entry):{};
  setField('holidayDestinationImportantNotes',destinationNotes.important||'');
  setField('holidayDestinationBringNotes',destinationNotes.bring||'');
  setField('holidayDestinationInsiderTips',destinationNotes.insider||'');
  const acc=entry&&isAccommodationHolidayType(type)?ensureHolidayAccommodation(entry):{};
  setField('holidayAccMaxPersons',acc.maxPersons); setField('holidayAccBedrooms',acc.bedrooms); setField('holidayAccBeds',acc.beds); setField('holidayAccBathrooms',acc.bathrooms); setField('holidayAccSize',acc.size); setField('holidayAccBathroomType',acc.bathroomType||'unknown');
  setField('holidayAccWifi',acc.wifi||'unknown'); setField('holidayAccWifiBilling',acc.wifiBilling||'unknown'); setField('holidayAccWifiPrice',acc.wifiPrice);
  ['Aircon','Heating','Balcony','Terrace','Garden','Elevator','Accessible','Washer','Dryer','Reception','Reception24','RoomService','RoomCleaning','Safe','Minibar','CoffeeTea','Stove','Oven','Microwave','Fridge','Freezer','Dishwasher','Coffee','Kettle','Toaster'].forEach(k=>setChecked('holidayAcc'+k,acc[k.charAt(0).toLowerCase()+k.slice(1)]));
  setField('holidayAccHotelStars',acc.hotelStars); setField('holidayAccRoomType',acc.roomType||'unknown'); setField('holidayAccKitchen',acc.kitchen||'unknown'); setField('holidayAccHouseType',acc.houseType||'unknown'); setField('holidayAccFloor',acc.floor||''); setField('holidayAccSpecialType',acc.specialType||'unknown'); setField('holidayAccLinen',acc.linen||'unknown'); setField('holidayAccLinenPrice',acc.linenPrice); setField('holidayAccTowels',acc.towels||'unknown'); setField('holidayAccTowelsPrice',acc.towelsPrice);
  const prices=entry&&isAccommodationHolidayType(type)?ensureHolidayPrices(entry):{};
  setField('holidayPriceYear',prices.year);
  setField('holidayPriceFrom',prices.priceFrom);
  setField('holidayPriceBilling',prices.billing||'unknown');
  setField('holidayPriceBasis',prices.basis||'unknown');
  setField('holidayHotelOccupancy',prices.hotelOccupancy||'unknown');
  setField('holidayHotelOccupancyOther',prices.hotelOccupancyOther);
  setField('holidayTouristTax',prices.touristTax);
  setField('holidayCleaningFee',prices.cleaningFee);
  setField('holidayBookingFee',prices.bookingFee);
  setField('holidayOtherFee',prices.otherFee);
  setField('holidayOtherFeeLabel',prices.otherFeeLabel||'');
  setField('holidayReservationStatus',prices.reservationStatus||'unknown');
  setField('holidayFreeCancellation',prices.freeCancellation||'unknown');
  setField('holidayCancellationUntil',prices.cancellationUntil||'');
  setField('holidayOfferArrival',prices.offer?.arrival||'');
  setField('holidayOfferDeparture',prices.offer?.departure||'');
  setField('holidayOfferPersons',prices.offer?.persons);
  setField('holidayOfferTotal',prices.offer?.total);
  setField('holidayPriceNotes',prices.notes||'');
  const stay=entry&&isAccommodationHolidayType(type)?ensureHolidayStay(entry):{};
  setField('holidayStayCheckinFrom',stay.checkinFrom||''); setField('holidayStayCheckinUntil',stay.checkinUntil||''); setField('holidayStayCheckoutUntil',stay.checkoutUntil||''); setField('holidayStayCheckinType',stay.checkinType||'unknown'); setField('holidayStayMinNights',stay.minNights); setField('holidayStayFlexible',stay.flexible||'unknown'); setField('holidayStayLate',stay.late||'unknown'); setField('holidayStayParking',stay.parking||'unknown'); setField('holidayStayParkingBilling',stay.parkingBilling||'unknown'); setField('holidayStayParkingType',stay.parkingType||'unknown'); setField('holidayStayParkingPrice',stay.parkingPrice); setField('holidayStayArrivalNotes',stay.arrivalNotes||''); setField('holidayStayDeposit',stay.deposit||'unknown'); setField('holidayStayDepositAmount',stay.depositAmount); setField('holidayStayDepositMethod',stay.depositMethod||'unknown');
  const food=entry&&isAccommodationHolidayType(type)?ensureHolidayFood(entry):{};
  ['None','Breakfast','HalfBoard','FullBoard','AllInclusive','Restaurant','Bar','Cafe','BreakfastService','BreadService','FarmShop','Groceries','Regional'].forEach(k=>setChecked('holidayFood'+k,food[k.charAt(0).toLowerCase()+k.slice(1)]));
  setField('holidayFoodStatus',food.status||'unknown'); setField('holidayFoodBreakfastPrice',food.breakfastPrice); setField('holidayFoodHalfBoardPrice',food.halfBoardPrice); setField('holidayFoodFullBoardPrice',food.fullBoardPrice); setField('holidayFoodAllInclusivePrice',food.allInclusivePrice); setField('holidayFoodNotes',food.notes||'');
  const leisure=entry&&isAccommodationHolidayType(type)?ensureHolidayLeisure(entry):{};
  setField('holidayLeisureOutdoorPool',leisure.outdoorPool||'unknown'); setField('holidayLeisureOutdoorPoolUse',leisure.outdoorPoolUse||'unknown'); setField('holidayLeisureIndoorPool',leisure.indoorPool||'unknown'); setField('holidayLeisureIndoorPoolUse',leisure.indoorPoolUse||'unknown'); setField('holidayLeisureSauna',leisure.sauna||'unknown'); setField('holidayLeisureSaunaUse',leisure.saunaUse||'unknown'); setField('holidayLeisureWhirlpool',leisure.whirlpool||'unknown'); setField('holidayLeisureWhirlpoolUse',leisure.whirlpoolUse||'unknown');
  ['PoolHeated','PoolSeasonal','Wellness','Massage','BathingAccess','PrivateBeach','Fitness','BikeRental','EBikeRental','Tennis','TableTennis','MiniGolf','WaterSports','SkiRoom','SkiInOut','Playground','Playroom','Childcare','Entertainment','KidsProgram'].forEach(k=>setChecked('holidayLeisure'+k,leisure[k.charAt(0).toLowerCase()+k.slice(1)]));
  setField('holidayLeisureNotes',leisure.notes||'');
  const location=entry&&isAccommodationHolidayType(type)?ensureHolidayLocation(entry):{distances:{},mobility:{}};
  setCheckboxGroup('holidayLocationFeatures',location.features||[]);
  const hld=location.distances||{};
  [['Centre','centre'],['Supermarket','supermarket'],['Restaurant','restaurant'],['Bakery','bakery'],['Water','water'],['Sights','sights']].forEach(([suffix,key])=>{setField('holidayDistance'+suffix,hld[key]?.km);setField('holidayWalk'+suffix,hld[key]?.walkable||'unknown');});
  setField('holidayAirportDistance',location.airportDistance); setField('holidayMotorwayDistance',location.motorwayDistance); setField('holidayMotorwayJunction',location.motorwayJunction||'');
  const hlm=location.mobility||{}; setField('holidayMobilityPublicTransport',hlm.publicTransport||'unknown'); setField('holidayMobilityBus',hlm.bus||'unknown'); setField('holidayMobilityTrain',hlm.train||'unknown'); setField('holidayMobilityCycle',hlm.cycle||'unknown'); setField('holidayMobilityHiking',hlm.hiking||'unknown'); setField('holidayMobilityCableCar',hlm.cableCar||'unknown'); setField('holidayMobilityFerry',hlm.ferry||'unknown'); setField('holidayLocationNotes',location.notes||'');
  const dog=entry&&isAccommodationHolidayType(type)?ensureHolidayDog(entry):{};
  setField('holidayDogAllowed',dog.allowed||'unknown'); setField('holidayDogMaxCount',dog.maxCount); setField('holidayDogFeeType',dog.feeType||'unknown'); setField('holidayDogFee',dog.fee); setField('holidayDogSizeWeight',dog.sizeWeight||''); setField('holidayDogRestrictedUnits',dog.restrictedUnits||'unknown'); setField('holidayDogLeash',dog.leash||'unknown'); setField('holidayDogAlone',dog.alone||'unknown'); setField('holidayDogAloneNotes',dog.aloneNotes||''); setField('holidayDogRun',dog.run||'unknown'); setField('holidayDogBeach',dog.beach||'unknown'); setField('holidayDogSwimming',dog.swimming||'unknown'); setField('holidayDogShower',dog.shower||'unknown'); setField('holidayDogRestaurant',dog.restaurant||'unknown'); setField('holidayDogNotes',dog.notes||'');
  const personal=entry?ensureHolidayPersonal(entry):{ratings:{},returnIntent:'unknown'};
  setField('holidayPersonalStatus',entry?.visited?'visited':entry?.wantToVisit?'want':'none');
  const holidayFavorite=document.getElementById('holidayPersonalFavorite'); if(holidayFavorite) holidayFavorite.checked=!!entry?.favorite;
  setField('holidayPersonalWhy',entry?.why||'');
  setField('holidayRatingLocation',personal.ratings?.location); setField('holidayRatingQuiet',personal.ratings?.quiet); setField('holidayRatingCleanliness',personal.ratings?.cleanliness); setField('holidayRatingEquipment',personal.ratings?.equipment); setField('holidayRatingService',personal.ratings?.service); setField('holidayRatingValue',personal.ratings?.value); setField('holidayRatingExperience',personal.ratings?.experience); setField('holidayRatingSightseeing',personal.ratings?.sightseeing);
  setField('holidayPersonalReturn',personal.returnIntent||'unknown'); setField('holidayPersonalNotes',entry?.notes||'');
  holidayMediaDraft=cloneMediaList(entry?.media||[]);
  holidayTitleImageDraft=entry?.titleImageId||null;
  renderHolidayMediaEditor();
  updateHolidayBasicConditionalFields();
  document.querySelectorAll('#holidayAccommodationSection .holiday-subaccordion').forEach(d=>d.open=false);
  renderHolidayVisitEditor(entry?.visits||[],type);
  const detail=document.getElementById('detailDialog');
  if(detail?.open)detail.close();
  dlg.showModal();
  setTimeout(()=>document.getElementById('holidayName')?.focus(),80);
}
function closeHolidayEditor(){
  const dlg=document.getElementById('holidayEditDialog');
  if(dlg?.open)dlg.close();
  holidayEditMode='create';
}
function splitCommaValues(value){
  return [...new Set(String(value||'').split(',').map(x=>x.trim()).filter(Boolean))];
}
function saveHolidayBasic(ev){
  ev?.preventDefault?.();
  const id=document.getElementById('holidayEditId')?.value||'';
  const existing=holidayEditMode==='edit'?state.entries.find(x=>x.id===id):null;
  const existingSnapshot=existing?JSON.parse(JSON.stringify(existing)):null;
  const selectedType=document.getElementById('holidayEntryType')?.value||'';
  const nameField=document.getElementById('holidayName');
  if(!selectedType || !nameField?.value.trim()){
    alert('Bitte mindestens einen Namen für den Eintrag angeben.');
    nameField?.focus();
    return;
  }
  if(existing && !convertEntryType(existing,selectedType)) return;
  const entry=existing||{
    id:uid(), type:selectedType, name:'', country:'', region:'', source:'', sourceType:'', sourceUrl:'',
    geoTags:[], tags:[], favorite:false, wantToVisit:false, visited:false, deleted:false,
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), location:null, accessPoint:null, visits:[], media:[], details:{}
  };
  entry.type=selectedType;
  entry.name=nameField.value.trim();
  entry.country=document.getElementById('holidayCountry').value.trim();
  entry.region=document.getElementById('holidayRegion').value.trim();
  entry.travelRegions=splitCommaValues(document.getElementById('holidayTravelRegions').value);
  entry.town=document.getElementById('holidayTown').value.trim();
  entry.address=document.getElementById('holidayAddress').value.trim();
  entry.website=normalizeExternalUrl(document.getElementById('holidayWebsite').value)||document.getElementById('holidayWebsite').value.trim();
  entry.phone=document.getElementById('holidayPhone').value.trim();
  entry.email=document.getElementById('holidayEmail').value.trim();
  entry.source='';
  entry.sourceType=document.getElementById('holidaySourceType').value;
  entry.sourceUrl=normalizeExternalUrl(document.getElementById('holidaySourceUrl').value)||document.getElementById('holidaySourceUrl').value.trim();
  entry.bookingUrl=isAccommodationHolidayType(selectedType)?(normalizeExternalUrl(document.getElementById('holidayBookingUrl').value)||document.getElementById('holidayBookingUrl').value.trim()):'';
  if(isAccommodationHolidayType(selectedType)){
    const acc=ensureHolidayAccommodation(entry);
    acc.maxPersons=numericField('holidayAccMaxPersons'); acc.bedrooms=numericField('holidayAccBedrooms'); acc.beds=numericField('holidayAccBeds'); acc.bathrooms=numericField('holidayAccBathrooms'); acc.size=numericField('holidayAccSize'); acc.bathroomType=document.getElementById('holidayAccBathroomType').value||'unknown';
    acc.wifi=document.getElementById('holidayAccWifi').value||'unknown'; acc.wifiBilling=acc.wifi==='yes'?(document.getElementById('holidayAccWifiBilling').value||'unknown'):'unknown'; acc.wifiPrice=acc.wifi==='yes'&&acc.wifiBilling==='paid'?numericField('holidayAccWifiPrice'):null;
    ['Aircon','Heating','Balcony','Terrace','Garden','Elevator','Accessible','Washer','Dryer','Reception','Reception24','RoomService','RoomCleaning','Safe','Minibar','CoffeeTea','Stove','Oven','Microwave','Fridge','Freezer','Dishwasher','Coffee','Kettle','Toaster'].forEach(k=>acc[k.charAt(0).toLowerCase()+k.slice(1)]=!!document.getElementById('holidayAcc'+k)?.checked);
    acc.hotelStars=selectedType==='hotel'?numericField('holidayAccHotelStars'):null; acc.roomType=selectedType==='hotel'?(document.getElementById('holidayAccRoomType').value||'unknown'):'unknown';
    acc.kitchen=document.getElementById('holidayAccKitchen').value||'unknown';
    if(acc.kitchen!=='yes'){['stove','oven','microwave','fridge','freezer','dishwasher','coffee','kettle','toaster'].forEach(k=>acc[k]=false);}
    acc.houseType=selectedType==='ferienhaus'?(document.getElementById('holidayAccHouseType').value||'unknown'):'unknown'; acc.floor=selectedType==='ferienwohnung'?document.getElementById('holidayAccFloor').value.trim():''; acc.specialType=selectedType==='besonders'?(document.getElementById('holidayAccSpecialType').value||'unknown'):'unknown';
    acc.linen=document.getElementById('holidayAccLinen').value||'unknown';acc.linenPrice=acc.linen==='paid'?numericField('holidayAccLinenPrice'):null;acc.towels=document.getElementById('holidayAccTowels').value||'unknown';acc.towelsPrice=acc.towels==='paid'?numericField('holidayAccTowelsPrice'):null;
    const prices=ensureHolidayPrices(entry);
    prices.year=numericField('holidayPriceYear');
    prices.priceFrom=numericField('holidayPriceFrom');
    prices.billing=document.getElementById('holidayPriceBilling').value||'unknown';
    prices.basis=document.getElementById('holidayPriceBasis').value||'unknown';
    prices.hotelOccupancy=selectedType==='hotel'?(document.getElementById('holidayHotelOccupancy').value||'unknown'):'unknown';
    prices.hotelOccupancyOther=selectedType==='hotel'&&prices.hotelOccupancy==='other'?numericField('holidayHotelOccupancyOther'):null;
    prices.touristTax=numericField('holidayTouristTax');
    prices.cleaningFee=numericField('holidayCleaningFee');
    prices.bookingFee=numericField('holidayBookingFee');
    prices.otherFee=numericField('holidayOtherFee');
    prices.otherFeeLabel=document.getElementById('holidayOtherFeeLabel').value.trim();
    prices.reservationStatus=document.getElementById('holidayReservationStatus').value||'unknown';
    prices.freeCancellation=document.getElementById('holidayFreeCancellation').value||'unknown';
    prices.cancellationUntil=prices.freeCancellation==='yes'?document.getElementById('holidayCancellationUntil').value.trim():'';
    prices.offer={
      arrival:document.getElementById('holidayOfferArrival').value||'',
      departure:document.getElementById('holidayOfferDeparture').value||'',
      persons:numericField('holidayOfferPersons'),
      total:numericField('holidayOfferTotal')
    };
    prices.notes=document.getElementById('holidayPriceNotes').value.trim();
    const stay=ensureHolidayStay(entry);
    stay.checkinFrom=document.getElementById('holidayStayCheckinFrom').value||''; stay.checkinUntil=document.getElementById('holidayStayCheckinUntil').value||''; stay.checkoutUntil=document.getElementById('holidayStayCheckoutUntil').value||''; stay.checkinType=document.getElementById('holidayStayCheckinType').value||'unknown'; stay.minNights=numericField('holidayStayMinNights'); stay.flexible=document.getElementById('holidayStayFlexible').value||'unknown'; stay.late=document.getElementById('holidayStayLate').value||'unknown';
    stay.parking=document.getElementById('holidayStayParking').value||'unknown'; stay.parkingBilling=stay.parking==='yes'?(document.getElementById('holidayStayParkingBilling').value||'unknown'):'unknown'; stay.parkingType=stay.parking==='yes'?(document.getElementById('holidayStayParkingType').value||'unknown'):'unknown'; stay.parkingPrice=stay.parking==='yes'&&stay.parkingBilling==='paid'?numericField('holidayStayParkingPrice'):null;
    stay.arrivalNotes=document.getElementById('holidayStayArrivalNotes').value.trim(); stay.deposit=document.getElementById('holidayStayDeposit').value||'unknown'; stay.depositAmount=stay.deposit==='required'?numericField('holidayStayDepositAmount'):null; stay.depositMethod=stay.deposit==='required'?(document.getElementById('holidayStayDepositMethod').value||'unknown'):'unknown';
    const food=ensureHolidayFood(entry);
    ['None','Breakfast','HalfBoard','FullBoard','AllInclusive','Restaurant','Bar','Cafe','BreakfastService','BreadService','FarmShop','Groceries','Regional'].forEach(k=>food[k.charAt(0).toLowerCase()+k.slice(1)]=!!document.getElementById('holidayFood'+k)?.checked);
    food.status=document.getElementById('holidayFoodStatus').value||'unknown';
    const foodCanCost=['optional','both'].includes(food.status);
    food.breakfastPrice=foodCanCost?numericField('holidayFoodBreakfastPrice'):null; food.halfBoardPrice=foodCanCost?numericField('holidayFoodHalfBoardPrice'):null; food.fullBoardPrice=foodCanCost?numericField('holidayFoodFullBoardPrice'):null; food.allInclusivePrice=foodCanCost?numericField('holidayFoodAllInclusivePrice'):null; food.notes=document.getElementById('holidayFoodNotes').value.trim();
    const leisure=ensureHolidayLeisure(entry);
    leisure.outdoorPool=document.getElementById('holidayLeisureOutdoorPool').value||'unknown'; leisure.outdoorPoolUse=leisure.outdoorPool==='yes'?(document.getElementById('holidayLeisureOutdoorPoolUse').value||'unknown'):'unknown';
    leisure.indoorPool=document.getElementById('holidayLeisureIndoorPool').value||'unknown'; leisure.indoorPoolUse=leisure.indoorPool==='yes'?(document.getElementById('holidayLeisureIndoorPoolUse').value||'unknown'):'unknown';
    leisure.sauna=document.getElementById('holidayLeisureSauna').value||'unknown'; leisure.saunaUse=leisure.sauna==='yes'?(document.getElementById('holidayLeisureSaunaUse').value||'unknown'):'unknown';
    leisure.whirlpool=document.getElementById('holidayLeisureWhirlpool').value||'unknown'; leisure.whirlpoolUse=leisure.whirlpool==='yes'?(document.getElementById('holidayLeisureWhirlpoolUse').value||'unknown'):'unknown';
    ['PoolHeated','PoolSeasonal','Wellness','Massage','BathingAccess','PrivateBeach','Fitness','BikeRental','EBikeRental','Tennis','TableTennis','MiniGolf','WaterSports','SkiRoom','SkiInOut','Playground','Playroom','Childcare','Entertainment','KidsProgram'].forEach(k=>leisure[k.charAt(0).toLowerCase()+k.slice(1)]=!!document.getElementById('holidayLeisure'+k)?.checked);
    if(leisure.outdoorPool!=='yes'&&leisure.indoorPool!=='yes'){leisure.poolHeated=false;leisure.poolSeasonal=false;}
    if(selectedType!=='hotel'){leisure.entertainment=false;leisure.kidsProgram=false;}
    leisure.notes=document.getElementById('holidayLeisureNotes').value.trim();
    const location=ensureHolidayLocation(entry);
    location.features=getCheckboxGroup('holidayLocationFeatures');
    location.distances={
      centre:{km:numericField('holidayDistanceCentre'),walkable:document.getElementById('holidayWalkCentre').value},
      supermarket:{km:numericField('holidayDistanceSupermarket'),walkable:document.getElementById('holidayWalkSupermarket').value},
      restaurant:{km:numericField('holidayDistanceRestaurant'),walkable:document.getElementById('holidayWalkRestaurant').value},
      bakery:{km:numericField('holidayDistanceBakery'),walkable:document.getElementById('holidayWalkBakery').value},
      water:{km:numericField('holidayDistanceWater'),walkable:document.getElementById('holidayWalkWater').value},
      sights:{km:numericField('holidayDistanceSights'),walkable:document.getElementById('holidayWalkSights').value}
    };
    location.airportDistance=numericField('holidayAirportDistance'); location.motorwayDistance=numericField('holidayMotorwayDistance'); location.motorwayJunction=document.getElementById('holidayMotorwayJunction').value.trim();
    location.mobility={publicTransport:document.getElementById('holidayMobilityPublicTransport').value,bus:document.getElementById('holidayMobilityBus').value,train:document.getElementById('holidayMobilityTrain').value,cycle:document.getElementById('holidayMobilityCycle').value,hiking:document.getElementById('holidayMobilityHiking').value,cableCar:document.getElementById('holidayMobilityCableCar').value,ferry:document.getElementById('holidayMobilityFerry').value};
    location.notes=document.getElementById('holidayLocationNotes').value.trim();
    const dog=ensureHolidayDog(entry);
    dog.allowed=document.getElementById('holidayDogAllowed').value||'unknown';
    if(dog.allowed==='yes'){
      dog.maxCount=numericField('holidayDogMaxCount'); dog.feeType=document.getElementById('holidayDogFeeType').value||'unknown'; dog.fee=dog.feeType==='paid'?numericField('holidayDogFee'):null; dog.sizeWeight=document.getElementById('holidayDogSizeWeight').value.trim(); dog.restrictedUnits=document.getElementById('holidayDogRestrictedUnits').value||'unknown'; dog.leash=document.getElementById('holidayDogLeash').value||'unknown'; dog.alone=document.getElementById('holidayDogAlone').value||'unknown'; dog.aloneNotes=dog.alone==='conditional'?document.getElementById('holidayDogAloneNotes').value.trim():''; dog.run=document.getElementById('holidayDogRun').value||'unknown'; dog.beach=document.getElementById('holidayDogBeach').value||'unknown'; dog.swimming=document.getElementById('holidayDogSwimming').value||'unknown'; dog.shower=document.getElementById('holidayDogShower').value||'unknown'; dog.restaurant=document.getElementById('holidayDogRestaurant').value||'unknown'; dog.notes=document.getElementById('holidayDogNotes').value.trim();
    }else{
      dog.maxCount=null; dog.feeType='unknown'; dog.fee=null; dog.sizeWeight=''; dog.restrictedUnits='unknown'; dog.leash='unknown'; dog.alone='unknown'; dog.aloneNotes=''; dog.run='unknown'; dog.beach='unknown'; dog.swimming='unknown'; dog.shower='unknown'; dog.restaurant='unknown'; dog.notes='';
    }
  }
  if(selectedType==='reiseziel'){
    const destination=ensureHolidayDestination(entry);
    const scopeField=document.getElementById('holidayDestinationScope');
    const wishField=document.getElementById('holidayDestinationWish');
    destination.scope=scopeField?.value||'unknown';
    destination.categories=[...currentHolidayDestinationSelections('category')];
    destination.characters=[...currentHolidayDestinationSelections('character')];
    destination.wish=(wishField?.value||'').trim();
    const visitPlanning=ensureHolidayVisitPlanning(entry);
    visitPlanning.yearRound=document.getElementById('holidayVisitYearRound')?.value||'unknown';
    visitPlanning.seasonFrom=visitPlanning.yearRound==='no'?(document.getElementById('holidayVisitSeasonFrom')?.value||''):'';
    visitPlanning.seasonUntil=visitPlanning.yearRound==='no'?(document.getElementById('holidayVisitSeasonUntil')?.value||''):'';
    visitPlanning.hoursKnown=document.getElementById('holidayVisitHoursKnown')?.value||'unknown';
    visitPlanning.hours=visitPlanning.hoursKnown==='yes'?(document.getElementById('holidayVisitHours')?.value||'').trim():'';
    visitPlanning.duration=numericField('holidayVisitDuration');
    visitPlanning.durationUnit=document.getElementById('holidayVisitDurationUnit')?.value||'hours';
    visitPlanning.ticket=document.getElementById('holidayVisitTicket')?.value||'unknown';
    visitPlanning.bestTime=getCheckboxGroup('holidayVisitBestTime');
    visitPlanning.notes=(document.getElementById('holidayVisitNotes')?.value||'').trim();
    const destinationCosts=ensureHolidayDestinationCosts(entry);
    destinationCosts.admission=document.getElementById('holidayDestinationAdmission')?.value||'unknown';
    destinationCosts.adultPrice=destinationCosts.admission==='paid'?numericField('holidayDestinationAdultPrice'):null;
    destinationCosts.childPrice=destinationCosts.admission==='paid'?numericField('holidayDestinationChildPrice'):null;
    destinationCosts.familyPrice=destinationCosts.admission==='paid'?numericField('holidayDestinationFamilyPrice'):null;
    destinationCosts.reducedPrice=destinationCosts.admission==='paid'?numericField('holidayDestinationReducedPrice'):null;
    destinationCosts.parking=document.getElementById('holidayDestinationParkingCost')?.value||'unknown';
    destinationCosts.parkingPrice=destinationCosts.parking==='paid'?numericField('holidayDestinationParkingPrice'):null;
    destinationCosts.otherCosts=(document.getElementById('holidayDestinationOtherCosts')?.value||'').trim();
    destinationCosts.priceYear=numericField('holidayDestinationPriceYear');
    destinationCosts.notes=(document.getElementById('holidayDestinationCostNotes')?.value||'').trim();
    const destinationArrival=ensureHolidayDestinationArrival(entry);
    destinationArrival.motorwayDistance=numericField('holidayDestinationMotorwayDistance');
    destinationArrival.motorwayJunction=(document.getElementById('holidayDestinationMotorwayJunction')?.value||'').trim();
    destinationArrival.access=document.getElementById('holidayDestinationAccess')?.value||'unknown';
    destinationArrival.accessNotes=destinationArrival.access==='restricted'?(document.getElementById('holidayDestinationAccessNotes')?.value||'').trim():'';
    destinationArrival.parkingAvailable=document.getElementById('holidayDestinationParkingAvailable')?.value||'unknown';
    destinationArrival.parkingNotes=destinationArrival.parkingAvailable==='yes'?(document.getElementById('holidayDestinationParkingNotes')?.value||'').trim():'';
    destinationArrival.motorhomeParking=document.getElementById('holidayDestinationMotorhomeParking')?.value||'unknown';
    destinationArrival.motorhomeNotes=destinationArrival.motorhomeParking==='yes'?(document.getElementById('holidayDestinationMotorhomeNotes')?.value||'').trim():'';
    destinationArrival.transport=getCheckboxGroup('holidayDestinationTransport');
    destinationArrival.transportNotes=(document.getElementById('holidayDestinationTransportNotes')?.value||'').trim();
    destinationArrival.walkDistance=numericField('holidayDestinationWalkDistance');
    destinationArrival.walkMinutes=numericField('holidayDestinationWalkMinutes');
    const destinationHighlights=ensureHolidayDestinationHighlights(entry);
    destinationHighlights.activities=currentHolidayDestinationActivities();
    destinationHighlights.highlights=(document.getElementById('holidayDestinationHighlights')?.value||'').trim();
    destinationHighlights.plans=(document.getElementById('holidayDestinationPlans')?.value||'').trim();
    const destinationLinks=ensureHolidayDestinationLinks(entry);
    destinationLinks.accommodations=currentHolidayDestinationLinks();
    const destinationNotes=ensureHolidayDestinationNotes(entry);
    destinationNotes.important=(document.getElementById('holidayDestinationImportantNotes')?.value||'').trim();
    destinationNotes.bring=(document.getElementById('holidayDestinationBringNotes')?.value||'').trim();
    destinationNotes.insider=(document.getElementById('holidayDestinationInsiderTips')?.value||'').trim();
  }
  const personal=ensureHolidayPersonal(entry);
  const personalStatus=document.getElementById('holidayPersonalStatus').value;
  entry.visited=personalStatus==='visited'; entry.wantToVisit=personalStatus==='want';
  entry.favorite=!!document.getElementById('holidayPersonalFavorite').checked; entry.why=document.getElementById('holidayPersonalWhy').value.trim();
  personal.ratings={location:ratingValue('holidayRatingLocation'),quiet:ratingValue('holidayRatingQuiet'),cleanliness:ratingValue('holidayRatingCleanliness'),equipment:ratingValue('holidayRatingEquipment'),service:ratingValue('holidayRatingService'),value:ratingValue('holidayRatingValue'),experience:ratingValue('holidayRatingExperience'),sightseeing:ratingValue('holidayRatingSightseeing')};
  personal.returnIntent=document.getElementById('holidayPersonalReturn').value||'unknown'; entry.visits=collectHolidayVisits(); entry.notes=document.getElementById('holidayPersonalNotes').value.trim();
  entry.media=cloneMediaList(holidayMediaDraft);
  entry.titleImageId=holidayTitleImageDraft&&entry.media.some(m=>m.id===holidayTitleImageDraft)?holidayTitleImageDraft:null;
  entry.geoTags=[entry.country,entry.region,entry.town,...entry.travelRegions].filter(Boolean);
  entry.updatedAt=new Date().toISOString();
  if(!existing)state.entries.push(entry);
  try{
    saveEntries();
  }catch(err){
    // Bei vollem lokalen Speicher darf die Bearbeitung nicht kommentarlos abbrechen
    // und ein bestehender Eintrag darf nicht halb verändert im Arbeitsspeicher bleiben.
    if(existing&&existingSnapshot){
      const pos=state.entries.findIndex(x=>x.id===existing.id);
      if(pos>=0)state.entries[pos]=existingSnapshot;
    }else{
      state.entries=state.entries.filter(x=>x!==entry);
    }
    if(err?.name==='QuotaExceededError'||err?.name==='NS_ERROR_DOM_QUOTA_REACHED'){
      alert('Der lokale Speicher ist für dieses Bild zu voll. Der lokale Speicher ist voll. Die App hat die Bilder bereits automatisch verkleinert. Bitte entferne ein nicht benötigtes Bild oder einen alten Eintrag. Deine bisherigen Daten bleiben erhalten.');
    }else{
      console.error('Urlaub konnte nicht gespeichert werden:',err);
      alert('Der Eintrag konnte nicht gespeichert werden. Bitte versuche es erneut.');
    }
    return;
  }
  closeHolidayEditor();
  render();
  openDetail(entry.id);
}

document.getElementById('closeHolidayEdit')?.addEventListener('click',closeHolidayEditor);
document.getElementById('cancelHolidayEdit')?.addEventListener('click',closeHolidayEditor);
document.getElementById('holidayEntryType')?.addEventListener('change',()=>{const visits=collectHolidayVisits();updateHolidayBasicConditionalFields();renderHolidayVisitEditor(visits,document.getElementById('holidayEntryType').value);});
document.getElementById('holidayAccommodationType')?.addEventListener('change',()=>{
  const mainType=document.getElementById('holidayEntryType');
  const mirror=document.getElementById('holidayAccommodationType');
  if(!mainType||!mirror)return;
  const visits=collectHolidayVisits();
  mainType.value=mirror.value;
  document.querySelectorAll('#holidayAccommodationSection .holiday-subaccordion').forEach(d=>d.open=false);
  updateHolidayBasicConditionalFields();
  renderHolidayVisitEditor(visits,mainType.value);
});
document.getElementById('addHolidayVisit')?.addEventListener('click',addHolidayVisit);
document.getElementById('holidayHotelOccupancy')?.addEventListener('change',updateHolidayPriceConditionalFields);
document.getElementById('holidayFreeCancellation')?.addEventListener('change',updateHolidayPriceConditionalFields);
document.getElementById('holidayStayParking')?.addEventListener('change',updateHolidayStayConditionalFields);
document.getElementById('holidayStayParkingBilling')?.addEventListener('change',updateHolidayStayConditionalFields);
document.getElementById('holidayStayDeposit')?.addEventListener('change',updateHolidayStayConditionalFields);
document.getElementById('holidayFoodStatus')?.addEventListener('change',updateHolidayFoodConditionalFields);
['OutdoorPool','IndoorPool','Sauna','Whirlpool'].forEach(k=>document.getElementById('holidayLeisure'+k)?.addEventListener('change',updateHolidayLeisureConditionalFields));
document.getElementById('holidayAccWifi')?.addEventListener('change',updateHolidayAccommodationConditionalFields);
document.getElementById('holidayAccWifiBilling')?.addEventListener('change',updateHolidayAccommodationConditionalFields);
document.getElementById('holidayAccKitchen')?.addEventListener('change',updateHolidayAccommodationConditionalFields);
document.getElementById('holidayAccLinen')?.addEventListener('change',updateHolidayAccommodationConditionalFields);
document.getElementById('holidayAccTowels')?.addEventListener('change',updateHolidayAccommodationConditionalFields);
document.getElementById('holidayDogAllowed')?.addEventListener('change',updateHolidayDogConditionalFields);
document.getElementById('holidayDogFeeType')?.addEventListener('change',updateHolidayDogConditionalFields);
document.getElementById('holidayDogAlone')?.addEventListener('change',updateHolidayDogConditionalFields);
document.getElementById('addHolidayDestinationCategory')?.addEventListener('click',()=>addHolidayDestinationCustom('category'));
document.getElementById('addHolidayDestinationCharacter')?.addEventListener('click',()=>addHolidayDestinationCustom('character'));
['holidayDestinationNewCategory','holidayDestinationNewCharacter'].forEach(id=>document.getElementById(id)?.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();addHolidayDestinationCustom(id.endsWith('Character')?'character':'category');}}));

document.getElementById('holidayVisitYearRound')?.addEventListener('change',updateHolidayVisitPlanningConditionalFields);
document.getElementById('holidayVisitHoursKnown')?.addEventListener('change',updateHolidayVisitPlanningConditionalFields);
document.getElementById('holidayDestinationAdmission')?.addEventListener('change',updateHolidayDestinationCostsConditionalFields);
document.getElementById('holidayDestinationParkingCost')?.addEventListener('change',updateHolidayDestinationCostsConditionalFields);
document.getElementById('holidayDestinationAccess')?.addEventListener('change',updateHolidayDestinationArrivalConditionalFields);
document.getElementById('holidayDestinationParkingAvailable')?.addEventListener('change',updateHolidayDestinationArrivalConditionalFields);
document.getElementById('holidayDestinationMotorhomeParking')?.addEventListener('change',updateHolidayDestinationArrivalConditionalFields);

document.getElementById('addHolidayDestinationActivity')?.addEventListener('click',addHolidayDestinationActivity);
document.getElementById('holidayDestinationNewActivity')?.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();addHolidayDestinationActivity();}});
document.getElementById('holidayDestinationHighlightsSection')?.addEventListener('click',ev=>{const btn=ev.target.closest('[data-destination-activity-label]');if(btn)deleteHolidayDestinationActivity(btn.dataset.destinationActivityLabel);});
document.getElementById('addHolidayDestinationLink')?.addEventListener('click',addHolidayDestinationLink);
document.getElementById('holidayDestinationLinkedList')?.addEventListener('click',ev=>{
  const btn=ev.target.closest('[data-remove-destination-link]'); if(!btn)return;
  const links=currentHolidayDestinationLinks().filter(link=>link.entryId!==btn.dataset.removeDestinationLink);
  renderHolidayDestinationLinksEditor(links);
});
document.getElementById('holidayDestinationSection')?.addEventListener('click',ev=>{
  const btn=ev.target.closest('.destination-delete-choice'); if(!btn)return;
  deleteHolidayDestinationCustom(btn.dataset.destinationKind,btn.dataset.destinationLabel);
});
document.getElementById('holidayEditForm')?.addEventListener('submit',ev=>{
  try{saveHolidayBasic(ev);}catch(err){
    ev.preventDefault();
    console.error('Urlaub konnte nicht gespeichert werden:',err);
    alert('Der Eintrag konnte nicht gespeichert werden. Bitte versuche es erneut.');
  }
});
document.querySelectorAll('#holidayRatings select').forEach(select=>select.addEventListener('change',updateHolidayRatingAverage));
document.getElementById('addHolidayMedia')?.addEventListener('click',()=>document.getElementById('holidayMediaInput')?.click());
document.getElementById('holidayMediaInput')?.addEventListener('change',ev=>addHolidayMediaFiles(ev.target.files));

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


function stellplatzPdfActionHtml(){
  return `<div class="pdf-action-card">
    <div class="pdf-action-copy"><small>Stellplatz als PDF</small><strong>Drucken · Speichern · Teilen</strong><span>Erstellt eine übersichtliche A4-Zusammenfassung aller gespeicherten Angaben.</span></div>
    <button class="btn primary pdf-action-btn" id="stellplatzPdfDetail">PDF erstellen</button>
  </div>`;
}
function stellplatzPrintSectionsHtml(e){
  const holder=document.createElement('div');
  holder.innerHTML=stellplatzDetailCards(e);
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
function stellplatzPrintGalleryHtml(e){
  const media=(Array.isArray(e.media)?e.media:[]).filter(m=>m.kind==='image'&&m.dataUrl&&m.id!==e.titleImageId).slice(0,4);
  if(!media.length)return '';
  return `<section class="print-gallery-section"><h2>Weitere Bilder</h2><div class="print-gallery">${media.map(m=>`<figure><img src="${m.dataUrl}" alt="${escapeHtml(m.description||'Stellplatz-Bild')}" />${m.description?`<figcaption>${escapeHtml(m.description)}</figcaption>`:''}</figure>`).join('')}</div></section>`;
}
function openStellplatzPrint(e){
  if(!e || e.type!=='stellplatz')return;
  const printWindow=window.open('','_blank');
  if(!printWindow){
    alert('Die PDF-Ansicht konnte nicht geöffnet werden. Bitte Pop-ups für diese Seite erlauben.');
    return;
  }
  const title=imageById(e,e.titleImageId);
  const hero=title?.dataUrl?`<div class="print-hero"><img src="${title.dataUrl}" alt="${escapeHtml(title.description||e.name||'Stellplatz')}" /></div>`:'';
  const sections=stellplatzPrintSectionsHtml(e);
  const gallery=stellplatzPrintGalleryHtml(e);
  const docTitle=`${e.name||'Stellplatz'} - viacruz Reisezeit`;
  const generated=new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(docTitle)}</title><style>
    :root{--text:#173126;--muted:#66756e;--line:#dce5dd;--soft:#f6f9f5;--accent:#2f6a4f}
    *{box-sizing:border-box}html,body{margin:0;padding:0;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:#eef2ee}body{padding:20px}
    .toolbar{max-width:210mm;margin:0 auto 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:white;border:1px solid var(--line);border-radius:12px;padding:10px 12px;box-shadow:0 8px 30px rgba(17,45,31,.08)}.toolbar strong{display:block;font-size:14px}.toolbar span{display:block;font-size:11px;color:var(--muted);margin-top:2px}.toolbar button{border:0;border-radius:10px;background:var(--accent);color:white;font-weight:800;padding:11px 15px;white-space:nowrap;cursor:pointer}.toolbar-actions{display:flex;gap:8px;align-items:center}.toolbar .back-button{background:#eef3ef;color:var(--text);border:1px solid var(--line)}
    .print-page{width:min(210mm,100%);margin:0 auto;background:white;padding:14mm 15mm 13mm;box-shadow:0 10px 40px rgba(17,45,31,.12)}
    .print-hero{height:62mm;margin:-14mm -15mm 10mm;overflow:hidden}.print-hero img{width:100%;height:100%;object-fit:cover;display:block}
    .print-kicker{font-size:10px;font-weight:850;letter-spacing:.11em;text-transform:uppercase;color:var(--accent)}h1{font-size:27px;line-height:1.08;margin:3px 0 4px}.print-location{font-size:13px;color:var(--muted);margin-bottom:8mm}.print-meta{font-size:9px;color:var(--muted);text-align:right;margin-bottom:4mm}
    .detail-accordions{display:block}.detail-accordion{display:block;border:1px solid var(--line);border-radius:10px;margin:0 0 5mm;overflow:hidden;break-inside:auto;page-break-inside:auto}.detail-accordion summary{display:block;list-style:none;padding:4mm 4.5mm 3.2mm;background:var(--soft);border-bottom:1px solid var(--line);break-after:avoid;page-break-after:avoid}.detail-accordion summary::-webkit-details-marker{display:none}.detail-accordion summary h2,.print-gallery-section h2{font-size:14px;line-height:1.2;margin:0}.accordion-body{padding:2mm 4.5mm 3mm}.detail-row{display:grid;grid-template-columns:minmax(46mm,42%) 1fr;gap:5mm;padding:2.2mm 0;border-bottom:1px solid #edf1ed;align-items:start}.detail-row:last-child{border-bottom:0}.detail-row{break-inside:avoid;page-break-inside:avoid}.detail-row span{font-size:9.4px;color:var(--muted)}.detail-row strong{font-size:9.8px;line-height:1.35;text-align:right;overflow-wrap:anywhere}.detail-row a,.inline-link,.contact-link{color:var(--accent);text-decoration:none}
    .detail-note{padding:2.8mm 0;border-bottom:1px solid #edf1ed;break-inside:avoid;page-break-inside:avoid}.detail-note:last-child{border-bottom:0}.detail-note>span{display:block;font-size:9.4px;color:var(--muted);margin-bottom:1mm}.detail-note p{font-size:9.8px;line-height:1.45;margin:0;white-space:normal}.visit-history{display:grid;gap:2.2mm;margin-top:2mm}.visit-history-card{border:1px solid var(--line);border-radius:7px;padding:2.5mm;break-inside:avoid;page-break-inside:avoid}.visit-history-head{display:flex;justify-content:space-between;gap:5mm;font-size:9.5px}.visit-history-card small{display:block;color:var(--muted);font-size:8.8px;margin-top:1mm}.visit-history-card p{margin-top:1.5mm}
    .print-gallery-section{border:1px solid var(--line);border-radius:10px;padding:4mm 4.5mm;margin-top:5mm;break-inside:avoid-page}.print-gallery{display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin-top:3mm}.print-gallery figure{margin:0;break-inside:avoid}.print-gallery img{width:100%;height:47mm;object-fit:cover;display:block;border-radius:7px}.print-gallery figcaption{font-size:8.7px;line-height:1.3;color:var(--muted);padding-top:1.2mm}
    .print-footer{margin-top:8mm;padding-top:3mm;border-top:1px solid var(--line);font-size:8.7px;color:var(--muted);display:flex;justify-content:space-between;gap:10mm}.brand{font-weight:800;color:#53675c}.print-empty{padding:8mm;text-align:center;color:var(--muted);font-size:10px}
    @page{size:A4;margin:11mm 0 10mm}@media print{body{background:white;padding:0}.toolbar{display:none!important}.print-page{width:100%;margin:0;box-shadow:none;padding:8mm 15mm 3mm}.print-hero{margin:-8mm -15mm 8mm;height:58mm}.detail-accordion{break-inside:auto;page-break-inside:auto}.print-gallery-section{break-inside:avoid-page;page-break-inside:avoid}.print-footer{position:relative}.print-meta{margin-bottom:3mm}}
    @media(max-width:640px){body{padding:8px}.toolbar{align-items:stretch;flex-direction:column}.toolbar-actions{display:grid;grid-template-columns:1fr}.toolbar button{width:100%}.print-page{padding:10mm 7mm}.print-hero{margin:-10mm -7mm 8mm;height:54mm}.detail-row{grid-template-columns:1fr;gap:1mm}.detail-row strong{text-align:left}.print-gallery{grid-template-columns:1fr}}
  </style></head><body><div class="toolbar"><div><strong>Stellplatz als PDF</strong><span>Drucken, als PDF sichern oder über die Systemfunktionen teilen.</span></div><div class="toolbar-actions"><button class="back-button" id="backToApp">← Zurück zur App</button><button id="printNow">Drucken / PDF speichern</button></div></div><main class="print-page">${hero}<div class="print-kicker">Stellplatz</div><h1>${escapeHtml(e.name||'Stellplatz')}</h1><div class="print-location">${escapeHtml(locationText(e))}</div><div class="print-meta">Erstellt am ${escapeHtml(generated)}</div>${sections||'<div class="print-empty">Keine weiteren Angaben gespeichert.</div>'}${gallery}<footer class="print-footer"><span>Deine persönliche Stellplatz-Zusammenfassung</span><span class="brand">powered by viacruz</span></footer></main><script>
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


function holidayPdfTypeLabel(e){
  return typeLabels[e?.type] || 'Urlaub';
}
function holidayPdfActionHtml(e){
  const label=holidayPdfTypeLabel(e);
  return `<div class="pdf-action-card">
    <div class="pdf-action-copy"><small>${escapeHtml(label)} als PDF</small><strong>Drucken · Speichern · Teilen</strong><span>Erstellt eine übersichtliche A4-Zusammenfassung aller gespeicherten Angaben.</span></div>
    <button class="btn primary pdf-action-btn" id="holidayPdfDetail">PDF erstellen</button>
  </div>`;
}
function holidayPrintSectionsHtml(e){
  const holder=document.createElement('div');
  holder.innerHTML=holidayDetailCards(e);
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
  // Verknüpfte Unterkünfte bleiben im PDF lesbar, ohne wie Bedienelemente zu wirken.
  holder.querySelectorAll('button[data-open-entry-id]').forEach(button=>{
    const replacement=document.createElement('div');
    replacement.className='linked-entry-print';
    replacement.innerHTML=button.innerHTML;
    button.replaceWith(replacement);
  });
  holder.querySelectorAll('.linked-entry-arrow').forEach(node=>node.remove());
  return holder.innerHTML;
}
function holidayPrintGalleryHtml(e){
  const media=(Array.isArray(e.media)?e.media:[]).filter(m=>m.kind==='image'&&m.dataUrl&&m.id!==e.titleImageId).slice(0,4);
  if(!media.length)return '';
  const label=holidayPdfTypeLabel(e);
  return `<section class="print-gallery-section"><h2>Weitere Bilder</h2><div class="print-gallery">${media.map(m=>`<figure><img src="${m.dataUrl}" alt="${escapeHtml(m.description||label+'-Bild')}" />${m.description?`<figcaption>${escapeHtml(m.description)}</figcaption>`:''}</figure>`).join('')}</div></section>`;
}
function openHolidayPrint(e){
  if(!e || !isHolidayType(e.type))return;
  const printWindow=window.open('','_blank');
  if(!printWindow){
    alert('Die PDF-Ansicht konnte nicht geöffnet werden. Bitte Pop-ups für diese Seite erlauben.');
    return;
  }
  const label=holidayPdfTypeLabel(e);
  const title=imageById(e,e.titleImageId);
  const hero=title?.dataUrl?`<div class="print-hero"><img src="${title.dataUrl}" alt="${escapeHtml(title.description||e.name||label)}" /></div>`:'';
  const sections=holidayPrintSectionsHtml(e);
  const gallery=holidayPrintGalleryHtml(e);
  const docTitle=`${e.name||label} - viacruz Reisezeit`;
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
    .linked-entry-detail{border:1px solid var(--line);border-radius:8px;padding:2.5mm;margin:0 0 2.5mm;break-inside:avoid}.linked-entry-detail:last-child{margin-bottom:0}.linked-entry-print{display:flex;align-items:center;gap:3mm}.linked-entry-image{width:14mm;height:14mm;border-radius:6px;overflow:hidden;background:var(--soft);display:flex;align-items:center;justify-content:center;flex:0 0 auto}.linked-entry-image img{width:100%;height:100%;object-fit:cover}.linked-entry-copy{display:block;min-width:0}.linked-entry-copy strong{display:block;font-size:9.8px}.linked-entry-copy small{display:block;color:var(--muted);font-size:8.8px;margin-top:1mm}.linked-entry-detail>p{font-size:9.2px;line-height:1.4;margin:2mm 0 0}
    .print-gallery-section{border:1px solid var(--line);border-radius:10px;padding:4mm 4.5mm;margin-top:5mm;break-inside:avoid-page}.print-gallery{display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin-top:3mm}.print-gallery figure{margin:0;break-inside:avoid}.print-gallery img{width:100%;height:47mm;object-fit:cover;display:block;border-radius:7px}.print-gallery figcaption{font-size:8.7px;line-height:1.3;color:var(--muted);padding-top:1.2mm}
    .print-footer{margin-top:8mm;padding-top:3mm;border-top:1px solid var(--line);font-size:8.7px;color:var(--muted);display:flex;justify-content:space-between;gap:10mm}.brand{font-weight:800;color:#53675c}.print-empty{padding:8mm;text-align:center;color:var(--muted);font-size:10px}
    @page{size:A4;margin:11mm 0 10mm}@media print{body{background:white;padding:0}.toolbar{display:none!important}.print-page{width:100%;margin:0;box-shadow:none;padding:8mm 15mm 3mm}.print-hero{margin:-8mm -15mm 8mm;height:58mm}.detail-accordion{break-inside:auto;page-break-inside:auto}.print-gallery-section{break-inside:avoid-page;page-break-inside:avoid}.print-footer{position:relative}.print-meta{margin-bottom:3mm}}
    @media(max-width:640px){body{padding:8px}.toolbar{align-items:stretch;flex-direction:column}.toolbar-actions{display:grid;grid-template-columns:1fr}.toolbar button{width:100%}.print-page{padding:10mm 7mm}.print-hero{margin:-10mm -7mm 8mm;height:54mm}.detail-row{grid-template-columns:1fr;gap:1mm}.detail-row strong{text-align:left}.print-gallery{grid-template-columns:1fr}}
  </style></head><body><div class="toolbar"><div><strong>${escapeHtml(label)} als PDF</strong><span>Drucken, als PDF sichern oder über die Systemfunktionen teilen.</span></div><div class="toolbar-actions"><button class="back-button" id="backToApp">← Zurück zur App</button><button id="printNow">Drucken / PDF speichern</button></div></div><main class="print-page">${hero}<div class="print-kicker">${escapeHtml(label)}</div><h1>${escapeHtml(e.name||label)}</h1><div class="print-location">${escapeHtml(locationText(e))}</div><div class="print-meta">Erstellt am ${escapeHtml(generated)}</div>${sections||'<div class="print-empty">Keine weiteren Angaben gespeichert.</div>'}${gallery}<footer class="print-footer"><span>Deine persönliche ${escapeHtml(label)}-Zusammenfassung</span><span class="brand">powered by viacruz</span></footer></main><script>
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
  content.innerHTML=`${e.type==='camping'?campingHeroHtml(e):e.type==='stellplatz'?stellplatzHeroHtml(e):isHolidayType(e.type)?holidayHeroHtml(e):''}<div class="sheet-head"><div><div class="eyebrow">${typeLabels[e.type]}</div><h2>${escapeHtml(e.name)}</h2><div class="detail-meta">${escapeHtml(locationText(e))}</div></div><button class="icon-btn close" id="closeDetail">×</button></div>
  ${e.type==='camping'?campingPdfActionHtml():e.type==='stellplatz'?stellplatzPdfActionHtml():isHolidayType(e.type)?holidayPdfActionHtml(e):''}
  ${infoCards.length?`<div class="detail-grid">${infoCards.join('')}</div>`:''}
  ${entryTypeDetailCards(e)}
  ${e.type==='camping'?campingGalleryHtml(e):e.type==='stellplatz'?stellplatzGalleryHtml(e):isHolidayType(e.type)?holidayGalleryHtml(e):''}
  <div class="detail-actions status-actions"><button class="btn secondary" id="favoriteDetail">${e.favorite?'★ Favorit entfernen':'☆ Als Favorit'}</button><button class="btn secondary" id="wantDetail">${e.wantToVisit?'Wunsch entfernen':'♡ Möchte ich besuchen'}</button></div>
  <div class="detail-actions"><button class="btn secondary" id="visitedDetail">${e.visited?'Besucht ✓':'Als besucht markieren'}</button><button class="btn secondary" id="editBasic">${e.type==='camping'?'Campingplatz bearbeiten':e.type==='stellplatz'?'Stellplatz bearbeiten':isHolidayType(e.type)?'Urlaub bearbeiten':'Grunddaten bearbeiten'}</button></div>
  <div class="detail-actions single-action"><button class="btn danger" id="trashDetail">In Papierkorb</button></div>`;
  const dlg=document.getElementById('detailDialog'); dlg.showModal();
  document.getElementById('closeDetail').onclick=()=>dlg.close();
  if(e.type==='camping'){const pdfButton=document.getElementById('campingPdfDetail');if(pdfButton)pdfButton.onclick=()=>openCampingPrint(e);}
  if(e.type==='stellplatz'){const pdfButton=document.getElementById('stellplatzPdfDetail');if(pdfButton)pdfButton.onclick=()=>openStellplatzPrint(e);}
  if(isHolidayType(e.type)){const pdfButton=document.getElementById('holidayPdfDetail');if(pdfButton)pdfButton.onclick=()=>openHolidayPrint(e);}
  document.getElementById('favoriteDetail').onclick=()=>{e.favorite=!e.favorite;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('wantDetail').onclick=()=>{e.wantToVisit=!e.wantToVisit;if(e.wantToVisit)e.visited=false;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('visitedDetail').onclick=()=>{e.visited=!e.visited;if(e.visited)e.wantToVisit=false;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();openDetail(id)};
  document.getElementById('trashDetail').onclick=()=>{if(confirm('Diesen Eintrag in den Papierkorb verschieben?')){e.deleted=true;e.updatedAt=new Date().toISOString();saveEntries();dlg.close();render();}};
  document.getElementById('editBasic').onclick=()=>e.type==='camping'?openCampingEditor(e):e.type==='stellplatz'?openStellplatzEditor(e):isHolidayType(e.type)?openHolidayEditor(e):editBasic(e);
  content.querySelectorAll('.gallery-item img').forEach(img=>img.onclick=()=>openImageViewer(img.src,img.alt||'Gespeichertes Bild'));
  content.querySelectorAll('[data-open-entry-id]').forEach(button=>button.onclick=()=>{
    const targetId=button.dataset.openEntryId;
    if(!targetId||targetId===id)return;
    if(dlg.open)dlg.close();
    openDetail(targetId);
  });
}

function openImageViewer(src,alt='Gespeichertes Bild'){
  const existing=document.getElementById('imageViewerOverlay');
  if(existing){if(typeof existing.close==='function'&&existing.open)existing.close();existing.remove();}
  // Als echtes modales <dialog> öffnen: Nur so liegt der Bildbetrachter auch
  // über der bereits modal geöffneten Camping-/Stellplatz-Detailansicht.
  const overlay=document.createElement('dialog');
  overlay.id='imageViewerOverlay';
  overlay.className='image-viewer-overlay';
  overlay.setAttribute('aria-label','Bildansicht');
  overlay.innerHTML=`<div class="image-viewer-toolbar"><button type="button" class="image-viewer-back" id="imageViewerBack">← Zurück</button><button type="button" class="image-viewer-close" id="imageViewerClose" aria-label="Bildansicht schließen">×</button></div><div class="image-viewer-stage"><img src="${src}" alt="${escapeHtml(alt)}" /></div>`;
  const closeViewer=()=>{if(overlay.open)overlay.close();};
  overlay.addEventListener('cancel',ev=>{ev.preventDefault();closeViewer();});
  overlay.addEventListener('close',()=>overlay.remove(),{once:true});
  overlay.addEventListener('click',ev=>{if(ev.target===overlay||ev.target.classList.contains('image-viewer-stage'))closeViewer();});
  overlay.querySelector('#imageViewerBack').onclick=closeViewer;
  overlay.querySelector('#imageViewerClose').onclick=closeViewer;
  document.body.appendChild(overlay);
  overlay.showModal();
  overlay.querySelector('#imageViewerBack').focus();
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
  const personal=ensureStellplatzPersonal(e);
  setField('stellplatzPersonalStatus',e.visited?'visited':e.wantToVisit?'want':'none');
  const favoriteEl=document.getElementById('stellplatzPersonalFavorite'); if(favoriteEl) favoriteEl.checked=!!e.favorite;
  setField('stellplatzPersonalWhy',e.why||'');
  setField('stellplatzRatingOverall',personal.ratings?.overall);setField('stellplatzRatingLocation',personal.ratings?.location);setField('stellplatzRatingQuiet',personal.ratings?.quiet);setField('stellplatzRatingCleanliness',personal.ratings?.cleanliness);setField('stellplatzRatingSanitary',personal.ratings?.sanitary);setField('stellplatzRatingValue',personal.ratings?.value);
  setField('stellplatzPersonalReturn',personal.returnIntent||'unknown');setField('stellplatzPersonalNotes',e.notes||'');renderStellplatzVisitEditor(e.visits||[]);
  stellplatzMediaDraft=cloneMediaList(e.media);stellplatzTitleImageDraft=e.titleImageId||null;renderStellplatzMediaEditor();
  const usage=ensureStellplatzUsage(e);
  setCheckboxGroup('stellplatzUsageTypes',usage.types||[]);
  setCheckboxGroup('stellplatzUsagePurpose',usage.purposes||[]);
  setCheckboxGroup('stellplatzPaymentMethods',usage.paymentMethods||[]);
  setField('stellplatzPaymentAppName',usage.paymentAppName||'');
  setField('stellplatzCheckInRequired',usage.checkInRequired||'unknown');
  setCheckboxGroup('stellplatzCheckInAt',usage.checkInAt||[]);
  setField('stellplatzAccessSystem',usage.accessSystem||'unknown');
  setCheckboxGroup('stellplatzAccessMethods',usage.accessMethods||[]);
  setField('stellplatzAccessNotes',usage.accessNotes||'');
  setField('stellplatzConditionRequired',usage.conditionRequired||'unknown');
  setField('stellplatzConditionText',usage.conditionText||'');
  updateStellplatzUsageConditionalFields();
  const season=ensureStellplatzSeason(e);
  setField('stellplatzOperationType',season.operationType||'unknown');
  setField('stellplatzOpenFrom',season.openFrom||'');
  setField('stellplatzOpenTo',season.openTo||'');
  setField('stellplatzArrival24h',season.arrival24h||'unknown');
  setField('stellplatzAccessFrom',season.accessFrom||'');
  setField('stellplatzAccessTo',season.accessTo||'');
  setField('stellplatzMaxStayValue',season.maxStayValue??'');
  setField('stellplatzMaxStayUnit',season.maxStayUnit||'days');
  setField('stellplatzReservation',season.reservation||'unknown');
  setField('stellplatzSpontaneous',season.spontaneousArrival||'unknown');
  setField('stellplatzSeasonNotes',season.notes||'');
  updateStellplatzSeasonConditionalFields();
  const pitch=ensureStellplatzPitch(e);
  const facilities=ensureStellplatzFacilities(e);
  setField('stellplatzPitchType',pitch.type||'unknown');
  setCheckboxGroup('stellplatzPitchVehicleTypes',pitch.vehicleTypes||[]);
  setField('stellplatzPitchArea',pitch.area);setField('stellplatzPitchLength',pitch.length);setField('stellplatzPitchWidth',pitch.width);
  setField('stellplatzPitchLargeMotorhome',pitch.largeMotorhome||'unknown');setCheckboxGroup('stellplatzPitchSurface',pitch.surface||[]);setField('stellplatzPitchLevel',pitch.level||'unknown');setField('stellplatzPitchShade',pitch.shade||'unknown');setCheckboxGroup('stellplatzPitchLocationFeatures',pitch.locationFeatures||[]);
  setField('stellplatzPitchElectricity',pitch.electricity||'unknown');setField('stellplatzPitchElectricityBilling',pitch.electricityBilling||'unknown');setField('stellplatzPitchElectricityPrice',pitch.electricityPrice);setField('stellplatzPitchElectricityKwhPrice',pitch.electricityKwhPrice);
  setField('stellplatzPitchFreshWater',pitch.freshWater||'unknown');setField('stellplatzPitchWasteWater',pitch.wasteWater||'unknown');setField('stellplatzPitchTv',pitch.tv||'unknown');setField('stellplatzPitchWifi',pitch.wifi||'unknown');setField('stellplatzPitchWifiBilling',pitch.wifiBilling||'unknown');setField('stellplatzPitchWifiPrice',pitch.wifiPrice);
  setField('stellplatzPitchAccess',pitch.access||'unknown');setField('stellplatzPitchMaxLength',pitch.maxVehicleLength);setField('stellplatzPitchMaxHeight',pitch.maxVehicleHeight);setField('stellplatzPitchMaxWeight',pitch.maxVehicleWeight);setField('stellplatzPitchPreferredNumber',pitch.preferredNumber||'');setField('stellplatzPitchNotes',pitch.notes||'');
  updateStellplatzPitchConditionalFields();
  document.getElementById('detailDialog').close();
  
  setField('stellplatzFacilitiesWc',facilities.wc||'unknown');
  setField('stellplatzFacilitiesShowers',facilities.showers||'unknown');
  setField('stellplatzFacilitiesShowerBilling',facilities.showerBilling||'unknown');
  setField('stellplatzFacilitiesShowerPrice',facilities.showerPrice);
  setField('stellplatzFacilitiesWashCubicles',facilities.washCubicles||'unknown');
  setField('stellplatzFacilitiesFamilyBath',facilities.familyBath||'unknown');
  setField('stellplatzFacilitiesAccessible',facilities.accessibleSanitary||'unknown');
  setField('stellplatzFacilitiesChildren',facilities.childrenSanitary||'unknown');
  setField('stellplatzFacilitiesPrivateBath',facilities.privateBath||'unknown');
  setField('stellplatzFacilitiesHeated',facilities.heatedSanitary||'unknown');
  setField('stellplatzFacilitiesWasher',facilities.washer||'unknown');
  setField('stellplatzFacilitiesWasherBilling',facilities.washerBilling||'unknown');
  setField('stellplatzFacilitiesWasherPrice',facilities.washerPrice);
  setField('stellplatzFacilitiesDryer',facilities.dryer||'unknown');
  setField('stellplatzFacilitiesDryerBilling',facilities.dryerBilling||'unknown');
  setField('stellplatzFacilitiesDryerPrice',facilities.dryerPrice);
  setField('stellplatzFacilitiesDishwashing',facilities.dishwashing||'unknown');
  setField('stellplatzFacilitiesFreshWaterPoint',facilities.freshWaterPoint||'unknown');
  setField('stellplatzFacilitiesGreyWater',facilities.greyWater||'unknown');
  setField('stellplatzFacilitiesChemicalToilet',facilities.chemicalToilet||'unknown');
  setField('stellplatzFacilitiesFloorDrain',facilities.floorDrain||'unknown');
  setField('stellplatzFacilitiesWaste',facilities.wasteDisposal||'unknown');
  setField('stellplatzFacilitiesWasteSeparation',facilities.wasteSeparation||'unknown');
  setField('stellplatzFacilitiesShop',facilities.shop||'unknown');
  setField('stellplatzFacilitiesBread',facilities.breadService||'unknown');
  setField('stellplatzFacilitiesBreadSeason',facilities.breadSeason||'unknown');
  setField('stellplatzFacilitiesCampingShop',facilities.campingShop||'unknown');
  setField('stellplatzFacilitiesGas',facilities.gasSupply||'unknown');
  setField('stellplatzFacilitiesEbike',facilities.ebikeCharging||'unknown');
  setField('stellplatzFacilitiesEv',facilities.evCharging||'unknown');
  toggleStellplatzFacilitiesConditionalFields();
  const location=ensureStellplatzLocation(e);setCheckboxGroup('stellplatzLocationFeatures',location.features||[]);const ld=location.distances||{};
  setField('stellplatzDistanceCentre',ld.centre?.km);setField('stellplatzWalkCentre',ld.centre?.walkable||'unknown');setField('stellplatzDistanceSupermarket',ld.supermarket?.km);setField('stellplatzWalkSupermarket',ld.supermarket?.walkable||'unknown');setField('stellplatzDistanceRestaurant',ld.restaurant?.km);setField('stellplatzWalkRestaurant',ld.restaurant?.walkable||'unknown');setField('stellplatzDistanceBakery',ld.bakery?.km);setField('stellplatzWalkBakery',ld.bakery?.walkable||'unknown');setField('stellplatzDistanceWater',ld.water?.km);setField('stellplatzWalkWater',ld.water?.walkable||'unknown');setField('stellplatzDistanceSights',ld.sights?.km);setField('stellplatzWalkSights',ld.sights?.walkable||'unknown');
  setField('stellplatzMotorwayDistance',location.motorwayDistance);setField('stellplatzMotorwayJunction',location.motorwayJunction||'');const lm=location.mobility||{};setField('stellplatzMobilityPublicTransport',lm.publicTransport||'unknown');setField('stellplatzMobilityBus',lm.bus||'unknown');setField('stellplatzMobilityTrain',lm.train||'unknown');setField('stellplatzMobilityCycle',lm.cycle||'unknown');setField('stellplatzMobilityHiking',lm.hiking||'unknown');setField('stellplatzMobilityCableCar',lm.cableCar||'unknown');setField('stellplatzMobilityFerry',lm.ferry||'unknown');setField('stellplatzLocationNotes',location.notes||'');
  const leisure=ensureStellplatzLeisure(e), gastro=leisure.gastronomy||{};
  const gastroIds={restaurant:'Restaurant',snack:'Snack',bar:'Bar',cafe:'Cafe',beerGarden:'BeerGarden',iceCream:'IceCream'};
  Object.entries(gastroIds).forEach(([key,id])=>{setField('stellplatzLeisure'+id,gastro[key]?.status||'unknown');setField('stellplatzLeisure'+id+'Season',gastro[key]?.season||'unknown');});
  const bw=leisure.bathingWellness||{};setField('stellplatzLeisureOutdoorPool',bw.outdoorPool||'unknown');setField('stellplatzLeisureIndoorPool',bw.indoorPool||'unknown');setField('stellplatzLeisureSauna',bw.sauna||'unknown');setField('stellplatzLeisureWellness',bw.wellness||'unknown');setField('stellplatzLeisureSwimmingAccess',bw.swimmingAccess||'unknown');setField('stellplatzLeisureBeach',bw.beach||'unknown');setCheckboxGroup('stellplatzBeachTypes',bw.beachTypes||[]);
  const sport=leisure.sport||{}, sportIds={playground:'Playground',tableTennis:'TableTennis',tennis:'Tennis',miniGolf:'MiniGolf',fitness:'Fitness',bikeRental:'BikeRental',eBikeRental:'EBikeRental',waterSports:'WaterSports'};Object.entries(sportIds).forEach(([key,id])=>setField('stellplatzLeisure'+id,sport[key]||'unknown'));
  setCheckboxGroup('stellplatzLeisureCharacter',leisure.character||[]);setField('stellplatzLeisureSize',leisure.size||'unknown');setField('stellplatzLeisurePitchCount',leisure.pitchCount);
  updateStellplatzLeisureConditionalFields();
  const dog=ensureStellplatzDog(e);setField('stellplatzDogAllowed',dog.allowed||'unknown');setField('stellplatzDogMaxCount',dog.maxCount);setField('stellplatzDogFeeType',dog.feeType||'unknown');setField('stellplatzDogFee',dog.fee);setField('stellplatzDogLeash',dog.leash||'unknown');setField('stellplatzDogRestricted',dog.restricted||'unknown');setField('stellplatzDogRun',dog.run||'unknown');setField('stellplatzDogBeach',dog.beach||'unknown');setField('stellplatzDogSwimming',dog.swimming||'unknown');setField('stellplatzDogShower',dog.shower||'unknown');setField('stellplatzDogRestaurant',dog.restaurant||'unknown');setField('stellplatzDogNotes',dog.notes||'');updateStellplatzDogConditionalFields();
  document.getElementById('stellplatzEditDialog').showModal();
}
function closeStellplatzEditor(){
  const dlg=document.getElementById('stellplatzEditDialog');
  if(dlg?.open) dlg.close();
}

function toggleStellplatzFacilitiesConditionalFields(){
  const pairs=[
    ['stellplatzFacilitiesShowers','stellplatzFacilitiesShowerDetails'],
    ['stellplatzFacilitiesWasher','stellplatzFacilitiesWasherDetails'],
    ['stellplatzFacilitiesDryer','stellplatzFacilitiesDryerDetails'],
    ['stellplatzFacilitiesBread','stellplatzFacilitiesBreadDetails']
  ];
  pairs.forEach(([selectId,wrapId])=>{
    const active=document.getElementById(selectId)?.value==='yes';
    const wrap=document.getElementById(wrapId);
    if(wrap){wrap.classList.toggle('is-disabled',!active);wrap.querySelectorAll('input,select').forEach(el=>el.disabled=!active);}
  });
  const costPairs=[
    ['stellplatzFacilitiesShowers','stellplatzFacilitiesShowerBilling','stellplatzFacilitiesShowerPriceWrap','stellplatzFacilitiesShowerPrice'],
    ['stellplatzFacilitiesWasher','stellplatzFacilitiesWasherBilling','stellplatzFacilitiesWasherPriceWrap','stellplatzFacilitiesWasherPrice'],
    ['stellplatzFacilitiesDryer','stellplatzFacilitiesDryerBilling','stellplatzFacilitiesDryerPriceWrap','stellplatzFacilitiesDryerPrice']
  ];
  costPairs.forEach(([availabilityId,billingId,priceWrapId,priceId])=>{
    const available=document.getElementById(availabilityId)?.value==='yes';
    const paid=available&&document.getElementById(billingId)?.value==='paid';
    const priceWrap=document.getElementById(priceWrapId);
    const price=document.getElementById(priceId);
    if(priceWrap) priceWrap.hidden=!paid;
    if(price) price.disabled=!paid;
  });
}
['stellplatzFacilitiesShowers','stellplatzFacilitiesWasher','stellplatzFacilitiesDryer','stellplatzFacilitiesBread','stellplatzFacilitiesShowerBilling','stellplatzFacilitiesWasherBilling','stellplatzFacilitiesDryerBilling'].forEach(id=>document.getElementById(id)?.addEventListener('change',toggleStellplatzFacilitiesConditionalFields));
document.getElementById('closeStellplatzEdit').onclick=closeStellplatzEditor;
document.getElementById('cancelStellplatzEdit').onclick=closeStellplatzEditor;
document.getElementById('stellplatzFeeStatus').onchange=()=>{updateStellplatzPaidFields();updateStellplatzUsageConditionalFields();};
document.querySelectorAll('#stellplatzPaymentMethods input[type="checkbox"]').forEach(el=>el.onchange=updateStellplatzUsageConditionalFields);
document.getElementById('stellplatzCheckInRequired').onchange=updateStellplatzUsageConditionalFields;
document.getElementById('stellplatzAccessSystem').onchange=updateStellplatzUsageConditionalFields;
document.getElementById('stellplatzConditionRequired').onchange=updateStellplatzUsageConditionalFields;
document.getElementById('stellplatzOperationType').onchange=updateStellplatzSeasonConditionalFields;
document.getElementById('stellplatzArrival24h').onchange=updateStellplatzSeasonConditionalFields;
document.getElementById('addStellplatzSeasonPrice').onclick=()=>{stellplatzSeasonPriceDraft=collectStellplatzSeasonPrices();stellplatzSeasonPriceDraft.push({id:uid(),name:'',from:'',to:'',amount:null,billing:'unknown'});renderStellplatzSeasonPrices();};
document.getElementById('addStellplatzVisit').onclick=addStellplatzVisitEditor;
document.getElementById('addStellplatzMedia').onclick=()=>document.getElementById('stellplatzMediaInput').click();
document.getElementById('stellplatzMediaInput').onchange=ev=>addStellplatzMediaFiles(ev.target.files);
document.getElementById('stellplatzPitchElectricity').onchange=updateStellplatzPitchConditionalFields;
document.getElementById('stellplatzPitchElectricityBilling').onchange=updateStellplatzPitchConditionalFields;
document.getElementById('stellplatzPitchWifi').onchange=updateStellplatzPitchConditionalFields;
document.getElementById('stellplatzPitchWifiBilling').onchange=updateStellplatzPitchConditionalFields;
['Restaurant','Snack','Bar','Cafe','BeerGarden','IceCream'].forEach(id=>document.getElementById('stellplatzLeisure'+id)?.addEventListener('change',updateStellplatzLeisureConditionalFields));
document.getElementById('stellplatzLeisureBeach')?.addEventListener('change',updateStellplatzLeisureConditionalFields);
document.getElementById('stellplatzDogAllowed')?.addEventListener('change',updateStellplatzDogConditionalFields);
document.getElementById('stellplatzDogFeeType')?.addEventListener('change',updateStellplatzDogConditionalFields);
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
  e.media=cloneMediaList(stellplatzMediaDraft);
  e.titleImageId=stellplatzTitleImageDraft;
  e.geoTags=[e.country,e.region,e.town,...e.travelRegions].filter(Boolean);
  const prices=ensureStellplatzPrices(e);
  prices.year=numericField('stellplatzPriceYear');prices.feeStatus=document.getElementById('stellplatzFeeStatus').value;prices.billing=prices.feeStatus==='paid'?document.getElementById('stellplatzFeeBilling').value:'unknown';prices.amount=prices.feeStatus==='paid'?numericField('stellplatzFeeAmount'):null;prices.seasonPrices=collectStellplatzSeasonPrices();prices.touristTax=numericField('stellplatzTouristTax');prices.touristTaxBilling=document.getElementById('stellplatzTouristTaxBilling').value;prices.reservationFee=numericField('stellplatzReservationFee');prices.otherLabel=document.getElementById('stellplatzOtherLabel').value.trim();prices.otherAmount=numericField('stellplatzOtherAmount');prices.included=document.getElementById('stellplatzPriceIncluded').value.trim();prices.notes=document.getElementById('stellplatzPriceNotes').value.trim();
  const personal=ensureStellplatzPersonal(e);
  const personalStatus=document.getElementById('stellplatzPersonalStatus').value;e.visited=personalStatus==='visited';e.wantToVisit=personalStatus==='want';e.favorite=!!document.getElementById('stellplatzPersonalFavorite').checked;e.why=document.getElementById('stellplatzPersonalWhy').value.trim();
  personal.ratings={overall:ratingValue('stellplatzRatingOverall'),location:ratingValue('stellplatzRatingLocation'),quiet:ratingValue('stellplatzRatingQuiet'),cleanliness:ratingValue('stellplatzRatingCleanliness'),sanitary:ratingValue('stellplatzRatingSanitary'),value:ratingValue('stellplatzRatingValue')};
  personal.returnIntent=document.getElementById('stellplatzPersonalReturn').value;e.visits=collectStellplatzVisits();e.notes=document.getElementById('stellplatzPersonalNotes').value.trim();
  const usage=ensureStellplatzUsage(e);
  usage.types=getCheckboxGroup('stellplatzUsageTypes');
  usage.purposes=getCheckboxGroup('stellplatzUsagePurpose');
  const isPaid=prices.feeStatus==='paid';
  usage.paymentMethods=isPaid?getCheckboxGroup('stellplatzPaymentMethods'):[];
  usage.paymentAppName=isPaid&&usage.paymentMethods.includes('app')?document.getElementById('stellplatzPaymentAppName').value.trim():'';
  usage.checkInRequired=document.getElementById('stellplatzCheckInRequired').value;
  usage.checkInAt=usage.checkInRequired==='yes'?getCheckboxGroup('stellplatzCheckInAt'):[];
  usage.accessSystem=document.getElementById('stellplatzAccessSystem').value;
  usage.accessMethods=usage.accessSystem==='yes'?getCheckboxGroup('stellplatzAccessMethods'):[];
  usage.accessNotes=usage.accessSystem==='yes'?document.getElementById('stellplatzAccessNotes').value.trim():'';
  usage.conditionRequired=document.getElementById('stellplatzConditionRequired').value;
  usage.conditionText=usage.conditionRequired==='yes'?document.getElementById('stellplatzConditionText').value.trim():'';
  const season=ensureStellplatzSeason(e);
  season.operationType=document.getElementById('stellplatzOperationType').value;
  season.openFrom=season.operationType==='seasonal'?document.getElementById('stellplatzOpenFrom').value:'';
  season.openTo=season.operationType==='seasonal'?document.getElementById('stellplatzOpenTo').value:'';
  season.arrival24h=document.getElementById('stellplatzArrival24h').value;
  season.accessFrom=season.arrival24h==='no'?document.getElementById('stellplatzAccessFrom').value:'';
  season.accessTo=season.arrival24h==='no'?document.getElementById('stellplatzAccessTo').value:'';
  season.maxStayValue=numericField('stellplatzMaxStayValue');
  season.maxStayUnit=season.maxStayValue!=null?document.getElementById('stellplatzMaxStayUnit').value:'';
  season.reservation=document.getElementById('stellplatzReservation').value;
  season.spontaneousArrival=document.getElementById('stellplatzSpontaneous').value;
  season.notes=document.getElementById('stellplatzSeasonNotes').value.trim();
  const pitch=ensureStellplatzPitch(e);
  pitch.type=document.getElementById('stellplatzPitchType').value;pitch.vehicleTypes=getCheckboxGroup('stellplatzPitchVehicleTypes');pitch.area=numericField('stellplatzPitchArea');pitch.length=numericField('stellplatzPitchLength');pitch.width=numericField('stellplatzPitchWidth');pitch.largeMotorhome=document.getElementById('stellplatzPitchLargeMotorhome').value;pitch.surface=getCheckboxGroup('stellplatzPitchSurface');pitch.level=document.getElementById('stellplatzPitchLevel').value;pitch.shade=document.getElementById('stellplatzPitchShade').value;pitch.locationFeatures=getCheckboxGroup('stellplatzPitchLocationFeatures');
  pitch.electricity=document.getElementById('stellplatzPitchElectricity').value;pitch.electricityBilling=pitch.electricity==='yes'?document.getElementById('stellplatzPitchElectricityBilling').value:'unknown';pitch.electricityPrice=pitch.electricity==='yes'&&pitch.electricityBilling==='flat'?numericField('stellplatzPitchElectricityPrice'):null;pitch.electricityKwhPrice=pitch.electricity==='yes'&&pitch.electricityBilling==='consumption'?numericField('stellplatzPitchElectricityKwhPrice'):null;pitch.freshWater=document.getElementById('stellplatzPitchFreshWater').value;pitch.wasteWater=document.getElementById('stellplatzPitchWasteWater').value;pitch.tv=document.getElementById('stellplatzPitchTv').value;pitch.wifi=document.getElementById('stellplatzPitchWifi').value;pitch.wifiBilling=pitch.wifi==='yes'?document.getElementById('stellplatzPitchWifiBilling').value:'unknown';pitch.wifiPrice=pitch.wifi==='yes'&&pitch.wifiBilling==='paid'?numericField('stellplatzPitchWifiPrice'):null;pitch.access=document.getElementById('stellplatzPitchAccess').value;pitch.maxVehicleLength=numericField('stellplatzPitchMaxLength');pitch.maxVehicleHeight=numericField('stellplatzPitchMaxHeight');pitch.maxVehicleWeight=numericField('stellplatzPitchMaxWeight');pitch.preferredNumber=document.getElementById('stellplatzPitchPreferredNumber').value.trim();pitch.notes=document.getElementById('stellplatzPitchNotes').value.trim();
  const f=ensureStellplatzFacilities(e);
  f.wc=document.getElementById('stellplatzFacilitiesWc').value;
  f.showers=document.getElementById('stellplatzFacilitiesShowers').value;
  f.showerBilling=f.showers==='yes'?document.getElementById('stellplatzFacilitiesShowerBilling').value:'unknown';
  f.showerPrice=f.showers==='yes'&&f.showerBilling==='paid'?numericField('stellplatzFacilitiesShowerPrice'):null;
  f.washCubicles=document.getElementById('stellplatzFacilitiesWashCubicles').value;
  f.familyBath=document.getElementById('stellplatzFacilitiesFamilyBath').value;
  f.accessibleSanitary=document.getElementById('stellplatzFacilitiesAccessible').value;
  f.childrenSanitary=document.getElementById('stellplatzFacilitiesChildren').value;
  f.privateBath=document.getElementById('stellplatzFacilitiesPrivateBath').value;
  f.heatedSanitary=document.getElementById('stellplatzFacilitiesHeated').value;
  f.washer=document.getElementById('stellplatzFacilitiesWasher').value;
  f.washerBilling=f.washer==='yes'?document.getElementById('stellplatzFacilitiesWasherBilling').value:'unknown';
  f.washerPrice=f.washer==='yes'&&f.washerBilling==='paid'?numericField('stellplatzFacilitiesWasherPrice'):null;
  f.dryer=document.getElementById('stellplatzFacilitiesDryer').value;
  f.dryerBilling=f.dryer==='yes'?document.getElementById('stellplatzFacilitiesDryerBilling').value:'unknown';
  f.dryerPrice=f.dryer==='yes'&&f.dryerBilling==='paid'?numericField('stellplatzFacilitiesDryerPrice'):null;
  f.dishwashing=document.getElementById('stellplatzFacilitiesDishwashing').value;
  f.freshWaterPoint=document.getElementById('stellplatzFacilitiesFreshWaterPoint').value;
  f.greyWater=document.getElementById('stellplatzFacilitiesGreyWater').value;
  f.chemicalToilet=document.getElementById('stellplatzFacilitiesChemicalToilet').value;
  f.floorDrain=document.getElementById('stellplatzFacilitiesFloorDrain').value;
  f.wasteDisposal=document.getElementById('stellplatzFacilitiesWaste').value;
  f.wasteSeparation=document.getElementById('stellplatzFacilitiesWasteSeparation').value;
  f.shop=document.getElementById('stellplatzFacilitiesShop').value;
  f.breadService=document.getElementById('stellplatzFacilitiesBread').value;
  f.breadSeason=f.breadService==='yes'?document.getElementById('stellplatzFacilitiesBreadSeason').value:'unknown';
  f.campingShop=document.getElementById('stellplatzFacilitiesCampingShop').value;
  f.gasSupply=document.getElementById('stellplatzFacilitiesGas').value;
  f.ebikeCharging=document.getElementById('stellplatzFacilitiesEbike').value;
  f.evCharging=document.getElementById('stellplatzFacilitiesEv').value;
  const location=ensureStellplatzLocation(e);location.features=getCheckboxGroup('stellplatzLocationFeatures');location.distances={centre:{km:numericField('stellplatzDistanceCentre'),walkable:document.getElementById('stellplatzWalkCentre').value},supermarket:{km:numericField('stellplatzDistanceSupermarket'),walkable:document.getElementById('stellplatzWalkSupermarket').value},restaurant:{km:numericField('stellplatzDistanceRestaurant'),walkable:document.getElementById('stellplatzWalkRestaurant').value},bakery:{km:numericField('stellplatzDistanceBakery'),walkable:document.getElementById('stellplatzWalkBakery').value},water:{km:numericField('stellplatzDistanceWater'),walkable:document.getElementById('stellplatzWalkWater').value},sights:{km:numericField('stellplatzDistanceSights'),walkable:document.getElementById('stellplatzWalkSights').value}};location.motorwayDistance=numericField('stellplatzMotorwayDistance');location.motorwayJunction=document.getElementById('stellplatzMotorwayJunction').value.trim();location.mobility={publicTransport:document.getElementById('stellplatzMobilityPublicTransport').value,bus:document.getElementById('stellplatzMobilityBus').value,train:document.getElementById('stellplatzMobilityTrain').value,cycle:document.getElementById('stellplatzMobilityCycle').value,hiking:document.getElementById('stellplatzMobilityHiking').value,cableCar:document.getElementById('stellplatzMobilityCableCar').value,ferry:document.getElementById('stellplatzMobilityFerry').value};location.notes=document.getElementById('stellplatzLocationNotes').value.trim();
  const leisure=ensureStellplatzLeisure(e), gastroIds={restaurant:'Restaurant',snack:'Snack',bar:'Bar',cafe:'Cafe',beerGarden:'BeerGarden',iceCream:'IceCream'};
  leisure.gastronomy={};Object.entries(gastroIds).forEach(([key,id])=>{const status=document.getElementById('stellplatzLeisure'+id).value;leisure.gastronomy[key]={status,season:status==='yes'?document.getElementById('stellplatzLeisure'+id+'Season').value:'unknown'};});
  const beach=document.getElementById('stellplatzLeisureBeach').value;leisure.bathingWellness={outdoorPool:document.getElementById('stellplatzLeisureOutdoorPool').value,indoorPool:document.getElementById('stellplatzLeisureIndoorPool').value,sauna:document.getElementById('stellplatzLeisureSauna').value,wellness:document.getElementById('stellplatzLeisureWellness').value,swimmingAccess:document.getElementById('stellplatzLeisureSwimmingAccess').value,beach,beachTypes:beach==='yes'?getCheckboxGroup('stellplatzBeachTypes'):[]};
  const sportIds={playground:'Playground',tableTennis:'TableTennis',tennis:'Tennis',miniGolf:'MiniGolf',fitness:'Fitness',bikeRental:'BikeRental',eBikeRental:'EBikeRental',waterSports:'WaterSports'};leisure.sport={};Object.entries(sportIds).forEach(([key,id])=>leisure.sport[key]=document.getElementById('stellplatzLeisure'+id).value);leisure.character=getCheckboxGroup('stellplatzLeisureCharacter');leisure.size=document.getElementById('stellplatzLeisureSize').value;leisure.pitchCount=numericField('stellplatzLeisurePitchCount');
  const dog=ensureStellplatzDog(e);dog.allowed=document.getElementById('stellplatzDogAllowed').value;if(dog.allowed==='yes'){dog.maxCount=numericField('stellplatzDogMaxCount');dog.feeType=document.getElementById('stellplatzDogFeeType').value;dog.fee=dog.feeType==='paid'?numericField('stellplatzDogFee'):null;dog.leash=document.getElementById('stellplatzDogLeash').value;dog.restricted=document.getElementById('stellplatzDogRestricted').value;dog.run=document.getElementById('stellplatzDogRun').value;dog.beach=document.getElementById('stellplatzDogBeach').value;dog.swimming=document.getElementById('stellplatzDogSwimming').value;dog.shower=document.getElementById('stellplatzDogShower').value;dog.restaurant=document.getElementById('stellplatzDogRestaurant').value;dog.notes=document.getElementById('stellplatzDogNotes').value.trim();}else{dog.maxCount=null;dog.feeType='unknown';dog.fee=null;dog.leash='unknown';dog.restricted='unknown';dog.run='unknown';dog.beach='unknown';dog.swimming='unknown';dog.shower='unknown';dog.restaurant='unknown';dog.notes='';}

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
  const values=Object.values(r)
    .filter(v=>v!==null && v!==undefined && v!=='' && Number.isFinite(Number(v)))
    .map(Number);
  if(!values.length)return null;
  return values.reduce((a,b)=>a+b,0)/values.length;
}
function holidayPersonalRatingAverage(personal){
  const r=personal?.ratings||{};
  const keys=['location','quiet','cleanliness','equipment','service','value','experience','sightseeing'];
  const values=keys.map(key=>r[key]).filter(v=>v!==null && v!==undefined && v!=='' && Number.isFinite(Number(v))).map(Number);
  if(!values.length)return null;
  return values.reduce((a,b)=>a+b,0)/values.length;
}
function updateHolidayRatingAverage(){
  const ids=['holidayRatingLocation','holidayRatingQuiet','holidayRatingCleanliness','holidayRatingEquipment','holidayRatingService','holidayRatingValue','holidayRatingExperience','holidayRatingSightseeing'];
  const values=ids.map(id=>ratingValue(id)).filter(v=>v!==null);
  const target=document.getElementById('holidayRatingAverage');
  if(!target)return;
  if(!values.length){target.textContent='Noch keine Bewertung';return;}
  const avg=values.reduce((a,b)=>a+b,0)/values.length;
  target.textContent=`${formatNumber(avg,1)} / 5`;
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

async function createBackup(){
  try{
    const entries=await entriesForBackup();
    const payload={app:'viacruz Reisezeit',dataVersion:1,createdAt:new Date().toISOString(),entries,settings:JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}')};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`viacruz-Reisezeit-Backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  }catch(err){console.error('Datensicherung fehlgeschlagen:',err);alert('Die Datensicherung konnte nicht erstellt werden.');}
}
async function restoreBackup(){
  const input=document.getElementById('restoreFile'); const file=input?.files?.[0]; if(!file){alert('Bitte zuerst eine Datensicherungsdatei auswählen.');return;}
  try{
    const data=JSON.parse(await file.text());
    if(data.app!=='viacruz Reisezeit'||!Array.isArray(data.entries))throw new Error('Ungültige Datei');
    if(!confirm(`Datensicherung mit ${data.entries.length} Einträgen wiederherstellen? Die aktuellen lokalen Daten werden ersetzt.`))return;
    await persistImportedMedia(data.entries);
    state.entries=data.entries;
    saveEntries();
    render();
    alert('Datensicherung wurde wiederhergestellt.');
  }catch(err){console.error('Wiederherstellung fehlgeschlagen:',err);alert('Die Datei konnte nicht als gültige Reisezeit-Datensicherung gelesen werden.');}
}

async function initApp(){
  try{
    await migrateLegacyMediaToIndexedDb();
    await hydrateAllEntryMedia();
  }catch(err){console.error('Bildspeicher konnte nicht initialisiert werden:',err);}
  render();
}
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));}
initApp();
