import 'dotenv/config';
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

const XI_KEY   = process.env.ELEVENLABS_API_KEY;
const API_ROOT = 'https://api.elevenlabs.io/v1';
const RATE     = 22050; // for PCM path
const CHANS    = 1;
const BITDEPTH = 16;

if (!XI_KEY) throw new Error('Set ELEVENLABS_API_KEY in .env');

// ============ HTML UI ============
const HTML = (voices, msg = '') => `<!doctype html>
<html><head><meta charset="utf-8"><title>Conversation → Audio</title>
<style>
 body{font-family:system-ui,Roboto,sans-serif;background:#f6f7fa;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
 .card{background:#fff;padding:2rem 2.25rem;border-radius:1rem;box-shadow:0 8px 24px rgba(0,0,0,.08);max-width:820px;width:100%}
 h1{font-size:1.25rem;text-align:center;margin:0 0 1rem}
 form{display:flex;flex-direction:column;gap:1rem}
 textarea,select,input{padding:.6rem .8rem;border:1px solid #cbd5e1;border-radius:.6rem;font-size:.95rem}
 button{padding:.75rem 1.1rem;background:#3b82f6;color:#fff;border:none;border-radius:.6rem;font-size:1rem;cursor:pointer}
 button:hover{background:#2563eb}
 .row{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}
 .row2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
 .msg{color:#dc2626;text-align:center;margin-bottom:.5rem}
 code{background:#f1f5f9;padding:.1rem .3rem;border-radius:.3rem}
</style></head><body>
<section class="card">
 ${msg ? `<p class="msg">${escapeHtml(msg)}</p>` : ''}
 <h1>Conversation → Audio (Multiple pauses, 2 speakers)</h1>
 <form method="post" action="/generate">
   <div class="row">
     <label>Speaker 1 voice
       <select name="voice1">${voices.map(v => `<option value="\${v.id}">\${escapeHtml(v.name)}</option>`).join('')}</select>
     </label>
     <label>Speaker 2 voice
       <select name="voice2">${voices.map(v => `<option value="\${v.id}">\${escapeHtml(v.name)}</option>`).join('')}</select>
     </label>
     <label>Default pause (s)
       <input type="number" name="pauseDefault" step=".1" min="0" value="1.2"/>
     </label>
   </div>
   <div class="row2">
     <label>Output format
       <select name="format">
         <option value="wav" selected>WAV (gapless, safest)</option>
         <option value="mp3">MP3 (single file)</option>
       </select>
     </label>
     <label>Filename (no extension)
       <input type="text" name="filename" placeholder="conversation" value="conversation"/>
     </label>
   </div>
   <p>Script syntax: lines starting with <code>[Speaker 1]:</code> or <code>[Speaker 2]:</code>. Insert pauses using <code>[pause]</code> or <code>[pause:1.7]</code> (seconds).</p>
   <label>Script
     <textarea name="script" rows="14">Title: Atomic Structure

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
[pause]</textarea>
   </label>
   <button type="submit">Generate</button>
 </form>
</section></body></html>`;

// ============ Utils ============
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function listVoices(){
  const r = await axios.get(`${API_ROOT}/voices`,{headers:{'xi-api-key':XI_KEY},timeout:15000});
  const voices = (r.data?.voices||[]).map(v=>({id:v.voice_id,name:v.name}));
  voices.sort((a,b)=>a.name.localeCompare(b.name));
  return voices;
}

// Parse script into events: {type:'speak'|'pause', voice:'v1'|'v2', text?:string, sec?:number}
function parseScript(text, defaultPause){
  const events=[];
  const lines = text.split(/\r?\n/);
  for(const raw of lines){
    const line = raw.trim();
    if(!line) continue;
    if(/^\[pause(\s*:\s*([0-9]*\.?[0-9]+))?\]$/i.test(line)){
      const m = line.match(/^\[pause(\s*:\s*([0-9]*\.?[0-9]+))?\]$/i);
      const sec = m && m[2]? parseFloat(m[2]): defaultPause;
      events.push({type:'pause', sec: Math.max(0, sec||0)});
    } else if(line.startsWith('[Speaker 1]:')){
      events.push({type:'speak', voice:'v1', text: line.split(']:',2)[1].trim()});
    } else if(line.startsWith('[Speaker 2]:')){
      events.push({type:'speak', voice:'v2', text: line.split(']:',2)[1].trim()});
    } else if(/^Title\s*:/i.test(line)){
      // ignore title line
      continue;
    }
  }
  return events;
}

// PCM silence
function silencePCM(seconds){
  const frames = Math.max(0, Math.floor(seconds * RATE));
  return Buffer.alloc(frames * CHANS * (BITDEPTH/8));
}

// WAV header for 16-bit PCM mono
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

// TTS helpers
async function ttsPCM(voiceId, text){
  const url = `${API_ROOT}/text-to-speech/${encodeURIComponent(voiceId)}`;
  const params = { output_format: 'pcm_22050', model_id: 'eleven_multilingual_v2' };
  const r = await axios.post(url, { text }, {
    params,
    headers: {'xi-api-key':XI_KEY,'Content-Type':'application/json'},
    responseType:'arraybuffer', timeout:60000
  });
  // Defensive: ensure not MP3
  const ct = String(r.headers['content-type']||'').toLowerCase();
  if(ct.includes('audio/mpeg')) throw new Error('Got MP3 from API; expected PCM. Check output_format.');
  return Buffer.from(r.data);
}

// Optional MP3 path: use Text-to-Dialogue to produce a single MP3 (no gap-accurate pauses)
async function dialogueMP3(inputs, {output='mp3_44100_128'} = {}){
  // inputs: [{text, voice_id}, ...]
  const url = `${API_ROOT}/text-to-dialogue`;
  const r = await axios.post(url, { inputs }, {
    params: { output_format: output },
    headers: {'xi-api-key':XI_KEY,'Content-Type':'application/json'},
    responseType:'arraybuffer', timeout:120000
  });
  return Buffer.from(r.data);
}

// Minimal MP3 concatenation helper: remove ID3v2 (if present) from all but first; drop ID3v1 from all but last
function stripID3v2(buf){
  if (buf.length < 10) return buf;
  if (buf[0]===0x49 && buf[1]===0x44 && buf[2]===0x33){ // 'ID3'
    const size = ((buf[6]&0x7f)<<21) | ((buf[7]&0x7f)<<14) | ((buf[8]&0x7f)<<7) | (buf[9]&0x7f);
    const total = 10 + size;
    return buf.slice(total);
  }
  return buf;
}
function stripID3v1(buf){
  if (buf.length >= 128){
    const tail = buf.slice(buf.length-128);
    if (tail[0]===0x54 && tail[1]===0x41 && tail[2]===0x47){ // 'TAG'
      return buf.slice(0, buf.length-128);
    }
  }
  return buf;
}
function concatMP3(buffers){
  const parts = [];
  buffers.forEach((b,i)=>{
    let x = b;
    if(i>0) x = stripID3v2(x);
    if(i < buffers.length-1) x = stripID3v1(x);
    parts.push(x);
  });
  return Buffer.concat(parts);
}

async function ttsMP3(voiceId, text, {format='mp3_22050_64'} = {}){
  const url = `${API_ROOT}/text-to-speech/${encodeURIComponent(voiceId)}`;
  const params = { output_format: format, model_id: 'eleven_multilingual_v2' };
  const r = await axios.post(url, { text }, {
    params,
    headers: {'xi-api-key':XI_KEY,'Content-Type':'application/json'},
    responseType:'arraybuffer', timeout:60000
  });
  return Buffer.from(r.data); // MP3 bytes
}

// ============ Routes ============
app.get('/', async (req,res)=>{
  try{
    const voices = await listVoices();
    res.send(HTML(voices));
  }catch(e){
    res.status(500).send(HTML([], 'Failed to load voices: '+escapeHtml(e.message)));
  }
});

app.post('/generate', async (req,res)=>{
  const { script='', voice1, voice2, pauseDefault='1.2', format='wav', filename='conversation' } = req.body;
  const defaultPause = Math.max(0, parseFloat(pauseDefault)||0);
  if(!voice1 || !voice2){
    const voices = await listVoices().catch(()=>[]);
    return res.status(400).send(HTML(voices,'Please choose both voices.'));
  }
  try{
    const events = parseScript(script, defaultPause);

    if(format === 'wav'){
      // Gap-accurate path: build PCM then WAV
      const pcmParts = [];
      for(const ev of events){
        if(ev.type==='pause'){
          pcmParts.push(silencePCM(ev.sec));
        }else if(ev.type==='speak'){
          const voiceId = ev.voice==='v1'? voice1 : voice2;
          const pcm = await ttsPCM(voiceId, ev.text);
          pcmParts.push(pcm);
        }
      }
      const merged = Buffer.concat(pcmParts);
      const wav = wrapWav(merged);
      const name = (filename||'conversation').replace(/[^a-zA-Z0-9_\-]/g,'_') + '.wav';
      res.setHeader('Content-Type','audio/wav');
      res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
      return res.send(wav);
    }

    // MP3 options:
    //  A) Use text-to-dialogue to get single MP3 quickly (pauses not exact).
    //  B) Or stitch per-segment MP3s (basic ID3 header stripping). Timing may vary slightly.
    // Below implements (B) so your [pause] durations are respected by inserting silent PCM -> MP3 is not trivial without an encoder,
    // so we fall back to concatenating MP3 segments directly (works in many players, but may not be perfectly gapless).

    const mp3Parts = [];
    for(const ev of events){
      if(ev.type==='pause'){
        // For MP3 pause: synthesize a 'silence' clip using a dot and long punctuation won't be precise,
        // so instead request a 1-s silent MP3 workaround doesn't exist. We'll fake silence by using a short " " which is spoken as nothing is unreliable.
        // More reliable: generate a short MP3 of silence by hitting the TTS with a zero-width char; not guaranteed.
        // Simpler approach: generate a very short " " clip and hope model yields silence; repeat to approximate length.
        // For practicality, we generate silence by calling TTS on "." and trusting it to output a quiet blip; multiply to duration.
        const approx = Math.max(0.2, ev.sec); // seconds
        const dots = '.'.repeat(Math.ceil(approx/0.5)); // crude
        const m = await ttsMP3(voice1, dots); // use voice1 for silence filler
        mp3Parts.push(m);
      }else{
        const voiceId = ev.voice==='v1'? voice1 : voice2;
        mp3Parts.push(await ttsMP3(voiceId, ev.text));
      }
    }
    const mergedMP3 = concatMP3(mp3Parts);
    const name = (filename||'conversation').replace(/[^a-zA-Z0-9_\-]/g,'_') + '.mp3';
    res.setHeader('Content-Type','audio/mpeg');
    res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
    return res.send(mergedMP3);

  }catch(e){
    const voices = await listVoices().catch(()=>[]);
    return res.status(500).send(HTML(voices,'Synthesis failed: '+escapeHtml(e.message)));
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=>console.log('Listening on http://localhost:'+PORT));
