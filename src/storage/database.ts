import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import { ensureAppPaths, resolveAppPaths, type AppPaths } from "../app-paths.js";
import type {
  LLMWorkflowSummaryPayload,
  NormalizedEvent,
  RawEvent,
  RawEventInput,
  ReportSnapshot,
  ReportSnapshotSummary,
  Session,
  SessionSummary,
  WorkflowFeedback,
  WorkflowFeedbackSummary,
  WorkflowLLMAnalysis,
  WorkflowCluster,
  WorkflowSummaryPayloadRecord,
} from "../domain/types.js";
import { buildWorkflowSummaryPayload } from "../llm/payloads.js";
import { sanitizeRawEvent } from "../privacy/sanitize.js";
import {
  applySchemaMigrations,
  CURRENT_SCHEMA_VERSION,
  INITIAL_SCHEMA_SQL,
} from "./schema.js";

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
  app_name_normalized: string | null;
  domain: string | null;
  url: string | null;
  path_pattern: string | null;
  page_type: string | null;
  resource_hint: string | null;
  title_pattern: string | null;
  action: string;
  action_name: string | null;
  action_confidence: number | null;
  action_source: NormalizedEvent["actionSource"] | null;
  target: string | null;
  metadata_json: string;
  created_at: string;
}

interface WorkflowClusterRow {
  id: string;
  workflow_signature: string | null;
  name: string;
  occurrence_count: number | null;
  frequency: number;
  average_duration_seconds: number;
  total_duration_seconds: number;
  representative_sequence_json: string | null;
  representative_steps_json: string;
  involved_apps_json: string | null;
  confidence_score: number | null;
  top_variants_json: string | null;
  automation_suitability: WorkflowCluster["automationSuitability"];
  recommended_approach: string;
  excluded: number;
}

interface WorkflowFeedbackRow {
  id: string;
  workflow_cluster_id: string;
  workflow_signature: string;
  rename_to: string | null;
  business_purpose: string | null;
  excluded: number | null;
  hidden: number | null;
  repetitive: number | null;
  automation_candidate: number | null;
  automation_difficulty: WorkflowFeedback["automationDifficulty"] | null;
  approved_automation_candidate: number | null;
  merge_into_workflow_id: string | null;
  merge_into_workflow_signature: string | null;
  split_after_action_name: string | null;
  created_at: string;
}

interface SessionSummaryRow {
  id: string;
  start_time: string;
  end_time: string;
  primary_application: string;
  primary_domain: string | null;
  session_boundary_reason: Session["sessionBoundaryReason"];
  step_count: number;
}

interface SessionStepContextRow {
  session_id: string;
  normalized_event_id?: string;
  timestamp?: string;
  action?: string;
  action_name?: string;
  action_confidence?: number;
  action_source?: NormalizedEvent["actionSource"];
  application: string;
  domain: string | null;
  target?: string | null;
}

interface SessionRow {
  id: string;
  start_time: string;
  end_time: string;
  primary_application: string;
  primary_domain: string | null;
  session_boundary_reason: Session["sessionBoundaryReason"];
  session_boundary_details_json: string | null;
}

interface WorkflowLLMAnalysisRow {
  workflow_cluster_id: string;
  provider: string;
  model: string;
  workflow_name: string;
  workflow_summary: string;
  automation_suitability: WorkflowLLMAnalysis["automationSuitability"];
  recommended_approach: string;
  rationale: string;
  created_at: string;
}

interface SettingRow {
  key: string;
  value_json: string;
  updated_at: string;
}

interface ReportSnapshotRow {
  id: string;
  window: ReportSnapshot["timeWindow"]["window"];
  report_date: string;
  timezone: string;
  timezone_offset_minutes: number;
  start_time: string | null;
  end_time: string | null;
  total_sessions: number;
  total_tracked_duration_seconds: number;
  workflows_json: string;
  emerging_workflows_json: string;
  generated_at: string;
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

    applySchemaMigrations(this.connection, existingVersion.version);

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

  getRawEventsInRange(startInclusive: string, endExclusive: string): RawEvent[] {
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
        WHERE timestamp >= ? AND timestamp < ?
        ORDER BY timestamp ASC
      `)
      .all(startInclusive, endExclusive) as unknown as RawEventRow[];

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

  listNormalizedEvents(limit = 50): NormalizedEvent[] {
    const rows = this.connection
      .prepare(`
        SELECT
          id,
          raw_event_id,
          timestamp,
          application,
          app_name_normalized,
          domain,
          url,
          path_pattern,
          page_type,
          resource_hint,
          title_pattern,
          action,
          action_name,
          action_confidence,
          action_source,
          target,
          metadata_json,
          created_at
        FROM normalized_events
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(limit) as unknown as NormalizedEventRow[];

    return rows.map((row) => ({
      id: row.id,
      rawEventId: row.raw_event_id,
      timestamp: row.timestamp,
      application: row.application,
      appNameNormalized: row.app_name_normalized ?? row.application,
      domain: row.domain ?? undefined,
      url: row.url ?? undefined,
      pathPattern: row.path_pattern ?? undefined,
      pageType: row.page_type ?? undefined,
      resourceHint: row.resource_hint ?? undefined,
      titlePattern: row.title_pattern ?? undefined,
      action: row.action,
      actionName: row.action_name ?? row.action,
      actionConfidence: row.action_confidence ?? 0,
      actionSource: row.action_source ?? "inferred",
      target: row.target ?? undefined,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
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
          app_name_normalized,
          domain,
          url,
          path_pattern,
          page_type,
          resource_hint,
          title_pattern,
          action,
          action_name,
          action_confidence,
          action_source,
          target,
          metadata_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const event of args.normalizedEvents) {
        insertNormalizedEvent.run(
          event.id,
          event.rawEventId,
          event.timestamp,
          event.application,
          event.appNameNormalized,
          event.domain ?? null,
          event.url ?? null,
          event.pathPattern ?? null,
          event.pageType ?? null,
          event.resourceHint ?? null,
          event.titlePattern ?? null,
          event.action,
          event.actionName,
          event.actionConfidence,
          event.actionSource,
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
          session_boundary_reason,
          session_boundary_details_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertSessionStep = this.connection.prepare(`
        INSERT INTO session_steps (
          session_id,
          step_order,
          normalized_event_id,
          timestamp,
          action,
          action_name,
          action_confidence,
          action_source,
          application,
          domain,
          target
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const session of args.sessions) {
        insertSession.run(
          session.id,
          session.startTime,
          session.endTime,
          session.primaryApplication,
          session.primaryDomain ?? null,
          session.sessionBoundaryReason,
          JSON.stringify(session.sessionBoundaryDetails),
          new Date().toISOString(),
        );

        for (const step of session.steps) {
          insertSessionStep.run(
            session.id,
            step.order,
            step.normalizedEventId,
            step.timestamp,
            step.action,
            step.actionName,
            step.actionConfidence,
            step.actionSource,
            step.application,
            step.domain ?? null,
            step.target ?? null,
          );
        }
      }

      const insertWorkflowCluster = this.connection.prepare(`
        INSERT INTO workflow_clusters (
          id,
          workflow_signature,
          name,
          occurrence_count,
          frequency,
          average_duration_seconds,
          total_duration_seconds,
          representative_sequence_json,
          representative_steps_json,
          involved_apps_json,
          confidence_score,
          top_variants_json,
          automation_suitability,
          recommended_approach,
          excluded,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          workflow_signature = excluded.workflow_signature,
          name = excluded.name,
          occurrence_count = excluded.occurrence_count,
          frequency = excluded.frequency,
          average_duration_seconds = excluded.average_duration_seconds,
          total_duration_seconds = excluded.total_duration_seconds,
          representative_sequence_json = excluded.representative_sequence_json,
          representative_steps_json = excluded.representative_steps_json,
          involved_apps_json = excluded.involved_apps_json,
          confidence_score = excluded.confidence_score,
          top_variants_json = excluded.top_variants_json,
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
          cluster.workflowSignature,
          cluster.name,
          cluster.occurrenceCount,
          cluster.frequency,
          cluster.averageDurationSeconds,
          cluster.totalDurationSeconds,
          JSON.stringify(cluster.representativeSequence),
          JSON.stringify(cluster.representativeSteps),
          JSON.stringify(cluster.involvedApps),
          cluster.confidenceScore,
          JSON.stringify(cluster.topVariants),
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
          workflow_signature,
          name,
          occurrence_count,
          frequency,
          average_duration_seconds,
          total_duration_seconds,
          representative_sequence_json,
          representative_steps_json,
          involved_apps_json,
          confidence_score,
          top_variants_json,
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
      const feedback =
        feedbackByClusterId.get(row.id) ??
        feedbackByClusterId.get(row.workflow_signature ?? row.id);

      return {
        id: row.id,
        workflowSignature: row.workflow_signature ?? row.id,
        name: feedback?.renameTo ?? row.name,
        businessPurpose: feedback?.businessPurpose,
        sessionIds: sessionIdsByClusterId.get(row.id) ?? [],
        occurrenceCount: row.occurrence_count ?? row.frequency,
        frequency: row.frequency,
        averageDurationSeconds: row.average_duration_seconds,
        totalDurationSeconds: row.total_duration_seconds,
        representativeSequence: JSON.parse(
          row.representative_sequence_json ?? "[]",
        ) as WorkflowCluster["representativeSequence"],
        representativeSteps: JSON.parse(row.representative_steps_json) as string[],
        involvedApps: JSON.parse(row.involved_apps_json ?? "[]") as string[],
        confidenceScore: row.confidence_score ?? 0,
        topVariants: JSON.parse(row.top_variants_json ?? "[]") as WorkflowCluster["topVariants"],
        automationSuitability: row.automation_suitability,
        recommendedApproach: row.recommended_approach,
        excluded: feedback?.excluded ?? row.excluded === 1,
        hidden: feedback?.hidden ?? false,
        repetitive: feedback?.repetitive,
        automationCandidate: feedback?.automationCandidate,
        automationDifficulty: feedback?.automationDifficulty,
        approvedAutomationCandidate: feedback?.approvedAutomationCandidate,
        mergeIntoWorkflowId: feedback?.mergeIntoWorkflowId,
        mergeIntoWorkflowSignature: feedback?.mergeIntoWorkflowSignature,
        splitAfterActionName: feedback?.splitAfterActionName,
        userLabeled: Boolean(
          feedback?.renameTo ??
            feedback?.businessPurpose ??
            feedback?.repetitive ??
            feedback?.automationCandidate ??
            feedback?.automationDifficulty ??
            feedback?.approvedAutomationCandidate,
        ),
      };
    });
  }

  saveWorkflowFeedback(input: {
    workflowClusterId: string;
    renameTo?: string | undefined;
    businessPurpose?: string | undefined;
    excluded?: boolean | undefined;
    hidden?: boolean | undefined;
    repetitive?: boolean | undefined;
    automationCandidate?: boolean | undefined;
    automationDifficulty?: WorkflowFeedback["automationDifficulty"] | undefined;
    approvedAutomationCandidate?: boolean | undefined;
    mergeIntoWorkflowId?: string | undefined;
    splitAfterActionName?: string | undefined;
  }): WorkflowFeedback {
    if (
      input.renameTo === undefined &&
      input.businessPurpose === undefined &&
      input.excluded === undefined &&
      input.hidden === undefined &&
      input.repetitive === undefined &&
      input.automationCandidate === undefined &&
      input.automationDifficulty === undefined &&
      input.approvedAutomationCandidate === undefined &&
      input.mergeIntoWorkflowId === undefined &&
      input.splitAfterActionName === undefined
    ) {
      throw new Error("At least one workflow feedback field must be provided");
    }

    const workflowRow = this.connection
      .prepare(`
        SELECT id, workflow_signature
        FROM workflow_clusters
        WHERE id = ?
      `)
      .get(input.workflowClusterId) as
      | { id: string; workflow_signature: string | null }
      | undefined;

    if (!workflowRow) {
      throw new Error(`Workflow cluster not found: ${input.workflowClusterId}`);
    }

    const mergeTarget = input.mergeIntoWorkflowId
      ? (this.connection
          .prepare(`
            SELECT id, workflow_signature
            FROM workflow_clusters
            WHERE id = ?
          `)
          .get(input.mergeIntoWorkflowId) as
          | { id: string; workflow_signature: string | null }
          | undefined)
      : undefined;

    if (input.mergeIntoWorkflowId && !mergeTarget) {
      throw new Error(`Merge target workflow not found: ${input.mergeIntoWorkflowId}`);
    }

    const feedback: WorkflowFeedback = {
      id: randomUUID(),
      workflowClusterId: input.workflowClusterId,
      workflowSignature: workflowRow.workflow_signature ?? workflowRow.id,
      renameTo: input.renameTo,
      businessPurpose: input.businessPurpose,
      excluded: input.excluded,
      hidden: input.hidden,
      repetitive: input.repetitive,
      automationCandidate: input.automationCandidate,
      automationDifficulty: input.automationDifficulty,
      approvedAutomationCandidate: input.approvedAutomationCandidate,
      mergeIntoWorkflowId: input.mergeIntoWorkflowId,
      mergeIntoWorkflowSignature: mergeTarget?.workflow_signature ?? mergeTarget?.id,
      splitAfterActionName: input.splitAfterActionName,
      createdAt: new Date().toISOString(),
    };

    this.connection
      .prepare(`
        INSERT INTO workflow_feedback (
          id,
          workflow_cluster_id,
          workflow_signature,
          rename_to,
          business_purpose,
          excluded,
          hidden,
          repetitive,
          automation_candidate,
          automation_difficulty,
          approved_automation_candidate,
          merge_into_workflow_id,
          merge_into_workflow_signature,
          split_after_action_name,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        feedback.id,
        feedback.workflowClusterId,
        feedback.workflowSignature,
        feedback.renameTo ?? null,
        feedback.businessPurpose ?? null,
        feedback.excluded === undefined ? null : feedback.excluded ? 1 : 0,
        feedback.hidden === undefined ? null : feedback.hidden ? 1 : 0,
        feedback.repetitive === undefined ? null : feedback.repetitive ? 1 : 0,
        feedback.automationCandidate === undefined ? null : feedback.automationCandidate ? 1 : 0,
        feedback.automationDifficulty ?? null,
        feedback.approvedAutomationCandidate === undefined
          ? null
          : feedback.approvedAutomationCandidate
            ? 1
            : 0,
        feedback.mergeIntoWorkflowId ?? null,
        feedback.mergeIntoWorkflowSignature ?? null,
        feedback.splitAfterActionName ?? null,
        feedback.createdAt,
      );

    return feedback;
  }

  listWorkflowFeedbackSummary(): Map<string, WorkflowFeedbackSummary> {
    const rows = this.connection
      .prepare(`
        SELECT
          id,
          workflow_cluster_id,
          workflow_signature,
          rename_to,
          business_purpose,
          excluded,
          hidden,
          repetitive,
          automation_candidate,
          automation_difficulty,
          approved_automation_candidate,
          merge_into_workflow_id,
          merge_into_workflow_signature,
          split_after_action_name,
          created_at
        FROM workflow_feedback
        ORDER BY created_at ASC, id ASC
      `)
      .all() as unknown as WorkflowFeedbackRow[];
    const feedbackByClusterId = new Map<string, WorkflowFeedbackSummary>();

    for (const row of rows) {
      const current =
        feedbackByClusterId.get(row.workflow_signature) ??
        feedbackByClusterId.get(row.workflow_cluster_id) ??
        {};
      const summary: WorkflowFeedbackSummary = {
        renameTo: row.rename_to ?? current.renameTo,
        businessPurpose: row.business_purpose ?? current.businessPurpose,
        excluded: row.excluded === null ? current.excluded : row.excluded === 1,
        hidden: row.hidden === null ? current.hidden : row.hidden === 1,
        repetitive: row.repetitive === null ? current.repetitive : row.repetitive === 1,
        automationCandidate:
          row.automation_candidate === null
            ? current.automationCandidate
            : row.automation_candidate === 1,
        automationDifficulty: row.automation_difficulty ?? current.automationDifficulty,
        approvedAutomationCandidate:
          row.approved_automation_candidate === null
            ? current.approvedAutomationCandidate
            : row.approved_automation_candidate === 1,
        mergeIntoWorkflowId: row.merge_into_workflow_id ?? current.mergeIntoWorkflowId,
        mergeIntoWorkflowSignature:
          row.merge_into_workflow_signature ?? current.mergeIntoWorkflowSignature,
        splitAfterActionName: row.split_after_action_name ?? current.splitAfterActionName,
      };

      feedbackByClusterId.set(row.workflow_cluster_id, summary);
      feedbackByClusterId.set(row.workflow_signature, summary);
    }

    return feedbackByClusterId;
  }

  listSessionSummaries(): SessionSummary[] {
    const rows = this.connection
      .prepare(`
        SELECT
          sessions.id,
          sessions.start_time,
          sessions.end_time,
          sessions.primary_application,
          sessions.primary_domain,
          sessions.session_boundary_reason,
          COUNT(session_steps.normalized_event_id) AS step_count
        FROM sessions
        LEFT JOIN session_steps
          ON session_steps.session_id = sessions.id
        GROUP BY
          sessions.id,
          sessions.start_time,
          sessions.end_time,
          sessions.primary_application,
          sessions.primary_domain,
          sessions.session_boundary_reason
        ORDER BY sessions.start_time DESC
      `)
      .all() as unknown as SessionSummaryRow[];

    return rows.map((row) => ({
      id: row.id,
      startTime: row.start_time,
      endTime: row.end_time,
          primaryApplication: row.primary_application,
          primaryDomain: row.primary_domain ?? undefined,
          sessionBoundaryReason: row.session_boundary_reason,
          stepCount: row.step_count,
    }));
  }

  getSessionById(sessionId: string): Session | undefined {
    const sessionRow = this.connection
      .prepare(`
        SELECT
          id,
          start_time,
          end_time,
          primary_application,
          primary_domain,
          session_boundary_reason,
          session_boundary_details_json
        FROM sessions
        WHERE id = ?
      `)
      .get(sessionId) as SessionRow | undefined;

    if (!sessionRow) {
      return undefined;
    }

    const stepRows = this.connection
      .prepare(`
        SELECT
          session_id,
          normalized_event_id,
          timestamp,
          action,
          action_name,
          action_confidence,
          action_source,
          application,
          domain,
          target
        FROM session_steps
        WHERE session_id = ?
        ORDER BY step_order ASC
      `)
      .all(sessionId) as unknown as SessionStepContextRow[];

    return {
      id: sessionRow.id,
      startTime: sessionRow.start_time,
      endTime: sessionRow.end_time,
      primaryApplication: sessionRow.primary_application,
      primaryDomain: sessionRow.primary_domain ?? undefined,
      sessionBoundaryReason: sessionRow.session_boundary_reason,
      sessionBoundaryDetails: JSON.parse(sessionRow.session_boundary_details_json ?? "{}") as Record<
        string,
        unknown
      >,
      steps: stepRows.map((row, index) => ({
        order: index + 1,
        normalizedEventId: row.normalized_event_id ?? "",
        timestamp: row.timestamp ?? "",
        action: row.action ?? "",
        actionName: row.action_name ?? row.action ?? "",
        actionConfidence: row.action_confidence ?? 0,
        actionSource: row.action_source ?? "inferred",
        application: row.application,
        domain: row.domain ?? undefined,
        target: row.target ?? undefined,
      })),
    };
  }

  getWorkflowClusterById(workflowClusterId: string): WorkflowCluster | undefined {
    return this.listWorkflowClusters().find((cluster) => cluster.id === workflowClusterId);
  }

  deleteSessionSourceEvents(sessionId: string): number {
    const rawEventRows = this.connection
      .prepare(`
        SELECT DISTINCT normalized_events.raw_event_id
        FROM session_steps
        INNER JOIN normalized_events
          ON normalized_events.id = session_steps.normalized_event_id
        WHERE session_steps.session_id = ?
      `)
      .all(sessionId) as unknown as Array<{ raw_event_id: string }>;
    const rawEventIds = rawEventRows.map((row) => row.raw_event_id);

    if (rawEventIds.length === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const placeholders = rawEventIds.map(() => "?").join(", ");

    this.connection.exec("BEGIN");

    try {
      this.connection
        .prepare(`DELETE FROM raw_events WHERE id IN (${placeholders})`)
        .run(...rawEventIds);
      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }

    return rawEventIds.length;
  }

  listWorkflowSummaryPayloadRecords(options?: {
    includeExcluded?: boolean | undefined;
    includeHidden?: boolean | undefined;
  }): WorkflowSummaryPayloadRecord[] {
    const includeExcluded = options?.includeExcluded ?? false;
    const includeHidden = options?.includeHidden ?? false;
    const clusters = this.listWorkflowClusters().filter(
      (cluster) => (includeExcluded || !cluster.excluded) && (includeHidden || !cluster.hidden),
    );

    if (clusters.length === 0) {
      return [];
    }

    const sessionIds = [...new Set(clusters.flatMap((cluster) => cluster.sessionIds))];
    const placeholders = sessionIds.map(() => "?").join(", ");
    const stepRows = this.connection
      .prepare(`
        SELECT
          session_id,
          application,
          domain
        FROM session_steps
        WHERE session_id IN (${placeholders})
      `)
      .all(...sessionIds) as unknown as SessionStepContextRow[];
    const stepContextBySessionId = new Map<
      string,
      { applications: string[]; domains: string[] }
    >();

    for (const row of stepRows) {
      const current = stepContextBySessionId.get(row.session_id) ?? {
        applications: [],
        domains: [],
      };

      current.applications.push(row.application);
      if (row.domain) {
        current.domains.push(row.domain);
      }

      stepContextBySessionId.set(row.session_id, current);
    }

    return clusters.map((cluster) => {
      const applications: string[] = [];
      const domains: string[] = [];

      for (const sessionId of cluster.sessionIds) {
        const context = stepContextBySessionId.get(sessionId);

        if (!context) {
          continue;
        }

        applications.push(...context.applications);
        domains.push(...context.domains);
      }

      const payload: LLMWorkflowSummaryPayload = buildWorkflowSummaryPayload({
        representativeSteps: cluster.representativeSteps,
        frequency: cluster.frequency,
        averageDurationSeconds: cluster.averageDurationSeconds,
        applications,
        domains,
      });

      return {
        workflowClusterId: cluster.id,
        workflowName: cluster.name,
        payload,
      };
    });
  }

  replaceWorkflowLLMAnalyses(analyses: WorkflowLLMAnalysis[]): void {
    this.connection.exec("BEGIN");

    try {
      this.connection.exec("DELETE FROM workflow_llm_analyses");

      const insertAnalysis = this.connection.prepare(`
        INSERT INTO workflow_llm_analyses (
          workflow_cluster_id,
          provider,
          model,
          workflow_name,
          workflow_summary,
          automation_suitability,
          recommended_approach,
          rationale,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const analysis of analyses) {
        insertAnalysis.run(
          analysis.workflowClusterId,
          analysis.provider,
          analysis.model,
          analysis.workflowName,
          analysis.workflowSummary,
          analysis.automationSuitability,
          analysis.recommendedApproach,
          analysis.rationale,
          analysis.createdAt,
        );
      }

      this.connection.exec("COMMIT");
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  listWorkflowLLMAnalyses(): WorkflowLLMAnalysis[] {
    const rows = this.connection
      .prepare(`
        SELECT
          workflow_cluster_id,
          provider,
          model,
          workflow_name,
          workflow_summary,
          automation_suitability,
          recommended_approach,
          rationale,
          created_at
        FROM workflow_llm_analyses
        ORDER BY created_at DESC, workflow_cluster_id ASC
      `)
      .all() as unknown as WorkflowLLMAnalysisRow[];

    return rows.map((row) => ({
      workflowClusterId: row.workflow_cluster_id,
      provider: row.provider,
      model: row.model,
      workflowName: row.workflow_name,
      workflowSummary: row.workflow_summary,
      automationSuitability: row.automation_suitability,
      recommendedApproach: row.recommended_approach,
      rationale: row.rationale,
      createdAt: row.created_at,
    }));
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.connection
      .prepare(`
        SELECT key, value_json, updated_at
        FROM settings
        WHERE key = ?
      `)
      .get(key) as SettingRow | undefined;

    if (!row) {
      return undefined;
    }

    return JSON.parse(row.value_json) as T;
  }

  setSetting(key: string, value: unknown): void {
    this.connection
      .prepare(`
        INSERT INTO settings (
          key,
          value_json,
          updated_at
        ) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `)
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  deleteSetting(key: string): void {
    this.connection.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  upsertReportSnapshot(report: Omit<ReportSnapshot, "id" | "generatedAt">): ReportSnapshot {
    const existing = this.connection
      .prepare(`
        SELECT id
        FROM report_snapshots
        WHERE window = ? AND report_date = ? AND timezone = ?
      `)
      .get(
        report.timeWindow.window,
        report.timeWindow.reportDate,
        report.timeWindow.timezone,
      ) as { id: string } | undefined;
    const snapshot: ReportSnapshot = {
      ...report,
      id: existing?.id ?? randomUUID(),
      generatedAt: new Date().toISOString(),
    };

    this.connection
      .prepare(`
        INSERT INTO report_snapshots (
          id,
          window,
          report_date,
          timezone,
          timezone_offset_minutes,
          start_time,
          end_time,
          total_sessions,
          total_tracked_duration_seconds,
          workflows_json,
          emerging_workflows_json,
          generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(window, report_date, timezone) DO UPDATE SET
          timezone_offset_minutes = excluded.timezone_offset_minutes,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          total_sessions = excluded.total_sessions,
          total_tracked_duration_seconds = excluded.total_tracked_duration_seconds,
          workflows_json = excluded.workflows_json,
          emerging_workflows_json = excluded.emerging_workflows_json,
          generated_at = excluded.generated_at
      `)
      .run(
        snapshot.id,
        snapshot.timeWindow.window,
        snapshot.timeWindow.reportDate,
        snapshot.timeWindow.timezone,
        snapshot.timeWindow.timezoneOffsetMinutes,
        snapshot.timeWindow.startTime ?? null,
        snapshot.timeWindow.endTime ?? null,
        snapshot.totalSessions,
        snapshot.totalTrackedDurationSeconds,
        JSON.stringify(snapshot.workflows),
        JSON.stringify(snapshot.emergingWorkflows),
        snapshot.generatedAt,
      );

    return snapshot;
  }

  listReportSnapshots(options: {
    window?: ReportSnapshot["timeWindow"]["window"] | undefined;
    timezone?: string | undefined;
    limit?: number | undefined;
  } = {}): ReportSnapshotSummary[] {
    const rows = this.connection
      .prepare(`
        SELECT
          id,
          window,
          report_date,
          timezone,
          timezone_offset_minutes,
          start_time,
          end_time,
          total_sessions,
          total_tracked_duration_seconds,
          workflows_json,
          emerging_workflows_json,
          generated_at
        FROM report_snapshots
        WHERE (? IS NULL OR window = ?)
          AND (? IS NULL OR timezone = ?)
        ORDER BY report_date DESC, generated_at DESC, window ASC
        LIMIT ?
      `)
      .all(
        options.window ?? null,
        options.window ?? null,
        options.timezone ?? null,
        options.timezone ?? null,
        options.limit ?? 50,
      ) as unknown as ReportSnapshotRow[];

    return rows.map((row) => ({
      id: row.id,
      window: row.window,
      reportDate: row.report_date,
      timezone: row.timezone,
      totalSessions: row.total_sessions,
      workflowCount: (JSON.parse(row.workflows_json) as ReportSnapshot["workflows"]).length,
      emergingWorkflowCount: (JSON.parse(
        row.emerging_workflows_json,
      ) as ReportSnapshot["emergingWorkflows"]).length,
      generatedAt: row.generated_at,
    }));
  }

  getLatestReportSnapshot(window: ReportSnapshot["timeWindow"]["window"], timezone?: string): ReportSnapshot | undefined {
    const row = this.connection
      .prepare(`
        SELECT
          id,
          window,
          report_date,
          timezone,
          timezone_offset_minutes,
          start_time,
          end_time,
          total_sessions,
          total_tracked_duration_seconds,
          workflows_json,
          emerging_workflows_json,
          generated_at
        FROM report_snapshots
        WHERE window = ?
          AND (? IS NULL OR timezone = ?)
        ORDER BY report_date DESC, generated_at DESC
        LIMIT 1
      `)
      .get(window, timezone ?? null, timezone ?? null) as ReportSnapshotRow | undefined;

    return row ? this.toReportSnapshot(row) : undefined;
  }

  getReportSnapshotByWindowAndDate(
    window: ReportSnapshot["timeWindow"]["window"],
    reportDate: string,
    timezone?: string,
  ): ReportSnapshot | undefined {
    const row = this.connection
      .prepare(`
        SELECT
          id,
          window,
          report_date,
          timezone,
          timezone_offset_minutes,
          start_time,
          end_time,
          total_sessions,
          total_tracked_duration_seconds,
          workflows_json,
          emerging_workflows_json,
          generated_at
        FROM report_snapshots
        WHERE window = ?
          AND report_date = ?
          AND (? IS NULL OR timezone = ?)
        ORDER BY generated_at DESC
        LIMIT 1
      `)
      .get(window, reportDate, timezone ?? null, timezone ?? null) as ReportSnapshotRow | undefined;

    return row ? this.toReportSnapshot(row) : undefined;
  }

  private toReportSnapshot(row: ReportSnapshotRow): ReportSnapshot {
    return {
      id: row.id,
      timeWindow: {
        window: row.window,
        reportDate: row.report_date,
        timezone: row.timezone,
        timezoneOffsetMinutes: row.timezone_offset_minutes,
        startTime: row.start_time ?? undefined,
        endTime: row.end_time ?? undefined,
      },
      totalSessions: row.total_sessions,
      totalTrackedDurationSeconds: row.total_tracked_duration_seconds,
      workflows: JSON.parse(row.workflows_json) as ReportSnapshot["workflows"],
      emergingWorkflows: JSON.parse(
        row.emerging_workflows_json,
      ) as ReportSnapshot["emergingWorkflows"],
      generatedAt: row.generated_at,
    };
  }

  clearAllData(): void {
    this.connection.exec(`
      DELETE FROM report_snapshots;
      DELETE FROM workflow_llm_analyses;
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
