CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  client_id TEXT NOT NULL, expires TEXT NOT NULL, state TEXT NOT NULL,
  attempted INTEGER NOT NULL, provider_id TEXT, error TEXT,
  PRIMARY KEY(client_id, expires)
);
CREATE TABLE IF NOT EXISTS worker_health (
  id INTEGER PRIMARY KEY CHECK(id=1), checked INTEGER NOT NULL, status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS reminders_expiry ON reminders(expires);
