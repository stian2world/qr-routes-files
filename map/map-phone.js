// Phone as the camera (no app, no Apple ID): pick "📱 Phone camera…" in the
// camera menu, open phone.html on the phone (scan the QR code shown here),
// type / keep the 4-digit code, press Connect. The phone's picture is sent
// to this page over WebRTC (PeerJS's free connection service helps the two
// find each other; the video itself goes straight between them).

// Where the phone opens phone.html. When this page runs from a web address
// it's the same folder; when index.html was opened as a file it's the site.
const PHONE_PAGE_URL = /^https?:/.test(location.protocol)
  ? new URL('phone.html', location.href).href
  : 'https://stian2world.github.io/qrcode-tracking/phone.html';

let phonePeer = null;
let phoneStream = null;
let phoneCode = (() => {
  try {
    const saved = localStorage.getItem('phoneCamCode');
    if (/^\d{4}$/.test(saved || '')) return saved;
  } catch (e) { /* ok */ }
  const code = String(Math.floor(1000 + Math.random() * 9000));
  try { localStorage.setItem('phoneCamCode', code); } catch (e) { /* ok */ }
  return code;
})();

const phoneBox = document.createElement('div');
phoneBox.id = 'phone-box';
phoneBox.hidden = true;
phoneBox.innerHTML = `
  <div class="phone-card">
    <h2>📱 Use your phone as the camera</h2>
    <ol>
      <li>On the phone, scan this QR code (or open <b class="ph-url"></b>).</li>
      <li>Check the code is <b class="ph-code"></b> and press <b>Connect</b>.</li>
      <li>Allow the camera, then point the phone at the table.</li>
    </ol>
    <div class="ph-qr"></div>
    <div class="ph-big"></div>
    <div class="ph-status">Waiting for the phone…</div>
    <div class="ph-actions"><button type="button" class="ph-close">Done</button></div>
  </div>`;
document.body.appendChild(phoneBox);
const phoneStatus = phoneBox.querySelector('.ph-status');

function phoneActive() {
  return !!phoneStream && phoneStream.getVideoTracks().some((t) => t.readyState === 'live');
}

function setPhoneStatus(text, kind) {
  phoneStatus.textContent = text;
  phoneStatus.className = 'ph-status' + (kind ? ` ${kind}` : '');
}

function openPhoneCam() {
  const link = `${PHONE_PAGE_URL}?code=${phoneCode}`;
  phoneBox.querySelector('.ph-url').textContent = PHONE_PAGE_URL.replace(/^https:\/\//, '');
  phoneBox.querySelector('.ph-code').textContent = phoneCode;
  phoneBox.querySelector('.ph-big').textContent = phoneCode;
  const qrBox = phoneBox.querySelector('.ph-qr');
  qrBox.innerHTML = '';
  loadScriptOnce('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js', 'qrcode').then((qrcode) => {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    qrBox.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }).catch(() => { qrBox.textContent = link; });
  phoneBox.hidden = false;
  if (phoneActive()) setPhoneStatus('✓ Phone connected', 'ok');
  startPhonePeer();
}

function startPhonePeer() {
  if (phonePeer && !phonePeer.destroyed && !phonePeer.disconnected) return;
  loadScriptOnce('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js', 'Peer').then((Peer) => {
    try { phonePeer?.destroy(); } catch (e) { /* gone */ }
    phonePeer = new Peer(`nycplanner-${phoneCode}`);
    phonePeer.on('open', () => { if (!phoneActive()) setPhoneStatus('Waiting for the phone…'); });
    phonePeer.on('call', (call) => {
      call.answer();
      setPhoneStatus('Phone found — connecting…');
      call.on('stream', (stream) => {
        phoneStream = stream;
        useStream(stream);
        setPhoneStatus('✓ Phone connected', 'ok');
        setCamStatus('📱 Phone camera');
        fillCamList();
        stream.getVideoTracks()[0]?.addEventListener('ended', phoneLost);
      });
      call.on('close', phoneLost);
      call.peerConnection?.addEventListener('connectionstatechange', () => {
        const s = call.peerConnection.connectionState;
        if (s === 'failed' || s === 'disconnected') phoneLost();
      });
    });
    phonePeer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        // Another tab already uses this code: make a new one.
        phoneCode = String(Math.floor(1000 + Math.random() * 9000));
        try { localStorage.setItem('phoneCamCode', phoneCode); } catch (err) { /* ok */ }
        openPhoneCam();
      } else {
        setPhoneStatus(`Connection problem (${e.type}). Is the computer online?`, 'bad');
      }
    });
    phonePeer.on('disconnected', () => { try { phonePeer.reconnect(); } catch (e) { /* ignore */ } });
  }).catch(() => setPhoneStatus('Could not load the connection helper — is the computer online?', 'bad'));
}

function phoneLost() {
  if (!phoneStream) return;
  phoneStream = null;
  setPhoneStatus('Phone disconnected — press Connect on the phone again.', 'bad');
  setCamStatus('📱 Phone disconnected — press Connect on the phone again');
}

function stopPhoneCam() {
  phoneStream = null;
  try { phonePeer?.destroy(); } catch (e) { /* gone */ }
  phonePeer = null;
}

phoneBox.querySelector('.ph-close').addEventListener('click', () => {
  phoneBox.hidden = true;
  if (!phoneActive()) fillCamList();
});
