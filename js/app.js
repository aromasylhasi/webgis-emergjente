// ===== APP.JS — WebGIS Emergjente Kosovë =====

// Firebase: inicializo sa herët — para çdo gjëje tjetër
fbInit();

// ----- MAP INIT -----
const map = L.map('map', {
  center: [42.6629, 21.1655],
  zoom: 9,
  minZoom: 7,
  maxZoom: 18,
  zoomControl: true,
  attributionControl: true,
});

// ----- BASEMAPS -----
const basemaps = {
  osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 19
  }),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenTopoMap', maxZoom: 18, maxNativeZoom: 17
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri World Imagery', maxZoom: 19
  }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© CartoDB', maxZoom: 19
  }),
};
basemaps.satellite.addTo(map);

// ===== TOMTOM CONFIG — regjistrohu falas: developer.tomtom.com =====
// ----- ROADS OVERLAY PANE (above basemap tiles, below route/markers) -----
map.createPane('roadsPane');
map.getPane('roadsPane').style.zIndex = 250;
map.getPane('roadsPane').style.pointerEvents = 'none';

let roadsOverlay = null;

function buildRoadsOverlay() {
  map.getPane('roadsPane').style.mixBlendMode = 'normal';
  const opacity = _activeBasemap === 'dark' ? 0.35 : 0.62;
  roadsOverlay = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    { pane: 'roadsPane', opacity, maxZoom: 19, attribution: '© OpenStreetMap · © CartoDB' }
  );
}

function showRoadsOverlay(show) {
  if (show) {
    if (!roadsOverlay) buildRoadsOverlay();
    if (!map.hasLayer(roadsOverlay)) roadsOverlay.addTo(map);
  } else {
    if (roadsOverlay && map.hasLayer(roadsOverlay)) {
      map.removeLayer(roadsOverlay);
      roadsOverlay = null;
    }
  }
}

function enableRoadsLayer() {
  layerEnabled.roads = true;
  const chk = document.getElementById('roads-checkbox');
  if (chk) chk.checked = true;
  const leg = document.getElementById('roads-legend-section');
  if (leg) leg.style.display = 'block';
  showRoadsOverlay(true);
}

let _activeBasemap = 'satellite';

// ----- PROJECTIONS -----
proj4.defs('KOSOVAREF01', '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.9999 +x_0=7500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

// ----- STATE -----
let currentCRS = 'WGS84';
let currentTool = 'select';
let currentSymbolization = 'severity';
let activeFilters = new Set(['all']);
let selectedSeverity = 'med';
let pickingLocation = false;
let pickedLatLng = null;
let bufferCircle = null;
let bufferCenter = null;
let bufferRadiusKm = 5;
let layerGroups = {};
let allIncidentMarkers = [];
let vgiMarkers = [];
const stationMarkers = { police: [], fire: [], ambulance: [], hospitals: [] };

// Zoom threshold
const LAYER_THRESH = { stations: 11, incidents: 0, vgi: 10 };

// Gjendja e toggle-it
const layerEnabled = {
  police: true, fire: true, ambulance: true, hospitals: true,
  incidents: true, vgi: true, roads: false,
};

// ----- ICONS -----
function createIcon(cls, iconClass) {
  return L.divIcon({
    className: '',
    html: `<div class="marker-icon ${cls}"><i class="ti ${iconClass}"></i></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

function createIncidentIcon(ashpersia) {
  const colors = { high: '#dc2626', med: '#d97706', low: '#059669' };
  const color = colors[ashpersia] || colors.med;
  return L.divIcon({
    className: '',
    html: `<div class="marker-icon" style="background:${color};position:relative;">
             <i class="ti ti-alert-triangle"></i>
             <div class="marker-pulse" style="border-color:${color}"></div>
           </div>`,
    iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -20],
  });
}

const SERVICE_COLORS = {
  policia:    '#2563eb',
  zjarrfikes: '#dc2626',
  ambulance:  '#059669',
};

function createIncidentIconByService(sherbime) {
  const list = Array.isArray(sherbime) ? sherbime : [sherbime];
  const colors = list.map(s => SERVICE_COLORS[s] || '#6b7280');
  let bg;
  if (colors.length === 1) {
    bg = colors[0];
  } else if (colors.length === 2) {
    bg = `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)`;
  } else {
    bg = `linear-gradient(135deg, ${colors[0]} 33%, ${colors[1]} 33% 66%, ${colors[2]} 66%)`;
  }
  return L.divIcon({
    className: '',
    html: `<div class="marker-incident" style="background:${bg}"><i class="ti ti-alert-triangle"></i></div>`,
    iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -20],
  });
}

function createIncidentIconByStatus(statusi) {
  const map = {
    aktiv:      { color: '#dc2626', icon: 'ti-clock' },
    ne_trajtim: { color: '#d97706', icon: 'ti-loader-2' },
    zgjidhur:   { color: '#4b5563', icon: 'ti-circle-check' },
  };
  const s = map[statusi] || map.aktiv;
  return L.divIcon({
    className: '',
    html: `<div class="marker-icon" style="background:${s.color}"><i class="ti ${s.icon}"></i></div>`,
    iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -20],
  });
}

const LEGENDS = {
  type: [
    { colors: ['#2563eb'],           label: 'Policia' },
    { colors: ['#dc2626'],           label: 'Zjarrfikës' },
    { colors: ['#059669'],           label: 'Ambulancë' },
    { colors: ['#2563eb','#059669'], label: 'Policia + Ambulancë' },
    { colors: ['#dc2626','#059669'], label: 'Zjarrfikës + Ambulancë' },
    { colors: ['#dc2626','#2563eb'], label: 'Zjarrfikës + Policia' },
    { colors: ['#2563eb','#059669','#dc2626'], label: 'Policia + Ambulancë + Zjarrfikës' },
  ],
  severity: [
    { colors: ['#dc2626'], icon: 'ti-alert-triangle', label: 'Ashpërsi e lartë' },
    { colors: ['#d97706'], icon: 'ti-alert-triangle', label: 'Ashpërsi mesatare' },
    { colors: ['#059669'], icon: 'ti-alert-triangle', label: 'Ashpërsi e ulët' },
  ],
  status: [
    { colors: ['#dc2626'], icon: 'ti-clock',        label: 'Aktiv — në pritje' },
    { colors: ['#d97706'], icon: 'ti-loader-2',     label: 'Në trajtim' },
    { colors: ['#4b5563'], icon: 'ti-circle-check', label: 'Zgjidhur' },
  ],
};

function buildSwatchBg(colors) {
  if (colors.length === 1) return colors[0];
  if (colors.length === 2) return `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)`;
  return `linear-gradient(135deg, ${colors[0]} 33%, ${colors[1]} 33% 66%, ${colors[2]} 66%)`;
}

function renderLegend(type) {
  const leg = document.getElementById('sym-legend');
  if (!leg) return;
  const isType = type === 'type';
  leg.innerHTML = LEGENDS[type].map(item => {
    const bg = buildSwatchBg(item.colors || [item.color || '#888']);
    const shape = isType ? 'legend-swatch-circle' : 'legend-swatch';
    const icon = item.icon || 'ti-alert-triangle';
    return `<div class="legend-row">
      <div class="${shape}" style="background:${bg}"><i class="ti ${icon}"></i></div>
      <span class="legend-label">${item.label}</span>
    </div>`;
  }).join('');
}

const icons = {
  police:    createIcon('marker-police',    'ti-shield'),
  fire:      createIcon('marker-fire',      'ti-flame'),
  ambulance: createIcon('marker-ambulance', 'ti-ambulance'),
  hospital:  createIcon('marker-hospital',  'ti-building-hospital'),
  vgi:       createIcon('marker-vgi',       'ti-user-pin'),
};

// ----- POPUP BUILDERS -----
function popupPolice(p) {
  const kap = p.kapaciteti && p.kapaciteti !== "—" ? `${p.kapaciteti} efektivë` : "—";
  const aut = p.automjete && p.automjete !== "—" ? `${p.automjete} automjete` : "—";
  return `<div class="popup-header">
    <div class="popup-icon" style="background:#2563eb"><i class="ti ti-shield"></i></div>
    <div><div class="popup-title">${p.emri}</div><div class="popup-sub">${p.adresa}</div></div>
  </div>
  <div class="popup-row"><span class="popup-row-label">Telefoni</span><span class="popup-row-val">${p.tel || "192"}</span></div>
  <div class="popup-row"><span class="popup-row-label">Personeli</span><span class="popup-row-val">${kap}</span></div>
  <div class="popup-row"><span class="popup-row-label">Automjetet</span><span class="popup-row-val">${aut}</span></div>
  <div class="popup-row"><span class="popup-row-label">Statusi</span><span class="sev-pill low">Aktiv</span></div>`;
}

function popupFire(p) {
  const kap = p.kapaciteti && p.kapaciteti !== "—" ? `${p.kapaciteti} persona` : "—";
  const aut = p.automjete && p.automjete !== "—" ? `${p.automjete} automjete` : "—";
  return `<div class="popup-header">
    <div class="popup-icon" style="background:#dc2626"><i class="ti ti-flame"></i></div>
    <div><div class="popup-title">${p.emri}</div><div class="popup-sub">${p.adresa}</div></div>
  </div>
  <div class="popup-row"><span class="popup-row-label">Emergjecat</span><span class="popup-row-val">193</span></div>
  <div class="popup-row"><span class="popup-row-label">Personeli</span><span class="popup-row-val">${kap}</span></div>
  <div class="popup-row"><span class="popup-row-label">Automjetet</span><span class="popup-row-val">${aut}</span></div>
  <div class="popup-row"><span class="popup-row-label">Statusi</span><span class="sev-pill low">Aktiv</span></div>`;
}

function popupAmb(p) {
  const amb = p.ambulancat && p.ambulancat !== "—" ? `${p.ambulancat} njësi` : "—";
  return `<div class="popup-header">
    <div class="popup-icon" style="background:#059669"><i class="ti ti-ambulance"></i></div>
    <div><div class="popup-title">${p.emri}</div><div class="popup-sub">${p.adresa}</div></div>
  </div>
  <div class="popup-row"><span class="popup-row-label">Emergjenca</span><span class="popup-row-val">194</span></div>
  <div class="popup-row"><span class="popup-row-label">Ambulancat</span><span class="popup-row-val">${amb}</span></div>
  <div class="popup-row"><span class="popup-row-label">Statusi</span><span class="sev-pill low">Aktiv</span></div>`;
}

function popupHosp(p) {
  const sht = p["shtretër"] && p["shtretër"] !== "—" ? p["shtretër"] : "—";
  const icu = p.ICU && p.ICU !== "—" ? `${p.ICU} shtretër` : "—";
  return `<div class="popup-header">
    <div class="popup-icon" style="background:#7c3aed"><i class="ti ti-building-hospital"></i></div>
    <div><div class="popup-title">${p.emri}</div><div class="popup-sub">${p.adresa}</div></div>
  </div>
  <div class="popup-row"><span class="popup-row-label">Telefoni</span><span class="popup-row-val">${p.tel || "—"}</span></div>
  <div class="popup-row"><span class="popup-row-label">Shtretërit</span><span class="popup-row-val">${sht}</span></div>
  <div class="popup-row"><span class="popup-row-label">ICU</span><span class="popup-row-val">${icu}</span></div>
  <div class="popup-row"><span class="popup-row-label">Urgjenca 24/7</span><span class="sev-pill low">Po</span></div>`;
}

function popupIncident(p, lat, lng) {
  const sevClass = p.ashpersia === 'high' ? 'high' : p.ashpersia === 'med' ? 'med' : 'low';
  const sevText = p.ashpersia === 'high' ? 'E lartë' : p.ashpersia === 'med' ? 'Mesatare' : 'E ulët';
  const svcColor = p.sherbimi === 'policia' ? '#2563eb' : p.sherbimi === 'zjarrfikes' ? '#dc2626' : '#059669';
  const nfPart = lat !== undefined
    ? `<div class="popup-nf-wrap"><button class="popup-nf-btn" onclick="triggerNearestFacility(${lat},${lng})"><i class="ti ti-map-pin-bolt"></i> Gjej njësinë afërt</button></div>`
    : '';
  return `<div class="popup-header">
    <div class="popup-icon" style="background:${svcColor}"><i class="ti ti-alert-triangle"></i></div>
    <div><div class="popup-title">${p.lloji}</div><div class="popup-sub">${p.adresa}</div></div>
  </div>
  <div class="popup-row"><span class="popup-row-label">Ashpërsia</span><span class="sev-pill ${sevClass}">${sevText}</span></div>
  <div class="popup-row"><span class="popup-row-label">Koha</span><span class="popup-row-val">${p.koha}</span></div>
  <div class="popup-row"><span class="popup-row-label">Njësia</span><span class="popup-row-val">${p.njesia}</span></div>
  <div class="popup-row"><span class="popup-row-label">Pershkrimi</span><span class="popup-row-val" style="font-size:10px;max-width:140px;text-align:right">${p.pershkrimi}</span></div>${nfPart}${p.id ? `<div class="popup-nf-wrap"><button class="popup-nf-btn" style="background:rgba(16,185,129,.15);border-color:rgba(16,185,129,.4);color:#10b981" onclick="resolveIncident('${p.id}')"><i class="ti ti-circle-check"></i> Shëno si të zgjidhur</button></div>` : ''}`;
}

function popupVGI(r) {
  const sevClass = r.statusi === 'konfirmuar' ? 'low' : r.statusi === 'refuzuar' ? 'high' : 'med';
  const sevText  = r.statusi === 'konfirmuar' ? 'Konfirmuar' : r.statusi === 'refuzuar' ? 'Refuzuar' : 'Pa verifikuar';
  const iconColor = r.statusi === 'konfirmuar' ? '#059669' : r.statusi === 'refuzuar' ? '#6b7280' : '#db2777';
  return `<div class="popup-header">
    <div class="popup-icon" style="background:${iconColor}"><i class="ti ti-user-pin"></i></div>
    <div><div class="popup-title">VGI — ${r.lloji}</div><div class="popup-sub">${r.adresa}</div></div>
  </div>
  <div class="popup-row"><span class="popup-row-label">Raportuesi</span><span class="popup-row-val">${r.emri}</span></div>
  <div class="popup-row"><span class="popup-row-label">Koha</span><span class="popup-row-val">${r.koha}</span></div>
  <div class="popup-row"><span class="popup-row-label">Statusi</span><span class="sev-pill ${sevClass}">${sevText}</span></div>
  <div class="popup-row"><span class="popup-row-label">Pershkrimi</span><span class="popup-row-val" style="font-size:10px;max-width:140px;text-align:right">${r.pershkrimi}</span></div>`;
}

// ----- LOAD LAYERS -----
function loadLayers() {
  // Stacionet — layer group individual për secilën kategori (pa grumbullim)
  layerGroups.police    = L.layerGroup();
  layerGroups.fire      = L.layerGroup();
  layerGroups.ambulance = L.layerGroup();
  layerGroups.hospitals = L.layerGroup();

  stationMarkers.police = [];
  STATIONS_POLICE.features.forEach(f => {
    const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { icon: icons.police })
      .bindPopup(popupPolice(f.properties), { maxWidth: 280 });
    stationMarkers.police.push(m);
  });

  stationMarkers.fire = [];
  STATIONS_FIRE.features.forEach(f => {
    const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { icon: icons.fire })
      .bindPopup(popupFire(f.properties), { maxWidth: 280 });
    stationMarkers.fire.push(m);
  });

  stationMarkers.ambulance = [];
  STATIONS_AMB.features.forEach(f => {
    const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { icon: icons.ambulance })
      .bindPopup(popupAmb(f.properties), { maxWidth: 280 });
    stationMarkers.ambulance.push(m);
  });

  stationMarkers.hospitals = [];
  HOSPITALS.features.forEach(f => {
    const m = L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { icon: icons.hospital })
      .bindPopup(popupHosp(f.properties), { maxWidth: 280 });
    stationMarkers.hospitals.push(m);
  });

  rebuildStationsLayer();

  // Incidents — cluster group
  layerGroups.incidents = L.markerClusterGroup({
    maxClusterRadius: 55,
    disableClusteringAtZoom: 13,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: function(cluster) {
      const n = cluster.getChildCount();
      const sz = n < 10 ? 36 : n < 30 ? 42 : 48;
      return L.divIcon({
        html: `<div class="cluster-inc" style="width:${sz}px;height:${sz}px">${n}</div>`,
        className: '', iconSize: [sz, sz], iconAnchor: [sz/2, sz/2],
      });
    },
  });
  allIncidentMarkers = [];
  INCIDENTS.features.forEach(f => {
    const p = f.properties;
    const lat = f.geometry.coordinates[1], lng = f.geometry.coordinates[0];
    const m = L.marker([lat, lng], { icon: createIncidentIcon(p.ashpersia) })
      .bindPopup(popupIncident(p, lat, lng), { maxWidth: 280 });
    m.incidentData = p;
    layerGroups.incidents.addLayer(m);
    allIncidentMarkers.push(m);
  });

  // VGI — ngarko të dhënat statike
  vgiMarkers = [];
  layerGroups.vgi = L.layerGroup();
  VGI_REPORTS.forEach(r => {
    const m = L.marker([r.lat, r.lng], { icon: icons.vgi, vgiId: r.id })
      .bindPopup(popupVGI(r), { maxWidth: 280 });
    layerGroups.vgi.addLayer(m);
    vgiMarkers.push(m);
  });

  // Firebase: ngarko raportet e ruajtura dhe aktivizo real-time
  fbLoadVGI(function() {
    // Shto markerat e rinj nga Firebase (që nuk ishin në të dhënat statike)
    VGI_REPORTS.forEach(r => {
      if (!vgiMarkers.find(m => m.options.vgiId === r.id)) {
        const m = L.marker([r.lat, r.lng], { icon: icons.vgi, vgiId: r.id })
          .bindPopup(popupVGI(r), { maxWidth: 280 });
        layerGroups.vgi.addLayer(m);
        vgiMarkers.push(m);
      }
    });
    updateStats();
  });
  fbListenVGI();

  // Shto sipas zoom dhe toggle
  updateLayerVisibility(map.getZoom());

  updateStats();
  renderIncidentList();
}

// ----- STATIONS REBUILD -----
function rebuildStationsLayer() {
  ['police','fire','ambulance','hospitals'].forEach(type => {
    layerGroups[type].clearLayers();
    if (layerEnabled[type]) {
      stationMarkers[type].forEach(m => layerGroups[type].addLayer(m));
    }
  });
}

// ----- LAYER VISIBILITY BY ZOOM -----
function updateLayerVisibility(z) {
  // Stacionet — secila kategori individualisht (pa grumbullim)
  ['police','fire','ambulance','hospitals'].forEach(type => {
    const show = layerEnabled[type] && z >= LAYER_THRESH.stations;
    if (show && !map.hasLayer(layerGroups[type])) layerGroups[type].addTo(map);
    else if (!show && map.hasLayer(layerGroups[type])) map.removeLayer(layerGroups[type]);
  });

  // Shtresat e tjera
  ['incidents','vgi'].forEach(key => {
    if (!layerGroups[key]) return;
    const show = layerEnabled[key] && z >= (LAYER_THRESH[key] || 0);
    if (show && !map.hasLayer(layerGroups[key])) layerGroups[key].addTo(map);
    else if (!show && map.hasLayer(layerGroups[key])) map.removeLayer(layerGroups[key]);
  });
}

function applyZoomClass(z) {
  const el = document.getElementById('map');
  el.classList.remove('zoom-s', 'zoom-m', 'zoom-l');
  if (z <= 9)       el.classList.add('zoom-s');
  else if (z <= 12) el.classList.add('zoom-m');
  else              el.classList.add('zoom-l');
}

// ----- STATS -----
function sumDB(type, field) {
  return (liveDB[type] || []).reduce((s, r) => s + (r[field] || 0), 0);
}

function updateStats() {
  document.getElementById('stat-active').textContent = INCIDENTS.features.length;
  document.getElementById('stat-police').textContent = sumDB('police', 'automjete_aktive');
  document.getElementById('stat-fire').textContent   = sumDB('fire', 'automjete_aktive');
  document.getElementById('stat-amb').textContent    = sumDB('ambulance', 'ambulancat_aktive');
  document.getElementById('inc-count').textContent = INCIDENTS.features.length;
  document.getElementById('feature-count').textContent =
    `Objekte: ${STATIONS_POLICE.features.length + STATIONS_FIRE.features.length + STATIONS_AMB.features.length + HOSPITALS.features.length} stacione · ${INCIDENTS.features.length} incidente`;
  const pending = VGI_REPORTS.filter(r => r.statusi === 'pa_verifikuar').length;
  document.getElementById('vgi-pending').textContent = `${pending} raporte në pritje`;
}

// ----- INCIDENT LIST -----
function renderIncidentList(filtered) {
  const list = document.getElementById('incident-list');
  const incidents = filtered || INCIDENTS.features;
  const svcMap = { policia:'police', zjarrfikes:'fire', ambulance:'amb' };
  list.innerHTML = incidents.map(f => {
    const p = f.properties;
    const services = p.sherbime || [p.sherbimi];
    const badges = services.map(s =>
      `<span class="inc-service ${svcMap[s] || ''}">${s}</span>`
    ).join('');
    return `<div class="inc-card" onclick="flyToIncident(${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]})">
      <div class="inc-top">
        <div class="sev-dot ${p.ashpersia}"></div>
        <span class="inc-type">${p.lloji}</span>
        <span class="inc-time">${p.koha}</span>
      </div>
      <div class="inc-loc">
        <div class="inc-addr"><i class="ti ti-map-pin" style="font-size:11px;flex-shrink:0"></i> ${p.adresa}</div>
        <div class="inc-services">${badges}</div>
      </div>
    </div>`;
  }).join('');
}

function flyToIncident(lat, lng) {
  map.flyTo([lat, lng], 17, { duration: 1.5 });
}

// ----- LAYER TOGGLE -----
function toggleLayer(layerName, visible) {
  layerEnabled[layerName] = visible;
  if (layerName === 'roads') {
    showRoadsOverlay(visible);
    const leg = document.getElementById('roads-legend-section');
    if (leg) leg.style.display = visible ? 'block' : 'none';
    return;
  }
  if (['police','fire','ambulance','hospitals'].includes(layerName)) {
    rebuildStationsLayer();
    updateLayerVisibility(map.getZoom());
  } else {
    updateLayerVisibility(map.getZoom());
  }
}

// ----- FILTER -----
function filterIncidents(type) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  event.target.classList.add('active');

  const filtered = type === 'all'
    ? INCIDENTS.features
    : INCIDENTS.features.filter(f => (f.properties.sherbime || [f.properties.sherbimi]).includes(type));

  renderIncidentList(filtered);

  layerGroups.incidents.clearLayers();
  filtered.forEach(f => {
    const p = f.properties;
    const lat = f.geometry.coordinates[1], lng = f.geometry.coordinates[0];
    let icon;
    if (currentSymbolization === 'type') {
      icon = createIncidentIconByService(p.sherbime || p.sherbimi);
    } else if (currentSymbolization === 'severity') {
      icon = createIncidentIcon(p.ashpersia);
    } else {
      icon = createIncidentIconByStatus(p.statusi);
    }
    const m = L.marker([lat, lng], { icon })
      .bindPopup(popupIncident(p, lat, lng), { maxWidth: 280 });
    layerGroups.incidents.addLayer(m);
  });
}

// ----- SYMBOLIZATION -----
function changeSymbolization(type) {
  currentSymbolization = type;
  layerGroups.incidents.clearLayers();
  INCIDENTS.features.forEach(f => {
    const p = f.properties;
    let icon;
    if (type === 'type') {
      icon = createIncidentIconByService(p.sherbime || p.sherbimi);
    } else if (type === 'severity') {
      icon = createIncidentIcon(p.ashpersia);
    } else {
      icon = createIncidentIconByStatus(p.statusi);
    }
    const lat = f.geometry.coordinates[1], lng = f.geometry.coordinates[0];
    layerGroups.incidents.addLayer(
      L.marker([lat, lng], { icon })
        .bindPopup(popupIncident(p, lat, lng), { maxWidth: 280 })
    );
  });
  renderLegend(type);
}

// ----- BASEMAP -----
function setBasemap(name, btn) {
  Object.values(basemaps).forEach(b => map.removeLayer(b));
  basemaps[name].addTo(map);
  basemaps[name].bringToBack();
  document.querySelectorAll('.bm-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _activeBasemap = name;
  // Rindërto overlay me opacity të saktë për basemap-in e ri
  if (layerEnabled.roads && roadsOverlay) {
    map.removeLayer(roadsOverlay);
    roadsOverlay = null;
    showRoadsOverlay(true);
  }
}

// ----- TOOL SELECTION -----
function setTool(tool) {
  currentTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + tool)?.classList.add('active');

  const panels = { buffer: 'buffer-panel', measure: 'measure-panel', route: 'route-panel', analyze: 'analysis-panel' };
  Object.keys(panels).forEach(k => {
    document.getElementById(panels[k]).style.display = k === tool ? 'flex' : 'none';
  });

  if (tool === 'buffer') {
    cancelMeasure(); clearRoute();
    map.doubleClickZoom.enable();
    map.getContainer().style.cursor = 'crosshair';
    setStatus('Zgjidhni rrezen dhe klikoni në hartë për të vendosur qendrën e bufferit...');
  } else if (tool === 'measure') {
    clearBuffer(); clearRoute();
    map.doubleClickZoom.disable();
    map.getContainer().style.cursor = 'crosshair';
    setStatus('Zgjidhni llojin e matjes dhe klikoni pikat në hartë...');
  } else if (tool === 'route') {
    clearBuffer(); cancelMeasure();
    map.doubleClickZoom.enable();
    map.getContainer().style.cursor = 'crosshair';
    _roadsBeforeRoute = layerEnabled.roads;   // ruaj gjendjen para hyrjes
    if (!layerEnabled.roads) enableRoadsLayer();
    initRoutePanel();
    setStatus('Kliko dy pika në hartë — rruga llogaritet automatikisht...');
  } else if (tool === 'analyze') {
    clearBuffer(); cancelMeasure(); clearRoute();
    if (!_roadsBeforeRoute && layerEnabled.roads) {
      toggleLayer('roads', false);
      const chk = document.getElementById('roads-checkbox');
      if (chk) chk.checked = false;
    }
    _roadsBeforeRoute = null;
    map.doubleClickZoom.enable();
    map.getContainer().style.cursor = 'crosshair';
    switchAnalysisTab(_activeAnTab);
    setStatus('Zgjidh llojin e analizës dhe konfiguró parametrat...');
  } else {
    clearBuffer(); cancelMeasure(); clearRoute(); clearAllAnalysis();
    if (!_roadsBeforeRoute && layerEnabled.roads) {
      toggleLayer('roads', false);
      const chk = document.getElementById('roads-checkbox');
      if (chk) chk.checked = false;
    }
    _roadsBeforeRoute = null;
    showRoadsOverlay(false);
    map.doubleClickZoom.enable();
    map.getContainer().style.cursor = '';
    setStatus('Sistemi aktiv — të dhënat e përditësuara');
  }
}

// ----- MAP CLICK -----
let measurePoints = [];
let measureMode = 'distance';
let measureLayers = [];
let _mTempLayer = null;
let _mPreviewLayer = null;
let _mDots = [];
map.on('click', function(e) {
  const { lat, lng } = e.latlng;
  const coords = formatCoords(lat, lng);
  document.getElementById('coord-display').textContent = coords.display;
  document.getElementById('coord-bar').textContent = coords.bar;

  if (pickingLocation) {
    pickedLatLng = { lat, lng };
    document.getElementById('vgi-coords').textContent = coords.vgi;
    pickingLocation = false;
    document.getElementById('vgi-modal').style.display = 'flex';
    map.getContainer().style.cursor = '';
    L.marker([lat, lng], { icon: icons.vgi }).addTo(map)
      .bindPopup('Vendndodhja e zgjedhur').openPopup();
    return;
  }

  if (currentTool === 'route') {
    handleRouteClick(lat, lng, `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`);
    return;
  }

  if (currentTool === 'analyze') {
    handleAnalysisClick(lat, lng);
    return;
  }

  if (currentTool === 'buffer') {
    const radiusKm = parseFloat(document.getElementById('buffer-radius').value) || 5;
    if (bufferCircle) map.removeLayer(bufferCircle);
    drawBuffer(lat, lng, radiusKm);
    return;
  }

  if (currentTool === 'measure') {
    addMeasurePoint(lat, lng);
    return;
  }
});

map.on('mousemove', function(e) {
  const coords = formatCoords(e.latlng.lat, e.latlng.lng);
  document.getElementById('coord-bar').textContent = coords.bar;
  if (currentTool === 'measure' && measurePoints.length > 0) {
    updateMeasurePreview(e.latlng.lat, e.latlng.lng);
  }
});

map.on('dblclick', function(e) {
  if (currentTool !== 'measure') return;
  L.DomEvent.stopPropagation(e);
  // dblclick fires after 2 click events — remove the duplicate last point
  if (measurePoints.length > 0) {
    measurePoints.pop();
    if (_mDots.length > 0) { map.removeLayer(_mDots.pop()); }
    rebuildMeasureTempLayer();
    updateMeasureLiveDisplay();
  }
  finishMeasure();
});

map.on('zoomend', function() {
  const z = map.getZoom();
  document.getElementById('zoom-display').textContent = `Zoom: ${z}`;
  const scales = { 7:'1:500,000', 8:'1:350,000', 9:'1:250,000', 10:'1:150,000', 11:'1:75,000', 12:'1:40,000', 13:'1:20,000', 14:'1:10,000', 15:'1:5,000', 16:'1:2,500', 17:'1:1,000', 18:'1:500' };
  document.getElementById('scale-display').textContent = `Shkalla: ${scales[z] || '1:'+Math.round(591657550/Math.pow(2,z))}`;
  updateBoundaryVisibility(z);
  updateLayerVisibility(z);
  applyZoomClass(z);
});

// ----- VGI FORM -----
function openVGIForm() {
  document.getElementById('vgi-modal').style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function pickOnMap() {
  closeModal('vgi-modal');
  pickingLocation = true;
  map.getContainer().style.cursor = 'crosshair';
  setStatus('Kliko në hartë për të zgjedhur vendndodhjen...');
}

function selectSev(btn, val) {
  document.querySelectorAll('.sev-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedSeverity = val;
}

function submitVGI() {
  const lloji = document.getElementById('vgi-type').value;
  const adresa = document.getElementById('vgi-location').value;
  const pershkrimi = document.getElementById('vgi-desc').value;
  const emri = document.getElementById('vgi-name').value || 'Anonime';

  if (!lloji) { alert('Zgjidh llojin e incidentit!'); return; }
  if (!adresa && !pickedLatLng) { alert('Jep vendndodhjen!'); return; }

  const lat = pickedLatLng?.lat || 42.6629 + (Math.random() - 0.5) * 0.5;
  const lng = pickedLatLng?.lng || 21.1655 + (Math.random() - 0.5) * 0.5;

  const newReport = { id: 'VGI' + Date.now(), lloji, adresa, lat, lng, pershkrimi, emri, koha: new Date().toLocaleTimeString('sq', {hour:'2-digit',minute:'2-digit'}), koha_unix: Date.now(), statusi:'pa_verifikuar' };
  VGI_REPORTS.push(newReport);
  fbSaveVGI(newReport);

  L.marker([lat, lng], { icon: icons.vgi })
    .bindPopup(popupVGI(newReport), { maxWidth: 280 })
    .addTo(layerGroups.vgi).openPopup();

  renderOperatorVGI();
  const pending = VGI_REPORTS.filter(r => r.statusi === 'pa_verifikuar').length;
  document.getElementById('vgi-pending').textContent = `${pending} raporte në pritje`;

  closeModal('vgi-modal');
  setStatus(`VGI: Raporti u dërgua me sukses — ${lloji}`);
  pickedLatLng = null;
  document.getElementById('vgi-type').value = '';
  document.getElementById('vgi-location').value = '';
  document.getElementById('vgi-desc').value = '';
  document.getElementById('vgi-coords').textContent = 'Koordinatat do të shfaqen këtu pas zgjedhjes në hartë';
}

// ----- SEARCH -----
let _searchTimer   = null;
let _searchMarker  = null;
let _sriFocusIdx   = -1;

const _SRI_ICONS = {
  police:'ti-shield', fire:'ti-flame', ambulance:'ti-ambulance',
  hospital:'ti-building-hospital', incident:'ti-alert-triangle',
  highway:'ti-road', road:'ti-road', residential:'ti-road',
  city:'ti-building', town:'ti-building', village:'ti-home',
  suburb:'ti-map-pin', neighbourhood:'ti-map-pin',
  house:'ti-home-2', building:'ti-building',
};
const _SRI_COLORS = {
  police:'#2563eb', fire:'#dc2626', ambulance:'#059669',
  hospital:'#7c3aed', incident:'#d97706',
  highway:'#e8694a', road:'#f97316', residential:'#9ca3af',
  city:'#3b82f6', town:'#3b82f6', village:'#6366f1',
  default:'#6b7280',
};
const _SRI_LABELS = {
  highway:'Autostradë', road:'Rrugë', residential:'Rrugë lokale',
  city:'Qytet', town:'Qytet', village:'Fshat',
  suburb:'Lagje', neighbourhood:'Lagje',
  municipality:'Komunë', county:'Rajon',
  house:'Adresë', building:'Ndërtesë',
  hospital:'Spital', school:'Shkollë', park:'Park',
};

function handleSearch(val) {
  const clearBtn = document.getElementById('search-clear-btn');
  if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
  clearTimeout(_searchTimer);
  _sriFocusIdx = -1;

  if (!val || val.length < 2) { hideSearchResults(); return; }

  // Kërko menjëherë në të dhënat lokale
  const lower = val.toLowerCase();
  const localHits = [
    ...STATIONS_POLICE.features.map(f => ({f, cat:'police'})),
    ...STATIONS_FIRE.features.map(f   => ({f, cat:'fire'})),
    ...STATIONS_AMB.features.map(f    => ({f, cat:'ambulance'})),
    ...HOSPITALS.features.map(f       => ({f, cat:'hospital'})),
    ...INCIDENTS.features.map(f       => ({f, cat:'incident'})),
  ].filter(({f}) =>
    (f.properties.emri || f.properties.lloji || '').toLowerCase().includes(lower) ||
    (f.properties.adresa || '').toLowerCase().includes(lower)
  ).slice(0, 4);

  // Trego loading + rezultate lokale ndërkohë
  renderSearchResults(localHits, null, true);

  // Pas 420ms kërko te Nominatim (debounce)
  _searchTimer = setTimeout(() => searchNominatim(val, localHits), 420);
}

// Kufijtë gjeografikë të Kosovës për filtrim client-side
const _KS = { minLat:41.85, maxLat:43.28, minLng:20.01, maxLng:21.80 };
const _inKosovo = (lat, lng) =>
  +lat >= _KS.minLat && +lat <= _KS.maxLat && +lng >= _KS.minLng && +lng <= _KS.maxLng;

async function searchNominatim(query, localHits) {
  try {
    const params = new URLSearchParams({
      q:              query,
      countrycodes:   'xk',
      viewbox:        `${_KS.minLng},${_KS.minLat},${_KS.maxLng},${_KS.maxLat}`,
      bounded:        '1',
      format:         'json',
      limit:          '20',       // kërkojmë 20 — pas filtrimit mbeten rreth 10
      dedupe:         '0',
      addressdetails: '1',
    });
    const url  = `https://nominatim.openstreetmap.org/search?${params}`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'sq,en' } });
    const raw  = await res.json();
    // Filtrim i dyfishtë client-side: largo gjithçka jashtë Kosovës
    const data = raw.filter(r => _inKosovo(r.lat, r.lon)).slice(0, 10);
    renderSearchResults(localHits, data, false);
  } catch {
    renderSearchResults(localHits, [], false);
  }
}

function renderSearchResults(localHits, nominatim, loading) {
  const box = document.getElementById('search-results');
  if (!box) return;
  let html = '';

  // Rezultate lokale
  localHits.forEach(({f, cat}) => {
    const name  = f.properties.emri || f.properties.lloji || '';
    const addr  = f.properties.adresa || '';
    const icon  = _SRI_ICONS[cat]  || 'ti-map-pin';
    const color = _SRI_COLORS[cat] || _SRI_COLORS.default;
    const co    = f.geometry.coordinates;
    html += sriRow(co[1], co[0], name, addr, icon, color, '', 17);
  });

  // Ndajës
  if (nominatim && nominatim.length > 0 && localHits.length > 0)
    html += `<div class="sri-sep"><i class="ti ti-map"></i> Rrugë &amp; lokacione</div>`;

  if (loading && !nominatim) {
    html += `<div class="sri-loading"><i class="ti ti-loader-2"></i> Duke kërkuar...</div>`;
  } else if (nominatim) {
    nominatim.forEach(r => {
      const cls   = r.type || r.class || 'default';
      const icon  = _SRI_ICONS[cls]  || _SRI_ICONS[r.class]  || 'ti-map-pin';
      const color = _SRI_COLORS[cls] || _SRI_COLORS[r.class] || _SRI_COLORS.default;
      const lbl   = _SRI_LABELS[cls] || _SRI_LABELS[r.class] || '';
      const parts = r.display_name.split(',');
      const name  = parts[0].trim();
      const sub   = parts.slice(1, 3).join(', ').trim();
      const zoom  = cls === 'house' || cls === 'building' || r.class === 'place' && cls === 'house' ? 18
                  : cls === 'residential' || cls === 'road' || r.class === 'highway' || cls === 'highway' ? 16
                  : cls === 'suburb' || cls === 'neighbourhood' || cls === 'village' ? 15
                  : cls === 'town' ? 13
                  : cls === 'city' ? 11
                  : 15;
      html += sriRow(r.lat, r.lon, name, sub, icon, color, lbl, zoom);
    });
  }

  if (!html) html = `<div class="sri-empty"><i class="ti ti-search-off"></i> Nuk u gjet asgjë</div>`;

  box.innerHTML = html;
  box.style.display = 'block';
}

function sriRow(lat, lng, name, sub, icon, color, typeLbl, zoom) {
  const safeName = name.replace(/'/g, '\\\'');
  return `<div class="search-result-item"
    onclick="flyToSearchResult(${lat},${lng},'${safeName}',${zoom})">
    <div class="sri-icon" style="background:${color}"><i class="ti ${icon}"></i></div>
    <div class="sri-info">
      <div class="sri-name">${name}${typeLbl ? `<span class="sri-type">${typeLbl}</span>` : ''}</div>
      ${sub ? `<div class="sri-sub">${sub}</div>` : ''}
    </div>
  </div>`;
}

function flyToSearchResult(lat, lng, name, zoom) {
  if (_searchMarker) { map.removeLayer(_searchMarker); _searchMarker = null; }
  map.flyTo([+lat, +lng], zoom, { duration: 1.2 });
  _searchMarker = L.marker([+lat, +lng], {
    icon: L.divIcon({
      className: '',
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42">
               <path d="M15 0C6.716 0 0 6.716 0 15c0 10.38 13.5 26.25 14.1 26.96a1.2 1.2 0 001.8 0C16.5 41.25 30 25.38 30 15 30 6.716 23.284 0 15 0z"
                     fill="#6366f1" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
               <circle cx="15" cy="14" r="6.5" fill="white" fill-opacity="0.95"/>
             </svg>`,
      iconSize:     [30, 42],
      iconAnchor:   [15, 42],   // maja e poshtme e pinit = koordinata e saktë
      popupAnchor:  [0, -44],
    })
  }).addTo(map).bindPopup(
    `<div style="font-size:12px;font-weight:600;padding:2px 0">${name}</div>`,
    { maxWidth: 220 }
  ).openPopup();
  setStatus(`Gjet: ${name}`);
  hideSearchResults();
  const inp = document.getElementById('search-input');
  if (inp) inp.value = name;
  const cb = document.getElementById('search-clear-btn');
  if (cb) cb.style.display = 'flex';
}

function hideSearchResults() {
  const el = document.getElementById('search-results');
  if (el) el.style.display = 'none';
  _sriFocusIdx = -1;
}

function clearSearch() {
  const inp = document.getElementById('search-input');
  if (inp) inp.value = '';
  document.getElementById('search-clear-btn').style.display = 'none';
  hideSearchResults();
  if (_searchMarker) { map.removeLayer(_searchMarker); _searchMarker = null; }
  clearTimeout(_searchTimer);
}

function handleSearchKey(e) {
  const items = document.querySelectorAll('.search-result-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _sriFocusIdx = Math.min(_sriFocusIdx + 1, items.length - 1);
    items[_sriFocusIdx]?.scrollIntoView({ block:'nearest' });
    items.forEach((el, i) => el.classList.toggle('focused', i === _sriFocusIdx));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _sriFocusIdx = Math.max(_sriFocusIdx - 1, 0);
    items[_sriFocusIdx]?.scrollIntoView({ block:'nearest' });
    items.forEach((el, i) => el.classList.toggle('focused', i === _sriFocusIdx));
  } else if (e.key === 'Enter' && _sriFocusIdx >= 0) {
    e.preventDefault();
    items[_sriFocusIdx]?.click();
  } else if (e.key === 'Escape') {
    hideSearchResults();
  }
}

// Mbyll dropdown kur klikohet jashtë
document.addEventListener('click', function(e) {
  if (!e.target.closest('.sidebar-search-wrap')) hideSearchResults();
});

// ----- DOWNLOAD -----
function downloadData() {
  const data = {
    policia: STATIONS_POLICE,
    zjarrfikes: STATIONS_FIRE,
    ambulance: STATIONS_AMB,
    spitalet: HOSPITALS,
    incidentet: INCIDENTS,
    vgi: { type:'FeatureCollection', features: VGI_REPORTS.map(r => ({
      type:'Feature', properties:r, geometry:{ type:'Point', coordinates:[r.lng, r.lat] }
    }))}
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'webgis-emergjente-kosove.geojson';
  a.click();
  setStatus('Të dhënat u shkarkuan si GeoJSON');
}

// ===== WMS / WFS — URL PANEL PËR QGIS / ARCGIS =====

let _activeWMSTab = 'wfs';

// Shtresat e WebGIS me URL-t GeoJSON
const WFS_LAYERS = [
  { id:'police',    title:'Stacionet Policore',   file:'stacionet_policore.geojson',   color:'#2563eb', icon:'ti-building-community', count:37 },
  { id:'fire',      title:'Stacionet Zjarrfikëse', file:'stacionet_zjarrfikes.geojson', color:'#dc2626', icon:'ti-fire-truck',          count:14 },
  { id:'ambulance', title:'Ambulancat / QKMF',     file:'ambulancat_qkmf.geojson',      color:'#059669', icon:'ti-ambulance',           count:17 },
  { id:'hospitals', title:'Spitalet',              file:'spitalet.geojson',             color:'#7c3aed', icon:'ti-building-hospital',   count:10 },
  { id:'incidents', title:'Incidentet Aktive',     file:'incidentet.geojson',           color:'#d97706', icon:'ti-alert-triangle',      count:25 },
];

// --- IMPLEMENTIM I RI ---
const WMS_PRESETS_PLACEHOLDER = {
  't-osm': {
    url: 'https://ows.terrestris.de/osm/service',
    layer: 'OSM-WMS',
    version: '1.1.1',
    format: 'image/png',
    title: 'OSM Standard (terrestris.de)',
    opacity: 0.85,
  },
  't-gray': {
    url: 'https://ows.terrestris.de/osm-gray/service',
    layer: 'OSM-WMS',
    version: '1.1.1',
    format: 'image/png',
    title: 'OSM Gri (terrestris.de)',
    opacity: 0.80,
  },
  't-topo': {
    url: 'https://ows.terrestris.de/osm/service',
    layer: 'OSM-Overlay-WMS',
    version: '1.1.1',
    format: 'image/png',
    title: 'OSM Overlay (terrestris.de)',
    opacity: 0.70,
  },
  'gs-sf-dem': {
    url: 'https://demo.geoserver.org/geoserver/wms',
    layer: 'sf:DEM',
    version: '1.1.1',
    format: 'image/png',
    title: 'DEM — Modeli dixhital i lartësisë',
    opacity: 0.75,
  },
  'gs-tiger-roads': {
    url: 'https://demo.geoserver.org/geoserver/wms',
    layer: 'tiger:tiger_roads',
    version: '1.1.1',
    format: 'image/png',
    title: 'Tiger — Rrugët (SHBA)',
    opacity: 0.80,
  },
  'gs-states': {
    url: 'https://demo.geoserver.org/geoserver/wms',
    layer: 'tiger:states',
    version: '1.1.1',
    format: 'image/png',
    title: 'Tiger — Shtetet e SHBA',
    opacity: 0.60,
  },
  'nasa-blue': {
    url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi',
    layer: 'BlueMarble_ShadedRelief_Bathymetry',
    version: '1.1.1',
    format: 'image/jpeg',
    title: 'NASA — Blue Marble',
    opacity: 0.90,
  },
};

// Shërbime WFS të para-konfiguruara publike (CORS aktiv)
const WFS_PRESETS = {
  'gs-archsites': {
    url: 'https://demo.geoserver.org/geoserver/ows',
    typeName: 'sf:archsites',
    version: '2.0.0',
    title: 'SF — Vendndodhjet arkeologjike',
    color: '#f59e0b',
    maxFeatures: 500,
  },
  'gs-bugsites': {
    url: 'https://demo.geoserver.org/geoserver/ows',
    typeName: 'sf:bugsites',
    version: '2.0.0',
    title: 'SF — Bug Sites',
    color: '#ef4444',
    maxFeatures: 500,
  },
  'gs-roads': {
    url: 'https://demo.geoserver.org/geoserver/ows',
    typeName: 'tiger:tiger_roads',
    version: '2.0.0',
    title: 'Tiger — Rrugët (vija)',
    color: '#f97316',
    maxFeatures: 200,
  },
  'gs-states': {
    url: 'https://demo.geoserver.org/geoserver/ows',
    typeName: 'tiger:states',
    version: '2.0.0',
    title: 'Tiger — Shtetet (poligon)',
    color: '#3b82f6',
    maxFeatures: 100,
  },
};

function showWMSPanel() {
  document.getElementById('wms-modal').style.display = 'flex';
  switchWMSTab(_activeWMSTab);
  buildWFSLayerGrid();
}

function switchWMSTab(tab) {
  _activeWMSTab = tab;
  ['wfs', 'wms', 'qgis'].forEach(t => {
    document.getElementById('wtab-' + t).style.display = t === tab ? 'flex' : 'none';
    document.getElementById('wtab-btn-' + t).classList.toggle('active', t === tab);
  });
}

function buildWFSLayerGrid() {
  const base = window.location.origin + (window.location.pathname.replace(/\/[^/]*$/, '') || '');
  document.getElementById('wms-base-url-text').textContent = base;

  const grid = document.getElementById('wfs-layers-grid');
  grid.innerHTML = WFS_LAYERS.map(lyr => {
    const url = `${base}/data/${lyr.file}`;
    return `
      <div class="wfs-layer-card">
        <div class="wfs-card-icon" style="background:${lyr.color}20;color:${lyr.color}">
          <i class="ti ${lyr.icon}"></i>
        </div>
        <div class="wfs-card-info">
          <div class="wfs-card-title">${lyr.title}</div>
          <div class="wfs-card-count">${lyr.count} objekte · GeoJSON</div>
          <code class="wfs-card-url" id="url-${lyr.id}">${url}</code>
        </div>
        <button class="wfs-copy-btn" onclick="copyLayerURL('${lyr.id}','${lyr.title}')" title="Kopjo URL-n">
          <i class="ti ti-copy"></i>
          <span>Kopjo</span>
        </button>
      </div>`;
  }).join('');
}

function copyLayerURL(layerId, title) {
  const el = document.getElementById('url-' + layerId);
  if (!el) return;
  copyText(el.textContent, `URL e "${title}" u kopjua!`);
  const btn = el.closest('.wfs-layer-card').querySelector('.wfs-copy-btn');
  btn.innerHTML = '<i class="ti ti-check"></i><span>Kopjuar</span>';
  btn.style.background = 'rgba(16,185,129,.2)';
  btn.style.borderColor = 'rgba(16,185,129,.4)';
  btn.style.color = 'var(--success)';
  setTimeout(() => {
    btn.innerHTML = '<i class="ti ti-copy"></i><span>Kopjo</span>';
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.style.color = '';
  }, 2000);
}

function copyText(text, msg) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
  if (msg) setStatus(msg);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

// Legacy — thirrur nga panel-i djathtas
function copyWMS() {
  const base = window.location.origin + (window.location.pathname.replace(/\/[^/]*$/, '') || '');
  copyText(`${base}/data/stacionet_policore.geojson`, 'WMS/GeoJSON URL u kopjua!');
  return false;
}
function copyWFS() {
  const base = window.location.origin + (window.location.pathname.replace(/\/[^/]*$/, '') || '');
  copyText(`${base}/data/stacionet_policore.geojson`, 'WFS/GeoJSON URL u kopjua!');
  return false;
}

function showVGIReports() {
  document.getElementById('vgi-list-modal').style.display = 'flex';
  renderVGIListModal('all');
  updateVGIFilterCounts();
}

function updateVGIFilterCounts() {
  const total = VGI_REPORTS.length;
  const pv    = VGI_REPORTS.filter(r => r.statusi === 'pa_verifikuar').length;
  const ko    = VGI_REPORTS.filter(r => r.statusi === 'konfirmuar').length;
  const re    = VGI_REPORTS.filter(r => r.statusi === 'refuzuar').length;
  document.getElementById('vgi-f-all').textContent = total;
  document.getElementById('vgi-f-pv').textContent  = pv;
  document.getElementById('vgi-f-ko').textContent  = ko;
  document.getElementById('vgi-f-re').textContent  = re;
}

function filterVGIList(filter, btn) {
  document.querySelectorAll('.vgi-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderVGIListModal(filter);
}

function renderVGIListModal(filter) {
  const body = document.getElementById('vgi-list-body');
  const list = filter === 'all'
    ? VGI_REPORTS
    : VGI_REPORTS.filter(r => r.statusi === filter);

  if (!list.length) {
    body.innerHTML = `
      <div class="vgi-list-empty">
        <i class="ti ti-file-off"></i>
        <span>Nuk ka raporte për këtë filtër</span>
      </div>`;
    return;
  }

  const STATUS_MAP = {
    pa_verifikuar: { cls: 'pv', label: 'Në pritje',   icon: 'ti-clock' },
    konfirmuar:    { cls: 'ko', label: 'Konfirmuar', icon: 'ti-circle-check' },
    refuzuar:      { cls: 're', label: 'Refuzuar',   icon: 'ti-circle-x' },
  };

  const TYPE_ICON = {
    'Bllokadë rrugore': 'ti-road-off',
    'Tymë dyshues':     'ti-flame',
    'Aksident rrugor':  'ti-car-crash',
    'Zjarr pyjor':      'ti-trees',
    'Rrugë e dëmtuar':  'ti-road',
    'Person i dyshimtë':'ti-user-question',
    'Vërshim i vogël':  'ti-droplet',
    'Lëndim këmbësor':  'ti-first-aid-kit',
  };

  body.innerHTML = list.map(r => {
    const st  = STATUS_MAP[r.statusi] || STATUS_MAP.pa_verifikuar;
    const ico = TYPE_ICON[r.lloji] || 'ti-alert-circle';
    return `
      <div class="vgi-report-card status-${r.statusi}" id="vlicard-${r.id}">
        <div class="vgi-card-top">
          <div class="vgi-card-icon ${st.cls}">
            <i class="ti ${ico}"></i>
          </div>
          <div class="vgi-card-main">
            <div class="vgi-card-row1">
              <span class="vgi-card-type">${r.lloji}</span>
              <span class="vgi-status-badge ${st.cls}">${st.label}</span>
            </div>
            <div class="vgi-card-addr">
              <i class="ti ti-map-pin"></i> ${r.adresa}
            </div>
            <div class="vgi-card-meta">
              <span class="vgi-card-meta-item"><i class="ti ti-clock"></i> ${r.koha}</span>
              <span class="vgi-card-meta-item"><i class="ti ti-user"></i> ${r.emri}</span>
              <span class="vgi-card-meta-item"><i class="ti ti-hash"></i> ${r.id}</span>
            </div>
          </div>
          <button class="vgi-zoom-btn" title="Shko te vendndodhja"
                  onclick="zoomToVGI(${r.lat},${r.lng},'${r.id}')">
            <i class="ti ti-map-pin-search"></i>
          </button>
        </div>
        <div class="vgi-card-desc">${r.pershkrimi}</div>
      </div>`;
  }).join('');
}

function zoomToVGI(lat, lng, id) {
  closeModal('vgi-list-modal');
  map.setView([lat, lng], 15, { animate: true });
  setTimeout(() => {
    const marker = vgiMarkers.find(m => m.options.vgiId === id);
    if (marker) marker.openPopup();
  }, 400);
  setStatus(`Lokacioni i raportit ${id} — ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
}

function findNearest() {
  closeModal('detail-modal');
  if (_nfPendingLat === null) { setStatus('Nuk ka vendndodhje të zgjedhur.'); return; }
  setTool('analyze');
  setTimeout(() => { switchAnalysisTab('nf'); computeNearestFacility(_nfPendingLat, _nfPendingLng); }, 120);
}

function triggerNearestFacility(lat, lng) {
  map.closePopup();
  _nfPendingLat = lat; _nfPendingLng = lng;
  setTool('analyze');
  setTimeout(() => { switchAnalysisTab('nf'); computeNearestFacility(lat, lng); }, 120);
}

// ----- BUFFER FUNCTIONS -----

function drawBuffer(lat, lng, radiusKm) {
  bufferCenter = { lat, lng };
  bufferRadiusKm = radiusKm;

  bufferCircle = L.circle([lat, lng], {
    radius: radiusKm * 1000,
    color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.08,
    weight: 2.5, dashArray: '8 4'
  }).addTo(map);

  bufferCircle.on('click', function(e) {
    L.DomEvent.stopPropagation(e);
    showBufferAnalysis();
  });

  const a = analyzeBuffer(lat, lng, radiusKm);
  updateBufferPanel(a, radiusKm);
  const total = a.police.length + a.fire.length + a.ambulance.length + a.hospitals.length;
  setStatus(`Buffer ${radiusKm} km: ${a.incidents.length} incidente · ${total} institucione brenda zonës`);
}

function clearBuffer() {
  if (bufferCircle) {
    map.removeLayer(bufferCircle);
    bufferCircle = null;
  }
  bufferCenter = null;
  const results = document.getElementById('bp-results');
  const step = document.getElementById('bp-step-click');
  const clearBtn = document.getElementById('bp-clear-btn');
  if (results) results.style.display = 'none';
  if (step) step.style.display = 'flex';
  if (clearBtn) clearBtn.style.display = 'none';
}

function syncInputFromSlider(val) {
  document.getElementById('buffer-radius').value = val;
  document.getElementById('bp-slider-val').textContent = parseFloat(val).toFixed(1) + ' km';
  if (bufferCenter) redrawBuffer();
}

function syncSliderFromInput() {
  const val = parseFloat(document.getElementById('buffer-radius').value) || 5;
  document.getElementById('buffer-slider').value = Math.min(val, 50);
  document.getElementById('bp-slider-val').textContent = val.toFixed(1) + ' km';
  if (bufferCenter) redrawBuffer();
}

function redrawBuffer() {
  if (!bufferCenter) return;
  const radiusKm = parseFloat(document.getElementById('buffer-radius').value) || 5;
  if (bufferCircle) map.removeLayer(bufferCircle);
  drawBuffer(bufferCenter.lat, bufferCenter.lng, radiusKm);
}

function analyzeBuffer(lat, lng, radiusKm) {
  const rM = radiusKm * 1000;
  const within = (f) => map.distance([lat, lng], [f.geometry.coordinates[1], f.geometry.coordinates[0]]) <= rM;
  return {
    incidents: INCIDENTS.features.filter(within),
    police: STATIONS_POLICE.features.filter(within),
    fire: STATIONS_FIRE.features.filter(within),
    ambulance: STATIONS_AMB.features.filter(within),
    hospitals: HOSPITALS.features.filter(within),
  };
}

function updateBufferPanel(a, radiusKm) {
  const total = a.police.length + a.fire.length + a.ambulance.length + a.hospitals.length;
  const results = document.getElementById('bp-results');
  if (!results) return;

  results.innerHTML = `
    <div class="bp-stat-row">
      <span class="bp-stat-label"><i class="ti ti-alert-triangle" style="color:var(--warn)"></i> Incidentet</span>
      <span class="bp-stat-num" style="color:var(--warn)">${a.incidents.length}</span>
    </div>
    <div class="bp-stat-row">
      <span class="bp-stat-label"><i class="ti ti-building" style="color:var(--accent)"></i> Institucionet</span>
      <span class="bp-stat-num" style="color:var(--accent)">${total}</span>
    </div>
    <div class="bp-chips">
      ${a.police.length    ? `<span class="bp-chip police"><i class="ti ti-shield"></i> ${a.police.length} pol.</span>` : ''}
      ${a.fire.length      ? `<span class="bp-chip fire"><i class="ti ti-flame"></i> ${a.fire.length} zjarr.</span>` : ''}
      ${a.ambulance.length ? `<span class="bp-chip amb"><i class="ti ti-ambulance"></i> ${a.ambulance.length} amb.</span>` : ''}
      ${a.hospitals.length ? `<span class="bp-chip hosp"><i class="ti ti-building-hospital"></i> ${a.hospitals.length} spit.</span>` : ''}
    </div>
    <div class="bp-click-hint"><i class="ti ti-hand-click"></i> Kliko mbi rreth për analizë të detajuar</div>
  `;

  results.style.display = 'flex';
  document.getElementById('bp-step-click').style.display = 'none';
  document.getElementById('bp-clear-btn').style.display = 'flex';
}

function showBufferAnalysis() {
  if (!bufferCenter) return;
  const { lat, lng } = bufferCenter;
  const radiusKm = bufferRadiusKm;
  const a = analyzeBuffer(lat, lng, radiusKm);
  const total = a.police.length + a.fire.length + a.ambulance.length + a.hospitals.length;

  const sevCol = { high: '#dc2626', med: '#d97706', low: '#059669' };
  const sevLbl = { high: 'E lartë', med: 'Mesatare', low: 'E ulët' };

  const distFmt = (f) => {
    const d = map.distance([lat, lng], [f.geometry.coordinates[1], f.geometry.coordinates[0]]);
    return (d / 1000).toFixed(1) + ' km';
  };

  const incList = a.incidents.length === 0
    ? `<div class="ba-empty"><i class="ti ti-circle-check"></i><span>Nuk ka incidente brenda zonës buffer</span></div>`
    : `<div class="ba-list">${a.incidents.map(f => {
        const p = f.properties;
        return `<div class="ba-inc-row">
          <div class="ba-inc-dot" style="background:${sevCol[p.ashpersia] || '#d97706'}"></div>
          <div class="ba-inc-info">
            <div class="ba-inc-type">${p.lloji}</div>
            <div class="ba-inc-addr"><i class="ti ti-map-pin"></i> ${p.adresa}</div>
            <div class="ba-inc-footer">
              <span class="sev-pill ${p.ashpersia}">${sevLbl[p.ashpersia] || ''}</span>
              <span class="ba-mono">${p.koha}</span>
              <span class="ba-dist">${distFmt(f)}</span>
            </div>
          </div>
        </div>`;
      }).join('')}</div>`;

  const institutions = [
    ...a.police.map(f    => ({ f, color:'#2563eb', icon:'ti-shield' })),
    ...a.fire.map(f      => ({ f, color:'#dc2626', icon:'ti-flame' })),
    ...a.ambulance.map(f => ({ f, color:'#059669', icon:'ti-ambulance' })),
    ...a.hospitals.map(f => ({ f, color:'#7c3aed', icon:'ti-building-hospital' })),
  ].sort((x, y) => {
    return map.distance([lat, lng], [x.f.geometry.coordinates[1], x.f.geometry.coordinates[0]])
         - map.distance([lat, lng], [y.f.geometry.coordinates[1], y.f.geometry.coordinates[0]]);
  });

  const instList = total === 0
    ? `<div class="ba-empty"><i class="ti ti-building-off"></i><span>Nuk ka institucione brenda zonës buffer</span></div>`
    : `<div class="ba-list">${institutions.map(({ f, color, icon }) => {
        const p = f.properties;
        return `<div class="ba-inst-row">
          <div class="ba-inst-ico" style="background:${color}"><i class="ti ${icon}"></i></div>
          <div class="ba-inst-info">
            <div class="ba-inst-name">${p.emri}</div>
            <div class="ba-inst-addr">${p.adresa}</div>
          </div>
          <span class="ba-dist">${distFmt(f)}</span>
        </div>`;
      }).join('')}</div>`;

  document.getElementById('buffer-modal-body').innerHTML = `
    <div class="ba-info-bar">
      <i class="ti ti-circle-dashed" style="color:#f59e0b;font-size:15px"></i>
      <span>Rrezja: <strong>${radiusKm} km</strong></span>
      <span class="ba-sep">·</span>
      <span style="font-family:var(--mono);font-size:10px">${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E</span>
    </div>
    <div class="ba-summary">
      <div class="ba-sum-card">
        <div class="ba-sum-icon" style="background:var(--warn)"><i class="ti ti-alert-triangle"></i></div>
        <div><div class="ba-sum-num" style="color:var(--warn)">${a.incidents.length}</div><div class="ba-sum-lbl">Incidente</div></div>
      </div>
      <div class="ba-sum-card">
        <div class="ba-sum-icon" style="background:var(--accent)"><i class="ti ti-building"></i></div>
        <div><div class="ba-sum-num" style="color:var(--accent)">${total}</div><div class="ba-sum-lbl">Institucione</div></div>
      </div>
    </div>
    <div class="ba-tabs">
      <button class="ba-tab active" id="ba-t-inc" onclick="switchBATab('inc')">
        <i class="ti ti-alert-triangle"></i> Incidentet <span class="ba-count">${a.incidents.length}</span>
      </button>
      <button class="ba-tab" id="ba-t-inst" onclick="switchBATab('inst')">
        <i class="ti ti-building"></i> Institucionet <span class="ba-count">${total}</span>
      </button>
    </div>
    <div class="ba-panel active" id="ba-p-inc">${incList}</div>
    <div class="ba-panel" id="ba-p-inst">${instList}</div>
  `;

  document.getElementById('buffer-modal').style.display = 'flex';
}

function switchBATab(tab) {
  document.querySelectorAll('.ba-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ba-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('ba-t-' + tab).classList.add('active');
  document.getElementById('ba-p-' + tab).classList.add('active');
}

// ===== SPATIAL ANALYSIS =====

let _muniData       = null;
let isoLayers       = [];
let _isoPickMode    = false;
let _nfMarker       = null;
let _nfLines        = [];
let _choroplethLyr  = null;
let _activeAnTab    = 'iso';
let _nfPendingLat   = null;
let _nfPendingLng   = null;

// ---- Tab switching ----
function switchAnalysisTab(tab) {
  _activeAnTab = tab;
  document.querySelectorAll('.ap-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ap-content').forEach(c => {
    c.classList.remove('active');
    c.style.display = 'none';
  });
  document.getElementById('apt-' + tab).classList.add('active');
  const activePane = document.getElementById('apc-' + tab);
  activePane.classList.add('active');
  activePane.style.display = 'flex';
  map.getContainer().style.cursor = (tab === 'nf' || (tab === 'iso' && _isoPickMode)) ? 'crosshair' : 'default';
  if (tab === 'stat') buildStatOverview();
}

function handleAnalysisClick(lat, lng) {
  if (_activeAnTab === 'iso' && _isoPickMode) {
    _isoPickMode = false;
    document.getElementById('iso-hint').style.display = 'none';
    map.getContainer().style.cursor = 'default';
    drawIsochroneLayers([{ lat, lng, name: `${lat.toFixed(4)}°N` }],
      getSelectedIntervals(), 40);
    return;
  }
  if (_activeAnTab === 'nf') {
    computeNearestFacility(lat, lng);
  }
}

function clearAllAnalysis() {
  clearIsochrones();
  clearNearestFacility();
  clearStats();
}

// ========================
// 1. IZOKRONET
// ========================
const ISO_SPEEDS = { police:45, fire:52, ambulance:58, hospital:40, map:40 };
const ISO_COLORS = {
  5:  { color:'#10b981', fillColor:'#10b981', fillOpacity:0.20, opacity:0.7 },
  10: { color:'#f59e0b', fillColor:'#f59e0b', fillOpacity:0.15, opacity:0.65 },
  15: { color:'#ef4444', fillColor:'#ef4444', fillOpacity:0.13, opacity:0.6 },
  20: { color:'#7c3aed', fillColor:'#7c3aed', fillOpacity:0.10, opacity:0.55 },
};

function getSelectedIntervals() {
  return Array.from(document.querySelectorAll('.iso-intervals input:checked'))
    .map(cb => parseInt(cb.value)).sort((a, b) => b - a);
}

function onIsoSourceChange() {
  const src = document.getElementById('iso-source').value;
  document.getElementById('iso-hint').style.display = src === 'map' ? 'flex' : 'none';
  _isoPickMode = false;
}

function generateIsochrones() {
  clearIsochrones();
  const src       = document.getElementById('iso-source').value;
  const intervals = getSelectedIntervals();
  if (!intervals.length) { setStatus('Zgjidh të paktën një interval kohor.'); return; }

  if (src === 'map') {
    _isoPickMode = true;
    document.getElementById('iso-hint').style.display = 'flex';
    map.getContainer().style.cursor = 'crosshair';
    setStatus('Kliko në hartë për të vendosur pikën e izokronit...');
    return;
  }

  const srcs = {
    police: STATIONS_POLICE.features,
    fire:   STATIONS_FIRE.features,
    ambulance: STATIONS_AMB.features,
    hospital:  HOSPITALS.features,
  };
  const features = srcs[src] || [];
  const points   = features.map(f => ({
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    name: f.properties.emri,
  }));

  drawIsochroneLayers(points, intervals, ISO_SPEEDS[src] || 45);
  const label = document.getElementById('iso-source').selectedOptions[0].text;
  setStatus(`Izokronet u gjeneruan: ${points.length} ${label.toLowerCase()}`);
}

function drawIsochroneLayers(points, intervals, speedKmh) {
  intervals.forEach(min => {
    const radiusM = speedKmh * (min / 60) * 1000;
    const style   = ISO_COLORS[min] || ISO_COLORS[15];
    points.forEach(pt => {
      const c = L.circle([pt.lat, pt.lng], {
        radius: radiusM, weight: 1.5, interactive: false, ...style,
      }).addTo(map);
      isoLayers.push(c);
    });
  });
  document.getElementById('iso-legend').style.display = 'flex';
  document.getElementById('iso-clear-btn').style.display = 'flex';
}

function clearIsochrones() {
  isoLayers.forEach(l => map.removeLayer(l));
  isoLayers = [];
  _isoPickMode = false;
  document.getElementById('iso-legend').style.display = 'none';
  document.getElementById('iso-clear-btn').style.display = 'none';
  document.getElementById('iso-hint').style.display = 'none';
}

// ========================
// 2. NJËSIA MË E AFËRT
// ========================
function computeNearestFacility(lat, lng) {
  if (_nfMarker) map.removeLayer(_nfMarker);
  _nfLines.forEach(l => map.removeLayer(l));
  _nfLines = [];

  _nfMarker = L.circleMarker([lat, lng], {
    radius: 7, color: '#fff', fillColor: '#6366f1', fillOpacity: 1, weight: 3,
  }).bindTooltip('Pika e zgjedhur').addTo(map);

  const catDefs = [
    { cat:'police',    features:STATIONS_POLICE.features, color:'#2563eb', icon:'ti-shield',            label:'Policia',      speed:45 },
    { cat:'fire',      features:STATIONS_FIRE.features,   color:'#dc2626', icon:'ti-flame',             label:'Zjarrfikës',   speed:52 },
    { cat:'ambulance', features:STATIONS_AMB.features,    color:'#059669', icon:'ti-ambulance',         label:'Ambulancë',    speed:58 },
    { cat:'hospital',  features:HOSPITALS.features,       color:'#7c3aed', icon:'ti-building-hospital', label:'Spital',       speed:40 },
  ];

  const nearest = catDefs.map(def => {
    if (!def.features.length) return null;
    const sorted = def.features
      .map(f => ({ f, d: map.distance([lat,lng],[f.geometry.coordinates[1],f.geometry.coordinates[0]]) }))
      .sort((a,b) => a.d - b.d);
    return { ...def, f: sorted[0].f, dist: sorted[0].d };
  }).filter(Boolean);

  // Vija ndërmjet pikës dhe njësive
  nearest.forEach(item => {
    const co = item.f.geometry.coordinates;
    const line = L.polyline([[lat,lng],[co[1],co[0]]], {
      color: item.color, weight: 2, dashArray:'6 4', opacity: 0.7, interactive:false,
    }).addTo(map);
    _nfLines.push(line);
  });

  const html = nearest.map(item => {
    const p        = item.f.properties;
    const distKm   = (item.dist / 1000).toFixed(1);
    const timeSec  = item.dist / (item.speed * 1000 / 3600);
    const timeMin  = Math.ceil(timeSec / 60);
    const co       = item.f.geometry.coordinates;
    const safeName = p.emri.replace(/'/g,"\\'");
    const adresa   = p.adresa ? `<div class="nf-item-addr">${p.adresa}</div>` : '';
    return `<div class="nf-item">
      <div class="nf-item-icon" style="background:${item.color}"><i class="ti ${item.icon}"></i></div>
      <div class="nf-item-info">
        <div class="nf-item-label">${item.label}</div>
        <div class="nf-item-name">${p.emri}</div>${adresa}
        <div class="nf-item-meta">
          <span><i class="ti ti-route"></i> ${distKm} km</span>
          <span><i class="ti ti-clock"></i> ~${timeMin} min</span>
        </div>
      </div>
      <button class="nf-route-btn" title="Rrugëzo drejt kësaj njësie"
        onclick="setTool('route');setTimeout(()=>{setRoutePoint('a',${lat},${lng},'${lat.toFixed(4)}°N');setRoutePoint('b',${co[1]},${co[0]},'${safeName}');calculateRoute();},80)">
        <i class="ti ti-route"></i>
      </button>
    </div>`;
  }).join('');

  document.getElementById('nf-results').innerHTML =
    `<div class="nf-marker-info">
      <span><i class="ti ti-map-pin"></i> ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E</span>
      <button class="nf-loc-clear" onclick="clearNearestFacility()" title="Largo lokacionin"><i class="ti ti-x"></i></button>
    </div>${html}`;
  document.getElementById('nf-results').style.display = 'flex';
  document.getElementById('nf-hint').style.display = 'none';
  document.getElementById('nf-clear-btn').style.display = 'flex';
  setStatus(`Njësia më e afërt u gjet — ${nearest.length} kategori`);
}

function clearNearestFacility() {
  if (_nfMarker) { map.removeLayer(_nfMarker); _nfMarker = null; }
  _nfLines.forEach(l => map.removeLayer(l));
  _nfLines = [];
  document.getElementById('nf-results').style.display = 'none';
  document.getElementById('nf-hint').style.display = 'flex';
  document.getElementById('nf-clear-btn').style.display = 'none';
}

// ========================
// 3. STATISTIKA / KOROPLETË
// ========================
function buildStatOverview() {
  const el = document.getElementById('stat-overview');
  if (!el) return;
  const rows = [
    { type:'incidents', label:'Incidente aktive',  count:INCIDENTS.features.length,       color:'#d97706', icon:'ti-alert-triangle' },
    { type:'police',    label:'Stacione policore', count:STATIONS_POLICE.features.length,  color:'#2563eb', icon:'ti-shield' },
    { type:'fire',      label:'Stacione zjarrfikës', count:STATIONS_FIRE.features.length,  color:'#dc2626', icon:'ti-flame' },
    { type:'ambulance', label:'Ambulanca / QKMF',  count:STATIONS_AMB.features.length,     color:'#059669', icon:'ti-ambulance' },
    { type:'hospitals', label:'Spitale',           count:HOSPITALS.features.length,         color:'#7c3aed', icon:'ti-building-hospital' },
  ];
  el.innerHTML = rows.map(r =>
    `<div class="stat-ov-row" onclick="document.getElementById('stat-type').value='${r.type}'">
      <div class="stat-ov-icon" style="background:${r.color}22;color:${r.color}"><i class="ti ${r.icon}"></i></div>
      <span class="stat-ov-lbl">${r.label}</span>
      <span class="stat-ov-cnt" style="color:${r.color}">${r.count}</span>
    </div>`
  ).join('');
}

const CHORO_COLORS = [
  { min:0,  max:0,    fill:'rgba(100,116,139,0.07)', label:'0 (asnjë)' },
  { min:1,  max:1,    fill:'rgba(254,215,170,0.90)', label:'1' },
  { min:2,  max:2,    fill:'rgba(251,146,60,0.88)',  label:'2' },
  { min:3,  max:5,    fill:'rgba(234,88,12,0.85)',   label:'3 – 5' },
  { min:6,  max:9999, fill:'rgba(154,52,18,0.88)',   label:'≥ 6' },
];

function getChoroplethFill(count) {
  for (const c of [...CHORO_COLORS].reverse()) {
    if (count >= c.min) return c.fill;
  }
  return CHORO_COLORS[0].fill;
}

function pointInGeoJSONPolygon(lat, lng, geometry) {
  const test = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
        inside = !inside;
    }
    return inside;
  };
  if (geometry.type === 'Polygon') return test(geometry.coordinates[0]);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(p => test(p[0]));
  return false;
}

function generateStats() {
  clearStats();
  if (!_muniData) { setStatus('Të dhënat e komunave nuk janë ngarkuar.'); return; }

  const type   = document.getElementById('stat-type').value;
  const srcMap = {
    incidents: INCIDENTS.features,
    police:    STATIONS_POLICE.features,
    fire:      STATIONS_FIRE.features,
    ambulance: STATIONS_AMB.features,
    hospitals: HOSPITALS.features,
  };
  const typeLabels = {
    incidents:'Incidentet', police:'Stacione Policie', fire:'Stacione Zjarrfikës',
    ambulance:'Ambulanca', hospitals:'Spitale',
  };
  const points = (srcMap[type] || []).map(f => ({
    lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
  }));

  // Count per municipality (point-in-polygon)
  const counts = {};
  const names  = {};
  _muniData.features.forEach(muni => {
    const id = muni.properties.shapeName || muni.properties.name || muni.properties.Emri || '?';
    counts[id] = 0; names[id] = id;
  });
  points.forEach(pt => {
    _muniData.features.forEach(muni => {
      const id = muni.properties.shapeName || muni.properties.name || muni.properties.Emri || '?';
      if (pointInGeoJSONPolygon(pt.lat, pt.lng, muni.geometry)) counts[id]++;
    });
  });

  // Choropleth layer
  _choroplethLyr = L.geoJSON(_muniData, {
    style: f => {
      const id = f.properties.shapeName || f.properties.name || f.properties.Emri || '?';
      return {
        fillColor: getChoroplethFill(counts[id] || 0),
        fillOpacity: 1, color: '#fff', weight: 1, opacity: 0.6,
      };
    },
    onEachFeature: (f, layer) => {
      const id = f.properties.shapeName || f.properties.name || f.properties.Emri || '?';
      const n  = counts[id] || 0;
      layer.bindTooltip(`<strong>${id}</strong><br>${typeLabels[type]}: ${n}`,
        { sticky: true, className:'label-muni' });
    },
  }).addTo(map);
  layerGroups.municipalities?.bringToFront && layerGroups.municipalities.bringToFront();

  // Legenda
  const legEl = document.getElementById('stat-legend');
  legEl.innerHTML = `<div class="stat-leg-title">${typeLabels[type]} / komunë</div>` +
    CHORO_COLORS.map(c =>
      `<div class="stat-leg-row">
        <div class="stat-leg-swatch" style="background:${c.fill};border:1px solid rgba(255,255,255,.2)"></div>
        <span>${c.label}</span>
      </div>`
    ).join('');
  legEl.style.display = 'flex';

  // Tabela — të gjitha komunat
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1]);
  const maxCount = sorted[0]?.[1] || 1;

  const rows = sorted.map(([name, cnt], i) =>
    `<tr>
      <td class="stat-rank">${i+1}</td>
      <td>${name}</td>
      <td class="stat-count">${cnt}</td>
      <td class="stat-bar-wrap">
        <div class="stat-bar" style="width:${Math.round(cnt/maxCount*100)}%;background:${getChoroplethFill(cnt).replace(/[\d.]+\)$/,'0.9)')}"></div>
      </td>
    </tr>`
  ).join('');

  document.getElementById('stat-table').innerHTML =
    `<thead><tr><th>#</th><th>Komuna</th><th>${typeLabels[type]}</th><th></th></tr></thead>
     <tbody>${rows}</tbody>`;
  document.getElementById('stat-table-wrap').style.display = 'block';
  document.getElementById('stat-clear-btn').style.display = 'flex';
  setStatus(`Statistikat: ${points.length} ${typeLabels[type].toLowerCase()} — ${_muniData.features.length} komuna`);
}

function clearStats() {
  if (_choroplethLyr) { map.removeLayer(_choroplethLyr); _choroplethLyr = null; }
  document.getElementById('stat-legend').style.display = 'none';
  document.getElementById('stat-table-wrap').style.display = 'none';
  document.getElementById('stat-clear-btn').style.display = 'none';
}

// ----- MEASURE FUNCTIONS -----

function setMeasureMode(mode) {
  measureMode = mode;
  cancelMeasure();
  document.getElementById('mp-mode-dist').classList.toggle('active', mode === 'distance');
  document.getElementById('mp-mode-area').classList.toggle('active', mode === 'area');
  document.getElementById('mp-hint-dist').classList.toggle('active', mode === 'distance');
  document.getElementById('mp-hint-area').classList.toggle('active', mode === 'area');
}

function cancelMeasure() {
  if (_mTempLayer)    { map.removeLayer(_mTempLayer);    _mTempLayer = null; }
  if (_mPreviewLayer) { map.removeLayer(_mPreviewLayer); _mPreviewLayer = null; }
  _mDots.forEach(d => map.removeLayer(d));
  _mDots = [];
  measurePoints = [];
  const live = document.getElementById('mp-live');
  const actions = document.getElementById('mp-actions');
  if (live)    live.style.display = 'none';
  if (actions) actions.style.display = 'none';
}

function clearMeasure() {
  cancelMeasure();
  measureLayers.forEach(item => map.removeLayer(item.layer));
  measureLayers = [];
  const savedList = document.getElementById('mp-saved-list');
  const clearBtn  = document.getElementById('mp-clear-btn');
  if (savedList) { savedList.style.display = 'none'; savedList.innerHTML = ''; }
  if (clearBtn)  clearBtn.style.display = 'none';
}

function rebuildMeasureTempLayer() {
  if (_mTempLayer) { map.removeLayer(_mTempLayer); _mTempLayer = null; }
  if (measurePoints.length < 2) return;
  if (measureMode === 'distance') {
    _mTempLayer = L.polyline(measurePoints, {
      color: '#3b82f6', weight: 2.5, dashArray: '8 4', interactive: false
    }).addTo(map);
  } else {
    _mTempLayer = L.polygon(measurePoints, {
      color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.09,
      weight: 2.5, dashArray: '8 4', interactive: false
    }).addTo(map);
  }
}

function addMeasurePoint(lat, lng) {
  measurePoints.push([lat, lng]);

  const dot = L.circleMarker([lat, lng], {
    radius: 4, color: '#3b82f6', fillColor: '#fff',
    fillOpacity: 1, weight: 2, interactive: false
  }).addTo(map);
  _mDots.push(dot);

  rebuildMeasureTempLayer();
  updateMeasureLiveDisplay();

  const minForFinish = measureMode === 'distance' ? 2 : 3;
  if (measurePoints.length >= minForFinish) {
    document.getElementById('mp-actions').style.display = 'flex';
  }
}

function updateMeasureLiveDisplay() {
  const live = document.getElementById('mp-live');
  if (!live) return;

  if (measureMode === 'distance') {
    if (measurePoints.length < 2) {
      live.innerHTML = `<div class="mp-live-sub">1 pikë — kliko pikën tjetër</div>`;
      live.style.display = 'block';
      return;
    }
    let total = 0;
    const segs = [];
    for (let i = 1; i < measurePoints.length; i++) {
      const d = map.distance(measurePoints[i-1], measurePoints[i]);
      total += d;
      segs.push(d);
    }
    const segHtml = segs.length > 1
      ? `<div class="mp-live-segs">${segs.map((d, i) =>
          `<div class="mp-seg">
            <span class="mp-seg-lbl">Segmenti ${i+1}</span>
            <span class="mp-seg-val">${formatDistance(d)}</span>
          </div>`).join('')}
         </div>`
      : '';
    live.innerHTML = `
      <div class="mp-live-main">${formatDistance(total)}</div>
      <div class="mp-live-sub">${segs.length} segment · ${measurePoints.length} pika</div>
      ${segHtml}
    `;
  } else {
    if (measurePoints.length < 3) {
      live.innerHTML = `<div class="mp-live-sub">${measurePoints.length} pika — nevojiten të paktën 3</div>`;
      live.style.display = 'block';
      return;
    }
    const area = calcArea(measurePoints);
    const perim = calcPerimeter(measurePoints);
    live.innerHTML = `
      <div class="mp-live-main">${formatArea(area)}</div>
      <div class="mp-live-sub">Perimetri: ${formatDistance(perim)} · ${measurePoints.length} pika</div>
    `;
  }
  live.style.display = 'block';
}

function updateMeasurePreview(lat, lng) {
  if (_mPreviewLayer) { map.removeLayer(_mPreviewLayer); _mPreviewLayer = null; }
  if (measurePoints.length === 0) return;

  const pts = [...measurePoints, [lat, lng]];
  const style = { color: '#3b82f6', weight: 1.5, dashArray: '5 3', interactive: false, opacity: 0.55 };

  if (measureMode === 'area' && measurePoints.length >= 2) {
    _mPreviewLayer = L.polygon(pts, { ...style, fillColor: '#3b82f6', fillOpacity: 0.04 }).addTo(map);
  } else {
    _mPreviewLayer = L.polyline(pts, style).addTo(map);
  }
}

function finishMeasure() {
  const minPoints = measureMode === 'distance' ? 2 : 3;
  if (measurePoints.length < minPoints) return;

  let layer, label;

  if (measureMode === 'distance') {
    let total = 0;
    for (let i = 1; i < measurePoints.length; i++) total += map.distance(measurePoints[i-1], measurePoints[i]);
    label = formatDistance(total);
    const segs = [];
    for (let i = 1; i < measurePoints.length; i++) segs.push(map.distance(measurePoints[i-1], measurePoints[i]));
    const segRows = segs.map((d, i) =>
      `<div style="display:flex;justify-content:space-between;font-size:10px;padding:3px 0;border-top:1px solid rgba(255,255,255,.07)">
        <span style="color:var(--text3)">Segmenti ${i+1}</span>
        <span style="font-family:var(--mono);color:var(--text2)">${formatDistance(d)}</span>
       </div>`
    ).join('');
    layer = L.polyline([...measurePoints], {
      color: '#f59e0b', weight: 2.5, dashArray: '8 4'
    }).bindPopup(
      `<div style="min-width:150px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <i class="ti ti-ruler-measure" style="font-size:14px;color:#f59e0b"></i>
          <span style="font-size:11px;color:var(--text3)">Gjatësia totale</span>
        </div>
        <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--warn);margin-bottom:6px">${label}</div>
        ${segs.length > 1 ? segRows : ''}
        <div style="font-size:10px;color:var(--text3);margin-top:4px">${measurePoints.length} pika · ${segs.length} segment</div>
       </div>`, { maxWidth: 220 }
    ).addTo(map).openPopup();
  } else {
    const area = calcArea(measurePoints);
    const perim = calcPerimeter(measurePoints);
    label = formatArea(area);
    layer = L.polygon([...measurePoints], {
      color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.12, weight: 2.5, dashArray: '8 4'
    }).bindPopup(
      `<div style="min-width:150px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <i class="ti ti-vector-triangle" style="font-size:14px;color:#f59e0b"></i>
          <span style="font-size:11px;color:var(--text3)">Sipërfaqja</span>
        </div>
        <div style="font-size:18px;font-weight:700;font-family:var(--mono);color:var(--warn);margin-bottom:4px">${label}</div>
        <div style="font-size:11px;color:var(--text3)">Perimetri: <span style="font-family:var(--mono);color:var(--text2)">${formatDistance(perim)}</span></div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">${measurePoints.length} pika</div>
       </div>`, { maxWidth: 220 }
    ).addTo(map).openPopup();
  }

  measureLayers.push({ layer, type: measureMode, label });
  cancelMeasure();
  updateMeasureSavedList();
  document.getElementById('mp-clear-btn').style.display = 'flex';
  setStatus(`Matja u përfundua: ${label}`);
}

function updateMeasureSavedList() {
  const list = document.getElementById('mp-saved-list');
  if (!list) return;
  if (measureLayers.length === 0) { list.style.display = 'none'; return; }
  list.style.display = 'flex';
  list.innerHTML = measureLayers.map((item, i) =>
    `<div class="mp-saved-item">
      <i class="mp-saved-ico ti ${item.type === 'distance' ? 'ti-ruler-measure' : 'ti-vector-triangle'}"></i>
      <div class="mp-saved-info">
        <div class="mp-saved-val">${item.label}</div>
        <div class="mp-saved-type">${item.type === 'distance' ? 'Gjatësi' : 'Sipërfaqe'} #${i+1}</div>
      </div>
      <button class="mp-saved-del" onclick="removeMeasureLayer(${i})" title="Largo këtë matje">
        <i class="ti ti-x"></i>
      </button>
    </div>`
  ).join('');
}

function removeMeasureLayer(idx) {
  if (!measureLayers[idx]) return;
  map.removeLayer(measureLayers[idx].layer);
  measureLayers.splice(idx, 1);
  updateMeasureSavedList();
  if (measureLayers.length === 0) document.getElementById('mp-clear-btn').style.display = 'none';
}

function calcArea(pts) {
  if (pts.length < 3) return 0;
  const toRad = d => d * Math.PI / 180;
  const R = 6371000;
  const latAvg = toRad(pts.reduce((s, p) => s + p[0], 0) / pts.length);
  const proj = pts.map(p => ({
    x: R * toRad(p[1]) * Math.cos(latAvg),
    y: R * toRad(p[0])
  }));
  let sum = 0;
  for (let i = 0; i < proj.length; i++) {
    const j = (i + 1) % proj.length;
    sum += proj[i].x * proj[j].y - proj[j].x * proj[i].y;
  }
  return Math.abs(sum / 2);
}

function calcPerimeter(pts) {
  let total = 0;
  for (let i = 0; i < pts.length; i++) total += map.distance(pts[i], pts[(i + 1) % pts.length]);
  return total;
}

function formatDistance(meters) {
  if (meters >= 1000) return (meters / 1000).toFixed(2) + ' km';
  return Math.round(meters) + ' m';
}

function formatArea(sqm) {
  if (sqm >= 1e6) return (sqm / 1e6).toFixed(3) + ' km²';
  if (sqm >= 1e4) return (sqm / 1e4).toFixed(2) + ' ha';
  return Math.round(sqm) + ' m²';
}

// Enter = finish measure, Escape = cancel measure
document.addEventListener('keydown', function(e) {
  if (currentTool !== 'measure') return;
  if (e.key === 'Enter')  { e.preventDefault(); finishMeasure(); }
  if (e.key === 'Escape') { e.preventDefault(); cancelMeasure(); }
});

// ===== ROUTING =====

let routePointA      = null;
let routePointB      = null;
let routeDrawn       = [];
let routeMarkerA     = null;
let routeMarkerB     = null;
let trafficEnabled   = true;
let _roadsBeforeRoute = null;
let _myLocLayer      = null;   // markeri i lokacionit aktual

const TRAFFIC_ZONES = [
  { name:'Qendra e Prishtinës', lat:42.6629, lng:21.1655, r:2400, w:'high' },
  { name:'Fushë Kosovë',        lat:42.6420, lng:21.0980, r:1600, w:'high' },
  { name:'Mitrovicë',           lat:42.8914, lng:20.8660, r:1500, w:'med'  },
  { name:'Prizren',             lat:42.2139, lng:20.7397, r:1400, w:'med'  },
  { name:'Pejë',                lat:42.6593, lng:20.2883, r:1300, w:'med'  },
  { name:'Gjilan',              lat:42.4643, lng:21.4694, r:1200, w:'med'  },
  { name:'Ferizaj',             lat:42.3703, lng:21.1489, r:1100, w:'med'  },
  { name:'Gjakovë',             lat:42.3803, lng:20.4289, r:1000, w:'low'  },
  { name:'Vushtrri',            lat:42.8236, lng:20.9689, r: 900, w:'low'  },
];
let trafficLayerGroup = null;

function getTrafficInfo() {
  const h = new Date().getHours();
  if (h >= 7  && h <= 9)  return { label:'E lartë — ora e pikut mëngjes',  cls:'high', f:1.90, icon:'danger' };
  if (h >= 16 && h <= 18) return { label:'Kritike — ora e pikut mbrëmje',  cls:'crit', f:2.20, icon:'danger' };
  if (h >= 11 && h <= 13) return { label:'Mesatare — orë dreke',           cls:'med',  f:1.40, icon:'warn'   };
  if (h >= 22 || h <= 5)  return { label:'E ulët — natë',                  cls:'low',  f:0.85, icon:null      };
  return                          { label:'Normale — orë pune',             cls:'normal',f:1.20, icon:null     };
}

function formatDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), rem = m % 60;
  return h + 'h ' + (rem > 0 ? rem + 'min' : '');
}

function initRoutePanel() {
  const ti = getTrafficInfo();
  const statusEl = document.getElementById('rp-traffic-status');
  const iconEl   = document.getElementById('rp-tc-icon');
  if (statusEl) { statusEl.textContent = ti.label; statusEl.className = 'rp-traffic-status ' + ti.cls; }
  if (iconEl)   {
    iconEl.className = 'ti ti-traffic-cone rp-tc-icon' + (ti.icon ? ' ' + ti.icon : '');
  }
  showTrafficZones(true);
}

function showTrafficZones(show) {
  if (!trafficLayerGroup) {
    trafficLayerGroup = L.layerGroup();
    const ti = getTrafficInfo();
    const COLS  = { high:'#dc2626', med:'#f59e0b', low:'#059669' };
    const OPACS = { high:0.18,      med:0.13,       low:0.07    };
    TRAFFIC_ZONES.forEach(z => {
      const effectiveW = ti.f >= 1.7 ? (z.w === 'high' ? 'high' : 'med')
                       : ti.f <= 0.9 ? 'low' : z.w;
      L.circle([z.lat, z.lng], {
        radius: z.r * (ti.f > 1 ? Math.min(ti.f, 1.5) : 1),
        color: COLS[effectiveW], fillColor: COLS[effectiveW],
        fillOpacity: OPACS[effectiveW], weight: 0, interactive: false
      }).bindTooltip(`🚦 ${z.name}`, { sticky: true, className:'label-muni' })
        .addTo(trafficLayerGroup);
    });
  }
  if (show) trafficLayerGroup.addTo(map);
  else if (map.hasLayer(trafficLayerGroup)) map.removeLayer(trafficLayerGroup);
}

function onTrafficToggle() {
  trafficEnabled = document.getElementById('rp-traffic-on').checked;
  if (routeDrawn.length > 0 && routePointA && routePointB) renderRouteResult();
}

function handleRouteClick(lat, lng, label) {
  if (!routePointA) {
    setRoutePoint('a', lat, lng, label);
  } else if (!routePointB) {
    setRoutePoint('b', lat, lng, label);
    calculateRoute();
  }
}

function setRoutePoint(which, lat, lng, label) {
  if (which === 'a') {
    routePointA = { lat, lng, label };
    const el = document.getElementById('rp-lbl-a');
    el.textContent = label;
    el.classList.add('set');
    document.getElementById('rp-del-a').style.display = 'flex';
    document.getElementById('rp-wp-a').classList.remove('picking');
    document.getElementById('rp-wp-b').classList.add('picking');
    document.getElementById('rp-hint-text').innerHTML = 'Kliko mbi hartë ose zgjidh destinacionin për pikën <strong>B</strong>';
    buildQuickTargets();
    if (routeMarkerA) map.removeLayer(routeMarkerA);
    routeMarkerA = L.circleMarker([lat, lng], {
      radius: 8, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 1, weight: 3
    }).bindTooltip('A — Pika nisuese', { permanent: false }).addTo(map);
  } else {
    routePointB = { lat, lng, label };
    const el = document.getElementById('rp-lbl-b');
    el.textContent = label;
    el.classList.add('set');
    document.getElementById('rp-del-b').style.display = 'flex';
    document.getElementById('rp-wp-b').classList.remove('picking');
    document.getElementById('rp-hint').style.display = 'none';
    if (routeMarkerB) map.removeLayer(routeMarkerB);
    routeMarkerB = L.circleMarker([lat, lng], {
      radius: 8, color: '#059669', fillColor: '#059669', fillOpacity: 1, weight: 3
    }).bindTooltip('B — Destinacioni', { permanent: false }).addTo(map);
  }
}

function clearRoutePoint(which) {
  if (which === 'a') {
    routePointA = null;
    const el = document.getElementById('rp-lbl-a');
    el.textContent = 'Kliko hartën — pika nisuese';
    el.classList.remove('set');
    document.getElementById('rp-del-a').style.display = 'none';
    document.getElementById('rp-wp-a').classList.add('picking');
    document.getElementById('rp-hint-text').innerHTML = 'Kliko mbi hartë ose mbi marker për pikën <strong>A</strong>';
    document.getElementById('rp-hint').style.display = 'flex';
    document.getElementById('rp-quick').style.display = 'none';
    if (routeMarkerA) { map.removeLayer(routeMarkerA); routeMarkerA = null; }
    // Pastro markerin e lokacionit dhe reseto butonin
    if (_myLocLayer) { map.removeLayer(_myLocLayer); _myLocLayer = null; }
    const btn = document.getElementById('rp-myloc-btn');
    if (btn) {
      btn.innerHTML = '<i class="ti ti-current-location"></i><span>Lokacioni im</span>';
      btn.classList.remove('active');
    }
  } else {
    routePointB = null;
    const el = document.getElementById('rp-lbl-b');
    el.textContent = 'Kliko hartën — destinacioni';
    el.classList.remove('set');
    document.getElementById('rp-del-b').style.display = 'none';
    document.getElementById('rp-wp-b').classList.add('picking');
    document.getElementById('rp-hint-text').innerHTML = 'Kliko mbi hartë ose zgjidh destinacionin për pikën <strong>B</strong>';
    document.getElementById('rp-hint').style.display = 'flex';
    if (routeMarkerB) { map.removeLayer(routeMarkerB); routeMarkerB = null; }
  }
  routeDrawn.forEach(l => map.removeLayer(l));
  routeDrawn = [];
  document.getElementById('rp-result').style.display = 'none';
  document.getElementById('rp-clear-btn').style.display = 'none';
}

// ----- MY LOCATION -----
function useMyLocation() {
  if (!navigator.geolocation) {
    setStatus('Shfletuesi nuk mbështet GPS — provo Chrome ose Firefox.');
    return;
  }

  const btn = document.getElementById('rp-myloc-btn');
  if (btn) {
    btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i><span>Duke gjetur...</span>';
    btn.disabled = true;
  }

  navigator.geolocation.getCurrentPosition(
    function(pos) {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = Math.round(pos.coords.accuracy);

      // Reset butonin
      if (btn) {
        btn.innerHTML = '<i class="ti ti-current-location-filled"></i><span>Lokacioni im ✓</span>';
        btn.disabled = false;
        btn.classList.add('active');
      }

      // Largo markerin e vjetër të lokacionit
      if (_myLocLayer) { map.removeLayer(_myLocLayer); _myLocLayer = null; }

      // Krijo marker pulsant (pikë blu + rreth saktësie)
      const dot = L.divIcon({
        className: '',
        html: '<div class="my-loc-dot"></div>',
        iconSize: [16, 16], iconAnchor: [8, 8],
      });
      _myLocLayer = L.layerGroup([
        L.circle([lat, lng], {
          radius: acc, color: '#3b82f6', fillColor: '#3b82f6',
          fillOpacity: 0.08, weight: 1, interactive: false,
        }),
        L.marker([lat, lng], { icon: dot, interactive: false }),
      ]).addTo(map);

      // Vendose si pikë A dhe fluturim
      setRoutePoint('a', lat, lng, 'Lokacioni im');
      map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 1.2 });
      setStatus(`Lokacioni u gjet — saktësia: ±${acc} m`);

      // Nëse B ekziston, llogarit rrugën menjëherë
      if (routePointB) calculateRoute();
    },
    function(err) {
      if (btn) {
        btn.innerHTML = '<i class="ti ti-current-location"></i><span>Lokacioni im</span>';
        btn.disabled = false;
        btn.classList.remove('active');
      }
      const msg = {
        1: 'Qasja u refuzua — lejo lokacionin në cilësimet e shfletuesit.',
        2: 'Lokacioni nuk u gjet — provo përsëri.',
        3: 'Kërkesa skadoi — provo përsëri.',
      };
      setStatus(msg[err.code] || 'Gabim gjatë marrjes së lokacionit.');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

function clearRoute() {
  routeDrawn.forEach(l => map.removeLayer(l));
  routeDrawn = [];
  if (routeMarkerA) { map.removeLayer(routeMarkerA); routeMarkerA = null; }
  if (routeMarkerB) { map.removeLayer(routeMarkerB); routeMarkerB = null; }
  routePointA = routePointB = null;
  showTrafficZones(false);
  trafficLayerGroup = null;
  ['rp-lbl-a','rp-lbl-b'].forEach((id,i) => {
    const el = document.getElementById(id);
    el.textContent = i === 0 ? 'Kliko hartën — pika nisuese' : 'Kliko hartën — destinacioni';
    el.classList.remove('set');
  });
  ['rp-del-a','rp-del-b'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('rp-wp-a').classList.remove('picking');
  document.getElementById('rp-wp-b').classList.remove('picking');
  document.getElementById('rp-hint-text').innerHTML = 'Kliko mbi hartë ose mbi marker për pikën <strong>A</strong>';
  document.getElementById('rp-hint').style.display = 'flex';
  document.getElementById('rp-quick').style.display = 'none';
  document.getElementById('rp-result').style.display = 'none';
  document.getElementById('rp-clear-btn').style.display = 'none';
  // Pastro markerin dhe butonin e lokacionit
  if (_myLocLayer) { map.removeLayer(_myLocLayer); _myLocLayer = null; }
  const btn = document.getElementById('rp-myloc-btn');
  if (btn) {
    btn.innerHTML = '<i class="ti ti-current-location"></i><span>Lokacioni im</span>';
    btn.disabled = false;
    btn.classList.remove('active');
  }
}

function buildQuickTargets() {
  if (!routePointA) return;
  const { lat, lng } = routePointA;
  const candidates = [
    ...STATIONS_POLICE.features.map(f => ({ f, color:'#2563eb', icon:'ti-shield', lbl:'Policia' })),
    ...STATIONS_FIRE.features.map(f   => ({ f, color:'#dc2626', icon:'ti-flame',  lbl:'Zjarrfikës' })),
    ...STATIONS_AMB.features.map(f    => ({ f, color:'#059669', icon:'ti-ambulance', lbl:'Ambulancë' })),
    ...HOSPITALS.features.map(f       => ({ f, color:'#7c3aed', icon:'ti-building-hospital', lbl:'Spital' })),
  ].map(item => ({
    ...item,
    d: map.distance([lat, lng], [item.f.geometry.coordinates[1], item.f.geometry.coordinates[0]])
  })).sort((a, b) => a.d - b.d).slice(0, 5);

  const listEl = document.getElementById('rp-quick-list');
  listEl.innerHTML = candidates.map(c => {
    const p = c.f.properties;
    const co = c.f.geometry.coordinates;
    return `<div class="rp-quick-item" onclick="routeToTarget(${co[1]}, ${co[0]}, '${p.emri.replace(/'/g,"\\'")}')">
      <div class="rp-qi-icon" style="background:${c.color}"><i class="ti ${c.icon}"></i></div>
      <div class="rp-qi-info">
        <div class="rp-qi-name">${p.emri}</div>
        <div class="rp-qi-dist">${c.lbl} · ${formatDistance(c.d)}</div>
      </div>
      <i class="ti ti-chevron-right rp-qi-arr"></i>
    </div>`;
  }).join('');
  document.getElementById('rp-quick').style.display = 'flex';
}

function routeToTarget(lat, lng, label) {
  if (!routePointA) return;
  if (routePointB) clearRoutePoint('b');
  setRoutePoint('b', lat, lng, label);
  calculateRoute();
}

async function calculateRoute() {
  if (!routePointA || !routePointB) return;
  showRouteLoading();
  await calcRouteOSRM();
}

function showRouteLoading() {
  const r = document.getElementById('rp-result');
  r.innerHTML = `<div style="text-align:center;padding:14px;color:var(--text3);font-size:11px">
    <i class="ti ti-loader-2" style="font-size:20px;display:block;margin-bottom:6px;animation:spin 1s linear infinite"></i>
    Duke llogaritur rrugën...
  </div>`;
  r.style.display = 'block';
}

function drawRoutePolyline(latlngs) {
  routeDrawn.forEach(l => map.removeLayer(l));
  routeDrawn = [];
  const layer = L.polyline(latlngs, {
    color:'#3b82f6', weight:5, opacity:0.88, lineCap:'round', lineJoin:'round'
  }).addTo(map);
  routeDrawn.push(layer);
  map.fitBounds(layer.getBounds(), { padding:[40,40] });
  document.getElementById('rp-clear-btn').style.display = 'flex';
}

function showRouteError(msg) {
  document.getElementById('rp-result').innerHTML =
    `<div style="padding:12px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);
      border-radius:7px;font-size:11px;color:#fca5a5">
      <i class="ti ti-alert-triangle"></i> ${msg}
    </div>`;
}

// ----- OSRM routing -----
async function calcRouteOSRM() {
  const { lat:lat1, lng:lng1 } = routePointA;
  const { lat:lat2, lng:lng2 } = routePointB;
  try {
    const res  = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}` +
      `?overview=full&geometries=geojson&steps=true`
    );
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('Rruga nuk u gjet');
    const r = data.routes[0];
    drawRoutePolyline(r.geometry.coordinates.map(c => [c[1], c[0]]));
    _routeData = { source:'osrm', dist:r.distance, dur:r.duration, steps: r.legs?.[0]?.steps || [] };
    renderRouteResult();
  } catch(e) { showRouteError(e.message || 'Gabim — kontrolloni internetin'); }
}

let _routeData    = null;
let _stepsVisible = false;

function renderRouteResult() {
  if (!_routeData) return;
  const { dist, dur, steps } = _routeData;
  const ti         = getTrafficInfo();
  const useTraffic = trafficEnabled;
  const finalDur   = useTraffic ? dur * ti.f : dur;
  const finalDelay = useTraffic ? dur * (ti.f - 1) : 0;
  const timeColor  = useTraffic && ti.f > 1.5 ? 'var(--danger)' : 'var(--success)';

  const trafficHtml = useTraffic ? `
    <div class="rp-traffic-delay ${ti.cls}">
      <i class="ti ti-traffic-cone"></i>
      <span>${ti.label} — vonesë e vlerësuar: +${formatDuration(finalDelay)}</span>
    </div>` : '';

  const MAN = {
    'depart':'↑ Nis','arrive':'🏁 Mbërrij','turn':'Kthehu','new name':'Vazhdo në',
    'continue':'Vazhdo','merge':'Bashkohu','on ramp':'Hyrje autostradë',
    'off ramp':'Dalje autostradë','fork':'Bifurkacion',
    'end of road':'Fundi i rrugës','rotary':'Rrethrugore','roundabout':'Rrethrugore',
  };
  const MOD = {
    'left':'◀ majtas','right':'▶ djathtas','sharp left':'◀◀ fort majtas',
    'sharp right':'▶▶ fort djathtas','slight left':'↖ pak majtas',
    'slight right':'↗ pak djathtas','straight':'↑ drejt','uturn':'↩ kthehu',
  };
  const ICO = {
    'depart':'ti-map-pin','arrive':'ti-flag','turn':'ti-corner-down-right',
    'rotary':'ti-circle','roundabout':'ti-circle','merge':'ti-git-merge',
    'on ramp':'ti-arrow-up-right','off ramp':'ti-arrow-down-right',
  };
  const filtered = steps.filter(s => s.distance > 5);
  const stepsHtml = filtered.map(s => {
    const tp  = s.maneuver?.type || 'continue';
    const mod = s.maneuver?.modifier || '';
    const ico = ICO[tp] || 'ti-arrow-up';
    const txt = (MAN[tp] || 'Vazhdo') + (MOD[mod] ? ' ' + MOD[mod] : '') +
                (s.name ? ` — <em>${s.name}</em>` : '');
    return `<div class="rp-step">
      <div class="rp-step-icon"><i class="ti ${ico}"></i></div>
      <span class="rp-step-text">${txt}</span>
      <span class="rp-step-dist">${formatDistance(s.distance)}</span>
    </div>`;
  }).join('');

  document.getElementById('rp-result').innerHTML = `
    <div class="rp-stats">
      <div class="rp-stat-card">
        <div class="rp-stat-val">${formatDistance(dist)}</div>
        <div class="rp-stat-lbl">Distanca</div>
      </div>
      <div class="rp-stat-card">
        <div class="rp-stat-val" style="color:${timeColor}">${formatDuration(finalDur)}</div>
        <div class="rp-stat-lbl">Koha${useTraffic ? ' (me trafik)' : ''}</div>
      </div>
    </div>
    ${trafficHtml}
    ${stepsHtml ? `
    <button class="rp-steps-toggle" onclick="toggleRouteSteps(this)">
      <span><i class="ti ti-list-details"></i> Udhëzimet hap-pas-hapi (${filtered.length})</span>
      <i class="ti ti-chevron-down" id="rp-steps-chevron"></i>
    </button>
    <div class="rp-steps-list" id="rp-steps-list" style="display:none">${stepsHtml}</div>` : ''}
  `;
  document.getElementById('rp-result').style.display = 'flex';
  setStatus(`Rrugëzimi: ${formatDistance(dist)} — ${formatDuration(finalDur)}`);
}

function toggleRouteSteps(btn) {
  const list = document.getElementById('rp-steps-list');
  const chev = document.getElementById('rp-steps-chevron');
  if (!list) return;
  _stepsVisible = !_stepsVisible;
  list.style.display = _stepsVisible ? 'flex' : 'none';
  list.style.flexDirection = 'column';
  if (chev) chev.style.transform = _stepsVisible ? 'rotate(180deg)' : '';
}

// ----- COORDINATE SYSTEM -----
function formatCoords(lat, lng) {
  if (currentCRS === 'WGS84') {
    return {
      display: `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`,
      bar: `Lat: ${lat.toFixed(6)} | Lon: ${lng.toFixed(6)}`,
      vgi: `Lat: ${lat.toFixed(5)}, Lon: ${lng.toFixed(5)}`
    };
  } else {
    const [E, N] = proj4('WGS84', 'KOSOVAREF01', [lng, lat]);
    return {
      display: `E:${E.toFixed(1)} N:${N.toFixed(1)}`,
      bar: `E: ${E.toFixed(3)} | N: ${N.toFixed(3)}`,
      vgi: `E: ${E.toFixed(3)}, N: ${N.toFixed(3)}`
    };
  }
}

function switchCRS(crs) {
  currentCRS = crs;
  const labels = { WGS84: 'EPSG:4326 — WGS84', KOSOVAREF01: 'EPSG:9141 — KOSOVAREF01' };
  document.getElementById('crs-display').textContent = labels[crs];
  document.querySelectorAll('.crs-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('crs-btn-' + crs.toLowerCase()).classList.add('active');
  const c = map.getCenter();
  const coords = formatCoords(c.lat, c.lng);
  document.getElementById('coord-display').textContent = coords.display;
  document.getElementById('coord-bar').textContent = coords.bar;
  // update mobile CRS toggle label
  const mobLbl = document.getElementById('mob-crs-lbl');
  if (mobLbl) mobLbl.textContent = crs === 'WGS84' ? 'WGS84' : 'KOSOVA';
}

// ----- STATUS -----
function setStatus(msg) {
  document.getElementById('status-msg').innerHTML = `<i class="ti ti-info-circle"></i> ${msg}`;
  setTimeout(() => {
    document.getElementById('status-msg').innerHTML = '<i class="ti ti-check"></i> Sistemi aktiv';
  }, 4000);
}

// ===== BOUNDARY LAYERS =====

const BOUNDARY_TOGGLE = { border: true, regions: true, municipalities: true };

const BOUNDARY_STYLE = {
  border: {
    color: '#d1d5db', weight: 2.5, opacity: 0.75,
    fillOpacity: 0, interactive: false,
  },
  regions: {
    color: '#5eead4', weight: 1.8, opacity: 0.65,
    fillOpacity: 0.05, fillColor: '#5eead4',
    dashArray: '12 6', interactive: false,
  },
  municipalities: {
    color: '#fbbf24', weight: 1.8, opacity: 0.60,
    fillOpacity: 0.04, fillColor: '#fbbf24',
    dashArray: '3 5', interactive: false,
  },
};

function transformCoordsKosova(coords) {
  if (typeof coords[0] === 'number') {
    const wgs = proj4('KOSOVAREF01', 'WGS84', [coords[0], coords[1]]);
    return wgs;
  }
  return coords.map(transformCoordsKosova);
}

function loadBoundaryLayers() {
  layerGroups.border = L.geoJSON(GEO_BORDER, { style: BOUNDARY_STYLE.border });

  layerGroups.regions = L.geoJSON(GEO_REGIONS, {
    style: BOUNDARY_STYLE.regions,
    onEachFeature: function(feature, layer) {
      const name = feature.properties.Emri || feature.properties.shapeName || '';
      if (name) {
        layer.bindTooltip(name, {
          permanent: true, direction: 'center',
          className: 'label-region', interactive: false,
        });
      }
    },
  });

  const muniData = JSON.parse(JSON.stringify(GEO_MUNICIPALITIES_RAW));
  muniData.features.forEach(f => {
    if (f.geometry) f.geometry.coordinates = transformCoordsKosova(f.geometry.coordinates);
  });
  _muniData = muniData;   // ruaj për analizën statistikore
  layerGroups.municipalities = L.geoJSON(muniData, {
    style: BOUNDARY_STYLE.municipalities,
    onEachFeature: function(feature, layer) {
      const name = feature.properties.name || feature.properties.shapeName || '';
      if (name) {
        layer.bindTooltip(name, {
          permanent: true, direction: 'center',
          className: 'label-muni', interactive: false,
        });
      }
    },
  });

  updateBoundaryVisibility(map.getZoom());
}

function updateBoundaryVisibility(z) {
  const show = (key, condition) => {
    if (!layerGroups[key]) return;
    const shouldShow = condition && BOUNDARY_TOGGLE[key];
    if (shouldShow && !map.hasLayer(layerGroups[key])) {
      layerGroups[key].addTo(map);
      layerGroups[key].bringToBack();
    } else if (!shouldShow && map.hasLayer(layerGroups[key])) {
      map.removeLayer(layerGroups[key]);
    }
  };
  show('border',         z >= 7);
  show('regions',        z >= 9);
  show('municipalities', z >= 11);
}

function toggleBoundary(key, visible) {
  BOUNDARY_TOGGLE[key] = visible;
  updateBoundaryVisibility(map.getZoom());
}

// ===== ZOOM STRIP =====

const ZOOM_LEVELS = [
  { zoom: 7,  label: 'Shteti',  el: null },
  { zoom: 9,  label: 'Rajoni',  el: null },
  { zoom: 11, label: 'Komuna',  el: null },
  { zoom: 13, label: 'Lokal',   el: null },
  { zoom: 15, label: 'Detaje',  el: null },
];

function initZoomStrip() {
  ZOOM_LEVELS.forEach(lv => {
    lv.el = document.querySelector(`.zs-level[data-zoom="${lv.zoom}"]`);
  });
  updateZoomStrip(map.getZoom());
}

function updateZoomStrip(z) {
  let activeIdx = 0;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    if (z >= ZOOM_LEVELS[i].zoom) activeIdx = i;
  }
  ZOOM_LEVELS.forEach((lv, i) => {
    if (lv.el) lv.el.classList.toggle('active', i === activeIdx);
  });
}

function snapToZoom(z) {
  map.setZoom(z, { animate: true });
}

// ===== AUTH =====
const USERS = {
  'qytetar':  { password: '1234',  role: 'citizen',  label: 'Qytetar' },
  'operator': { password: 'admin', role: 'operator', label: 'Operator' },
};
let currentUser = null;
let currentRole = null;

function doLogin() {
  const u = document.getElementById('login-user').value.trim();
  const p = document.getElementById('login-pass').value;
  const err = document.getElementById('login-error');
  if (!USERS[u] || USERS[u].password !== p) {
    err.textContent = 'Emri ose fjalëkalimi i gabuar!';
    return;
  }
  err.textContent = '';
  currentUser = u;
  currentRole = USERS[u].role;
  document.getElementById('login-overlay').style.display = 'none';
  applyRole(currentRole);
  setStatus(`Mirë se erdhe, ${USERS[u].label}!`);
}

function doLogout() {
  currentUser = null;
  currentRole = null;
  document.getElementById('login-overlay').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').textContent = '';
  document.body.classList.remove('is-operator');
  const badge = document.getElementById('user-badge');
  badge.innerHTML = '<i class="ti ti-user"></i> Qytetar';
  badge.className = 'user-badge';
  document.getElementById('logout-btn').style.display = 'none';
  document.getElementById('panel-tabs').style.display = 'none';
}

function applyRole(role) {
  const isOp = role === 'operator';
  const badge = document.getElementById('user-badge');
  badge.innerHTML = isOp
    ? '<i class="ti ti-shield-check"></i> Operator'
    : '<i class="ti ti-user"></i> Qytetar';
  badge.className = 'user-badge' + (isOp ? ' op-badge' : '');
  document.getElementById('logout-btn').style.display = 'flex';
  if (isOp) {
    document.getElementById('panel-tabs').style.display = 'flex';
    renderOperatorVGI();
    renderDBEditor();
  }
}

// ===== PANEL TABS =====
let currentTab = 'incidents';

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.getElementById('tab-' + tab).style.display = 'flex';
  document.getElementById('tab-' + tab).style.flexDirection = 'column';
}

// ===== OPERATOR VGI =====
function renderOperatorVGI() {
  const list = document.getElementById('op-vgi-list');
  if (!list) return;
  list.innerHTML = VGI_REPORTS.filter(r => r.statusi !== 'refuzuar' && r.statusi !== 'caktuar').map(r => {
    const sc = r.statusi === 'konfirmuar' ? 'low' : r.statusi === 'refuzuar' ? 'high' : 'med';
    const st = r.statusi === 'konfirmuar' ? 'Konfirmuar' : r.statusi === 'refuzuar' ? 'Refuzuar' : 'Pa verifikuar';
    const assignedHtml = r.njesia_caktuar
      ? `<div class="assigned-label"><i class="ti ti-send"></i> ${r.njesia_caktuar}</div>`
      : '';
    return `<div class="vgi-op-card" id="vgi-card-${r.id}">
      <div class="vgi-op-header">
        <span class="vgi-op-type">${r.lloji}</span>
        <span class="sev-pill ${sc}">${st}</span>
      </div>
      <div class="vgi-op-loc"><i class="ti ti-map-pin"></i> ${r.adresa}</div>
      <div class="vgi-op-meta">${r.koha} — ${r.emri}</div>
      <div class="vgi-op-desc">${r.pershkrimi}</div>
      <div class="vgi-op-actions">
        <button class="vgi-act-btn confirm" onclick="confirmVGI('${r.id}')"><i class="ti ti-check"></i> Konfirmo</button>
        <button class="vgi-act-btn reject"  onclick="rejectVGI('${r.id}')"><i class="ti ti-x"></i> Refuzo</button>
        <button class="vgi-act-btn assign"  onclick="toggleAssignPanel('${r.id}')"><i class="ti ti-users"></i> Cakto</button>
      </div>
      <div class="assign-panel" id="assign-${r.id}" style="display:none">
        <div class="assign-sev-row">
          <span class="assign-sev-lbl">Ashpërsia:</span>
          <label class="assign-sev-opt"><input type="radio" name="asev-${r.id}" value="high"><span class="sev-dot high"></span>E lartë</label>
          <label class="assign-sev-opt"><input type="radio" name="asev-${r.id}" value="med" checked><span class="sev-dot med"></span>Mesatare</label>
          <label class="assign-sev-opt"><input type="radio" name="asev-${r.id}" value="low"><span class="sev-dot low"></span>E ulët</label>
        </div>
        <div class="assign-units-scroll">${makeUnitCheckboxes(r.id, r.lat, r.lng)}</div>
        <button class="vgi-act-btn confirm assign-submit-btn" onclick="doAssign('${r.id}')">
          <i class="ti ti-send"></i> Konfirmo &amp; Shto si Incident
        </button>
      </div>
      ${assignedHtml}
    </div>`;
  }).join('');
}

function makeUnitCheckboxes(id, lat, lng) {
  const groups = [
    { key:'policia',    label:'Policia',    icon:'ti-shield',    color:'#2563eb', features:STATIONS_POLICE.features },
    { key:'zjarrfikes', label:'Zjarrfikës', icon:'ti-flame',     color:'#dc2626', features:STATIONS_FIRE.features   },
    { key:'ambulance',  label:'Ambulancë',  icon:'ti-ambulance', color:'#059669', features:STATIONS_AMB.features    },
  ];
  return groups.map(g => {
    const sorted = [...g.features]
      .map(f => ({ f, d: map.distance([lat, lng], [f.geometry.coordinates[1], f.geometry.coordinates[0]]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    const items = sorted.map(({ f, d }) => {
      const shortName = f.properties.emri
        .replace(/Stacioni Policor (Nr\. \d+ — )?/, '')
        .replace(/Drejtoria Rajonale — /, '')
        .replace(/Brigada Zjarrfikëse /, '')
        .replace(/QKMF /, '');
      const safeName = f.properties.emri.replace(/"/g, '&quot;');
      return `<label class="assign-chk-item" title="${safeName}">
        <input type="checkbox" class="assign-chk" name="unit-${id}" value="${f.properties.id}"
          data-name="${safeName}" data-svc="${g.key}">
        <span class="assign-chk-name">${shortName}</span>
        <span class="assign-chk-dist">${(d / 1000).toFixed(1)} km</span>
      </label>`;
    }).join('');
    return `<div class="assign-grp">
      <div class="assign-grp-hd" style="color:${g.color}"><i class="ti ${g.icon}"></i> ${g.label}</div>
      ${items}
    </div>`;
  }).join('');
}

function confirmVGI(id) {
  const r = VGI_REPORTS.find(r => r.id === id);
  if (r) { r.statusi = 'konfirmuar'; }
  fbUpdateVGI(id, { statusi: 'konfirmuar' });
  renderOperatorVGI();
  updateVGIMarkers();
  const pend = VGI_REPORTS.filter(r => r.statusi === 'pa_verifikuar').length;
  document.getElementById('vgi-pending').textContent = `${pend} raporte në pritje`;
  setStatus(`VGI ${id} u konfirmua`);
}

function rejectVGI(id) {
  const r = VGI_REPORTS.find(r => r.id === id);
  if (r) r.statusi = 'refuzuar';
  fbUpdateVGI(id, { statusi: 'refuzuar' });
  updateVGIMarkers();
  renderOperatorVGI();
  updateStats();
  map.closePopup();
  setStatus(`VGI ${id} u refuzua`);
}

function toggleAssignPanel(id) {
  const p = document.getElementById('assign-' + id);
  p.style.display = p.style.display === 'none' ? 'flex' : 'none';
}

function doAssign(id) {
  const r = VGI_REPORTS.find(v => v.id === id);
  if (!r) return;

  const checked = [...document.querySelectorAll(`input[name="unit-${id}"]:checked`)];
  if (!checked.length) { alert('Zgjidh të paktën një njësi!'); return; }

  const names     = checked.map(c => c.dataset.name);
  const svcs      = [...new Set(checked.map(c => c.dataset.svc))];
  const ashSel    = document.querySelector(`input[name="asev-${id}"]:checked`);
  const ashpersia = ashSel ? ashSel.value : 'med';

  r.njesia_caktuar = names.join(' + ');
  r.statusi = 'caktuar';
  fbUpdateVGI(id, { statusi: 'caktuar', njesia_caktuar: r.njesia_caktuar });

  const koha = new Date().toLocaleTimeString('sq', { hour:'2-digit', minute:'2-digit' });
  const newFeature = {
    type: 'Feature',
    properties: {
      id: 'INC-' + id,
      lloji: r.lloji,
      ashpersia,
      statusi: 'aktiv',
      sherbimi: svcs[0],
      sherbime: svcs,
      koha,
      adresa: r.adresa,
      pershkrimi: r.pershkrimi,
      njesia: r.njesia_caktuar,
    },
    geometry: { type:'Point', coordinates:[r.lng, r.lat] },
  };

  INCIDENTS.features.push(newFeature);

  const m = L.marker([r.lat, r.lng], { icon: createIncidentIcon(ashpersia) })
    .bindPopup(popupIncident(newFeature.properties, r.lat, r.lng), { maxWidth: 280 });
  m.incidentData = newFeature.properties;
  layerGroups.incidents.addLayer(m);
  allIncidentMarkers.push(m);

  renderIncidentList();
  updateStats();
  renderOperatorVGI();
  updateVGIMarkers();
  map.flyTo([r.lat, r.lng], 15, { duration: 1.2 });
  setStatus(`${r.lloji} — ${names.length} njësi caktua, shënuar si incident aktiv`);
}

function updateVGIMarkers() {
  layerGroups.vgi.clearLayers();
  vgiMarkers = [];
  VGI_REPORTS.filter(r => r.statusi !== 'refuzuar' && r.statusi !== 'caktuar').forEach(r => {
    const color = r.statusi === 'konfirmuar' ? '#059669' : '#db2777';
    const icon = L.divIcon({
      className: '',
      html: `<div class="marker-icon" style="background:${color}"><i class="ti ti-user-pin"></i></div>`,
      iconSize: [32,32], iconAnchor: [16,16], popupAnchor: [0,-18],
    });
    const m = L.marker([r.lat, r.lng], { icon, vgiId: r.id })
      .bindPopup(popupVGI(r), { maxWidth: 280 });
    m.addTo(layerGroups.vgi);
    vgiMarkers.push(m);
  });
}

// ===== DATABASE EDITOR =====
const liveDB = {
  police: STATIONS_POLICE.features.map(f => ({
    id: f.properties.id, emri: f.properties.emri,
    kapaciteti: f.properties.kapaciteti,
    automjete_aktive: f.properties.automjete,
  })),
  fire: STATIONS_FIRE.features.map(f => ({
    id: f.properties.id, emri: f.properties.emri,
    kapaciteti: f.properties.kapaciteti,
    automjete_aktive: f.properties.automjete,
  })),
  ambulance: STATIONS_AMB.features.map(f => ({
    id: f.properties.id, emri: f.properties.emri,
    ambulancat_aktive: f.properties.ambulancat,
  })),
  hospitals: HOSPITALS.features.map(f => ({
    id: f.properties.id, emri: f.properties.emri,
    dhoma_lira: Math.floor(f.properties['shtretër'] * 0.25),
    icu_lira: Math.floor(f.properties.ICU * 0.4),
  })),
};

function renderDBEditor() {
  const ed = document.getElementById('db-editor');
  if (!ed) return;

  const section = (icon, title, rows) =>
    `<div class="db-section">
      <div class="db-sec-title"><i class="ti ${icon}"></i> ${title}</div>
      ${rows}
    </div>`;

  const row = (name, fields) =>
    `<div class="db-row">
      <div class="db-row-name">${name}</div>
      <div class="db-fields">${fields}</div>
    </div>`;

  const field = (label, type, id, fieldKey, val) =>
    `<div class="db-field-wrap">
      <div class="db-field-label">${label}</div>
      <input class="db-field-input" type="number" min="0" value="${val}"
        onchange="saveDB('${type}','${id}','${fieldKey}',this.value)">
    </div>`;

  ed.innerHTML =
    section('ti-shield', 'Policia',
      liveDB.police.map(s => row(
        s.emri.replace('Drejtoria Rajonale ','').replace('Stacioni Policor ',''),
        field('Personeli','police',s.id,'kapaciteti',s.kapaciteti) +
        field('Automjete','police',s.id,'automjete_aktive',s.automjete_aktive)
      )).join('')
    ) +
    section('ti-flame', 'Zjarrfikës',
      liveDB.fire.map(s => row(
        s.emri.replace('Brigada Zjarrfikëse ',''),
        field('Personeli','fire',s.id,'kapaciteti',s.kapaciteti) +
        field('Automjete','fire',s.id,'automjete_aktive',s.automjete_aktive)
      )).join('')
    ) +
    section('ti-ambulance', 'Ambulance',
      liveDB.ambulance.map(s => row(
        s.emri.replace('QKMF ','').replace(' — Qendra',''),
        field('Aktive','ambulance',s.id,'ambulancat_aktive',s.ambulancat_aktive)
      )).join('')
    ) +
    section('ti-building-hospital', 'Spitalet',
      liveDB.hospitals.map(s => row(
        s.emri.replace('Spitali Rajonal ','').replace('QKUK — ',''),
        field('Dhoma lira','hospitals',s.id,'dhoma_lira',s.dhoma_lira) +
        field('ICU lira','hospitals',s.id,'icu_lira',s.icu_lira)
      )).join('')
    );
}

function saveDB(type, id, fieldKey, value) {
  const item = liveDB[type].find(s => s.id === id);
  if (item) {
    item[fieldKey] = parseInt(value) || 0;
    fbSaveLiveDB(type, id, fieldKey, item[fieldKey]);
    updateStats();
    setStatus(`U ruajt: ${id} → ${fieldKey} = ${value}`);
  }
}

function removeIncidentById(id) {
  INCIDENTS.features = INCIDENTS.features.filter(f => f.properties.id !== id);
  const marker = allIncidentMarkers.find(m => m.incidentData && m.incidentData.id === id);
  if (marker) {
    layerGroups.incidents.removeLayer(marker);
    allIncidentMarkers = allIncidentMarkers.filter(m => !(m.incidentData && m.incidentData.id === id));
  }
}

function resolveIncident(id) {
  removeIncidentById(id);
  map.closePopup();
  fbResolveIncident(id);
  renderIncidentList();
  updateStats();
  setStatus('Incidenti u shënua si i zgjidhur');
}

// ----- INIT -----
loadLayers();
loadBoundaryLayers();
renderLegend('severity');
applyZoomClass(map.getZoom());
setStatus('WebGIS Emergjente Kosovë — i ngarkuar me sukses');

// Firebase real-time sync
fbListenLiveDB();
fbListenIncidents();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Refresh map size on orientation change (portrait ↔ landscape)
window.addEventListener('orientationchange', function() {
  closeMobileAll();
  setTimeout(function() { if (map) map.invalidateSize(); }, 400);
});
window.addEventListener('resize', function() {
  if (map) map.invalidateSize();
});


// ===== MOBILE NAV =====
function toggleMobileSidebar() {
  const sb = document.getElementById('sidebar');
  const isOpen = sb.classList.contains('mobile-open');
  closeMobileAll();
  if (!isOpen) {
    sb.classList.add('mobile-open');
    document.getElementById('mobile-backdrop').classList.add('active');
    const btn = document.getElementById('mob-btn-layers');
    if (btn) btn.classList.add('active');
  }
}

function toggleMobileRightPanel() {
  const rp = document.getElementById('right-panel');
  const isOpen = rp && rp.classList.contains('mobile-open');
  closeMobileAll();
  if (!isOpen && rp) {
    rp.classList.add('mobile-open');
    document.getElementById('mobile-backdrop').classList.add('active');
    const btn = document.getElementById('mob-btn-incidents');
    if (btn) btn.classList.add('active');
  }
}

function toggleMobileTools() {
  const sheet = document.getElementById('mob-tools-sheet');
  const isOpen = sheet && sheet.classList.contains('open');
  closeMobileAll();
  if (!isOpen && sheet) {
    sheet.classList.add('open');
    document.getElementById('mobile-backdrop').classList.add('active');
    const btn = document.getElementById('mob-btn-tools');
    if (btn) btn.classList.add('active');
  }
}

function closeMobileTools() {
  const sheet = document.getElementById('mob-tools-sheet');
  if (sheet) sheet.classList.remove('open');
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
}

function togglePanelMin(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.classList.toggle('minimized');
  if (window.innerWidth <= 768) {
    setTimeout(function() { map.invalidateSize(); }, 50);
  }
}

function closeMobileAll() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  const rp = document.getElementById('right-panel');
  if (rp) rp.classList.remove('mobile-open');
  const sheet = document.getElementById('mob-tools-sheet');
  if (sheet) sheet.classList.remove('open');
  document.getElementById('mobile-backdrop').classList.remove('active');
  document.querySelectorAll('.mob-nav-btn').forEach(function(b) { b.classList.remove('active'); });
  setTimeout(function() { if (map) map.invalidateSize(); }, 300);
}
