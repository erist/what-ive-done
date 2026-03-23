# What I've Done

Language:

- [English](#english)
- [한국어](#ko)

<a id="english"></a>
## English

### Project Overview

What I've Done is a local-first workflow discovery tool for users who want to understand repetitive PC work before executing automation.

It collects desktop and browser activity metadata, stores everything locally in SQLite, and turns noisy events into workflow reports, reusable feedback, and practical automation hints.

The product is focused on workflow analysis and discovery for automation execution.

### Requirements

- Node.js `22.x` or later
- npm `10.x` or later
- Chrome for browser collection
- macOS or Windows for native desktop collection

### Practical Commands

One-time setup from this repository:

```bash
npm install
npm run build
npm link
```

Create one data directory with the guided `wid` flow:

```bash
wid setup ./data/live-data
```

From the repository root, you can still inspect setup and tool state:

```bash
wid tools --data-dir ./data/live-data
wid health --data-dir ./data/live-data
```

After `setup`, move into the data directory and use the short `wid` commands:

```bash
cd ./data/live-data
wid up --open-viewer
wid health
wid agent status
wid report
wid workflow list --refresh
wid report compare --window week
```

Default viewer URL: `http://127.0.0.1:4318/`

Inspect the ingest token or stop the agent:

```bash
wid token
wid stop
```

`wid status` and `wid health` both print the quick health summary. Use `wid agent status` when you need the detailed runtime snapshot.

`wid report` always uses live reanalysis from raw events. `wid workflow list` and `wid session list` read stored analysis, so use `--refresh` when new raw events have been collected or when the report looks newer than the stored views.

Tune confirmed-workflow thresholds:

```bash
wid config set analysis.confirmationWindowDays 14
wid config set analysis.minSessionDurationSeconds 15
wid workflow list --refresh --json
```

Repeated quick sessions that stay below the standard duration threshold can now be promoted as `short_form` workflow clusters. JSON workflow output includes a `detectionMode` field so standard and short-form clusters can be separated downstream.
LLM payload export and manual analysis exclude `short_form` workflows by default; opt in with `wid llm:payloads --include-short-form` or `wid llm:analyze --include-short-form`.

### Detailed Docs

- [CLI Quickstart](./CLI_QUICKSTART.md)
- [Detailed Internal Reference](./docs/reference/project-reference.md)
- [Product Requirements](./docs/product/requirements.md)
- [Active Implementation Plan](./docs/plans/active/mvp-implementation.md)

<a id="ko"></a>
## 한국어

### 프로젝트 개요

What I've Done은 자동화 실행 전에 반복적인 PC 업무를 파악하려는 사용자를 위한 로컬 우선 워크플로우 발견 도구입니다.

데스크톱 및 브라우저 활동 메타데이터를 수집해 로컬 SQLite에 저장하고, noisy event를 워크플로우 리포트, 재사용 가능한 피드백, 실용적인 automation hint로 해석합니다.

이 제품의 초점은 자동화 실행을 위한 워크플로우 분석과 발견입니다.

### 요구 사항

- Node.js `22.x` 이상
- npm `10.x` 이상
- 브라우저 수집용 Chrome
- native desktop 수집용 macOS 또는 Windows

### 실사용 커맨드

이 저장소에서 1회 설치:

```bash
npm install
npm run build
npm link
```

가이드형 `wid` 흐름으로 데이터 디렉터리 생성:

```bash
wid setup ./data/live-data
```

저장소 루트에서도 setup/tool 상태를 확인할 수 있습니다:

```bash
wid tools --data-dir ./data/live-data
wid health --data-dir ./data/live-data
```

`setup` 이후에는 데이터 디렉터리로 이동해서 짧은 `wid` 명령만 사용:

```bash
cd ./data/live-data
wid up --open-viewer
wid health
wid agent status
wid report
wid workflow list --refresh
wid report compare --window week
```

기본 viewer URL: `http://127.0.0.1:4318/`

ingest token 확인 또는 에이전트 종료:

```bash
wid token
wid stop
```

`wid status`와 `wid health`는 같은 quick health summary를 출력합니다. 자세한 runtime snapshot이 필요하면 `wid agent status`를 사용합니다.

`wid report`는 항상 raw event 기준 live reanalysis를 사용합니다. 반면 `wid workflow list`와 `wid session list`는 저장된 분석 결과를 읽으므로, 새 raw event가 들어오거나 report가 더 최신처럼 보일 때는 `--refresh`를 사용하세요.

confirmed workflow 기준 조정:

```bash
wid config set analysis.confirmationWindowDays 14
wid config set analysis.minSessionDurationSeconds 15
wid workflow list --refresh --json
```

표준 duration 기준보다 짧은 반복 세션도 이제 `short_form` workflow cluster로 승격될 수 있습니다. JSON 기반 workflow 출력에는 `detectionMode`가 포함되어 standard cluster와 short-form cluster를 구분할 수 있습니다.
LLM payload export와 수동 분석은 기본적으로 `short_form` workflow를 제외하며, 필요할 때만 `wid llm:payloads --include-short-form` 또는 `wid llm:analyze --include-short-form`으로 포함할 수 있습니다.

### 상세 문서 링크

- [CLI Quickstart](./CLI_QUICKSTART.md)
- [상세 내부 레퍼런스](./docs/reference/project-reference.md)
- [제품 요구사항](./docs/product/requirements.md)
- [현재 구현 계획](./docs/plans/active/mvp-implementation.md)
