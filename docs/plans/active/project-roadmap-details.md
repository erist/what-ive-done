# Project Roadmap Details

이 문서는 `docs/plans/active/project-roadmap-overview.md`의 실행 상세 문서다.
각 마일스톤은 하나의 worktree에서 끝낼 수 있는 범위로 잡았고, 다음 단계에 넘길 입력과 완료 게이트를 함께 정의한다.

## 공통 정의

- 권장 기간: 1인 전담 기준의 대략치
- worktree 닫힘 조건: 코드, 검증, 운영 문서가 모두 준비된 상태
- 기본 branch/worktree prefix: `codex/`
- 공통 비범위
  - 원격 저장소 도입
  - 자동화 실행 엔진 도입
  - 스크린샷/콘텐츠 수집
  - hot path LLM 분류

## M1. Browser Schema v2 + Privacy Canonicalization

- 권장 branch: `codex/m1-browser-schema-v2`
- 권장 기간: 3-5일
- 상태
  - 완료(2026-03-17)
- 목표
  - 브라우저 이벤트를 downstream rule engine이 안정적으로 사용할 수 있는 canonical signal로 고정한다.
- 범위
  - canonical URL, route template, resource hash 도출 규칙 추가
  - query string allowlist/drop 정책 구현
  - `scheme + host + path[0:2]` 수준의 privacy-safe canonicalization 규칙 정의
  - additive schema migration 또는 versioned read path 설계
- 제외 범위
  - domain pack 매칭
  - semantic action rule 확장
  - feedback UI
- 선행 조건
  - 없음
- 산출물
  - schema v2 필드 정의
  - migration 또는 compatibility 전략
  - privacy regression test 케이스
- 구현 메모
  - shared browser canonicalization 모듈을 추가해 query string default-drop + allowlist 정책을 공통 적용했다.
  - Chrome extension, ingest, raw storage, normalize 경로 전체에 `browserSchemaVersion`, `canonicalUrl`, `routeTemplate`, `routeKey`, `resourceHash` 를 연결했다.
  - schema v11 additive migration으로 `raw_events`, `normalized_events` 에 browser v2 컬럼을 추가했고, 기존 stored browser URL을 privacy-safe 값으로 재정리했다.
  - browser schema v2 fixture와 privacy/canonical convergence/migration regression test를 추가해 M2 fixture contract의 baseline을 고정했다.
- 완료 기준
  - 같은 route family의 URL variation이 같은 canonical 결과로 수렴한다.
  - 검색어, 토큰, 세션성 파라미터가 저장되지 않는다.
  - 기존 분석 경로가 migration 이후에도 깨지지 않는다.
- 다음 단계로 넘길 입력
  - fixture가 사용할 안정적인 browser event contract

## M2. Golden Fixtures + Debug Trace + Ingest Hardening

- 권장 branch: `codex/m2-quality-trace-foundation`
- 권장 기간: 4-6일
- 목표
  - 품질 이슈를 재현, 추적, 설명할 수 있는 측정 기반을 만든다.
- 범위
  - 대표 workflow 5-10개 fixture 고정
  - raw -> normalized -> action -> session -> cluster trace CLI 추가
  - verbose/debug logging 모드 추가
  - ingest server localhost-only binding 강제
  - 최소 auth token과 rate limiting 추가
- 제외 범위
  - browser context 확장
  - domain pack 추가
- 선행 조건
  - M1
- 산출물
  - fixture dataset
  - trace/debug command
  - ingest hardening 설정 및 진단 포인트
- 완료 기준
  - 오탐 또는 누락 한 건을 5분 안에 trace 명령으로 설명할 수 있다.
  - browser ingest가 localhost-only와 auth token 없이 열리지 않는다.
  - rate limit이 비정상 burst를 제어한다.
- 다음 단계로 넘길 입력
  - M3-M7이 계속 재사용할 golden fixture와 regression gate

## M3. Chrome Context Expansion

- 권장 branch: `codex/m3-chrome-context-expansion`
- 권장 기간: 4-6일
- 목표
  - Chrome extension을 route-level workflow interpreter의 핵심 collector로 승격한다.
- 범위
  - dwell segment 수집
  - 탭 전환 순서 메타데이터 수집
  - SPA route taxonomy 수집
  - document-type hash 수집
  - 새 필드의 privacy-safe ingest/storage 경로 반영
- 제외 범위
  - domain별 route family 해석
  - semantic action 이름 부여
- 선행 조건
  - M1, M2
- 산출물
  - 확장된 browser payload contract
  - collector-to-ingest regression test
  - privacy review note
- 완료 기준
  - 브라우저 이벤트에 dwell, tab order, route taxonomy, document hash가 안정적으로 들어온다.
  - 수집된 추가 필드가 raw content를 저장하지 않는다.
  - M4가 route family 해석을 붙일 수 있을 정도로 문맥 신호가 확보된다.
- 다음 단계로 넘길 입력
  - domain pack이 소비할 browser context substrate

## M4. Domain Pack Platform + Initial Packs

- 권장 branch: `codex/m4-domain-pack-platform`
- 권장 기간: 5-7일
- 목표
  - 같은 Chrome 안에서 업무 맥락을 route family 단위로 분리할 수 있게 만든다.
- 범위
  - versioned domain pack registry와 pack contract 설계
  - `domain-pack:test` 계열 검증 경로 추가
  - 초기 pack 구현
  - 우선순위 제안: `makestar-admin`, `google-sheets`, `google-docs`, `bigquery-console`
  - unmatched rate를 볼 수 있는 최소 진단 리포트 추가
- 제외 범위
  - semantic action rule
  - long-tail domain pack 확장
- 선행 조건
  - M3
- 산출물
  - domain pack loader/test harness
  - 초기 pack fixture
  - unmatched rate 진단 출력
- 완료 기준
  - 동일 도메인 안에서도 주요 workflow가 다른 route family로 분리된다.
  - fixture 기준 route family 분리 정확도가 90% 이상이다.
  - pack 변경이 core normalization 코드를 직접 수정하지 않고도 가능하다.
- 다음 단계로 넘길 입력
  - semantic action engine이 참조할 route family layer

## M5. Semantic Action Packs + Coverage Ops

- 권장 branch: `codex/m5-semantic-action-coverage`
- 권장 기간: 5-7일
- 목표
  - 반복 workflow가 사람이 읽을 수 있는 action sequence로 보이게 만든다.
- 범위
  - 우선순위가 있는 rule engine 정리
  - `domain pack -> page_type -> generic fallback` 매칭 체계 구현
  - 초기 action pack 구현
  - 우선순위 제안: `makestar-admin`, `google-sheets`, `bigquery`, `general-web`
  - `unknown_action` capture와 review queue 데이터 경로 추가
  - offline LLM suggester command 추가
  - action coverage 진단 또는 대시보드 출력 추가
- 제외 범위
  - viewer 기반 review UI
  - hot path LLM 분류
- 선행 조건
  - M4
- 산출물
  - action rule packs
  - `unknown_action` coverage report
  - `action:suggest` 같은 offline review command
- 완료 기준
  - top repeated workflow가 주로 semantic action sequence로 읽힌다.
  - fixture 기준 top 20 workflow의 `unknown_action` 비율이 10% 미만이다.
  - 새 unlabeled pattern을 검토 가능한 형태로 추출할 수 있다.
- 다음 단계로 넘길 입력
  - sessionizer가 사용할 richer action distribution

## M6. Rolling Sessionizer + gws Calendar

- 권장 branch: `codex/m6-sessionizer-calendar`
- 권장 기간: 5-7일
- 목표
  - event-to-event 비교를 넘어서 rolling context 기반 session boundary를 도입한다.
- 범위
  - 최근 N분의 context distribution 기반 boundary 판정
  - 기존 time gap boundary를 fallback으로 유지
  - gws CLI thin adapter 도입
  - Calendar collector를 optional dependency로 추가
  - `doctor`에 gws 설치/인증 상태 진단 추가
  - meeting start/end를 boundary signal로 반영
- 제외 범위
  - Drive/Sheets/Gmail 확장
  - hybrid clustering
- 선행 조건
  - M5
- 산출물
  - rolling sessionizer
  - gws calendar adapter
  - optional collector enable/disable 경로
- 완료 기준
  - gws 미설치 환경에서도 문제 없이 동작한다.
  - Calendar 이벤트가 boundary reason에 설명 가능한 signal로 남는다.
  - fixture 기준 false split 또는 false merge 중 session 관련 오류가 줄어든다.
- 다음 단계로 넘길 입력
  - clustering이 사용할 더 안정적인 session graph

## M7. Hybrid Clustering v2

- 권장 branch: `codex/m7-hybrid-clustering`
- 권장 기간: 4-6일
- 목표
  - 순서가 조금 달라도 같은 업무가 묶이도록 workflow clustering을 업그레이드한다.
- 범위
  - LCS, n-gram 외 action-set similarity 추가
  - domain-context similarity 추가
  - time-of-day similarity 추가
  - weighted confidence 산출과 튜닝 지점 정리
  - baseline 대비 fixture benchmark 추가
- 제외 범위
  - feedback UI
  - secondary collector 확장
- 선행 조건
  - M6
- 산출물
  - clustering v2 scoring
  - benchmark 비교 결과
  - 튜닝 가능한 가중치 설정점
- 완료 기준
  - fixture 기준 false split/merge가 M4 baseline 대비 50% 이상 감소한다.
  - 같은 업무의 순서 변형이 더 높은 confidence로 묶인다.
  - confidence score가 사람이 설명 가능한 근거를 가진다.
- 다음 단계로 넘길 입력
  - feedback UI가 다룰 더 안정적인 workflow cluster

## M8. Minimal Feedback Surface

- 권장 branch: `codex/m8-feedback-surface`
- 권장 기간: 6-8일
- 목표
  - 비개발자가 CLI 없이 feedback loop를 돌릴 수 있는 최소 write surface를 만든다.
- 범위
  - local server에 feedback REST API 추가
  - 기존 CLI와 동일한 비즈니스 로직 공유
  - viewer에 label/review, exclude/hide P0 기능 추가
  - structured automation hint 출력 추가
  - merge, unknown action review는 P1 범위에서 포함 가능
- 제외 범위
  - full desktop UI
  - 복잡한 multi-user sync
  - split UI의 고급 interaction
- 선행 조건
  - M7
- 산출물
  - feedback API
  - viewer write surface
  - structured automation hint format
- 완료 기준
  - 비개발자가 common feedback path를 30초 이내로 수행할 수 있다.
  - workflow label/exclude 결과가 재분석과 리포트에 반영된다.
  - 최소한의 write action이 CLI 없이 닫힌다.
- 다음 단계로 넘길 입력
  - 더 넓은 사용자 피드백과 collector 확장에 필요한 UX 기반

## M9. Workspace Expansion

- 권장 branch: `codex/m9-workspace-expansion`
- 권장 기간: 5-8일
- 목표
  - Calendar에서 검증한 gws 경로를 Drive/Sheets 중심으로 확장해 browser-only 한계를 줄인다.
- 범위
  - Drive collector 추가
  - Sheets collector 추가
  - Git timestamp/repo hash collector 추가
  - collector별 on/off와 polling 정책 정리
  - privacy-safe storage contract 유지
- 제외 범위
  - Gmail collector
  - Slack metadata collector
  - richer Windows interaction collector
- 선행 조건
  - M6
- 산출물
  - gws Drive/Sheets adapter path
  - Git collector
  - collector toggle/diagnostics
- 완료 기준
  - Drive/Sheets 문맥이 workflow 분석에 추가 컨텍스트로 들어간다.
  - Git 메타데이터가 coding workflow의 시간 신호로 활용된다.
  - 새 collector가 꺼져 있어도 기본 시스템이 깨지지 않는다.
- 다음 단계로 넘길 입력
  - M10의 cross-platform hardening과 comparison view가 활용할 더 넓은 context

## M10. Platform Hardening + Comparison View

- 권장 branch: `codex/m10-platform-hardening-report-diff`
- 권장 기간: 5-8일
- 목표
  - pilot-ready 수준의 운영 안정성과 비교 리포팅을 마감한다.
- 범위
  - Windows autostart 경로 구현
  - Windows credential storage 전략 구현 또는 확정
  - collector health check, retry, auto-restart 보강
  - GitHub Actions에 typecheck, test, fixture regression 추가
  - day/week comparison view 추가
  - 새로 등장하거나 사라진 workflow 하이라이트 추가
- 제외 범위
  - packaged desktop app
  - Gmail/Slack collector
  - Windows click/file/clipboard 고도화
- 선행 조건
  - M8, M9
- 산출물
  - Windows 운영 경로
  - CI regression gate
  - comparison report/view
- 완료 기준
  - macOS/Windows 양쪽에서 핵심 fixture 결과가 동등하게 유지된다.
  - 운영 진단 경로가 collector 단위로 확보된다.
  - 비교 리포트로 automation 효과와 workflow 변화가 보인다.
- 다음 단계로 넘길 입력
  - broader internal rollout 또는 long-tail collector backlog

## 후속 백로그

아래 항목은 이번 committed milestone train의 게이트로 두지 않는다.

- Gmail collector
- Slack metadata collector
- richer Windows interaction collector
- packaged desktop UI/tray
- remote sync
- automation execution engine

## CLI Simplification Train

아래 `M11-M15`는 기존 workflow-quality 열차와 별개의 후속 열차다.
세부 운영 규칙은 `docs/plans/active/cli-simplification-roadmap.md`를 따른다.

## M11. Config System Foundation

- 권장 branch: `codex/m11-cli-config-foundation`
- 권장 기간: 3-5일
- 상태
  - 완료(2026-03-18)
- 목표
  - `.wid/config.json` 기반 설정 계층과 data-dir 자동 탐색을 도입해 반복 플래그를 줄이는 기반을 만든다.
- 범위
  - config schema와 CRUD manager 추가
  - `wid config show|get|set|path`
  - `.wid/` 상위 탐색과 `WID_DATA_DIR` fallback
  - `doctor`, `agent:run`의 config fallback
- 제외 범위
  - interactive init wizard
  - tools registry
  - alias/binary 전환
- 선행 조건
  - 없음
- 산출물
  - `.wid/config.json` contract
  - config manager test
  - long-form CLI backward compatibility test
- 완료 기준
  - config CRUD와 data-dir 탐색이 자동화 테스트로 고정된다.
  - credential/token/plain API key가 config 파일에 저장되지 않는다.
  - 기존 `agent:run --data-dir ...` 경로가 그대로 동작한다.
- 구현 메모
  - `.wid/config.json` schema와 manager를 추가해 data-dir 절대경로 저장, dot-notation CRUD, `WID_DATA_DIR`/상위 `.wid` 탐색을 고정했다.
  - `doctor`, `agent:run`, `viewer:open`, `server:run`, autostart 경로가 config 기반 data-dir 해석을 사용하도록 바뀌었다.
  - `init`이 SQLite DB와 함께 `.wid/config.json`을 생성한다.
  - config guard/test를 통해 credential-like key가 파일에 저장되지 않도록 막았다.
- 다음 단계로 넘길 입력
  - init wizard가 사용할 config persistence 계층

## M12. Init Wizard + Environment Detection

- 권장 branch: `codex/m12-cli-init-detection`
- 목표
  - interactive `wid init`과 collector/analyzer detect baseline을 도입한다.
- 선행 조건
  - M11

## M13. Tool Registry + Credential Integration

- 권장 branch: `codex/m13-cli-tools-registry`
- 목표
  - `wid tools` 공통 인터페이스와 secure credential store integration을 도입한다.
- 선행 조건
  - M12

## M14. Short Aliases + `wid` Binary

- 권장 branch: `codex/m14-cli-short-aliases`
- 목표
  - short alias와 `wid` binary를 도입해 상용 사용 흐름을 한 줄로 줄인다.
- 선행 조건
  - M13

## M15. Edge Cases + Migration Chain

- 권장 branch: `codex/m15-cli-config-edge-cases`
- 목표
  - config migration, reconfigure/reset, env override chain을 닫아 운영 edge case를 정리한다.
- 선행 조건
  - M14
