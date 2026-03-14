import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import { ensureAppPaths, resolveAppPaths, type AppPaths } from "../app-paths.js";
import type {
  NormalizedEvent,
  RawEvent,
  RawEventInput,
  Session,
  WorkflowFeedback,
  WorkflowCluster,
} from "../domain/types.js";
import { sanitizeRawEvent } from "../privacy/sanitize.js";
import { CURRENT_SCHEMA_VERSION, INITIAL_SCHEMA_SQL } from "./schema.js";

interface RawEventRow {
  id: string;
  source: string;
  source_event_type: string;
  timestamp: string;
  application: string;
  window_title: string | null;
  domain: string | null;
  url: string | null;
  action: string;
  target: string | null;
  metadata_json: string;
  sensitive_filtered: number;
  created_at: string;
}

interface NormalizedEventRow {
  id: string;
  raw_event_id: string;
  timestamp: string;
  application: string;
  domain: string | null;
  action: string;
  target: string | null;
  metadata_json: string;
  created_at: string;
}

interface WorkflowClusterRow {
  id: string;
  name: string;
  frequency: number;
  average_duration_seconds: number;
  total_duration_seconds: number;
  representative_steps_json: string;
  automation_suitability: WorkflowCluster["automationSuitability"];
  recommended_approach: string;
  excluded: number;
}

interface WorkflowFeedbackRow {
  id: string;
  workflow_cluster_id: string;
  rename_to: string | null;
  excluded: number | null;
  hidden: number | null;
  created_at: string;
}

interface EffectiveWorkflowFeedback {
  renameTo?: string | undefined;
  excluded?: boolean | undefined;
  hidden?: boolean | undefined;
}

export class AppDatabase {
  readonly paths: AppPaths;
  readonly connection: DatabaseSync;

  constructor(paths = resolveAppPaths()) {
    this.paths = paths;
    ensureAppPaths(paths);
    this.connection = new DatabaseSync(paths.databasePath);
  }

  initialize(): void {
    this.connection.exec(INITIAL_SCHEMA_SQL);

    const existingVersion = this.connection
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get() as { version: number | null };

    if (existingVersion.version === CURRENT_SCHEMA_VERSION) {
      return;
    }

    this.connection
      .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(CURRENT_SCHEMA_VERSION, new Date().toISOString());
  }

  close(): void {
    this.connection.close();
  }

  insertRawEvent(input: RawEventInput): RawEvent {
    const sanitized = sanitizeRawEvent(input);
    const record: RawEvent = {
      id: randomUUID(),
      source: sanitized.source,
      sourceEventType: sanitized.sourceEventType,
      timestamp: sanitized.timestamp,
      application: sanitized.application,
      windowTitle: sanitized.windowTitle,
      domain: sanitized.domain,
      url: sanitized.url,
      action: sanitized.action,
      target: sanitized.target,
      metadata: sanitized.metadata ?? {},
      sensitiveFiltered: true,
      createdAt: new Date().toISOString(),
    };

    this.connection
      .prepare(`
        INSERT INTO raw_events (
          id,
          source,
          source_event_type,
          timestamp,
          application,
          window_title,
          domain,
          url,
          action,
          target,
          metadata_json,
          sensitive_filtered,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.source,
        record.sourceEventType,
        record.timestamp,
        record.application,
        record.windowTitle ?? null,
        record.domain ?? null,
        record.url ?? null,
        record.action,
        record.target ?? null,
        JSON.stringify(record.metadata),
        record.sensitiveFiltered ? 1 : 0,
        record.createdAt,
      );

    return record;
  }

  listRawEvents(limit = 50): RawEvent[] {
    const rows = this.connection
      .prepare(`
        SELECT
          id,
          source,
          source_event_type,
          timestamp,
          application,
          window_title,
          domain,
          url,
          action,
          target,
          metadata_json,
          sensitive_filtered,
          created_at
        FROM raw_events
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(limit) as unknown as RawEventRow[];

    return rows.map((row) => ({
      id: row.id,
      source: row.source as RawEvent["source"],
      sourceEventType: row.source_event_type,
      timestamp: row.timestamp,
      application: row.application,
      windowTitle: row.window_title ?? undefined,
      domain: row.domain ?? undefined,
      url: row.url ?? undefined,
      action: row.action,
      target: row.target ?? undefined,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      sensitiveFiltered: row.sensitive_filtered === 1,
      createdAt: row.created_at,
    }));
  }

  getRawEventsChronological(): RawEvent[] {
    const rows = this.connection
      .prepare(`
        SELECT
          id,
          source,
          source_event_type,
          timestamp,
          application,
          window_title,
          domain,
          url,
          action,
          target,
          metadata_json,
          sensitive_filtered,
          created_at
        FROM raw_events
        ORDER BY timestamp ASC
      `)
      .all() as unknown as RawEventRow[];

    return rows.map((row) => ({
      id: row.id,
      source: row.source as RawEvent["source"],
      sourceEventType: row.source_event_type,
      timestamp: row.timestamp,
      application: row.application,
      windowTitle: row.window_title ?? undefined,
      domain: row.domain ?? undefined,
      url: row.url ?? undefined,
      action: row.action,
      target: row.target ?? undefined,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      sensitiveFiltered: row.sensitive_filtered === 1,
      createdAt: row.created_at,
    }));
  }

  replaceAnalysisArtifacts(args: {
    normalizedEvents: NormalizedEvent[];
    sessions: Session[];
    workflowClusters: WorkflowCluster[];
  }): void {
    this.connection.exec("BEGIN");

    try {
      this.connection.exec(`
        DELETE FROM workflow_cluster_sessions;
        DELETE FROM session_steps;
        DELETE FROM sessions;
        DELETE FROM normalized_events;
      `);

      const insertNormalizedEvent = this.connection.prepare(`
        INSERT INTO normalized_events (
          id,
          raw_event_id,
          timestamp,
          application,
          domain,
          action,
          target,
          metadata_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const event of args.normalizedEvents) {
        insertNormalizedEvent.run(
          event.id,
          event.rawEventId,
          event.timestamp,
          event.application,
          event.domain ?? null,
          event.action,
          event.target ?? null,
          JSON.stringify(event.metadata),
          event.createdAt,
        );
      }

      const insertSession = this.connection.prepare(`
        INSERT INTO sessions (
          id,
          start_time,
          end_time,
          primary_application,
          primary_domain,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const insertSessionStep = this.connection.prepare(`
        INSERT INTO session_steps (
          session_id,
          step_order,
          normalized_event_id,
          timestamp,
          action,
          application,
          domain,
          target
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const session of args.sessions) {
        insertSession.run(
          session.id,
          session.startTime,
          session.endTime,
          session.primaryApplication,
          session.primaryDomain ?? null,
          new Date().toISOString(),
        );

        for (const step of session.steps) {
          insertSessionStep.run(
            session.id,
            step.order,
            step.normalizedEventId,
            step.timestamp,
            step.action,
            step.application,
            step.domain ?? null,
            step.target ?? null,
          );
        }
      }

      const insertWorkflowCluster = this.connection.prepare(`
        INSERT INTO workflow_clusters (
          id,
          name,
          frequency,
          average_duration_seconds,
          total_duration_seconds,
          representative_steps_json,
          automation_suitability,
          recommended_approach,
          excluded,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          frequency = excluded.frequency,
          average_duration_seconds = excluded.average_duration_seconds,
          total_duration_seconds = excluded.total_duration_seconds,
          representative_steps_json = excluded.representative_steps_json,
          automation_suitability = excluded.automation_suitability,
          recommended_approach = excluded.recommended_approach,
          excluded = excluded.excluded,
          created_at = excluded.created_at
      `);
      const insertWorkflowClusterSession = this.connection.prepare(`
        INSERT INTO workflow_cluster_sessions (
          workflow_cluster_id,
          session_id
        ) VALUES (?, ?)
      `);

      for (const cluster of args.workflowClusters) {
        insertWorkflowCluster.run(
          cluster.id,
          cluster.name,
          cluster.frequency,
          cluster.averageDurationSeconds,
          cluster.totalDurationSeconds,
          JSON.stringify(cluster.representativeSteps),
          cluster.automationSuitability,
          cluster.recommendedApproach,
          cluster.excluded ? 1 : 0,
          new Date().toISOString(),
        );
      }

      if (args.workflowClusters.length === 0) {
        this.connection.exec("DELETE FROM workflow_clusters");
      } else {
        const placeholders = args.workflowClusters.map(() => "?").join(", ");

        this.connection
          .prepare(`DELETE FROM workflow_clusters WHERE id NOT IN (${placeholders})`)
          .run(...args.workflowClusters.map((cluster) => cluster.id));
      }

      for (const cluster of args.workflowClusters) {
        for (const sessionId of cluster.sessionIds) {
          insertWorkflowClusterSession.run(cluster.id, sessionId);
        }
      }

      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  listWorkflowClusters(): WorkflowCluster[] {
    const rows = this.connection
      .prepare(`
        SELECT
          id,
          name,
          frequency,
          average_duration_seconds,
          total_duration_seconds,
          representative_steps_json,
          automation_suitability,
          recommended_approach,
          excluded
        FROM workflow_clusters
        ORDER BY frequency DESC, total_duration_seconds DESC
      `)
      .all() as unknown as WorkflowClusterRow[];

    const sessionRows = this.connection
      .prepare(`
        SELECT workflow_cluster_id, session_id
        FROM workflow_cluster_sessions
      `)
      .all() as unknown as Array<{ workflow_cluster_id: string; session_id: string }>;
    const sessionIdsByClusterId = new Map<string, string[]>();

    for (const row of sessionRows) {
      sessionIdsByClusterId.set(row.workflow_cluster_id, [
        ...(sessionIdsByClusterId.get(row.workflow_cluster_id) ?? []),
        row.session_id,
      ]);
    }

    const feedbackByClusterId = this.listWorkflowFeedbackSummary();

    return rows.map((row) => {
      const feedback = feedbackByClusterId.get(row.id);

      return {
      id: row.id,
      name: feedback?.renameTo ?? row.name,
      sessionIds: sessionIdsByClusterId.get(row.id) ?? [],
      frequency: row.frequency,
      averageDurationSeconds: row.average_duration_seconds,
      totalDurationSeconds: row.total_duration_seconds,
      representativeSteps: JSON.parse(row.representative_steps_json) as string[],
      automationSuitability: row.automation_suitability,
      recommendedApproach: row.recommended_approach,
      excluded: feedback?.excluded ?? row.excluded === 1,
      hidden: feedback?.hidden ?? false,
      };
    });
  }

  saveWorkflowFeedback(input: {
    workflowClusterId: string;
    renameTo?: string | undefined;
    excluded?: boolean | undefined;
    hidden?: boolean | undefined;
  }): WorkflowFeedback {
    if (
      input.renameTo === undefined &&
      input.excluded === undefined &&
      input.hidden === undefined
    ) {
      throw new Error("At least one workflow feedback field must be provided");
    }

    const feedback: WorkflowFeedback = {
      id: randomUUID(),
      workflowClusterId: input.workflowClusterId,
      renameTo: input.renameTo,
      excluded: input.excluded,
      hidden: input.hidden,
      createdAt: new Date().toISOString(),
    };

    this.connection
      .prepare(`
        INSERT INTO workflow_feedback (
          id,
          workflow_cluster_id,
          rename_to,
          excluded,
          hidden,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        feedback.id,
        feedback.workflowClusterId,
        feedback.renameTo ?? null,
        feedback.excluded === undefined ? null : feedback.excluded ? 1 : 0,
        feedback.hidden === undefined ? null : feedback.hidden ? 1 : 0,
        feedback.createdAt,
      );

    return feedback;
  }

  listWorkflowFeedbackSummary(): Map<string, EffectiveWorkflowFeedback> {
    const rows = this.connection
      .prepare(`
        SELECT
          id,
          workflow_cluster_id,
          rename_to,
          excluded,
          hidden,
          created_at
        FROM workflow_feedback
        ORDER BY created_at ASC, id ASC
      `)
      .all() as unknown as WorkflowFeedbackRow[];
    const feedbackByClusterId = new Map<string, EffectiveWorkflowFeedback>();

    for (const row of rows) {
      const current = feedbackByClusterId.get(row.workflow_cluster_id) ?? {};

      feedbackByClusterId.set(row.workflow_cluster_id, {
        renameTo: row.rename_to ?? current.renameTo,
        excluded: row.excluded === null ? current.excluded : row.excluded === 1,
        hidden: row.hidden === null ? current.hidden : row.hidden === 1,
      });
    }

    return feedbackByClusterId;
  }

  clearAllData(): void {
    this.connection.exec(`
      DELETE FROM workflow_cluster_sessions;
      DELETE FROM workflow_feedback;
      DELETE FROM workflow_clusters;
      DELETE FROM session_steps;
      DELETE FROM sessions;
      DELETE FROM normalized_events;
      DELETE FROM raw_events;
      DELETE FROM analysis_runs;
      DELETE FROM settings;
    `);
  }
}
