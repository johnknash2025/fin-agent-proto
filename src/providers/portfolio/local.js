const fs = require('fs');

function loadLocalPortfolio(file) {
  const text = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(text);
  // normalize
  data.positions = data.positions || [];
  data.positions.forEach(p => {
    p.cost_basis_per_share = p.cost_basis_per_share ?? 0;
  });
  data.cash = data.cash ?? 0;
  return data;
}

module.exports = { loadLocalPortfolio };

