#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Load .env if present for API keys
try { require('../server/env').config(); } catch {}

const { loadLocalPortfolio } = require('./providers/portfolio/local');
const { loadLocalPrices } = require('./providers/quotes/local');
const { buildReport } = require('./agent/report');
const { buildRecommendations } = require('./agent/recommend');
const mcpTools = require('../server/mcp/tools');

function parseArgs(argv) {
  const args = { data: null, prices: null, out: 'out', news: false, edgar: '', lang: 'ja', market: false, etfs: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') args.data = argv[++i];
    else if (a === '--prices') args.prices = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--news') args.news = true;
    else if (a === '--edgar') args.edgar = argv[++i] || '';
    else if (a === '--lang') args.lang = argv[++i] || 'ja';
    else if (a === '--market') args.market = true;
    else if (a === '--etfs') args.etfs = argv[++i] || '';
  }
  if (!args.data || !args.prices) {
    console.error('Usage: node src/cli.js --data <portfolio.json> --prices <prices.json> [--out out]');
    process.exit(1);
  }
  return args;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFileSyncSafe(p, content) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content);
}

function asciiSparkline(arr) {
  if (!arr || arr.length === 0) return '';
  const ticks = ['▁','▂','▃','▄','▅','▆','▇','█'];
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const span = max - min || 1;
  return arr.map(v => ticks[Math.floor(((v - min) / span) * (ticks.length - 1))]).join('');
}

function round(n, d = 2) { return Math.round(n * 10 ** d) / 10 ** d; }

async function main() {
  const args = parseArgs(process.argv);
  const portfolio = loadLocalPortfolio(args.data);
  const prices = loadLocalPrices(args.prices);

  const report = buildReport({ portfolio, prices, lang: args.lang });
  const suggestions = buildRecommendations(report);

  const outDir = args.out;
  ensureDir(outDir);

  const mdSections = ['# Daily Portfolio Report', '', ...report.markdown];

  // Optionally append News headlines via NewsAPI
  if (args.news) {
    try {
      const syms = (portfolio.positions || []).map(p => p.symbol).slice(0, 6);
      const query = syms.length ? syms.join(' OR ') : 'stocks market earnings guidance';
      let news = await mcpTools.search_news({ source: 'newsapi', query, language: args.lang === 'ja' ? 'ja' : undefined });
      let items = (news.ok && news.data?.items) ? news.data.items.slice(0, 8) : [];
      if (items.length === 0 && args.lang === 'ja') {
        // fallback to English if no JP results
        news = await mcpTools.search_news({ source: 'newsapi', query });
        items = (news.ok && news.data?.items) ? news.data.items.slice(0, 8) : [];
      }
      if (items.length) {
        mdSections.push('', args.lang === 'ja' ? '## ニュース見出し' : '## News Headlines');
        items.forEach(it => {
          mdSections.push(`- ${it.title} (${it.publisher || 'Unknown'})`);
        });
      }
    } catch (e) {
      mdSections.push('', `> News fetch error: ${e.message}`);
    }
  }

  // Optional: Market overview for major ETFs/stocks
  if (args.market) {
    const universe = (args.etfs ? args.etfs.split(',').map(s => s.trim()).filter(Boolean) : ['VOO','1489.T']).slice(0, 6);
    const lines = [];
    const { loadLocalHoldings } = require('./providers/holdings/local');
    function hhi(ws) { return ws.reduce((a, w) => a + Math.pow(w/100, 2), 0); }
    for (const sym of universe) {
      try {
        let ser = await mcpTools.get_series({ symbol: sym, source: 'alpha_vantage', outputsize: 'compact' });
        if (!ser.ok) {
          // fallback to local sample series
          ser = await mcpTools.get_series({ symbol: sym, source: 'local' });
        }
        if (!ser.ok) { lines.push(`- ${sym}: 価格系列の取得に失敗しました (${ser.error || 'unknown'})`); continue; }
        const pts = ser.data.points.slice(-90); // 3か月目安
        if (pts.length < 10) continue;
        const closes = pts.map(p => p.c);
        const last = closes[closes.length - 1];
        const prev = closes[closes.length - 2];
        const d1 = (last - prev) / prev;
        const d5 = closes.length > 5 ? (last - closes[closes.length - 6]) / closes[closes.length - 6] : 0;
        const d21 = closes.length > 21 ? (last - closes[closes.length - 22]) / closes[closes.length - 22] : 0;
        const ytdBaseIdx = pts.findIndex(p => p.t.startsWith(new Date().getFullYear() + '-'));
        const y0 = ytdBaseIdx >= 0 ? closes[ytdBaseIdx] : closes[0];
        const ytd = (last - y0) / y0;
        const spark = asciiSparkline(closes.slice(-30));
        // holdings summary (top 5 + HHI)
        const hd = loadLocalHoldings(sym);
        const top = hd.holdings.slice(0, 5);
        const hhiVal = hhi(hd.holdings.map(h => h.weight || 0));
        const topStr = top.map(h => `${h.symbol || h.name}:${round((h.weight||0))}%`).join(', ');
        const conc = round(hhiVal*100); // rough interpretation
        lines.push(`- ${sym}: 終値 ${round(last)}, 前日比 ${round(d1*100)}%, 1週 ${round(d5*100)}%, 1ヶ月 ${round(d21*100)}%, 年初来 ${round(ytd*100)}%  ${spark}`);
        if (top.length) lines.push(`  上位銘柄: ${topStr}`);
        if (hd.holdings.length) lines.push(`  分散指標(HHI): ${conc}`);
      } catch {}
    }
    if (lines.length) {
      mdSections.push('', args.lang === 'ja' ? '## マーケット概況（指定ETF）' : '## Market Overview (ETFs)');
      mdSections.push(...lines);
    }
  }

  // Optionally fetch+ingest EDGAR filings, then list the fetched items (meta)
  if (args.edgar) {
    const targetSyms = args.edgar === 'all'
      ? (portfolio.positions || []).map(p => p.symbol)
      : args.edgar.split(',').map(s => s.trim()).filter(Boolean);
    const filingsMeta = [];
    const filingErrors = [];
    for (const sym of targetSyms) {
      try {
        const res = await mcpTools.fetch_edgar_and_ingest({ symbol: sym, forms: ['10-K','10-Q'], limit: 1 });
        if (res.ok && res.data?.items?.length) {
          res.data.items.forEach(it => filingsMeta.push(it));
        } else if (!res.ok) {
          filingErrors.push(`${sym}: ${res.error || 'unknown error'}`);
        }
      } catch (e) {
        filingErrors.push(`${sym}: ${e.message}`);
      }
    }
    if (filingsMeta.length || filingErrors.length) {
      mdSections.push('', '## Filings Ingested');
      filingsMeta.forEach(f => {
        const tag = [f.symbol, f.form, f.filed_at].filter(Boolean).join(' / ');
        mdSections.push(`- ${tag}`);
      });
      if (!filingsMeta.length && filingErrors.length) {
        mdSections.push(`- (no filings ingested) ${filingErrors.join('; ')}`);
      }
    }
  }

  mdSections.push('', (args.lang === 'ja' ? '## 提案' : '## Suggestions'), '', ...suggestions.markdown, '');

  const md = mdSections.join('\n');
  const json = { report: report.json, suggestions: suggestions.json };

  writeFileSyncSafe(path.join(outDir, 'report.md'), md);
  writeFileSyncSafe(path.join(outDir, 'report.json'), JSON.stringify(json, null, 2));

  console.log(`Wrote: ${path.join(outDir, 'report.md')} and report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
