# Finance Agent Prototype (Offline, MCP/RAG‑Ready)

This is a minimal, dependency‑free prototype for a finance agent that:
- Loads a mock portfolio and prices (offline) 
- Generates a concise daily report (Markdown + JSON)
- Emits simple buy/sell/hold suggestions based on rules
- Provides clear extension points for MCP tools and RAG ingestion

No packages are required; it runs with plain Node.js (v18+).

## Quick Start

- Run with bundled sample data
```
node src/cli.js --data data/portfolio.sample.json --prices data/prices.sample.json --out out
```
- Outputs:
  - `out/report.md` – human‑readable daily report
  - `out/report.json` – structured metrics and suggestions

## Project Layout
- `src/cli.js` – CLI entry
- `src/agent/report.js` – metrics + report generation
- `src/agent/recommend.js` – rule‑based suggestions
- `src/providers/portfolio/local.js` – load local portfolio JSON
- `src/providers/quotes/local.js` – load local prices JSON/series
- `data/*.sample.json` – sample inputs
- `docs/ARCHITECTURE.md` – target architecture with MCP/RAG
- `docs/SCHEMAS.md` – data shapes (JSON)

## Roadmap
- Add MCP server exposing tools:
  - `get_portfolio`, `get_quotes`, `search_news`, `get_filings`, `place_order` (guarded)
- Swap local providers with live connectors (broker/data vendors)
- Add RAG ingestion (EDGAR/EDINET, news RSS, analyst notes) + embeddings
- Replace rule engine with LLM+Graph policy (manual approval for orders)

## Disclaimer
This prototype is for engineering exploration only and is not financial advice. Any trading integration must include explicit user approval, logging, and compliance checks.

