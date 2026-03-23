# WID-First CLI Follow-up Roadmap

이 문서는 `CLI Simplification & Config System` 완료 이후,
`wid` 중심 사용 흐름을 실제 사용자 관점에서 더 자연스럽게 다듬기 위한
후속 실행 계획을 정리한 active plan 문서다.

- 기준 문서
  - `docs/product/requirements.md`
  - `docs/plans/active/mvp-implementation.md`
  - `docs/plans/active/project-roadmap-overview.md`
  - `docs/plans/active/cli-simplification-roadmap.md`
- 문서 작성 배경
  - 2026-03-23 사용자 관점 CLI 점검 결과를 기반으로 한다.
  - 목표는 기능 추가보다 `wid` 입구, 명령 문법, setup 경험, 상태 안내를 정합적으로 맞추는 것이다.
- 운영 규칙
  - 각 milestone은 `1 milestone = 1 worktree = 1 mergeable PR` 규칙을 따른다.
  - 각 milestone은 코드, 테스트, 문서, PR이 함께 준비되어야 닫는다.
  - 기존 `:` 기반 long-form command는 하위 호환으로 유지한다.
  - credential, token, auth secret은 계속 `.wid/config.json`에 저장하지 않는다.

## 1. 배경과 문제 정의

`M11-M15`는 config, init, tools, alias, migration을 닫아
CLI를 실사용 가능한 수준까지 단순화했다.
하지만 2026-03-23 점검 기준으로, 처음 프로젝트를 접하는 사용자는 여전히 아래 지점에서 혼란을 겪을 수 있다.

1. help와 usage의 첫인상이 아직 `wid`보다 legacy/내부 command에 가깝다.
2. `wid workflow:list` 같은 `:` 문법보다 `wid workflow list` 형태가 더 자연스럽다.
3. `--data-dir`, `--repo-path`, `--client-id` 같은 플래그 중심 입력은 초보 사용자가 부담스럽다.
4. `report` 와 `workflow list` 의 분석 상태 모델이 사용자가 보기에는 일관되지 않다.
5. 일부 문서 예제와 실제 CLI 문법이 미세하게 어긋난다.
6. init 전/상태 부족 시 stack trace 또는 저수준 오류가 먼저 보인다.

이 후속 열차의 목표는 새 capability를 늘리는 것이 아니라,
이미 있는 capability를 `wid-first`, `interactive-first`, `user-facing` 흐름으로 재구성하는 것이다.

## 2. 고정할 사용자 결정사항

이번 후속 열차에서는 아래 사용자 선호를 구현 기준으로 고정한다.

1. `wid workflow:list` 보다 `wid workflow list` 를 canonical 문법으로 채택한다.
2. argument를 `--flag` 로 입력하는 방식은 예외 경로로 두고,
   일반 설정 흐름은 interactive를 기본으로 한다.

이를 위해 아래 원칙을 따른다.

- 기본 문법은 `wid <domain> <action>` 이다.
- `:` 기반 명령은 legacy alias로 유지하되, help 전면에서는 뒤로 민다.
- TTY에서는 interactive를 기본값으로 켠다.
- non-TTY/CI/script 환경에서는 기존 deterministic 입력 경로를 유지한다.
- destructive 작업은 interactive default여도 명시 확인을 유지한다.

## 3. Canonical CLI 문법

### 3.1 사용자에게 우선 노출할 문법

```bash
wid init
wid init ~/my-data
wid setup
wid tools
wid tools add gws
wid tools add git
wid tools add gemini
wid up
wid status
wid report
wid report compare
wid workflow list
wid workflow show <id>
wid token
wid stop
```

### 3.2 하위 호환으로 유지할 legacy 문법

```bash
wid agent:run
wid agent:health
wid agent:status
wid report:compare
wid workflow:list
wid workflow:show <id>
wid ingest:token
```

### 3.3 문법 전환 규칙

- 새 문법은 `Command` group을 사용한 중첩 subcommand로 정의한다.
- legacy command는 같은 handler를 호출하는 alias entrypoint로만 남긴다.
- docs/help/examples는 새 문법으로 통일한다.
- regression test는 새 문법과 legacy 문법 모두를 최소 1개 이상 고정한다.

## 4. 공통 완료 게이트

각 milestone은 아래를 모두 만족해야 닫는다.

- 새 behavior를 검증하는 자동화 테스트가 추가되거나 기존 테스트가 확장된다.
- legacy command가 계속 동작한다.
- 사용자 관점의 다음 행동이 help, 오류 메시지, 또는 interactive prompt로 드러난다.
- README 또는 active plan 중 최소 하나가 새 결정사항을 반영한다.
- 다음 milestone이 기대하는 입력이 코드 또는 문서로 고정된다.

## 5. Milestone Train

| ID | Phase | 권장 branch | 핵심 산출물 | 선행 조건 |
|----|-------|-------------|-------------|-----------|
| M16 | Natural Command Syntax | `codex/m16-cli-natural-command-syntax` | `wid workflow list`, `wid report compare`, `wid init <path>` | M15 |
| M17 | Interactive Defaults | `codex/m17-interactive-defaults` | TTY 기본 interactive, `--non-interactive` 제어 | M16 |
| M18 | Guided Setup Entry | `codex/m18-setup-wizard` | `wid setup`, init/tools/config 통합 시작 흐름 | M17 |
| M19 | Analysis State UX | `codex/m19-analysis-state-ux` | workflow/session/report 상태 일관화, refresh path | M18 |
| M20 | Docs + Regression Lock | `codex/m20-cli-docs-and-regression-lock` | canonical docs/help, example smoke test, legacy gate | M19 |

## 6. Milestone Notes

### M16. Natural Command Syntax

- 상태
  - 계획 중
- 목표
  - `:` 기반 command를 자연어형 subcommand로 감싸고,
    `wid init <path>` 를 실제 문법으로 끌어올린다.
- 범위
  - `workflow list|show|label|merge|split|exclude|include|hide|unhide`
  - `session list|show|delete`
  - `report compare|generate|snapshot list|snapshot show`
  - `agent run|restart|status|health|stop|collectors|snapshot latest`
  - `ingest token`
  - `init [dataDir]`
  - `tools --data-dir`
- 구현 작업
  - `src/cli.ts`의 action body를 재사용 가능한 handler 함수로 분리한다.
  - 필요 시 `src/cli/handlers.ts` 또는 유사 공용 모듈을 추가한다.
  - 새 group command를 추가하고 기존 `:` command는 같은 handler를 호출하도록 유지한다.
  - `init`에 positional `[dataDir]` 를 추가하고 precedence를 고정한다.
  - top-level `tools` command에도 `--data-dir` 를 추가한다.
  - help/usage에서 실제 command 이름이 `wid` 로 보이도록 정리한다.
  - `src/config/manager.ts` 의 `No data directory found` 오류 문구를 새 문법 기준으로 갱신한다.
- 기본 touch 예상 파일
  - `src/cli.ts`
  - `src/cli/aliases.ts`
  - `src/config/manager.ts`
  - `src/integration/cli.test.ts`
- 테스트 게이트
  - `wid workflow list`
  - `wid workflow show <id>`
  - `wid report compare`
  - `wid ingest token`
  - `wid init /tmp/example`
  - `wid tools --data-dir /tmp/example`
- 완료 기준
  - 초보 사용자가 `:` 없이 주요 명령을 찾고 실행할 수 있다.
  - 기존 `workflow:list` 같은 legacy 문법도 계속 동작한다.

### M17. Interactive Defaults

- 상태
  - 계획 중
- 목표
  - setup/auth/tool add 경로에서 플래그 입력을 예외 경로로 내리고,
    TTY에서는 interactive를 기본값으로 만든다.
- 범위
  - `wid init`
  - `wid tools add`
  - `wid tools auth`
  - `wid auth login`
- 구현 작업
  - interactive 기본 동작 규칙을 공통 helper로 분리한다.
  - TTY에서는 누락된 필수값을 prompt로 채운다.
  - non-TTY에서는 현재처럼 명시 입력을 요구하되 오류 메시지를 짧게 정리한다.
  - `--non-interactive` 플래그를 setup/auth 계열 command에 추가한다.
  - `wid tools add git` 는 repo path를 prompt 또는 자동 탐지 기본값으로 제안한다.
  - analyzer provider 명령은 `auth`, `model`, `client-id`, `project-id` 를 누락된 것만 묻는다.
- 기본 touch 예상 파일
  - `src/cli.ts`
  - `src/cli/prompts.ts`
  - `src/init/flow.ts`
  - `src/tools/service.ts`
  - `src/integration/cli.test.ts`
- 테스트 게이트
  - TTY interactive init 기본 진입
  - positional path + interactive 혼합 케이스
  - `wid tools add git` missing repo path prompt
  - `wid tools add gemini` missing credential prompt
  - `--non-interactive` failure path
- 완료 기준
  - 일반 사용자는 setup/auth 관련 command를 플래그 없이 대부분 진행할 수 있다.
  - CI/script는 여전히 deterministic하게 실행된다.

### M18. Guided Setup Entry

- 상태
  - 계획 중
- 목표
  - `wid init`, `wid tools add`, `wid config set` 를 따로 배우지 않아도
    시작 가능한 단일 진입점 `wid setup` 을 제공한다.
- 범위
  - `wid setup`
  - `wid up` 의 선행 setup 유도
- 구현 작업
  - `src/setup/flow.ts` 를 추가해 guided setup flow를 분리한다.
  - data dir 선택, init/reconfigure, tool detection, tool enable, 기본 analysis threshold,
    optional LLM provider 선택 순서를 고정한다.
  - 기존 `src/init/flow.ts` 의 재사용 가능한 부분을 setup flow로 분리한다.
  - 초기화되지 않은 상태에서 `wid up` 실행 시 TTY에서는 `setup` 진입을 제안한다.
  - `wid config` 는 저수준 command로 유지하되, help에서는 `wid setup` 을 먼저 노출한다.
- 기본 touch 예상 파일
  - `src/cli.ts`
  - `src/setup/flow.ts`
  - `src/init/flow.ts`
  - `src/tools/detect.ts`
  - `src/integration/cli.test.ts`
- 테스트 게이트
  - 신규 `wid setup`
  - 기존 data dir reconfigure
  - `wid up` 선행 setup 유도
  - detection 결과 반영
- 완료 기준
  - 초보 사용자용 시작 command가 사실상 `wid setup` 하나로 수렴한다.

### M19. Analysis State UX

- 상태
  - 계획 중
- 목표
  - `report`, `workflow list`, `workflow show`, `session list` 가
    분석 상태를 일관되게 설명하도록 맞춘다.
- 범위
  - `workflow list|show`
  - `session list|show`
  - `report`
  - `status`
- 구현 작업
  - raw event 존재 여부, analyzed artifact 존재 여부, refresh 필요 여부를 공통 판단하는 helper를 추가한다.
  - `workflow list|show`, `session list|show` 에 `--refresh` 경로를 추가한다.
  - raw event는 있는데 analysis artifact가 없으면 TTY에서는 재분석 여부를 묻고,
    non-TTY에서는 다음 행동을 안내한다.
  - `report` 가 live reanalysis를 사용할 때 freshness 정보를 다른 읽기 command와 정합적으로 맞춘다.
  - `wid status` 와 `wid agent status` 의 의미 차이를 help와 출력에 명시한다.
  - 필요하면 `wid health` alias를 추가해 사용자가 의미를 더 쉽게 추론하게 한다.
- 기본 touch 예상 파일
  - `src/cli.ts`
  - `src/reporting/service.ts`
  - `src/storage/database.ts`
  - `src/integration/cli.test.ts`
- 테스트 게이트
  - `collect:mock` 직후 `wid workflow list`
  - stale analysis state
  - `--refresh`
  - empty database state
- 완료 기준
  - 사용자가 설명 없이 빈 결과를 받지 않는다.
  - `report` 와 `workflow list` 의 상태 차이를 이해할 수 있다.

### M20. Docs + Regression Lock

- 상태
  - 계획 중
- 목표
  - 새 canonical 문법과 interactive 기본 흐름을 문서와 테스트로 잠근다.
- 범위
  - README
  - CLI Quickstart
  - internal reference
  - help text
  - example smoke tests
- 구현 작업
  - `README.md`, `CLI_QUICKSTART.md`, `docs/reference/project-reference.md` 를 새 문법 기준으로 갱신한다.
  - help 첫 화면을 초보 사용자용 command 중심으로 재정리한다.
  - 문서에 적힌 예제가 실제로 실행되는 smoke test를 추가한다.
  - legacy command는 계속 동작하되 docs에서는 de-emphasize 또는 제거한다.
  - low-signal warning 노출을 검토하고, 적어도 핵심 예제 출력은 안정적으로 유지한다.
- 기본 touch 예상 파일
  - `README.md`
  - `CLI_QUICKSTART.md`
  - `docs/reference/project-reference.md`
  - `src/integration/cli.test.ts`
- 테스트 게이트
  - README canonical flow
  - CLI Quickstart canonical flow
  - legacy compatibility smoke
- 완료 기준
  - 문서 예제가 그대로 실행된다.
  - 새 문법과 legacy 문법이 모두 regression gate에 포함된다.

## 7. 구현 중 계속 유지할 결정사항

- alias surface를 무한정 넓히지 않는다.
- `wid status`, `wid up`, `wid stop`, `wid token` 같은 top-level shortcut은 유지한다.
- `config set` 같은 저수준 command는 non-interactive 우선으로 남긴다.
- destructive path는 interactive default 대상이어도 명시 확인을 유지한다.
- docs/help에서는 새 문법을 먼저 보여주고, legacy 문법은 숨기거나 뒤로 민다.

## 8. 이번 열차에서 의도적으로 늦추는 항목

- viewer UI redesign
- collector 추가 확대
- LLM provider capability 확장
- remote sync
- tray UI
- automation execution engine

## 9. Sequential Delivery Rule

이 열차는 아래 순서로만 진행한다.

```text
M16 -> M17 -> M18 -> M19 -> M20
```

운영 절차:

1. milestone 전용 worktree 생성
2. 구현 + 테스트 + 문서 갱신
3. PR 생성
4. 직접 승인 후 merge
5. 다음 milestone worktree를 최신 `develop` 기준으로 생성

현재 상태:

```text
M16 (planned) -> M17 -> M18 -> M19 -> M20
```
