import 'dotenv/config';
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const XI_KEY   = process.env.ELEVENLABS_API_KEY;
const API_ROOT = 'https://api.elevenlabs.io/v1';
const RATE     = 22050; // 22.05 kHz
const CHANS    = 1;
const BITDEPTH = 16;

if (!XI_KEY) throw new Error('Set ELEVENLABS_API_KEY in .env');

// ========================= HTML =========================
const HTML = ({ voices, msg = '', form = {} }) => {
  const {
    title = '',
    pauseDefault = '1.2',
    script = ''
  } = form;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Conversation → Audio</title>
<style>
  :root{
    --bg: #0a0b0f;
    --bg2:#0d1016;
    --card: #111419cc;
    --border:#1f2736;
    --muted:#9aa7bd;
    --text:#e8ecf3;
    --accent:#6aa6ff;
    --accent2:#4f7dff;
    --ring:#89b4ff;
    --danger:#ef4444;
    --success:#22c55e;
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    --sans:  Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
    --radius:16px;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; font:16px/1.55 var(--sans); color:var(--text);
    background:
      radial-gradient(800px 400px at 15% -10%, #1e293b22, transparent 60%),
      radial-gradient(800px 400px at 85% 110%, #1d4ed855, transparent 60%),
      linear-gradient(180deg, var(--bg), var(--bg2) 80%);
    display:flex; align-items:flex-start; justify-content:center; padding:48px 16px;
  }
  .wrap{width:min(980px, 100%)}
  .hero{
    text-align:center; margin:0 0 20px;
  }
  .title{
    font-weight:800; font-size:28px; letter-spacing:.3px;
    background:linear-gradient(90deg,#c7d2fe,#93c5fd,#60a5fa);
    -webkit-background-clip:text; background-clip:text; color:transparent;
  }
  .subtitle{color:var(--muted); margin-top:8px}
  .card{
    border:1px solid var(--border);
    background:linear-gradient(180deg, #121722cc, #0f141dcc);
    backdrop-filter: blur(6px);
    border-radius:var(--radius);
    box-shadow:0 20px 60px rgba(0,0,0,.45);
    padding:22px;
  }
  .section{margin-top:8px}
  .section h3{
    margin:16px 0 10px; font-size:13px; letter-spacing:.12em; color:#b6c2d9; text-transform:uppercase;
  }
  form{display:flex; flex-direction:column; gap:16px}
  .grid-3{display:grid; grid-template-columns:1.1fr 1.1fr .8fr; gap:14px}
  label{display:flex; flex-direction:column; gap:8px; font-weight:650; color:#d4def1}
  input, select, textarea{
    border:1px solid var(--border); background:#0c1118; color:var(--text);
    border-radius:12px; padding:12px 14px; font-size:15px; transition: box-shadow .15s, border-color .15s;
    outline:none;
  }
  input::placeholder, textarea::placeholder{color:#6b7790}
  input:focus, select:focus, textarea:focus{
    border-color:var(--ring); box-shadow:0 0 0 3px #89b4ff33;
  }
  textarea{
    font-family:var(--mono); min-height:280px; resize:vertical; line-height:1.5;
    background-image: linear-gradient(#0c1118 28px, #0e141d 28px);
    background-size: 100% 30px;
  }
  .hint{color:var(--muted); font-size:13px; margin-top:-8px}
  .btn{
    align-self:center; margin-top:4px;
    background:linear-gradient(180deg, var(--accent), var(--accent2));
    color:#0b0b0f; font-weight:800; letter-spacing:.02em;
    border:none; border-radius:14px; padding:14px 22px; font-size:16px; cursor:pointer;
    box-shadow:0 12px 28px rgba(79,125,255,.35);
    transition: transform .06s ease, filter .2s ease;
  }
  .btn:hover{filter:brightness(1.04)}
  .btn:active{transform:translateY(1px)}
  .btn[disabled]{opacity:.6; filter:grayscale(.3); cursor:not-allowed}
  .msg{
    display:none; border:1px solid #3b1f20; background:#2b1516; color:#fecaca;
    padding:10px 12px; border-radius:12px; margin-bottom:10px; font-weight:600
  }
  .toast{
    position:fixed; left:50%; bottom:28px; transform:translateX(-50%);
    padding:10px 14px; border-radius:12px; font-weight:700; color:#09310f;
    background:linear-gradient(180deg,#34d399,#22c55e); box-shadow:0 10px 26px rgba(34,197,94,.35);
    opacity:0; pointer-events:none; transition:opacity .2s, transform .2s;
  }
  .toast.show{opacity:1; transform:translateX(-50%) translateY(-4px)}
  /* overlay spinner */
  .overlay{position:fixed; inset:0; background:rgba(6,10,16,.65); display:none; align-items:center; justify-content:center; z-index:9999}
  .spinner{
    width:70px; height:70px; border-radius:50%;
    border:6px solid #1f2540; border-top-color:#7aa8ff; animation:spin 1s linear infinite;
    box-shadow:0 0 40px #5b8bff55 inset;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  @media (max-width:820px){
    .grid-3{grid-template-columns:1fr; gap:10px}
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="title">Conversation → Audio</div>
      <div class="subtitle">Multiple pauses · 2 speakers · ElevenLabs <b>eleven_v3</b> · WAV only (gapless)</div>
    </div>

    <div class="card">
      <div id="msg" class="msg">${msg ? escapeHtml(msg) : ''}</div>

      <form id="ttsForm" autocomplete="off">
        <div class="section">
          <h3>Title</h3>
          <label>
            <input name="title" placeholder="e.g. Atomic Structure" value="${escapeHtml(title)}" required>
            <div class="hint">Used as the download filename.</div>
          </label>
        </div>

        <div class="section">
          <h3>Voices & Timing</h3>
          <div class="grid-3">
            <label>Speaker 1 voice
              <select name="voice1" required>
                ${voices.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}
              </select>
            </label>
            <label>Speaker 2 voice
              <select name="voice2" required>
                ${voices.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}
              </select>
            </label>
            <label>Default pause (s)
              <input name="pauseDefault" type="number" step=".1" min="0" value="${escapeHtml(pauseDefault)}">
            </label>
          </div>
        </div>

        <div class="section">
          <h3>Script</h3>
          <label>
            <textarea name="script" spellcheck="false" placeholder="[Speaker 1]: Hello
[pause]
[Speaker 2]: Hi there!
[pause:2.0]
[Speaker 1]: Let's begin...">${escapeHtml(script)}</textarea>
            <div class="hint">Lines should start with <code style="font-family:var(--mono)">[Speaker 1]:</code> or <code style="font-family:var(--mono)">[Speaker 2]:</code>. Insert pauses with <code style="font-family:var(--mono)">[pause]</code> or <code style="font-family:var(--mono)">[pause:1.7]</code>.</div>
          </label>
        </div>

        <button id="genBtn" class="btn" type="submit">Generate WAV</button>
      </form>
    </div>
  </div>

  <div class="overlay" id="overlay"><div class="spinner"></div></div>
  <div class="toast" id="toast">Downloaded</div>

  <script>
    const form = document.getElementById('ttsForm');
    const overlay = document.getElementById('overlay');
    const btn = document.getElementById('genBtn');
    const msgEl = document.getElementById('msg');
    const toast = document.getElementById('toast');

    const showSpinner = () => { overlay.style.display='flex'; btn.disabled = true; };
    const hideSpinner = () => { overlay.style.display='none'; btn.disabled = false; };
    const showError = (t) => { msgEl.textContent = t; msgEl.style.display='block'; };
    const clearError = () => { msgEl.style.display='none'; };
    const showToast = () => { toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'), 1400); };

    const slug = s => (s || 'audio').toLowerCase().replace(/['"]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      showSpinner();
      try{
        const fd = new FormData(form);
        const title = slug(fd.get('title'));
        const body = new URLSearchParams(fd).toString();

        const res = await fetch('/generate', {
          method:'POST',
          headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
          body
        });

        if(!res.ok){
          const text = await res.text();
          showError(text || ('HTTP ' + res.status));
          hideSpinner();
          return;
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (title || 'audio') + '.wav';
        document.body.appendChild(a);
        a.click();
        setTimeout(()=>{
          URL.revokeObjectURL(url);
          a.remove();
          hideSpinner();   // ensure the spinner disappears
          showToast();     // friendly success signal
        }, 0);
      }catch(err){
        showError('Error: ' + (err?.message || err));
        hideSpinner();
      }
    }, { passive:false });
  </script>
</body>
</html>`;
};

// ========================= Utils =========================
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
}
const slug = s => (s || 'audio')
  .toLowerCase().replace(/['"]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

async function listVoices(){
  const r = await axios.get(`${API_ROOT}/voices`, {
    headers: { 'xi-api-key': XI_KEY },
    timeout: 15000
  });
  const voices = (r.data?.voices || []).map(v => ({ id: v.voice_id, name: v.name }));
  voices.sort((a,b)=>a.name.localeCompare(b.name));
  return voices;
}

function parseScript(text, defaultPause){
  const events = [];
  for(const raw of (text || '').split(/\r?\n/)){
    const line = raw.trim();
    if(!line) continue;

    const mPause = line.match(/^\[pause(\s*:\s*([0-9]*\.?[0-9]+))?\]$/i);
    if (mPause){
      const sec = mPause[2] ? parseFloat(mPause[2]) : defaultPause;
      events.push({ type:'pause', sec: Math.max(0, sec || 0) });
      continue;
    }
    if (line.startsWith('[Speaker 1]:')){
      events.push({ type:'speak', voice:'v1', text: line.split(']:',2)[1].trim() });
      continue;
    }
    if (line.startsWith('[Speaker 2]:')){
      events.push({ type:'speak', voice:'v2', text: line.split(']:',2)[1].trim() });
      continue;
    }
  }
  return events;
}

function silencePCM(seconds){
  const frames = Math.max(0, Math.floor(seconds * RATE));
  return Buffer.alloc(frames * CHANS * (BITDEPTH/8));
}

function wrapWav(pcm){
  const numChannels = CHANS, sampleRate = RATE, bitDepth = BITDEPTH;
  const blockAlign = numChannels * bitDepth / 8;
  const byteRate   = sampleRate * blockAlign;
  const dataSize   = pcm.length;

  const header = Buffer.alloc(44);
  let o = 0;
  header.write('RIFF', o); o+=4;
  header.writeUInt32LE(36 + dataSize, o); o+=4;
  header.write('WAVE', o); o+=4;
  header.write('fmt ', o); o+=4;
  header.writeUInt32LE(16, o); o+=4;
  header.writeUInt16LE(1, o); o+=2;
  header.writeUInt16LE(numChannels, o); o+=2;
  header.writeUInt32LE(sampleRate, o); o+=4;
  header.writeUInt32LE(byteRate, o); o+=4;
  header.writeUInt16LE(blockAlign, o); o+=2;
  header.writeUInt16LE(bitDepth, o); o+=2;
  header.write('data', o); o+=4;
  header.writeUInt32LE(dataSize, o); o+=4;
  return Buffer.concat([header, pcm]);
}

async function ttsPCM(voiceId, text){
  const url    = `${API_ROOT}/text-to-speech/${encodeURIComponent(voiceId)}`;
  const params = { output_format: 'pcm_22050', model_id: 'eleven_v3' };
  const r = await axios.post(url, { text }, {
    params,
    headers: { 'xi-api-key': XI_KEY, 'Content-Type':'application/json' },
    responseType: 'arraybuffer',
    timeout: 60000
  });
  return Buffer.from(r.data);
}

// ========================= Routes =========================
app.get('/', async (req,res)=>{
  try{
    const voices = await listVoices();
    res.send(HTML({ voices }));
  }catch(e){
    res.status(500).send(HTML({ voices: [], msg: 'Failed to load voices: '+escapeHtml(e.message) }));
  }
});

app.post('/generate', async (req,res)=>{
  let { title='', pauseDefault='1.2', voice1, voice2, script='' } = req.body;
  const defaultPause = Math.max(0, parseFloat(pauseDefault) || 0);

  if (!voice1 || !voice2){
    const voices = await listVoices().catch(()=>[]);
    return res.status(400).send(HTML({ voices, msg: 'Please choose both voices.', form: req.body }));
  }

  const safeBase = slug(title || 'audio');
  try{
    const events = parseScript(script, defaultPause);
    const pcmParts = [];
    for (const ev of events){
      if (ev.type === 'pause') pcmParts.push(silencePCM(ev.sec));
      else {
        const voiceId = ev.voice === 'v1' ? voice1 : voice2;
        pcmParts.push(await ttsPCM(voiceId, ev.text));
      }
    }
    const wav = wrapWav(Buffer.concat(pcmParts));
    res.setHeader('Content-Type','audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="\${safeBase}.wav"`);
    return res.send(wav);
  }catch(e){
    const voices = await listVoices().catch(()=>[]);
    return res.status(500).send(HTML({ voices, msg: 'Synthesis failed: ' + escapeHtml(e.message), form: req.body }));
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Listening on 0.0.0.0:' + PORT));
