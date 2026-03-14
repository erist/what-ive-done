# Implementation Plan

## 1. 목표

`README.md`와 `PRODUCT_REQUIREMENTS.md`를 기준으로 MVP를 다음 목표에 맞춰 구현한다.

- 로컬에서 Windows/Chrome 활동 메타데이터를 수집한다.
- 이벤트를 정규화하고 세션으로 묶는다.
- 반복 워크플로우를 탐지하고 자동화 후보를 식별한다.
- 요약 정보만 LLM에 전달해 사람이 읽을 수 있는 리포트를 생성한다.
- 민감 정보는 수집/저장/전송하지 않는다.

## 2. 현재 상태

- 저장소에는 제품 문서만 존재한다.
- 앱, 브라우저 익스텐션, 데이터베이스, 공통 모델, 테스트 스캐폴드가 아직 없다.
- 따라서 첫 구현은 "프로젝트 구조 정의 + 공통 데이터 계약 + 수집/분석 파이프라인의 최소 동작 버전"부터 시작해야 한다.

## 3. 구현 범위 분해

### 3.1 공통 도메인 모델

먼저 아래 데이터 계약을 고정한다.

- `RawEvent`
- `NormalizedEvent`
- `Session`
- `WorkflowCluster`
- `WorkflowFeedback`
- `ReportEntry`
- `LLMWorkflowSummaryPayload`

핵심 필드:

- 이벤트: `id`, `source`, `timestamp`, `application`, `windowTitle`, `domain`, `action`, `target`, `metadata`
- 세션: `id`, `startTime`, `endTime`, `primaryApplication`, `primaryDomain`, `steps`
- 클러스터: `id`, `name`, `sessionIds`, `frequency`, `averageDurationSeconds`, `totalDurationSeconds`, `representativeSteps`, `automationSuitability`, `recommendedApproach`, `excluded`

### 3.2 저장소와 보안

- SQLite 로컬 DB 초기화
- 마이그레이션 체계 도입
- 데이터 삭제 API
- 워크플로우 제외/이름 변경/세션 삭제 상태 저장
- 민감 데이터 필터링 레이어 추가
- LLM 자격증명은 OS secure storage 추상화로 분리

예상 테이블:

- `raw_events`
- `normalized_events`
- `sessions`
- `session_steps`
- `workflow_clusters`
- `workflow_cluster_sessions`
- `workflow_feedback`
- `analysis_runs`
- `settings`

### 3.3 수집 계층

Windows Desktop 쪽:

- 활성 앱/윈도우 변경 감지
- 마우스 클릭 메타데이터 수집
- 파일 작업 메타데이터 수집
- 클립보드 사용 이벤트 감지
- 수집 이벤트를 로컬 파이프라인으로 전달

Chrome Extension 쪽:

- 탭 변경/네비게이션 감지
- URL, title, domain 수집
- 클릭/폼 제출/다운로드/업로드 힌트 수집
- 데스크톱 앱으로 이벤트 전달

### 3.4 처리 파이프라인

1. Raw event 수신
2. 민감 정보 제거
3. Normalized event 변환
4. 세션화
5. 워크플로우 유사도 계산 및 클러스터링
6. 리포트 집계
7. LLM 요약 요청 생성

### 3.5 리포트 및 사용자 피드백

최소 UI/기능:

- Top repetitive workflows 목록
- 빈도/평균 시간/총 시간/자동화 적합도 표시
- 워크플로우 이름 변경
- 워크플로우 제외
- 세션 삭제
- 잘못된 클러스터 숨김
- 전체 데이터 삭제 / DB 리셋

## 4. 단계별 구현 순서

### Phase 0. 스캐폴드

- 프로젝트 루트 구조 생성
- 데스크톱 앱, 익스텐션, 공통 패키지, 테스트 디렉터리 분리
- 린트/포맷/기본 CI 설정

완료 기준:

- 빈 앱이 실행된다.
- 공통 타입 패키지가 각 앱에서 참조된다.

### Phase 1. 공통 모델 + SQLite

- 도메인 타입 정의
- SQLite 스키마 및 초기 마이그레이션 작성
- 로컬 저장소 접근 레이어 구현
- 샘플 이벤트 insert/read 검증

완료 기준:

- 샘플 raw event를 저장하고 조회할 수 있다.
- 민감 필드 차단 규칙이 테스트로 고정된다.

### Phase 2. 이벤트 수집 MVP

- Chrome extension 기본 manifest/background/content 구성
- 브라우저 이벤트 수집 및 데스크톱 앱 전송
- 데스크톱 앱의 raw event intake 구현
- Windows collector 인터페이스 정의

완료 기준:

- Chrome 이벤트가 로컬 DB에 적재된다.
- Windows collector는 최소 1개 이벤트 타입을 적재한다.

### Phase 3. 정규화 + 세션화

- raw-to-normalized 매핑 구현
- 기본 inactivity threshold 5분 적용
- 앱/도메인 변화 기반 세션 분리 규칙 구현
- 세션 step 저장 구조 추가

완료 기준:

- raw event 묶음이 normalized events와 sessions로 변환된다.
- representative session 예제가 테스트로 재현된다.

### Phase 4. 워크플로우 탐지

- 세션 유사도 계산
- 최소 3회/7일, 1분 이상 조건 적용
- 대표 step 생성
- 자동화 적합도 휴리스틱 구현

완료 기준:

- fixture 데이터에서 반복 워크플로우 클러스터가 생성된다.
- 각 클러스터에 빈도/시간/적합도/권장 접근법이 계산된다.

### Phase 5. 리포트 + 피드백

- 리포트 목록/상세 UI 구현
- 워크플로우 이름 변경, 제외, 숨김, 세션 삭제 구현
- 피드백 영속화

완료 기준:

- 사용자가 결과를 수정하면 로컬 DB에 반영되고 재시작 후 유지된다.

### Phase 6. LLM 해석 연동

- workflow summary payload 생성
- raw log 미전송 보장 레이어 추가
- LLM provider adapter 인터페이스 정의
- BYOK/OAuth 진입점과 secure storage 연결

완료 기준:

- 요약 payload만 외부 전송 경계에 도달한다.
- 평문 키 저장이 코드 레벨에서 금지된다.

## 5. 추천 아키텍처 원칙

- 수집, 저장, 분석, UI를 모듈로 분리한다.
- 원시 이벤트와 정규화 이벤트를 분리 저장해 디버깅 가능성을 확보한다.
- LLM은 선택 기능으로 분리하고, 핵심 분석은 로컬 휴리스틱으로 먼저 동작하게 한다.
- 민감 정보 필터링은 수집 직후와 DB insert 직전 두 번 적용한다.
- Windows 전용 기능은 인터페이스 뒤로 숨겨 개발 환경과 실행 환경을 분리한다.

## 6. 첫 구현 단위

기술 스택이 확정되면 가장 먼저 아래를 구현한다.

1. 프로젝트 스캐폴드
2. 공통 타입 정의
3. SQLite 초기 스키마
4. raw event intake
5. normalized event 변환기
6. 세션화 엔진 기본판

이 조합이 있어야 이후 Chrome extension, Windows collector, 리포트 UI를 병렬로 붙일 수 있다.

## 7. 미결정 사항

아래 항목은 실제 코드 구조와 런타임 선택에 직접 영향을 준다.

- 데스크톱 앱 기술 스택
- Windows 수집기 구현 언어/방식
- Chrome extension과 데스크톱 앱 간 IPC 방식
- 초기 LLM provider 우선순위

이 항목이 정해지면 바로 Phase 0부터 코드 생성과 구현을 시작한다.
