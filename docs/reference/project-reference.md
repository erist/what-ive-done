# Project Reference

Internal reference for the current repository state.

## Purpose

**What I've Done** is a local-first workflow pattern analyzer. It captures desktop and browser activity metadata, stores that data locally in SQLite, normalizes events into semantic actions, groups them into sessions, clusters similar sessions into workflows, and produces reports that highlight automation candidates.

The project is for workflow analysis and discovery. It does not execute automation.

## Current Implementation Status

Implemented today:

- TypeScript CLI
- local SQLite storage using `node:sqlite`
- sensitive metadata sanitization before persistence
- deterministic mock workflow generator
- JSON and NDJSON raw-event import
- local HTTP ingest server for collectors
- Chrome extension scaffold for browser activity metadata
- Windows PowerShell active-window collector path
- macOS Swift active-window collector path with permission checks and one-shot capture
- normalization, sessionization, workflow clustering, and all-time/daily/weekly CLI reporting
- persisted daily and weekly report snapshots
- local scheduler command for automatic snapshot refresh
- workflow rename, exclude, include, hide, and unhide feedback
- session listing, session detail, and session deletion with reanalysis
- LLM-safe workflow payload export
- OpenAI, Gemini, and Claude adapters for summarized workflow analysis
- saved default LLM provider/model/auth configuration
- macOS Keychain-backed storage for provider API keys and Gemini OAuth credentials

Not implemented yet:

- Windows click, file operation, and clipboard collectors
- desktop UI
- workflow feedback UI
- secure credential storage on non-macOS platforms
- report comparison views such as day-over-day or week-over-week diffs

## Report Scope

Current CLI report behavior:

- `report` prints the current all-time report for the analyzed local dataset by default
- `report --window day` prints a local calendar day report
- `report --window week` prints the latest 7-day report ending on the selected local report date
- `report --json` prints structured JSON, including emerging workflows for short-horizon reports
- `report:generate` stores a snapshot for a selected report window and date
- `report:scheduler` refreshes day/week snapshots in a long-running local process
- `report:snapshot:list` and `report:snapshot:show` read stored snapshots

## Analysis Pipeline

1. Raw events are collected from mock data, imported files, the local ingest server, or desktop collectors.
2. Sensitive fields are sanitized before they are written to SQLite.
3. Raw events are normalized into semantic actions such as `application_switch`, `page_navigation`, `button_click`, and `form_submit`.
4. Events are grouped into sessions.
5. Similar sessions are clustered into workflows.
6. Reports and safe LLM summary payloads are generated from those workflow clusters.

Current heuristic defaults in code:

- session inactivity split: 5 minutes
- context-shift split: 90 seconds with app/domain change
- minimum workflow session duration: 60 seconds
- minimum workflow frequency: 3 similar sessions within 7 days

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

Initialize local storage:

```bash
npm run dev -- init --data-dir ./tmp/local-data
```

Seed deterministic mock events:

```bash
npm run dev -- collect:mock --data-dir ./tmp/local-data
```

Run analysis:

```bash
npm run dev -- analyze --data-dir ./tmp/local-data
```

Print the all-time report:

```bash
npm run dev -- report --data-dir ./tmp/local-data
```

Print JSON output:

```bash
npm run dev -- report --data-dir ./tmp/local-data --json
```

Print daily or weekly reports:

```bash
npm run dev -- report --data-dir ./tmp/local-data --window day --json
npm run dev -- report --data-dir ./tmp/local-data --window week --json
```

Generate and inspect stored snapshots:

```bash
npm run dev -- report:generate --data-dir ./tmp/local-data --window day --json
npm run dev -- report:snapshot:list --data-dir ./tmp/local-data --json
npm run dev -- report:snapshot:show --data-dir ./tmp/local-data --window week --latest --json
```

Run the local scheduler:

```bash
npm run dev -- report:scheduler --data-dir ./tmp/local-data --once --json
npm run dev -- report:scheduler --data-dir ./tmp/local-data --interval-seconds 300
```

One-command demo:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

## Import And Live Ingestion

Import JSON or NDJSON events:

```bash
npm run dev -- import:events ./fixtures/windows-active-window-sample.ndjson --data-dir ./tmp/import-data
```

Start the local ingest server:

```bash
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
```

List available collectors:

```bash
npm run dev -- collector:list --json
```

## Collector Notes

Windows collector info:

```bash
npm run dev -- collector:windows:info --json
```

Typical Windows collector usage:

```powershell
pwsh -File ".\collectors\windows\active-window-collector.ps1" -OutputPath ".\events.ndjson"
pwsh -File ".\collectors\windows\active-window-collector.ps1" -IngestUrl "http://127.0.0.1:4318/events"
```

macOS collector info:

```bash
npm run dev -- collector:macos:info --json
npm run dev -- collector:macos:check --json
```

Typical macOS collector usage:

```bash
swift ./collectors/macos/active-window-collector.swift --once --stdout
swift ./collectors/macos/active-window-collector.swift --output-path ./tmp/macos-events.ndjson
swift ./collectors/macos/active-window-collector.swift --ingest-url http://127.0.0.1:4318/events
```

CLI one-shot capture on macOS:

```bash
npm run dev -- collect:macos:once --data-dir ./tmp/macos-cli-data --json
```

## Workflow Review And LLM Commands

List workflows:

```bash
npm run dev -- workflow:list --data-dir ./tmp/local-data --json
```

Show one workflow:

```bash
npm run dev -- workflow:show <workflow-id> --data-dir ./tmp/local-data --json
```

Rename, exclude, or hide a workflow:

```bash
npm run dev -- workflow:rename <workflow-id> "New workflow name" --data-dir ./tmp/local-data
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
| `doctor` | Print runtime information and default storage paths. |
| `init` | Initialize local SQLite storage. |
| `collect:mock` | Insert deterministic sample events for testing. |
| `collect:macos:once` | Capture the current macOS frontmost app once and store it. |
| `import:events` | Import raw events from a JSON or NDJSON file. |
| `analyze` | Normalize events, build sessions, and detect workflows. |
| `collector:list` | List available collectors and scripts. |
| `collector:macos:check` | Check macOS collector permission status. |
| `collector:macos:info` | Show macOS collector usage, permissions, and file paths. |
| `collector:windows:info` | Show Windows collector usage and file paths. |
| `report` | Print all-time, daily, or weekly workflow reports. |
| `report:generate` | Generate and store a report snapshot. |
| `report:snapshot:list` | List stored report snapshots. |
| `report:snapshot:show` | Show one stored report snapshot. |
| `report:scheduler` | Run the local report snapshot scheduler. |
| `workflow:list` | List workflow clusters with feedback state. |
| `workflow:show` | Show one workflow cluster in detail. |
| `workflow:rename` | Rename a workflow cluster. |
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
| `credential:set-openai` | Store the OpenAI API key in secure OS credential storage. |
| `credential:delete-openai` | Delete the stored OpenAI API key from secure storage. |
| `auth:login` | Run Gemini OAuth login and store the resulting credentials securely. |
| `auth:logout` | Delete stored Gemini OAuth credentials. |
| `serve` | Run the local HTTP ingest server for collectors. |
| `demo` | Reset data, seed mock events, run analysis, and print a report. |
| `reset` | Delete all locally stored events and analysis artifacts. |

## Project Structure

- `src/cli.ts`: CLI entry point and command definitions
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
- `src/pipeline/sessionize.ts`: session boundary logic
- `src/pipeline/cluster.ts`: workflow clustering heuristics
- `src/reporting/report.ts`: current all-time report formatting
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
- `extension/chrome`: Chrome extension scaffold for live browser collection

## Known Limitations

- browser ingestion currently uses a local HTTP endpoint without authentication
- browser collection is for local development and proof-of-concept validation
- the Windows and macOS native collectors currently capture only active-window changes
- macOS window title capture depends on Accessibility permission
- short-horizon emerging workflow summaries are heuristic and marked as provisional
- automatic report refresh requires the local scheduler process to be running
- workflow naming remains heuristic
- report output is CLI-only
- secure credential storage is implemented only for macOS Keychain today
- OpenAI and Claude direct API usage currently use API keys; Gemini supports API keys or OAuth2 login
