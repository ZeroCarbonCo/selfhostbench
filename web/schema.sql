-- SelfHostBench D1 schema. Apply with:
--   npx wrangler d1 execute selfhostbench --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL,             -- salted SHA-256 of the IP, rate limiting only
  is_owner INTEGER NOT NULL DEFAULT 0, -- maintainer's own test runs, excluded from smoke-test counts
  schema_version INTEGER NOT NULL,
  script_version TEXT NOT NULL,
  device_key TEXT NOT NULL,
  device_label TEXT NOT NULL,
  cpu_short TEXT NOT NULL,
  virtualization TEXT NOT NULL,
  doc TEXT NOT NULL                  -- the validated JSON exactly as submitted
);
CREATE INDEX IF NOT EXISTS submissions_device ON submissions(device_key);
CREATE INDEX IF NOT EXISTS submissions_created ON submissions(created_at);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  created_at TEXT NOT NULL,
  device_key TEXT NOT NULL,
  app TEXT NOT NULL,
  test TEXT NOT NULL,
  accel TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  flagged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS results_group ON results(app, test, accel, device_key);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  device TEXT,
  apps TEXT,
  created_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  unsubscribed_at TEXT
);

CREATE TABLE IF NOT EXISTS rate (
  ip_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, kind, day)
);
