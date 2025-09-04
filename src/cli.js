#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { loadLocalPortfolio } = require('./providers/portfolio/local');
const { loadLocalPrices } = require('./providers/quotes/local');
const { buildReport } = require('./agent/report');
const { buildRecommendations } = require('./agent/recommend');

function parseArgs(argv) {
  const args = { data: null, prices: null, out: 'out' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') args.data = argv[++i];
    else if (a === '--prices') args.prices = argv[++i];
    else if (a === '--out') args.out = argv[++i];
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

async function main() {
  const args = parseArgs(process.argv);
  const portfolio = loadLocalPortfolio(args.data);
  const prices = loadLocalPrices(args.prices);

  const report = buildReport({ portfolio, prices });
  const suggestions = buildRecommendations(report);

  const outDir = args.out;
  ensureDir(outDir);

  const md = ['# Daily Portfolio Report', '', ...report.markdown, '', '## Suggestions', '', ...suggestions.markdown, ''].join('\n');
  const json = { report: report.json, suggestions: suggestions.json };

  writeFileSyncSafe(path.join(outDir, 'report.md'), md);
  writeFileSyncSafe(path.join(outDir, 'report.json'), JSON.stringify(json, null, 2));

  console.log(`Wrote: ${path.join(outDir, 'report.md')} and report.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

