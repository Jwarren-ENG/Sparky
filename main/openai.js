// OpenAI REST helpers. The API key lives only in the main process.
const fs = require('fs');
const path = require('path');
const { ARTIFACT_DIR, uid, fetchT } = require('./util');

const API = 'https://api.openai.com/v1';
const key = () => process.env.OPENAI_API_KEY;

async function oai(pathname, body, opts = {}) {
  const res = await fetchT(API + pathname, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
  }, opts.timeoutMs || 30000);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`OpenAI ${pathname} ${res.status}: ${text.slice(0, 500)}`);
  return json;
}

// Mint an ephemeral client secret for a Realtime session (WebRTC happens in renderer).
async function mintRealtimeSecret(sessionConfig) {
  const crypto = require('crypto');
  return oai('/realtime/client_secrets', { session: sessionConfig }, {
    headers: { 'OpenAI-Safety-Identifier': crypto.createHash('sha256').update('sparky-local-desktop').digest('hex') },
  });
}

async function embed(text) {
  const j = await oai('/embeddings', { model: process.env.EMBED_MODEL || 'text-embedding-3-small', input: text.slice(0, 8000) });
  return j.data[0].embedding;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Text (and optional image) → answer, via the utility model.
async function utility(prompt, imagePath) {
  const content = [{ type: 'text', text: prompt }];
  if (imagePath) {
    const b64 = fs.readFileSync(imagePath).toString('base64');
    content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
  }
  const j = await oai('/chat/completions', {
    model: process.env.UTILITY_MODEL || 'gpt-5-mini',
    messages: [{ role: 'user', content }],
  }, { timeoutMs: 45000 });
  return j.choices[0].message.content;
}

async function transcribeWebm(buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/webm' }), 'audio.webm');
  form.append('model', process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
  form.append('language', process.env.SPEECH_LANGUAGE || 'en');
  const res = await fetchT(API + '/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: form,
  }, 20000);
  if (!res.ok) throw new Error(`transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).text || '';
}

async function generateImage(prompt, size = '1024x1024') {
  const j = await oai('/images/generations', { model: process.env.IMAGE_MODEL || 'gpt-image-1', prompt, size, n: 1 }, { timeoutMs: 90000 });
  const b64 = j.data[0].b64_json;
  const file = path.join(ARTIFACT_DIR, `img_${uid()}.png`);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}

module.exports = { mintRealtimeSecret, embed, cosine, utility, transcribeWebm, generateImage };
