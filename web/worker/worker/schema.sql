-- D1 schema for structured market data (free tier friendly)

-- ETFs / Funds
CREATE TABLE IF NOT EXISTS etf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  name TEXT,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ETF Holdings (normalized top N, can store all if needed)
CREATE TABLE IF NOT EXISTS holdings (
  etf_id INTEGER NOT NULL,
  line INTEGER NOT NULL,
  asset_symbol TEXT,
  asset_name TEXT,
  weight REAL,
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (etf_id, line),
  FOREIGN KEY (etf_id) REFERENCES etf(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_holdings_etf ON holdings(etf_id);

-- Daily series (EOD close)
CREATE TABLE IF NOT EXISTS series_daily (
  symbol TEXT NOT NULL,
  t TEXT NOT NULL,
  close REAL NOT NULL,
  PRIMARY KEY (symbol, t)
);
CREATE INDEX IF NOT EXISTS idx_series_symbol ON series_daily(symbol);

-- Optional: cached headlines (structured; small volume)
CREATE TABLE IF NOT EXISTS news_headlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  q TEXT,
  lang TEXT,
  title TEXT,
  url TEXT,
  publisher TEXT,
  ts TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Minimal upsert helpers (D1 supports standard SQL; use wrangler d1 execute for ingestion)

