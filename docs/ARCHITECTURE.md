# Target Architecture (MCP + RAG)

## Components
- Agent Orchestrator: policy + state machine (e.g., graph‑style steps)
- MCP Tooling: consistent access to external systems via Model Context Protocol
- Data Adapters: brokers, market data, news/filings
- RAG Store: embeddings + retrieval for research context
- Policy & Guardrails: risk limits, compliance, manual approvals
- Scheduler & Reports: daily/weekly digests, alerts
- Audit & Observability: logs, traces, decision journal

## MCP Tools (initial set)
- `get_portfolio()`: accounts, positions, transactions
- `get_quotes(symbols)`: realtime/nbbo or EOD with provider fallback
- `search_news(query, symbols, from, to)`: headlines, URLs, publisher, score
- `get_filings(symbol, from, to)`: EDGAR/EDINET, parsed Items/Notes
- `place_order(intent)`: paper/live routing, ALWAYS requires user approval
- `ingest_corpus(doc)`: add document to RAG corpus with metadata

Each tool returns structured JSON with an `observability` envelope (latency, provider, cost, rate‑limit hints).

## RAG
- Sources: filings (10‑K/20‑F, 決算短信), earnings call transcripts, broker notes, RSS news
- Pipeline: fetch → chunk → clean → embed → store (pgvector/SQLite/FAISS)
- Retrieval: hybrid (sparse + dense), recency/authority re‑ranking
- Context policy: symbol‑scoped + risk‑aware truncation

## Policy & Risk
- Position limits, concentration, cash floors/ceilings
- Volatility/tail proxies (ATR, drawdown, beta vs. benchmark)
- Calendar constraints (earnings blackout, macro releases)
- Compliance: suitability profile, jurisdiction, audit logs

## Reports
- Daily: PnL, exposures, concentration, alerts, key news/filings
- Weekly: attribution, factor tilts, turnover, fees/taxes estimates

## Runtime
- Local dev: offline providers (this prototype), mocked trades
- Prod: MCP server + adapters (broker/data vendors), secure secrets, durable storage

