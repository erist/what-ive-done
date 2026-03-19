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

Initialize a data directory:

```bash
wid init --data-dir ./data/live-data --interactive
```

After `init`, move into the data directory and use the short `wid` commands:

```bash
cd ./data/live-data
wid up --open
```

Default viewer URL: `http://127.0.0.1:4318/`

Show or rotate the Chrome extension ingest token:

```bash
wid token --rotate
```

Check runtime health and stop the agent:

```bash
wid status
wid stop
```

Tune confirmed-workflow thresholds:

```bash
wid config set analysis.confirmationWindowDays 14
wid config set analysis.minSessionDurationSeconds 15
wid analyze
wid workflow:list --json
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

데이터 디렉터리 초기화:

```bash
wid init --data-dir ./data/live-data --interactive
```

`init` 이후에는 데이터 디렉터리로 이동해서 짧은 `wid` 명령만 사용:

```bash
cd ./data/live-data
wid up --open
```

기본 viewer URL: `http://127.0.0.1:4318/`

Chrome extension용 ingest token 확인 또는 재발급:

```bash
wid token --rotate
```

런타임 상태 확인과 종료:

```bash
wid status
wid stop
```

confirmed workflow 기준 조정:

```bash
wid config set analysis.confirmationWindowDays 14
wid config set analysis.minSessionDurationSeconds 15
wid analyze
wid workflow:list --json
```

표준 duration 기준보다 짧은 반복 세션도 이제 `short_form` workflow cluster로 승격될 수 있습니다. JSON 기반 workflow 출력에는 `detectionMode`가 포함되어 standard cluster와 short-form cluster를 구분할 수 있습니다.
LLM payload export와 수동 분석은 기본적으로 `short_form` workflow를 제외하며, 필요할 때만 `wid llm:payloads --include-short-form` 또는 `wid llm:analyze --include-short-form`으로 포함할 수 있습니다.

### 상세 문서 링크

- [CLI Quickstart](./CLI_QUICKSTART.md)
- [상세 내부 레퍼런스](./docs/reference/project-reference.md)
- [제품 요구사항](./docs/product/requirements.md)
- [현재 구현 계획](./docs/plans/active/mvp-implementation.md)
