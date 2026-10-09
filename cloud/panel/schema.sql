CREATE TABLE IF NOT EXISTS instances (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 owner_email TEXT NOT NULL, crm_name TEXT NOT NULL, business TEXT NOT NULL,
 logo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
 stage TEXT NOT NULL DEFAULT 'queued', created_at INTEGER NOT NULL, activated_at INTEGER,
 database_id TEXT, access_id TEXT, audience TEXT, worker_name TEXT NOT NULL UNIQUE,
 lifecycle_hash TEXT NOT NULL, lifecycle_secret TEXT, error TEXT,
 processing INTEGER NOT NULL DEFAULT 0, session_after INTEGER NOT NULL DEFAULT 0
);
