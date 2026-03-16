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

## 2. 2026-03-15 기준 구현 상태

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

### 2.4 현재 산출물

현재 분석 산출물은 아래를 모두 포함한다.

- raw events
- normalized events
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

### 3.2 Feedback UX 리스크

- 현재 feedback flow는 CLI 중심이다
- 이후 UI가 붙으면 label/merge/split flow를 더 직관적으로 제공해야 한다

### 3.3 Debug surface 리스크

- 내부 전환 정보는 데이터 모델에 담겼지만, dedicated debug commands와 시각화는 더 보강 가능하다

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

### Phase 1. Rule coverage 확장

- normalization rules를 더 많은 internal admin 경로에 적용
- title-only desktop contexts에 대한 fallback 개선
- app alias 사전 확장

완료 기준:

- noisy titles와 URL variation이 더 적은 수의 stable page type으로 수렴한다

### Phase 2. Dedicated debug commands

- normalized event list/detail
- session boundary trace
- workflow cluster trace
- feedback application trace

완료 기준:

- 품질 문제를 CLI만으로 추적할 수 있다

### Phase 3. Feedback UI surface

- workflow label/purpose/candidate 입력 화면
- merge/split 보조 flow
- labeled/unlabeled 상태 강조

완료 기준:

- 비개발자도 feedback loop를 무리 없이 사용할 수 있다

### Phase 4. Runtime hardening

- Windows autostart 전략 구현 또는 문서화
- legacy/manual 명령의 역할 재정리
- richer diagnostics와 retry/backoff 정책 보강

완료 기준:

- agent 운영 경로가 더 명확해지고 플랫폼별 setup gap이 줄어든다

## 6. 의도적으로 뒤로 미루는 항목

- full desktop UI
- tray UI
- remote sync
- screenshot capture
- automation execution engine
- code generation integration

## 7. 추천 결론

현재 이 프로젝트의 기반 런타임은 이미 존재한다.
그래서 다음으로 가장 가치가 큰 일은 resident agent 자체를 또 확장하는 것보다,
그 위에서 **workflow interpretation quality** 와 **feedback usability** 를 더 끌어올리는 것이다.

가장 현실적인 다음 순서는 아래와 같다.

1. rule coverage 확장
2. debug surface 강화
3. feedback UI 개선
4. Windows/runtime hardening 정리
