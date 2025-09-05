const fs = require('fs');
const path = require('path');

const STORE_DIR = path.join(process.cwd(), 'rag', 'store');
const STORE_FILE = path.join(STORE_DIR, 'chunks.json');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function loadStore() {
  try {
    const txt = fs.readFileSync(STORE_FILE, 'utf8');
    return JSON.parse(txt);
  } catch {
    return { version: 1, chunks: [] };
  }
}

function saveStore(store) {
  ensureDir(STORE_DIR);
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

module.exports = { STORE_DIR, STORE_FILE, loadStore, saveStore };

