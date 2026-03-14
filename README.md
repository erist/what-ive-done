# What I've Done

Language:

- [English](#english)
- [한국어](#ko)

<a id="english"></a>
## English

Local-first workflow pattern analyzer for discovering repetitive work before deciding what to automate.

This repository currently provides a TypeScript CLI that collects or imports activity metadata, stores it locally in SQLite, normalizes noisy events into stable workflow context, maps them into semantic actions, segments them into sessions, clusters near-matching workflows, and prints workflow-centric reports with feedback reuse and automation hints. It is focused on workflow analysis and discovery, not automation execution.

### Current Scope

- local-only storage and analysis
- Windows and macOS active-window collection paths
- Chrome extension path for browser metadata ingestion
- deterministic event normalization and semantic action abstraction
- explainable session segmentation with boundary reasons
- near-match workflow clustering with variants and confidence scores
- all-time, daily, and weekly CLI reports for analyzed local data
- stored daily and weekly report snapshots
- local scheduler command for automatic snapshot refresh
- workflow review, label, merge, split, and session deletion
- workflow-centric report summaries, graphs, and automation hints
- LLM-safe workflow summary export and OpenAI-based workflow analysis

Current limitation:

- current feedback flow is still CLI-first rather than a dedicated UI
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
npm run dev -- workflow:label <workflow-id> --purpose "..." --automation-candidate true --difficulty medium --data-dir ./tmp/local-data
npm run dev -- workflow:merge <workflow-id> <target-workflow-id> --data-dir ./tmp/local-data
npm run dev -- workflow:split <workflow-id> --after-action search_order --data-dir ./tmp/local-data
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

현재 이 저장소는 활동 메타데이터를 수집하거나 import해서 로컬 SQLite에 저장하고, noisy event를 stable context로 정규화한 뒤 semantic action, session, workflow pattern으로 해석하고, feedback 재사용과 automation hint까지 포함한 workflow-centric CLI 리포트를 제공하는 TypeScript CLI입니다. 초점은 자동화 실행이 아니라 워크플로우 분석과 발견입니다.

### 현재 범위

- 로컬 전용 저장 및 분석
- Windows/macOS active-window 수집 경로
- 브라우저 메타데이터 수집용 Chrome extension 경로
- deterministic event normalization과 semantic action abstraction
- boundary reason이 있는 session segmentation
- near-match workflow clustering, variant, confidence 계산
- all-time/day/week workflow-centric CLI 리포트와 snapshot
- 워크플로우 검토, label, merge, split, 세션 삭제
- practical automation hint 제안
- LLM-safe 워크플로우 요약 export와 OpenAI 기반 분석

현재 제한 사항:

- feedback flow는 아직 dedicated UI가 아니라 CLI 중심입니다
- day-over-day, week-over-week 같은 comparison view는 아직 없습니다

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
npm run dev -- report --data-dir ./tmp/local-data --window day --json
npm run dev -- report --data-dir ./tmp/local-data --window week --json
```

### 자주 쓰는 명령

```bash
npm run dev -- doctor
npm run dev -- collector:list --json
npm run dev -- collector:macos:info --json
npm run dev -- collector:windows:info --json
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
npm run dev -- workflow:label <workflow-id> --purpose "반복 고객 응대" --automation-candidate true --difficulty medium --data-dir ./tmp/local-data
npm run dev -- workflow:merge <workflow-id> <target-workflow-id> --data-dir ./tmp/local-data
npm run dev -- workflow:split <workflow-id> --after-action search_order --data-dir ./tmp/local-data
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
