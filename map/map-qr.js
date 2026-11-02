// Camera + QR cards for the planner (index.html).
// The camera picture (small, top-left) is split in two zones:
//   • DOCK  — the left part of the picture: cards resting there are "parked"
//   • TABLE — the rest: a card here is "out", and the map flies to its area
// The card most recently taken out of the dock wins.

const DOCK_FRACTION = 0.3; // left 30 % of the picture (as you see it)
const CARD_GRACE_MS = 600; // a card can flicker out for this long
const SCAN_WIDTH = 960;

const camVideo = document.getElementById('cam');
const camCanvas = document.getElementById('cam-overlay');
const camCtx = camCanvas.getContext('2d');
const camSelect = document.getElementById('cam-select');
const camMirrorToggle = document.getElementById('cam-mirror');

let camStream = null;
let camMirror = (() => { try { return localStorage.getItem('mapMirror') !== 'off'; } catch (e) { return true; } })();
let scanCanvas = null;
let scanCtx = null;
let scanScale = 1;
let frameNo = 0;
let sweep = [];
let sweepAt = 0;
let tileBuf = new Uint8ClampedArray(0);
const cardsSeen = new Map(); // qr text -> { center (video px), size, t, raw }
let nativeReader = null;
let nativeBusy = false;
let nativeList = null;

(async () => {
  try {
    if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
      nativeReader = new BarcodeDetector({ formats: ['qr_code'] });
    }
  } catch (error) { /* jsQR only */ }
})();

// --- camera -----------------------------------------------------------------

async function startCam(deviceId) {
  camStream?.getTracks().forEach((t) => t.stop());
  const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (deviceId) video.deviceId = { exact: deviceId };
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  } catch (error) {
    if (deviceId) return startCam(null);
    setCamStatus('No camera — you can still click the cards');
    return;
  }
  camVideo.srcObject = camStream;
  const bg = document.getElementById('bg-cam');
  if (bg) { bg.srcObject = camStream; bg.play().catch(() => {}); }
  await camVideo.play().catch(() => {});
  try { localStorage.setItem('mapCamera', camStream.getVideoTracks()[0].getSettings().deviceId || ''); } catch (error) { /* ok */ }
  await fillCamList();
}

async function fillCamList() {
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const active = camStream?.getVideoTracks()[0]?.getSettings().deviceId;
  const phoneOn = typeof phoneActive === 'function' && phoneActive();
  camSelect.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}"${!phoneOn && c.deviceId === active ? ' selected' : ''}>${escapeText(c.label || `Camera ${i + 1}`)}</option>`).join('')
    + `<option value="__phone"${phoneOn ? ' selected' : ''}>📱 Phone camera…</option>`;
  camSelect.hidden = false;
}

camSelect.addEventListener('change', () => {
  if (camSelect.value === '__phone') { openPhoneCam(); return; }
  if (typeof stopPhoneCam === 'function') stopPhoneCam();
  startCam(camSelect.value);
});

// Use a camera stream that came from somewhere else (the phone).
function useStream(stream) {
  camStream?.getTracks().forEach((t) => { if (!stream.getTracks().includes(t)) t.stop(); });
  camStream = stream;
  camVideo.srcObject = stream;
  const bg = document.getElementById('bg-cam');
  if (bg) { bg.srcObject = stream; bg.play().catch(() => {}); }
  camVideo.play().catch(() => {});
}
camMirrorToggle.checked = camMirror;
document.body.classList.toggle('cam-mirror', camMirror);
camMirrorToggle.addEventListener('change', () => {
  camMirror = camMirrorToggle.checked;
  document.body.classList.toggle('cam-mirror', camMirror);
  try { localStorage.setItem('mapMirror', camMirror ? 'on' : 'off'); } catch (e) { /* ok */ }
});
navigator.mediaDevices?.addEventListener?.('devicechange', fillCamList);

function preferredCamera() {
  try { return localStorage.getItem('mapCamera') || null; } catch (error) { return null; }
}

// --- reading cards ----------------------------------------------------------

function setUpScan() {
  scanScale = Math.min(1, SCAN_WIDTH / Math.max(camVideo.videoWidth, camVideo.videoHeight));
  scanCanvas = document.createElement('canvas');
  scanCanvas.width = Math.round(camVideo.videoWidth * scanScale);
  scanCanvas.height = Math.round(camVideo.videoHeight * scanScale);
  scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
  sweep = [];
  for (const size of [Math.round(scanCanvas.height * 0.42), Math.round(scanCanvas.height * 0.8)]) {
    const step = Math.round(size / 2);
    for (let y = 0; y <= scanCanvas.height - size; y += step) {
      for (let x = 0; x <= scanCanvas.width - size; x += step) sweep.push({ x, y, size });
      sweep.push({ x: scanCanvas.width - size, y, size });
    }
  }
}

function readWindow(frame, w) {
  const need = w.size * w.size * 4;
  if (tileBuf.length !== need) tileBuf = new Uint8ClampedArray(need);
  for (let row = 0; row < w.size; row++) {
    const start = ((w.y + row) * frame.width + w.x) * 4;
    tileBuf.set(frame.data.subarray(start, start + w.size * 4), row * w.size * 4);
  }
  const qr = jsQR(tileBuf, w.size, w.size, { inversionAttempts: 'dontInvert' });
  if (!qr) return null;
  const pts = [qr.location.topLeftCorner, qr.location.topRightCorner, qr.location.bottomRightCorner, qr.location.bottomLeftCorner]
    .map((p) => ({ x: (p.x + w.x) / scanScale, y: (p.y + w.y) / scanScale }));
  return { text: qr.data, pts };
}

function scanFrame(now) {
  if (!camVideo.videoWidth) return [];
  if (!scanCanvas || scanCanvas.width !== Math.round(camVideo.videoWidth * scanScale)) setUpScan();
  frameNo++;
  const found = [];
  if (nativeReader && !nativeBusy) {
    nativeBusy = true;
    nativeReader.detect(camVideo).then((codes) => { nativeList = codes; }).catch(() => {}).finally(() => { nativeBusy = false; });
  }
  if (nativeList) {
    for (const c of nativeList) if (c.cornerPoints?.length === 4) found.push({ text: c.rawValue, pts: c.cornerPoints });
    nativeList = null;
  }
  scanCtx.drawImage(camVideo, 0, 0, scanCanvas.width, scanCanvas.height);
  const frame = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
  const t0 = performance.now();
  // Known cards first, in a snug window (neighbours confuse the reader).
  for (const e of cardsSeen.values()) {
    if (now - e.t > CARD_GRACE_MS) continue;
    const size = Math.min(scanCanvas.width, scanCanvas.height, Math.max(80, Math.round(e.size * scanScale * 1.6)));
    const w = { x: clamp(Math.round(e.center.x * scanScale - size / 2), 0, scanCanvas.width - size), y: clamp(Math.round(e.center.y * scanScale - size / 2), 0, scanCanvas.height - size), size };
    const hit = readWindow(frame, w);
    if (hit) found.push(hit);
  }
  // Then sweep for new cards, a few milliseconds per frame.
  let n = 0;
  while (n < sweep.length && (n === 0 || performance.now() - t0 < 16)) {
    const hit = readWindow(frame, sweep[sweepAt]);
    sweepAt = (sweepAt + 1) % sweep.length;
    n++;
    if (hit) found.push(hit);
  }
  return found;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Cards now visible: role -> { inDock, x, y (0–1 of the picture as shown) }
function cardsInView(now) {
  const out = new Map();
  for (const [text, e] of cardsSeen) {
    if (now - e.t > CARD_GRACE_MS) continue;
    const role = QR_ROLES[qrKey(text)];
    if (!role || !role.startsWith('dest:')) continue;
    let x = e.center.x / camVideo.videoWidth;
    if (camMirror) x = 1 - x;
    out.set(role.slice(5), { inDock: x < DOCK_FRACTION, x, y: e.center.y / camVideo.videoHeight, pts: e.pts });
  }
  return out;
}

// --- the little camera picture ----------------------------------------------

function drawCam(cards) {
  const w = camCanvas.clientWidth;
  const h = camCanvas.clientHeight;
  if (camCanvas.width !== w * devicePixelRatio) {
    camCanvas.width = w * devicePixelRatio;
    camCanvas.height = h * devicePixelRatio;
  }
  camCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  camCtx.clearRect(0, 0, w, h);
  // Dock zone
  camCtx.fillStyle = 'rgba(255,255,255,0.08)';
  camCtx.fillRect(0, 0, w * DOCK_FRACTION, h);
  camCtx.strokeStyle = 'rgba(255,255,255,0.7)';
  camCtx.setLineDash([5, 5]);
  camCtx.beginPath();
  camCtx.moveTo(w * DOCK_FRACTION, 0);
  camCtx.lineTo(w * DOCK_FRACTION, h);
  camCtx.stroke();
  camCtx.setLineDash([]);
  camCtx.fillStyle = 'rgba(255,255,255,0.8)';
  camCtx.font = '600 10px system-ui, sans-serif';
  camCtx.fillText('DOCK', 6, 14);
  camCtx.fillText('TABLE', w * DOCK_FRACTION + 6, 14);
  for (const [id, c] of cards) {
    const a = AREAS.find((x) => x.id === id);
    const px = c.x * w;
    const py = c.y * h;
    camCtx.strokeStyle = c.inDock ? 'rgba(255,255,255,0.5)' : '#fff';
    camCtx.lineWidth = c.inDock ? 1.5 : 2.5;
    camCtx.strokeRect(px - 16, py - 16, 32, 32);
    camCtx.fillStyle = '#fff';
    camCtx.fillText(a ? a.short : id, px - 16, py - 20);
  }
  if (typeof drawHandOnCam === 'function') drawHandOnCam(camCtx, w, h);
}

function setCamStatus(text) {
  document.getElementById('cam-status').textContent = text;
}

function escapeText(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
