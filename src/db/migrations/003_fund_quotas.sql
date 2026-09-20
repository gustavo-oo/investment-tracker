CREATE TABLE fund_quotas (
  symbol TEXT NOT NULL,
  date TEXT NOT NULL,
  quota_e12 INTEGER NOT NULL,
  source TEXT NOT NULL,
  settled INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (symbol, date)
);
