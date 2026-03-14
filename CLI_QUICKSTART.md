# CLI Quickstart

## Install

```bash
npm install
```

## Basic checks

```bash
npm run typecheck
npm test
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

## Step-by-step flow

```bash
npm run dev -- init --data-dir ./tmp/demo-data
npm run dev -- collect:mock --data-dir ./tmp/demo-data
npm run dev -- analyze --data-dir ./tmp/demo-data
npm run dev -- report --data-dir ./tmp/demo-data
```

## Available commands

- `doctor`: print runtime and default data paths
- `init`: initialize the SQLite database
- `collect:mock`: insert mock raw events
- `analyze`: run normalization, sessionization, and workflow clustering
- `report`: print saved workflow report
- `demo`: reset, seed mock data, analyze, and print a report
- `reset`: delete locally stored data
