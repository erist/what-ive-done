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

Run the resident agent:

```bash
npm run dev -- agent:run --data-dir ./tmp/live-data
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

- `doctor`: print runtime and default data paths
- `agent:run`: start the resident local agent
- `agent:status`: show agent runtime state
- `agent:stop`: stop the resident local agent
- `agent:health`: show a health summary with latest snapshots
- `agent:run-once`: generate one manual snapshot cycle without starting the long-running agent
- `agent:snapshot:latest`: show the latest stored day/week snapshots
- `agent:collectors`: show collector states managed by the agent
- `agent:autostart:*`: inspect or manage macOS LaunchAgent autostart
- `init`: initialize the SQLite database
- `collect:mock`: insert mock raw events
- `analyze`: run normalization, sessionization, and workflow clustering
- `report`: print all-time, daily, or weekly workflow reports
- `demo`: reset, seed mock data, analyze, and print a report
- `reset`: delete locally stored data

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

List stored snapshots:

```bash
npm run dev -- report:snapshot:list --data-dir ./tmp/demo-data --json
```

Legacy/manual scheduler flow:

```bash
npm run dev -- report:scheduler --data-dir ./tmp/demo-data --once --json
```
