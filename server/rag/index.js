const fs = require('fs');
const path = require('path');
const { tokenize, tfVector, cosineSim, hash } = require('./util');
const { loadStore, saveStore } = require('./store');

function chunkText(text, opts = {}) {
  const size = opts.size || 900;
  const overlap = opts.overlap || 120;
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + size);
    const chunk = text.slice(i, end);
    chunks.push(chunk.trim());
    if (end === text.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks.filter(Boolean);
}

function ingestText({ text, meta = {}, source = 'local' }) {
  const store = loadStore();
  const chunks = chunkText(text);
  const added = [];
  for (const ch of chunks) {
    const id = hash(ch);
    if (store.chunks.find(c => c.id === id)) continue;
    const tokens = tokenize(ch);
    const { tf, norm } = tfVector(tokens);
    const rec = { id, source, meta, text: ch, tf, norm };
    store.chunks.push(rec);
    added.push(id);
  }
  saveStore(store);
  return { added, total: store.chunks.length };
}

function ingestFile({ file, meta = {}, source = 'file' }) {
  const ext = path.extname(file).toLowerCase();
  if (!fs.existsSync(file)) throw new Error(`file not found: ${file}`);
  if (ext === '.txt' || ext === '.md') {
    const text = fs.readFileSync(file, 'utf8');
    return ingestText({ text, meta: { ...meta, file }, source });
  }
  throw new Error(`unsupported file type: ${ext} (use .txt or .md)`);
}

function query({ q, k = 5 }) {
  const store = loadStore();
  const tokens = tokenize(q || '');
  const qv = tfVector(tokens);
  const scored = store.chunks.map(c => ({ id: c.id, score: cosineSim(qv, c), meta: c.meta, text: c.text }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

module.exports = { ingestText, ingestFile, query };

