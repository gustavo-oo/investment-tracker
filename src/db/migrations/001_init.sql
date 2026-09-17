CREATE TABLE instruments (
  id TEXT PRIMARY KEY,
  legacy_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed_income', 'equity', 'pension')),
  category TEXT NOT NULL CHECK (category IN ('cdb', 'lca', 'selic', 'etf_fixed', 'etf_equity', 'pension_ipca')),
  ticker TEXT,
  quote_source TEXT,
  quote_symbol TEXT,
  currency TEXT NOT NULL DEFAULT 'BRL',
  benchmark TEXT CHECK (benchmark IN ('CDI', 'SELIC', 'IPCA')),
  rate_e6 INTEGER,
  maturity_date TEXT,
  liquidity TEXT,
  broker TEXT,
  objective TEXT,
  investor TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  trade_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BUY', 'SELL', 'DIVIDEND', 'AMORTIZATION', 'FEE', 'TAX')),
  quantity_e8 INTEGER,
  gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
  fees_cents INTEGER NOT NULL DEFAULT 0 CHECK (fees_cents >= 0),
  note TEXT,
  legacy_row INTEGER
);

CREATE TABLE quotes (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,
  close_cents INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ticker, date)
);

CREATE TABLE index_rates (
  series TEXT NOT NULL,
  date TEXT NOT NULL,
  value_e12 INTEGER NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (series, date)
);

CREATE TABLE valuations (
  month TEXT NOT NULL,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  quantity_e8 INTEGER,
  price_cents INTEGER,
  market_value_cents INTEGER NOT NULL,
  cost_basis_cents INTEGER NOT NULL,
  PRIMARY KEY (month, instrument_id)
);

CREATE TABLE legacy_snapshots (
  month TEXT NOT NULL,
  instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  value_cents INTEGER NOT NULL,
  shares_e8 INTEGER,
  PRIMARY KEY (month, instrument_id)
);

CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL CHECK (source IN ('ui', 'cli', 'api')),
  instruments INTEGER NOT NULL,
  transactions INTEGER NOT NULL,
  history_rows INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  message TEXT
);

CREATE INDEX idx_transactions_instrument_date ON transactions(instrument_id, trade_date);
CREATE INDEX idx_valuations_month ON valuations(month);
CREATE INDEX idx_legacy_snapshots_month ON legacy_snapshots(month);
