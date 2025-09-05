#!/usr/bin/env node
// Minimal stdio runner for tool functions.
// This is not the official MCP server, but provides the same tool semantics for local testing.

// Load .env if present (no external deps)
try { require('../env').config(); } catch {}

const { get_portfolio, get_quotes, search_news, get_filings, place_order, ingest_corpus, query_corpus } = require('./tools');

const TOOL_MAP = { get_portfolio, get_quotes, search_news, get_filings, place_order, ingest_corpus, query_corpus };

async function runOnce(toolName, args) {
  const fn = TOOL_MAP[toolName];
  if (!fn) {
    return { ok: false, error: `Unknown tool: ${toolName}` };
  }
  try {
    const res = await fn(args || {});
    return res;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function runCli(argv) {
  // Usage: node server/mcp/index.js <tool|stdio> [--args '{"symbols":["AAPL"]}']
  const mode = argv[2];
  if (!mode) {
    console.error('Usage: node server/mcp/index.js <tool|stdio> [--args JSON]');
    process.exit(1);
  }
  if (mode === 'stdio') return runStdio();
  let args = {};
  const idx = argv.indexOf('--args');
  if (idx !== -1 && argv[idx + 1]) {
    try { args = JSON.parse(argv[idx + 1]); } catch {}
  }
  const res = await runOnce(mode, args);
  console.log(JSON.stringify(res, null, 2));
}

async function runStdio() {
  // Read entire stdin as one JSON request: { tool: string, args: object }
  // Respond JSON once and exit. Simple and works for local agents.
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { buf += chunk; });
  process.stdin.on('end', async () => {
    let req = null;
    try { req = JSON.parse(buf || '{}'); } catch {}
    const toolName = req?.tool;
    const args = req?.args || {};
    const res = await runOnce(toolName, args);
    process.stdout.write(JSON.stringify(res));
  });
}

if (require.main === module) {
  runCli(process.argv).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runOnce };
