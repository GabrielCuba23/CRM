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
CREATE TABLE IF NOT EXISTS message_tasks (
  id TEXT PRIMARY KEY, signature TEXT NOT NULL, body TEXT NOT NULL,
  state TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL,
  claim_hash TEXT, provider_id TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS message_tasks_state ON message_tasks(state, updated);

CREATE TABLE IF NOT EXISTS email_reports (id TEXT PRIMARY KEY, kind TEXT NOT NULL, day TEXT NOT NULL, state TEXT NOT NULL, attempted INTEGER NOT NULL, provider_id TEXT);

CREATE TABLE IF NOT EXISTS auth_owner (
  id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL,
  password_hash TEXT NOT NULL, version INTEGER NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_setup (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, csrf TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('web','extension')),
  owner_version INTEGER NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires);
CREATE TABLE IF NOT EXISTS auth_attempts (
  bucket TEXT PRIMARY KEY, window_started INTEGER NOT NULL, attempts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_attempts_window ON auth_attempts(window_started);
