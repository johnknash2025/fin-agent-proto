const fs = require('fs');
const path = require('path');

function holdingsPath(symbol) {
  return path.join(process.cwd(), 'data', `holdings.${symbol}.json`);
}

function loadLocalHoldings(symbol) {
  const p = holdingsPath(symbol);
  try {
    const txt = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(txt);
    data.holdings = data.holdings || [];
    return data;
  } catch (e) {
    return { symbol, source: 'local', note: 'no holdings file', holdings: [] };
  }
}

module.exports = { loadLocalHoldings };

