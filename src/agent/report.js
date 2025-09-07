function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function round(n, d = 2) { return Math.round(n * 10 ** d) / 10 ** d; }

function computePositionMetrics(pos, pricePoint) {
  const price = pricePoint?.price ?? 0;
  const mktValue = pos.quantity * price;
  const cost = pos.quantity * (pos.cost_basis_per_share ?? 0);
  const pnl = mktValue - cost;
  const pnlPct = cost > 0 ? pnl / cost : 0;
  return { symbol: pos.symbol, quantity: pos.quantity, price, mktValue, cost, pnl, pnlPct };
}

function computePortfolio({ portfolio, prices }) {
  const positions = portfolio.positions || [];
  const priceMap = new Map((prices?.quotes || []).map(q => [q.symbol, q]));
  const metrics = positions.map(p => computePositionMetrics(p, priceMap.get(p.symbol)));
  const totalValue = sum(metrics.map(m => m.mktValue)) + (portfolio.cash || 0);
  const totalCost = sum(metrics.map(m => m.cost));
  const totalPnl = sum(metrics.map(m => m.pnl));
  const totalPnlPct = totalCost > 0 ? totalPnl / totalCost : 0;
  const concentration = metrics.length ? Math.max(...metrics.map(m => (totalValue > 0 ? m.mktValue / totalValue : 0))) : 0;
  return { metrics, totalValue, totalCost, totalPnl, totalPnlPct, concentration };
}

function toMarkdown({ portfolioSummary, positions, lang = 'ja' }) {
  const md = [];
  const L = (en, ja) => (lang === 'ja' ? ja : en);
  if (lang === 'ja') {
    md.push('## 目的');
    md.push('- 本レポートは、資産運用のご判断を支援する目的で、保有資産の現状、最近の市場動向、関連ニュース・開示の要点、ならびに基本的な提案を簡潔に整理したものです。');
    md.push('- 取引の最終判断はご自身でなさってください。必要に応じて専門家の助言をご検討ください。');
    md.push('');
  }
  md.push(L('## Summary', '## サマリー'));
  md.push(L(`- Total Value: ${portfolioSummary.totalValue.toLocaleString()}`, `- 総資産額: ${portfolioSummary.totalValue.toLocaleString()}`));
  md.push(L(`- Total Cost: ${portfolioSummary.totalCost.toLocaleString()}`, `- 取得原価合計: ${portfolioSummary.totalCost.toLocaleString()}`));
  md.push(L(`- Unrealized PnL: ${portfolioSummary.totalPnl.toLocaleString()} (${round(portfolioSummary.totalPnlPct*100)}%)`, `- 含み損益: ${portfolioSummary.totalPnl.toLocaleString()} (${round(portfolioSummary.totalPnlPct*100)}%)`));
  md.push(L(`- Cash: ${(portfolioSummary.cash || 0).toLocaleString()}`, `- 現金: ${(portfolioSummary.cash || 0).toLocaleString()}`));
  md.push(L(`- Max Position Concentration: ${round(portfolioSummary.concentration*100)}%`, `- 最大ポジション集中度: ${round(portfolioSummary.concentration*100)}%`));
  md.push('');
  md.push(L('## Positions', '## 保有銘柄'));
  positions.forEach(p => {
    const lineEn = `- ${p.symbol}: qty ${p.quantity}, price ${round(p.price)}, value ${p.mktValue.toLocaleString()}, PnL ${round(p.pnl)} (${round(p.pnlPct*100)}%)`;
    const lineJa = `- ${p.symbol}: 数量 ${p.quantity}, 価格 ${round(p.price)}, 時価 ${p.mktValue.toLocaleString()}, 含み損益 ${round(p.pnl)} (${round(p.pnlPct*100)}%)`;
    md.push(L(lineEn, lineJa));
  });
  return md;
}

function firstSentence(text, maxLen = 180) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const end = t.search(/[.!?]\s|$/);
  const s = end > 0 ? t.slice(0, end + 1) : t;
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

function tryGetRagHighlights(k = 3) {
  try {
    const { query } = require('../../server/rag');
    const hits = query({ q: 'earnings guidance revenue margin outlook risk', k });
    return hits.map(h => ({
      id: h.id,
      score: h.score,
      meta: h.meta,
      snippet: firstSentence(h.text)
    }));
  } catch {
    return [];
  }
}

function buildReport({ portfolio, prices, lang = 'ja' }) {
  const { metrics, totalValue, totalCost, totalPnl, totalPnlPct, concentration } = computePortfolio({ portfolio, prices });
  const portfolioSummary = { totalValue, totalCost, totalPnl, totalPnlPct, concentration, cash: portfolio.cash || 0 };

  const highlights = tryGetRagHighlights(3);

  const json = { portfolioSummary, positions: metrics, highlights };
  const markdown = toMarkdown({ portfolioSummary, positions: metrics, lang });
  if (highlights.length) {
    markdown.push('');
    markdown.push(lang === 'ja' ? '## 調査ハイライト' : '## Research Highlights');
    highlights.forEach(h => {
      const tag = [h.meta?.symbol, h.meta?.form, h.meta?.filed_at].filter(Boolean).join(' / ');
      markdown.push(`- ${tag ? `[${tag}] ` : ''}${h.snippet}`);
    });
  }
  return { json, markdown };
}

module.exports = { buildReport };
