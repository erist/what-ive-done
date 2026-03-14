# Implementation Plan

## 1. 목표

Windows + Chrome 중심으로 잡혀 있던 MVP에 macOS 데스크톱 수집을 추가한다.

- macOS에서 직접 수집하고 분석 결과를 확인할 수 있어야 한다.
- 기존 로컬 저장, 분석, 리포트 파이프라인은 최대한 재사용한다.
- 민감 정보 비수집 원칙은 유지한다.
- macOS 추가 때문에 현재 Windows/Chrome 경로를 다시 설계하지 않는다.

## 2. 현재 코드베이스 기준 출발점

현재 저장소에는 이미 MVP의 핵심 골격이 구현되어 있다.

- `src/cli.ts`에 로컬 DB 초기화, 이벤트 import, 분석, 리포트, ingest server 실행 명령이 있다.
- `src/storage/`와 `src/pipeline/`에 SQLite 저장, 정규화, 세션화, 클러스터링 로직이 있다.
- `extension/chrome/`에는 로컬 ingest server로 브라우저 이벤트를 보내는 Chrome extension이 있다.
- `src/app-paths.ts`는 이미 Windows와 macOS 기본 데이터 경로를 모두 처리한다.
- 현재 라이브 데스크톱 수집기는 Windows 전용이다.
  - 메타데이터 등록: `src/collectors/windows.ts`
  - 실제 수집 스크립트: `collectors/windows/active-window-collector.ps1`
- 현재 Windows 라이브 수집기의 실제 범위도 "활성 앱/윈도우 변경 감지"가 중심이다.

결론적으로 macOS 지원은 새로운 분석 시스템을 만드는 작업이 아니라, 기존 파이프라인에 연결되는 macOS collector를 추가하는 작업으로 보는 것이 맞다.

## 3. macOS MVP 범위 정의

### 3.1 이번 구현에 포함할 범위

첫 macOS 지원은 아래 신호만 안정적으로 들어오면 충분하다.

- 활성 애플리케이션 이름
- 포커스된 윈도우 타이틀
- 앱 또는 윈도우 전환 이벤트
- 이벤트 timestamp
- collector 식별용 메타데이터
  - 예: `platform`, `collector`, `bundleId`, `processId`

수집 결과는 현재 Windows collector와 동일하게 아래 두 경로 중 하나로 흘러가야 한다.

- NDJSON 파일로 기록
- 로컬 ingest server로 HTTP POST

### 3.2 이번 구현에서 의도적으로 제외할 범위

아래 항목은 macOS 첫 지원 범위에서 제외하는 것이 현실적이다.

- 전역 마우스 클릭 메타데이터
- 클립보드 사용 이벤트
- 파일 열기/저장/삭제 메타데이터
- 앱 배포용 정식 패키징, 서명, notarization

이 범위를 제외하는 이유는 현재 Windows 라이브 collector도 아직 활성 윈도우 변경 중심이기 때문이다. macOS에서는 우선 "내가 직접 써볼 수 있는 수준"의 baseline을 맞추는 편이 타당하다.

## 4. 기술적 고려사항

### 4.1 macOS 권한 모델

macOS에서 다른 앱의 활성 상태나 포커스된 윈도우 정보를 읽으려면 접근성(Accessibility) 권한이 핵심이다.

- collector는 접근성 권한이 없을 때 명확하게 실패해야 한다.
- 권한이 없으면 가능한 범위까지만 수집하거나, 최소한 사용자에게 설정 경로를 안내해야 한다.
- 일부 앱은 권한이 있어도 윈도우 타이틀을 비우거나 제한할 수 있으므로 `windowTitle`은 optional로 취급해야 한다.

권장 원칙:

- v1에서 Screen Recording 권한을 필수 조건으로 만들지 않는다.
- 윈도우 타이틀을 못 읽는 경우에도 `application` 기반의 `app.switch` 이벤트는 계속 적재할 수 있게 설계한다.

### 4.2 Collector 구현 방식 선택

후보는 크게 세 가지다.

1. AppleScript/JXA 스파이크
2. Swift CLI collector
3. Node.js에서 macOS 명령을 래핑하는 방식

권장안은 `Swift CLI collector`다.

- macOS 네이티브 API 접근성이 가장 좋다.
- 장시간 실행되는 polling 프로세스로 쓰기에 안정적이다.
- structured JSON 출력과 permission handling이 수월하다.
- 이후 앱 번들/서명 단계로 확장하기 쉽다.

AppleScript/JXA는 초기 검증에는 빠르지만, 장기적으로는 이벤트 구조화와 예외 처리 면에서 brittle할 가능성이 높다.

### 4.3 현재 데이터 계약과의 호환성

macOS 지원을 위해 `RawEvent` 스키마를 새로 바꿀 필요는 없다.

권장 매핑:

- `source`: `desktop`
- `sourceEventType`: `app.switch`
- `action`: `switch`
- `application`: canonicalized app name
- `windowTitle`: 읽을 수 있을 때만 채움
- `metadata.platform`: `macos`
- `metadata.collector`: `macos-active-window`
- `metadata.bundleId`, `metadata.processId`: 가능하면 포함

추가 고려:

- macOS에서는 `"Google Chrome"`처럼 표시되고 Windows에서는 `"chrome"`처럼 들어올 수 있다.
- 클러스터 품질을 유지하려면 앱 이름 canonicalization 규칙이 필요할 수 있다.

### 4.4 런타임 통합 포인트

기존 코드에서 재사용 가능한 부분과 수정이 필요한 부분은 명확하다.

재사용 가능:

- `src/server/ingest-server.ts`
- `src/server/ingest.ts`
- `src/storage/`
- `src/pipeline/`
- `extension/chrome/`

수정 필요:

- `src/collectors/windows.ts`처럼 Windows 전용으로 묶인 collector registry
- `src/cli.ts`의 Windows 전용 collector info 명령
- fixtures 및 테스트 세트
- 문서와 quickstart 흐름

즉, 분석 엔진보다 collector 등록/진단/문서화 쪽 변경이 먼저다.

### 4.5 사용자 실행 흐름

macOS에서도 브라우저 경로는 기존과 동일해야 한다.

1. 로컬 ingest server 실행
2. Chrome extension가 localhost endpoint로 이벤트 전송
3. macOS desktop collector가 같은 ingest server 또는 NDJSON 파일로 이벤트 전송
4. `analyze`와 `report`로 결과 확인

이 흐름을 유지하면 브라우저 수집과 데스크톱 수집을 별도 IPC로 다시 설계할 필요가 없다.

### 4.6 테스트 및 검증

자동 테스트와 수동 검증을 분리해서 봐야 한다.

자동 테스트:

- macOS fixture import 테스트
- macOS fixture 기반 analyze 결과 테스트
- collector metadata coercion 테스트

수동 검증:

- 접근성 권한이 없는 상태에서의 실패 메시지
- 접근성 권한 허용 후 앱 전환 이벤트 발생
- Chrome + macOS app을 섞어서 세션이 정상 생성되는지 확인
- window title이 없는 앱에서도 파이프라인이 깨지지 않는지 확인

## 5. 단계별 구현 계획

### Phase 0. 문서 기준선 정리

- `docs/product/requirements.md`에서 macOS를 post-MVP가 아니라 MVP 범위로 반영한다.
- 구현 범위를 "macOS active-window collector + 기존 Chrome extension 재사용"으로 명시한다.

완료 기준:

- 문서끼리 macOS 범위가 서로 충돌하지 않는다.

### Phase 1. Collector 추상화 정리

- collector registry를 Windows 전용 파일에서 공통 엔트리로 분리한다.
- macOS collector metadata를 등록할 수 있는 구조로 바꾼다.
- CLI에 macOS collector 안내 명령을 추가한다.

예상 결과:

- `collector:list`에 Windows와 macOS가 함께 표시된다.
- `collector:macos:info` 같은 형태로 실행 예시를 안내할 수 있다.

### Phase 2. macOS Active Window Collector 구현

- `collectors/macos/active-window-collector.swift`를 추가한다.
- frontmost app, focused window title, bundle id, process id를 읽는다.
- fingerprint가 바뀔 때만 이벤트를 발행한다.
- Windows collector와 동일하게 NDJSON/HTTP POST 두 모드를 지원한다.

완료 기준:

- macOS에서 collector 단독 실행 시 JSON 이벤트가 안정적으로 나온다.
- ingest server에 POST하면 raw events가 DB에 적재된다.

### Phase 3. 권한 진단과 graceful degradation

- 접근성 권한 상태를 확인하는 진단 경로를 추가한다.
- 권한이 없을 때 실행 방법과 설정 위치를 명확히 출력한다.
- window title을 읽지 못해도 app-level 이벤트는 가능한 한 유지한다.

완료 기준:

- 사용자가 실패 원인을 CLI 출력만 보고 이해할 수 있다.
- permission denied가 파이프라인 전체 장애로 번지지 않는다.

### Phase 4. Fixture와 분석 경로 보강

- `fixtures/macos-active-window-sample.ndjson`를 추가한다.
- import, normalize, analyze 테스트를 macOS fixture까지 확장한다.
- 필요하면 앱 이름 canonicalization 규칙을 추가한다.

완료 기준:

- macOS fixture를 넣었을 때 분석 파이프라인이 재현 가능하게 동작한다.
- 테스트가 macOS collector의 event contract를 고정한다.

### Phase 5. 문서와 로컬 테스트 플로우 정리

- macOS용 quickstart를 추가한다.
- 권한 허용 절차, collector 실행 방법, extension 설정 방법을 문서화한다.
- "macOS 한 대로 end-to-end 테스트하는 순서"를 정리한다.

완료 기준:

- 새 환경에서도 문서만 보고 직접 실행해볼 수 있다.

## 6. 권장 구현 순서

실제 작업 순서는 아래가 가장 안전하다.

1. collector registry/CLI 구조 정리
2. macOS fixture와 event contract 초안 확정
3. Swift collector 구현
4. 권한 진단 추가
5. 테스트 보강
6. quickstart 및 운영 문서 갱신

이 순서가 좋은 이유는 collector 출력 계약을 먼저 고정해야 파이프라인과 테스트를 안정적으로 붙일 수 있기 때문이다.

## 7. 미결정 사항

아래 항목은 구현 전에 한 번 더 결정해야 한다.

- macOS collector를 처음부터 Swift로 갈지, AppleScript 스파이크를 먼저 둘지
- window title을 못 읽는 앱 비중이 높을 때도 MVP로 수용할지
- macOS app name canonicalization을 간단한 매핑 테이블로 둘지, bundle id 중심으로 갈지
- 내부 배포 전에 서명/notarization이 필요한지, 아니면 로컬 수동 실행으로 충분한지

## 8. 추천 결론

현재 코드베이스 기준으로 가장 현실적인 macOS MVP는 다음과 같다.

- Chrome extension은 그대로 유지한다.
- 데스크톱 수집은 macOS active-window collector 하나만 먼저 추가한다.
- 권한과 진단 UX를 collector 자체의 핵심 기능으로 본다.
- 클릭/클립보드/파일 이벤트는 후속 단계로 미룬다.

이 접근이 가장 작은 변경으로 "macOS에서 직접 테스트하고 써볼 수 있는 상태"를 빠르게 만든다.
