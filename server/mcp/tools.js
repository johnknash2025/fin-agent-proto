const path = require('path');
const { loadLocalPortfolio } = require('../../src/providers/portfolio/local');
const { loadLocalPrices } = require('../../src/providers/quotes/local');
const { ingestFile, ingestText, query: ragQuery } = require('../rag');
const { fetchAndIngestEdgar } = require('../ingest/edgar');

function nowIso() { return new Date().toISOString(); }

function ok(provider, data, extra = {}) {
  return { ok: true, data, observability: { provider, ts: nowIso(), ...extra } };
}

function err(provider, message, extra = {}) {
  return { ok: false, error: message, observability: { provider, ts: nowIso(), ...extra } };
}

// get_portfolio({ source = 'local', file })
async function get_portfolio(args = {}) {
  const source = args.source || 'local';
  if (source === 'local') {
    const file = args.file || process.env.PORTFOLIO_JSON || path.join(process.cwd(), 'data/portfolio.sample.json');
    try {
      const portfolio = loadLocalPortfolio(file);
      return ok('local', portfolio);
    } catch (e) {
      return err('local', `Failed to load portfolio: ${e.message}`);
    }
  }
  return err(source, `Unsupported portfolio source: ${source}`);
}

// get_quotes({ symbols: string[], source = 'local', file })
async function get_quotes(args = {}) {
  const source = args.source || 'local';
  const symbols = Array.isArray(args.symbols) ? args.symbols : [];
  if (source === 'local') {
    const file = args.file || process.env.PRICES_JSON || path.join(process.cwd(), 'data/prices.sample.json');
    try {
      const prices = loadLocalPrices(file);
      const map = new Map((prices.quotes || []).map(q => [q.symbol, q.price]));
      const out = symbols.length ? symbols.map(s => ({ symbol: s, price: map.get(s) ?? null })) : (prices.quotes || []);
      return ok('local', { as_of: prices.as_of, quotes: out });
    } catch (e) {
      return err('local', `Failed to load prices: ${e.message}`);
    }
  }
  if (source === 'alpha_vantage') {
    const key = process.env.ALPHA_VANTAGE_KEY;
    if (!key) return err(source, 'Missing env ALPHA_VANTAGE_KEY');
    try {
      const mode = args.mode || 'global'; // 'global' | 'daily'
      const results = [];
      for (const sym of symbols) {
        let price = null;
        let as_of = null;
        if (mode === 'global') {
          const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${key}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const g = json['Global Quote'] || {};
          price = g['05. price'] ? parseFloat(g['05. price']) : null;
          as_of = g['07. latest trading day'] || null;
          if (!price && (json['Note'] || json['Information'] || json['Error Message'])) {
            return err(source, json['Note'] || json['Information'] || json['Error Message']);
          }
        } else {
          const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(sym)}&apikey=${key}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const series = json['Time Series (Daily)'] || {};
          const last = Object.keys(series).sort().pop();
          price = last ? parseFloat(series[last]['4. close']) : null;
          as_of = last || null;
          if (!price && (json['Note'] || json['Information'] || json['Error Message'])) {
            return err(source, json['Note'] || json['Information'] || json['Error Message']);
          }
        }
        results.push({ symbol: sym, price, as_of });
      }
      return ok(source, { quotes: results });
    } catch (e) {
      return err(source, `Fetch failed: ${e.message}`);
    }
  }
  return err(source, `Unsupported quotes source: ${source}`);
}

// search_news({symbols?, query?, from?, to?, source='local'})
async function search_news(args = {}) {
  const source = args.source || 'local';
  if (source === 'local') {
    const items = [
      { title: 'Sample headline A', url: 'https://example.com/a', publisher: 'Example', ts: nowIso(), symbols: args.symbols || [] },
      { title: 'Sample headline B', url: 'https://example.com/b', publisher: 'Example', ts: nowIso(), symbols: args.symbols || [] }
    ];
    return ok('local', { items });
  }
  if (source === 'newsapi') {
    const key = process.env.NEWSAPI_KEY;
    if (!key) return err(source, 'Missing env NEWSAPI_KEY');
    const q = args.query || (Array.isArray(args.symbols) ? args.symbols.join(' OR ') : 'market');
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&pageSize=10&sortBy=publishedAt&apiKey=${key}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items = (json.articles || []).map(a => ({ title: a.title, url: a.url, publisher: a.source?.name, ts: a.publishedAt }));
      return ok(source, { items });
    } catch (e) {
      return err(source, `Fetch failed: ${e.message}`);
    }
  }
  return err(source, `Unsupported news source: ${source}`);
}

// get_filings({ symbol, source='local' })
async function get_filings(args = {}) {
  const source = args.source || 'local';
  if (source === 'local') {
    return ok('local', { items: [ { symbol: args.symbol || 'AAPL', form: '10-K', filed_at: '2025-02-01', url: 'https://www.sec.gov/...' } ] });
  }
  return err(source, `Unsupported filings source: ${source}`);
}

// place_order({ intent }) – stub, requires manual approval always
async function place_order(args = {}) {
  return err('manual', 'Order placement requires explicit user approval');
}

// ingest_corpus({ text?, file?, meta? }) – local RAG store
async function ingest_corpus(args = {}) {
  try {
    if (args.file) {
      const res = ingestFile({ file: args.file, meta: args.meta || {} });
      return ok('rag_local', res);
    }
    if (args.text) {
      const res = ingestText({ text: args.text, meta: args.meta || {}, source: 'text' });
      return ok('rag_local', res);
    }
    return err('rag_local', 'Must provide file or text');
  } catch (e) {
    return err('rag_local', e.message);
  }
}

// query_corpus({ q, k }) – retrieve top-k chunks
async function query_corpus(args = {}) {
  try {
    const hits = ragQuery({ q: args.q || '', k: args.k || 5 });
    return ok('rag_local', { hits });
  } catch (e) {
    return err('rag_local', e.message);
  }
}

// fetch_edgar_and_ingest({ symbol, forms?, limit? })
async function fetch_edgar_and_ingest(args = {}) {
  try {
    const symbol = args.symbol || 'AAPL';
    const forms = Array.isArray(args.forms) ? args.forms : ['10-K','10-Q','8-K'];
    const limit = args.limit || 1;
    const res = await fetchAndIngestEdgar({ symbol, forms, limit });
    return ok('edgar', res);
  } catch (e) {
    return err('edgar', e.message);
  }
}

module.exports = {
  get_portfolio,
  get_quotes,
  search_news,
  get_filings,
  place_order,
  ingest_corpus,
  query_corpus,
  fetch_edgar_and_ingest
};
