import 'dotenv/config';
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const XI_KEY   = process.env.ELEVENLABS_API_KEY;
const API_ROOT = 'https://api.elevenlabs.io/v1';
const RATE     = 22050;  // PCM 22.05 kHz
const CHANS    = 1;
const BITDEPTH = 16;

if (!XI_KEY) throw new Error('Set ELEVENLABS_API_KEY in .env');

// ---------- HTML (Dark UI) ----------
const HTML = ({ voices, msg = '', form = {} }) => {
  const {
    title = 'Atomic Structure',
    filename = '',
    format = 'wav',
    pauseDefault = '1.2',
    script = DEFAULT_SCRIPT
  } = form;

  const selected = (a, b) => (a === b ? 'selected' : '');

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
    body{
      margin:0; background:var(--bg); color:var(--text);
      font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
      display:flex; justify-content:center; align-items:flex-start; min-height:100vh; padding:40px 16px;
    }
    .card{
      width:min(980px,100%); background:var(--card); border:1px solid var(--border);
      border-radius:18px; padding:28px; box-shadow:0 10px 30px rgba(0,0,0,.35);
    }
    h1{margin:0 0 18px; font-size:22px; text-align:center; letter-spacing:.2px}
    p.hint{color:var(--muted); margin:-4px 0 18px; text-align:center}
    .msg{background:#b91c1c; color:#fff; padding:10px 12px; border-radius:10px; margin:0 0 12px; font-weight:600}
    form{display:flex; flex-direction:column; gap:18px}
    .grid-3{display:grid; grid-template-columns:repeat(3,1fr); gap:14px}
    .grid-2{display:grid; grid-template-columns:repeat(2,1fr); gap:14px}
    label{display:flex; flex-direction:column; gap:8px; font-weight:600}
    input, select, textarea{
      background:var(--input); color:var(--text); border:1px solid var(--input-border);
      border-radius:10px; padding:11px 12px; font-size:15px; outline:none;
    }
    textarea{min-height:260px; resize:vertical}
    .row-note{color:var(--muted); font-size:14px}
    code{background:#0b0d12; border:1px solid var(--border); padding:2px 6px; border-radius:6px; color:#cbd5e1}
    button{
      margin-top:8px; padding:14px 16px; font-size:16px; font-weight:700;
      color:#fff; background:linear-gradient(180deg, var(--accent), var(--accent2));
      border:none; border-radius:12px; cursor:pointer; letter-spacing:.2px;
      box-shadow:0 6px 18px rgba(59,130,246,.35);
    }
    button:hover{filter:brightness(1.05)}
    .footer{margin-top:10px; color:var(--muted); font-size:13px; text-align:center}
  </style>
</head>
<body>
  <section class="card">
    ${msg ? `<div class="msg">${escapeHtml(msg)}</div>` : ''}
    <h1>Conversation → Audio (Multiple pauses, 2 speakers)</h1>
    <p class="hint">Black UI • white words • precise WAV or best-effort MP3 • Title becomes filename</p>
    <form method="post" action="/generate">
      <label>Title (used as filename)
        <input name="title" placeholder="Enter title" value="${escapeHtml(title)}" />
      </label>

      <div class="grid-3">
        <label>Speaker 1 voice
          <select name="voice1">
            ${voices.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}
          </select>
        </label>
        <label>Speaker 2 voice
          <select name="voice2">
            ${voices.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}
          </select>
        </label>
        <label>Default pause (s)
          <input name="pauseDefault" type="number" step=".1" min="0" value="${escapeHtml(pauseDefault)}" />
        </label>
      </div>

      <div class="grid-2">
        <label>Output format
          <select name="format">
            <option value="wav" ${selected(format,'wav')}>WAV (gapless, safest)</option>
            <option value="mp3" ${selected(format,'mp3')}>MP3 (best-effort)</option>
          </select>
        </label>
        <label>Filename (optional override, no extension)
          <input name="filename" placeholder="Leave blank to use Title" value="${escapeHtml(filename)}" />
        </label>
      </div>

      <div class="row-note">Script syntax: lines start with <code>[Speaker 1]:</code> or <code>[Speaker 2]:</code>. Insert pauses with <code>[pause]</code> or <code>[pause:1.7]</code> (seconds). If your first line is <code>Title: Something</code>, we’ll auto-fill the Title above and ignore that line.</div>

      <label>Script
        <textarea name="script" rows="16">${escapeHtml(script)}</textarea>
      </label>

      <button type="submit">Generate</button>
      <div class="footer">Nothing is stored on disk; audio is assembled in memory and downloaded directly.</div>
    </form>
  </section>
</body>
</html>`;
};

// ---------- Defaults ----------
const DEFAULT_SCRIPT = `Title: Atomic Structure

[Speaker 1]: Let’s begin. What are the three main subatomic particles in an atom and their relative charges?
[pause]
[Speaker 2]: The proton has a +1 charge, the neutron has no charge, and the electron has a –1 charge.
[Speaker 1]: Correct — and the protons and neutrons are found in the nucleus
[pause]
[Speaker 1]: Moving on, what happens to protons, neutrons, and electrons when they are each passed through an electric field?
[pause]
[Speaker 2]: Protons deflect towards the negative plate, neutrons are not deflected, and electrons deflect towards the positive plate.
[Speaker 1]: Yes — and the angle of deflection depends on the charge to mass ratio.
[pause]
[Speaker 1]: Here’s another: What does the principal quantum number, n, tell us?
[pause]
[Speaker 2]: It tells us the electron shell number, which relates to the distance from the nucleus and the energy level.
[Speaker 1]: Correct — higher n means electrons are further from the nucleus and have higher energy.
[pause]
[Speaker 1]: Next, what is the shape of an s orbital?
[pause]`;

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

// Extract Title from first "Title:" line if present
function extractTitleAndStrip(text){
  const lines = text.split(/\r?\n/);
  let found = '';
  const rest = [];
  for (const raw of lines){
    const m = raw.match(/^\s*Title\s*:\s*(.+)\s*$/i);
    if (m && !found) { found = m[1].trim(); continue; }
    rest.push(raw);
  }
  return { title: found, body: rest.join('\n').trim() };
}

// Parse script into events
function parseScript(text, defaultPause){
  const events = [];
  for(const raw of text.split(/\r?\n/)){
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
    // Any other lines (including Title) are ignored
  }
  return events;
}

// Build PCM silence
function silencePCM(seconds){
  const frames = Math.max(0, Math.floor(seconds * RATE));
  return Buffer.alloc(frames * CHANS * (BITDEPTH/8));
}

// Wrap raw PCM as WAV
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

// ElevenLabs: PCM (for WAV path)
async function ttsPCM(voiceId, text){
  const url    = `${API_ROOT}/text-to-speech/${encodeURIComponent(voiceId)}`;
  const params = { output_format: 'pcm_22050', model_id: 'eleven_multilingual_v2' };
  const r = await axios.post(url, { text }, {
    params,
    headers: { 'xi-api-key': XI_KEY, 'Content-Type':'application/json' },
    responseType: 'arraybuffer',
    timeout: 60000
  });
  const ct = String(r.headers['content-type'] || '').toLowerCase();
  if (ct.includes('audio/mpeg')) throw new Error('Got MP3; expected PCM. Check output_format.');
  return Buffer.from(r.data);
}

// MP3 helpers (best-effort concat; may have tiny gaps)
function stripID3v2(buf){
  if (buf.length < 10) return buf;
  if (buf[0]===0x49 && buf[1]===0x44 && buf[2]===0x33){
    const size = ((buf[6]&0x7f)<<21) | ((buf[7]&0x7f)<<14) | ((buf[8]&0x7f)<<7) | (buf[9]&0x7f);
    return buf.slice(10 + size);
  }
  return buf;
}
function stripID3v1(buf){
  if (buf.length >= 128){
    const tail = buf.slice(buf.length-128);
    if (tail[0]===0x54 && tail[1]===0x41 && tail[2]===0x47) return buf.slice(0, buf.length-128);
  }
  return buf;
}
function concatMP3(buffers){
  return Buffer.concat(buffers.map((b,i,a)=>{
    let x = b;
    if (i>0) x = stripID3v2(x);
    if (i<a.length-1) x = stripID3v1(x);
    return x;
  }));
}
async function ttsMP3(voiceId, text, { format='mp3_22050_64' } = {}){
  const url    = `${API_ROOT}/text-to-speech/${encodeURIComponent(voiceId)}`;
  const params = { output_format: format, model_id: 'eleven_multilingual_v2' };
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
    // Prefill title from default script
    const { title } = extractTitleAndStrip(DEFAULT_SCRIPT);
    res.send(HTML({ voices, form: { title, script: DEFAULT_SCRIPT } }));
  }catch(e){
    res.status(500).send(HTML({ voices: [], msg: 'Failed to load voices: '+escapeHtml(e.message) }));
  }
});

app.post('/generate', async (req,res)=>{
  let { title='', filename='', format='wav', pauseDefault='1.2', voice1, voice2, script='' } = req.body;
  const defaultPause = Math.max(0, parseFloat(pauseDefault) || 0);

  if (!voice1 || !voice2){
    const voices = await listVoices().catch(()=>[]);
    return res.status(400).send(HTML({ voices, msg: 'Please choose both voices.', form: req.body }));
  }

  // If user pasted a "Title: ..." line, pull it up and strip it out
  if (!title) {
    const ex = extractTitleAndStrip(script);
    if (ex.title) title = ex.title;
    script = ex.body || script;
  } else {
    // Even if title is provided, strip any Title line from script so it won't be spoken
    script = extractTitleAndStrip(script).body || script;
  }

  const baseName = filename.trim() ? filename.trim() : (title || 'audio');
  const safeBase = slug(baseName);

  try{
    const events = parseScript(script, defaultPause);

    if (format === 'wav'){
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
      res.setHeader('Content-Disposition', `attachment; filename="${safeBase || 'audio'}.wav"`);
      return res.send(wav);
    }

    // MP3 best-effort
    const mp3Parts = [];
    for (const ev of events){
      if (ev.type === 'pause'){
        const dots = '.'.repeat(Math.max(1, Math.ceil(ev.sec/0.5))); // crude silence
        mp3Parts.push(await ttsMP3(voice1, dots));
      } else {
        const voiceId = ev.voice === 'v1' ? voice1 : voice2;
        mp3Parts.push(await ttsMP3(voiceId, ev.text));
      }
    }
    const mergedMP3 = concatMP3(mp3Parts);
    res.setHeader('Content-Type','audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeBase || 'audio'}.mp3"`);
    return res.send(mergedMP3);

  }catch(e){
    const voices = await listVoices().catch(()=>[]);
    return res.status(500).send(HTML({
      voices,
      msg: 'Synthesis failed: ' + escapeHtml(e.message),
      form: { title, filename, format, pauseDefault, script }
    }));
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('Listening on 0.0.0.0:' + PORT));
