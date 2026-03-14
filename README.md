# What I’ve done

## Overview

**What I’ve done** is a local workflow pattern analyzer for internal employees.

The application observes a user’s activity on their Windows PC and Chrome browser,
groups actions into sessions, detects repetitive workflows, and produces reports that
identify automation candidates.

This tool does **NOT** execute automation.  
Its purpose is **analysis and discovery of repetitive tasks**.

The system runs primarily **locally**, stores collected activity data in a local SQLite database,
and sends only **summarized session data** to an LLM provider for interpretation.

## Current Implementation Status

The repository currently provides a CLI-first MVP core that you can test immediately.

Implemented now:

- TypeScript CLI
- local SQLite storage
- sensitive metadata sanitization
- raw event intake
- event normalization
- sessionization
- workflow clustering
- CLI report output
- mock workflow generator
- local HTTP ingest server
- Chrome extension scaffold for browser event collection

Not implemented yet:

- Windows native collector
- desktop UI
- workflow feedback UI
- LLM integration
- secure credential storage

## Core Goal

Identify repetitive workflows performed by employees over a **1–2 week observation period** and produce insights such as:

- Repetitive task Top N
- Frequency of each workflow
- Time spent per workflow
- Automation suitability
- Recommended automation approach

## Privacy Principles

This project prioritizes **privacy and minimal data collection**.

Collected:

- active application name
- window title
- URL and domain
- event metadata such as click, navigation, and file event hints
- timestamps
- session structure

Never collected:

- raw keystrokes
- passwords
- email body content
- document content
- clipboard text content
- authentication tokens
- continuous screen recordings

Only **behavior metadata** is stored.

## Requirements

To run the current CLI locally:

- Node.js `22.x` or later
- npm `10.x` or later
- Chrome, if you want to test real browser collection

Notes:

- SQLite is currently backed by Node.js `node:sqlite`.
- On Node 22 this prints an experimental warning during execution.
- The CLI still works normally in this setup.

## Install

```bash
npm install
```

Optional: build the compiled CLI.

```bash
npm run build
```

Optional: expose the CLI globally on your machine.

```bash
npm link
what-ive-done doctor
```

If you do not want a global install, use the local runner:

```bash
npm run dev -- doctor
```

## Quickest Test: One Command Demo

This is the fastest way to verify the current MVP.

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

What this does:

1. resets local analysis data in `./tmp/demo-data`
2. inserts deterministic mock workflow events
3. runs normalization, sessionization, and workflow clustering
4. prints a workflow report

JSON output version:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data --json
```

Expected high-level result:

- `60` raw events
- `15` sessions
- `5` workflow clusters

## Recommended Basic Verification

Run these first:

```bash
npm run typecheck
npm test
npm run build
```

## CLI Usage

### 1. Environment Check

```bash
npm run dev -- doctor
```

This prints:

- Node version
- OS platform
- architecture
- default local data directory
- default SQLite database path

### 2. Initialize Local Storage

```bash
npm run dev -- init --data-dir ./tmp/local-data
```

This creates the application data directory and SQLite database.

### 3. Seed Mock Events

```bash
npm run dev -- collect:mock --data-dir ./tmp/local-data
```

This inserts deterministic sample workflows for testing analysis without any live collectors.

### 4. Run Analysis

```bash
npm run dev -- analyze --data-dir ./tmp/local-data
```

This performs:

- raw event normalization
- session creation
- workflow clustering

### 5. Print Report

Table output:

```bash
npm run dev -- report --data-dir ./tmp/local-data
```

JSON output:

```bash
npm run dev -- report --data-dir ./tmp/local-data --json
```

### 6. Reset Local Data

```bash
npm run dev -- reset --data-dir ./tmp/local-data
```

This deletes stored raw events and generated analysis artifacts from the selected data directory.

## Live Browser Test With Chrome Extension

If you want to test with real browsing activity instead of mock data, use the local ingest server
and the unpacked Chrome extension in [`extension/chrome`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/extension/chrome).

### Step 1. Start the Local Ingest Server

Open a terminal and run:

```bash
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
```

The server exposes:

- health check: `http://127.0.0.1:4318/health`
- event ingest: `http://127.0.0.1:4318/events`

Keep this terminal open while testing the extension.

### Step 2. Load the Chrome Extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select [`extension/chrome`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/extension/chrome)

### Step 3. Verify Extension Endpoint

1. Open the extension details page
2. Open `Extension options`
3. Confirm the ingest endpoint is:

```text
http://127.0.0.1:4318/events
```

If you started the server on a different port, update it here.

### Step 4. Generate Browser Activity

Visit a few websites and perform actions such as:

- opening pages in multiple tabs
- clicking buttons and links
- submitting a test form on a sample site

The current extension captures:

- tab navigation
- tab activation
- click metadata
- form submit metadata

The extension does **not** capture field values or typed input.

### Step 5. Analyze Collected Browser Events

In another terminal:

```bash
npm run dev -- analyze --data-dir ./tmp/live-data
```

Then inspect the report:

```bash
npm run dev -- report --data-dir ./tmp/live-data
```

Or JSON:

```bash
npm run dev -- report --data-dir ./tmp/live-data --json
```

### Step 6. Reset and Repeat

```bash
npm run dev -- reset --data-dir ./tmp/live-data
```

## Current CLI Commands

- `doctor`: print runtime information and default paths
- `init`: initialize SQLite storage
- `collect:mock`: seed deterministic sample workflow events
- `analyze`: normalize events, build sessions, and detect workflows
- `report`: print saved workflow clusters as table or JSON
- `serve`: run the local HTTP ingest server for live collectors
- `demo`: reset, seed mock data, analyze, and print a report
- `reset`: remove locally stored events and analysis artifacts

## Chrome Extension Files

Chrome extension source lives in:

- [`manifest.json`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/extension/chrome/manifest.json)
- [`background.js`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/extension/chrome/background.js)
- [`content.js`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/extension/chrome/content.js)
- [`options.html`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/extension/chrome/options.html)
- [`options.js`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/extension/chrome/options.js)

## Project Structure

Current key files:

- [`src/cli.ts`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/src/cli.ts): CLI entry point
- [`src/storage/database.ts`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/src/storage/database.ts): SQLite access layer
- [`src/privacy/sanitize.ts`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/src/privacy/sanitize.ts): sensitive metadata filtering
- [`src/pipeline/normalize.ts`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/src/pipeline/normalize.ts): raw to normalized events
- [`src/pipeline/sessionize.ts`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/src/pipeline/sessionize.ts): session grouping
- [`src/pipeline/cluster.ts`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/src/pipeline/cluster.ts): workflow detection
- [`src/server/ingest-server.ts`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/src/server/ingest-server.ts): local collector ingest server
- [`src/collectors/mock.ts`](/Users/yhchun/Workspace/Projects/ax/what-ive-done/src/collectors/mock.ts): deterministic test data

## Known Limitations

- Chrome extension events are currently sent to a local HTTP endpoint without authentication.
- Browser collection is for local development and PoC validation only.
- Native Windows activity collection has not been added yet.
- Workflow naming is currently heuristic only.
- Report output is CLI-based, not a desktop UI.
- LLM interpretation is not connected yet.

## Next Planned Steps

- add Windows collector interface and first native collector implementation
- persist workflow feedback such as rename and exclude
- add LLM summary payload generation and provider adapter
- add a desktop-facing report UI
