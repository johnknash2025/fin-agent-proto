const fs = require('fs');
const path = require('path');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQ = false;
  while (i <= text.length) {
    const c = text[i] || '\n';
    if (inQ) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else { inQ = false; }
      } else { field += c; }
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field=''; }
      else if (c === '\n' || c === '\r') {
        if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field=''; }
      } else { field += c; }
    }
    i++;
  }
  return rows.filter(r => r.length > 0);
}

function toHoldingsJSON(rows) {
  const header = rows[0].map(h => h.trim().toLowerCase());
  const body = rows.slice(1);
  const findCol = (...candidates) => {
    for (const c of candidates) {
      const idx = header.indexOf(c);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const iSym = findCol('symbol','ticker','isin','sedol');
  const iName = findCol('name','company','holding name');
  const iWgt = findCol('weight','weighting','% weight','weight (%)');
  const holdings = [];
  for (const r of body) {
    const symbol = iSym >= 0 ? (r[iSym] || '').trim() : '';
    const name = iName >= 0 ? (r[iName] || '').trim() : '';
    let weight = 0;
    if (iWgt >= 0) {
      const raw = (r[iWgt] || '').replace('%','').trim();
      const v = parseFloat(raw);
      if (!Number.isNaN(v)) weight = v;
    }
    if (symbol || name) holdings.push({ symbol, name, weight });
  }
  return holdings;
}

async function ingestHoldings({ symbol, url, file }) {
  if (!symbol) throw new Error('symbol is required');
  let csv = '';
  if (url) {
    const res = await fetch(url, { headers: { 'Accept': 'text/csv, text/plain, */*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    csv = await res.text();
  } else if (file) {
    csv = fs.readFileSync(file, 'utf8');
  } else {
    throw new Error('either url or file is required');
  }
  const rows = parseCSV(csv);
  if (!rows.length) throw new Error('CSV is empty');
  const holdings = toHoldingsJSON(rows);
  const out = { symbol, as_of: new Date().toISOString().slice(0,10), source: url ? 'url' : 'file', holdings };
  const outPath = path.join(process.cwd(), 'data', `holdings.${symbol}.json`);
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  return { file: outPath, count: holdings.length };
}

module.exports = { ingestHoldings };

