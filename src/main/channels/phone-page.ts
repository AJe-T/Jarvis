/**
 * The page the phone remote serves (one file, no external requests). Text is always set with
 * textContent, never innerHTML. Speech uses the phone browser's own recogniser (Chrome on Android,
 * Safari on iPhone) for live words, and speechSynthesis to read replies aloud — both free.
 */
export function phonePage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#05070d">
<title>Jarvis</title>
<style>
:root{--bg:#05070d;--panel:#0d121c;--line:#1c2433;--ink:#e6edf7;--mute:#8592a6;--accent:#22d3ee;--me:#164e63;--warn:#f59e0b;--bad:#ef4444}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body{display:flex;flex-direction:column;height:100dvh}
header{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line)}
.orb{width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#e9fffd,#12b5a8 45%,#06403c 80%);box-shadow:0 0 18px #12b5a888;transition:transform .2s}
.orb.live{animation:pulse 1.2s ease-in-out infinite}@keyframes pulse{50%{transform:scale(1.18);box-shadow:0 0 30px #22d3eecc}}
header h1{font-size:17px;margin:0;flex:1}#status{font-size:12px;color:var(--mute)}
main{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:85%;padding:10px 13px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}
.me{align-self:flex-end;background:var(--me);border-bottom-right-radius:4px}
.jarvis{align-self:flex-start;background:var(--panel);border:1px solid var(--line);border-bottom-left-radius:4px}
.card{align-self:stretch;background:#1a1405;border:1px solid #4a3a10;border-radius:12px;padding:12px}
.card p{margin:0 0 10px}.card .row{display:flex;gap:8px}
.empty{margin:auto;text-align:center;color:var(--mute);max-width:280px}
footer{padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--line);display:flex;gap:8px;align-items:flex-end}
textarea{flex:1;resize:none;max-height:140px;min-height:44px;padding:11px 14px;border-radius:22px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit}
button{border:0;border-radius:22px;min-width:44px;height:44px;padding:0 14px;background:var(--panel);color:var(--ink);font:inherit;font-weight:600;border:1px solid var(--line)}
button.primary{background:var(--accent);color:#03141a;border-color:transparent}
button.live{background:var(--bad);color:#fff;border-color:transparent}
button.ghost{background:transparent}
#call.live{background:var(--bad);color:#fff}
.pair{margin:auto;max-width:320px;text-align:center;display:flex;flex-direction:column;gap:12px}
.pair input{padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;text-align:center;letter-spacing:.3em}
</style>
</head>
<body>
<header><div class="orb" id="orb"></div><h1>Jarvis</h1><span id="status">connecting…</span><button id="call" class="ghost" aria-label="Call Jarvis">📞</button></header>
<main id="log"><p class="empty" id="empty">Ask anything. Tap 🎤 and speak — your words appear as you talk. Tap 📞 for a hands-free voice call.</p></main>
<footer>
<button id="mic" aria-label="Dictate">🎤</button>
<textarea id="box" rows="1" placeholder="Message Jarvis…"></textarea>
<button id="send" class="primary" aria-label="Send">➤</button>
</footer>
<script nonce="${nonce}">
(() => {
  const $ = (id) => document.getElementById(id);
  const log = $('log'), box = $('box'), status = $('status'), orb = $('orb');
  let token = localStorage.getItem('jarvis.token') || '';
  const turns = new Map();
  let calling = false, speaking = false, events = null;

  function bubble(cls, text) {
    $('empty')?.remove();
    const d = document.createElement('div');
    d.className = 'msg ' + cls; d.textContent = text; log.appendChild(d);
    log.scrollTop = log.scrollHeight; return d;
  }
  async function api(path, body) {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { localStorage.removeItem('jarvis.token'); token = ''; showPair('This phone is no longer paired.'); throw new Error('unpaired'); }
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }

  // ── pairing ──
  function showPair(msg) {
    document.querySelector('footer').style.display = 'none';
    log.textContent = '';
    const w = document.createElement('div'); w.className = 'pair';
    const p = document.createElement('p'); p.textContent = msg || 'Scan the QR code in Jarvis → Settings → Phone, or type the 6-digit code shown there.';
    const i = document.createElement('input'); i.inputMode = 'numeric'; i.maxLength = 6; i.placeholder = '000000';
    const b = document.createElement('button'); b.className = 'primary'; b.textContent = 'Pair this phone';
    b.onclick = () => pair(i.value.trim());
    w.append(p, i, b); log.appendChild(w);
  }
  async function pair(code) {
    try {
      const r = await fetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: navigator.userAgent.slice(0, 80) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Pairing failed');
      token = j.token; localStorage.setItem('jarvis.token', token);
      location.hash = ''; location.reload();
    } catch (e) { showPair(String(e.message || e)); }
  }
  const hashCode = /pair=(\\d{6})/.exec(location.hash);
  if (hashCode) { pair(hashCode[1]); return; }
  if (!token) { showPair(); return; }

  // ── live updates ──
  function connect() {
    events?.close();
    events = new EventSource('/api/events?token=' + encodeURIComponent(token));
    events.onopen = () => { status.textContent = 'connected'; };
    events.onerror = () => { status.textContent = 'reconnecting…'; };
    events.addEventListener('delta', (e) => {
      const d = JSON.parse(e.data); let t = turns.get(d.turnId);
      if (!t) { t = { el: bubble('jarvis', ''), text: '' }; turns.set(d.turnId, t); }
      t.text += d.text; t.el.textContent = t.text.replace(/<\\/?spoken>/g, '');
      log.scrollTop = log.scrollHeight;
    });
    events.addEventListener('done', (e) => {
      const d = JSON.parse(e.data); let t = turns.get(d.turnId);
      if (!t) { t = { el: bubble('jarvis', ''), text: '' }; turns.set(d.turnId, t); }
      t.el.textContent = d.text || '(done)';
      orb.classList.remove('live'); status.textContent = 'connected';
      say(d.spoken || d.text);
    });
    events.addEventListener('confirm', (e) => {
      const d = JSON.parse(e.data);
      const c = document.createElement('div'); c.className = 'card';
      const p = document.createElement('p'); p.textContent = d.title + (d.details ? '\\n\\n' + d.details : '');
      p.style.whiteSpace = 'pre-wrap'; c.appendChild(p);
      const row = document.createElement('div'); row.className = 'row';
      if (!d.destructive) { const a = document.createElement('button'); a.className = 'primary'; a.textContent = d.actionLabel || 'Approve'; a.onclick = () => decide(d.requestId, 'approve', c); row.appendChild(a); }
      else { const n = document.createElement('p'); n.textContent = 'This one can only be approved at the PC.'; c.appendChild(n); }
      const x = document.createElement('button'); x.textContent = 'Deny'; x.onclick = () => decide(d.requestId, 'deny', c); row.appendChild(x);
      c.appendChild(row); log.appendChild(c); log.scrollTop = log.scrollHeight;
      say(d.destructive ? 'Please confirm that on the PC, sir.' : 'Shall I ' + d.title.replace(/\\?$/, '') + '?');
    });
  }
  async function decide(id, decision, card) {
    card.querySelectorAll('button').forEach((b) => (b.disabled = true));
    await api('/api/confirm', { requestId: id, decision }).catch(() => {});
    card.querySelector('p').textContent += decision === 'approve' ? '\\n✓ Approved' : '\\n✗ Denied';
  }
  connect();

  // ── sending ──
  async function send(text) {
    text = (text || '').trim(); if (!text) return;
    stopDictation(); box.value = ''; autosize();
    bubble('me', text); orb.classList.add('live'); status.textContent = 'thinking…';
    try { await api('/api/chat', { text }); }
    catch (e) { bubble('jarvis', 'Could not reach Jarvis: ' + e.message); orb.classList.remove('live'); }
  }
  $('send').onclick = () => send(box.value);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(box.value); } });
  function autosize() { box.style.height = 'auto'; box.style.height = Math.min(box.scrollHeight, 140) + 'px'; }
  box.addEventListener('input', autosize);

  // ── live dictation (phone keyboard style) ──
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, base = '';
  function startDictation(onFinal) {
    if (!SR) { bubble('jarvis', 'Live dictation needs Chrome (Android) or Safari (iPhone) over https. You can still use the keyboard microphone.'); return false; }
    rec = new SR(); rec.lang = navigator.language || 'en-IN'; rec.interimResults = true; rec.continuous = !onFinal;
    base = box.value ? box.value.replace(/\\s*$/, ' ') : '';
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript + ' '; else interim += r[0].transcript;
      }
      box.value = base + finalText + interim; autosize();
    };
    rec.onend = () => {
      $('mic').classList.remove('live'); orb.classList.remove('live');
      const done = rec; rec = null;
      if (onFinal && done) onFinal(box.value);
    };
    rec.onerror = (e) => { if (e.error === 'not-allowed') bubble('jarvis', 'Microphone permission was refused. Allow it for this page, or use the keyboard microphone.'); };
    rec.start(); $('mic').classList.add('live'); orb.classList.add('live'); return true;
  }
  function stopDictation() { if (rec) { const r = rec; rec = null; r.onend = () => { $('mic').classList.remove('live'); }; r.stop(); } }
  $('mic').onclick = () => (rec ? stopDictation() : startDictation(null));

  // ── replies read aloud, and the hands-free "call" ──
  function say(text) {
    if (!calling || !('speechSynthesis' in window) || !text) { if (calling) listenNext(); return; }
    const u = new SpeechSynthesisUtterance(String(text).replace(/<\\/?spoken>/g, '').slice(0, 600));
    u.rate = 1.05; speaking = true;
    u.onend = () => { speaking = false; listenNext(); };
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  function listenNext() { if (calling && !rec && !speaking) setTimeout(() => calling && startDictation((t) => { if (t.trim()) send(t); else listenNext(); }), 300); }
  $('call').onclick = () => {
    calling = !calling; $('call').classList.toggle('live', calling);
    $('call').textContent = calling ? '⏹' : '📞';
    if (calling) { status.textContent = 'on a call'; listenNext(); }
    else { stopDictation(); speechSynthesis?.cancel(); status.textContent = 'connected'; }
  };
})();
</script>
</body>
</html>`;
}
