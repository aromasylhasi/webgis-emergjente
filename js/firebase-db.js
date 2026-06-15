// =====================================================================
//  Firebase Firestore layer — WebGIS Emergjente
//  Nëse FIREBASE_CONFIG nuk është konfiguruar, bie automatikisht
//  në mënyrën lokale (demo statike) pa asnjë gabim.
// =====================================================================

let _db        = null;
let _fbReady   = false;
let _fbCutoff  = 0;   // timestamp kur u ngarkua faqja (për real-time)

// ---- init ----
function fbInit() {
  if (
    typeof FIREBASE_CONFIG === 'undefined' ||
    !FIREBASE_CONFIG.projectId ||
    FIREBASE_CONFIG.projectId.startsWith('PASTE')
  ) {
    console.log('[Firebase] nuk është konfiguruar — mënyra demo aktive');
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _db      = firebase.firestore();
    _fbReady = true;
    console.log('[Firebase] i lidhur ✓  projekt:', FIREBASE_CONFIG.projectId);
  } catch (e) {
    console.warn('[Firebase] gabim gjatë inicializimit:', e.message);
  }
}

// ---- VGI: ruaj raportin e ri ----
async function fbSaveVGI(report) {
  if (!_fbReady) return;
  try {
    await _db.collection('vgi_reports').doc(report.id).set(report);
  } catch (e) {
    console.warn('[Firebase] ruajtja e VGI dështoi:', e.message);
  }
}

// ---- VGI: ngarko raportet ekzistuese ----
async function fbLoadVGI(onDone) {
  if (!_fbReady) { if (onDone) onDone(); return; }
  try {
    const snap = await _db
      .collection('vgi_reports')
      .orderBy('koha_unix', 'desc')
      .limit(300)
      .get();
    snap.forEach(doc => {
      const r = doc.data();
      const existing = VGI_REPORTS.find(x => x.id === r.id);
      if (existing) Object.assign(existing, r); // përditëso statusin nga Firestore
      else VGI_REPORTS.push(r);
    });
    if (onDone) onDone();
  } catch (e) {
    console.warn('[Firebase] ngarkimi i VGI dështoi:', e.message);
    if (onDone) onDone();
  }
}

// ---- VGI: dëgjo raportet e reja dhe modifikimet në real-time ----
function fbListenVGI() {
  if (!_fbReady) return;
  _fbCutoff = Date.now();
  _db.collection('vgi_reports')
    .onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        const r = ch.doc.data();

        if (ch.type === 'added') {
          // Kap vetëm raportet e reja (pas ngarkimit fillestar)
          if (r.koha_unix <= _fbCutoff) return;
          if (VGI_REPORTS.find(x => x.id === r.id)) return;

          VGI_REPORTS.push(r);

          if (typeof layerGroups !== 'undefined' && layerGroups.vgi && typeof icons !== 'undefined') {
            const m = L.marker([r.lat, r.lng], { icon: icons.vgi, vgiId: r.id })
              .bindPopup(popupVGI(r), { maxWidth: 280 });
            layerGroups.vgi.addLayer(m);
            vgiMarkers.push(m);
          }

          if (typeof updateStats === 'function') updateStats();
          if (typeof renderOperatorVGI === 'function') renderOperatorVGI();
          _fbToast('📍 Raport i ri VGI: ' + r.lloji + ' — ' + r.emri);

        } else if (ch.type === 'modified') {
          // Sinkronizo ndryshimet (konfirmim, refuzim, caktim) mes përdoruesve
          const idx = VGI_REPORTS.findIndex(x => x.id === r.id);
          if (idx !== -1) Object.assign(VGI_REPORTS[idx], r);

          if (r.statusi === 'refuzuar' || r.statusi === 'caktuar') {
            // Largo nga harta VGI dhe lista
            if (typeof updateVGIMarkers === 'function') updateVGIMarkers();
            if (typeof renderOperatorVGI === 'function') renderOperatorVGI();
          } else {
            const marker = vgiMarkers.find(mk => mk.options.vgiId === r.id);
            if (marker) marker.setPopupContent(popupVGI(r));
          }

          if (typeof updateStats === 'function') updateStats();
          _fbToast('🔄 VGI përditësuar: ' + r.lloji + ' → ' + r.statusi);
        }
      });
    });
}

// ---- VGI: përditëso statusin / caktimin ----
async function fbUpdateVGI(id, fields) {
  if (!_fbReady) return;
  try {
    const ref = _db.collection('vgi_reports').doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      await ref.update(fields);
    } else {
      // Raport statik (nga data.js) — ruaj dokumentin e plotë + fushat e reja
      const full = (typeof VGI_REPORTS !== 'undefined')
        ? VGI_REPORTS.find(x => x.id === id)
        : null;
      await ref.set(full ? { ...full, ...fields } : { id, ...fields });
    }
  } catch (e) {
    console.warn('[Firebase] përditësimi i VGI dështoi:', e.message);
  }
}

// ---- njoftim toast ----
function _fbToast(msg) {
  let t = document.getElementById('_fb-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_fb-toast';
    Object.assign(t.style, {
      position: 'fixed', bottom: '72px', left: '50%',
      transform: 'translateX(-50%)',
      background: '#1e2230', color: '#e8eaf0',
      padding: '8px 18px', borderRadius: '20px',
      fontSize: '12px', zIndex: '9998',
      border: '1px solid rgba(255,255,255,.15)',
      boxShadow: '0 4px 12px rgba(0,0,0,.5)',
      opacity: '0', transition: 'opacity .35s',
      whiteSpace: 'nowrap', pointerEvents: 'none',
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._tmr);
  t._tmr = setTimeout(() => { t.style.opacity = '0'; }, 4500);
}

// ---- liveDB: ruaj ndryshim të një fushe ----
async function fbSaveLiveDB(type, id, fieldKey, value) {
  if (!_fbReady) return;
  try {
    await _db.collection('livedb').doc(type + '|' + id).set({ [fieldKey]: value }, { merge: true });
  } catch (e) {
    console.warn('[Firebase] liveDB ruajtja dështoi:', e.message);
  }
}

// ---- liveDB: dëgjo ndryshimet (ngarkon edhe gjendjen fillestare) ----
function fbListenLiveDB() {
  if (!_fbReady) return;
  let _init = false;
  _db.collection('livedb').onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'removed') return;
      const data = ch.doc.data();
      const parts = ch.doc.id.split('|');
      const type = parts[0], id = parts[1];
      if (typeof liveDB !== 'undefined' && liveDB[type]) {
        const item = liveDB[type].find(s => s.id === id);
        if (item) Object.assign(item, data);
      }
    });
    if (_init) {
      if (typeof renderDBEditor === 'function') renderDBEditor();
    }
    if (typeof updateStats === 'function') updateStats();
    _init = true;
  });
}

// ---- Incidents: ruaj incident aktiv nga VGI ----
async function fbSaveIncident(feature) {
  if (!_fbReady) return;
  try {
    const p = feature.properties;
    await _db.collection('incidents_active').doc(p.id).set({
      ...p,
      lat: feature.geometry.coordinates[1],
      lng: feature.geometry.coordinates[0],
      koha_unix: Date.now(),
    });
  } catch (e) {
    console.warn('[Firebase] incidenti ruajtja dështoi:', e.message);
  }
}

// ---- Incidents: shëno si të zgjidhur (fshi nga aktive) ----
async function fbResolveIncident(id) {
  if (!_fbReady) return;
  try {
    await _db.collection('incidents_active').doc(id).delete();
  } catch (e) {
    console.warn('[Firebase] fshirja e incidentit dështoi:', e.message);
  }
}

// ---- Incidents: dëgjo incidentet aktive (shtim + heqje) ----
function fbListenIncidents() {
  if (!_fbReady) return;
  let _init = false;
  _db.collection('incidents_active').onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;

      if (ch.type === 'added') {
        const d = ch.doc.data();
        // Mos shto nëse ekziston tashmë lokalisht
        if (typeof INCIDENTS !== 'undefined' &&
            INCIDENTS.features.find(f => f.properties.id === id)) return;

        const feature = {
          type: 'Feature',
          properties: {
            id, lloji: d.lloji, ashpersia: d.ashpersia, statusi: d.statusi,
            sherbimi: d.sherbimi, sherbime: d.sherbime,
            koha: d.koha, adresa: d.adresa, pershkrimi: d.pershkrimi, njesia: d.njesia,
          },
          geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
        };
        if (typeof INCIDENTS !== 'undefined') INCIDENTS.features.push(feature);

        if (typeof layerGroups !== 'undefined' && layerGroups.incidents &&
            typeof createIncidentIcon !== 'undefined') {
          const m = L.marker([d.lat, d.lng], { icon: createIncidentIcon(d.ashpersia) })
            .bindPopup(popupIncident(feature.properties, d.lat, d.lng), { maxWidth: 280 });
          m.incidentData = feature.properties;
          layerGroups.incidents.addLayer(m);
          allIncidentMarkers.push(m);
        }
        if (typeof renderIncidentList === 'function') renderIncidentList();
        if (typeof updateStats === 'function') updateStats();
        if (_init) _fbToast('🚨 Incident i ri: ' + d.lloji + ' — ' + d.adresa);

      } else if (ch.type === 'removed') {
        if (typeof removeIncidentById === 'function') removeIncidentById(id);
        if (typeof renderIncidentList === 'function') renderIncidentList();
        if (typeof updateStats === 'function') updateStats();
        if (_init) _fbToast('✅ Incidenti u zgjidh: ' + id);
      }
    });
    _init = true;
  });
}

// ---- ekspozim publik ----
window.fbIsReady = function () { return _fbReady; };
