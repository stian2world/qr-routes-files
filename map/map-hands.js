// Hand gestures for the planner (index.html), from the same camera as the
// QR cards. Uses MediaPipe Hand Landmarker (runs in the browser).
//
//   Open hand (✋)  — DEPTH ZOOM: hold it still until the ring fills (that
//                    spot is the middle), then move your hand CLOSER to the
//                    camera to zoom in, FARTHER away to zoom out. Back to the
//                    middle = stop. (No depth camera needed: the hand looks
//                    bigger when it's closer.)
//   Peace sign (✌️) — hold it: the map zooms OUT (a shortcut).
//   Fist (✊)       — grab the map: move your fist to drag it around.
//   Point (☝️)      — only the index finger out: a dot follows your fingertip.
//                    Hold it on a place (or a button) for a moment to open it.
//
// The map zooms around its middle. The ✋ button turns gestures on/off.

const HANDS = {
  version: '0.10.21',
  model: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  everyMs: 50, // run the hand model ~20×/s, leaves time for the QR reader
  armMs: 600, // hold ✋ / ✌️ / ✊ still this long before it starts working
  armWobblePx: 60, // moving more than this while holding restarts the wait
  zoomDelayMs: 0, // extra wait after arming
  zoomPerSec: 0.8, // zoom levels per second while held
  minZoom: 9,
  maxZoom: 17,
  dwellMs: 800, // hold the pointing finger on something this long to tap it
  holdFrames: 2, // a pose must show this many frames in a row to count
};

const handBtn = document.getElementById('hand-btn');
const handState = document.getElementById('hand-state');
const handDot = document.createElement('div');
handDot.id = 'hand-dot';
handDot.hidden = true;
document.body.appendChild(handDot);

let handOn = (() => { try { return localStorage.getItem('mapHands') !== 'off'; } catch (e) { return true; } })();
let handModel = null;
let handLoading = false;
let handErrors = 0;
let lastHandRun = 0;
let lastHandVideoTime = -1;
let pose = 'none'; // steady pose
let poseCandidate = 'none';
let poseCount = 0;
let poseSince = 0;
let handLm = null; // latest hand points (video px), drawn on the camera picture
let dotPos = null;
let hoverEl = null;
let hoverSince = 0;
let tappedEl = null;

function setHandBtn() {
  handBtn.classList.toggle('off', !handOn);
  handBtn.setAttribute('aria-pressed', String(handOn));
  if (!handOn) { handState.textContent = ''; hideDot(); }
}
setHandBtn();
handBtn.addEventListener('click', () => {
  handOn = !handOn;
  try { localStorage.setItem('mapHands', handOn ? 'on' : 'off'); } catch (e) { /* ok */ }
  setHandBtn();
  if (handOn) loadHands();
});

// The hand model runs in a Web Worker (a separate thread), so the map, the
// QR reader and the page never wait for it — that was the main lag. If the
// worker can't start, it falls back to running on the page like before.
const HAND_WORKER_SRC = `
var exports = {}; var module = { exports: exports };
var lm = null;
onmessage = async function (e) {
  var d = e.data;
  if (d.type === 'init') {
    try {
      importScripts(d.base + '/vision_bundle.cjs');
      var mp = module.exports;
      var files = await mp.FilesetResolver.forVisionTasks(d.base + '/wasm');
      var opts = function (delegate) { return { baseOptions: { modelAssetPath: d.model, delegate: delegate }, runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.3, minHandPresenceConfidence: 0.3, minTrackingConfidence: 0.3 }; };
      try { lm = await mp.HandLandmarker.createFromOptions(files, opts('CPU')); }
      catch (err) { lm = await mp.HandLandmarker.createFromOptions(files, opts('GPU')); }
      postMessage({ type: 'ready' });
    } catch (err) { postMessage({ type: 'fail', message: String(err && err.message || err) }); }
    return;
  }
  if (d.type === 'frame') {
    var t0 = performance.now();
    var hand = null;
    try { var r = lm.detectForVideo(d.bitmap, d.ts); hand = r.landmarks && r.landmarks[0] || null; }
    catch (err) { postMessage({ type: 'error', message: String(err && err.message || err) }); }
    d.bitmap.close();
    postMessage({ type: 'result', hand: hand, ms: performance.now() - t0, sentAt: d.sentAt });
  }
};`;

let handWorker = null;
let workerReady = false;
let workerBusy = false;
let handMs = 0; // model time per frame (ms), shown as fps
let handFps = 0;
let lastResultAt = 0;

async function loadHands() {
  if (handModel || handLoading || workerReady) return;
  handLoading = true;
  handState.textContent = 'loading…';
  const base = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${HANDS.version}`;
  const ok = await startHandWorker(base);
  if (!ok) await loadHandsOnPage(base);
  handLoading = false;
}

function startHandWorker(base) {
  return new Promise((resolve) => {
    try {
      handWorker = new Worker(URL.createObjectURL(new Blob([HAND_WORKER_SRC], { type: 'text/javascript' })));
    } catch (e) { resolve(false); return; }
    const timer = setTimeout(() => { stopWorker(); resolve(false); }, 45000);
    handWorker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'ready') { clearTimeout(timer); workerReady = true; handState.textContent = 'hands ready — show your hand'; resolve(true); }
      else if (d.type === 'fail') { clearTimeout(timer); console.warn('Hand worker failed', d.message); stopWorker(); resolve(false); }
      else if (d.type === 'result') onHandResult(d);
      else if (d.type === 'error') { workerBusy = false; if (++handErrors > 10) { stopWorker(); handLoading = false; loadHands(); } }
    };
    handWorker.onerror = () => { clearTimeout(timer); stopWorker(); resolve(false); };
    handWorker.postMessage({ type: 'init', base, model: HANDS.model });
  });
}

function stopWorker() {
  try { handWorker?.terminate(); } catch (e) { /* gone */ }
  handWorker = null;
  workerReady = false;
  workerBusy = false;
}

// How many hand readings per second (shown next to the gesture).
function fpsText() {
  return handFps ? ` · ${Math.round(handFps)} fps` : '';
}

function onHandResult(d) {
  workerBusy = false;
  handErrors = 0;
  const now = performance.now();
  handMs = handMs ? handMs * 0.8 + d.ms * 0.2 : d.ms;
  if (lastResultAt) handFps = handFps ? handFps * 0.8 + (1000 / (now - lastResultAt)) * 0.2 : 1000 / (now - lastResultAt);
  lastResultAt = now;
  handFrame(d.hand ? d.hand.map((p) => ({ x: p.x * camVideo.videoWidth, y: p.y * camVideo.videoHeight })) : null, now);
}

// Fallback: the model on the page itself (slower: it pauses the page).
async function loadHandsOnPage(base) {
  try {
    const { FilesetResolver, HandLandmarker } = await import(`${base}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${base}/wasm`);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: HANDS.model, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.3,
      minHandPresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
    // CPU is steadier next to the blurred glass panels (GPU could white-screen).
    try { handModel = await HandLandmarker.createFromOptions(files, options('CPU')); }
    catch (e) { handModel = await HandLandmarker.createFromOptions(files, options('GPU')); }
    handState.textContent = 'hands ready — show your hand';
  } catch (error) {
    console.warn('Hand tracking unavailable', error);
    handState.textContent = '⚠️ hand model could not load';
  }
}

camVideo.addEventListener('playing', () => { if (handOn) loadHands(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) lastHandVideoTime = -1; });
requestAnimationFrame(handLoop);

function handLoop(now) {
  requestAnimationFrame(handLoop);
  if (!handOn || camVideo.readyState < 2 || camVideo.currentTime === lastHandVideoTime) return;
  if (workerReady) {
    // One frame at a time: send the newest frame as soon as the last answer is back.
    if (workerBusy) return;
    workerBusy = true;
    lastHandVideoTime = camVideo.currentTime;
    const w = camVideo.videoWidth;
    const h = camVideo.videoHeight;
    const scale = Math.min(1, 640 / Math.max(w, h)); // the model works at ~224 px anyway
    createImageBitmap(camVideo, { resizeWidth: Math.round(w * scale), resizeHeight: Math.round(h * scale) })
      .then((bitmap) => handWorker.postMessage({ type: 'frame', bitmap, ts: now, sentAt: performance.now() }, [bitmap]))
      .catch(() => { workerBusy = false; });
    return;
  }
  if (!handModel || now - lastHandRun < HANDS.everyMs) return;
  lastHandRun = now;
  lastHandVideoTime = camVideo.currentTime;
  let result;
  try {
    result = handModel.detectForVideo(camVideo, now);
    handErrors = 0;
  } catch (error) {
    if (++handErrors > 10) { try { handModel.close(); } catch (e) { /* gone */ } handModel = null; loadHands(); }
    return;
  }
  const lm = result.landmarks && result.landmarks[0];
  handFrame(lm ? lm.map((p) => ({ x: p.x * camVideo.videoWidth, y: p.y * camVideo.videoHeight })) : null, performance.now());
}

// --- reading the hand shape ----------------------------------------------------

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// lm: 21 points in video pixels. Returns 'open' | 'peace' | 'fist' | 'point' | 'other'.
function classifyHand(lm) {
  const wrist = lm[0];
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  // >1 = fingertip farther from the wrist than its middle knuckle (straight),
  // <1 = folded back. Measured on your videos: open ≈ 1.25–1.5, fist ≈ 0.6–0.9.
  const r = tips.map((t, i) => dist(lm[t], wrist) / (dist(lm[pips[i]], wrist) || 1));
  const straight = r.filter((v) => v > 1.12).length;
  const folded = r.filter((v) => v < 1.0).length;
  if (r[0] > 1.12 && r[1] > 1.12 && r[2] < 1.05 && r[3] < 1.05) return 'peace';
  if (r[0] > 1.12 && r[1] < 1.05 && r[2] < 1.05 && r[3] < 1.05) return 'point';
  if (straight >= 3 && folded === 0) return 'open';
  if (folded >= 3 && r[0] < 1.08) return 'fist';
  return 'other';
}

// Arming: ✋ / ✌️ / ✊ only start working after you hold them still for
// HANDS.armMs — a ring fills up next to your hand while you wait. An
// accidental open hand or fist doesn't last that long, so nothing happens.
let armPose = null; // 'open' | 'peace' | 'fist' being held
let armSince = 0;
let armAnchor = null; // where the hand was when the hold began
let armed = false;
let lastActionAt = 0;
const armRing = document.createElement('div');
armRing.id = 'hand-arm';
armRing.hidden = true;
document.body.appendChild(armRing);
const POSE_ICON = { open: '✋', peace: '✌️', fist: '✊' };

// --- depth zoom: how big the hand looks (closer = bigger) -----------------------
const DEPTH = {
  deadZone: 0.08, // ±8 % around the middle does nothing (hands shake)
  fullAt: 0.35, // 35 % bigger/smaller = full speed
  maxPerSec: 1.6, // zoom levels per second at full speed
};
let handSize = 0; // smoothed palm size (video px)
let depthBase = 0; // palm size when the ring filled = "the middle"
let depthSpeed = 0; // -1 … +1 right now

// Palm size from points that don't move when fingers bend.
function palmSize(lm) {
  return (dist(lm[0], lm[5]) + dist(lm[0], lm[17]) + dist(lm[5], lm[17]) + dist(lm[0], lm[9])) / 4;
}
function depthFromSize() {
  if (!depthBase || !handSize) return 0;
  const x = Math.log(handSize / depthBase); // > 0 closer, < 0 farther
  const a = Math.abs(x);
  if (a < DEPTH.deadZone) return 0;
  return Math.sign(x) * Math.min(1, (a - DEPTH.deadZone) / (DEPTH.fullAt - DEPTH.deadZone));
}

function handFrame(lm, now) {
  if (!lm) {
    poseCandidate = pose = 'none';
    poseCount = 0;
    handSize = 0;
    disarm();
    hideDot();
    handLm = null;
    handState.textContent = 'no hand seen' + fpsText();
    return;
  }
  handLm = lm;
  handSeenAt = now;
  const ps = palmSize(lm);
  handSize = handSize ? handSize * 0.5 + ps * 0.5 : ps;
  if (armed && armPose === 'open') depthSpeed = depthFromSize();
  const seen = classifyHand(lm);
  poseCount = seen === poseCandidate ? poseCount + 1 : 1;
  poseCandidate = seen;
  if (poseCount >= HANDS.holdFrames && seen !== pose) { pose = seen; poseSince = now; }

  const at = toScreen(lm[9]);
  const action = POSE_ICON[pose] ? pose : null;
  if (action) lastActionAt = now;
  if (action !== armPose) {
    // A short in-between frame while already working doesn't stop it.
    const blip = !action && armed && pose === 'other' && now - lastActionAt < 600;
    if (!blip) {
      disarm();
      if (action) { armPose = action; armSince = now; armAnchor = at; }
    }
  }
  if (armPose && !armed) {
    // Must stay roughly still while the ring fills.
    if (Math.hypot(at.x - armAnchor.x, at.y - armAnchor.y) > HANDS.armWobblePx) { armSince = now; armAnchor = at; }
    if (now - armSince >= HANDS.armMs) {
      armed = true;
      if (armPose === 'fist') grabAt = at;
      else { zoomPose = armPose; zoomSince = now; if (armPose === 'open') depthBase = handSize; }
    }
  }
  showArmRing(at, now);

  const depthLabel = depthSpeed > 0 ? '✋ closer → zooming in' : depthSpeed < 0 ? '✋ farther → zooming out' : '✋ move closer / farther';
  const label = { open: depthLabel, peace: '✌️ zoom out', fist: '✊ drag' };
  handState.textContent = (armPose ? (armed ? label[armPose] : `${POSE_ICON[armPose]} hold still…`) : pose === 'point' ? '☝️ point' : '· hand seen') + fpsText();

  // A moving fist often looks blurry for a frame or two ("other"): keep dragging.
  if (armed && armPose === 'fist' && (pose === 'fist' || pose === 'other')) dragWith(at);

  if (pose === 'point') pointAt(toScreen(lm[8]), now);
  else hideDot();
}

function disarm() {
  armPose = null;
  armed = false;
  zoomPose = null;
  depthBase = 0;
  depthSpeed = 0;
  grabAt = null;
  dragOwed = { x: 0, y: 0 };
  armRing.hidden = true;
}

function showArmRing(at, now) {
  if (!armPose) { armRing.hidden = true; return; }
  armRing.hidden = false;
  if (armRing.dataset.icon !== armPose) {
    armRing.dataset.icon = armPose;
    armRing.innerHTML = `<i class="ar-base"></i><i class="ar-now"></i><span class="ar-icon">${POSE_ICON[armPose]}</span>`;
  }
  armRing.classList.toggle('armed', armed);
  armRing.style.setProperty('--p', armed ? 1 : Math.min(1, (now - armSince) / HANDS.armMs).toFixed(3));
  // Depth gauge: dashed circle = the middle, solid circle = your hand now.
  const depth = armed && armPose === 'open' && depthBase;
  armRing.classList.toggle('depth', !!depth);
  armRing.classList.toggle('in', depth && depthSpeed > 0);
  armRing.classList.toggle('out', depth && depthSpeed < 0);
  if (depth) armRing.style.setProperty('--s', Math.max(0.5, Math.min(1.7, handSize / depthBase)).toFixed(3));
  armRing.style.transform = `translate(${at.x}px, ${at.y}px)`;
}

// --- dragging with a fist ------------------------------------------------------

// The fist position comes ~15–30 times a second; the map is moved every
// screen frame (60×/s) towards where the fist is, so it glides instead of
// jumping, and fast moves aren't smoothed away (only small shakes are).
let grabAt = null; // filtered screen point of the fist while grabbing
let dragOwed = { x: 0, y: 0 }; // pixels the map still has to move
const DRAG_GAIN = 1.4; // map moves a bit more than the hand, so you don't run out of reach
function dragWith(p) {
  if (!grabAt) { grabAt = p; return; } // first fist frame: just hold on
  const dx = p.x - grabAt.x;
  const dy = p.y - grabAt.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return; // tiny shake
  const follow = Math.min(1, 0.35 + dist / 40); // fast move → follow fully at once
  grabAt = { x: grabAt.x + dx * follow, y: grabAt.y + dy * follow };
  dragOwed.x += dx * follow * DRAG_GAIN;
  dragOwed.y += dy * follow * DRAG_GAIN;
}
requestAnimationFrame(function dragLoop() {
  requestAnimationFrame(dragLoop);
  if (Math.abs(dragOwed.x) < 0.3 && Math.abs(dragOwed.y) < 0.3) return;
  if (map.isEasing()) { dragOwed = { x: 0, y: 0 }; return; }
  const step = { x: dragOwed.x * 0.45, y: dragOwed.y * 0.45 };
  dragOwed.x -= step.x;
  dragOwed.y -= step.y;
  map.panBy([-step.x, -step.y], { duration: 0, animate: false });
});

// Zooming runs every screen frame (smooth), not only when the hand model
// answers, and always around the middle of the map.
let zoomPose = null;
let zoomSince = 0;
let otherSince = 0;
let handSeenAt = -1e9;
let lastZoomFrame = 0;
requestAnimationFrame(function zoomLoop(now) {
  requestAnimationFrame(zoomLoop);
  const dt = Math.min(0.1, (now - lastZoomFrame) / 1000);
  lastZoomFrame = now;
  if (!handOn || !zoomPose || now - handSeenAt > 400 || now - zoomSince < HANDS.zoomDelayMs) return;
  if (map.isEasing()) return; // let a card's fly-to finish first
  const speed = zoomPose === 'open' ? depthSpeed * DEPTH.maxPerSec : -HANDS.zoomPerSec;
  if (!speed) return;
  const z = Math.max(HANDS.minZoom, Math.min(HANDS.maxZoom, map.getZoom() + speed * dt));
  if (z !== map.getZoom()) map.setZoom(z);
});

// Video pixel -> screen pixel, matching the full-screen camera background
// (object-fit: cover, mirrored when "Mirror" is on).
function toScreen(p) {
  const vw = camVideo.videoWidth;
  const vh = camVideo.videoHeight;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const s = Math.max(W / vw, H / vh);
  let x = p.x * s + (W - vw * s) / 2;
  const y = p.y * s + (H - vh * s) / 2;
  if (camMirror) x = W - x;
  return { x, y };
}

// --- pointing -------------------------------------------------------------------

function pointAt(p, now) {
  dotPos = dotPos ? { x: dotPos.x + (p.x - dotPos.x) * 0.5, y: dotPos.y + (p.y - dotPos.y) * 0.5 } : p;
  handDot.hidden = false;
  handDot.style.transform = `translate(${dotPos.x}px, ${dotPos.y}px)`;
  const target = tappableAt(dotPos.x, dotPos.y);
  if (target !== hoverEl) {
    hoverEl?.classList.remove('hand-hover');
    hoverEl = target;
    hoverEl?.classList.add('hand-hover');
    hoverSince = now;
    if (target !== tappedEl) tappedEl = null;
  }
  let progress = 0;
  if (hoverEl && hoverEl !== tappedEl) {
    progress = Math.min(1, (now - hoverSince) / HANDS.dwellMs);
    if (progress >= 1) {
      hoverEl.click();
      tappedEl = hoverEl;
      progress = 0;
    }
  }
  handDot.style.setProperty('--p', progress.toFixed(3));
  handDot.classList.toggle('over', !!hoverEl);
}

function tappableAt(x, y) {
  handDot.style.display = 'none';
  const hit = document.elementFromPoint(x, y);
  handDot.style.display = '';
  const t = hit && hit.closest('.place-pin, button, [data-area]');
  return t && !t.disabled ? t : null;
}

function hideDot() {
  handDot.hidden = true;
  hoverEl?.classList.remove('hand-hover');
  hoverEl = null;
  tappedEl = null;
  dotPos = null;
}

// Draw the hand on the small camera picture so you can see it's tracked.
const HAND_BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawHandOnCam(ctx, w, h) {
  if (!handLm || !camVideo.videoWidth) return;
  const pt = (p) => {
    let x = p.x / camVideo.videoWidth;
    if (camMirror) x = 1 - x;
    return [x * w, (p.y / camVideo.videoHeight) * h];
  };
  ctx.strokeStyle = pose === 'open' ? '#7CFC9A' : pose === 'peace' ? '#FFD54F' : pose === 'fist' ? '#FF8A80' : pose === 'point' ? '#80D8FF' : 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of HAND_BONES) { ctx.moveTo(...pt(handLm[a])); ctx.lineTo(...pt(handLm[b])); }
  ctx.stroke();
}
