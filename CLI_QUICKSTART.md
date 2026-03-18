# CLI Quickstart

## Install

```bash
npm install
```

## Basic checks

```bash
npm run typecheck
npm test
npm run build
```

## One-command local demo

This seeds deterministic mock workflows, runs analysis, and prints a report.

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

JSON output:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data --json
```

## Recommended agent-first flow

```bash
npm run dev -- init --data-dir ./tmp/demo-data
npm run dev -- collect:mock --data-dir ./tmp/demo-data
npm run dev -- agent:run-once --data-dir ./tmp/demo-data
npm run dev -- agent:snapshot:latest --data-dir ./tmp/demo-data
```

## Interactive init

```bash
npm run dev -- init --data-dir ./tmp/demo-data --interactive
```

`init` now creates `.wid/config.json`, initializes SQLite, and provisions an ingest token on the first run.

## Config foundation

Phase 1 adds `.wid/config.json` plus auto-discovery from the current working tree under an initialized data directory.

```bash
npm run dev -- init --data-dir ./tmp/demo-data
cd ./tmp/demo-data
npm run dev -- config show
npm run dev -- config get server.port
npm run dev -- config set server.port 4319
npm run dev -- config path
npm run dev -- agent:health
WID_DATA_DIR=./tmp/demo-data npm run dev -- agent:status
```

Run the resident agent:

```bash
npm run dev -- agent:run --data-dir ./tmp/live-data
```

Doctor diagnostics:

```bash
npm run dev -- doctor --data-dir ./tmp/live-data
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

Inspect and stop it:

```bash
npm run dev -- agent:status --data-dir ./tmp/live-data
npm run dev -- agent:health --data-dir ./tmp/live-data
npm run dev -- agent:collectors --data-dir ./tmp/live-data
npm run dev -- agent:stop --data-dir ./tmp/live-data
```

## Manual analysis flow

```bash
npm run dev -- init --data-dir ./tmp/demo-data
npm run dev -- collect:mock --data-dir ./tmp/demo-data
npm run dev -- analyze --data-dir ./tmp/demo-data
npm run dev -- report --data-dir ./tmp/demo-data
```

## Available commands

- `doctor`: print runtime and discovered data-dir diagnostics
- `agent:run`: start the resident local agent
- `agent:status`: show agent runtime state
- `agent:stop`: stop the resident local agent
- `agent:health`: show a health summary with latest snapshots
- `agent:run-once`: generate one manual snapshot cycle without starting the long-running agent
- `agent:snapshot:latest`: show the latest stored day/week snapshots
- `agent:collectors`: show collector states managed by the agent
- `agent:autostart:*`: inspect or manage macOS LaunchAgent autostart
- `viewer:open`: open the local browser viewer
- `config show|get|set|path`: inspect or update `.wid/config.json`
- `init`: initialize `.wid/config.json`, SQLite, and the ingest token
- `collect:mock`: insert mock raw events
- `analyze`: run normalization, sessionization, and workflow clustering
- `llm:providers`: list supported ChatGPT, Gemini, and Claude providers
- `llm:config:show`: show the saved default LLM configuration
- `llm:config:set`: update the saved default LLM configuration
- `credential:set`: store a provider API key in secure storage
- `auth:login`: run Gemini OAuth login
- `report`: print all-time, daily, or weekly workflow reports
- `server:run`: run the local HTTP server for collectors and the browser viewer
- `demo`: reset, seed mock data, analyze, and print a report
- `reset`: delete locally stored data

## LLM setup

Configure Gemini with an API key:

```bash
npm run dev -- llm:config:set --data-dir ./tmp/demo-data --provider gemini --auth api-key --model gemini-2.5-flash
export GEMINI_API_KEY="your-api-key"
npm run dev -- llm:analyze --data-dir ./tmp/demo-data --json
```

Configure Claude with a stored key:

```bash
npm run dev -- llm:config:set --data-dir ./tmp/demo-data --provider claude --auth api-key --model claude-sonnet-4-5
export ANTHROPIC_API_KEY="your-api-key"
npm run dev -- llm:analyze --data-dir ./tmp/demo-data --json
```

Gemini OAuth login:

```bash
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_CLOUD_PROJECT="your-project-id"
npm run dev -- auth:login gemini --data-dir ./tmp/demo-data
```

## Date-window reports

Daily report:

```bash
npm run dev -- report --data-dir ./tmp/demo-data --window day --json
```

Weekly report:

```bash
npm run dev -- report --data-dir ./tmp/demo-data --window week --json
```

Generate and store a daily snapshot:

```bash
npm run dev -- report:generate --data-dir ./tmp/demo-data --window day --json
```

Run one manual agent-backed snapshot refresh:

```bash
npm run dev -- agent:run-once --data-dir ./tmp/demo-data
```

Run the standalone local HTTP server and open the browser viewer:

```bash
npm run dev -- server:run --data-dir ./tmp/live-data --open
```

List stored snapshots:

```bash
npm run dev -- report:snapshot:list --data-dir ./tmp/demo-data --json
```
