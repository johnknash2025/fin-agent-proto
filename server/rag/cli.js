#!/usr/bin/env node
const { ingestFile, ingestText, query } = require('./index');

async function main(argv) {
  const cmd = argv[2];
  if (!cmd || ['ingest','query'].indexOf(cmd) === -1) {
    console.error('Usage:\n  node server/rag/cli.js ingest --file <path> [--meta JSON]\n  node server/rag/cli.js query --q "text" [--k 5]');
    process.exit(1);
  }
  if (cmd === 'ingest') {
    const fileIdx = argv.indexOf('--file');
    const metaIdx = argv.indexOf('--meta');
    if (fileIdx === -1 || !argv[fileIdx+1]) {
      console.error('Missing --file');
      process.exit(1);
    }
    const file = argv[fileIdx+1];
    let meta = {};
    if (metaIdx !== -1 && argv[metaIdx+1]) {
      try { meta = JSON.parse(argv[metaIdx+1]); } catch {}
    }
    const res = ingestFile({ file, meta });
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    return;
  }
  if (cmd === 'query') {
    const qIdx = argv.indexOf('--q');
    if (qIdx === -1 || !argv[qIdx+1]) {
      console.error('Missing --q');
      process.exit(1);
    }
    const kIdx = argv.indexOf('--k');
    const q = argv[qIdx+1];
    const k = kIdx !== -1 ? parseInt(argv[kIdx+1] || '5', 10) : 5;
    const res = query({ q, k });
    console.log(JSON.stringify({ ok: true, hits: res }, null, 2));
    return;
  }
}

main(process.argv).catch(e => { console.error(e); process.exit(1); });

