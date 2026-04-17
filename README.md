# 🤖 Finance Agent Prototype

Offline finance agent with MCP/RAG-ready architecture. Generates daily portfolio reports and buy/sell/hold suggestions.

## 🚀 Features

- **Offline-first** — Works without internet connection using local data
- **MCP Tools** — Portfolio, quotes, news, filings, and order tools
- **RAG Support** — Local vector store for document ingestion and querying
- **EDGAR Integration** — Fetch SEC filings automatically
- **Rule-based Engine** — Simple buy/sell/hold suggestions
- **Zero Dependencies** — Runs with plain Node.js (v18+)

## 🛠 Quick Start

```bash
node src/cli.js --data data/portfolio.sample.json --prices data/prices.sample.json --out out
```

**Outputs:**
- `out/report.md` — Human-readable daily report
- `out/report.json` — Structured metrics and suggestions

## 📦 MCP Tools

| Tool | Description |
|---|---|
| `get_portfolio` | Load portfolio data |
| `get_quotes` | Fetch stock quotes |
| `search_news` | Search financial news |
| `get_filings` | Fetch SEC filings |
| `place_order` | Execute orders (guarded) |

### EDGAR Ingestion

```bash
node server/mcp/index.js fetch_edgar_and_ingest --args '{"symbol":"AAPL","forms":["10-K","10-Q"],"limit":1}'
```

## 📁 Project Structure

```
fin-agent-proto/
├── src/
│   ├── cli.js          # CLI entry point
│   └── agent/          # Report generation & recommendations
├── server/
│   ├── mcp/            # MCP tools
│   └── rag/            # RAG ingestion & query
├── data/               # Sample portfolio & price data
├── docs/               # Architecture & schema docs
└── rag/                # Local RAG cache
```

## 🔧 Configuration

Set environment variables in `.env`:

```
SEC_USER_AGENT=your-agent-string
ALPHA_VANTAGE_KEY=your-key
NEWSAPI_KEY=your-key
```

## 📄 License

MIT License