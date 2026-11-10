// Opening screen: choose how you control the map — 🎙 Voice, ✋ Gesture, or
// 🎙✋ Both at once. Turn any card like a dial: LEFT for Voice, RIGHT for
// Gesture, UPSIDE DOWN for Both, and hold it there until the ring fills
// (or click an option, or say "voice only" / "hands only" / "use both").
// The QR cards keep working in every mode.

const MODE = {
  tiltDeg: 25, // tilt this far from upright to point at an option
  holdMs: 1000, // hold the tilt this long to choose
};

const modeBox = document.createElement('div');
modeBox.id = 'mode-box';
modeBox.hidden = true;
modeBox.innerHTML = `
  <div class="mode-card">
    <h2>How do you want to control the map?</h2>
    <p class="mode-hint">Hold a card under the camera and <b>turn it like a dial</b> — left for Voice, right for Gesture, turn it half-way round for Both — until the ring fills. Or click one.</p>
    <div class="mode-row">
      <button type="button" class="mode-opt" data-mode="voice"><span class="mi">🎙</span><b>Voice</b><small>“Go to H Mart”, “Zoom in”, “Arrange my day”</small></button>
      <div class="dial">
        <svg viewBox="-60 -60 120 120" aria-hidden="true">
          <circle r="52" class="dial-face"/>
          <path class="dial-left" d="M -36.8 -36.8 A 52 52 0 0 0 -52 0"/>
          <path class="dial-right" d="M 36.8 -36.8 A 52 52 0 0 1 52 0"/>
          <path class="dial-both" d="M -26 45 A 52 52 0 0 0 26 45"/>
          <circle r="44" class="dial-ring" pathLength="100"/>
          <g class="dial-needle"><line x1="0" y1="0" x2="0" y2="-40"/><circle r="5"/></g>
        </svg>
        <div class="dial-label">no card</div>
      </div>
      <button type="button" class="mode-opt" data-mode="gesture"><span class="mi">✋</span><b>Gesture</b><small>✋ closer = zoom in, farther = out · ✊ drag · ☝️ point</small></button>
    </div>
    <button type="button" class="mode-opt mode-both" data-mode="both"><span class="mi">🎙✋</span><b>Both</b><small>Talk and use your hands at the same time · turn the card half-way round</small></button>
  </div>`;
document.body.appendChild(modeBox);

const modeBtn = document.createElement('button');
modeBtn.type = 'button';
modeBtn.id = 'mode-btn';
document.querySelector('.bar-right').prepend(modeBtn);
document.getElementById('hand-btn').hidden = true; // the mode button replaces it

let controlMode = (() => { try { return localStorage.getItem('mapControl') || 'gesture'; } catch (e) { return 'gesture'; } })();
let modeHold = null; // { side, since }

function modeChooserOpen() { return !modeBox.hidden; }

function openModeChooser() {
  modeBox.hidden = false;
  modeHold = null;
  dialCard = null; // the next card starts from its own angle
  stopVoice();
  handOn = false;
  setHandBtn();
  requestAnimationFrame(modeLoop);
}

const MODE_LABEL = { voice: '🎙 Voice mode', gesture: '✋ Gesture mode', both: '🎙✋ Voice + Gesture' };

function setControlMode(mode) {
  controlMode = mode;
  try { localStorage.setItem('mapControl', mode); } catch (e) { /* ok */ }
  modeBox.hidden = true;
  modeBtn.textContent = MODE_LABEL[mode];
  modeBtn.title = 'Change how you control the map';
  const voice = mode === 'voice' || mode === 'both';
  const hands = mode === 'gesture' || mode === 'both';
  handOn = hands;
  setHandBtn();
  if (hands) loadHands();
  if (voice) startVoice(); else stopVoice();
  if (voice && typeof replyEl !== 'undefined') replyEl.textContent = `Now: ${MODE_LABEL[mode]}`;
  say({ voice: 'Voice mode. Try: go to Flushing.', gesture: 'Gesture mode.', both: 'Voice and gestures. Talk or use your hands.' }[mode]);
  lastCardsKey = ''; // let a card that's already on the table take effect now
}

modeBtn.addEventListener('click', openModeChooser);
modeBox.querySelectorAll('.mode-opt').forEach((b) => b.addEventListener('click', () => setControlMode(b.dataset.mode)));
modeBtn.textContent = MODE_LABEL[controlMode] || MODE_LABEL.gesture;

// How far the card has been TURNED since you put it down, in degrees
// (+ = clockwise as you see it). It's measured from the card's own starting
// angle, not from "upright": a code can be printed sideways or upside down
// on the card, or the camera can be mounted rotated — so the absolute angle
// says nothing about what you meant. A card first has to sit still for a
// moment (that becomes its zero), then you turn it.
const DIAL = { settleMs: 500, lostMs: 700 };
let dialCard = null; // { text, zero, firstSeen, lastSeen, settled }

function rawCardAngle(now) {
  let best = null;
  let bestText = null;
  for (const [text, e] of cardsSeen) if (now - e.t < 400 && (!best || e.t > best.t)) { best = e; bestText = text; }
  if (!best || !best.pts || best.pts.length < 4) return null;
  const [a, b] = best.pts; // top-left → top-right of the code
  let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (camMirror) deg = -deg;
  return { text: bestText, deg };
}

const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

// null = no card; { settling: true } = card just arrived; else { deg }.
function cardTilt(now) {
  const r = rawCardAngle(now);
  if (!r) {
    if (dialCard && now - dialCard.lastSeen > DIAL.lostMs) dialCard = null;
    return dialCard ? { deg: dialCard.lastDeg ?? 0 } : null;
  }
  if (!dialCard || dialCard.text !== r.text) {
    dialCard = { text: r.text, zero: r.deg, firstSeen: now, lastSeen: now, settled: false, lastDeg: 0 };
  }
  dialCard.lastSeen = now;
  if (!dialCard.settled) {
    // Still being put down: keep following it as the zero.
    if (Math.abs(wrap180(r.deg - dialCard.zero)) > 12) dialCard.firstSeen = now;
    dialCard.zero = r.deg;
    if (now - dialCard.firstSeen < DIAL.settleMs) return { settling: true };
    dialCard.settled = true;
  }
  dialCard.lastDeg = wrap180(r.deg - dialCard.zero);
  return { deg: dialCard.lastDeg };
}

function modeLoop(now) {
  if (modeBox.hidden) return;
  requestAnimationFrame(modeLoop);
  const tilt = cardTilt(now);
  const deg = tilt && !tilt.settling ? tilt.deg : null;
  const needle = modeBox.querySelector('.dial-needle');
  const label = modeBox.querySelector('.dial-label');
  const ring = modeBox.querySelector('.dial-ring');
  const side = deg === null ? null
    : Math.abs(deg) >= 150 ? 'both'
      : deg <= -MODE.tiltDeg ? 'voice'
        : deg >= MODE.tiltDeg ? 'gesture' : null;
  needle.style.transform = `rotate(${deg === null ? 0 : deg}deg)`;
  needle.classList.toggle('off', deg === null);
  modeBox.querySelectorAll('.mode-opt').forEach((b) => b.classList.toggle('aim', b.dataset.mode === side));
  if (!side) {
    modeHold = null;
    ring.style.strokeDasharray = '0 100';
    label.textContent = !tilt ? 'show a card' : tilt.settling ? 'got it — now turn it' : 'turn left, right or all the way round';
    return;
  }
  if (!modeHold || modeHold.side !== side) modeHold = { side, since: now };
  const p = Math.min(1, (now - modeHold.since) / MODE.holdMs);
  ring.style.strokeDasharray = `${(p * 100).toFixed(1)} 100`;
  label.textContent = { voice: '🎙 Voice…', gesture: '✋ Gesture…', both: '🎙✋ Both…' }[side];
  if (p >= 1) setControlMode(side);
}

// Opening: right after the camera starts.
document.getElementById('start').addEventListener('click', () => setTimeout(openModeChooser, 200));
