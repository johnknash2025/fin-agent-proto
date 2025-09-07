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

async function handleHoldings(env: Env, symbol: string) {
  const key = `holdings/${symbol}.json`;
  const data = await getR2Json(env, key);
  if (!data) return notFound(`holdings not found: ${symbol}`);
  return jsonResponse({ ok: true, data });
}

async function handleSeries(env: Env, symbol: string) {
  // Try R2, then KV cache
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

function jpReportHeader() {
  return [
    '## 目的',
    '- 本レポートは、資産運用のご判断を支援する目的で、保有資産の現状、最近の市場動向、関連ニュース・開示の要点、ならびに基本的な提案を簡潔に整理したものです。',
    '- 取引の最終判断はお客様ご自身でなさってください。必要に応じて専門家の助言をご検討ください。',
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
      // Parse options
      const body = await req.json().catch(() => ({}));
      const etfs: string[] = Array.isArray(body.etfs) ? body.etfs.slice(0, 8) : [];
      const news: boolean = !!body.news;

      const etfItems: any[] = [];
      for (const sym of etfs) {
        // series
        const sres = await getR2Json(env, `series/${sym}.json`);
        const points: any[] = sres?.points || [];
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

        // holdings
        const hres = await getR2Json(env, `holdings/${sym}.json`);
        const topHoldings = (hres?.holdings || []).slice(0,5);
        const hhi = hhiFromWeights((hres?.holdings||[]).map((h:any)=>Number(h.weight)||0));

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

    return notFound();
  }
};

