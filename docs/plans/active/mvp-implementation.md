# Implementation Plan

## 1. 목표

현재 MVP의 핵심 과제는 런타임 구조 자체보다, **raw activity -> meaningful workflow**
해석 품질을 실제 사용 환경에서 높이는 것이다.

이번 활성 계획의 중심은 아래 파이프라인이다.

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
- Windows/macOS active-window collector 경로
- Chrome extension ingest 경로
- all-time/day/week report와 snapshot 저장
- workflow feedback, session delete, LLM-safe payload export, OpenAI 분석

### 2.2 이번 단계에서 완료된 핵심 품질 개선

- 안정적인 normalized context 필드 추가
- semantic action abstraction 추가
- explainable session boundary reason 저장
- near-match workflow mining과 variant/confidence 계산 추가
- workflow signature 기반 feedback 재사용 추가
- workflow-centric summary/report/graph 출력 추가
- practical automation hints 추가

### 2.3 현재 파이프라인 결과물

현재 분석 산출물은 아래 단계를 모두 포함한다.

- raw events
- normalized events
- semantic actions
- sessions with boundary reasons
- workflow clusters with representative sequence, variants, confidence, involved apps
- reusable workflow feedback
- workflow-centric reports with summary sections
- automation hints

## 3. 현재 남아 있는 핵심 리스크

이번 개선으로 기본 구조는 갖춰졌지만, 실제 운영 품질을 위해 아래 항목이 남아 있다.

### 3.1 Rule coverage 리스크

- admin/product/order/refund 외 도메인 규칙이 아직 충분히 넓지 않다
- 브라우저가 아닌 desktop-only context의 title-based normalization 품질은 더 튜닝이 필요하다

### 3.2 Feedback UX 리스크

- 현재 feedback flow는 CLI 중심이다
- 이후 UI가 붙으면 label/merge/split flow를 더 직관적으로 제공해야 한다

### 3.3 Debug surface 리스크

- 내부 전환 정보는 데이터 모델에 담겼지만, dedicated debug commands와 시각화는 더 보강 가능하다

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

### 4.3 UI는 data contract 위에 붙인다

현재 CLI가 이미 rich JSON과 report summary를 제공하므로,
향후 UI는 이 구조를 재사용하는 방향이 가장 안전하다.

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

### Phase 4. Runtime orchestration revisited

- resident agent 또는 scheduler ownership 재검토
- collector orchestration과 snapshot refresh를 하나의 runtime으로 묶을지 재판단

완료 기준:

- 품질 파이프라인이 충분히 안정된 뒤 런타임 투자 우선순위를 다시 평가한다

## 6. 의도적으로 뒤로 미루는 항목

- full desktop UI
- tray UI
- remote sync
- screenshot capture
- automation execution engine
- code generation integration

## 7. 추천 결론

지금 이 프로젝트의 병목은 단순 기능 부족이 아니라 **workflow interpretation quality**였다.
이번 단계로 해석 파이프라인의 기본 품질 레이어는 들어갔다.

다음으로 가장 가치가 큰 일은:

1. rule coverage 확장
2. debug surface 강화
3. feedback UX 개선

그 다음에야 resident agent나 richer UI 투자 우선순위를 다시 잡는 것이 안전하다.
