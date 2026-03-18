# OpenAI Provider Split Roadmap

이 문서는 `openai`와 `openai-codex`를 분리 설정 가능한 analyzer provider로 도입하는
활성 구현 계획 문서다.

- 기준 문서
  - `docs/product/requirements.md`
  - `docs/plans/active/mvp-implementation.md`
- 운영 원칙
  - `1 milestone = 1 worktree = 1 mergeable PR`
  - 각 작업이 끝날 때마다 관련 문서와 검증 결과를 함께 갱신한다.
  - 각 마일스톤은 review, QA, PR 생성까지 닫은 뒤 다음 마일스톤으로 진행한다.
  - OAuth credential은 SQLite, config, raw event storage에 저장하지 않는다.

## 1. 목표

현재 CLI/analysis stack에서 `openai`는 API key 기반 provider 하나로만 다뤄진다.
이번 열차의 목표는 다음 두 경로를 명확히 분리하는 것이다.

- `openai`: OpenAI Platform API key 기반 analyzer
- `openai-codex`: ChatGPT/Codex OAuth 기반 analyzer

이 분리는 provider 선택, 설정 저장, credential 관리, detect/status, runtime 분석 경로에서
일관되게 보여야 한다.

## 2. 공통 완료 게이트

각 마일스톤은 아래를 모두 만족해야 닫는다.

- 사용자가 CLI에서 `openai`와 `openai-codex`를 구분해 볼 수 있다.
- 관련 설정 변경이 persisted config와 runtime resolution에 일관되게 반영된다.
- 인증 정보는 secure credential store에만 저장되고, local data store에는 남지 않는다.
- 테스트가 새 동작과 기존 `openai`/`gemini` 경로 회귀를 모두 커버한다.
- 마일스톤 종료 시 계획 문서와 사용자-facing 진단 문서가 갱신된다.

## 3. 마일스톤 열차

| ID | 마일스톤 | 핵심 산출물 | 선행 조건 |
|----|----------|-------------|-----------|
| M16 | Provider Split Foundation | `openai`, `openai-codex` provider/config/tool surface 분리 | 없음 |
| M17 | OpenAI Codex Auth Surface | `auth:login`, `auth:logout`, detect/status, secure credential wiring | M16 |
| M18 | OpenAI Codex Runtime | OAuth runtime resolution, analyzer execution path, refresh/retry regression | M17 |

## 4. 마일스톤 상세

### M16. Provider Split Foundation

범위:

- LLM provider catalog에 `openai-codex` 추가
- tool registry, config set/show, provider listing에 `openai-codex` 노출
- 기존 `openai` API key 경로와 기본값 유지
- provider change 시 auth/model/base-url resolution이 새 provider를 인식하도록 확장
- interactive init flow에서의 실제 OAuth onboarding은 M17 이후에 노출

완료 기준:

- `llm:providers`, `llm:config:show`, `tools list` 에서 `openai-codex`가 식별된다.
- `openai` 기존 API key 동작이 회귀하지 않는다.
- foundation 변경 사항이 문서와 테스트에 반영된다.

### M17. OpenAI Codex Auth Surface

범위:

- `openai-codex` 전용 OAuth credential type과 secure storage 추가
- `auth:login openai-codex`, `auth:logout openai-codex` 추가
- `tools add openai-codex` 와 detect/status 경로 추가
- CLI 진단 메시지를 `openai`와 `openai-codex`에 맞게 분리

완료 기준:

- 사용자가 API key provider와 OAuth provider를 혼동하지 않는다.
- credential status와 tool status에서 `openai-codex` readiness를 확인할 수 있다.
- 토큰은 secure store 외 저장 경로에 남지 않는다.

### M18. OpenAI Codex Runtime

범위:

- `llm:analyze` 에서 `openai-codex` runtime auth resolution 추가
- analyzer factory에 `openai-codex` 실행 경로 추가
- refresh/expiry/unauthorized handling 보강
- 기존 `openai` API key analyzer와 명확히 분리된 runtime 경로 유지

완료 기준:

- `openai-codex` provider를 기본값 또는 override로 선택해 분석이 가능하다.
- expired credential 처리와 unauthorized retry가 최소 1개 이상 테스트로 고정된다.
- `openai` API key runtime과 `gemini` OAuth runtime이 회귀하지 않는다.

## 5. PR 운영 규칙

- M16: branch/worktree `codex/m16-openai-provider-split`
- M17: branch/worktree `codex/m17-openai-codex-auth`
- M18: branch/worktree `codex/m18-openai-codex-runtime`

각 PR은 아래 순서를 따른다.

1. 구현
2. 테스트
3. 관련 문서 갱신
4. self-review
5. PR 생성
6. 가능하면 CLI로 승인
7. merge 또는 다음 단계 승인 대기

## 6. 현재 시작 지점

현재 작업은 `M16 Provider Split Foundation`부터 시작한다.

## 7. 진행 상태

### M16. Provider Split Foundation

- 상태: 완료
- 완료일: 2026-03-18
- 산출물:
  - `openai`와 `openai-codex`를 provider catalog/config/tool registry에서 분리 노출
  - `tools add openai-codex`, `llm:providers`, `llm:config:*`, `credential:status` 표면 정리
  - `openai-codex`는 OAuth 전용 provider로 고정하고, M16에서는 login/runtime 미구현 상태를 명시적 오류로 고정
  - 관련 unit/integration 테스트 추가
- 검증:
  - `npm run typecheck`
  - `npm test`
- 후속:
  - M17에서 secure credential store 기반 OAuth login/logout과 detect/status를 구현
