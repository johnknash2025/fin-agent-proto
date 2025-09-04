function round(n, d = 2) { return Math.round(n * 10 ** d) / 10 ** d; }

function buildRecommendations(report) {
  const s = [];
  const j = [];
  const { portfolioSummary, positions } = report.json;

  // Cash drag
  const cashRatio = portfolioSummary.totalValue > 0 ? (portfolioSummary.cash || 0) / portfolioSummary.totalValue : 0;
  if (cashRatio > 0.2) {
    s.push(`- Cash is ${round(cashRatio*100)}% of portfolio. Consider allocating part to target assets.`);
    j.push({ type: 'cash_allocation', severity: 'info', cashRatio });
  }

  // Concentration risk
  if (portfolioSummary.concentration > 0.3) {
    s.push(`- Highest position concentration is ${round(portfolioSummary.concentration*100)}%. Consider trimming to reduce single‑name risk.`);
    j.push({ type: 'concentration', severity: 'warn', concentration: portfolioSummary.concentration });
  }

  // Position‑level PnL suggestions
  positions.forEach(p => {
    if (p.pnlPct > 0.25) {
      s.push(`- ${p.symbol}: +${round(p.pnlPct*100)}% unrealized. Consider partial profit‑taking or trailing stops.`);
      j.push({ type: 'take_profit_consideration', symbol: p.symbol, pnlPct: p.pnlPct });
    } else if (p.pnlPct < -0.15) {
      s.push(`- ${p.symbol}: ${round(p.pnlPct*100)}% unrealized loss. Review thesis; consider cut or reduce risk.`);
      j.push({ type: 'loss_review', symbol: p.symbol, pnlPct: p.pnlPct });
    }
  });

  if (s.length === 0) {
    s.push('- Portfolio within basic risk thresholds. No action suggested.');
  }

  return { markdown: s, json: j };
}

module.exports = { buildRecommendations };

