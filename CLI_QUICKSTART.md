# CLI Quickstart

## Install

```bash
npm install
npm run build
npm link
```

Optional checks:

```bash
npm run typecheck
npm test
```

## One-command local demo

This seeds deterministic mock workflows, runs analysis, and prints a report.

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

## Canonical `wid` flow

Create one data directory with the guided setup flow:

```bash
wid setup ./tmp/live-data
```

From the repository root, you can still inspect that directory directly:

```bash
wid tools --data-dir ./tmp/live-data
wid health --data-dir ./tmp/live-data
```

After setup, move into the data directory and use the short `wid` commands:

```bash
cd ./tmp/live-data
wid up --open-viewer
wid health
wid agent status
wid token
```

Default viewer URL:

```text
http://127.0.0.1:4318/
```

`wid status` and `wid health` both print the quick health summary. Use `wid agent status` when you need the detailed runtime state.

## Sample data and analysis

Seed deterministic mock events and refresh stored analysis:

```bash
wid collect:mock
wid workflow list --refresh
wid report
wid report compare --window week
wid workflow list --refresh --json
```

Show one workflow after listing:

```bash
wid workflow show <workflow-id>
```

`wid report` always uses live raw events. `wid workflow list` and `wid session list` read stored analysis artifacts, so `--refresh` is the canonical way to bring those stored views up to date after new raw events arrive.

If you prefer an explicit standalone reanalysis step, `wid analyze` is still supported:

```bash
wid analyze
wid workflow list --json
```

## Dev entrypoint equivalents

Everything above also works through the development entrypoint:

```bash
npm run dev -- setup ./tmp/demo-data
npm run dev -- health --data-dir ./tmp/demo-data
npm run dev -- collect:mock --data-dir ./tmp/demo-data
npm run dev -- workflow list --refresh --data-dir ./tmp/demo-data
npm run dev -- report --data-dir ./tmp/demo-data
```

## Common commands

- `wid setup [path]`: guided first-run setup
- `wid up --open-viewer`: start the resident agent and open the local viewer
- `wid health`: quick runtime health summary
- `wid agent status`: detailed runtime state
- `wid token`: print or rotate the ingest auth token
- `wid workflow list --refresh`: refresh stored analysis and list workflows
- `wid session list --refresh`: refresh stored analysis and list sessions
- `wid report`: render a live report from raw events
- `wid tools`: inspect configured collectors and analyzers
- `wid tools add git`: add the Git context collector with interactive defaults
- `wid auth login gemini`: run provider OAuth login with interactive defaults when available

## Legacy compatibility

The old `:` form remains supported for scripts and backward compatibility:

```bash
wid workflow:list --refresh --json
wid report:compare --json
wid agent:health
wid agent:status
wid auth:login gemini
```
