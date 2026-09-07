CREATE TABLE IF NOT EXISTS sponsors (
  merchant_trade_no TEXT PRIMARY KEY,
  trade_no          TEXT,
  amount            INTEGER NOT NULL,
  fee               REAL,
  patron_name       TEXT,
  patron_note       TEXT,
  payment_type      TEXT,
  payment_date      TEXT,
  simulated         INTEGER NOT NULL DEFAULT 0,
  notified          INTEGER NOT NULL DEFAULT 0,
  received_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
