async function jget(url, opts = {}) {
  const res = await fetch(url, opts);
  const txt = await res.text().catch(() => "");
  try { return { ok: res.ok, data: JSON.parse(txt) }; } catch { return { ok: res.ok, data: txt }; }
}

function $(sel) { return document.querySelector(sel); }
function show(el, val) { el.textContent = typeof val === 'string' ? val : JSON.stringify(val, null, 2); }

function mdToHtml(md) {
  const esc = (s)=>s.replace(/[&<>]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  let html = '';
  for (const line of md.split(/\r?\n/)) {
    if (/^#\s+/.test(line)) html += `<h1>${esc(line.replace(/^#\s+/,''))}</h1>`;
    else if (/^##\s+/.test(line)) html += `<h2>${esc(line.replace(/^##\s+/,''))}</h2>`;
    else if (/^\-\s+/.test(line)) html += `<li>${esc(line.replace(/^\-\s+/,''))}</li>`;
    else if (line.trim()==='') html += '\n';
    else html += `<p>${esc(line)}</p>`;
  }
  html = html.replace(/(?:\n?<li>[^<]+<\/li>\n?)+/g, m=>`<ul>${m.replace(/\n/g,'')}</ul>`);
  return html;
}

function drawLineChart(canvas, values) {
  if (!canvas || !values || !values.length) return;
  const ctx = canvas.getContext('2d');
  const cw = canvas.clientWidth || 600;
  const ch = canvas.clientHeight || 120;
  const w = canvas.width = cw * devicePixelRatio;
  const h = canvas.height = ch * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0,0,w,h);
  const pad = 8; const innerW = w/devicePixelRatio - pad*2; const innerH = h/devicePixelRatio - pad*2;
  const min = Math.min(...values); const max = Math.max(...values); const span = (max-min)||1;
  ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v,i)=>{
    const x = pad + innerW * (i/(values.length-1));
    const y = pad + innerH * (1 - (v-min)/span);
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

function tvSymbol(sym) {
  // Basic mapping for common markets
  if (sym.includes(':')) return sym; // already qualified like NASDAQ:AAPL
  if (/\.T$/i.test(sym)) {
    // Tokyo symbols often numeric like 1655.T -> TSE:1655
    const base = sym.replace(/\.T$/i, '');
    return `TSE:${base}`;
  }
  // Common US ETFs/stocks
  const map = {
    'VOO': 'NYSEARCA:VOO',
    'SPY': 'NYSEARCA:SPY',
    'QQQ': 'NASDAQ:QQQ',
    'AAPL': 'NASDAQ:AAPL',
    'MSFT': 'NASDAQ:MSFT',
    'NVDA': 'NASDAQ:NVDA',
    'AMZN': 'NASDAQ:AMZN',
    'META': 'NASDAQ:META',
    'TSLA': 'NASDAQ:TSLA'
  };
  return map[sym.toUpperCase()] || sym;
}

function mountTradingView(container, sym) {
  if (!window.TradingView || !container) return;
  const symbol = tvSymbol(sym);
  // Clear container for remounts
  container.innerHTML = '';
  // TradingView will attach into a unique container
  const id = `tv_${sym}_${Math.random().toString(36).slice(2)}`;
  const inner = document.createElement('div');
  inner.id = id; inner.style.width = '100%'; inner.style.height = '100%';
  container.appendChild(inner);
  // eslint-disable-next-line no-new
  new window.TradingView.widget({
    width: '100%',
    height: '100%',
    autosize: true,
    symbol,
    interval: 'D',
    timezone: 'exchange',
    theme: 'dark',
    style: '1',
    locale: 'ja',
    enable_publishing: false,
    hide_legend: false,
    hide_side_toolbar: false,
    container_id: id
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const btnHealth = $('#btn-health');
  const btnReport = $('#btn-report');
  const btnQuick = $('#btn-quick');
  const btnReset = $('#btn-reset');
  const news = $('#news');
  const reportHtml = $('#report-html');
  const suggest = $('#symbol-suggest');
  const popular = $('#popular');
  const selected = $('#selected');
  const symbolInput = $('#symbol-input');
  const btnAdd = $('#btn-add');
  const panels = $('#panels');
  const btnNews = $('#btn-news');
  const newsQ = $('#news-q');
  const newsList = $('#news-list');
  const upType = $('#up-type');
  const upSymbol = $('#up-symbol');
  const upFile = $('#up-file');
  const upBtn = $('#btn-upload');
  const upResult = $('#up-result');

  btnHealth?.addEventListener('click', async () => {
    const r = await jget('/health');
    alert(r.ok ? 'OK' : 'NG');
  });

  btnReport?.addEventListener('click', async () => {
    const chips = Array.from(selected.querySelectorAll('.chip[data-sym]'));
    const list = chips.map(c=>c.getAttribute('data-sym')).filter(Boolean).slice(0,8);
    const body = { etfs: list, news: news.checked };
    const r = await jget('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok && r.data && r.data.markdown) reportHtml.innerHTML = mdToHtml(r.data.markdown); else show(reportHtml, r.data);
  });

  btnNews?.addEventListener('click', async () => {
    const q = newsQ.value.trim();
    if (!q) return;
    const r = await jget(`/api/news?q=${encodeURIComponent(q)}&lang=ja`);
    newsList.innerHTML = '';
    const items = (r.data && r.data.data && r.data.data.items) || [];
    for (const it of items) {
      const li = document.createElement('li');
      const a = document.createElement('a'); a.href = it.url; a.textContent = `${it.title} (${it.publisher||'Unknown'})`; a.target = '_blank';
      li.appendChild(a); newsList.appendChild(li);
    }
  });

  let suggestSymbols = [];
  const popularList = ['VOO','SPY','QQQ','AAPL','MSFT','NVDA','AMZN','1655.T'];
  async function refreshSuggest() {
    const r = await jget('/api/symbols');
    suggest.innerHTML = '';
    const list = (r.data && r.data.symbols) || [];
    suggestSymbols = list;
    for (const sym of list.slice(0,100)) {
      const chip = document.createElement('div'); chip.className='chip'; chip.textContent = sym; chip.setAttribute('data-sym', sym);
      chip.addEventListener('click', ()=> addSymbol(sym));
      suggest.appendChild(chip);
    }
    // Popular quick chips (static + from list if available)
    popular.innerHTML = '';
    for (const sym of popularList) {
      const chip = document.createElement('div'); chip.className='chip'; chip.textContent = sym; chip.setAttribute('data-sym', sym);
      chip.addEventListener('click', ()=> addSymbol(sym));
      popular.appendChild(chip);
    }
  }

  function levenshtein(a,b){
    a=a.toUpperCase(); b=b.toUpperCase();
    const m = Array.from({length:a.length+1},(_,i)=>[i]);
    for(let j=1;j<=b.length;j++) m[0][j]=j;
    for(let i=1;i<=a.length;i++){
      for(let j=1;j<=b.length;j++){
        const cost = a[i-1]===b[j-1]?0:1;
        m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+cost);
      }
    }
    return m[a.length][b.length];
  }

  function bestSuggestion(sym){
    if (!suggestSymbols || !suggestSymbols.length) return null;
    let best = null; let bestD = Infinity; const up = sym.toUpperCase();
    for(const s of suggestSymbols){
      const d = levenshtein(up, String(s).toUpperCase());
      if (d < bestD){ bestD=d; best=s; }
      if (bestD===0) break;
    }
    return {candidate: best, distance: bestD};
  }

  function addSymbol(sym) {
    if (!sym) return;
    sym = sym.trim().toUpperCase();
    // Common typo fix
    if (sym === 'APPL') sym = 'AAPL';
    if (selected.querySelector(`.chip[data-sym="${sym}"]`)) return;
    // Allow fully-qualified TV symbols or popular presets without backend presence
    const isQualified = sym.includes(':');
    if (isQualified) {
      const parts = sym.split(':');
      if (parts.length === 2 && parts[1] === 'APPL') sym = `${parts[0]}:AAPL`;
    }
    const isPopular = popularList.includes(sym);
    if (!isQualified && !suggestSymbols.includes(sym) && !isPopular){
      const {candidate, distance} = bestSuggestion(sym) || {};
      if (candidate && distance <= 1){
        if (!confirm(`${sym} は見つかりません。${candidate} ですか？`)) return;
        sym = candidate;
      } else if (candidate && distance === 2){
        if (!confirm(`${sym} は見つかりません。候補: ${candidate} を追加しますか？`)) return;
        sym = candidate;
      }
      // otherwise allow as-is; TradingView may still resolve it
    }
    const chip = document.createElement('div'); chip.className='chip sel'; chip.textContent = sym; chip.setAttribute('data-sym', sym);
    chip.title = 'クリックで削除';
    chip.addEventListener('click', ()=> { chip.remove(); panels.querySelector(`[data-panel="${sym}"]`)?.remove(); });
    selected.appendChild(chip);
    mountPanel(sym);
    // Clear empty state markers when first selection happens
    selected.classList.remove('empty-state');
    panels.classList.remove('empty-state');
  }

  btnAdd?.addEventListener('click', ()=> addSymbol(symbolInput.value.trim()));
  symbolInput?.addEventListener('keydown', (e)=>{ if (e.key==='Enter') addSymbol(symbolInput.value.trim()); });

  async function mountPanel(sym) {
    const panel = document.createElement('div'); panel.className='panel'; panel.setAttribute('data-panel', sym);
    panel.innerHTML = `<h3>${sym}</h3><canvas class="chart"></canvas><div class="tvbox"></div><div class="row" style="margin-top:8px; gap:12px"><div class="mono" style="flex:2"></div><div class="mono" style="flex:1"></div></div>`;
    panels.appendChild(panel);
    const chart = panel.querySelector('canvas.chart');
    const tvbox = panel.querySelector('.tvbox');
    const meta = panel.querySelectorAll('.mono')[0];
    const stats = panel.querySelectorAll('.mono')[1];
    // fetch series and holdings
    const [sres, hres] = await Promise.all([
      jget(`/api/series/${encodeURIComponent(sym)}`),
      jget(`/api/holdings/${encodeURIComponent(sym)}`)
    ]);
    const points = (sres.data && sres.data.data && sres.data.data.points) || [];
    const closes = points.map(p=>Number(p.c)).filter(n=>Number.isFinite(n));
    if (closes.length) {
      requestAnimationFrame(()=> drawLineChart(chart, closes.slice(-120)));
      const last = closes.at(-1);
      const prev = closes.at(-2) ?? last;
      const d1 = prev ? (last-prev)/prev : 0;
      const d5 = closes.length>5 ? (last - closes.at(-6))/closes.at(-6) : 0;
      const d21 = closes.length>21 ? (last - closes.at(-22))/closes.at(-22) : 0;
      const y0 = closes[0] ?? last; const ytd = y0 ? (last - y0)/y0 : 0;
      stats.textContent = `last: ${last} | d1: ${(d1*100).toFixed(2)}% | d5: ${(d5*100).toFixed(2)}% | d21: ${(d21*100).toFixed(2)}% | ytd: ${(ytd*100).toFixed(2)}%`;
    } else {
      stats.textContent = 'series: none';
    }
    const holdings = (hres.data && hres.data.data && hres.data.data.holdings) || [];
    meta.textContent = holdings.slice(0,5).map(h=>`${h.symbol||h.name}:${h.weight}%`).join(', ') || 'no holdings';

    // Mount external TradingView widget (best-effort)
    if (tvbox) {
      if (window.TradingView) {
        mountTradingView(tvbox, sym);
      } else {
        // If script not ready yet, try shortly after
        setTimeout(()=> mountTradingView(tvbox, sym), 500);
      }
    }
  }

  upBtn?.addEventListener('click', async ()=>{
    const typ = upType.value; const sym = upSymbol.value.trim(); const file = upFile.files?.[0];
    if (!sym || !file) return alert('シンボルとファイルを指定してください');
    try {
      const text = await file.text(); const json = JSON.parse(text);
      const r = await jget('/api/upload', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ type: typ, symbol: sym, data: json }) });
      show(upResult, r.data);
      await refreshSuggest();
    } catch (e) { show(upResult, String(e)); }
  });

  btnQuick?.addEventListener('click', ()=>{
    for (const s of ['VOO','SPY','QQQ']) addSymbol(s);
    window.scrollTo({ top: panels.offsetTop - 16, behavior: 'smooth' });
  });
  btnReset?.addEventListener('click', ()=>{
    selected.innerHTML = '';
    panels.innerHTML = '';
    selected.classList.add('empty-state');
    panels.classList.add('empty-state');
    reportHtml.innerHTML = '';
  });

  refreshSuggest();
});
