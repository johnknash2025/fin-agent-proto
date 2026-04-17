// Cloudflare Workers entry (no external deps)
// Minimal APIs:
// - GET /health
// - GET /api/holdings/:symbol -> R2: holdings/<symbol>.json
// - GET /api/series/:symbol -> R2: series/<symbol>.json (KV fallback)
// - GET /api/news?q=...&lang=ja -> NewsAPI with KV cache (JP->EN fallback)
// - POST /api/report -> generate Japanese report (敬体) with ASCII sparklines

type Env = {
  R2: R2Bucket;
  NEWS_CACHE: KVNamespace;
  SERIES_CACHE: KVNamespace;
  SUBS_KV: KVNamespace;
  NEWSAPI_KEY?: string;
  ALPHA_VANTAGE_KEY?: string;
  SEC_USER_AGENT?: string;
  DB?: D1Database;
  ASSETS: Fetcher;
};

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, ...init });
}

function notFound(msg = 'Not Found') { return jsonResponse({ ok: false, error: msg }, { status: 404 }); }
function badRequest(msg = 'Bad Request') { return jsonResponse({ ok: false, error: msg }, { status: 400 }); }
function unauthorized(msg = 'Unauthorized') { return jsonResponse({ ok: false, error: msg }, { status: 401 }); }

function asciiSparkline(values: number[]) {
  if (!values || values.length === 0) return '';
  const ticks = ['▁','▂','▃','▄','▅','▆','▇','█'];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map(v => ticks[Math.floor(((v - min) / span) * (ticks.length - 1))]).join('');
}
function round(n: number, d = 2) { return Math.round(n * 10 ** d) / 10 ** d; }

async function requireSubscriber(env: Env, req: Request) {
  // Simple paywall hook: expect Authorization: Bearer <token>, check presence in SUBS_KV
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, status: 401 };
  const token = m[1];
  const exists = await env.SUBS_KV.get(`sub:${token}`);
  if (!exists) return { ok: false, status: 403 };
  return { ok: true };
}

async function getR2Json(env: Env, key: string) {
  const obj = await env.R2.get(key);
  if (!obj) return null;
  const text = await obj.text();
  try { return JSON.parse(text); } catch { return null; }
}

import { getHoldings as dbGetHoldings, getSeries as dbGetSeries } from './db';

async function handleHoldings(env: Env, symbol: string) {
  if (env.DB) {
    const d1 = await dbGetHoldings(env, symbol);
    if (d1 && d1.length) return jsonResponse({ ok: true, data: { symbol, holdings: d1 } });
  }
  const key = `holdings/${symbol}.json`;
  const data = await getR2Json(env, key);
  if (!data) return notFound(`holdings not found: ${symbol}`);
  return jsonResponse({ ok: true, data });
}

async function handleSeries(env: Env, symbol: string) {
  // Try R2, then KV cache
  if (env.DB) {
    const d1 = await dbGetSeries(env, symbol);
    if (d1 && d1.length) return jsonResponse({ ok: true, data: { symbol, points: d1 } });
  }
  const key = `series/${symbol}.json`;
  const data = await getR2Json(env, key);
  if (data) return jsonResponse({ ok: true, data });
  const cached = await env.SERIES_CACHE.get(`series:${symbol}`, 'json');
  if (cached) return jsonResponse({ ok: true, data: cached });
  return notFound(`series not found: ${symbol}`);
}

async function handleNews(env: Env, q: string, lang?: string) {
  const cacheKey = `news:${(lang||'').trim()}:${q.trim()}`;
  const cached = await env.NEWS_CACHE.get(cacheKey, 'json');
  if (cached) return jsonResponse({ ok: true, cached: true, data: cached });
  const key = env.NEWSAPI_KEY;
  if (!key) return jsonResponse({ ok: true, cached: false, data: { items: [] } });
  const params = new URLSearchParams({ q, pageSize: '10', sortBy: 'publishedAt' });
  if (lang) params.set('language', lang);
  const url = `https://newsapi.org/v2/everything?${params.toString()}&apiKey=${key}`;
  const res = await fetch(url);
  if (!res.ok) return jsonResponse({ ok: false, error: `HTTP ${res.status}` }, { status: 502 });
  const json: any = await res.json();
  let items = (json.articles || []).map((a: any) => ({ title: a.title, url: a.url, publisher: a.source?.name, ts: a.publishedAt }));
  // JP->EN fallback when lang=ja yields empty
  if ((!items || items.length === 0) && lang === 'ja') {
    return handleNews(env, q, undefined);
  }
  const data = { items };
  await env.NEWS_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: 1800 });
  return jsonResponse({ ok: true, cached: false, data });
}

// --- Ingestion (Alpha Vantage) ---
type Point = { t: string; c: number };

async function fetchDailyAlphaVantage(symbol: string, key: string, size: 'compact'|'full' = 'compact'): Promise<Point[]> {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(symbol)}&outputsize=${size}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`alpha_vantage http ${res.status}`);
  const json: any = await res.json();
  const ts = json['Time Series (Daily)'] || json['Time Series Daily'] || null;
  if (!ts) return [];
  const points: Point[] = Object.keys(ts)
    .map(t => ({ t, c: Number(ts[t]['5. adjusted close'] ?? ts[t]['4. close'] ?? ts[t]['5. adjusted_close'] ?? ts[t]['close']) }))
    .filter(p => Number.isFinite(p.c))
    .sort((a,b)=> a.t < b.t ? 1 : -1) // newest first
    .reverse(); // oldest first
  return points;
}

async function upsertSeriesD1(env: Env, symbol: string, points: Point[]) {
  if (!env.DB || !points.length) return { inserted: 0 };
  const stmts: D1PreparedStatement[] = [] as any;
  for (const p of points) {
    const stmt = env.DB.prepare('INSERT OR REPLACE INTO series_daily(symbol, t, close) VALUES (?1, ?2, ?3)').bind(symbol, p.t, p.c);
    stmts.push(stmt);
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { inserted: stmts.length };
}

async function handleIngestSeries(env: Env, req: Request) {
  const body = await req.json().catch(()=>({}));
  const symbols: string[] = Array.isArray(body.symbols) ? body.symbols : [];
  const size = (body.size === 'full' ? 'full' : 'compact') as 'compact'|'full';
  const source = (body.source || 'alpha_vantage');
  let key: string | undefined = body.apikey || env.ALPHA_VANTAGE_KEY;
  if (source === 'alpha_vantage' && !key) return badRequest('Alpha Vantage API key required');
  const results: any[] = [];
  for (const sym of symbols) {
    try {
      let points: Point[] = [];
      if (source === 'alpha_vantage') points = await fetchDailyAlphaVantage(sym, key!, size);
      const r = await upsertSeriesD1(env, sym, points);
      results.push({ symbol: sym, ok: true, points: points.length, inserted: r.inserted });
    } catch (e: any) {
      results.push({ symbol: sym, ok: false, error: String(e?.message||e) });
    }
  }
  return jsonResponse({ ok: true, results });
}

async function handleSymbols(env: Env) {
  // Prefer DB if present, otherwise list R2
  let syms: string[] = [];
  if (env.DB) {
    try {
      const rs1 = await env.DB.prepare("SELECT DISTINCT symbol FROM series_daily LIMIT 1000").all();
      const rs2 = await env.DB.prepare("SELECT DISTINCT symbol FROM etf LIMIT 1000").all();
      const s = new Set<string>();
      for (const r of (rs1.results || [])) s.add(String((r as any).symbol));
      for (const r of (rs2.results || [])) s.add(String((r as any).symbol));
      syms = Array.from(s);
    } catch {}
  }
  if (!syms.length) {
    const series = await env.R2.list({ prefix: 'series/' });
    const holdings = await env.R2.list({ prefix: 'holdings/' });
    const s = new Set<string>();
    for (const it of series.objects || []) s.add(it.key.replace(/^series\//, '').replace(/\.json$/i, ''));
    for (const it of holdings.objects || []) s.add(it.key.replace(/^holdings\//, '').replace(/\.json$/i, ''));
    syms = Array.from(s);
  }
  return jsonResponse({ ok: true, symbols: syms.sort() });
}

async function handleUpload(env: Env, req: Request) {
  // Dev-only helper: write JSON body to R2
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return badRequest('json body required');
  const type = (body as any).type === 'holdings' ? 'holdings' : 'series';
  const symbol = String((body as any).symbol || '').trim();
  const data = (body as any).data;
  if (!symbol || !data) return badRequest('symbol and data required');
  const key = `${type}/${symbol}.json`;
  await env.R2.put(key, JSON.stringify(data), { httpMetadata: { contentType: 'application/json' } });
  return jsonResponse({ ok: true, key });
}

function jpReportHeader() {
  return [
    '## 目的',
    '- 本レポートは、資産運用のご判断を支援する目的で、保有資産の現状、最近の市場動向、関連ニュース・開示の要点、ならびに基本的な提案を簡潔に整理したものです。',
    '- 取引の最終判断はお客様ご自身でなさってください。必要に応じて専門家の助言をご検討ください。',
    ''
  ];
}

function sectionSummaryJa(sum: any) {
  return [
    '## サマリー',
    `- 総資産額: ${sum.totalValue.toLocaleString()}`,
    `- 取得原価合計: ${sum.totalCost.toLocaleString()}`,
    `- 含み損益: ${sum.totalPnl.toLocaleString()} (${round(sum.totalPnlPct*100)}%)`,
    `- 現金: ${(sum.cash||0).toLocaleString()}`,
    `- 最大ポジション集中度: ${round(sum.concentration*100)}%`,
    ''
  ];
}

function sectionEtfOverviewJa(items: any[]) {
  const out: string[] = [];
  if (items.length) out.push('## マーケット概況（指定ETF）');
  for (const it of items) {
    const { symbol, metrics, spark, topHoldings, hhi } = it;
    out.push(`- ${symbol}: 終値 ${round(metrics.last)}, 前日比 ${round(metrics.d1*100)}%, 1週 ${round(metrics.d5*100)}%, 1ヶ月 ${round(metrics.d21*100)}%, 年初来 ${round(metrics.ytd*100)}%  ${spark}`);
    if (topHoldings?.length) out.push(`  上位銘柄: ${topHoldings.map((h: any)=>`${h.symbol||h.name}:${round(h.weight)}%`).join(', ')}`);
    if (typeof hhi === 'number') out.push(`  分散指標(HHI): ${round(hhi*100)}`);
  }
  if (items.length) out.push('');
  return out;
}

function hhiFromWeights(weights: number[]) {
  return weights.reduce((a, w) => a + Math.pow((w||0)/100, 2), 0);
}

async function handleReport(env: Env, req: Request) {
  // Optionally enforce subscription for PRO features
  const url = new URL(req.url);
  const proOnly = url.searchParams.get('pro') === '1';
  if (proOnly) {
    const sub = await requireSubscriber(env, req);
    if (!sub.ok) return unauthorized();
  }
  const body = await req.json().catch(() => ({}));
  const etfs: string[] = Array.isArray(body.etfs) ? body.etfs.slice(0, 8) : [];
  const news: boolean = !!body.news;

  const etfItems: any[] = [];
  for (const sym of etfs) {
    // series (prefer D1)
    let points: any[] = [];
    if (env.DB) {
      const d1 = await dbGetSeries(env, sym);
      if (d1 && d1.length) points = d1;
    }
    if (!points.length) {
      const sres = await getR2Json(env, `series/${sym}.json`);
      points = sres?.points || [];
    }
    const closes = points.map(p=>Number(p.c)).filter((n)=>Number.isFinite(n));
    const last = closes.at(-1);
    const prev = closes.at(-2) || last;
    const d1 = prev ? (last - prev)/prev : 0;
    const d5 = closes.length > 5 ? (last - closes.at(-6))/closes.at(-6) : 0;
    const d21 = closes.length > 21 ? (last - closes.at(-22))/closes.at(-22) : 0;
    const thisYear = new Date().getFullYear().toString();
    const y0Idx = points.findIndex(p => String(p.t).startsWith(thisYear+'-'));
    const y0 = y0Idx >= 0 ? closes[y0Idx] : closes[0] || last;
    const ytd = y0 ? (last - y0)/y0 : 0;
    const spark = asciiSparkline(closes.slice(-30));

    // holdings (prefer D1)
    let holdings: any[] = [];
    if (env.DB) {
      const d1h = await dbGetHoldings(env, sym);
      if (d1h && d1h.length) holdings = d1h;
    }
    if (!holdings.length) {
      const hres = await getR2Json(env, `holdings/${sym}.json`);
      holdings = hres?.holdings || [];
    }
    const topHoldings = holdings.slice(0,5);
    const hhi = hhiFromWeights(holdings.map((h:any)=>Number(h.weight)||0));

    etfItems.push({ symbol: sym, metrics: { last, d1, d5, d21, ytd }, spark, topHoldings, hhi });
  }

  const mdLines: string[] = [ '# Daily Portfolio Report', ...jpReportHeader(), ...sectionEtfOverviewJa(etfItems) ];

  if (news) {
    const q = etfs.length ? etfs.join(' OR ') : '市場 金融 決算';
    const res = await handleNews(env, q, 'ja');
    try {
      const payload = await res.json();
      const items = payload?.data?.items || [];
      if (items.length) {
        mdLines.push('## ニュース見出し');
        for (const it of items.slice(0,8)) mdLines.push(`- ${it.title} (${it.publisher||'Unknown'})`);
        mdLines.push('');
      }
    } catch {}
  }

  return jsonResponse({ ok: true, markdown: mdLines.join('\n'), etfItems });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname, searchParams } = new URL(req.url);
    if (pathname === '/health') return jsonResponse({ ok: true, ts: new Date().toISOString() });

    // Holdings from R2
    if (pathname.startsWith('/api/holdings/')) {
      const symbol = decodeURIComponent(pathname.split('/').pop() || '').trim();
      if (!symbol) return badRequest('symbol required');
      return handleHoldings(env, symbol);
    }
    // Series from R2 or KV
    if (pathname.startsWith('/api/series/')) {
      const symbol = decodeURIComponent(pathname.split('/').pop() || '').trim();
      if (!symbol) return badRequest('symbol required');
      return handleSeries(env, symbol);
    }
    // News with KV cache
    if (pathname === '/api/news') {
      const q = searchParams.get('q') || '';
      const lang = searchParams.get('lang') || undefined;
      if (!q) return badRequest('q required');
      return handleNews(env, q, lang);
    }
    // Report (POST)
    if (pathname === '/api/report' && req.method === 'POST') {
      return handleReport(env, req);
    }
    if (pathname === '/api/symbols') {
      return handleSymbols(env);
    }
    if (pathname === '/api/upload' && req.method === 'POST') {
      return handleUpload(env, req);
    }
    if (pathname === '/api/ingest_series' && req.method === 'POST') {
      return handleIngestSeries(env, req);
    }

    // Fall back to static assets (UI)
    return env.ASSETS.fetch(req);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    try {
      const key = env.ALPHA_VANTAGE_KEY;
      const list = (env as any as { SERIES_DEFAULT?: string }).SERIES_DEFAULT || '';
      const symbols = list.split(',').map(s=>s.trim()).filter(Boolean).slice(0,50);
      if (!key || !symbols.length) return;
      for (const sym of symbols) {
        const points = await fetchDailyAlphaVantage(sym, key, 'compact');
        await upsertSeriesD1(env, sym, points);
      }
    } catch {}
  }
};
