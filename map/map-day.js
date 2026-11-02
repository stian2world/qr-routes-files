// Plan my day: circle the places you want (or tap +), and the page puts
// them in a good order and times the whole day — leave home, PATH (real
// timetable from config.js), walk / subway between stops, back home.
//
// Order: every possible order is tried (up to 7 stops) and the one with the
// least travelling wins, nudged so restaurants land near lunch (11:30–2) or
// dinner (5:30–8:30) and cafés in the afternoon.

const DWELL = { food: 60, cafe: 30, market: 25, shop: 30, park: 45, museum: 90, theater: 150, other: 30 }; // minutes at a stop
const GROVE = { name: 'Grove St', lat: 40.7194, lng: -74.0430 };
const HOME_TO_GROVE = 4;
// PATH stations in Manhattan on the 33rd St line, minutes from Grove St.
const PATH_NY = [
  { name: 'Christopher St', lat: 40.7330, lng: -74.0069, ride: 8 },
  { name: '9th St', lat: 40.7342, lng: -73.9988, ride: 10 },
  { name: '14th St', lat: 40.7374, lng: -73.9969, ride: 12 },
  { name: '23rd St', lat: 40.7429, lng: -73.9928, ride: 14 },
  { name: '33rd St', lat: 40.7491, lng: -73.9882, ride: 17 },
];

const dayStart = ''; // the day always starts now (the "Leave at" box was removed)
let arranged = loadJson('mapArranged', false);

// --- time helpers -------------------------------------------------------

function addMin(d, m) {
  return new Date(d.getTime() + m * 60000);
}

function clock(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function startTime() {
  const now = new Date();
  if (dayStart) {
    const [h, m] = dayStart.split(':').map(Number);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d;
  }
  const d = addMin(now, 5 - (now.getMinutes() % 5));
  d.setSeconds(0, 0);
  return d;
}

// Next PATH train at or after `t` (timetable rows: [first, last, every]).
function nextPath(name, t) {
  const tt = TIMETABLES[name];
  const rows = Array.isArray(tt) ? tt : tt.rows;
  const now = t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60;
  const mins = [];
  for (const [a, b, every] of rows) {
    const [ah, am] = a.split(':').map(Number);
    const [bh, bm] = b.split(':').map(Number);
    for (let m = ah * 60 + am; m <= bh * 60 + bm; m += every) mins.push(m);
  }
  let dep = mins.find((m) => m >= now - 0.01);
  if (dep === undefined) dep = mins[0] + 1440; // after the last train: first one tomorrow
  const d = new Date(t);
  d.setHours(Math.floor(dep / 60), dep % 60, 0, 0); // also right on clock-change days
  return { depart: d, estimated: !Array.isArray(tt) && !!tt.estimated };
}

// --- real routes for the five card areas ---------------------------------
// map/routes.js has the real trip from home to each card's place (PATH +
// subway, with the MTA schedule in subway.js). A stop inside one of those
// areas uses it; anything else is PATH + an estimate.

function serviceDayOf(d) {
  const day = d.getDay();
  return day === 0 ? 'Sunday' : day === 6 ? 'Saturday' : 'Weekday';
}

function atMin(base, m) {
  const d = new Date(base);
  d.setHours(Math.floor(m / 60), Math.round(m % 60), 0, 0);
  return d;
}

function runLegs(legs, start) {
  let t = new Date(start);
  const out = [];
  for (const leg of legs) {
    if (leg.type === 'walk') {
      out.push({ t, icon: '🚶', minutes: leg.minutes, text: leg.text });
      t = addMin(t, leg.minutes);
    } else if (leg.type === 'path') {
      const { depart, estimated } = nextPath(leg.timetable, t);
      const arr = addMin(depart, leg.ride);
      out.push({ t: depart, end: arr, icon: '🚆', text: `PATH ${leg.from} → ${leg.to}`, sub: `arrive ${clock(arr)}`, est: estimated });
      t = arr;
    } else if (leg.type === 'subway') {
      const trips = (typeof SUBWAY_LEGS !== 'undefined' && SUBWAY_LEGS[leg.leg]?.[serviceDayOf(t)]) || [];
      const now = t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60;
      const hit = trips.find(([m]) => m >= now - 0.01);
      let depart;
      let ride = leg.ride;
      let route = leg.lines;
      let est = false;
      if (hit) {
        depart = atMin(t, hit[0]);
        ride = hit[1];
        route = hit[2].endsWith('X') ? `${hit[2].slice(0, -1)} express` : hit[2];
      } else {
        depart = addMin(t, leg.every / 2);
        est = true;
      }
      const arr = addMin(depart, ride);
      out.push({ t: depart, end: arr, icon: '🚇', text: `${route} train ${leg.from} → ${leg.to}`, sub: `arrive ${clock(arr)}`, est });
      t = arr;
    }
  }
  return { legs: out, arrive: t };
}

function cardRoute(p) {
  if (typeof DESTINATIONS === 'undefined' || p === HOME) return null;
  const id = areaOf(p);
  return id ? DESTINATIONS.find((d) => d.id === id) : null;
}

// --- getting from A to B --------------------------------------------------

function inNJ(p) {
  const nj = LAND.features.find((f) => f.properties.state === 'NJ');
  const polys = nj.geometry.type === 'MultiPolygon' ? nj.geometry.coordinates : [nj.geometry.coordinates];
  return polys.some((poly) => insidePoly([p.lng, p.lat], poly[0]));
}

// Walk if it's short, otherwise the subway (estimate: ~10 min walking and
// waiting + ~3 min a mile). No transit API, so these are marked "est.".
function shortHop(a, b) {
  const walk = walkMinutes(a, b);
  if (walk <= 20) return { icon: '🚶', minutes: walk, text: `Walk to ${b.name || 'Home'}` };
  return { icon: '🚇', minutes: Math.round(10 + milesBetween(a, b) * 3), text: `Subway to ${b.name}`, est: true };
}

function bestStation(p) {
  // Far away (Queens, Brooklyn…): ride to 33rd St, the big subway hub.
  if (milesBetween(PATH_NY[4], p) > 3) return { s: PATH_NY[4], hop: shortHop(PATH_NY[4], p) };
  return PATH_NY.map((s) => ({ s, hop: shortHop(s, p) })).sort((x, y) => (x.s.ride + x.hop.minutes) - (y.s.ride + y.hop.minutes))[0];
}

// Legs from `a` to `b` leaving at `t`: [{ t, icon, text, sub, est }], arrive.
function trip(a, b, t) {
  const legs = [];
  // Home → a place in a card area: the real route, then the last bit.
  const goRoute = a === HOME && cardRoute(b);
  if (goRoute) {
    const r = runLegs(goRoute.go, t);
    const end = { lat: goRoute.lat, lng: goRoute.lng };
    const hop = shortHop(end, b);
    return { legs: [...r.legs, { t: r.arrive, ...hop }], arrive: addMin(r.arrive, hop.minutes) };
  }
  // A place in a card area → home: to its station, then the real route.
  const backRoute = b === HOME && cardRoute(a);
  if (backRoute) {
    const st = backRoute.backStation;
    const hop = shortHop(a, { ...st });
    const r = runLegs([...backRoute.back, ...(backRoute.home || BACK_TO_HOME)], addMin(t, hop.minutes));
    return { legs: [{ t, ...hop, text: `${hop.icon === '🚶' ? 'Walk' : 'Subway'} to ${st.name}` }, ...r.legs], arrive: r.arrive };
  }
  const aNJ = a === HOME || inNJ(a);
  const bNJ = b === HOME || inNJ(b);
  if (aNJ === bNJ) { // same side of the Hudson
    const hop = shortHop(a, b === HOME ? { ...HOME, name: 'Home' } : b);
    legs.push({ t, ...hop });
    return { legs, arrive: addMin(t, hop.minutes) };
  }
  if (aNJ) { // over to New York on the PATH
    const toGrove = a === HOME ? HOME_TO_GROVE : walkMinutes(a, GROVE);
    legs.push({ t, icon: '🚶', minutes: toGrove, text: 'Walk to Grove St PATH' });
    const { s, hop } = bestStation(b);
    const { depart, estimated } = nextPath('GROVE_TO_33RD', addMin(t, toGrove));
    const off = addMin(depart, s.ride);
    legs.push({ t: depart, end: off, icon: '🚆', text: `PATH Grove St → ${s.name}`, sub: `arrive ${clock(off)}`, est: estimated });
    legs.push({ t: off, ...hop });
    return { legs, arrive: addMin(off, hop.minutes) };
  }
  // back to New Jersey
  const { s, hop } = bestStation(a);
  legs.push({ t, ...hop, text: `${hop.icon === '🚶' ? 'Walk' : 'Subway'} to ${s.name} PATH` });
  const { depart, estimated } = nextPath('TWENTY_THIRD_TO_GROVE', addMin(t, hop.minutes));
  const off = addMin(depart, s.ride);
  legs.push({ t: depart, end: off, icon: '🚆', text: `PATH ${s.name} → Grove St`, sub: `arrive ${clock(off)}`, est: estimated });
  const last = b === HOME ? HOME_TO_GROVE : walkMinutes(GROVE, b);
  legs.push({ t: off, icon: '🚶', minutes: last, text: b === HOME ? 'Walk home' : `Walk to ${b.name}` });
  return { legs, arrive: addMin(off, last) };
}

// --- the whole day --------------------------------------------------------

function scheduleDay(stops, start) {
  const rows = [{ t: start, kind: 'home', text: 'Leave home' }];
  let t = start;
  let here = HOME;
  let travel = 0;
  let penalty = 0;
  for (const p of stops) {
    const tr = trip(here, p, t);
    tr.legs.forEach((l) => rows.push({ ...l, kind: 'leg' }));
    travel += (tr.arrive - t) / 60000;
    const stay = DWELL[p.category] ?? 30;
    rows.push({ t: tr.arrive, kind: 'stop', place: p, until: addMin(tr.arrive, stay) });
    penalty += mealPenalty(p, tr.arrive);
    t = addMin(tr.arrive, stay);
    here = p;
  }
  const back = trip(here, HOME, t);
  back.legs.forEach((l) => rows.push({ ...l, kind: 'leg' }));
  travel += (back.arrive - t) / 60000;
  rows.push({ t: back.arrive, kind: 'home', text: 'Home' });
  return { rows, travel, end: back.arrive, score: travel + penalty };
}

function mealPenalty(p, t) {
  const m = t.getHours() * 60 + t.getMinutes();
  const away = (lo, hi) => (m < lo ? lo - m : m > hi ? m - hi : 0);
  if (p.category === 'food') return 0.6 * Math.min(away(690, 840), away(1050, 1230));
  if (p.category === 'cafe') return 0.15 * away(840, 1020);
  return 0;
}

function arrangeDay() {
  const stops = plan.map((id) => places.find((p) => p.id === id)).filter(Boolean);
  if (stops.length < 2) {
    arranged = true;
    saveJson('mapArranged', arranged);
    renderAll();
    return;
  }
  const start = startTime();
  let best = null;
  if (stops.length <= 7) {
    for (const order of permutations(stops)) {
      const s = scheduleDay(order, start);
      if (!best || s.score < best.score) best = { order, score: s.score };
    }
  } else { // many stops: nearest next stop each time
    const left = [...stops];
    const order = [];
    let here = HOME;
    while (left.length) {
      left.sort((a, b) => milesBetween(here, a) - milesBetween(here, b));
      here = left.shift();
      order.push(here);
    }
    best = { order };
  }
  plan = best.order.map((p) => p.id);
  arranged = true;
  saveJson(PLAN_KEY, plan);
  saveJson('mapArranged', arranged);
  renderAll();
}

function* permutations(list) {
  if (list.length <= 1) { yield list; return; }
  for (let i = 0; i < list.length; i++) {
    const rest = [...list.slice(0, i), ...list.slice(i + 1)];
    for (const p of permutations(rest)) yield [list[i], ...p];
  }
}

// Replaces the simple list: the timed day.
// MTA line colours (and PATH) for the ride badges in the plan.
const LINE_COLORS = {
  A: '#0039A6', C: '#0039A6', E: '#0039A6', B: '#FF6319', D: '#FF6319', F: '#FF6319', M: '#FF6319',
  G: '#6CBE45', J: '#996633', Z: '#996633', L: '#A7A9AC', N: '#FCCC0A', Q: '#FCCC0A', R: '#FCCC0A', W: '#FCCC0A',
  1: '#EE352E', 2: '#EE352E', 3: '#EE352E', 4: '#00933C', 5: '#00933C', 6: '#00933C', 7: '#B933AD', S: '#808183',
};
const DARK_TEXT = new Set(['N', 'Q', 'R', 'W', 'L']);

// One travel row: walks stay quiet; PATH / subway rides get a coloured
// badge and their departure time stands out.
function legRow(r) {
  const time = `<span class="t">${clock(r.t)}</span>`;
  const est = r.est ? ' <em>est.</em>' : '';
  if (r.icon === '🚶') {
    return `<li class="leg walk">${time}<span class="what">🚶 ${escapeText(r.text)}${r.minutes ? ` · ${r.minutes} min` : ''}</span></li>`;
  }
  let badge;
  let route = '';
  let text = r.text;
  if (r.icon === '🚆') {
    badge = '<b class="badge path">PATH</b>';
    text = text.replace(/^PATH /, '');
  } else {
    const m = text.match(/^(\S+?)( express)? train (.*)$/);
    if (m) {
      route = m[1].split('/')[0];
      const bg = LINE_COLORS[route] || '#808183';
      badge = `<b class="badge line" style="background:${bg};color:${DARK_TEXT.has(route) ? '#111' : '#fff'}">${escapeText(m[1])}</b>${m[2] ? '<small class="exp">express</small>' : ''}`;
      text = m[3];
    } else {
      badge = '<b class="badge subway">Subway</b>';
      text = text.replace(/^Subway /, '');
    }
  }
  // Timed rides: say when to be on the platform (a few minutes early) and
  // make the times easy to spot.
  const timed = r.end && !/Subway/.test(badge);
  const beBy = addMin(r.t, -(r.icon === '🚆' ? 3 : 2));
  const times = timed
    ? `<span class="times"><b class="be-by">be there by ${clock(beBy)}</b><span class="arrive">arrive <b>${clock(r.end)}</b></span></span>`
    : (r.sub ? `<span class="arr">${escapeText(r.sub)}</span>` : '');
  return `<li class="leg ride ${r.icon === '🚆' ? 'is-path' : 'is-subway'}">${time}<span class="what">${badge} ${escapeText(text)}${r.minutes ? ` · ~${r.minutes} min` : ''}${times}${est}</span></li>`;
}

// The day as shown: late at night the first train can be hours away, so
// leave home just in time for it instead of "11:40 PM … 7:08 AM".
function planDay(stops) {
  const day = scheduleDay(stops, startTime());
  const [home0, walk0, ride0] = day.rows;
  if (walk0?.kind === 'leg' && ride0?.kind === 'leg' && walk0.minutes && ride0.t - walk0.t > (walk0.minutes + 90) * 60000) {
    const newStart = addMin(ride0.t, -walk0.minutes);
    day.travel -= (newStart - walk0.t) / 60000;
    home0.t = walk0.t = newStart;
  }
  return day;
}

function renderPlan() {
  const stops = plan.map((id) => places.find((p) => p.id === id)).filter(Boolean);
  const box = document.getElementById('plan-list');
  document.getElementById('plan-order').textContent = stops.length > 1 ? (arranged ? '✨ Arranged for you' : 'Your order') : '';
  if (!stops.length) {
    box.innerHTML = '<li class="empty">Circle places on the map (◯) or tap + to add them. Then ✨ Arrange my day.</li>';
    document.getElementById('plan-total').textContent = '';
    return;
  }
  const day = planDay(stops);
  let n = 0;
  box.innerHTML = day.rows.map((r) => {
    if (r.kind === 'home') return `<li class="stop home"><span class="t">${clock(r.t)}</span>★ ${r.text}</li>`;
    if (r.kind === 'leg') return legRow(r);
    n++;
    const p = r.place;
    return `<li class="stop" draggable="true" data-id="${p.id}"><span class="t">${clock(r.t)}</span><span class="num">${n}</span>
      <span class="sname">${catById(p.category).icon} ${escapeText(p.name)}<small>until ${clock(r.until)}${p.price ? ` · ${escapeText(p.price)}` : ''}</small></span>
      <span class="mv"><button type="button" data-move="${p.id}" data-dir="-1" aria-label="Move earlier"${n === 1 ? ' disabled' : ''}>▲</button><button type="button" data-move="${p.id}" data-dir="1" aria-label="Move later"${n === stops.length ? ' disabled' : ''}>▼</button></span>
      <button type="button" class="del" data-del="${p.id}" aria-label="Remove">✕</button></li>`;
  }).join('');
  const hrs = Math.floor((day.end - day.rows[0].t) / 3600000);
  const mins = Math.round(((day.end - day.rows[0].t) / 60000) % 60);
  document.getElementById('plan-total').textContent = `${stops.length} stop${stops.length === 1 ? '' : 's'} · home by ${clock(day.end)} · ${hrs ? `${hrs} h ` : ''}${mins} min out · ~${Math.round(day.travel)} min travelling`;
}

document.getElementById('plan-arrange').addEventListener('click', () => {
  arrangeDay();
  const stops = plan.length;
  if (stops > 1) say(`Done. ${stops} stops. Home by ${clock(planDay(plan.map((id) => places.find((p) => p.id === id)).filter(Boolean)).end)}.`);
});



// --- circle places on the map (mouse / finger; hands use the same calls) ---

const lassoCanvas = document.getElementById('lasso');
const lassoCtx = lassoCanvas.getContext('2d');
const lassoBtn = document.getElementById('lasso-btn');
let lassoOn = false;
let lassoPts = null;

function setLasso(on) {
  lassoOn = on;
  lassoBtn.classList.toggle('on', on);
  lassoCanvas.classList.toggle('on', on);
  if (!on) clearLasso();
}

lassoBtn.addEventListener('click', () => setLasso(!lassoOn));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setLasso(false); });

function sizeLasso() {
  const r = lassoCanvas.getBoundingClientRect();
  lassoCanvas.width = r.width * devicePixelRatio;
  lassoCanvas.height = r.height * devicePixelRatio;
  lassoCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

// x, y are page (client) coordinates.
function lassoBegin(x, y) {
  sizeLasso();
  lassoPts = [toMapXY(x, y)];
}

function lassoMove(x, y) {
  if (!lassoPts) return;
  lassoPts.push(toMapXY(x, y));
  drawLasso();
}

function lassoEnd() {
  if (!lassoPts) return [];
  const pts = lassoPts;
  lassoPts = null;
  setTimeout(clearLasso, 350);
  if (pts.length < 6) return [];
  const ring = pts.map((p) => map.unproject([p.x, p.y])).map((ll) => [ll.lng, ll.lat]);
  // Places inside the circle — only the category you're looking at, and
  // never "Other" (offices, school…) unless that tab is chosen.
  const picked = places.filter((p) => insidePoly([p.lng, p.lat], ring)
    && (!activeArea || areaOf(p) === activeArea)
    && (activeCategory === 'all' ? p.category !== 'other' : p.category === activeCategory));
  const added = picked.filter((p) => !plan.includes(p.id));
  if (!picked.length) {
    showMapToast('No saved places inside the circle', 2500);
    return [];
  }
  plan = [...plan, ...added.map((p) => p.id)];
  saveJson(PLAN_KEY, plan);
  arrangeDay();
  showMapToast(`Added ${added.length} place${added.length === 1 ? '' : 's'} · arranged your day`, 3500);
  say(`${added.length} added. Home by ${clock(scheduleDay(plan.map((id) => places.find((p) => p.id === id)), startTime()).end)}.`);
  return picked;
}

function toMapXY(x, y) {
  const r = lassoCanvas.getBoundingClientRect();
  return { x: x - r.left, y: y - r.top };
}

function drawLasso() {
  const w = lassoCanvas.width / devicePixelRatio;
  const h = lassoCanvas.height / devicePixelRatio;
  lassoCtx.clearRect(0, 0, w, h);
  if (!lassoPts || lassoPts.length < 2) return;
  lassoCtx.beginPath();
  lassoPts.forEach((p, i) => (i ? lassoCtx.lineTo(p.x, p.y) : lassoCtx.moveTo(p.x, p.y)));
  lassoCtx.closePath();
  lassoCtx.fillStyle = 'rgba(255,255,255,0.12)';
  lassoCtx.fill();
  lassoCtx.strokeStyle = '#fff';
  lassoCtx.lineWidth = 2.5;
  lassoCtx.setLineDash([8, 6]);
  lassoCtx.stroke();
  lassoCtx.setLineDash([]);
}

function clearLasso() {
  lassoCtx.clearRect(0, 0, lassoCanvas.width, lassoCanvas.height);
}

lassoCanvas.addEventListener('pointerdown', (e) => {
  if (!lassoOn) return;
  lassoCanvas.setPointerCapture(e.pointerId);
  lassoBegin(e.clientX, e.clientY);
});
lassoCanvas.addEventListener('pointermove', (e) => { if (lassoOn) lassoMove(e.clientX, e.clientY); });
lassoCanvas.addEventListener('pointerup', () => {
  if (!lassoOn) return;
  lassoEnd();
  setLasso(false);
});

// --- Export: today's plan as a calendar file (.ics) ---------------------------
// Each stop and each train ride becomes an event; open the file to add them
// to Apple Calendar / Google Calendar / Outlook.
function icsTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}
function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
}
// Calendar lines longer than 75 bytes are folded (continued with a space).
function icsFold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function exportPlan() {
  const stops = plan.map((id) => places.find((p) => p.id === id)).filter(Boolean);
  if (!stops.length) { showMapToast('Add some places to your plan first', 3000); return; }
  const day = planDay(stops);
  const events = [];
  const add = (start, end, summary, location, desc) => events.push([
    'BEGIN:VEVENT', `UID:${icsTime(start)}-${events.length}@nyc-planner`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=America/New_York:${icsTime(start)}`, `DTEND;TZID=America/New_York:${icsTime(end)}`,
    `SUMMARY:${icsText(summary)}`, location ? `LOCATION:${icsText(location)}` : '', desc ? `DESCRIPTION:${icsText(desc)}` : '', 'END:VEVENT',
  ].filter(Boolean).map(icsFold).join('\r\n'));
  let n = 0;
  const lines = [];
  for (const r of day.rows) {
    if (r.kind === 'stop') {
      n++;
      const p = r.place;
      add(r.t, r.until, `${n}. ${p.name}`, p.address || '', [p.type, p.price, p.url].filter(Boolean).join(' · '));
      lines.push(`${clock(r.t)}  ${n}. ${p.name} (until ${clock(r.until)})`);
    } else if (r.kind === 'leg') {
      const ride = r.icon === '🚆' || r.icon === '🚇';
      const end = r.end || addMin(r.t, r.minutes || 0);
      if (ride) add(r.t, end, `${r.icon} ${r.text}`, '', r.sub || '');
      lines.push(`${clock(r.t)}  ${r.icon} ${r.text}${r.minutes ? ` · ${r.minutes} min` : ''}${r.sub ? ` · ${r.sub}` : ''}`);
    } else {
      lines.push(`${clock(r.t)}  ★ ${r.text}`);
    }
  }
  // One all-in-one event too, so the whole day is readable in one place.
  add(day.rows[0].t, day.end, `NYC day · ${stops.length} stops`, '', lines.join('\n'));
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NYC Planner//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const d = day.rows[0].t;
  a.download = `nyc-day-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.ics`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  showMapToast('Plan downloaded — open the .ics file to add it to your calendar', 4000);
}
document.getElementById('export-btn').addEventListener('click', exportPlan);
