# Project Reference

Internal reference for the current repository state.

## Purpose

**What I've Done** is a local-first workflow pattern analyzer. It captures desktop and browser activity metadata, stores that data locally in SQLite, normalizes noisy events into stable workflow context, maps them into semantic actions, segments them into sessions, clusters near-matching workflows, and produces workflow-centric reports that highlight automation candidates.

The project is for workflow analysis and discovery. It does not execute automation.

## Current Implementation Status

Implemented today:

- TypeScript CLI
- local SQLite storage using `node:sqlite`
- sensitive metadata sanitization before persistence
- deterministic mock workflow generator
- JSON and NDJSON raw-event import
- local HTTP ingest server
- Chrome extension scaffold for browser activity metadata
- Windows PowerShell active-window collector path
- macOS Swift active-window collector path with permission checks and one-shot capture
- resident local agent runtime with persisted heartbeat and health state
- agent-managed ingest server lifecycle
- collector supervision for macOS and Windows command paths
- agent-managed snapshot scheduler
- normalization, semantic action abstraction, sessionization, workflow clustering, and all-time/daily/weekly reporting
- persisted daily and weekly report snapshots
- workflow rename, label, merge, split, exclude, include, hide, and unhide feedback
- session listing, session detail, and session deletion with reanalysis
- practical automation hints in workflow reports
- LLM-safe workflow payload export
- OpenAI Responses API adapter for summarized workflow analysis
- macOS Keychain-backed storage for the OpenAI API key
- macOS LaunchAgent autostart helpers and CLI commands

Not implemented yet:

- Windows click, file operation, and clipboard collectors
- Windows autostart installation flow
- desktop UI
- workflow feedback UI
- additional LLM providers beyond the current OpenAI adapter
- secure credential storage on non-macOS platforms
- report comparison views such as day-over-day or week-over-week diffs

## Runtime Architecture

The current runtime is split into three planes.

- runtime plane
  - resident agent
  - local ingest server
  - collector supervision
  - snapshot scheduler
- control plane
  - CLI commands such as `agent:status`, `agent:health`, and `agent:run-once`
- data plane
  - raw events
  - normalized events
  - sessions
  - workflow clusters
  - report snapshots
  - workflow feedback

The resident agent is implemented under `src/agent/`.

- `src/agent/runtime.ts`
- `src/agent/lock.ts`
- `src/agent/state.ts`
- `src/agent/collectors.ts`
- `src/agent/scheduler.ts`
- `src/agent/control.ts`
- `src/agent/autostart/`

## Analysis Pipeline

1. Raw events are collected from mock data, imported files, the local ingest server, or desktop collectors.
2. Sensitive fields are sanitized before they are written to SQLite.
3. Raw events are normalized into stable context fields such as app alias, path pattern, page type, resource hint, and title pattern.
4. Normalized events are mapped into semantic action labels with confidence and source metadata.
5. Events are grouped into sessions with explainable boundary reasons.
6. Similar sessions are clustered into workflows with representative sequences, variants, confidence, and automation hints.
7. Reports, snapshots, and safe LLM summary payloads are generated from those workflow clusters.

Current heuristic defaults in code:

- session inactivity split: 150 seconds
- context-shift split: 75 seconds with significant context change
- minimum workflow session duration: 45 seconds
- minimum workflow frequency: 3 similar sessions within 7 days

## Report Scope

Current report behavior:

- `report` prints all-time, daily, or weekly workflow reports directly from local data
- report output includes summary sections, workflow graphs, confidence, and automation hints
- `report:generate` stores a snapshot for a selected report window and date
- `report:snapshot:list` and `report:snapshot:show` read stored snapshots
- `agent:run-once` triggers one snapshot cycle through the control plane
- `agent:snapshot:latest` shows the latest stored snapshots for selected windows
- `agent:run` keeps day/week snapshots fresh automatically through the resident scheduler
- `report:scheduler` still exists as a legacy/manual fallback path

## Privacy Boundaries

Collected metadata:

- application name
- window title
- URL and domain
- event action and target hints
- timestamps
- session structure

Never collected:

- raw keystrokes
- passwords
- email body content
- document content
- clipboard text content
- authentication tokens or cookies
- continuous screenshots
- screen recordings

## Setup

Requirements:

- Node.js `22.x` or later
- npm `10.x` or later
- Chrome for live browser collection
- Windows PowerShell for the Windows active-window collector
- Xcode or Xcode Command Line Tools with Swift for the macOS active-window collector
- `OPENAI_API_KEY` for `llm:analyze` when no key is stored in secure storage

Install:

```bash
npm install
```

Recommended verification:

```bash
npm run typecheck
npm test
npm run build
```

## Core Usage

Recommended agent-first flow:

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- agent:run-once --data-dir ./tmp/local-data
npm run dev -- agent:snapshot:latest --data-dir ./tmp/local-data
```

Run the resident agent:

```bash
npm run dev -- agent:run --data-dir ./tmp/live-data
```

Inspect or stop it:

```bash
npm run dev -- agent:status --data-dir ./tmp/live-data
npm run dev -- agent:health --data-dir ./tmp/live-data
npm run dev -- agent:collectors --data-dir ./tmp/live-data
npm run dev -- agent:stop --data-dir ./tmp/live-data
```

Manual analysis flow:

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- report --data-dir ./tmp/local-data --window week --json
```

Generate and inspect stored snapshots:

```bash
npm run dev -- report:generate --data-dir ./tmp/local-data --window day --json
npm run dev -- report:snapshot:list --data-dir ./tmp/local-data --json
npm run dev -- report:snapshot:show --data-dir ./tmp/local-data --window week --latest --json
```

Legacy/manual scheduler flow:

```bash
npm run dev -- report:scheduler --data-dir ./tmp/local-data --once --json
```

One-command demo:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

## Feedback Commands

Show one workflow:

```bash
npm run dev -- workflow:show <workflow-id> --data-dir ./tmp/local-data --json
```

Label, merge, split, exclude, or hide a workflow:

```bash
npm run dev -- workflow:rename <workflow-id> "New workflow name" --data-dir ./tmp/local-data
npm run dev -- workflow:label <workflow-id> --purpose "Review shipping status" --automation-candidate true --difficulty medium --data-dir ./tmp/local-data
npm run dev -- workflow:merge <workflow-id> <target-workflow-id> --data-dir ./tmp/local-data
npm run dev -- workflow:split <workflow-id> --after-action search_order --data-dir ./tmp/local-data
npm run dev -- workflow:exclude <workflow-id> --data-dir ./tmp/local-data
npm run dev -- workflow:hide <workflow-id> --data-dir ./tmp/local-data
```

List or show sessions:

```bash
npm run dev -- session:list --data-dir ./tmp/local-data --json
npm run dev -- session:show <session-id> --data-dir ./tmp/local-data --json
```

Delete a session and reanalyze:

```bash
npm run dev -- session:delete <session-id> --data-dir ./tmp/local-data
```

## LLM Commands

Print LLM-safe payloads:

```bash
npm run dev -- llm:payloads --data-dir ./tmp/local-data
```

Run OpenAI workflow analysis:

```bash
export OPENAI_API_KEY="your-api-key"
npm run dev -- llm:analyze --data-dir ./tmp/local-data --json
```

Apply LLM-generated names:

```bash
npm run dev -- llm:analyze --data-dir ./tmp/local-data --apply-names --json
```

List stored LLM results:

```bash
npm run dev -- llm:results --data-dir ./tmp/local-data --json
```

Secure credential commands:

```bash
npm run dev -- credential:status
npm run dev -- credential:set-openai
npm run dev -- credential:delete-openai
```

## CLI Command Reference

| Command | Description |
| --- | --- |
| `doctor` | Print runtime information and default storage paths. |
| `init` | Initialize local SQLite storage. |
| `collect:mock` | Insert deterministic sample events for testing. |
| `collect:macos:once` | Capture the current macOS frontmost app once and store it. |
| `import:events` | Import raw events from a JSON or NDJSON file. |
| `analyze` | Normalize events, build sessions, and detect workflows. |
| `agent:run` | Run the resident local agent. |
| `agent:status` | Show agent status and runtime state. |
| `agent:stop` | Stop the running agent. |
| `agent:health` | Show ingest, scheduler, and collector health. |
| `agent:run-once` | Run one agent collection and snapshot cycle. |
| `agent:snapshot:latest` | Show the latest stored snapshots. |
| `agent:collectors` | Show collector supervision state. |
| `agent:autostart:status` | Show macOS LaunchAgent autostart status. |
| `agent:autostart:install` | Install the macOS LaunchAgent helper. |
| `agent:autostart:uninstall` | Remove the macOS LaunchAgent helper. |
| `collector:list` | List available collectors and scripts. |
| `collector:macos:check` | Check macOS collector permission status. |
| `collector:macos:info` | Show macOS collector usage, permissions, and file paths. |
| `collector:windows:info` | Show Windows collector usage and file paths. |
| `report` | Print all-time, daily, or weekly workflow reports. |
| `report:generate` | Generate and store a report snapshot. |
| `report:snapshot:list` | List stored report snapshots. |
| `report:snapshot:show` | Show one stored report snapshot. |
| `report:scheduler` | Run the legacy/manual report snapshot scheduler. |
| `workflow:list` | List workflow clusters with feedback state. |
| `workflow:show` | Show one workflow cluster in detail. |
| `workflow:rename` | Rename a workflow cluster. |
| `workflow:label` | Save workflow name, purpose, repetitive flag, and automation review fields. |
| `workflow:merge` | Merge one workflow into another on future analyses. |
| `workflow:split` | Split a workflow after a selected action on future analyses. |
| `workflow:exclude` | Exclude a workflow cluster from report output. |
| `workflow:include` | Re-include an excluded workflow cluster. |
| `workflow:hide` | Hide an incorrect workflow cluster. |
| `workflow:unhide` | Show a hidden workflow cluster again. |
| `session:list` | List analyzed sessions. |
| `session:show` | Show one analyzed session with ordered steps. |
| `session:delete` | Delete a session's source events and rerun analysis. |
| `llm:payloads` | Print summarized workflow payloads without raw logs. |
| `llm:analyze` | Run summarized workflow analysis through the OpenAI adapter. |
| `llm:results` | List stored LLM analysis results. |
| `credential:status` | Show secure credential backend status. |
| `credential:set-openai` | Store the OpenAI API key in secure OS credential storage. |
| `credential:delete-openai` | Delete the stored OpenAI API key from secure storage. |
| `serve` | Run the standalone local HTTP ingest server. |
| `demo` | Reset data, seed mock events, run analysis, and print a report. |
| `reset` | Delete all locally stored events and analysis artifacts. |
