# Project Roadmap Overview

이 문서는 현재 제품 요구사항과 활성 구현 계획을 기준으로,
프로젝트 로드맵을 실제 진행 가능한 마일스톤 단위로 재구성한 PM 운영 문서다.

- 기준 문서
  - `docs/product/requirements.md`
  - `docs/plans/active/mvp-implementation.md`
- 운영 원칙
  - `1 milestone = 1 worktree = 1 mergeable PR`
  - 각 마일스톤은 다음 단계가 바로 시작될 수 있는 독립 산출물을 남겨야 한다.
  - 품질 개선 마일스톤은 반드시 fixture, trace, regression gate 중 하나 이상을 함께 남겨야 한다.
  - privacy-safe 원칙과 local-first 원칙은 모든 마일스톤의 공통 게이트다.

세부 실행 항목은 [project-roadmap-details.md](./project-roadmap-details.md)에 정리한다.
CLI 단순화 열차는 [cli-simplification-roadmap.md](./cli-simplification-roadmap.md)에 별도로 정리한다.

## 1. 계획 가정

- 기준 단위는 1인 전담 worktree 기준이다.
- 권장 기간은 대략적인 범위이며, 마일스톤이 두 개 이상의 사용자 가치를 동시에 묶게 되면 더 쪼개는 쪽을 우선한다.
- 이번 마일스톤 열차의 핵심 목표는 "collector를 많이 붙이는 것"이 아니라 "Chrome-first workflow interpretation quality를 측정 가능하게 끌어올리는 것"이다.

## 2. 공통 완료 게이트

각 마일스톤은 아래를 모두 만족해야 닫는다.

- 데모 가능한 산출물 1개 이상이 있다.
- 다음 마일스톤이 기대하는 입력이 문서 또는 테스트로 고정되어 있다.
- privacy boundary가 재검토되어 민감 정보 저장이 늘어나지 않았다.
- CLI, 설정, collector 동작이 바뀌면 최소한의 진단 경로나 문서가 함께 갱신된다.
- fixture 또는 regression check가 추가되었거나, 기존 fixture가 새 동작을 커버하도록 확장되었다.

## 3. 권장 마일스톤 열차

| ID | 마일스톤 | 핵심 산출물 | 선행 조건 | 권장 기간 |
|----|----------|-------------|-----------|-----------|
| M1 | Browser Schema v2 + Privacy Canonicalization | 브라우저 이벤트의 privacy-safe canonical signal | 없음 | 3-5일 |
| M2 | Golden Fixtures + Debug Trace + Ingest Hardening | 5분 내 품질 이슈 역추적 가능한 기반 | M1 | 4-6일 |
| M3 | Chrome Context Expansion | dwell, tab order, route taxonomy, document hash 수집 | M1, M2 | 4-6일 |
| M4 | Domain Pack Platform + Initial Packs | route family 분리 가능한 pack 시스템 | M3 | 5-7일 |
| M5 | Semantic Action Packs + Coverage Ops | top workflow를 사람이 읽을 수 있는 action sequence로 변환 | M4 | 5-7일 |
| M6 | Rolling Sessionizer + gws Calendar | session boundary precision 향상 | M5 | 5-7일 |
| M7 | Hybrid Clustering v2 | false split/merge 감소 | M6 | 4-6일 |
| M8 | Minimal Feedback Surface | 비개발자도 CLI 없이 feedback 가능 | M7 | 6-8일 |
| M9 | Workspace Expansion | Calendar 이후 Drive/Sheets/Git context 확장 | M6 | 5-8일 |
| M10 | Platform Hardening + Comparison View | cross-platform 운영 안정성 + report diff | M8, M9 | 5-8일 |

## 4. 단계별 운영 포인트

### Stage A. 품질 기반 고정

- 마일스톤: `M1-M2`
- 목표: 데이터 계약과 디버그 체계를 먼저 잠가서 이후 품질 작업이 감으로 흘러가지 않게 만든다.
- 게이트: "오탐/누락 하나를 5분 안에 설명 가능" 상태가 되어야 Stage B로 간다.

### Stage B. Browser-first 해석 기반

- 마일스톤: `M3-M5`
- 목표: Chrome 내부 컨텍스트를 route family와 semantic action 수준까지 끌어올린다.
- 게이트: fixture 기준으로 동일 도메인 내 route family 분리가 가능하고, top repeated workflow의 `unknown_action` 비율이 관리 가능해야 한다.

### Stage C. Session/Workflow 품질 향상

- 마일스톤: `M6-M7`
- 목표: session boundary와 clustering precision을 개선해 feedback이 의미 있게 작동하도록 만든다.
- 게이트: false split/merge가 fixture 기준으로 유의미하게 감소해야 한다.

### Stage D. 사용자 루프와 확장

- 마일스톤: `M8-M10`
- 목표: feedback loop를 UI로 열고, 이후 Workspace context와 플랫폼 안정성을 붙인다.
- 게이트: 비개발자 피드백 루프와 macOS/Windows 운영 경로가 모두 실사용 가능한 수준이어야 한다.

## 5. 의존 관계

기본 추천 순서는 아래와 같다.

```text
M1 -> M2 -> M3 -> M4 -> M5 -> M6 -> M7 -> M8 -> M10
                         \-> M9 -----------/
```

운영 원칙:

- `M9`는 기술적으로 `M6` 이후 시작할 수 있다.
- 다만 PM 관점에서는 `M8`을 먼저 닫아 feedback loop를 확보한 뒤 `M9`로 가는 편이 리스크가 낮다.
- `M10`은 `M8`의 사용자 루프와 `M9`의 확장 collector 결과를 모두 흡수하는 마감 마일스톤으로 둔다.

## 6. 이번 열차에서 의도적으로 늦추는 항목

아래는 현재 마일스톤 열차의 블로커로 보지 않는다.

- full desktop app 또는 tray UI
- remote sync 또는 cloud storage
- screenshot capture
- automation execution engine
- gws MCP server mode
- Gmail, Slack metadata, richer Windows interaction collector의 장기 확장

## 7. PM 권장 운영 규칙

- branch/worktree 이름은 `codex/m<number>-<slug>` 형식으로 통일한다.
- 마일스톤 PR은 "새 capability + 검증 수단"을 함께 담아야 한다.
- 다음 마일스톤의 입력이 준비되지 않았으면 현 마일스톤을 닫지 않는다.
- 품질 문제가 fixture 없이 재현만 되는 상태라면 기능 추가보다 fixture 고정을 우선한다.
- feedback UI는 clustering 품질이 안정되기 전까지 범위를 늘리지 않는다.

## 8. Next Train: CLI Simplification

- 현재 `M1-M10` 열차는 완료되었고, 다음 독립 열차는 CLI 사용성 단순화다.
- 새 열차는 `M11-M15`로 나누어 config foundation, init wizard, tool registry, alias/binary, edge case를 순차적으로 닫는다.
- 현재 진행 상태는 `M11-M15` 전체 완료이며, CLI 단순화 열차는 종료됐다.
- 운영 규칙은 기존과 동일하게 `1 milestone = 1 worktree = 1 mergeable PR` 이다.
