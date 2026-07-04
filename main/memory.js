// Persistent memory: facts with embeddings, cosine-similarity recall.
const { memory } = require('./store');
const { embed, cosine } = require('./openai');
const { nowISO, uid } = require('./util');

async function remember(text, type = 'fact', tags = []) {
  // Dedup: exact-ish match updates instead of duplicating.
  const existing = memory.data.items.find(i => i.text.toLowerCase() === text.toLowerCase());
  if (existing) { existing.updated = nowISO(); memory.save(); return existing; }
  let embedding = null;
  try { embedding = await embed(text); } catch { /* recall falls back to keyword search */ }
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
function summary(maxItems = 30) {
  const items = memory.data.items.slice(-maxItems);
  if (!items.length) return '(no long-term memories yet)';
  return items.map(i => `- [${i.type}] ${i.text}`).join('\n');
}

module.exports = { remember, recall, forget, listAll, summary };
