import type { DatabaseSync } from "node:sqlite";

export const CURRENT_SCHEMA_VERSION = 13;

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
    browser_schema_version INTEGER,
    canonical_url TEXT,
    route_template TEXT,
    route_key TEXT,
    resource_hash TEXT,
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
    browser_schema_version INTEGER,
    canonical_url TEXT,
    route_template TEXT,
    route_key TEXT,
    resource_hash TEXT,
    route_family TEXT,
    domain_pack_id TEXT,
    domain_pack_version INTEGER,
    path_pattern TEXT,
    page_type TEXT,
    resource_hint TEXT,
    title_pattern TEXT,
    action TEXT NOT NULL,
    action_name TEXT NOT NULL,
    action_confidence REAL NOT NULL DEFAULT 0,
    action_source TEXT NOT NULL DEFAULT 'inferred',
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
    session_boundary_reason TEXT NOT NULL DEFAULT 'stream_start',
    session_boundary_details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_steps (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    normalized_event_id TEXT NOT NULL REFERENCES normalized_events(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL,
    action TEXT NOT NULL,
    action_name TEXT NOT NULL,
    action_confidence REAL NOT NULL DEFAULT 0,
    action_source TEXT NOT NULL DEFAULT 'inferred',
    application TEXT NOT NULL,
    domain TEXT,
    title_pattern TEXT,
    target TEXT,
    PRIMARY KEY (session_id, step_order)
  );

  CREATE TABLE IF NOT EXISTS workflow_clusters (
    id TEXT PRIMARY KEY,
    workflow_signature TEXT NOT NULL,
    name TEXT NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 0,
    frequency INTEGER NOT NULL,
    average_duration_seconds REAL NOT NULL,
    total_duration_seconds REAL NOT NULL,
    representative_sequence_json TEXT NOT NULL DEFAULT '[]',
    representative_steps_json TEXT NOT NULL,
    involved_apps_json TEXT NOT NULL DEFAULT '[]',
    confidence_score REAL NOT NULL DEFAULT 0,
    confidence_details_json TEXT NOT NULL DEFAULT '{}',
    top_variants_json TEXT NOT NULL DEFAULT '[]',
    automation_suitability TEXT NOT NULL,
    recommended_approach TEXT NOT NULL,
    automation_hints_json TEXT NOT NULL DEFAULT '[]',
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
    workflow_signature TEXT NOT NULL,
    rename_to TEXT,
    business_purpose TEXT,
    excluded INTEGER,
    hidden INTEGER,
    repetitive INTEGER,
    automation_candidate INTEGER,
    automation_difficulty TEXT,
    approved_automation_candidate INTEGER,
    merge_into_workflow_id TEXT,
    merge_into_workflow_signature TEXT,
    split_after_action_name TEXT,
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
    summary_json TEXT NOT NULL DEFAULT '{}',
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

  if ((existingVersion ?? 0) < 4) {
    ensureColumn(connection, "normalized_events", "action_name", "action_name TEXT");
    ensureColumn(connection, "normalized_events", "action_confidence", "action_confidence REAL DEFAULT 0");
    ensureColumn(
      connection,
      "normalized_events",
      "action_source",
      "action_source TEXT DEFAULT 'inferred'",
    );
    ensureColumn(connection, "session_steps", "action_name", "action_name TEXT");
    ensureColumn(connection, "session_steps", "action_confidence", "action_confidence REAL DEFAULT 0");
    ensureColumn(
      connection,
      "session_steps",
      "action_source",
      "action_source TEXT DEFAULT 'inferred'",
    );

    connection.exec(`
      UPDATE normalized_events
      SET action_name = COALESCE(action_name, action)
      WHERE action_name IS NULL
    `);

    connection.exec(`
      UPDATE session_steps
      SET action_name = COALESCE(action_name, action)
      WHERE action_name IS NULL
    `);
  }

  if ((existingVersion ?? 0) < 5) {
    ensureColumn(
      connection,
      "sessions",
      "session_boundary_reason",
      "session_boundary_reason TEXT DEFAULT 'stream_start'",
    );
    ensureColumn(
      connection,
      "sessions",
      "session_boundary_details_json",
      "session_boundary_details_json TEXT DEFAULT '{}'",
    );
  }

  if ((existingVersion ?? 0) < 6) {
    ensureColumn(connection, "workflow_clusters", "workflow_signature", "workflow_signature TEXT");
    ensureColumn(connection, "workflow_clusters", "occurrence_count", "occurrence_count INTEGER DEFAULT 0");
    ensureColumn(
      connection,
      "workflow_clusters",
      "representative_sequence_json",
      "representative_sequence_json TEXT DEFAULT '[]'",
    );
    ensureColumn(
      connection,
      "workflow_clusters",
      "involved_apps_json",
      "involved_apps_json TEXT DEFAULT '[]'",
    );
    ensureColumn(
      connection,
      "workflow_clusters",
      "confidence_score",
      "confidence_score REAL DEFAULT 0",
    );
    ensureColumn(
      connection,
      "workflow_clusters",
      "confidence_details_json",
      "confidence_details_json TEXT DEFAULT '{}'",
    );
    ensureColumn(
      connection,
      "workflow_clusters",
      "top_variants_json",
      "top_variants_json TEXT DEFAULT '[]'",
    );

    connection.exec(`
      UPDATE workflow_clusters
      SET workflow_signature = COALESCE(workflow_signature, id)
      WHERE workflow_signature IS NULL
    `);

    connection.exec(`
      UPDATE workflow_clusters
      SET occurrence_count = COALESCE(occurrence_count, frequency)
      WHERE occurrence_count IS NULL
    `);
  }

  if ((existingVersion ?? 0) < 7) {
    ensureColumn(connection, "workflow_feedback", "workflow_signature", "workflow_signature TEXT");
    ensureColumn(connection, "workflow_feedback", "business_purpose", "business_purpose TEXT");
    ensureColumn(connection, "workflow_feedback", "repetitive", "repetitive INTEGER");
    ensureColumn(connection, "workflow_feedback", "automation_candidate", "automation_candidate INTEGER");
    ensureColumn(connection, "workflow_feedback", "automation_difficulty", "automation_difficulty TEXT");
    ensureColumn(
      connection,
      "workflow_feedback",
      "approved_automation_candidate",
      "approved_automation_candidate INTEGER",
    );
    ensureColumn(
      connection,
      "workflow_feedback",
      "merge_into_workflow_id",
      "merge_into_workflow_id TEXT",
    );
    ensureColumn(
      connection,
      "workflow_feedback",
      "merge_into_workflow_signature",
      "merge_into_workflow_signature TEXT",
    );
    ensureColumn(
      connection,
      "workflow_feedback",
      "split_after_action_name",
      "split_after_action_name TEXT",
    );

    connection.exec(`
      UPDATE workflow_feedback
      SET workflow_signature = COALESCE(
        workflow_signature,
        (SELECT workflow_signature FROM workflow_clusters WHERE workflow_clusters.id = workflow_feedback.workflow_cluster_id),
        workflow_cluster_id
      )
      WHERE workflow_signature IS NULL
    `);
  }

  if ((existingVersion ?? 0) < 8) {
    ensureColumn(
      connection,
      "report_snapshots",
      "summary_json",
      "summary_json TEXT DEFAULT '{}'",
    );
  }

  if ((existingVersion ?? 0) < 9) {
    ensureColumn(
      connection,
      "workflow_clusters",
      "automation_hints_json",
      "automation_hints_json TEXT DEFAULT '[]'",
    );
  }

  if ((existingVersion ?? 0) < 10) {
    ensureColumn(connection, "session_steps", "title_pattern", "title_pattern TEXT");
  }

  if ((existingVersion ?? 0) < 11) {
    ensureColumn(connection, "raw_events", "browser_schema_version", "browser_schema_version INTEGER");
    ensureColumn(connection, "raw_events", "canonical_url", "canonical_url TEXT");
    ensureColumn(connection, "raw_events", "route_template", "route_template TEXT");
    ensureColumn(connection, "raw_events", "route_key", "route_key TEXT");
    ensureColumn(connection, "raw_events", "resource_hash", "resource_hash TEXT");

    ensureColumn(connection, "normalized_events", "browser_schema_version", "browser_schema_version INTEGER");
    ensureColumn(connection, "normalized_events", "canonical_url", "canonical_url TEXT");
    ensureColumn(connection, "normalized_events", "route_template", "route_template TEXT");
    ensureColumn(connection, "normalized_events", "route_key", "route_key TEXT");
    ensureColumn(connection, "normalized_events", "resource_hash", "resource_hash TEXT");
  }

  if ((existingVersion ?? 0) < 12) {
    ensureColumn(connection, "normalized_events", "route_family", "route_family TEXT");
    ensureColumn(connection, "normalized_events", "domain_pack_id", "domain_pack_id TEXT");
    ensureColumn(connection, "normalized_events", "domain_pack_version", "domain_pack_version INTEGER");
  }
}
