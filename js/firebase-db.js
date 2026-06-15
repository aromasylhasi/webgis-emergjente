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
      if (!VGI_REPORTS.find(x => x.id === r.id)) VGI_REPORTS.push(r);
    });
    if (onDone) onDone();
  } catch (e) {
    console.warn('[Firebase] ngarkimi i VGI dështoi:', e.message);
    if (onDone) onDone();
  }
}

// ---- VGI: dëgjo raportet e reja në real-time ----
function fbListenVGI() {
  if (!_fbReady) return;
  _fbCutoff = Date.now();
  _db.collection('vgi_reports')
    .where('koha_unix', '>', _fbCutoff)
    .onSnapshot(snap => {
      snap.docChanges().forEach(ch => {
        if (ch.type !== 'added') return;
        const r = ch.doc.data();
        if (VGI_REPORTS.find(x => x.id === r.id)) return;

        // Shto në array lokal
        VGI_REPORTS.push(r);

        // Shto marker në hartë
        if (typeof layerGroups !== 'undefined' && layerGroups.vgi && typeof icons !== 'undefined') {
          const m = L.marker([r.lat, r.lng], { icon: icons.vgi, vgiId: r.id })
            .bindPopup(popupVGI(r), { maxWidth: 280 });
          layerGroups.vgi.addLayer(m);
          vgiMarkers.push(m);
        }

        if (typeof updateStats === 'function') updateStats();
        _fbToast('📍 Raport i ri VGI: ' + r.lloji + ' — ' + r.emri);
      });
    });
}

// ---- VGI: përditëso statusin / caktimin ----
async function fbUpdateVGI(id, fields) {
  if (!_fbReady) return;
  try {
    await _db.collection('vgi_reports').doc(id).update(fields);
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

// ---- ekspozim publik ----
window.fbIsReady = function () { return _fbReady; };
