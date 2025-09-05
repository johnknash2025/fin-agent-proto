const fs = require('fs');
const path = require('path');
const { ingestText } = require('../rag');

const SEC_UA = process.env.SEC_USER_AGENT || 'fin-agent-proto (https://github.com/johnknash2025/fin-agent-proto)';

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': SEC_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function cachePath(...parts) {
  return path.join(process.cwd(), 'rag', 'cache', ...parts);
}

async function resolveCikByTicker(ticker) {
  const cacheFile = cachePath('sec_tickers.json');
  let map = null;
  try {
    const txt = fs.readFileSync(cacheFile, 'utf8');
    map = JSON.parse(txt);
  } catch {
    const json = await fetchJson('https://www.sec.gov/files/company_tickers.json');
    map = json;
    ensureDir(path.dirname(cacheFile));
    fs.writeFileSync(cacheFile, JSON.stringify(map, null, 2));
  }
  const t = (ticker || '').toUpperCase();
  const arr = Array.isArray(map) ? map : Object.values(map);
  for (const row of arr) {
    if ((row.ticker || '').toUpperCase() === t) {
      const cik = String(row.cik_str || row.cik || '').padStart(10, '0');
      return cik;
    }
  }
  throw new Error(`CIK not found for ticker ${ticker}`);
}

async function getCompanySubmissions(cik) {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  return fetchJson(url);
}

function buildDocUrl(cik, accession, primaryDocument) {
  const cikNum = String(parseInt(cik, 10));
  const acc = String(accession).replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${primaryDocument}`;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchLatestFilingsMeta(cik, forms = ['10-K','10-Q','8-K'], limit = 1) {
  const sub = await getCompanySubmissions(cik);
  const recent = sub?.filings?.recent;
  if (!recent) return [];
  const out = [];
  for (let i = 0; i < recent.accessionNumber.length; i++) {
    const form = recent.form[i];
    if (!forms.includes(form)) continue;
    const meta = {
      accession: recent.accessionNumber[i],
      primaryDocument: recent.primaryDocument[i],
      filedAt: recent.filingDate[i],
      form,
    };
    out.push(meta);
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchAndIngestEdgar({ symbol, forms = ['10-K','10-Q','8-K'], limit = 1 }) {
  const cik = await resolveCikByTicker(symbol);
  const metas = await fetchLatestFilingsMeta(cik, forms, limit);
  const ingested = [];
  for (const m of metas) {
    const url = buildDocUrl(cik, m.accession, m.primaryDocument);
    const savePath = cachePath('edgar', cik, m.accession.replace(/-/g,''), m.primaryDocument);
    ensureDir(path.dirname(savePath));
    try {
      const content = await fetchText(url);
      fs.writeFileSync(savePath, content);
      const ext = path.extname(m.primaryDocument).toLowerCase();
      if (ext === '.htm' || ext === '.html' || ext === '.txt') {
        const text = ext === '.txt' ? content : stripHtml(content);
        const meta = { source: 'edgar', symbol, cik, form: m.form, filed_at: m.filedAt, url };
        ingestText({ text, meta, source: 'edgar' });
        ingested.push({ ...meta, cached: savePath });
      } else {
        ingested.push({ symbol, cik, form: m.form, filed_at: m.filedAt, url, cached: savePath, note: 'unsupported doc type for ingestion' });
      }
    } catch (e) {
      ingested.push({ symbol, cik, error: e.message, url });
    }
  }
  return { cik, count: ingested.length, items: ingested };
}

module.exports = { fetchAndIngestEdgar };

