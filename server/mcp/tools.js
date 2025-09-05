const path = require('path');
const { loadLocalPortfolio } = require('../../src/providers/portfolio/local');
const { loadLocalPrices } = require('../../src/providers/quotes/local');

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
      const results = [];
      for (const sym of symbols) {
        const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(sym)}&apikey=${key}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const series = json['Time Series (Daily)'] || {};
        const last = Object.keys(series).sort().pop();
        const price = last ? parseFloat(series[last]['4. close']) : null;
        results.push({ symbol: sym, price, as_of: last || null });
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

module.exports = {
  get_portfolio,
  get_quotes,
  search_news,
  get_filings,
  place_order
};

