// Persistent memory: facts with embeddings, cosine-similarity recall.
const { memory } = require('./store');
const { embed, cosine } = require('./openai');
const { nowISO, uid } = require('./util');

async function remember(text, type = 'fact', tags = []) {
  // Exact match → touch timestamp.
  const exact = memory.data.items.find(i => i.text.toLowerCase() === text.toLowerCase());
  if (exact) { exact.updated = nowISO(); memory.save(); return { id: exact.id, text: exact.text, updated: true }; }
  let embedding = null;
  try { embedding = await embed(text); } catch { /* recall falls back to keyword search */ }
  // Semantic dedupe: "likes short answers" shouldn't accrete next to
  // "prefers brief replies" — update the near-duplicate instead.
  if (embedding) {
    for (const i of memory.data.items) {
      if (i.embedding && cosine(embedding, i.embedding) > 0.92) {
        i.text = text; i.embedding = embedding; i.type = type; i.updated = nowISO();
        memory.save();
        return { id: i.id, text, updated: true, note: 'merged with a near-duplicate memory' };
      }
    }
  }
  const item = { id: uid('m_'), text, type, tags, embedding, created: nowISO() };
  memory.data.items.push(item);
  memory.save();
  return { id: item.id, text, type };
}

async function recall(query, limit = 6) {
  const items = memory.data.items;
  if (!items.length) return [];
  let scored;
  try {
    const q = await embed(query);
    scored = items.map(i => ({ i, s: i.embedding ? cosine(q, i.embedding) : kw(query, i.text) }));
  } catch {
    scored = items.map(i => ({ i, s: kw(query, i.text) }));
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit)
    .filter(x => x.s > 0.15)
    .map(x => ({ id: x.i.id, text: x.i.text, type: x.i.type, created: x.i.created, score: +x.s.toFixed(3) }));
}

function kw(query, text) {
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  const t = text.toLowerCase();
  return words.filter(w => t.includes(w)).length / Math.max(words.length, 1);
}

function forget(idOrQuery) {
  const before = memory.data.items.length;
  const byId = memory.data.items.find(i => i.id === idOrQuery);
  if (byId) memory.data.items = memory.data.items.filter(i => i.id !== idOrQuery);
  else memory.data.items = memory.data.items.filter(i => !i.text.toLowerCase().includes(idOrQuery.toLowerCase()));
  memory.save();
  return { forgotten: before - memory.data.items.length };
}

function listAll() {
  return memory.data.items.map(i => ({ id: i.id, text: i.text, type: i.type, created: i.created }));
}

// Compact summary injected into session instructions at startup.
// Relevance over recency: always-on identity/preference facts only — the
// model calls recall() for everything else mid-conversation.
const IDENTITY_RE = /\bname\b|prefers?|likes?|dislikes?|works (as|at|on)|lives in|is from|birthday|allerg/i;
function summary(maxLines = 12) {
  const items = memory.data.items;
  if (!items.length) return '(no long-term memories yet)';
  const prefs = items.filter(i => i.type === 'preference');
  const identity = items.filter(i => i.type !== 'preference' && i.type !== 'episode' && IDENTITY_RE.test(i.text));
  let pick = [...prefs, ...identity].slice(-maxLines);
  if (!pick.length) pick = items.filter(i => i.type !== 'episode').slice(-5);
  return pick.map(i => `- [${i.type}] ${i.text}`).join('\n');
}

module.exports = { remember, recall, forget, listAll, summary };
