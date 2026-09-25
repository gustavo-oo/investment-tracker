CREATE TABLE rebalance_targets (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rf_e6 INTEGER NOT NULL,
  rv_e6 INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO rebalance_targets (id, rf_e6, rv_e6, amount_cents, updated_at)
VALUES (1, 800000, 200000, 0, datetime('now'));
