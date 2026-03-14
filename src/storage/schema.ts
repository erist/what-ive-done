export const CURRENT_SCHEMA_VERSION = 1;

export const INITIAL_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS raw_events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_event_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    application TEXT NOT NULL,
    window_title TEXT,
    domain TEXT,
    url TEXT,
    action TEXT NOT NULL,
    target TEXT,
    metadata_json TEXT NOT NULL,
    sensitive_filtered INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_raw_events_timestamp ON raw_events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_raw_events_source ON raw_events(source);

  CREATE TABLE IF NOT EXISTS normalized_events (
    id TEXT PRIMARY KEY,
    raw_event_id TEXT NOT NULL REFERENCES raw_events(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL,
    application TEXT NOT NULL,
    domain TEXT,
    action TEXT NOT NULL,
    target TEXT,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_normalized_events_timestamp ON normalized_events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_normalized_events_raw_event_id ON normalized_events(raw_event_id);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    primary_application TEXT NOT NULL,
    primary_domain TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_steps (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    normalized_event_id TEXT NOT NULL REFERENCES normalized_events(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL,
    action TEXT NOT NULL,
    application TEXT NOT NULL,
    domain TEXT,
    target TEXT,
    PRIMARY KEY (session_id, step_order)
  );

  CREATE TABLE IF NOT EXISTS workflow_clusters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    frequency INTEGER NOT NULL,
    average_duration_seconds REAL NOT NULL,
    total_duration_seconds REAL NOT NULL,
    representative_steps_json TEXT NOT NULL,
    automation_suitability TEXT NOT NULL,
    recommended_approach TEXT NOT NULL,
    excluded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflow_cluster_sessions (
    workflow_cluster_id TEXT NOT NULL REFERENCES workflow_clusters(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    PRIMARY KEY (workflow_cluster_id, session_id)
  );

  CREATE TABLE IF NOT EXISTS workflow_feedback (
    id TEXT PRIMARY KEY,
    workflow_cluster_id TEXT NOT NULL REFERENCES workflow_clusters(id) ON DELETE CASCADE,
    rename_to TEXT,
    excluded INTEGER,
    hidden INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analysis_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    status TEXT NOT NULL,
    summary_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
