# What I've Done

Local-first workflow pattern analyzer for discovering repetitive work before deciding what to automate.

This repository currently provides a TypeScript CLI that collects or imports activity metadata, stores it locally in SQLite, groups activity into sessions, clusters similar sessions into workflows, and prints an all-time workflow report. It is focused on workflow analysis and discovery, not automation execution.

## Current Scope

- local-only storage and analysis
- Windows and macOS active-window collection paths
- Chrome extension path for browser metadata ingestion
- all-time CLI report for analyzed local data
- workflow review, feedback, and session deletion
- LLM-safe workflow summary export and OpenAI-based workflow analysis

Current limitation:

- `report` is all-time only today
- daily and weekly report windows are planned but not implemented yet

## Quick Start

Install and verify:

```bash
npm install
npm run typecheck
npm test
```

Run a local demo:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

Step-by-step flow:

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- report --data-dir ./tmp/local-data
```

JSON output:

```bash
npm run dev -- report --data-dir ./tmp/local-data --json
```

## Common Commands

```bash
npm run dev -- doctor
npm run dev -- collector:list --json
npm run dev -- collector:macos:info --json
npm run dev -- collector:windows:info --json
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
```

## Privacy

The project stores behavioral metadata only. It must not collect raw keystrokes, passwords, email or document content, clipboard text, authentication tokens, cookies, continuous screenshots, or screen recordings.

## Docs

- [CLI Quickstart](./CLI_QUICKSTART.md)
- [Detailed Internal Reference](./docs/reference/project-reference.md)
- [Product Requirements](./docs/product/requirements.md)
- [Active Implementation Plan](./docs/plans/active/mvp-implementation.md)

## Requirements

- Node.js `22.x` or later
- npm `10.x` or later
- Chrome for live browser collection
- Windows PowerShell for the Windows active-window collector
- Xcode or Xcode Command Line Tools with Swift for the macOS active-window collector
- `OPENAI_API_KEY` for `llm:analyze` if no key is stored in secure storage
