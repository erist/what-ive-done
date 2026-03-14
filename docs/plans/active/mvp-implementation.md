# Implementation Plan

## 1. 목표

이제 MVP의 다음 단계는 개별 CLI 명령을 추가하는 것이 아니라,
제품 목적에 맞는 **상주 로컬 에이전트(runtime)** 구조로 옮겨가는 것이다.

제품 목적은 사용자의 반복 업무 패턴을 장기간 관찰하고 분석하는 것이다.
그렇다면 수집, 스냅샷 생성, 주기적 분석은 사용자가 매번 CLI를 직접 호출하지 않아도
동작해야 한다.

- 수집은 사용자 세션 안에서 계속 돌아야 한다.
- 리포트 스냅샷은 에이전트가 자동 생성해야 한다.
- CLI와 이후 UI는 에이전트를 제어하고 상태를 조회하는 역할로 분리한다.

## 2. 현재 구현 상태

2026-03-14 기준 현재 코드베이스에는 아래 기반이 이미 있다.

### 2.1 구현 완료

- 로컬 CLI 진입점과 SQLite 초기화
- raw event import와 local ingest server
- Windows/macOS active-window collector 경로
- raw event 정규화, 세션화, workflow clustering
- all-time/day/week 리포트
- daily/weekly report snapshot 저장
- local scheduler command
- workflow feedback, session delete, LLM-safe payload export, OpenAI 분석
- macOS Keychain 기반 OpenAI API key 저장

### 2.2 검증 상태

리포트와 스냅샷 단계까지 아래 검증이 통과한 상태다.

- `npm test`: 통과
- `npm run typecheck`: 통과
- `npm run build`: 통과
- `report --window day|week`: 통과
- `report:generate`, `report:snapshot:list`, `report:snapshot:show`, `report:scheduler --once`: 통과

즉, 기능적으로는 수집 -> 저장 -> 분석 -> 리포트 -> 스냅샷까지 연결되어 있다.

### 2.3 현재 구조의 핵심 문제

지금 구조는 여전히 CLI 중심이라 제품 목적과 맞지 않는 부분이 남아 있다.

- 수집기가 항상 돌아야 하는데 런타임 오너가 없다.
- scheduler가 있어도 사용자가 그 프로세스를 직접 켜야 한다.
- collector, snapshot generation, state monitoring이 하나의 에이전트 생명주기로 묶여 있지 않다.
- CLI가 제어면과 런타임면을 동시에 맡고 있다.
- 이후 UI를 붙여도 연결 대상이 되는 resident process가 아직 없다.

정리하면, 기능 레이어보다 **런타임 아키텍처 레이어**가 다음 병목이다.

## 3. 제품 결정 사항

다음 단계에서 확정할 방향은 아래와 같다.

- 제품의 주 실행 단위는 `resident local agent`다.
- CLI는 에이전트 제어, 진단, 수동 강제 실행, 디버그용으로 남긴다.
- UI는 이후 단계에서 같은 에이전트를 제어하고 상태를 읽는 클라이언트로 붙인다.
- macOS는 `LaunchAgent`, Windows는 로그인 사용자 세션 기반 실행 모델을 우선 검토한다.

중요한 구분:

- runtime plane: 상주 에이전트, collector orchestration, scheduling, health state
- control plane: CLI, 이후 UI, 진단 및 상태 조회
- data plane: raw events, normalized artifacts, report snapshots, feedback

이 분리가 되어야 제품이 커져도 구조가 무너지지 않는다.

## 4. 구현 원칙

### 4.1 기존 분석/저장 코드는 최대한 재사용

에이전트 전환 때문에 분석, 저장, 리포트 계산을 다시 만들지 않는다.

- `src/storage/`
- `src/pipeline/`
- `src/reporting/`
- 기존 collector scripts

새로 만들 것은 런타임 orchestration과 상태 관리다.

### 4.2 하나의 resident process가 책임을 가진다

에이전트는 최소한 아래 책임을 가진다.

- collector process 시작/종료/상태 확인
- 주기적 report snapshot generation
- 실패 재시도와 진단 상태 기록
- control CLI/UI를 위한 상태 노출

### 4.3 UI는 나중, 제어 API는 지금

이번 단계에서는 화면을 만들지 않는다.
대신 UI가 나중에 붙을 수 있도록 control interface를 먼저 정리한다.

예:

- agent start
- agent stop
- agent status
- agent run-once
- latest snapshots
- collector health

### 4.4 사용자 세션 기반 실행을 우선한다

이 제품은 active window 같은 사용자 컨텍스트를 읽는다.
그래서 일반 시스템 daemon보다 사용자 로그인 세션에 붙는 실행 모델이 더 중요하다.

- macOS: `LaunchAgent`
- Windows: 사용자 로그인 시 시작되는 작업

## 5. 목표 아키텍처

### 5.1 런타임 구조

핵심 프로세스:

1. resident agent
2. collector subprocesses
3. control CLI
4. 이후 UI client

권장 데이터 흐름:

1. collector가 raw events를 local ingest 또는 직접 DB 경로로 보냄
2. agent가 수집 상태를 추적
3. agent가 주기적으로 report snapshots를 생성
4. CLI/UI가 agent 상태와 latest snapshots를 조회

### 5.2 코드 구조 방향

권장 신규 모듈:

- `src/agent/runtime.ts`
- `src/agent/collectors.ts`
- `src/agent/scheduler.ts`
- `src/agent/state.ts`
- `src/agent/autostart/`

CLI는 아래처럼 얇아지는 방향이 좋다.

- `agent:start`
- `agent:run`
- `agent:status`
- `agent:stop`
- `agent:run-once`
- `report:snapshot:*`

## 6. 단계별 구현 계획

### Phase 0. Active Plan 전환

- 현재 active plan을 resident agent 기준으로 갱신한다.
- report window/snapshot 작업은 archive로 이동한다.

완료 기준:

- 다음 구현 단계의 기준 문서가 런타임 전환 방향을 반영한다.

### Phase 1. Agent Runtime 골격 추가

- long-running `agent:run` 엔트리포인트를 추가한다.
- graceful shutdown, pid/state 개념, 기본 heartbeat를 넣는다.
- 수집과 스냅샷 생성을 한 프로세스 안에서 orchestration할 수 있는 뼈대를 만든다.

완료 기준:

- 에이전트 프로세스가 안정적으로 떠 있고 상태를 기록한다.

### Phase 2. Collector Orchestration 통합

- macOS/Windows collector를 agent가 시작하고 감시하게 한다.
- collector 프로세스 종료 시 재시도나 오류 상태를 기록한다.
- 필요한 경우 ingest server도 agent lifecycle에 포함시킨다.

완료 기준:

- 사용자는 collector를 별도 터미널에서 수동 실행하지 않아도 된다.

### Phase 3. Snapshot Scheduler 내장

- 기존 `report:scheduler` 로직을 agent 내부 scheduler로 옮긴다.
- day/week snapshot을 자동 생성한다.
- 마지막 생성 시각과 다음 실행 상태를 보존한다.

완료 기준:

- agent가 떠 있으면 snapshot이 자동으로 갱신된다.

### Phase 4. Control CLI 정리

- agent status, latest snapshot, collector health를 보는 명령을 추가한다.
- 수동 재실행과 진단 명령을 정리한다.
- 기존 report/snapshot 명령은 agent 시대에 맞게 역할을 재정의한다.

완료 기준:

- CLI가 runtime runner가 아니라 control surface처럼 보인다.

### Phase 5. OS 자동 시작 전략

- macOS용 LaunchAgent 설치/제거 흐름을 문서화하거나 일부 자동화한다.
- Windows용 로그인 시 자동 시작 전략을 문서화한다.
- 최소한 수동 설치 절차로도 항상 켜지는 환경을 만들 수 있게 한다.

완료 기준:

- 사용자는 재부팅 후에도 agent가 자동 시작되게 설정할 수 있다.

## 7. 권장 구현 순서

실제 작업 순서는 아래가 가장 안전하다.

1. `agent:run` 런타임 뼈대
2. collector orchestration
3. snapshot scheduler 내장
4. control CLI 정리
5. OS 자동 시작 연결

이 순서가 좋은 이유는 resident process 없이 autostart를 먼저 붙이면 운영 경로가 불안정해지기 때문이다.

## 8. 이번 단계에서 의도적으로 미루는 항목

아래는 다음 단계 이후로 미룬다.

- full desktop UI
- tray UI
- remote sync
- multi-user analytics
- cloud-managed agent
- diff report와 recommendation feed UI

## 9. 추천 결론

현재까지는 기능이 쌓였지만 런타임의 중심이 아직 CLI다.
제품 목적을 생각하면 이제 중심을 CLI에서 resident agent로 옮겨야 한다.

가장 현실적인 다음 단계는 아래와 같다.

- report/snapshot 계산 로직은 유지한다.
- resident local agent를 추가한다.
- CLI는 control plane으로 축소한다.
- UI는 그 다음 단계에서 같은 control surface를 쓰는 방향으로 붙인다.

이 전환이 끝나야 이 프로젝트가 “명령 모음”이 아니라 실제로 계속 동작하는 사용자용 제품에 가까워진다.
