# What I've Done

Language:

- [English](#english)
- [한국어](#ko)

<a id="english"></a>
## English

Local-first workflow pattern analyzer for discovering repetitive work before deciding what to automate.

This repository currently provides a TypeScript CLI that collects or imports activity metadata, stores it locally in SQLite, groups activity into sessions, clusters similar sessions into workflows, and prints an all-time workflow report. It is focused on workflow analysis and discovery, not automation execution.

### Current Scope

- local-only storage and analysis
- Windows and macOS active-window collection paths
- Chrome extension path for browser metadata ingestion
- all-time, daily, and weekly CLI reports for analyzed local data
- stored daily and weekly report snapshots
- local scheduler command for automatic snapshot refresh
- workflow review, feedback, and session deletion
- LLM-safe workflow summary export and OpenAI-based workflow analysis

Current limitation:

- short-horizon report entries are currently heuristic and shown as provisional emerging workflows
- report comparison views are not implemented yet

### Quick Start

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
npm run dev -- report --data-dir ./tmp/local-data --window day --json
npm run dev -- report --data-dir ./tmp/local-data --window week --json
npm run dev -- report:scheduler --data-dir ./tmp/local-data --once --json
```

### Common Commands

```bash
npm run dev -- doctor
npm run dev -- collector:list --json
npm run dev -- collector:macos:info --json
npm run dev -- collector:windows:info --json
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
npm run dev -- report:snapshot:list --data-dir ./tmp/local-data --json
npm run dev -- report:scheduler --data-dir ./tmp/local-data --once --json
```

### Privacy

The project stores behavioral metadata only. It must not collect raw keystrokes, passwords, email or document content, clipboard text, authentication tokens, cookies, continuous screenshots, or screen recordings.

### Docs

- [CLI Quickstart](./CLI_QUICKSTART.md)
- [Detailed Internal Reference](./docs/reference/project-reference.md)
- [Product Requirements](./docs/product/requirements.md)
- [Active Implementation Plan](./docs/plans/active/mvp-implementation.md)

### Requirements

- Node.js `22.x` or later
- npm `10.x` or later
- Chrome for live browser collection
- Windows PowerShell for the Windows active-window collector
- Xcode or Xcode Command Line Tools with Swift for the macOS active-window collector
- `OPENAI_API_KEY` for `llm:analyze` if no key is stored in secure storage

<a id="ko"></a>
## 한국어

자동화 실행 전에 반복 업무를 발견하고 분석하기 위한 로컬 우선 워크플로우 패턴 분석기입니다.

현재 이 저장소는 활동 메타데이터를 수집하거나 import해서 로컬 SQLite에 저장하고, 이를 세션으로 묶고, 유사한 세션을 워크플로우로 군집화한 뒤, 전체 누적 기준의 CLI 리포트를 출력하는 TypeScript CLI를 제공합니다. 초점은 자동화 실행이 아니라 워크플로우 분석과 발견입니다.

### 현재 범위

- 로컬 전용 저장 및 분석
- Windows/macOS active-window 수집 경로
- 브라우저 메타데이터 수집용 Chrome extension 경로
- 분석된 로컬 데이터 기준 all-time CLI 리포트
- 워크플로우 검토, 피드백, 세션 삭제
- LLM-safe 워크플로우 요약 export와 OpenAI 기반 분석

현재 제한 사항:

- `report`는 현재 all-time 리포트만 지원합니다
- daily, weekly 리포트 window는 계획에 포함되어 있지만 아직 구현되지 않았습니다

### 빠른 시작

설치와 기본 검증:

```bash
npm install
npm run typecheck
npm test
```

로컬 데모 실행:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

단계별 실행:

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- report --data-dir ./tmp/local-data
```

JSON 출력:

```bash
npm run dev -- report --data-dir ./tmp/local-data --json
```

### 자주 쓰는 명령

```bash
npm run dev -- doctor
npm run dev -- collector:list --json
npm run dev -- collector:macos:info --json
npm run dev -- collector:windows:info --json
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
```

### 개인정보

이 프로젝트는 행동 메타데이터만 저장합니다. 실제 키 입력, 비밀번호, 이메일/문서 본문, 클립보드 텍스트, 인증 토큰, 쿠키, 연속 스크린샷, 화면 녹화는 수집하면 안 됩니다.

### 문서

- [CLI Quickstart](./CLI_QUICKSTART.md)
- [상세 내부 레퍼런스](./docs/reference/project-reference.md)
- [제품 요구사항](./docs/product/requirements.md)
- [현재 구현 계획](./docs/plans/active/mvp-implementation.md)

### 요구 사항

- Node.js `22.x` 이상
- npm `10.x` 이상
- 실시간 브라우저 수집용 Chrome
- Windows active-window collector 실행용 Windows PowerShell
- macOS active-window collector 실행용 Xcode 또는 Xcode Command Line Tools의 Swift
- secure storage에 키가 없을 때 `llm:analyze`용 `OPENAI_API_KEY`
