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

function toMarkdown({ portfolioSummary, positions }) {
  const md = [];
  md.push('## Summary');
  md.push(`- Total Value: ${portfolioSummary.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  md.push(`- Total Cost: ${portfolioSummary.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  md.push(`- Unrealized PnL: ${portfolioSummary.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${round(portfolioSummary.totalPnlPct*100)}%)`);
  md.push(`- Cash: ${(portfolioSummary.cash || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  md.push(`- Max Position Concentration: ${round(portfolioSummary.concentration*100)}%`);
  md.push('');
  md.push('## Positions');
  positions.forEach(p => {
    md.push(`- ${p.symbol}: qty ${p.quantity}, price ${round(p.price)}, value ${p.mktValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}, PnL ${round(p.pnl)} (${round(p.pnlPct*100)}%)`);
  });
  return md;
}

function buildReport({ portfolio, prices }) {
  const { metrics, totalValue, totalCost, totalPnl, totalPnlPct, concentration } = computePortfolio({ portfolio, prices });
  const portfolioSummary = { totalValue, totalCost, totalPnl, totalPnlPct, concentration, cash: portfolio.cash || 0 };

  const json = { portfolioSummary, positions: metrics };
  const markdown = toMarkdown({ portfolioSummary, positions: metrics });
  return { json, markdown };
}

module.exports = { buildReport };

