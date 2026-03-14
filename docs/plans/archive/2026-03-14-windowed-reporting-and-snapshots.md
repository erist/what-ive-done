# Implementation Plan

## 1. 목표

기존의 "1-2주 데이터를 모은 뒤 반복 업무 패턴을 파악한다"는 방향은 유지한다.
다만 그 전에도 사용자가 바로 가치를 느낄 수 있도록 daily report와 weekly report를
MVP 산출물로 추가한다.

이번 active plan의 핵심은 새 collector를 더 붙이는 것이 아니라, 이미 구현된 수집/분석
파이프라인 위에 시간 구간 기반 리포팅 계층을 올리는 것이다.

- 장기 분석: 1-2주 누적 데이터를 기준으로 confirmed workflow를 찾는다.
- 단기 리포트: 하루, 최근 7일 기준으로 업무 흐름과 시간 사용을 요약한다.
- privacy, local-first, 민감 정보 비수집 원칙은 그대로 유지한다.

## 2. 현재 구현 상태

2026-03-14 기준으로 코드베이스에는 아래 항목이 이미 구현되어 있다.

### 2.1 구현 완료

- 로컬 CLI 진입점과 SQLite 초기화
- raw event import와 local ingest server
- Windows active-window collector 안내 경로
- macOS active-window collector, 권한 체크, one-shot capture
- raw event 정규화, 세션화, workflow clustering
- 누적 데이터 기준의 on-demand `report`
- workflow rename, exclude, hide, session delete 같은 feedback 기능
- LLM-safe payload export와 OpenAI 기반 workflow analysis
- macOS Keychain 기반 OpenAI API key 저장

### 2.2 검증 상태

2026-03-14에 아래 검증을 다시 실행했다.

- `npm test`: 통과, 21개 테스트 성공
- `npm run typecheck`: 통과
- `npm run build`: 통과
- `npm run dev -- demo --data-dir ./tmp/report-check --json`: 통과

즉, 현재 MVP 골격은 "수집 -> 저장 -> 분석 -> 누적 리포트"까지는 안정적으로 돌아간다.

### 2.3 새 방향과의 갭

현재 리포팅 계층은 아래 제약이 있다.

- `report`는 전체 누적 workflow cluster만 보여준다.
- 날짜 구간을 지정해 raw events나 sessions를 다시 분석하는 경로가 없다.
- daily report가 유용하려면 필요한 emerging workflow 개념이 없다.
- weekly report를 위한 기간 메타데이터, 비교 기준, summary model이 없다.
- report 테스트도 전부 누적 결과 중심이라 기간 기반 회귀를 막아주지 못한다.

정리하면, 수집과 핵심 분석은 이미 있고, 부족한 것은 "시간 구간별 해석과 출력"이다.

## 3. 제품 결정 사항

문서 기준으로 이번에 확정할 리포트 동작은 아래와 같다.

- all-time report: 현재와 같이 전체 로컬 데이터셋 기준
- daily report: 로컬 타임존 기준 하루
- weekly report: 선택한 로컬 기준일을 끝점으로 하는 최근 7일
- short-horizon report에서는 confirmed workflow가 부족해도 emerging workflow를 보여줄 수 있음

중요한 구분:

- confirmed workflow: 기존 클러스터 기준을 만족한 반복 업무
- emerging workflow: 빈도나 기간이 아직 부족하지만 단기 리포트에서 눈에 띄는 반복 패턴

이 구분이 있어야 daily report가 초반 며칠 동안 비어 있지 않다.

## 4. 구현 원칙

### 4.1 분석 엔진은 최대한 재사용

새로운 리포트 방향 때문에 정규화, 세션화, 클러스터링 파이프라인을 다시 쓰지 않는다.

우선 접근은 아래가 가장 작다.

1. 리포트용 기간을 계산한다.
2. 해당 기간의 raw events만 읽는다.
3. 기존 `analyzeRawEvents`를 기간 데이터에 다시 적용한다.
4. 결과를 daily/weekly/all-time report model로 가공한다.

이 방식이면 schema를 크게 바꾸지 않고도 새 리포트를 붙일 수 있다.

### 4.2 기간 계산은 local-first로 정의

기간 계산은 사용자의 로컬 타임존을 기준으로 해야 한다.

- daily: 로컬 날짜의 00:00:00 ~ 23:59:59
- weekly: 선택일 포함 최근 7일

테스트와 자동화 재현성을 위해 내부 함수는 명시적 time zone 또는 기준 시각 주입을 받을 수 있게 설계하는 편이 안전하다.

### 4.3 리포트 모델은 confirmed와 emerging을 함께 담아야 함

기존 `ReportEntry`만으로는 부족하다.

추가가 필요한 정보:

- report window start/end
- report timezone
- total sessions
- total tracked duration
- confirmed workflows
- emerging workflows
- top applications or domains 같은 보조 summary

즉, 단순한 workflow row 배열이 아니라 report envelope가 필요하다.

### 4.4 초기 범위에서는 스냅샷 저장을 미룸

v1은 on-demand generation으로 충분하다.

- 먼저 CLI에서 daily/weekly report를 바로 만들 수 있게 한다.
- 실제 사용성이 확인되면 report snapshot 저장, 전주 대비 비교, scheduled generation을 후속으로 검토한다.

## 5. 단계별 구현 계획

### Phase 0. 리포트 계약 확정

- `docs/product/requirements.md`에 daily/weekly report 요구를 반영한다.
- active plan을 현 상태 기준으로 다시 작성한다.
- daily와 weekly의 기간 정의를 코드 계약으로 고정한다.

완료 기준:

- 제품 문서와 실행 계획이 현재 코드 상태와 충돌하지 않는다.

### Phase 1. 기간 기반 데이터 조회 추가

- `AppDatabase`에 기간 기준 raw event 조회 함수를 추가한다.
- 필요하면 session summary 조회도 기간 옵션을 받을 수 있게 확장한다.
- 보고서용 기간 계산 유틸리티를 분리한다.

완료 기준:

- 특정 날짜 기준 day/week/all-time raw events를 안정적으로 뽑을 수 있다.

### Phase 2. 기간 기반 report model 추가

- `src/reporting/`에 daily/weekly/all-time report builder를 추가한다.
- 기존 `ReportEntry` 중심 출력에서 report envelope를 만드는 방향으로 확장한다.
- confirmed workflow와 emerging workflow를 구분하는 출력 구조를 만든다.

완료 기준:

- JSON 기준으로 리포트 창, 요약 수치, workflow 목록이 함께 나온다.

### Phase 3. CLI 확장

- 기존 `report` 명령에 `--window all|day|week` 옵션을 추가한다.
- `--date YYYY-MM-DD`를 지원해서 특정 기준일의 daily/weekly report를 재생성할 수 있게 한다.
- 기본값은 기존 호환성을 위해 `all`을 유지한다.

완료 기준:

- `report --window day`
- `report --window week`
- `report --window all`
  가 모두 동작하고 JSON/table 출력이 깨지지 않는다.

### Phase 4. Emerging workflow 휴리스틱 추가

- confirmed cluster 기준을 완화하지 않고 short-horizon summary를 별도로 만든다.
- 예: 같은 날 2회 반복, 짧아도 누적 시간이 큰 흐름, 동일 앱/도메인 반복 등
- provisional label을 명시해서 confirmed와 혼동되지 않게 한다.

완료 기준:

- 하루치 데이터만 있어도 비어 있지 않은 report를 낼 수 있다.
- 장기 automation candidate와 임시 패턴이 출력에서 명확히 분리된다.

### Phase 5. 테스트와 문서 보강

- 기간 계산 테스트
- 기간 기반 analyze/report 테스트
- CLI JSON snapshot 성격의 테스트
- README와 quickstart를 새 리포트 기준으로 갱신

완료 기준:

- 날짜 경계, time zone, emerging workflow 회귀를 테스트가 잡아준다.

## 6. 권장 구현 순서

실제 작업 순서는 아래가 가장 안전하다.

1. 기간 정의와 DB query contract 고정
2. report model 설계
3. CLI 옵션 추가
4. emerging workflow heuristic 추가
5. 테스트 보강
6. quickstart/README 업데이트

이 순서가 좋은 이유는 출력 계약을 먼저 고정해야 CLI와 테스트가 흔들리지 않기 때문이다.

## 7. 이번 계획에서 의도적으로 미루는 항목

아래는 바로 붙일 수 있지만, 지금 단계에서는 우선순위를 낮춘다.

- 자동 스케줄 실행
- 이메일이나 Slack 같은 외부 전달 채널
- 전주 대비 diff report
- LLM이 prose 형태로 daily/weekly report를 다시 써주는 기능
- report snapshot 영구 저장

이 항목들은 daily/weekly report의 기본 사용성이 확인된 뒤에도 늦지 않다.

## 8. 추천 결론

현재 프로젝트는 "리포트를 만들 수 있는가" 단계는 이미 지났다.
문제는 "리포트를 어느 시간 단위로, 어떤 해석 층까지 보여줄 것인가"다.

가장 현실적인 다음 단계는 아래와 같다.

- 기존 누적 report는 유지한다.
- 같은 분석 엔진 위에 daily/weekly window를 올린다.
- short-horizon usefulness를 위해 emerging workflow를 별도 층으로 도입한다.
- 자동 배포나 전달보다 먼저, 로컬에서 재현 가능한 기간 기반 report를 완성한다.

이 방향이 가장 작은 변경으로 사용자가 하루 단위와 주간 단위 인사이트를 바로 얻도록 만든다.
