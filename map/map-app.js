// NYC planner (index.html): the map in the middle, your five cards on the
// left, your saved places underneath (by category), the day's plan on the
// right. Take a card out of the dock → the map flies to that area.

// ---------------------------------------------------------------------------
// Saved places

const PLACES_KEY = 'mapPlaces';
const PLAN_KEY = 'mapPlan';
const CATEGORIES = [
  { id: 'food', label: 'Food', icon: '🍜' },
  { id: 'cafe', label: 'Café & Dessert', icon: '🍰' },
  { id: 'market', label: 'Market', icon: '🛒' },
  { id: 'park', label: 'Park', icon: '🌳' },
  { id: 'museum', label: 'Museum', icon: '🏛' },
  { id: 'theater', label: 'Theater', icon: '🎭' },
  { id: 'shop', label: 'Shopping', icon: '🛍' },
  { id: 'other', label: 'Other', icon: '📍' },
];
const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES.find((c) => c.id === 'other');

let places = loadJson(PLACES_KEY, null) || fromOldImport();
let plan = loadJson(PLAN_KEY, []); // [place id]
let activeArea = null; // area id or null (whole city)
let activeCategory = 'all';
let selectedId = null;

function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* full / private */ }
}

// Places imported by an older version of this page — no categories yet.
function fromOldImport() {
  const old = loadJson('qrImportedPlaces', []);
  return old.map((p) => ({ id: p.id, name: p.label, lat: p.lat, lng: p.lng, lists: [p.list, ...(p.lists || [])].filter(Boolean), category: guessCategory(p.label, null, null), approx: !!p.approx }));
}

// Category from OpenStreetMap tags (when known), else from the name.
function guessCategory(name, osmClass, osmType) {
  const t = `${osmClass || ''}:${osmType || ''}`;
  if (/amenity:(restaurant|fast_food|food_court|pub|bar|biergarten)/.test(t)) return 'food';
  if (/amenity:(cafe|ice_cream)|shop:(bakery|pastry|confectionery|tea|coffee|chocolate|dessert)/.test(t)) return 'cafe';
  if (/shop:(supermarket|convenience|grocery|deli|greengrocer|butcher|seafood|food|general)/.test(t)) return 'market';
  if (/leisure:(park|garden|playground)/.test(t)) return 'park';
  if (/^shop:/.test(t)) return 'shop';
  const n = (name || '').toLowerCase();
  if (/bakery|bakerie|cake|tart|baguette|dessert|yogurt|ice cream|matcha|\btea\b|caf[eé]|coffee|糖水|甜|cuit|bagel/.test(n)) return 'cafe';
  if (/mart\b|market|supermarket|grocer|deli\b|超市|food$/.test(n)) return 'market';
  if (/park\b/.test(n)) return 'park';
  if (/apothecary|malone|le labo|fueguia|nordstrom|micro center/.test(n)) return 'shop';
  if (/spa\b|body|library|bank|hall\b|yards|design|room\b/.test(n)) return 'other';
  return 'food';
}

// ---------------------------------------------------------------------------
// The map

const map = new maplibregl.Map({
  container: 'map',
  style: baseStyle(),
  bounds: [[-74.12, 40.62], [-73.80, 40.82]],
  fitBoundsOptions: { padding: 30 },
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Shorelines: NYC DCP, US Census' }));

// Dark, white-line look. Shorelines come with the page (always there);
// streets, parks and street names come from OpenFreeMap when online.
function baseStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      land: { type: 'geojson', data: LAND },
    },
    layers: [
            { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.07 } },
      { id: 'shore', type: 'line', source: 'land', paint: { 'line-color': 'rgba(255,255,255,0.75)', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 15, 1.6] } },
    ],
  };
}

map.on('error', (e) => console.warn('map:', e?.error?.message || e)); // e.g. offline: streets just don't show

// Streets, parks and names: added after the shorelines so the map still
// works (outlines only) if OpenFreeMap can't be reached.
const STREET_LAYERS = [
  { id: 'parks', type: 'fill', source: 'omt', 'source-layer': 'park', minzoom: 11, paint: { 'fill-color': '#9fd29f', 'fill-opacity': 0.08 } },
  { id: 'roads-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13.5, filter: ['in', ['get', 'class'], ['literal', ['minor', 'tertiary']]], paint: { 'line-color': 'rgba(255,255,255,0.18)', 'line-width': ['interpolate', ['linear'], ['zoom'], 13.5, 0.4, 17, 3] } },
  { id: 'roads-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11.5, filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'trunk', 'motorway']]], paint: { 'line-color': 'rgba(255,255,255,0.32)', 'line-width': ['interpolate', ['linear'], ['zoom'], 11.5, 0.5, 17, 5] } },
  { id: 'street-names', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14, filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'minor', 'trunk']]], layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 }, paint: { 'text-color': '#e6e6e6', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.2 } },
  { id: 'neighbourhoods', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 12, maxzoom: 15, filter: ['in', ['get', 'class'], ['literal', ['neighbourhood', 'suburb', 'quarter']]], layout: { 'text-field': ['upcase', ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'text-letter-spacing': 0.15 }, paint: { 'text-color': 'rgba(255,255,255,0.45)' } },
];

function addStreets() {
  try {
    map.addSource('omt', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
    for (const layer of STREET_LAYERS) map.addLayer(layer, layer.type === 'symbol' ? undefined : 'shore');
  } catch (error) {
    console.warn('streets unavailable', error);
  }
}

map.on('load', () => {
  map.resize();
  document.body.classList.toggle('far', map.getZoom() < 12.3);
  addStreets();
  map.addSource('areas', { type: 'geojson', data: areasGeoJson() });
  map.addLayer({ id: 'area-fill', type: 'fill', source: 'areas', paint: { 'fill-color': '#fff', 'fill-opacity': ['case', ['get', 'active'], 0.08, 0.025] } });
  map.addLayer({ id: 'area-line', type: 'line', source: 'areas', paint: { 'line-color': '#fff', 'line-opacity': ['case', ['get', 'active'], 0.95, 0.35], 'line-width': ['case', ['get', 'active'], 2, 1], 'line-dasharray': [3, 2] } });
  map.addSource('route', { type: 'geojson', data: routeGeoJson() });
  map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#fff', 'line-width': 2, 'line-opacity': 0.85 } });
  addHome();
  addAreaLabels();
  renderMarkers();
  renderAll();
});

function areasGeoJson() {
  return {
    type: 'FeatureCollection',
    features: AREAS.map((a) => ({ type: 'Feature', properties: { id: a.id, active: a.id === activeArea }, geometry: { type: 'Polygon', coordinates: [[...a.poly, a.poly[0]]] } })),
  };
}

function addHome() {
  const el = document.createElement('div');
  el.className = 'home-pin';
  el.innerHTML = '<span>★</span><b>Home</b>';
  el.title = HOME.label;
  new maplibregl.Marker({ element: el }).setLngLat([HOME.lng, HOME.lat]).addTo(map);
}

// Area names only once zoomed in a bit (they overlap at city scale).
map.on('zoom', () => document.body.classList.toggle('far', map.getZoom() < 12.3));

function addAreaLabels() {
  for (const a of AREAS) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'area-tag';
    el.dataset.area = a.id;
    el.textContent = a.short;
    el.addEventListener('click', () => setArea(activeArea === a.id ? null : a.id, 'click'));
    const c = centroid(a.poly);
    new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map);
  }
}

function centroid(poly) {
  const x = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const y = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  return [x, y];
}

function boundsOf(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

// Ray casting: is [lng, lat] inside the polygon?
function insidePoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function areaOf(p) {
  return AREAS.find((a) => insidePoly([p.lng, p.lat], a.poly))?.id || null;
}

// ---------------------------------------------------------------------------
// Markers for saved places

const markers = new Map(); // id -> { marker, el }

function renderMarkers() {
  for (const { marker } of markers.values()) marker.remove();
  markers.clear();
  for (const p of places) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'place-pin';
    el.dataset.id = p.id;
    el.innerHTML = `<span>${catById(p.category).icon}</span>`;
    el.title = p.name;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); selectPlace(p.id, true); });
    const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
    markers.set(p.id, { marker, el });
  }
  styleMarkers();
}

function styleMarkers() {
  for (const p of places) {
    const m = markers.get(p.id);
    if (!m) continue;
    const inArea = !activeArea || areaOf(p) === activeArea;
    const inCat = activeCategory === 'all' || p.category === activeCategory;
    m.el.classList.toggle('away', !inArea);
    m.el.classList.toggle('dim', inArea && !inCat);
    m.el.classList.toggle('in-plan', plan.includes(p.id));
    m.el.classList.toggle('selected', selectedId === p.id);
  }
}

// ---------------------------------------------------------------------------
// Area (from a card or a click)

function setArea(id, why) {
  if (id === activeArea) return;
  activeArea = id;
  activeCategory = 'all';
  map.getSource('areas')?.setData(areasGeoJson());
  if (id) {
    const a = AREAS.find((x) => x.id === id);
    map.fitBounds(boundsOf(a.poly), { padding: 60, duration: 1400, maxZoom: 15.2 });
    if (why === 'card') say(places.length ? `${a.short}. ${places.filter((p) => areaOf(p) === id).length} saved places here.` : `${a.short}. Your saved places are not loaded yet. Press Import.`);
  } else {
    map.fitBounds([[-74.12, 40.62], [-73.80, 40.82]], { padding: 30, duration: 1200 });
  }
  document.querySelectorAll('.area-tag').forEach((el) => el.classList.toggle('on', el.dataset.area === id));
  document.getElementById('area-clear').hidden = !id;
  renderAll();
}

// ---------------------------------------------------------------------------
// Bottom: places in this area, by category

function placesHere() {
  return places.filter((p) => !activeArea || areaOf(p) === activeArea);
}

function renderList() {
  const here = placesHere();
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, here.filter((p) => p.category === c.id).length]));
  const area = AREAS.find((a) => a.id === activeArea);
  document.getElementById('list-title').textContent = area ? area.label : 'All saved places';
  document.getElementById('list-count').textContent = `${here.length} place${here.length === 1 ? '' : 's'}`;
  document.getElementById('cat-tabs').innerHTML = [`<button type="button" data-cat="all" class="${activeCategory === 'all' ? 'on' : ''}">All <i>${here.length}</i></button>`]
    .concat(CATEGORIES.filter((c) => counts[c.id]).map((c) => `<button type="button" data-cat="${c.id}" class="${activeCategory === c.id ? 'on' : ''}">${c.icon} ${c.label} <i>${counts[c.id]}</i></button>`)).join('');
  const shown = here.filter((p) => activeCategory === 'all' || p.category === activeCategory);
  document.getElementById('place-list').innerHTML = shown.length
    ? shown.map((p) => `<li><button type="button" class="place-row${selectedId === p.id ? ' on' : ''}${plan.includes(p.id) ? ' planned' : ''}" data-id="${p.id}">
        <span class="pr-icon">${catById(p.category).icon}</span><span class="pr-name">${escapeText(p.name)}<small>${escapeText([p.type, p.price].filter(Boolean).join(' · '))}</small></span>
        <span class="pr-add" data-add="${p.id}" title="${plan.includes(p.id) ? 'In your plan' : 'Add to plan'}">${plan.includes(p.id) ? '✓' : '+'}</span></button></li>`).join('')
    : `<li class="empty">${places.length ? 'No saved places here yet.' : 'Import your Google Maps saved places (⬇️ top right) to see them here.'}</li>`;
}

document.getElementById('cat-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  activeCategory = b.dataset.cat;
  renderAll();
});

document.getElementById('place-list').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) { togglePlan(add.dataset.add); return; }
  const row = e.target.closest('[data-id]');
  if (row) selectPlace(row.dataset.id, true);
});

function selectPlace(id, fly) {
  selectedId = id;
  const p = places.find((x) => x.id === id);
  if (p && fly) map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 15), duration: 800 });
  showPopup(p);
  renderAll();
}

let popup = null;
function showPopup(p) {
  popup?.remove();
  if (!p) return;
  const inPlan = plan.includes(p.id);
  const meta = [p.type || catById(p.category).label, p.price, p.rating ? `★ ${p.rating}` : ''].filter(Boolean).map(escapeText).join(' · ');
  const html = `<div class="pop"><b>${escapeText(p.name)}</b><div>${catById(p.category).icon} ${meta}</div>
    ${p.address ? `<div>${escapeText(p.address)}</div>` : ''}${p.lists?.length ? `<div class="muted">Saved in ${escapeText(p.lists.join(', '))}</div>` : ''}
    ${p.approx ? '<div class="muted">Location approximate</div>' : ''}
    <button type="button" class="pop-add" data-add="${p.id}">${inPlan ? '✓ In your plan — remove' : '+ Add to plan'}</button></div>`;
  popup = new maplibregl.Popup({ closeButton: false, offset: 16, maxWidth: '260px' }).setLngLat([p.lng, p.lat]).setHTML(html).addTo(map);
  popup.getElement().querySelector('.pop-add').addEventListener('click', () => { togglePlan(p.id); showPopup(p); });
}

// ---------------------------------------------------------------------------
// Right: the plan (drag to reorder, ✕ to remove)

function togglePlan(id) {
  const adding = !plan.includes(id);
  plan = adding ? [...plan, id] : plan.filter((x) => x !== id);
  saveJson(PLAN_KEY, plan);
  if (adding && arranged) arrangeDay(); // keep the day in a good order
  else renderAll();
}

function walkMinutes(a, b) {
  return Math.max(1, Math.round(milesBetween(a, b) * 1.25 / 3 * 60));
}

// Rough door-to-door guess: walk if it's short, else subway (10 min of
// walking/waiting + ~3 min a mile). No transit API — marked "est.".
function legBetween(a, b) {
  const walk = walkMinutes(a, b);
  if (walk <= 20) return { mode: '🚶', minutes: walk };
  return { mode: '🚇', minutes: Math.round(10 + milesBetween(a, b) * 3) };
}

function milesBetween(a, b) {
  const t = (x) => (x * Math.PI) / 180;
  const h = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lng - a.lng) / 2) ** 2;
  return 7917.6 * Math.asin(Math.sqrt(h));
}

const planList = document.getElementById('plan-list');
planList.addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { togglePlan(del.dataset.del); return; }
  const mv = e.target.closest('[data-move]');
  if (mv) {
    const id = mv.dataset.move;
    movePlanItem(id, plan.indexOf(id) + Number(mv.dataset.dir));
    renderAll();
    return;
  }
  const stop = e.target.closest('.stop[data-id]');
  if (stop) selectPlace(stop.dataset.id, true);
});

// Drag to reorder (mouse / trackpad). Gestures come in step 2.
let dragId = null;
planList.addEventListener('dragstart', (e) => {
  const li = e.target.closest('.stop[data-id]');
  if (!li) return;
  dragId = li.dataset.id;
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
planList.addEventListener('dragover', (e) => {
  if (!dragId) return;
  e.preventDefault();
  const over = e.target.closest('.stop[data-id]');
  planList.querySelectorAll('.drop-above').forEach((x) => x.classList.remove('drop-above'));
  if (over && over.dataset.id !== dragId) over.classList.add('drop-above');
});
planList.addEventListener('drop', (e) => {
  e.preventDefault();
  const over = e.target.closest('.stop[data-id]');
  if (dragId && over && over.dataset.id !== dragId) movePlanItem(dragId, plan.indexOf(over.dataset.id));
  dragId = null;
  renderAll();
});
planList.addEventListener('dragend', () => { dragId = null; renderAll(); });

function movePlanItem(id, to) {
  const rest = plan.filter((x) => x !== id);
  rest.splice(Math.max(0, to), 0, id);
  plan = rest;
  arranged = false; // your own order now
  saveJson(PLAN_KEY, plan);
  saveJson('mapArranged', arranged);
}

document.getElementById('plan-clear').addEventListener('click', () => { plan = []; saveJson(PLAN_KEY, plan); renderAll(); });

function routeGeoJson() {
  const stops = plan.map((id) => places.find((p) => p.id === id)).filter(Boolean);
  if (!stops.length) return { type: 'FeatureCollection', features: [] };
  const pts = [HOME, ...stops, HOME].map((p) => [p.lng, p.lat]);
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] };
}

// ---------------------------------------------------------------------------
// Left: the five cards

function renderCards(cards = new Map()) {
  document.getElementById('card-list').innerHTML = AREAS.map((a) => {
    const c = cards.get(a.id);
    const state = !c ? 'away' : c.inDock ? 'docked' : 'out';
    return `<li><button type="button" class="card-row ${state}${activeArea === a.id ? ' on' : ''}" data-area="${a.id}">
      <span class="cr-name">${escapeText(a.short)}</span></button></li>`;
  }).join('');
}

document.getElementById('area-clear').addEventListener('click', () => {
  cardArea = null;
  setArea(null, 'click');
});

document.getElementById('card-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-area]');
  if (b) setArea(activeArea === b.dataset.area ? null : b.dataset.area, 'click');
});

// ---------------------------------------------------------------------------

function renderAll() {
  styleMarkers();
  renderList();
  renderPlan();
  map.getSource('route')?.setData(routeGeoJson());
}

// Speech
function say(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    speechSynthesis.speak(u);
  } catch (error) { /* no voice */ }
}

// ---------------------------------------------------------------------------
// Camera loop: which cards are out of the dock?

let cardOrder = []; // area ids, most recently taken out last
let lastCardsKey = '';
let cardArea = null; // area chosen by a card (not by a click)
let lastOutAt = 0;

function loop(now) {
  requestAnimationFrame(loop);
  if (camVideo.readyState < 2) return;
  // A scanned card's area stays until you press "✕ Clear area" (or show
  // another card) — taking the card away or covering it changes nothing.
  for (const hit of scanFrame(now)) {
    const xs = hit.pts.map((p) => p.x);
    const ys = hit.pts.map((p) => p.y);
    const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    cardsSeen.set(hit.text, { center, size: Math.max(...xs) - Math.min(...xs), t: now, pts: hit.pts });
  }
  const cards = cardsInView(now);
  drawCam(cards);
  const out = [...cards].filter(([, c]) => !c.inDock).map(([id]) => id);
  cardOrder = cardOrder.filter((id) => out.includes(id));
  for (const id of out) if (!cardOrder.includes(id)) cardOrder.push(id);
  const key = [...cards].map(([id, c]) => `${id}:${c.inDock}`).join('|');
  const want = cardOrder[cardOrder.length - 1] || null;
  if (want) lastOutAt = now;
  if (key !== lastCardsKey) {
    lastCardsKey = key;
    renderCards(cards);
    if (want && want !== cardArea) {
      cardArea = want;
      setArea(want, 'card');
    }
  }
  // Status: which cards are seen, plus any code that isn't one of the five.
  const names = [...cards.keys()].map((id) => AREAS.find((a) => a.id === id)?.card || id);
  const unknown = [...cardsSeen].filter(([t, e]) => now - e.t < 1500 && !QR_ROLES[qrKey(t)]?.startsWith('dest:')).map(([t]) => `"${t}"`);
  const status = (names.length ? 'Seen: ' + names.join(', ') : 'Hold a card under the camera')
    + (unknown.length ? ' · Unknown code: ' + unknown.join(', ') : '');
  if (status !== lastStatus) { lastStatus = status; setCamStatus(status); }
}
let lastStatus = '';

document.getElementById('start').addEventListener('click', async () => {
  document.getElementById('start-screen').hidden = true;
  await startCam(preferredCamera());
  requestAnimationFrame(loop);
});

renderCards();
