# Implementation Plan

## 1. 목표

현재 MVP의 다음 병목은 "에이전트를 도입할 것인가"가 아니라,
이미 도입된 runtime 위에서 **workflow interpretation quality** 를 얼마나 높일 수 있는가다.

현재 구현은 resident local agent와 CLI control plane을 이미 갖고 있다.
그래서 활성 계획의 중심은 아래 두 축을 함께 안정화하는 것이다.

1. resident agent runtime 운영 안정성
2. raw activity -> meaningful workflow 해석 품질

이번 기준 파이프라인은 다음과 같다.

1. event normalization
2. action abstraction
3. session segmentation
4. workflow pattern mining
5. human feedback reuse
6. workflow-centric reporting
7. automation hints

## 2. 2026-03-17 기준 구현 상태

### 2.1 완료된 기반

- 로컬 CLI 진입점과 SQLite 초기화
- raw event import와 local ingest server
- Windows/macOS active-window collector 경로
- Chrome extension ingest 경로
- day/week report snapshot 저장
- workflow feedback, session delete, LLM-safe payload export, OpenAI 분석
- macOS Keychain 기반 OpenAI API key 저장

### 2.2 완료된 runtime 레이어

- resident local agent runtime
- pid/lock 기반 단일 실행 제어
- heartbeat와 persisted runtime state
- agent-managed ingest server lifecycle
- collector supervision과 collector health 노출
- agent-managed snapshot scheduler
- control-plane CLI
  - `agent:run`
  - `agent:status`
  - `agent:stop`
  - `agent:health`
  - `agent:run-once`
  - `agent:snapshot:latest`
  - `agent:collectors`
- macOS LaunchAgent autostart helper

### 2.3 완료된 workflow 해석 품질 개선

- 안정적인 normalized context 필드 추가
- semantic action abstraction 추가
- explainable session boundary reason 저장
- near-match workflow mining과 variant/confidence 계산 추가
- workflow signature 기반 feedback 재사용 추가
- workflow-centric summary/report/graph 출력 추가
- practical automation hints 추가

### 2.4 완료된 browser contract 안정화(M1)

- browser schema v2 필드 추가
  - `browserSchemaVersion`
  - `canonicalUrl`
  - `routeTemplate`
  - `routeKey`
  - `resourceHash`
- shared browser canonicalization 경로 추가
  - query string default-drop + allowlist 정책
  - `scheme + host + path[0:2]` canonical URL 도출
  - ID/UUID/long hex segment normalization
- Chrome extension -> ingest -> raw storage -> normalize 경로 전체에 v2 contract 연결
- schema v11 additive migration 추가
  - `raw_events`, `normalized_events` 에 browser v2 컬럼 추가
  - 기존 stored browser URL 재정리로 privacy-safe canonical field 재계산
- browser fixture와 privacy/migration regression test 추가
  - browser schema v2 fixture import
  - query allowlist/drop 검증
  - canonical convergence 검증
  - schema v10 -> v11 upgrade 검증

### 2.5 현재 산출물

현재 분석 산출물은 아래를 모두 포함한다.

- raw events
- normalized events
- privacy-safe browser canonical signals
- semantic actions
- sessions with boundary reasons
- workflow clusters with representative sequence, variants, confidence, involved apps
- reusable workflow feedback
- workflow-centric reports with summary sections
- automation hints

## 3. 현재 남아 있는 핵심 리스크

### 3.1 Rule coverage 리스크

- admin/product/order/refund 외 도메인 규칙이 아직 충분히 넓지 않다
- 브라우저가 아닌 desktop-only context의 title-based normalization 품질은 더 튜닝이 필요하다
- browser query allowlist는 최소 안전 집합만 열어 둔 상태라, 도메인별 세밀한 filter 보존 정책은 후속 확장이 필요하다

### 3.2 Feedback UX 리스크

- 현재 feedback flow는 CLI 중심이다
- 이후 UI가 붙으면 label/merge/split flow를 더 직관적으로 제공해야 한다

### 3.3 Debug surface 리스크

- 내부 전환 정보는 데이터 모델에 담겼지만, dedicated debug commands와 시각화는 더 보강 가능하다
- browser canonicalization 결과를 raw -> normalized -> action 체인으로 바로 추적하는 trace surface는 아직 부족하다

### 3.4 Runtime 운영 리스크

- Windows autostart 설치 흐름은 아직 없다
- legacy/manual 경로인 `serve`, `report:scheduler` 가 agent 경로와 공존한다
- richer diagnostics, retry policy, crash recovery는 더 보강 가능하다

## 4. 다음 단계 구현 원칙

### 4.1 품질 튜닝 우선

다음 단계는 새로운 collector보다 **해석 품질 튜닝**을 우선한다.

- normalization rule 확장
- action rule precision 조정
- session threshold tuning
- clustering threshold tuning

### 4.2 Feedback를 해석 루프에 계속 연결

feedback는 저장만 하는 기능이 아니라 해석을 바꾸는 입력이어야 한다.

- rename/purpose는 report에 반영
- merge/split는 다음 분석에 반영
- ignore/exclude는 reporting에 반영
- approved candidate는 automation review 우선순위에 반영

### 4.3 Agent를 제어면으로 활용

UI가 붙기 전까지는 CLI가 control surface 역할을 맡는다.
추가 기능은 가능하면 agent와 공통 상태 모델을 재사용하는 방향이 안전하다.

## 5. 권장 후속 작업

### Phase 1. Golden Fixtures + Debug Trace + Ingest Hardening(M2)

- browser 대표 route family fixture 고정
- raw -> normalized -> action -> session -> cluster trace CLI 추가
- browser ingest localhost-only/auth/rate limit hardening

완료 기준:

- 오탐 또는 누락 한 건을 5분 안에 trace 명령으로 설명할 수 있다
- browser fixture가 M1 canonical contract를 기준으로 regression gate 역할을 한다
- ingest server가 최소 보호 장치 없이 열리지 않는다

### Phase 2. Chrome Context Expansion(M3)

- dwell, tab order, SPA route taxonomy, document hash 수집
- 새 browser context field의 privacy-safe storage 경로 확장

완료 기준:

- route family 해석 전 단계에서 더 풍부한 browser context substrate가 확보된다

### Phase 3. Domain Pack + Semantic Action Coverage(M4-M5)

- domain pack registry와 초기 pack 구현
- semantic action pack과 `unknown_action` coverage 운영 경로 추가

완료 기준:

- 같은 도메인 안에서도 주요 workflow가 route family와 semantic action 수준으로 읽힌다

### Phase 4. Feedback UI + Runtime Hardening(M8, M10 일부)

- workflow feedback UI surface 추가
- Windows/runtime 운영 gap과 diagnostics 보강

완료 기준:

- 비개발자도 feedback loop를 사용할 수 있고, agent 운영 경로가 더 명확해진다

## 6. 의도적으로 뒤로 미루는 항목

- full desktop UI
- tray UI
- remote sync
- screenshot capture
- automation execution engine
- code generation integration

## 7. 추천 결론

현재 이 프로젝트는 resident agent runtime과 workflow analysis baseline 위에,
M1 browser contract를 통해 privacy-safe canonical browser signal까지 확보했다.
그래서 다음으로 가장 가치가 큰 일은 collector 자체를 더 늘리기보다,
이 고정된 contract를 기준으로 **fixture/debug/hardening** 을 먼저 잠그는 것이다.

가장 현실적인 다음 순서는 아래와 같다.

1. M2 fixture/debug/hardening 완료
2. M3 browser context expansion
3. M4-M5 domain/action coverage 확장
4. feedback UI와 runtime hardening 정리
