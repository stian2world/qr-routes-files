// Voice mode: control the planner by talking (Chrome's built-in speech
// recognition, English). Commands — "please", "for me", "can you" are fine:
//
//   go to Flushing / Chelsea / Times Square / the Met / MoMA  → that area
//   go to H Mart / find Trader Joe's / show me ramen           → that place
//   add this (to my plan / calendar)                           → add it
//   set H Mart as my second destination / set this as first   → put it there
//   remove this / remove H Mart                                → take it out
//   show restaurants / parks / museums / everything            → filter
//   zoom in / zoom out · move the map left / right / up / down
//   arrange my day · what's my plan · clear my plan · clear area
//   export · add to my Google Calendar
//   gesture mode                                               → switch

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let voiceOn = false;
let recognizer = null;
let restartTimer = null;

const voiceBar = document.createElement('div');
voiceBar.id = 'voice-bar';
voiceBar.hidden = true;
voiceBar.innerHTML = '<span class="vb-mic">🎙</span><div class="vb-text"><div class="vb-heard">Listening…</div><div class="vb-reply"></div></div>';
document.body.appendChild(voiceBar);
const heardEl = voiceBar.querySelector('.vb-heard');
const replyEl = voiceBar.querySelector('.vb-reply');

function startVoice() {
  voiceBar.hidden = false;
  if (!SpeechRec) {
    heardEl.textContent = 'Voice needs Google Chrome (this browser has no speech recognition).';
    return;
  }
  voiceOn = true;
  listen();
}

function stopVoice() {
  voiceOn = false;
  clearTimeout(restartTimer);
  try { recognizer?.abort(); } catch (e) { /* gone */ }
  recognizer = null;
  voiceBar.hidden = true;
}

// Speech comes from Chrome's built-in recognizer (Google's cloud speech
// service — the page can't pick or train the model). To make it feel less
// fussy we:
//   • look at up to 5 guesses for each sentence and keep the one that makes
//     sense as a command / matches a saved place,
//   • wait for the rest of the sentence when it stops on "…as my", "…to",
//   • run short commands ("zoom in", "add this") as soon as they're heard,
//     without waiting for the end-of-sentence pause,
//   • stop talking when you start talking, and ignore our own voice.
let pending = ''; // first half of a sentence that stopped mid-way
let pendingTimer = null;
let interimTimer = null;
let lastRun = { text: '', at: 0 };
let lastSpoken = { text: '', until: 0 };

function listen() {
  if (!voiceOn) return;
  recognizer = new SpeechRec();
  recognizer.lang = 'en-US';
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.maxAlternatives = 5;
  recognizer.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const alts = [...res].map((a) => a.transcript.trim()).filter(Boolean);
      if (!alts.length || isEcho(alts[0])) continue;
      if (speechSynthesis.speaking) speechSynthesis.cancel(); // you're talking: stop ours
      if (res.isFinal) onFinal(alts); else onInterim(alts[0]);
    }
  };
  recognizer.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      voiceOn = false;
      heardEl.textContent = 'Microphone is blocked — allow it (🔒 in the address bar) and pick Voice again.';
    }
  };
  recognizer.onend = () => { if (voiceOn) restartTimer = setTimeout(listen, 150); };
  try { recognizer.start(); } catch (e) { restartTimer = setTimeout(listen, 1000); }
  voiceBar.classList.add('on');
}

// Our own reply coming back through the microphone?
function isEcho(text) {
  if (performance.now() > lastSpoken.until) return false;
  const t = clean(text);
  if (/^(go|take|fly|find|show|where|open|select|add|set|remove|delete|zoom|move|pan|arrange|export|what|clear|switch)\b/.test(t)) return false; // a command: that's you
  return similarity(norm(text), norm(lastSpoken.text)) > 0.6 || norm(lastSpoken.text).includes(norm(text));
}

const DANGLING = /\b(as|as my|my|to|the|and|for|at|with|is|set|go|add|of|a|an|in|then|put)$/;

function onInterim(text) {
  const t = (pending ? `${pending} ` : '') + text;
  heardEl.textContent = `${t}…`;
  clearTimeout(interimTimer);
  // Short, complete commands run straight away (no names that could still change).
  const c = clean(t);
  if (/^(zoom (in|out)( a lot| more)?|(move|pan|go)( the)?( map)?( to)?( the)? (left|right|up|down)|arrange my day|add (this|it)( to my (plan|calendar))?|what'?s my plan|clear area)$/.test(c)) {
    interimTimer = setTimeout(() => execute(t), 350);
  }
}

function onFinal(alts) {
  clearTimeout(interimTimer);
  clearTimeout(pendingTimer);
  const joined = alts.map((a) => (pending ? `${pending} ${a}` : a));
  pending = '';
  const text = pickBest(joined);
  if (DANGLING.test(clean(text))) {
    // "add barley time as my" … wait for "second destination"
    pending = text;
    heardEl.textContent = `${text}…`;
    pendingTimer = setTimeout(() => { const t = pending; pending = ''; execute(t); }, 1800);
    return;
  }
  // Already done from the early (interim) guess?
  if (performance.now() - lastRun.at < 4000 && similarity(norm(text), norm(lastRun.text)) > 0.8) { heardEl.textContent = `“${text}”`; return; }
  execute(text);
}

function execute(text) {
  lastRun = { text, at: performance.now() };
  heardEl.textContent = `“${text}”`;
  runCommand(text);
}

// Of the recognizer's guesses, the one that reads most like a command.
function pickBest(alts) {
  let best = alts[0];
  let bestScore = -1;
  alts.forEach((a, i) => {
    const t = clean(a);
    let s = -i * 0.3; // the first guess is usually best
    if (/^(go to|take me to|fly to|find|show|where|open|select|add|set|remove|delete|zoom|move|pan|arrange|export|what|clear|switch)\b/.test(t)) s += 2;
    if (/google calendar|my plan|destination|stop\b/.test(t)) s += 1;
    const name = t.match(/^(?:go to|take me to|fly to|find|show me|open|select|add|set|remove) (.+?)(?: as .*| to (?:my|the) .*)?$/);
    if (name) {
      if (AREA_WORDS.some(([re]) => re.test(name[1]))) s += 1.5;
      else if (findPlace(name[1], 0.6)) s += 2;
    }
    if (s > bestScore) { bestScore = s; best = a; }
  });
  return best;
}

// Show the full answer; say a short version (long talking blocks listening).
function reply(text, speech = text) {
  replyEl.textContent = text;
  if (!speech) return;
  say(speech);
  lastSpoken = { text: speech, until: performance.now() + speech.split(' ').length * 420 + 1500 };
}

// --- understanding what was said ----------------------------------------------

const ORDINALS = { first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, fourth: 4, '4th': 4, four: 4, fifth: 5, '5th': 5, five: 5, sixth: 6, '6th': 6, six: 6, seventh: 7, '7th': 7, eighth: 8, '8th': 8, ninth: 9, '9th': 9, tenth: 10, '10th': 10 };
const AREA_WORDS = [
  [/flushing|queens/, 'flushing'],
  [/chelsea|flatiron|23rd|twenty third|madison square/, '23rd-st'],
  [/times square|midtown west|hell'?s kitchen|broadway/, 'times-square'],
  [/moma|museum of modern art|midtown east|rockefeller/, 'moma'],
  [/upper east|the met\b|metropolitan|central park/, 'the-met'],
];
const CATEGORY_WORDS = [
  [/restaurant|food|eat|lunch|dinner/, 'food'],
  [/caf[eé]|coffee|dessert|bakery|sweet/, 'cafe'],
  [/market|grocery|groceries|supermarket|fruit|trader joe/, 'market'],
  [/park|garden|green/, 'park'],
  [/museum|gallery|art/, 'museum'],
  [/theater|theatre|show|movie|cinema|broadway/, 'theater'],
  [/shop|store|shopping/, 'shop'],
];

function clean(text) {
  return text.toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\b(please|for me|can you|could you|would you|hey|okay|ok|then|and then|now|um|uh)\b/g, ' ')
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // many ways to say the same thing → one word the commands below know
    .replace(/\b(showing|shows|show up|let me see|can i see|i want to see|i'd like to see|display|list|pull up|bring up)\b/g, 'show')
    .replace(/\b(i want to go to|i'd like to go to|i wanna go to|let's go to|let us go to|going to|go over to|head to|navigate to|bring me to|move to the place)\b/g, 'go to')
    .replace(/^(i want|i'd like) (to )?/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Plural / general words for a kind of place ("restaurants", "parks").
const CATEGORY_PLURALS = [
  [/\b(restaurants|food|places to eat|eateries|dinner places|lunch places)\b/, 'food'],
  [/\b(cafes|cafés|coffee shops|coffee|desserts|bakeries|sweets)\b/, 'cafe'],
  [/\b(markets|supermarkets|grocery stores|groceries|fruit stores|fruit stands)\b/, 'market'],
  [/\b(parks|gardens|green spaces)\b/, 'park'],
  [/\b(museums|galleries|exhibitions)\b/, 'museum'],
  [/\b(theaters|theatres|shows|movies|cinemas|broadway shows)\b/, 'theater'],
  [/\b(shops|stores|shopping)\b/, 'shop'],
  [/\b(everything|all places|all the places|every place|all of them)\b/, 'all'],
];

function runCommand(raw) {
  let t = clean(raw);
  if (!t) return;
  // Several commands in one breath: "export this and add to my google calendar".
  if (/google calendar|export/.test(t)) return doExport(t);

  // Switching how you control it, by voice
  if (/\b(both|hands too|hands and voice|voice and hands|voice and gestures?|gestures? too|use my hands too|hand tracking on)\b/.test(t) && /\b(both|too|and|on)\b/.test(t) && !/^(add|set|go|show)\b/.test(t)) return setControlMode('both');
  if (/^(switch to )?(gesture|hand|hands) (mode|only)|^hands only|^gestures? only/.test(t)) return setControlMode('gesture');
  if (/^(switch to )?voice (mode|only)|^(turn off|stop) (the )?(hands|gestures?|hand tracking)/.test(t)) return setControlMode('voice');

  // Category tabs by voice: "park", "parks", "food tab", "switch to market", "all"
  const tab = t.replace(/^(switch to|show|only|just|filter|open|go to|select|tab|the)( (me|the|only))? /, '').replace(/ (tab|category|places|only|please)$/, '').trim();
  const TAB_WORDS = { food: 'food', restaurant: 'food', restaurants: 'food', cafe: 'cafe', 'café': 'cafe', cafes: 'cafe', coffee: 'cafe', dessert: 'cafe', desserts: 'cafe', 'cafe and dessert': 'cafe', bakery: 'cafe',
    market: 'market', markets: 'market', grocery: 'market', groceries: 'market', supermarket: 'market', park: 'park', parks: 'park', garden: 'park', gardens: 'park',
    museum: 'museum', museums: 'museum', theater: 'theater', theatre: 'theater', theaters: 'theater', theatres: 'theater', shopping: 'shop', shop: 'shop', shops: 'shop', store: 'shop', stores: 'shop', other: 'other', all: 'all', everything: 'all', 'all places': 'all' };
  if (TAB_WORDS[tab] && t.split(' ').length <= 4) return showCategory(TAB_WORDS[tab]);
  if (/zoom in/.test(t)) return doZoom(/a lot|more|much/.test(t) ? 2 : 1);
  if (/zoom out/.test(t)) return doZoom(/a lot|more|much/.test(t) ? -2 : -1);

  const dir = t.match(/\b(?:move|pan|go|shift|scroll)\b(?: the)?(?: map)?(?: to)?(?: the)? (left|right|up|down)\b/);
  if (dir) return doMove(dir[1]);

  if (/arrange|plan my day|organi[sz]e (my )?day|make (my |a )?plan/.test(t)) return doArrange();
  if (/(clear|reset) (the )?(area|map)|whole city|show (the )?(whole|all of) (city|new york)|zoom out all/.test(t)) return clearArea();

  const set = t.match(/^(?:set|add|put|make) (.+?) (?:as|to be|for|at) (?:my |the )?(\w+)(?: (?:destination|stop|place|one))?$/);
  if (set) return setPosition(set[1], set[2]);
  const rem = t.match(/^(?:remove|delete|take out|drop) (.+?)(?: from (?:my |the )?(?:plan|calendar|list|day))?$/);
  if (rem) return removePlace(rem[1]);
  if (/^add$|^add (this|it|that|here)\b|^add (it |this )?(to|into|in) (my |the )?(plan|calendar|list|day|schedule)|^add (this|it) to/.test(t)) return addThis();
  const addNamed = t.match(/^add (.+?)(?: (?:to|into|in) (?:my |the )?(?:plan|calendar|list|day|schedule))?$/);
  if (addNamed) return addNamedPlace(addNamed[1]);
  // (Checked after "add …", so "add to my plan" is never read as "what's my plan".)
  if (/^(what'?s|what is|read|tell me|show)( me)?( in)? (my |the )?(plan|schedule)$|^my plan$/.test(t)) return readPlan();
  if (/^(clear|empty|reset|delete) (my |the |all )?(plan|calendar|day|list|schedule|stops)$/.test(t)) return clearPlan();
  // Saved places are never deleted by voice. A bare "clear" asks which one.
  if (/^(clear|reset|delete|remove)( all| everything)?$/.test(t)) return reply('Clear what? Say “clear my plan” or “clear area”.');

  // "show all the restaurants in Flushing", "parks in Chelsea", "what museums are here"
  const kind = CATEGORY_PLURALS.find(([re]) => re.test(t));
  if (kind && (/\bshow\b|\ball\b|\bwhat\b|\bany\b|\bwhere are\b|\bfind\b/.test(t) || t.split(' ').length <= 4)) {
    const where = AREA_WORDS.find(([re]) => re.test(t));
    return showCategory(kind[1], where ? where[1] : null);
  }

  const show = t.match(/^show(?: me)?(?: the| all(?: the)?)? (.+)$/);
  if (show && /^(everything|all|all places|every place)$/.test(show[1])) return showCategory('all');
  if (show) {
    const cat = CATEGORY_WORDS.find(([re]) => re.test(show[1]) && /s$|food|everything/.test(show[1]));
    if (cat) return showCategory(cat[1]);
  }

  const go = t.match(/^(?:go to|take me to|fly to|find|show me|show|where is|where's|open|select|look for|search for|search) (.+)$/);
  if (go) {
    const area = AREA_WORDS.find(([re]) => re.test(go[1]));
    // "go to flushing" / "go to the met" (just the area's name) → the area
    if (area && go[1].replace(/^the /, '').split(' ').length <= 2) return goArea(area[1]);
    return goPlace(go[1]);
  }
  const area = AREA_WORDS.find(([re]) => re.test(t));
  if (area && t.split(' ').length <= 3) return goArea(area[1]);

  const guess = findPlace(t, 0.6);
  if (guess) { selectPlace(guess.id, true); return reply(`Did you mean ${guess.name}? Say “add this” to add it.`); }
  reply(`Sorry, I didn't get “${raw}”. Try “go to H Mart” or “show restaurants in Flushing”.`);
}

// --- finding a place by (mis-heard) name ---------------------------------------

function norm(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function bigrams(s) {
  const t = ` ${s.replace(/ /g, '')} `;
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) || 0) + 1);
  return out;
}
function similarity(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  let both = 0;
  let total = 0;
  for (const [k, n] of A) { both += Math.min(n, B.get(k) || 0); total += n; }
  for (const n of B.values()) total += n;
  return total ? (2 * both) / total : 0;
}

// Best saved place for what was said. Places in the area on screen win ties.
function findPlace(said, min = 0.5) {
  const q = norm(said.replace(/^(the|a|an|that|this) /, '').replace(/ (restaurant|store|shop|place|please)$/, ''));
  if (!q) return null;
  const qWords = q.split(' ').filter((w) => w.length > 1);
  if (!qWords.length) return null;
  let best = null;
  for (const p of places) {
    const name = norm(p.name);
    if (!name) continue; // names only in Chinese etc. can't be matched by English speech
    const short = norm(p.name.split(/[|(,·-]/)[0]) || name;
    let s = Math.max(similarity(q, name), similarity(q, short));
    const words = name.split(' ').filter((x) => x.length > 1);
    const hits = qWords.filter((w) => words.some((x) => x.startsWith(w) || (x.length > 2 && w.startsWith(x)))).length;
    s = Math.max(s, (hits / qWords.length) * 0.9);
    if (activeArea && areaOf(p) === activeArea) s += 0.08;
    if (!best || s > best.s) best = { p, s };
  }
  // Nothing by name? Try the kind of place ("ramen", "pizza", "museum").
  if (!best || best.s < min) {
    const byType = places
      .filter((p) => (!activeArea || areaOf(p) === activeArea) && norm(`${p.type} ${p.name}`).includes(q))
      .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))[0];
    if (byType) return byType;
    return null;
  }
  return best.p;
}

// "it", "this", and the words "it" is often mis-heard as ("us", "its", "eat"…)
// all mean the place that's open on the map. Very short words never pick a
// random place by name.
const MEANS_THIS = /^(this|it|its|it's|is|us|eat|that|thats|that's|here|there|them|these|those|him|her|one|this one|that one|this place|that place|the place|this restaurant|this store|this shop)$/;
function placeOrThis(said) {
  const s = said.trim().replace(/^(the|a) /, '');
  if (MEANS_THIS.test(s) || s.replace(/[^a-z0-9]/g, '').length < 3) {
    return selectedId ? places.find((p) => p.id === selectedId) : null;
  }
  return findPlace(s, 0.6);
}

// --- doing it -------------------------------------------------------------------

function goArea(id) {
  cardArea = null;
  setArea(id, 'voice');
  const a = AREAS.find((x) => x.id === id);
  const n = places.filter((p) => areaOf(p) === id).length;
  reply(`${a.short}. ${n} places here.`, `${a.short}.`);
}

function goPlace(said) {
  const p = findPlace(said);
  if (!p) return reply(`I couldn't find “${said}”${activeArea ? ' around here' : ''}.`);
  selectPlace(p.id, true);
  reply(`${p.name}${p.type ? ` · ${p.type}` : ''}. Say “add this” to add it.`, p.name.split(/[|(]/)[0].trim());
}

function addThis() {
  const p = selectedId && places.find((x) => x.id === selectedId);
  if (!p) return reply('Pick a place first — say “go to” and its name.');
  if (plan.includes(p.id)) return reply(`${p.name} is already in your plan.`);
  togglePlan(p.id);
  reply(`Added ${p.name}. ${plan.length} stop${plan.length === 1 ? '' : 's'} in your plan.`, 'Added.');
}

function addNamedPlace(said) {
  const p = placeOrThis(said);
  if (!p) {
    const open = selectedId && places.find((x) => x.id === selectedId);
    return reply(open
      ? `I couldn't find “${said}”. To add ${open.name}, say “add this”.`
      : `I couldn't find “${said}”.`);
  }
  selectPlace(p.id, true);
  if (plan.includes(p.id)) return reply(`${p.name} is already in your plan.`);
  togglePlan(p.id);
  reply(`Added ${p.name}. ${plan.length} stop${plan.length === 1 ? '' : 's'} in your plan.`, 'Added.');
}

function setPosition(said, word) {
  const p = placeOrThis(said);
  if (!p) return reply(`I couldn't find “${said}”.`);
  let pos = ORDINALS[word] || (word === 'last' ? plan.length + (plan.includes(p.id) ? 0 : 1) : null) || parseInt(word, 10);
  if (!pos) return reply('Say a position, like first, second or last.');
  if (!plan.includes(p.id)) plan = [...plan, p.id];
  const wanted = pos;
  pos = Math.max(1, Math.min(pos, plan.length));
  movePlanItem(p.id, pos - 1);
  selectPlace(p.id, true);
  if (wanted > pos) return reply(`Added ${p.name}. You have ${plan.length} stop${plan.length === 1 ? '' : 's'} so far, so it's number ${pos} for now.`, 'Added.');
  const nth = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][pos] || `number ${pos}`;
  reply(`${p.name} is now your ${nth} stop.`);
}

function removePlace(said) {
  const p = placeOrThis(said);
  if (!p || !plan.includes(p.id)) return reply(`“${said}” isn't in your plan.`);
  togglePlan(p.id);
  reply(`Removed ${p.name}.`);
}

function showCategory(cat, areaId = null) {
  if (areaId && areaId !== activeArea) { cardArea = null; setArea(areaId, 'voice'); }
  activeCategory = cat;
  renderAll();
  const c = CATEGORIES.find((x) => x.id === cat);
  const here = placesHere().filter((p) => cat === 'all' || p.category === cat);
  const where = activeArea ? ` in ${AREAS.find((a) => a.id === activeArea).short}` : '';
  if (!here.length) return reply(`No ${c ? c.label.toLowerCase() : cat} places saved${where}.`);
  // Examples you can say back: names written in English letters first.
  const sayable = [...here].sort((a, b) => /[a-z]{3}/i.test(b.name) - /[a-z]{3}/i.test(a.name));
  const names = sayable.slice(0, 3).map((p) => p.name.split(/[|(]/)[0].trim()).join(', ');
  const word = { food: 'restaurants', cafe: 'cafés and dessert places', market: 'markets', park: 'parks', museum: 'museums', theater: 'theaters', shop: 'shops', other: 'other places' }[cat] || 'places';
  reply(cat === 'all'
    ? `Showing all ${here.length} places${where}.`
    : `${here.length} ${word}${where}, like ${names}. Say “go to” one of them.`,
  cat === 'all' ? `All ${here.length} places.` : `${here.length} ${word}${where}.`);
}

function doZoom(step) {
  map.easeTo({ zoom: Math.max(9, Math.min(17, map.getZoom() + step)), duration: 600 });
  reply(step > 0 ? 'Zooming in.' : 'Zooming out.', false);
}

// "Move the map to the left" → the map slides left (you see more of the right).
function doMove(dir) {
  const w = map.getContainer().clientWidth / 3;
  const h = map.getContainer().clientHeight / 3;
  const by = { left: [w, 0], right: [-w, 0], up: [0, h], down: [0, -h] }[dir];
  map.panBy(by, { duration: 600 });
  reply(`Moving ${dir}.`, false);
}

function doArrange() {
  if (plan.length < 2) return reply('Add at least two places first.');
  arrangeDay();
  const stops = plan.map((id) => places.find((p) => p.id === id)).filter(Boolean);
  const day = planDay(stops);
  reply(`Done: ${stops.map((p) => p.name).join(' → ')}. Home by ${clock(day.end)}.`, `Done. Home by ${clock(day.end)}.`);
}

function readPlan() {
  const stops = plan.map((id) => places.find((p) => p.id === id)).filter(Boolean);
  if (!stops.length) return reply('Your plan is empty.');
  reply(`${stops.length} stops: ${stops.map((p, i) => `${i + 1}, ${p.name}`).join('. ')}.`);
}

function clearPlan() {
  plan = [];
  saveJson(PLAN_KEY, plan);
  renderAll();
  reply('Plan cleared.');
}

function clearArea() {
  cardArea = null;
  setArea(null, 'voice');
  reply('Whole city.');
}

// Chrome only lets a page download a file or open a new tab right after a
// click — not after something you SAID. So by voice we put up big buttons
// (one click / point each) instead of being blocked.
function doExport(t) {
  if (!plan.length) return reply('Your plan is empty — add some places first.');
  const google = /google/.test(t);
  showExportButtons(google);
  reply(google
    ? 'Ready. Click “📅 Open in Google Calendar”, then press Save.'
    : 'Ready. Click “⬇️ Download calendar file”.', 'Ready. Click the button to finish.');
}

function showExportButtons(google) {
  document.getElementById('export-box')?.remove();
  const box = document.createElement('div');
  box.id = 'export-box';
  const f = buildIcsFile();
  const link = googleCalendarLink();
  box.innerHTML = `
    ${google ? `<a class="ex-main" target="_blank" rel="noopener" href="${link}">📅 Open in Google Calendar</a>` : ''}
    <a class="${google ? 'ex-second' : 'ex-main'}" href="${f.href}" download="${f.name}">⬇️ Download calendar file (.ics)</a>
    <button type="button" class="ex-close" aria-label="Close">✕</button>`;
  box.addEventListener('click', (e) => {
    if (e.target.closest('a')) reply(e.target.closest('a').textContent.includes('Google') ? 'Opened Google Calendar. Press Save there.' : 'Downloaded. Open the file to add it to your calendar.', false);
    if (e.target.closest('.ex-close') || e.target.closest('a')) setTimeout(() => box.remove(), 300);
  });
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 60000);
}
