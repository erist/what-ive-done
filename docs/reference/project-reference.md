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
- localhost-only ingest auth token and request rate limiting
- local browser viewer served from the same local HTTP server
- Chrome extension scaffold for browser activity metadata
- golden workflow fixtures and debug trace commands
- Windows PowerShell active-window collector path
- macOS Swift active-window collector path with permission checks and one-shot capture
- resident local agent runtime with persisted heartbeat and health state
- agent-managed ingest server lifecycle
- collector supervision for macOS and Windows command paths
- agent-managed snapshot scheduler
- normalization, semantic action abstraction, sessionization, workflow clustering, and all-time/daily/weekly reporting
- persisted daily and weekly report snapshots
- live browser dashboard for agent health, workflow reports, snapshots, and session drill-down
- workflow rename, label, merge, split, exclude, include, hide, and unhide feedback
- session listing, session detail, and session deletion with reanalysis
- practical automation hints in workflow reports
- LLM-safe workflow payload export
- OpenAI, Gemini, and Claude adapters for summarized workflow analysis
- saved default LLM provider/model/auth configuration
- macOS Keychain-backed storage for provider API keys and Gemini OAuth credentials
- macOS LaunchAgent autostart helpers and CLI commands

Not implemented yet:

- Windows click, file operation, and clipboard collectors
- Windows autostart installation flow
- packaged desktop app or tray UI
- browser-based workflow feedback write UI
- secure credential storage on non-macOS platforms
- report comparison views such as day-over-day or week-over-week diffs

## Runtime Architecture

The current runtime is split into three planes.

- runtime plane
  - resident agent
  - local ingest server and browser viewer
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

## Debugging and Quality Gates

Quality debugging now has two fixed surfaces:

- `fixtures/golden/` contains representative workflow fixtures used as regression gates.
- debug CLI commands expose `raw -> normalized -> action -> session -> workflow cluster` transitions.

Debug flow:

```bash
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- debug:raw:list --data-dir ./tmp/local-data --limit 10
npm run dev -- debug:normalized:list --data-dir ./tmp/local-data --limit 10
npm run dev -- debug:trace:raw <raw-event-id> --data-dir ./tmp/local-data
npm run dev -- debug:trace:session <session-id> --data-dir ./tmp/local-data
npm run dev -- debug:trace:workflow <workflow-id> --data-dir ./tmp/local-data
```

## Ingest Security

Browser ingest is now protected by three defaults:

- localhost-only bind enforcement
- shared auth token for browser and collector POST requests
- request rate limiting for abnormal bursts

Useful commands:

```bash
npm run dev -- ingest:token --data-dir ./tmp/live-data --rotate
npm run dev -- doctor --data-dir ./tmp/live-data
npm run dev -- server:run --data-dir ./tmp/live-data --verbose
```

## Report Scope

Current report behavior:

- `report` prints all-time, daily, or weekly workflow reports directly from local data
- report output includes summary sections, workflow graphs, confidence, and automation hints
- `/` opens a local browser viewer with live report recomputation, latest snapshots, and session detail drill-down
- `report:generate` stores a snapshot for a selected report window and date
- `report:snapshot:list` and `report:snapshot:show` read stored snapshots
- `agent:run-once` triggers one snapshot cycle through the control plane
- `agent:snapshot:latest` shows the latest stored snapshots for selected windows
- `agent:run` keeps day/week snapshots fresh automatically through the resident scheduler
- a hidden deprecated `report:scheduler` alias still exists for manual/internal fallback paths

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
- provider API key env vars such as `OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, and `ANTHROPIC_API_KEY` when no key is stored in secure storage

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
npm run dev -- ingest:token --data-dir ./tmp/live-data --rotate
npm run dev -- agent:run --data-dir ./tmp/live-data --verbose
```

Run the resident agent and open the local browser viewer:

```bash
npm run dev -- agent:run --data-dir ./tmp/live-data --open-viewer
```

Open the local browser viewer directly:

```bash
npm run dev -- viewer:open --data-dir ./tmp/live-data
```

Default local viewer URL:

```text
http://127.0.0.1:4318/
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

Run the standalone local HTTP server for collectors and the browser viewer:

```bash
npm run dev -- server:run --data-dir ./tmp/live-data --open --verbose
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
npm run dev -- workflow:label <workflow-id> --name "New workflow name" --purpose "Review shipping status" --automation-candidate true --difficulty medium --data-dir ./tmp/local-data
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

Configure a default provider and run workflow analysis:

```bash
npm run dev -- llm:providers --json
npm run dev -- llm:config:set --data-dir ./tmp/local-data --provider gemini --auth api-key --model gemini-2.5-flash
export GEMINI_API_KEY="your-api-key"
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
npm run dev -- credential:set openai
npm run dev -- credential:set gemini
npm run dev -- credential:set claude
npm run dev -- credential:delete gemini
```

Gemini OAuth login:

```bash
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_CLOUD_PROJECT="your-project-id"
npm run dev -- auth:login gemini --data-dir ./tmp/local-data
npm run dev -- auth:logout gemini --data-dir ./tmp/local-data
```

## CLI Command Reference

| Command | Description |
| --- | --- |
| `doctor` | Print runtime information, storage paths, and ingest security status. |
| `init` | Initialize local SQLite storage. |
| `collect:mock` | Insert deterministic sample events for testing. |
| `collect:macos:once` | Capture the current macOS frontmost app once and store it. |
| `import:events` | Import raw events from a JSON or NDJSON file. |
| `analyze` | Normalize events, build sessions, and detect workflows. |
| `ingest:token` | Print or rotate the shared local ingest auth token. |
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
| `viewer:open` | Open the local browser viewer in the default browser. |
| `debug:raw:list` | List recent raw events for trace selection. |
| `debug:normalized:list` | List recent normalized events and semantic actions. |
| `debug:trace:raw` | Trace one raw event through the interpretation pipeline. |
| `debug:trace:session` | Trace one session back to raw events and its cluster. |
| `debug:trace:workflow` | Trace one workflow cluster to member sessions and boundaries. |
| `collector:list` | List available collectors and scripts. |
| `collector:macos:check` | Check macOS collector permission status. |
| `collector:macos:info` | Show macOS collector usage, permissions, and file paths. |
| `collector:windows:info` | Show Windows collector usage and file paths. |
| `report` | Print all-time, daily, or weekly workflow reports. |
| `report:generate` | Generate and store a report snapshot. |
| `report:snapshot:list` | List stored report snapshots. |
| `report:snapshot:show` | Show one stored report snapshot. |
| `workflow:list` | List workflow clusters with feedback state. |
| `workflow:show` | Show one workflow cluster in detail. |
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
| `llm:providers` | List supported ChatGPT, Gemini, and Claude providers with auth methods. |
| `llm:config:show` | Show the saved default LLM provider/model/auth configuration. |
| `llm:config:set` | Update the saved default LLM provider/model/auth configuration. |
| `llm:analyze` | Run summarized workflow analysis through the configured provider or CLI override. |
| `llm:results` | List stored LLM analysis results. |
| `credential:status` | Show secure credential backend status. |
| `credential:set` | Store a provider API key in secure OS credential storage. |
| `credential:delete` | Delete a stored provider API key from secure storage. |
| `auth:login` | Run Gemini OAuth login and store the resulting credentials securely. |
| `auth:logout` | Delete stored Gemini OAuth credentials. |
| `server:run` | Run the local HTTP server for collectors and the browser viewer. |
| `demo` | Reset data, seed mock events, run analysis, and print a report. |
| `reset` | Delete all locally stored events and analysis artifacts. |

## Project Structure

- `src/cli.ts`: CLI entry point and command definitions
- `src/agent/`: resident runtime, control plane, collector supervision, scheduler, and autostart helpers
- `src/viewer/`: live viewer data assembly for the local browser dashboard
- `src/server/`: local HTTP server, ingest routes, and browser viewer assets
- `src/storage/database.ts`: SQLite persistence layer
- `src/storage/schema.ts`: database schema
- `src/privacy/sanitize.ts`: sensitive metadata filtering
- `src/importers/events.ts`: JSON and NDJSON event import
- `src/collectors/mock.ts`: deterministic mock event generator
- `src/collectors/index.ts`: shared collector registry
- `src/collectors/macos.ts`: macOS collector metadata and script lookup
- `src/collectors/windows.ts`: Windows collector metadata and script lookup
- `collectors/macos/active-window-collector.swift`: macOS active-window collector script
- `collectors/windows/active-window-collector.ps1`: Windows active-window collector script
- `src/pipeline/normalize.ts`: raw event normalization
- `src/pipeline/actions.ts`: semantic action abstraction rules
- `src/pipeline/sessionize.ts`: session boundary logic
- `src/pipeline/cluster.ts`: workflow clustering heuristics
- `src/pipeline/analyze.ts`: end-to-end workflow analysis orchestration
- `src/reporting/report.ts`: workflow-centric report formatting
- `src/reporting/service.ts`: report generation and snapshot helpers
- `src/llm/payloads.ts`: summarized LLM-safe workflow payload builder
- `src/llm/openai.ts`: OpenAI Responses API adapter for workflow analysis
- `src/llm/gemini.ts`: Gemini generateContent adapter for workflow analysis
- `src/llm/claude.ts`: Anthropic Messages adapter for workflow analysis
- `src/llm/config.ts`: persisted provider/model/auth configuration helpers
- `src/auth/google-oauth.ts`: Gemini OAuth login and token refresh flow
- `src/credentials/store.ts`: secure credential storage abstraction and macOS Keychain integration
- `src/credentials/llm.ts`: provider API key and OAuth credential helpers
- `src/server/ingest-server.ts`: local HTTP ingest server
- `src/server/ingest.ts`: incoming collector payload coercion
- `src/server/security.ts`: ingest auth token, localhost-only enforcement, and rate limiting
- `src/debug/trace.ts`: raw/session/workflow trace builders for the debug CLI
- `extension/chrome`: Chrome extension scaffold for live browser collection

## Known Limitations

- browser ingestion requires a shared local auth token and still depends on local extension setup
- browser collection is for local development and proof-of-concept validation
- the Windows and macOS native collectors currently capture only active-window changes
- macOS window title capture depends on Accessibility permission
- short-horizon emerging workflow summaries are heuristic and marked as provisional
- automatic snapshot refresh requires the resident agent or legacy scheduler process to be running
- workflow naming remains heuristic
- report output is CLI-only
- secure credential storage is implemented only for macOS Keychain today
- OpenAI and Claude direct API usage currently use API keys; Gemini supports API keys or OAuth2 login
