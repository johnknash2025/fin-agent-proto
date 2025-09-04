const fs = require('fs');

function loadLocalPrices(file) {
  const text = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(text);
  data.quotes = data.quotes || [];
  return data;
}

module.exports = { loadLocalPrices };

