// Hand gestures for the planner (index.html), from the same camera as the
// QR cards. Uses MediaPipe Hand Landmarker (runs in the browser).
//
//   Open hand (✋)  — hold it: the map zooms IN.
//   Peace sign (✌️) — hold it: the map zooms OUT.
//   Fist (✊)       — grab the map: move your fist to drag it around.
//   Point (☝️)      — only the index finger out: a dot follows your fingertip.
//                    Hold it on a place (or a button) for a moment to open it.
//
// The map zooms around its middle. The ✋ button turns gestures on/off.

const HANDS = {
  version: '0.10.21',
  model: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  everyMs: 50, // run the hand model ~20×/s, leaves time for the QR reader
  armMs: 1000, // hold ✋ / ✌️ / ✊ still this long before it starts working
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

async function loadHands() {
  if (handModel || handLoading) return;
  handLoading = true;
  handState.textContent = 'loading…';
  try {
    const base = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${HANDS.version}`;
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
  handLoading = false;
}

camVideo.addEventListener('playing', () => { if (handOn) loadHands(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) lastHandVideoTime = -1; });
requestAnimationFrame(handLoop);

function handLoop(now) {
  requestAnimationFrame(handLoop);
  if (!handOn || !handModel || camVideo.readyState < 2) return;
  if (now - lastHandRun < HANDS.everyMs || camVideo.currentTime === lastHandVideoTime) return;
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
  handFrame(lm ? lm.map((p) => ({ x: p.x * camVideo.videoWidth, y: p.y * camVideo.videoHeight })) : null, now);
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

function handFrame(lm, now) {
  if (!lm) {
    poseCandidate = pose = 'none';
    poseCount = 0;
    disarm();
    hideDot();
    handLm = null;
    handState.textContent = 'no hand seen';
    return;
  }
  handLm = lm;
  handSeenAt = now;
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
      else { zoomPose = armPose; zoomSince = now; }
    }
  }
  showArmRing(at, now);

  const label = { open: '✋ zoom in', peace: '✌️ zoom out', fist: '✊ drag' };
  handState.textContent = armPose ? (armed ? label[armPose] : `${POSE_ICON[armPose]} hold still…`) : pose === 'point' ? '☝️ point' : '· hand seen';

  if (armed && armPose === 'fist' && pose === 'fist') dragWith(at);

  if (pose === 'point') pointAt(toScreen(lm[8]), now);
  else hideDot();
}

function disarm() {
  armPose = null;
  armed = false;
  zoomPose = null;
  grabAt = null;
  armRing.hidden = true;
}

function showArmRing(at, now) {
  if (!armPose) { armRing.hidden = true; return; }
  armRing.hidden = false;
  armRing.textContent = POSE_ICON[armPose];
  armRing.classList.toggle('armed', armed);
  armRing.style.setProperty('--p', armed ? 1 : Math.min(1, (now - armSince) / HANDS.armMs).toFixed(3));
  armRing.style.transform = `translate(${at.x}px, ${at.y}px)`;
}

// --- dragging with a fist ------------------------------------------------------

let grabAt = null; // smoothed screen point of the fist while grabbing
function dragWith(p) {
  if (!grabAt) { grabAt = p; return; } // first fist frame: just hold on
  const next = { x: grabAt.x + (p.x - grabAt.x) * 0.6, y: grabAt.y + (p.y - grabAt.y) * 0.6 };
  const dx = next.x - grabAt.x;
  const dy = next.y - grabAt.y;
  if (Math.hypot(dx, dy) < 1.5) return; // ignore tiny shakes
  grabAt = next;
  if (!map.isEasing()) map.panBy([-dx, -dy], { duration: 0 });
}

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
  const z = Math.max(HANDS.minZoom, Math.min(HANDS.maxZoom, map.getZoom() + (zoomPose === 'open' ? 1 : -1) * HANDS.zoomPerSec * dt));
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
