import type { DatabaseSync } from "node:sqlite";

export const CURRENT_SCHEMA_VERSION = 3;

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
    app_name_normalized TEXT NOT NULL,
    domain TEXT,
    url TEXT,
    path_pattern TEXT,
    page_type TEXT,
    resource_hint TEXT,
    title_pattern TEXT,
    action TEXT NOT NULL,
    target TEXT,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_normalized_events_timestamp ON normalized_events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_normalized_events_raw_event_id ON normalized_events(raw_event_id);
  CREATE INDEX IF NOT EXISTS idx_normalized_events_domain_path
    ON normalized_events(domain, path_pattern);

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

  CREATE TABLE IF NOT EXISTS workflow_llm_analyses (
    workflow_cluster_id TEXT PRIMARY KEY REFERENCES workflow_clusters(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    workflow_name TEXT NOT NULL,
    workflow_summary TEXT NOT NULL,
    automation_suitability TEXT NOT NULL,
    recommended_approach TEXT NOT NULL,
    rationale TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS report_snapshots (
    id TEXT PRIMARY KEY,
    window TEXT NOT NULL,
    report_date TEXT NOT NULL,
    timezone TEXT NOT NULL,
    timezone_offset_minutes INTEGER NOT NULL,
    start_time TEXT,
    end_time TEXT,
    total_sessions INTEGER NOT NULL,
    total_tracked_duration_seconds REAL NOT NULL,
    workflows_json TEXT NOT NULL,
    emerging_workflows_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    UNIQUE(window, report_date, timezone)
  );

  CREATE INDEX IF NOT EXISTS idx_report_snapshots_window_date
    ON report_snapshots(window, report_date DESC, generated_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

interface TableInfoRow {
  name: string;
}

function hasColumn(connection: DatabaseSync, table: string, column: string): boolean {
  const rows = connection.prepare(`PRAGMA table_info(${table})`).all() as unknown as TableInfoRow[];

  return rows.some((row) => row.name === column);
}

function ensureColumn(
  connection: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  if (hasColumn(connection, table, column)) {
    return;
  }

  connection.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function applySchemaMigrations(
  connection: DatabaseSync,
  existingVersion: number | null,
): void {
  if ((existingVersion ?? 0) < 3) {
    ensureColumn(connection, "normalized_events", "app_name_normalized", "app_name_normalized TEXT");
    ensureColumn(connection, "normalized_events", "url", "url TEXT");
    ensureColumn(connection, "normalized_events", "path_pattern", "path_pattern TEXT");
    ensureColumn(connection, "normalized_events", "page_type", "page_type TEXT");
    ensureColumn(connection, "normalized_events", "resource_hint", "resource_hint TEXT");
    ensureColumn(connection, "normalized_events", "title_pattern", "title_pattern TEXT");

    connection.exec(`
      UPDATE normalized_events
      SET app_name_normalized = COALESCE(app_name_normalized, application)
      WHERE app_name_normalized IS NULL
    `);

    connection.exec(`
      CREATE INDEX IF NOT EXISTS idx_normalized_events_domain_path
        ON normalized_events(domain, path_pattern)
    `);
  }
}
