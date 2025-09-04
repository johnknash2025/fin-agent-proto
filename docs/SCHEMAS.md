# Data Schemas (JSON)

## Portfolio
```
{
  "as_of": "YYYY-MM-DD",
  "currency": "USD|JPY|...",
  "cash": 0,
  "positions": [
    { "symbol": "AAPL", "quantity": 100, "cost_basis_per_share": 120.5, "currency": "USD" }
  ]
}
```

## Prices
```
{
  "as_of": "YYYY-MM-DD",
  "quotes": [ { "symbol": "AAPL", "price": 195.2 } ],
  "series": [
    { "symbol": "AAPL", "points": [ {"t": "YYYY-MM-DD", "p": 190.1} ] }
  ]
}
```

## Report (JSON output)
```
{
  "portfolioSummary": {
    "totalValue": 123456,
    "totalCost": 100000,
    "totalPnl": 23456,
    "totalPnlPct": 0.2346,
    "concentration": 0.32,
    "cash": 15000
  },
  "positions": [
    { "symbol": "AAPL", "quantity": 120, "price": 195.2, "mktValue": 23424, "cost": 16800, "pnl": 6624, "pnlPct": 0.3943 }
  ]
}
```

## Suggestions (JSON output)
```
[
  { "type": "cash_allocation", "severity": "info", "cashRatio": 0.25 },
  { "type": "concentration", "severity": "warn", "concentration": 0.35 },
  { "type": "take_profit_consideration", "symbol": "AAPL", "pnlPct": 0.28 }
]
```

