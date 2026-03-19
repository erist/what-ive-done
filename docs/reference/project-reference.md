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
- Chrome browser context collection with route taxonomy, document-type hash, tab-order metadata, and signal-only dwell segments
- versioned domain-pack registry with stable route families and coverage diagnostics
- versioned action-pack registry with coverage reporting and offline suggestion prompts
- golden workflow fixtures and debug trace commands
- Windows PowerShell active-window collector path
- macOS Swift active-window collector path with permission checks and one-shot capture
- optional `gws` Calendar boundary collector with install/auth diagnostics
- optional `gws` Drive and Sheets context collectors with install/auth diagnostics
- optional Git context collector with repo hash and commit-time diagnostics
- resident local agent runtime with persisted heartbeat and health state
- agent-managed ingest server lifecycle
- collector supervision for macOS, Windows, and optional `gws` command paths
- agent-managed snapshot scheduler
- normalization, semantic action abstraction, sessionization, workflow clustering, and all-time/daily/weekly reporting
- persisted analysis thresholds for workflow confirmation window and minimum session duration
- hybrid clustering benchmark command with legacy-vs-v2 error comparison
- persisted daily and weekly report snapshots
- live browser dashboard for agent health, workflow reports, snapshots, session drill-down, and minimal feedback write actions
- workflow rename, label, merge, split, exclude, include, hide, and unhide feedback
- session listing, session detail, and session deletion with reanalysis
- practical automation hints in workflow reports
- LLM-safe workflow payload export
- OpenAI, Gemini, and Claude adapters for summarized workflow analysis
- saved default LLM provider/model/auth configuration
- macOS Keychain-backed and Windows DPAPI-backed storage for provider API keys and Gemini OAuth credentials
- macOS LaunchAgent and Windows startup-script autostart helpers and CLI commands
- day-over-day and week-over-week comparison reports in the CLI and browser viewer
- collector restart backoff diagnostics
- GitHub Actions CI for typecheck, test, domain-pack fixture regression, and cluster benchmark gates

Not implemented yet:

- Windows click, file operation, and clipboard collectors
- packaged desktop app or tray UI
- secure credential storage on Linux

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
3. Raw events are normalized into stable context fields such as app alias, path pattern, route family, page type, resource hint, and title pattern.
4. Normalized events are mapped into semantic action labels with action-pack, page-type, generic, or `unknown_action` match metadata.
5. Events are grouped into sessions with rolling-context suppression and explainable boundary reasons.
6. Similar sessions are clustered into workflows with representative sequences, action-set/domain/time-aware similarity, explainable confidence details, and automation hints.
7. Reports, snapshots, and safe LLM summary payloads are generated from those workflow clusters.

Normalized browser events now persist a versioned domain-pack match surface:

- `route_family`
- `domain_pack_id`
- `domain_pack_version`

Normalized events also persist action-match metadata under `metadata.actionMatch`:

- `layer`
- `packId`
- `packVersion`
- `ruleId`
- `strategy` or `reason`

Current heuristic defaults in code:

- session inactivity split: 150 seconds
- context-shift split: 75 seconds with significant context change
- rolling context window: 300 seconds
- rolling-context suppression minimum gap: 45 seconds
- clustering similarity threshold: 0.74
- clustering weights: sequence 0.35, action set 0.25, context 0.25, time of day 0.15
- minimum workflow session duration: 45 seconds, configurable via `analysis.minSessionDurationSeconds`
- minimum workflow frequency: 3 similar sessions within 7 days
- workflow confirmation window: 7 days, configurable via `analysis.confirmationWindowDays`
- short-form workflow lane: repeated sessions below the standard duration threshold, capped at 20 seconds and 3 representative actions
- persisted workflow clusters now carry `detectionMode: "standard" | "short_form"`

## Debugging and Quality Gates

Quality debugging now has two fixed surfaces:

- `fixtures/golden/` contains representative workflow fixtures used as regression gates.
- `fixtures/domain-packs/` contains route-family fixture sets used to verify domain-pack coverage.
- golden fixtures now cover Google Sheets and BigQuery semantic action sequences in addition to the existing admin and desktop cases.
- debug CLI commands expose `raw -> normalized -> action -> session -> workflow cluster` transitions.

Debug flow:

```bash
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- domain-pack:test ./fixtures/domain-packs/google-sheets.ndjson
npm run dev -- domain-pack:report --data-dir ./tmp/local-data --limit 10
npm run dev -- action:coverage --data-dir ./tmp/local-data --limit 10
npm run dev -- action:suggest --data-dir ./tmp/local-data --limit 10
npm run dev -- debug:raw:list --data-dir ./tmp/local-data --limit 10
npm run dev -- debug:normalized:list --data-dir ./tmp/local-data --limit 10
npm run dev -- debug:trace:raw <raw-event-id> --data-dir ./tmp/local-data
npm run dev -- debug:trace:session <session-id> --data-dir ./tmp/local-data
npm run dev -- debug:trace:workflow <workflow-id> --data-dir ./tmp/local-data
```

## Domain Pack Substrate

Domain packs provide a versioned browser rule layer above the privacy-safe Chrome context contract.

- registry entry contract
  - `id`
  - `version`
  - `domainTokens`
  - deterministic `match(...)`
- current packs
  - `makestar-admin`
  - `google-sheets`
  - `google-docs`
  - `bigquery-console`
- current outputs
  - stable `routeFamily`
  - optional `pageType` override
  - optional `resourceHint` override
  - match metadata under `metadata.domainPack`

Useful commands:

```bash
npm run dev -- domain-pack:test ./fixtures/domain-packs/google-sheets.ndjson
npm run dev -- domain-pack:report --data-dir ./tmp/local-data --limit 10
```

## Action Pack Substrate

Action packs provide the deterministic semantic-action layer that sits on top of domain packs.

- action matching order
  - `domain_pack`
  - `page_type`
  - `generic`
  - `unknown_action`
- current packs
  - `makestar-admin`
  - `google-sheets`
  - `bigquery`
  - `general-web`
  - `desktop-productivity`
- current operational outputs
  - `action:coverage` for layer, pack, and top-workflow unknown rates
  - `action:suggest` for offline review prompts built from the unknown-action queue

Useful commands:

```bash
npm run dev -- action:coverage --data-dir ./tmp/local-data --limit 10
npm run dev -- action:suggest --data-dir ./tmp/local-data --limit 10
```

## Hybrid Clustering v2

Workflow clustering now uses a weighted hybrid score instead of a sequence-only score.

- sequence similarity still anchors the score
- action-set similarity helps keep reordered but semantically equivalent work together
- domain-context similarity prevents same-looking browser flows from unrelated domains from collapsing together
- time-of-day similarity acts as a weak tie-breaker for recurring routines
- `confidenceDetails` explains how the final confidence score was composed

Useful command:

```bash
npm run dev -- cluster:benchmark --json
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
npm run dev -- doctor --data-dir ./tmp/live-data --gws-calendar-id primary
npm run dev -- server:run --data-dir ./tmp/live-data --verbose
```

## Chrome Context Contract

Browser schema v2 remains the top-level compatibility layer:

- `browser_schema_version`
- `canonical_url`
- `route_template`
- `route_key`
- `resource_hash`

Chrome collector expansion adds a privacy-reviewed `metadata.browserContext` envelope:

- `routeTaxonomy`
  - normalized route source, template, signature, section hints, and dynamic segment count
- `documentTypeHash`
  - opaque SHA-256-derived hash of coarse document structure only
- `tabOrder`
  - activation counters, tab index, and previous tab reference
- `dwell`
  - dwell duration and segment timestamps

Special handling:

- `chrome.dwell` events are stored as raw signal-only events with `metadata.browserContext.signalOnly = true`
- signal-only dwell events are skipped by normalized workflow analysis so they do not become workflow steps
- hash-based SPA routes are reduced to normalized route taxonomy and are not stored as raw fragment text

Privacy note:

- [Chrome Context Privacy Review](./chrome-context-privacy-review.md)

## Calendar Boundary Signals

The optional Calendar collector uses the local `gws` CLI as a thin adapter.

- `doctor` now reports whether `gws` is installed, authenticated, and has Calendar scope.
- `collector:gws:calendar:info` prints diagnostics, runner paths, and example commands.
- `agent:run --gws-calendar` enables a cross-platform collector process that polls the selected calendar.
- meeting start/end events are stored as signal-only metadata and do not become workflow steps.
- the next real workflow event after a meeting signal can start a new session with `sessionBoundaryReason = calendar_signal`.

Stored `metadata.calendarSignal` fields are privacy-safe only:

- `signalType`
- `eventIdHash`
- `summaryHash`
- `startAt`
- `endAt`
- `attendeesCount`
- `signalOnly`

Useful commands:

```bash
npm run dev -- doctor --data-dir ./tmp/live-data --gws-calendar-id primary
npm run dev -- collector:gws:calendar:info --calendar-id primary --json
npm run dev -- agent:run --data-dir ./tmp/live-data --gws-calendar --gws-calendar-id primary
```

## Report Scope

Current report behavior:

- `report` prints all-time, daily, or weekly workflow reports directly from local data
- report output includes summary sections, workflow graphs, confidence, and automation hints
- `/` opens a local browser viewer with live report recomputation, latest snapshots, session detail drill-down, a feedback queue, and structured automation hints
- `GET /api/viewer/workflows/:workflowId` returns the current workflow review payload for the selected report window
- `POST /api/viewer/workflows/:workflowId` saves viewer-side name/purpose/review/exclude/hide feedback through the same shared workflow feedback logic used by the CLI
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
- normalized route taxonomy
- opaque document-type hash
- tab-order metadata
- dwell duration and timestamps
- hashed calendar meeting boundary metadata
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
- optional `gws` CLI with Calendar OAuth scope for meeting boundary signals
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

Enable optional Calendar boundaries:

```bash
npm run dev -- doctor --data-dir ./tmp/live-data --gws-calendar-id primary
npm run dev -- agent:run --data-dir ./tmp/live-data --gws-calendar --gws-calendar-id primary
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
npm run dev -- cluster:benchmark --json
```

Run the standalone local HTTP server for collectors and the browser viewer:

```bash
npm run dev -- server:run --data-dir ./tmp/live-data --open --verbose
```

Inspect optional workspace and Git collectors:

```bash
npm run dev -- doctor --git-repo .
npm run dev -- collector:gws:drive:info --json
npm run dev -- collector:gws:sheets:info --json
npm run dev -- collector:git:info --repo-path . --json
npm run dev -- agent:run --data-dir ./tmp/live-data --gws-drive --gws-sheets --git-repo .
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

Viewer feedback API:

```bash
curl "http://127.0.0.1:4318/api/viewer/workflows/<workflow-id>?window=week"
curl -X POST "http://127.0.0.1:4318/api/viewer/workflows/<workflow-id>?window=week" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Review shipping status","purpose":"Confirm order updates","automationCandidate":true,"difficulty":"medium","excluded":false,"hidden":false}'
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

`llm:providers` lists `openai`, `openai-codex`, `gemini`, and `claude`.
In the current M18 runtime milestone, `openai-codex` supports stored OAuth login and
summarized workflow analysis through the OpenAI Responses API.
The runtime refreshes stored OAuth credentials when needed and retries once on unauthorized responses.

Apply LLM-generated names:

```bash
npm run dev -- llm:analyze --data-dir ./tmp/local-data --apply-names --json
```

Run analysis through OpenAI Codex OAuth:

```bash
export OPENAI_CODEX_CLIENT_ID="your-openai-client-id"
npm run dev -- auth:login openai-codex --data-dir ./tmp/local-data
npm run dev -- llm:config:set --data-dir ./tmp/local-data --provider openai-codex --auth oauth2 --model gpt-5.4
npm run dev -- llm:analyze --data-dir ./tmp/local-data --json
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

`credential:set` only applies to providers that support API-key auth.
`openai-codex` is reserved for OAuth-based login and does not accept `credential:set`.

Provider OAuth login:

```bash
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_CLOUD_PROJECT="your-project-id"
npm run dev -- auth:login gemini --data-dir ./tmp/local-data
npm run dev -- auth:logout gemini --data-dir ./tmp/local-data

export OPENAI_CODEX_CLIENT_ID="your-openai-client-id"
# Optional when you need a non-default issuer:
# export OPENAI_CODEX_ISSUER="https://auth.openai.com"
npm run dev -- auth:login openai-codex --data-dir ./tmp/local-data
npm run dev -- auth:logout openai-codex --data-dir ./tmp/local-data
```

`auth:login openai-codex` requires `--client-id` or `OPENAI_CODEX_CLIENT_ID`.
The command stores OAuth credentials securely, surfaces readiness in `credential:status`
and `tools list`, and powers `llm:analyze` for the `openai-codex` provider.

## CLI Command Reference

| Command | Description |
| --- | --- |
| `doctor` | Print runtime information, storage paths, ingest security status, optional `gws` diagnostics, and optional Git collector diagnostics. |
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
| `agent:autostart:status` | Show macOS or Windows autostart status. |
| `agent:autostart:install` | Install the macOS LaunchAgent or Windows startup-script helper. |
| `agent:autostart:uninstall` | Remove the macOS LaunchAgent or Windows startup-script helper. |
| `viewer:open` | Open the local browser viewer in the default browser. |
| `debug:raw:list` | List recent raw events for trace selection. |
| `debug:normalized:list` | List recent normalized events and semantic actions. |
| `debug:trace:raw` | Trace one raw event through the interpretation pipeline. |
| `debug:trace:session` | Trace one session back to raw events and its cluster. |
| `debug:trace:workflow` | Trace one workflow cluster to member sessions and boundaries. |
| `cluster:benchmark` | Compare legacy sequence-only clustering against hybrid clustering v2. |
| `collector:list` | List available collectors and scripts. |
| `collector:gws:calendar:info` | Show `gws` Calendar collector diagnostics, usage, and file paths. |
| `collector:gws:drive:info` | Show `gws` Drive collector diagnostics, usage, and file paths. |
| `collector:gws:sheets:info` | Show `gws` Sheets collector diagnostics, usage, and file paths. |
| `collector:git:info` | Show Git context collector diagnostics, usage, and file paths. |
| `collector:macos:check` | Check macOS collector permission status. |
| `collector:macos:info` | Show macOS collector usage, permissions, and file paths. |
| `collector:windows:info` | Show Windows collector usage and file paths. |
| `report` | Print all-time, daily, or weekly workflow reports. |
| `report:compare` | Compare a day or week report against the previous matching window. |
| `report:generate` | Generate and store a report snapshot. |
| `report:snapshot:list` | List stored report snapshots. |
| `report:snapshot:show` | Show one stored report snapshot. |
| `workflow:list` | List workflow clusters with feedback state, including `detectionMode` in JSON output. |
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
| `llm:providers` | List supported OpenAI, OpenAI Codex, Gemini, and Claude providers with auth methods. |
| `llm:config:show` | Show the saved default LLM provider/model/auth configuration. |
| `llm:config:set` | Update the saved default LLM provider/model/auth configuration. |
| `llm:analyze` | Run summarized workflow analysis through the configured provider or CLI override. |
| `llm:results` | List stored LLM analysis results. |
| `credential:status` | Show secure credential backend status for macOS Keychain or Windows DPAPI. |
| `credential:set` | Store an API-key provider credential in secure OS credential storage. |
| `credential:delete` | Delete a stored provider API key from secure storage. |
| `auth:login` | Run Gemini or OpenAI Codex OAuth login and store the resulting credentials securely. |
| `auth:logout` | Delete stored Gemini or OpenAI Codex OAuth credentials. |
| `server:run` | Run the local HTTP server for collectors and the browser viewer. |
| `demo` | Reset data, seed mock events, run analysis, and print a report. |
| `reset` | Delete all locally stored events and analysis artifacts. |

## Project Structure

- `src/cli.ts`: CLI entry point and command definitions
- `src/agent/`: resident runtime, control plane, collector supervision, scheduler, and autostart helpers
- `src/viewer/`: live viewer data assembly for the local browser dashboard
- `src/server/`: local HTTP server, ingest routes, and browser viewer assets
- `src/privacy/browser.ts`: browser URL canonicalization and privacy-safe browser schema derivation
- `src/storage/database.ts`: SQLite persistence layer
- `src/storage/schema.ts`: database schema
- `src/privacy/sanitize.ts`: sensitive metadata filtering
- `src/importers/events.ts`: JSON and NDJSON event import
- `src/collectors/mock.ts`: deterministic mock event generator
- `src/collectors/index.ts`: shared collector registry
- `src/collectors/gws-calendar.ts`: `gws` Calendar diagnostics and meeting signal helpers
- `src/collectors/gws-calendar-runner.ts`: optional Calendar collector runner
- `src/collectors/macos.ts`: macOS collector metadata and script lookup
- `src/collectors/windows.ts`: Windows collector metadata and script lookup
- `src/agent/autostart/windows.ts`: Windows startup-script autostart helper
- `src/calendar/signals.ts`: privacy-safe Calendar signal metadata helpers
- `collectors/macos/active-window-collector.swift`: macOS active-window collector script
- `collectors/windows/active-window-collector.ps1`: Windows active-window collector script
- `src/pipeline/normalize.ts`: raw event normalization
- `src/pipeline/actions.ts`: semantic action abstraction rules
- `src/pipeline/sessionize.ts`: session boundary logic
- `src/pipeline/cluster.ts`: hybrid workflow clustering heuristics and confidence details
- `src/pipeline/cluster-benchmark.ts`: legacy-vs-v2 clustering benchmark dataset and scoring
- `src/pipeline/analyze.ts`: end-to-end workflow analysis orchestration
- `src/reporting/report.ts`: workflow-centric report formatting
- `src/reporting/service.ts`: report generation and snapshot helpers
- `src/llm/payloads.ts`: summarized LLM-safe workflow payload builder
- `src/llm/catalog.ts`: provider catalog, auth capabilities, default models, and provider normalization
- `src/llm/openai.ts`: OpenAI Responses API adapter for workflow analysis
- `src/llm/gemini.ts`: Gemini generateContent adapter for workflow analysis
- `src/llm/claude.ts`: Anthropic Messages adapter for workflow analysis
- `src/llm/config.ts`: persisted provider/model/auth configuration helpers
- `src/auth/google-oauth.ts`: Gemini OAuth login and token refresh flow
- `src/credentials/store.ts`: secure credential storage abstraction with macOS Keychain and Windows DPAPI backends
- `src/credentials/llm.ts`: provider API key and OAuth credential helpers
- `src/server/ingest-server.ts`: local HTTP ingest server
- `src/server/ingest.ts`: incoming collector payload coercion
- `src/server/security.ts`: ingest auth token, localhost-only enforcement, and rate limiting
- `src/debug/trace.ts`: raw/session/workflow trace builders for the debug CLI
- `extension/chrome`: Chrome extension scaffold for live browser collection
- `extension/chrome/context.js`: shared Chrome collector helpers for route taxonomy and document-type hashes

## Known Limitations

- browser ingestion requires a shared local auth token and still depends on local extension setup
- browser collection is for local development and proof-of-concept validation
- the Windows and macOS native collectors currently capture only active-window changes
- macOS window title capture depends on Accessibility permission
- short-horizon emerging workflow summaries are heuristic and marked as provisional
- automatic snapshot refresh requires the resident agent or legacy scheduler process to be running
- workflow naming remains heuristic
- browser feedback currently covers label/review and exclude/hide flows only; merge/split and unknown-action review remain CLI-first
- Drive/Sheets context is metadata-only and depends on the locally configured `gws` OAuth scopes
- Git context currently watches one repository path at a time
- secure credential storage is implemented on macOS and Windows only today
- OpenAI and Claude direct API usage currently use API keys; Gemini supports API keys or OAuth2 login
