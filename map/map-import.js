// Import saved places into the planner (index.html):
//   • a Google Takeout .zip (tick "Saved"; also "Maps (your places)"), or
//   • a places .json made for this page (name, lat, lng, category, lists).
// Everything stays in this browser (localStorage) — nothing is uploaded
// anywhere except the place names sent to OpenStreetMap to find them.

const MAP_REGION = { minLat: 40.45, maxLat: 41.0, minLng: -74.35, maxLng: -73.65 };

const MAP_S2_LOOKUP_IJ = (() => {
  const table = new Array(1024);
  const posToIJ = [[0, 1, 3, 2], [0, 2, 3, 1], [3, 2, 0, 1], [3, 1, 0, 2]];
  const posToOrientation = [1, 0, 0, 3];
  const init = (level, i, j, orig, pos, orientation) => {
    if (level === 4) {
      table[(pos << 2) + orig] = (((i << 4) + j) << 2) + orientation;
      return;
    }
    const r = posToIJ[orientation];
    for (let k = 0; k < 4; k++) {
      init(level + 1, (i << 1) + (r[k] >> 1), (j << 1) + (r[k] & 1), orig, (pos << 2) + k, orientation ^ posToOrientation[k]);
    }
  };
  for (let o = 0; o < 4; o++) init(0, 0, 0, o, 0, o);
  return table;
})();

function mapS2CellToLatLng(hex) {
  const id = BigInt(hex);
  const face = Number(id >> 61n);
  let bits = face & 1;
  let i = 0;
  let j = 0;
  for (let k = 7; k >= 0; k--) {
    const n = k === 7 ? 2 : 4;
    bits += Number((id >> BigInt(k * 8 + 1)) & BigInt((1 << (2 * n)) - 1)) << 2;
    bits = MAP_S2_LOOKUP_IJ[bits];
    i += (bits >> 6) << (k * 4);
    j += ((bits >> 2) & 15) << (k * 4);
    bits &= 3;
  }
  const st = (x) => (2 * x + 1) / 2 ** 31;
  const uv = (s) => (s >= 0.5 ? (4 * s * s - 1) / 3 : (1 - 4 * (1 - s) * (1 - s)) / 3);
  const u = uv(st(i));
  const v = uv(st(j));
  const [x, y, z] = [[1, u, v], [-u, 1, v], [-u, -v, 1], [-1, -v, -u], [v, -1, -u], [v, u, -1]][face];
  return { lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, lng: (Math.atan2(y, x) * 180) / Math.PI };
}

function mapHint(url) {
  const m = url && url.match(/!1s(0x[0-9a-f]{16}):(0x[0-9a-f]+)/i);
  if (!m) return null;
  try {
    return { ...mapS2CellToLatLng(m[1]), fid: `${m[1]}:${m[2]}` };
  } catch (error) {
    return null;
  }
}

function inMapRegion(p) {
  return p.lat >= MAP_REGION.minLat && p.lat <= MAP_REGION.maxLat && p.lng >= MAP_REGION.minLng && p.lng <= MAP_REGION.maxLng;
}

function mapParseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function listName(path) {
  return path.split('/').pop().replace(/\.(csv|json|geojson)$/i, '').replace(/#U([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

async function importPlacesFiles(files) {
  showMapToast('Reading…');
  const docs = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const JSZip = await loadScriptOnce('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip');
      const zip = await JSZip.loadAsync(file);
      for (const e of Object.values(zip.files)) {
        if (!e.dir && /\.(csv|json|geojson)$/i.test(e.name)) docs.push({ name: e.name, text: await e.async('string') });
      }
    } else {
      docs.push({ name: file.name, text: await file.text() });
    }
  }

  const found = [];
  for (const d of docs) {
    if (/\.csv$/i.test(d.name)) {
      const rows = mapParseCsv(d.text);
      const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
      const iT = head.indexOf('title');
      const iU = head.indexOf('url');
      if (iT < 0) continue;
      for (const r of rows.slice(1)) {
        const name = (r[iT] || '').trim();
        const url = r[iU] || '';
        if (!name || (url && !/google\.[a-z.]+\/maps/.test(url))) continue;
        found.push({ name, url, list: listName(d.name), hint: mapHint(url) });
      }
    } else {
      let data;
      try { data = JSON.parse(d.text); } catch (error) { continue; }
      const list = Array.isArray(data) ? data : data.places || data.features;
      if (!Array.isArray(list)) continue;
      for (const f of list) {
        if (f.type === 'Feature') { // Takeout GeoJSON (Saved Places / Reviews)
          const pr = f.properties || {};
          const loc = pr.location || {};
          const name = pr.name || pr.Title || loc.name;
          const [lng, lat] = f.geometry?.coordinates || [];
          if (!name || /^(home|work)$/i.test(name)) continue;
          if (Number.isFinite(lat) && !(lat === 0 && lng === 0)) found.push({ name, lat, lng, list: listName(d.name) });
        } else if (f.name && Number.isFinite(f.lat)) { // a places .json for this page
          found.push({ ...f, list: f.lists?.[0], key: f.id, exact: true });
        }
      }
    }
  }

  // Find each place (OpenStreetMap; ~1 per second), keep NY/NJ ones.
  const byKey = new Map(places.map((p) => [p.key || p.name.toLowerCase(), p]));
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    showMapToast(`Finding places… ${i + 1}/${found.length}`);
    if (f.hint && !inMapRegion(f.hint)) { skipped++; continue; }
    const key = f.key || f.hint?.fid || f.name.toLowerCase();
    const old = byKey.get(key);
    if (old) {
      if (f.list && !old.lists.includes(f.list)) old.lists.push(f.list);
      continue;
    }
    let p = null;
    if (Number.isFinite(f.lat)) {
      p = { lat: f.lat, lng: f.lng, category: f.category || guessCategory(f.name), approx: false };
    } else {
      p = await lookUpPlace(f);
    }
    if (!p || !inMapRegion(p)) { skipped++; continue; }
    const place = { id: `p${hash(key)}`, key, name: f.name, lat: p.lat, lng: p.lng, category: p.category, approx: !!p.approx, lists: f.lists || (f.list ? [f.list] : []), type: f.type || '', price: f.price || '', rating: f.rating || '', address: f.address || '', url: f.url || '' };
    places.push(place);
    byKey.set(key, place);
    added++;
  }
  saveJson(PLACES_KEY, places);
  renderMarkers();
  renderAll();
  showMapToast(`Added ${added} place${added === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped (outside NY/NJ or not found)` : ''}`, 6000);
}

async function lookUpPlace(f) {
  await new Promise((r) => setTimeout(r, 1100)); // OpenStreetMap asks for ≤ 1 request a second
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&bounded=1&viewbox=${MAP_REGION.minLng},${MAP_REGION.maxLat},${MAP_REGION.maxLng},${MAP_REGION.minLat}&q=${encodeURIComponent(f.name)}`;
    const hits = (await (await fetch(url)).json()).map((d) => ({ lat: +d.lat, lng: +d.lon, cls: d.category, type: d.type }));
    let best = null;
    if (f.hint) {
      // One match → trust it (the link's hint can be miles off); several
      // (a chain) → the branch next to the hint.
      if (hits.length === 1 && milesBetween(hits[0], f.hint) < 7) best = hits[0];
      else {
        hits.sort((a, b) => milesBetween(a, f.hint) - milesBetween(b, f.hint));
        if (hits[0] && milesBetween(hits[0], f.hint) < 1) best = hits[0];
      }
    } else best = hits[0];
    if (best) return { lat: best.lat, lng: best.lng, category: guessCategory(f.name, best.cls, best.type) };
  } catch (error) { /* offline */ }
  return f.hint ? { lat: f.hint.lat, lng: f.hint.lng, category: guessCategory(f.name), approx: true } : null;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

function loadScriptOnce(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(window[globalName]);
    s.onerror = reject;
    document.head.append(s);
  });
}

let toastTimer = null;
function showMapToast(text, ms = 0) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}


document.getElementById('clear-btn').addEventListener('click', () => {
  if (!places.length) return;
  places = [];
  plan = [];
  saveJson(PLACES_KEY, places);
  saveJson(PLAN_KEY, plan);
  renderMarkers();
  renderAll();
  showMapToast('Saved places cleared', 3000);
});

// Load the places that come with the page (plain <script> files, so this
// also works when index.html is opened straight from the computer):
//   my-places.js   — your Google Maps saved places (first visit only)
//   more-places.js — suggested parks, museums, theaters and markets; any
//                    you don't have yet are added (also on later visits)
(async () => {
  if (!places.length && typeof MY_PLACES !== 'undefined') {
    const text = JSON.stringify(MY_PLACES);
    await importPlacesFiles([{ name: 'my-places.json', text: async () => text }]);
  }
  if (typeof MORE_PLACES !== 'undefined') {
    const near = (a, b) => Math.abs(a.lat - b.lat) < 0.0003 && Math.abs(a.lng - b.lng) < 0.0003;
    const fresh = MORE_PLACES.filter((m) => !places.some((p) => p.key === m.id
      || p.name.toLowerCase() === m.name.toLowerCase() || near(p, m)));
    if (fresh.length) {
      const text = JSON.stringify({ places: fresh });
      await importPlacesFiles([{ name: 'more-places.json', text: async () => text }]);
    }
  }
})();
