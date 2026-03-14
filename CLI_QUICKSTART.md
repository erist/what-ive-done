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
- `llm:providers`: list supported ChatGPT, Gemini, and Claude providers
- `llm:config:show`: show the saved default LLM configuration
- `llm:config:set`: update the saved default LLM configuration
- `credential:set`: store a provider API key in secure storage
- `auth:login`: run Gemini OAuth login
- `report`: print all-time, daily, or weekly workflow reports
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

Run one scheduler cycle for automatic daily/weekly snapshots:

```bash
npm run dev -- report:scheduler --data-dir ./tmp/demo-data --once --json
```

List stored snapshots:

```bash
npm run dev -- report:snapshot:list --data-dir ./tmp/demo-data --json
```
