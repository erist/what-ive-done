# Implementation Plan

## 1. 목표

MVP의 런타임 전환 목표는 CLI 중심 구조를
**resident local agent** 중심 구조로 옮기는 것이다.

2026-03-14 기준 이 전환의 1차 구현은 이미 상당 부분 진행되었다.
이제 문서의 초점은 "에이전트를 도입해야 한다"가 아니라,
"도입된 에이전트를 어떻게 안정화하고 남은 플랫폼 작업을 마무리할 것인가"로 옮겨간다.

핵심 목표는 계속 동일하다.

- 수집은 사용자 세션 안에서 상주 프로세스가 맡는다.
- 리포트 스냅샷은 에이전트가 자동 생성한다.
- CLI는 런타임 실행기라기보다 control surface 역할을 맡는다.
- 이후 UI는 같은 control surface 위에 붙는다.

## 2. 현재 구현 상태

### 2.1 구현 완료

현재 코드베이스에는 아래 항목이 구현되어 있다.

- 로컬 CLI 진입점과 SQLite 초기화
- raw event import와 local ingest server
- Windows/macOS active-window collector 스크립트 경로
- raw event 정규화, 세션화, workflow clustering
- all-time/day/week 리포트
- daily/weekly report snapshot 저장
- workflow feedback, session delete, LLM-safe payload export, OpenAI 분석
- macOS Keychain 기반 OpenAI API key 저장
- resident agent runtime 골격
  - pid lock
  - heartbeat 상태 기록
  - SQLite `settings` 기반 runtime state 저장
- agent lifecycle 안의 local ingest server 관리
- agent collector supervision
  - macOS/Windows collector command spec 관리
  - 프로세스 종료 감지
  - 재시도 상태 기록
  - collector health 노출
- agent 내부 snapshot scheduler
  - day/week 스냅샷 자동 생성
  - 마지막 실행 시각
  - 마지막 성공 시각
  - 다음 실행 시각
  - 실패 상태 기록
- control CLI 명령
  - `agent:run`
  - `agent:status`
  - `agent:stop`
  - `agent:health`
  - `agent:run-once`
  - `agent:snapshot:latest`
  - `agent:collectors`
- macOS LaunchAgent 기반 autostart helper
  - 상태 조회
  - plist 생성
  - 설치
  - 제거

### 2.2 현재 코드 구조

resident agent 전환과 관련된 주요 모듈은 아래와 같다.

- `src/agent/runtime.ts`
- `src/agent/lock.ts`
- `src/agent/state.ts`
- `src/agent/collectors.ts`
- `src/agent/scheduler.ts`
- `src/agent/control.ts`
- `src/agent/autostart/`

기존 분석 및 저장 계층은 그대로 재사용하고 있다.

- `src/storage/`
- `src/pipeline/`
- `src/reporting/`
- `src/server/ingest-server.ts`

즉, 현재 구조는 문서에 적혀 있던 "권장 신규 모듈" 단계가 아니라,
실제 런타임 모듈이 이미 코드에 자리잡은 상태다.

### 2.3 검증 상태

현재 브랜치 기준으로 아래 검증이 통과한다.

- `npm test`: 통과
- `npm run typecheck`: 통과
- `npm run build`: 통과

추가로 아래 수동 검증도 수행했다.

- `agent:run -> agent:status -> agent:stop`
- agent가 local ingest server와 collector를 함께 띄우는 흐름
- collector 경유 raw event 적재 확인
- `collect:mock -> agent:run --no-collectors -> report:snapshot:list`
- `agent:run-once -> agent:snapshot:latest -> agent:health`
- macOS temp plist 경로 기준 `agent:autostart:install/status/uninstall`

### 2.4 현재 남은 핵심 공백

런타임 전환의 핵심 병목은 이제 대부분 해소되었지만,
아래 항목은 아직 남아 있다.

- Windows 로그인 자동 시작 설치 흐름은 아직 구현되지 않았다.
- UI는 아직 붙지 않았고 control plane은 CLI에 머물러 있다.
- `serve`, `report:scheduler` 같은 legacy/manual 명령은 여전히 남아 있다.
- runtime observability는 아직 기본 수준이다.
  - 로그 로테이션
  - 더 정교한 backoff 정책
  - crash recovery 시나리오
  - richer diagnostics
- collector 경로는 macOS에서 실제 smoke test가 끝났고,
  Windows는 command wiring 기준으로 준비되어 있다.

## 3. 제품 결정 사항

현재 기준으로 확정된 방향은 아래와 같다.

- 제품의 주 실행 단위는 `resident local agent`다.
- CLI는 control plane과 수동 실행, 진단, fallback 경로를 맡는다.
- UI는 이후 단계에서 같은 상태 모델과 제어면을 재사용한다.
- macOS는 `LaunchAgent` 경로를 우선 구현했고,
  Windows는 로그인 사용자 세션 자동 시작을 다음 보강 항목으로 둔다.

중요한 구분도 그대로 유지된다.

- runtime plane: 상주 에이전트, ingest server, collector orchestration, snapshot scheduling, health state
- control plane: CLI, 이후 UI, 진단 및 상태 조회
- data plane: raw events, normalized artifacts, report snapshots, feedback

## 4. 구현 원칙

### 4.1 기존 분석/저장 코드는 계속 재사용

에이전트 전환 때문에 분석, 저장, 리포트 계산을 다시 만들지 않는다.

- `src/storage/`
- `src/pipeline/`
- `src/reporting/`
- 기존 collector scripts

현재도 실제 구현은 이 원칙을 그대로 따른다.

### 4.2 하나의 resident process가 런타임 책임을 가진다

현재 agent는 최소한 아래 책임을 가진다.

- ingest server 시작/종료
- collector subprocess 시작/종료/재시도
- snapshot scheduler 실행
- heartbeat와 health state 기록
- CLI를 위한 상태 노출

### 4.3 UI는 나중, control surface는 지금

이번 단계에서도 데스크톱 UI는 만들지 않았다.
대신 CLI가 나중의 UI가 기대할 수 있는 control surface 역할을 먼저 맡고 있다.

예:

- agent run
- agent stop
- agent status
- agent health
- agent run-once
- latest snapshots
- collector health
- autostart status/install/uninstall

### 4.4 사용자 세션 기반 실행을 우선한다

이 제품은 active window 같은 사용자 컨텍스트를 읽는다.
그래서 일반 시스템 daemon보다 사용자 로그인 세션에 붙는 실행 모델이 중요하다.

- macOS: LaunchAgent 구현 완료
- Windows: 다음 보강 항목

## 5. 현재 아키텍처

### 5.1 런타임 구조

현재 핵심 프로세스와 역할은 아래와 같다.

1. resident agent
2. local ingest server
3. collector subprocesses
4. snapshot scheduler
5. control CLI
6. 이후 UI client

현재 데이터 흐름은 아래와 같다.

1. collector가 local ingest server로 raw event를 보낸다.
2. ingest server가 local SQLite에 raw event를 저장한다.
3. agent가 collector/ingest 상태를 추적한다.
4. agent scheduler가 day/week report snapshot을 생성한다.
5. CLI가 agent 상태와 latest snapshots를 조회한다.

### 5.2 현재 CLI 역할

agent 시대에 맞는 control 명령은 이미 존재한다.

- `agent:run`
- `agent:status`
- `agent:stop`
- `agent:health`
- `agent:run-once`
- `agent:snapshot:latest`
- `agent:collectors`
- `agent:autostart:*`

기존 명령도 아직 유지되고 있다.

- `report:generate`
- `report:snapshot:list`
- `report:snapshot:show`
- `report:scheduler`
- `serve`

즉, 현재 CLI는 완전히 agent-only로 정리된 상태는 아니고,
agent control plane과 legacy/manual execution path가 공존하는 상태다.

## 6. 단계별 구현 상태

### Phase 0. Active Plan 전환

상태: 완료

- active plan이 resident agent 전환을 기준으로 유지되고 있다.

### Phase 1. Agent Runtime 골격 추가

상태: 완료

- `agent:run`
- graceful shutdown
- pid lock
- heartbeat
- runtime state 저장

### Phase 2. Collector Orchestration 통합

상태: 완료

- ingest server가 agent lifecycle 안으로 들어왔다.
- collector supervision과 재시도 상태 기록이 구현되었다.
- macOS smoke test 기준 실제 동작 확인이 끝났다.

### Phase 3. Snapshot Scheduler 내장

상태: 완료

- agent 내부 scheduler가 day/week snapshot을 자동 생성한다.
- last run / last success / next run 상태를 기록한다.

### Phase 4. Control CLI 정리

상태: 완료

- agent status, health, latest snapshot, collector health 조회 명령이 추가되었다.
- 수동 refresh용 `agent:run-once`가 추가되었다.

### Phase 5. OS 자동 시작 전략

상태: 부분 완료

- macOS LaunchAgent helper 구현 완료
- macOS install/status/uninstall CLI 구현 완료
- Windows 자동 시작 전략은 아직 남아 있다.

## 7. 다음 실행 순서

이제 가장 합리적인 다음 작업 순서는 아래다.

1. Windows 자동 시작 경로 구현
2. legacy/manual runtime 명령 정리
   - `serve`
   - `report:scheduler`
   - 중복된 운영 경로 정리
3. runtime hardening
   - crash recovery
   - richer health diagnostics
   - log strategy
   - retry/backoff tuning
4. UI 연결
   - agent 상태 조회
   - latest snapshot 조회
   - collector/health 시각화

## 8. 의도적으로 미루는 항목

아래는 아직 다음 단계 이후로 미룬다.

- full desktop UI
- tray UI
- remote sync
- multi-user analytics
- cloud-managed agent
- diff report와 recommendation feed UI

## 9. 현재 결론

2026-03-14 기준 이 프로젝트는 더 이상 "CLI 명령 모음" 단계에만 머물러 있지 않다.
resident agent 전환의 핵심 축은 이미 구현되었다.

현재 상태를 한 줄로 요약하면 아래와 같다.

- resident local agent: 구현됨
- collector supervision: 구현됨
- snapshot scheduler: 구현됨
- control CLI: 구현됨
- macOS autostart: 구현됨
- Windows autostart: 미구현
- UI integration: 미구현

따라서 이제의 다음 단계는 "agent를 추가한다"가 아니라,
"구현된 agent를 운영 가능한 수준으로 다듬고 남은 플랫폼 공백을 메운다"다.
