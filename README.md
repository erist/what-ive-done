# What I've Done

Language:

- [English](#english)
- [한국어](#ko)

<a id="english"></a>
## English

Local-first workflow pattern analyzer for discovering repetitive work before deciding what to automate.

The repository now centers on a **resident local agent** with a CLI control plane.
The agent can run the local ingest server, supervise desktop collectors, generate day/week report snapshots, and expose runtime health through CLI commands.
The project is focused on workflow analysis and discovery, not automation execution.

### Current Scope

- local-only storage and analysis in SQLite
- resident local agent runtime with persisted heartbeat and health state
- local ingest server managed by the agent
- Windows and macOS active-window collection paths
- Chrome extension path for browser metadata ingestion
- all-time, daily, and weekly reports for analyzed local data
- stored daily and weekly report snapshots
- agent-managed snapshot scheduler
- control-plane CLI commands for runtime health, manual snapshot refresh, and latest snapshot lookup
- workflow review, feedback, and session deletion
- LLM-safe workflow summary export and OpenAI-based workflow analysis
- macOS LaunchAgent autostart helpers

Current limitations:

- Windows autostart is not implemented yet
- desktop UI and tray UI are not implemented yet
- native desktop collectors currently focus on active-window changes
- legacy/manual commands such as `serve` and `report:scheduler` still coexist with the new agent flow

### Quick Start

Install and verify:

```bash
npm install
npm run typecheck
npm test
npm run build
```

Run a one-command local demo:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

Recommended agent-first flow with seeded data:

```bash
npm run dev -- init --data-dir ./tmp/agent-data
npm run dev -- collect:mock --data-dir ./tmp/agent-data
npm run dev -- agent:run-once --data-dir ./tmp/agent-data
npm run dev -- agent:snapshot:latest --data-dir ./tmp/agent-data
```

Run the resident agent for live operation:

```bash
npm run dev -- agent:run --data-dir ./tmp/live-data
```

Check health and stop it:

```bash
npm run dev -- agent:status --data-dir ./tmp/live-data
npm run dev -- agent:health --data-dir ./tmp/live-data
npm run dev -- agent:stop --data-dir ./tmp/live-data
```

Manual analysis flow is still available:

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- report --data-dir ./tmp/local-data --window week --json
```

### Common Commands

```bash
npm run dev -- doctor
npm run dev -- agent:run --data-dir ./tmp/live-data
npm run dev -- agent:health --data-dir ./tmp/live-data
npm run dev -- agent:run-once --data-dir ./tmp/live-data
npm run dev -- agent:snapshot:latest --data-dir ./tmp/live-data
npm run dev -- agent:collectors --data-dir ./tmp/live-data
npm run dev -- agent:autostart:status --data-dir ./tmp/live-data
npm run dev -- report:snapshot:list --data-dir ./tmp/live-data --json
```

Legacy/manual runtime commands still exist when needed:

```bash
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
npm run dev -- report:scheduler --data-dir ./tmp/live-data --once --json
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

이 저장소는 이제 **resident local agent** 와 CLI control plane을 중심으로 동작합니다.
에이전트는 로컬 ingest server 실행, desktop collector supervision, day/week snapshot 생성, runtime health 상태 노출을 맡습니다.
초점은 자동화 실행이 아니라 워크플로우 분석과 발견입니다.

### 현재 범위

- SQLite 기반 로컬 전용 저장 및 분석
- heartbeat와 health state를 기록하는 resident local agent runtime
- agent가 관리하는 local ingest server
- Windows/macOS active-window 수집 경로
- 브라우저 메타데이터 수집용 Chrome extension 경로
- all-time, daily, weekly 리포트
- daily/weekly report snapshot 저장
- agent 내부 snapshot scheduler
- runtime health, 수동 snapshot refresh, latest snapshot 조회용 control CLI
- 워크플로우 검토, 피드백, 세션 삭제
- LLM-safe 워크플로우 요약 export와 OpenAI 기반 분석
- macOS LaunchAgent autostart helper

현재 제한 사항:

- Windows autostart는 아직 구현되지 않았습니다
- desktop UI와 tray UI는 아직 없습니다
- native desktop collector는 현재 active-window 변화 중심입니다
- `serve`, `report:scheduler` 같은 legacy/manual 명령도 아직 함께 남아 있습니다

### 빠른 시작

설치와 기본 검증:

```bash
npm install
npm run typecheck
npm test
npm run build
```

원커맨드 로컬 데모:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

seeded data 기준 agent-first 흐름:

```bash
npm run dev -- init --data-dir ./tmp/agent-data
npm run dev -- collect:mock --data-dir ./tmp/agent-data
npm run dev -- agent:run-once --data-dir ./tmp/agent-data
npm run dev -- agent:snapshot:latest --data-dir ./tmp/agent-data
```

실사용 기준 resident agent 실행:

```bash
npm run dev -- agent:run --data-dir ./tmp/live-data
```

상태 확인과 종료:

```bash
npm run dev -- agent:status --data-dir ./tmp/live-data
npm run dev -- agent:health --data-dir ./tmp/live-data
npm run dev -- agent:stop --data-dir ./tmp/live-data
```

기존 수동 분석 흐름도 계속 사용할 수 있습니다:

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- report --data-dir ./tmp/local-data --window week --json
```

### 자주 쓰는 명령

```bash
npm run dev -- doctor
npm run dev -- agent:run --data-dir ./tmp/live-data
npm run dev -- agent:health --data-dir ./tmp/live-data
npm run dev -- agent:run-once --data-dir ./tmp/live-data
npm run dev -- agent:snapshot:latest --data-dir ./tmp/live-data
npm run dev -- agent:collectors --data-dir ./tmp/live-data
npm run dev -- agent:autostart:status --data-dir ./tmp/live-data
npm run dev -- report:snapshot:list --data-dir ./tmp/live-data --json
```

필요할 때만 쓰는 legacy/manual runtime 명령:

```bash
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
npm run dev -- report:scheduler --data-dir ./tmp/live-data --once --json
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
