# What I've Done

Language:

- [English](#english)
- [한국어](#ko)

<a id="english"></a>
## English

Local-first workflow pattern analyzer for discovering repetitive work before deciding what to automate.

This repository provides a TypeScript CLI plus a resident local agent. Together they collect or import activity metadata, store it locally in SQLite, normalize noisy events into stable workflow context, map them into semantic actions, segment them into sessions, cluster near-matching workflows, and generate workflow-centric reports with feedback reuse and automation hints. The project is focused on workflow analysis and discovery, not automation execution.

### Current Scope

- local-only storage and analysis in SQLite
- resident local agent runtime with persisted heartbeat and health state
- agent-managed local ingest server and snapshot scheduler
- localhost-only ingest hardening with auth token and rate limiting
- local browser viewer for agent status, live workflow reports, snapshots, and session drill-down
- Windows and macOS active-window collection paths
- Chrome extension path for browser metadata ingestion
- Chrome browser context substrate with SPA route taxonomy, opaque document-type hashes, tab-order metadata, and signal-only dwell segments
- versioned domain-pack registry with stable route families and coverage diagnostics
- versioned action-pack registry with unknown-action coverage ops and offline suggestion prompts
- golden workflow fixtures and debug trace CLI for quality regression
- deterministic event normalization and semantic action abstraction
- rolling-context session segmentation with explainable boundary reasons
- optional `gws` Calendar boundary collector with meeting start/end signals and doctor diagnostics
- hybrid workflow clustering with action-set/domain/time similarity, explainable confidence details, and benchmark diagnostics
- all-time, daily, and weekly workflow-centric reports
- stored daily and weekly report snapshots
- workflow review, label, merge, split, exclude, hide, and session deletion
- practical automation hints for likely automation candidates
- LLM-safe workflow summary export and configurable provider-based workflow analysis for ChatGPT, Gemini, and Claude
- saved default LLM provider/model/auth configuration
- macOS LaunchAgent autostart helpers

Current limitations:

- Windows autostart installation is not implemented yet
- the current browser viewer is read-only and feedback flow is still CLI-first
- a packaged desktop app or tray UI does not exist yet
- native desktop collectors still focus on active-window changes
- report comparison views are not implemented yet

### Quick Start

Install and verify:

```bash
npm install
npm run typecheck
npm test
npm run build
```

Run a one-command demo:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

Recommended agent-first flow:

```bash
npm run dev -- init --data-dir ./tmp/agent-data
npm run dev -- ingest:token --data-dir ./tmp/agent-data --rotate
npm run dev -- collect:mock --data-dir ./tmp/agent-data
npm run dev -- agent:run-once --data-dir ./tmp/agent-data
npm run dev -- agent:snapshot:latest --data-dir ./tmp/agent-data
```

Browser ingest token for the Chrome extension:

```bash
npm run dev -- ingest:token --data-dir ./tmp/live-data
```

Run the resident agent:

```bash
npm run dev -- agent:run --data-dir ./tmp/live-data --verbose
```

Enable optional Calendar boundary signals through `gws`:

```bash
npm run dev -- doctor --gws-calendar-id primary
npm run dev -- agent:run --data-dir ./tmp/live-data --gws-calendar --gws-calendar-id primary
```

Run the resident agent and open the local browser viewer:

```bash
npm run dev -- agent:run --data-dir ./tmp/live-data --open-viewer
```

Open the local browser viewer directly:

```bash
npm run dev -- viewer:open --data-dir ./tmp/live-data
```

Default local viewer URL:

```text
http://127.0.0.1:4318/
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

Workflow feedback examples:

```bash
npm run dev -- workflow:label <workflow-id> --purpose "Review shipping status" --automation-candidate true --difficulty medium --data-dir ./tmp/local-data
npm run dev -- workflow:merge <workflow-id> <target-workflow-id> --data-dir ./tmp/local-data
npm run dev -- workflow:split <workflow-id> --after-action search_order --data-dir ./tmp/local-data
```

### Common Commands

```bash
npm run dev -- doctor
npm run dev -- doctor --gws-calendar-id primary
npm run dev -- ingest:token --data-dir ./tmp/live-data
npm run dev -- agent:run --data-dir ./tmp/live-data
npm run dev -- agent:run --data-dir ./tmp/live-data --gws-calendar --gws-calendar-id primary
npm run dev -- agent:health --data-dir ./tmp/live-data
npm run dev -- agent:run-once --data-dir ./tmp/live-data
npm run dev -- agent:snapshot:latest --data-dir ./tmp/live-data
npm run dev -- agent:collectors --data-dir ./tmp/live-data
npm run dev -- agent:autostart:status --data-dir ./tmp/live-data
npm run dev -- collector:gws:calendar:info --calendar-id primary --json
npm run dev -- viewer:open --data-dir ./tmp/live-data
npm run dev -- debug:raw:list --data-dir ./tmp/live-data --limit 10
npm run dev -- debug:normalized:list --data-dir ./tmp/live-data --limit 10
npm run dev -- domain-pack:report --data-dir ./tmp/live-data --limit 10
npm run dev -- action:coverage --data-dir ./tmp/live-data --limit 10
npm run dev -- action:suggest --data-dir ./tmp/live-data --limit 10
npm run dev -- cluster:benchmark --json
npm run dev -- report:snapshot:list --data-dir ./tmp/live-data --json
npm run dev -- report:snapshot:show --data-dir ./tmp/live-data --window week --latest --json
```

Lower-level server command when needed:

```bash
npm run dev -- server:run --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318 --open --verbose
```

Quality tracing flow:

```bash
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- domain-pack:test ./fixtures/domain-packs/google-sheets.ndjson
npm run dev -- domain-pack:report --data-dir ./tmp/local-data --limit 10
npm run dev -- action:coverage --data-dir ./tmp/local-data --limit 10
npm run dev -- action:suggest --data-dir ./tmp/local-data --limit 10
npm run dev -- cluster:benchmark --json
npm run dev -- debug:raw:list --data-dir ./tmp/local-data --limit 10
npm run dev -- debug:trace:raw <raw-event-id> --data-dir ./tmp/local-data
npm run dev -- debug:trace:session <session-id> --data-dir ./tmp/local-data
npm run dev -- debug:trace:workflow <workflow-id> --data-dir ./tmp/local-data
```

Golden regression fixtures live under:

```text
fixtures/golden/
fixtures/domain-packs/
```

### LLM Configuration

```bash
npm run dev -- llm:providers --json
npm run dev -- llm:config:set --data-dir ./tmp/local-data --provider gemini --auth api-key --model gemini-2.5-flash
npm run dev -- credential:set gemini
npm run dev -- llm:analyze --data-dir ./tmp/local-data --json
```

Gemini OAuth login:

```bash
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_CLOUD_PROJECT="your-project-id"
npm run dev -- auth:login gemini --data-dir ./tmp/local-data
```

### Privacy

The project stores behavioral metadata only. It must not collect raw keystrokes, passwords, email or document content, clipboard text, authentication tokens, cookies, continuous screenshots, or screen recordings.

Chrome browser context expansion stores only normalized route taxonomy, opaque document-type hashes, tab-order counters, and dwell durations. Raw DOM text, form values, and hash-fragment strings are not persisted.

Optional Calendar boundary signals store only hashed event identifiers, hashed meeting summaries, meeting start/end timestamps, and attendee counts. Raw meeting titles, descriptions, attendee identities, and body content are not persisted.

### Docs

- [CLI Quickstart](./CLI_QUICKSTART.md)
- [Detailed Internal Reference](./docs/reference/project-reference.md)
- [Chrome Context Privacy Review](./docs/reference/chrome-context-privacy-review.md)
- [Product Requirements](./docs/product/requirements.md)
- [Active Implementation Plan](./docs/plans/active/mvp-implementation.md)

### Requirements

- Node.js `22.x` or later
- npm `10.x` or later
- Chrome for live browser collection
- Windows PowerShell for the Windows active-window collector
- Xcode or Xcode Command Line Tools with Swift for the macOS active-window collector
- optional `gws` CLI with Calendar OAuth scope when using Calendar boundary signals
- provider API key env vars such as `OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, or `ANTHROPIC_API_KEY` when no key is stored in secure storage

<a id="ko"></a>
## 한국어

자동화 실행 전에 반복 업무를 발견하고 분석하기 위한 로컬 우선 워크플로우 분석기입니다.

이 저장소는 TypeScript CLI와 resident local agent를 함께 제공합니다. 활동 메타데이터를 수집하거나 import해서 로컬 SQLite에 저장하고, noisy event를 stable workflow context로 정규화한 뒤 semantic action, session, workflow pattern으로 해석하고, feedback 재사용과 automation hint까지 포함한 workflow-centric 리포트를 생성합니다. 초점은 자동화 실행이 아니라 워크플로우 분석과 발견입니다.

### 현재 범위

- SQLite 기반 로컬 전용 저장 및 분석
- heartbeat와 health state를 기록하는 resident local agent runtime
- agent가 관리하는 local ingest server와 snapshot scheduler
- localhost-only binding, auth token, rate limiting이 적용된 ingest 경로
- agent 상태, live report, snapshot, session detail을 보는 local browser viewer
- Windows/macOS active-window 수집 경로
- 브라우저 메타데이터 수집용 Chrome extension 경로
- SPA route taxonomy, opaque document-type hash, tab-order metadata, signal-only dwell segment를 담는 Chrome browser context substrate
- stable route family와 coverage 진단을 위한 versioned domain-pack registry
- `unknown_action` coverage 운영과 offline suggestion prompt를 위한 versioned action-pack registry
- golden workflow fixture와 debug trace CLI
- deterministic event normalization과 semantic action abstraction
- rolling-context 기반 boundary reason이 있는 session segmentation
- optional `gws` Calendar collector와 meeting start/end signal, doctor 진단
- action-set/domain/time similarity를 쓰는 hybrid workflow clustering, variant, confidence 설명
- all-time/day/week workflow-centric 리포트
- daily/weekly report snapshot 저장
- 워크플로우 검토, label, merge, split, exclude, hide, 세션 삭제
- likely automation candidate를 위한 practical automation hint 제안
- LLM-safe 워크플로우 요약 export와 ChatGPT, Gemini, Claude 기반 구성형 분석
- 기본 LLM provider/model/auth 설정 저장
- macOS LaunchAgent autostart helper

현재 제한 사항:

- Windows autostart 설치는 아직 구현되지 않았습니다
- 현재 browser viewer는 read-only이며 feedback flow는 아직 CLI 중심입니다
- packaged desktop app이나 tray UI는 아직 없습니다
- native desktop collector는 현재 active-window 변화 중심입니다
- report comparison view는 아직 없습니다

### 빠른 시작

설치와 기본 검증:

```bash
npm install
npm run typecheck
npm test
npm run build
```

원커맨드 데모:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

권장 agent-first 흐름:

```bash
npm run dev -- init --data-dir ./tmp/agent-data
npm run dev -- ingest:token --data-dir ./tmp/agent-data --rotate
npm run dev -- collect:mock --data-dir ./tmp/agent-data
npm run dev -- agent:run-once --data-dir ./tmp/agent-data
npm run dev -- agent:snapshot:latest --data-dir ./tmp/agent-data
```

Chrome extension에 넣을 ingest token 확인:

```bash
npm run dev -- ingest:token --data-dir ./tmp/live-data
```

resident agent 실행:

```bash
npm run dev -- agent:run --data-dir ./tmp/live-data --verbose
```

`gws`를 통한 optional Calendar boundary signal 켜기:

```bash
npm run dev -- doctor --gws-calendar-id primary
npm run dev -- agent:run --data-dir ./tmp/live-data --gws-calendar --gws-calendar-id primary
```

resident agent를 실행하면서 browser viewer까지 바로 열기:

```bash
npm run dev -- agent:run --data-dir ./tmp/live-data --open-viewer
```

browser viewer만 열기:

```bash
npm run dev -- viewer:open --data-dir ./tmp/live-data
```

기본 local viewer URL:

```text
http://127.0.0.1:4318/
```

상태 확인과 종료:

```bash
npm run dev -- agent:status --data-dir ./tmp/live-data
npm run dev -- agent:health --data-dir ./tmp/live-data
npm run dev -- agent:stop --data-dir ./tmp/live-data
```

수동 분석 흐름:

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- report --data-dir ./tmp/local-data --window week --json
```

워크플로우 피드백 예시:

```bash
npm run dev -- workflow:label <workflow-id> --purpose "배송 상태 검토" --automation-candidate true --difficulty medium --data-dir ./tmp/local-data
npm run dev -- workflow:merge <workflow-id> <target-workflow-id> --data-dir ./tmp/local-data
npm run dev -- workflow:split <workflow-id> --after-action search_order --data-dir ./tmp/local-data
```

### 자주 쓰는 명령

```bash
npm run dev -- doctor
npm run dev -- doctor --gws-calendar-id primary
npm run dev -- ingest:token --data-dir ./tmp/live-data
npm run dev -- agent:run --data-dir ./tmp/live-data
npm run dev -- agent:run --data-dir ./tmp/live-data --gws-calendar --gws-calendar-id primary
npm run dev -- agent:health --data-dir ./tmp/live-data
npm run dev -- agent:run-once --data-dir ./tmp/live-data
npm run dev -- agent:snapshot:latest --data-dir ./tmp/live-data
npm run dev -- agent:collectors --data-dir ./tmp/live-data
npm run dev -- agent:autostart:status --data-dir ./tmp/live-data
npm run dev -- collector:gws:calendar:info --calendar-id primary --json
npm run dev -- viewer:open --data-dir ./tmp/live-data
npm run dev -- debug:raw:list --data-dir ./tmp/live-data --limit 10
npm run dev -- debug:normalized:list --data-dir ./tmp/live-data --limit 10
npm run dev -- domain-pack:report --data-dir ./tmp/live-data --limit 10
npm run dev -- action:coverage --data-dir ./tmp/live-data --limit 10
npm run dev -- action:suggest --data-dir ./tmp/live-data --limit 10
npm run dev -- cluster:benchmark --json
npm run dev -- report:snapshot:list --data-dir ./tmp/live-data --json
npm run dev -- report:snapshot:show --data-dir ./tmp/live-data --window week --latest --json
```

필요하면 lower-level server 명령도 사용할 수 있습니다:

```bash
npm run dev -- server:run --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318 --open --verbose
```

품질 trace 흐름:

```bash
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- domain-pack:test ./fixtures/domain-packs/google-sheets.ndjson
npm run dev -- domain-pack:report --data-dir ./tmp/local-data --limit 10
npm run dev -- action:coverage --data-dir ./tmp/local-data --limit 10
npm run dev -- action:suggest --data-dir ./tmp/local-data --limit 10
npm run dev -- cluster:benchmark --json
npm run dev -- debug:raw:list --data-dir ./tmp/local-data --limit 10
npm run dev -- debug:trace:raw <raw-event-id> --data-dir ./tmp/local-data
npm run dev -- debug:trace:session <session-id> --data-dir ./tmp/local-data
npm run dev -- debug:trace:workflow <workflow-id> --data-dir ./tmp/local-data
```

golden regression fixture 위치:

```text
fixtures/golden/
fixtures/domain-packs/
```

### LLM 설정

```bash
npm run dev -- llm:providers --json
npm run dev -- llm:config:set --data-dir ./tmp/local-data --provider gemini --auth api-key --model gemini-2.5-flash
npm run dev -- credential:set gemini
npm run dev -- llm:analyze --data-dir ./tmp/local-data --json
```

Gemini OAuth 로그인:

```bash
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export GOOGLE_CLOUD_PROJECT="your-project-id"
npm run dev -- auth:login gemini --data-dir ./tmp/local-data
```

### 개인정보

이 프로젝트는 행동 메타데이터만 저장합니다. 실제 키 입력, 비밀번호, 이메일/문서 본문, 클립보드 텍스트, 인증 토큰, 쿠키, 연속 스크린샷, 화면 녹화는 수집하면 안 됩니다.

Chrome browser context 확장에서도 저장되는 것은 정규화된 route taxonomy, opaque document-type hash, tab-order 카운터, dwell duration뿐입니다. raw DOM 텍스트, form 값, hash fragment 원문은 저장하지 않습니다.

optional Calendar boundary signal에서도 저장되는 것은 hash 처리된 event id, hash 처리된 meeting summary, meeting start/end timestamp, attendee 수뿐입니다. raw meeting title, description, attendee identity, 본문은 저장하지 않습니다.

### 문서

- [CLI Quickstart](./CLI_QUICKSTART.md)
- [상세 내부 레퍼런스](./docs/reference/project-reference.md)
- [Chrome Context Privacy Review](./docs/reference/chrome-context-privacy-review.md)
- [제품 요구사항](./docs/product/requirements.md)
- [현재 구현 계획](./docs/plans/active/mvp-implementation.md)

### 요구 사항

- Node.js `22.x` 이상
- npm `10.x` 이상
- 실시간 브라우저 수집용 Chrome
- Windows active-window collector 실행용 Windows PowerShell
- macOS active-window collector 실행용 Xcode 또는 Xcode Command Line Tools의 Swift
- Calendar boundary signal을 쓸 때는 Calendar scope가 있는 optional `gws` CLI
- secure storage에 키가 없을 때 `OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`
