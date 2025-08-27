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

// ---------- HTML (Dark UI + fetch-based download + spinner) ----------
const HTML = ({ voices, msg = '', form = {} }) => {
  const {
    title = '',
    pauseDefault = '1.2',
    script = ''
  } = form;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Conversation → Audio</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root{
      --bg:#0b0b0f; --card:#14161a; --muted:#94a3b8; --text:#e5e7eb; --accent:#3b82f6; --accent2:#2563eb; --border:#263041;
      --input:#0f1115; --input-border:#334155;
    }
    *{box-sizing:border-box}
    body{margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui, sans-serif;
         display:flex; justify-content:center; min-height:100vh; padding:40px 16px;}
    .card{width:min(860px,100%); background:var(--card); border:1px solid var(--border);
          border-radius:18px; padding:28px; box-shadow:0 10px 30px rgba(0,0,0,.35);}
    h1{margin:0 0 18px; font-size:22px; text-align:center}
    p.hint{color:var(--muted); margin:-4px 0 18px; text-align:center}
    .msg{background:#b91c1c; color:#fff; padding:10px 12px; border-radius:10px; margin:0 0 12px; font-weight:600}
    form{display:flex; flex-direction:column; gap:18px}
    .grid-3{display:grid; grid-template-columns:repeat(3,1fr); gap:14px}
    label{display:flex; flex-direction:column; gap:8px; font-weight:600}
    input, select, textarea{
      background:var(--input); color:var(--text); border:1px solid var(--input-border);
      border-radius:10px; padding:11px 12px; font-size:15px;
    }
    textarea{min-height:260px; resize:vertical}
    code{background:#0b0d12; border:1px solid var(--border); padding:2px 6px; border-radius:6px; color:#cbd5e1}
    button{margin-top:8px; padding:14px 16px; font-size:16px; font-weight:700; color:#fff;
           background:linear-gradient(180deg, var(--accent), var(--accent2)); border:none;
           border-radius:12px; cursor:pointer; box-shadow:0 6px 18px rgba(59,130,246,.35);}
    button[disabled]{opacity:.6; cursor:not-allowed; filter:grayscale(20%)}
    button:hover:not([disabled]){filter:brightness(1.05)}
    .footer{margin-top:10px; color:var(--muted); font-size:13px; text-align:center}

    /* Spinner overlay */
    .overlay{position:fixed; inset:0; background:rgba(0,0,0,0.65); display:none;
             align-items:center; justify-content:center; z-index:9999;}
    .spinner{border:6px solid #333; border-top:6px solid var(--accent); border-radius:50%;
             width:60px; height:60px; animation:spin 1s linear infinite;}
    @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="overlay" id="overlay"><div class="spinner"></div></div>
  <section class="card">
    ${msg ? `<div class="msg" id="serverMsg">${escapeHtml(msg)}</div>` : '<div class="msg" id="serverMsg" style="display:none"></div>'}
    <h1>Conversation → Audio (Multiple pauses, 2 speakers)</h1>
    <p class="hint">Title becomes filename. Uses ElevenLabs <b>eleven_v3</b>. WAV only (gapless).</p>

    <form id="ttsForm">
      <label>Title (used as filename)
        <input name="title" placeholder="e.g. Atomic Structure" value="${escapeHtml(title)}" required />
      </label>

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
          <input name="pauseDefault" type="number" step=".1" min="0" value="${escapeHtml(pauseDefault)}" />
        </label>
      </div>

      <label>Script
        <textarea name="script" placeholder="[Speaker 1]: Hello
[pause]
[Speaker 2]: Hi there!">${escapeHtml(script)}</textarea>
      </label>

      <button id="genBtn" type="submit">Generate WAV</button>
      <div class="footer">Audio is assembled in memory and downloaded. Nothing is stored.</div>
    </form>
  </section>

  <script>
    const form    = document.getElementById('ttsForm');
    const overlay = document.getElementById('overlay');
    const btn     = document.getElementById('genBtn');
    const serverMsg = document.getElementById('serverMsg');

    function showSpinner(){ overlay.style.display='flex'; btn.disabled = true; }
    function hideSpinner(){ overlay.style.display='none'; btn.disabled = false; }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      serverMsg.style.display = 'none';
      showSpinner();
      try {
        const data = new URLSearchParams(new FormData(form));
        const title = (form.title.value || 'audio').toLowerCase().replace(/['"]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
        const res = await fetch('/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: data.toString()
        });

        if (!res.ok) {
          const text = await res.text();
          serverMsg.textContent = text || ('HTTP ' + res.status);
          serverMsg.style.display = 'block';
          hideSpinner();
          return;
        }

        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (title || 'audio') + '.wav';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
          a.remove();
          hideSpinner();               // ✅ ensure spinner goes away after download is triggered
        }, 0);
      } catch (err) {
        serverMsg.textContent = 'Error: ' + (err?.message || err);
        serverMsg.style.display = 'block';
        hideSpinner();
      }
    });
  </script>
</body>
</html>`;
};

// ---------- Utils ----------
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
}
const slug = s => (s || 'audio')
  .toLowerCase()
  .replace(/['"]/g,'')
  .replace(/[^a-z0-9]+/g,'-')
  .replace(/^-+|-+$/g,'');

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

// ---------- Routes ----------
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
    res.setHeader('Content-Disposition', `attachment; filename="${safeBase}.wav"`);
    return res.send(wav);
  }catch(e){
    const voices = await listVoices().catch(()=>[]);
    return res.status(500).send(HTML({ voices, msg: 'Synthesis failed: ' + escapeHtml(e.message), form: req.body }));
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Listening on 0.0.0.0:' + PORT));
