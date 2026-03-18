# CLI Simplification & Config System Roadmap

이 문서는 `CLI Simplification & Config System` 구현 계획을
현재 저장소 운영 규칙에 맞게 `1 milestone = 1 worktree = 1 mergeable PR` 단위로 재구성한 실행 문서다.

- 기준 문서
  - `docs/product/requirements.md`
  - `docs/plans/active/mvp-implementation.md`
  - `docs/plans/active/project-roadmap-overview.md`
- 운영 규칙
  - 각 Phase는 하나의 milestone로 취급한다.
  - 각 milestone은 `codex/m<number>-<slug>` branch와 전용 worktree에서 수행한다.
  - 각 milestone 종료 시 코드, 테스트, 문서, PR이 모두 준비되어야 닫는다.
  - credential, token, auth secret은 `.wid/config.json`에 저장하지 않는다.

## 목표

현재 장문의 CLI 플래그 기반 실행 흐름을, 설정 저장과 짧은 실행 커맨드 중심 흐름으로 단계적으로 단순화한다.

```bash
# current
npm run dev -- agent:run \
  --data-dir ./tmp/smoke-test \
  --gws-calendar --gws-calendar-id primary \
  --gws-drive --gws-sheets \
  --git-repo ~/path/to/makestar-repo \
  --open-viewer --verbose
```

```bash
# target
wid init ~/my-data --interactive
wid tools add gws
wid tools add gemini
wid up --open
```

## Milestone Train

| ID | Phase | 권장 branch | 핵심 산출물 | 선행 조건 |
|----|-------|-------------|-------------|-----------|
| M11 | Config System Foundation | `codex/m11-cli-config-foundation` | `.wid/config.json`, config CRUD, data-dir 탐색 fallback | 없음 |
| M12 | Init Wizard + Environment Detection | `codex/m12-cli-init-detection` | interactive `wid init`, tool detection baseline | M11 |
| M13 | Tool Registry + Credential Integration | `codex/m13-cli-tools-system` | `wid tools`, collector/analyzer registry, keyring 연동 | M12 |
| M14 | Short Aliases + `wid` Binary | `codex/m14-cli-short-aliases` | alias routing, `wid up`, package bin | M13 |
| M15 | Edge Cases + Migration Chain | `codex/m15-cli-config-edge-cases` | config migration, env override chain, reconfigure/reset flow | M14 |

## Common Gates

각 milestone은 아래를 모두 만족해야 닫는다.

- 기존 long-form command가 하위 호환으로 유지된다.
- 새 behavior를 검증하는 자동화 테스트가 추가되거나 기존 테스트가 확장된다.
- README 또는 active plan 문서가 새 usage 또는 운영 규칙을 반영한다.
- config/credential/privacy 경계가 문서와 코드 양쪽에서 확인 가능하다.
- 다음 milestone이 기대하는 입력이 코드 또는 문서로 고정되어 있다.

## Milestone Notes

### M11. Config System Foundation

- 상태
  - 완료(2026-03-18)
- 목표
  - `.wid/config.json` 기반 설정 레이어를 도입하고, `--data-dir` 없이도 기존 명령이 동작할 수 있는 기반을 만든다.
- 범위
  - `WidConfig` schema와 config manager 추가
  - `wid config show|get|set|path`
  - `--data-dir` 해석 우선순위 도입
  - `doctor`, `agent:run`의 collector flag config fallback
- 제외 범위
  - interactive init
  - tools registry
  - `wid` alias/binary
- 완료 기준
  - `.wid/config.json`이 생성되고 CRUD 가능하다.
  - config에 credential/token/plain API key가 저장되지 않는다.
  - 기존 long-form 명령이 config fallback과 함께 계속 동작한다.
- 구현 메모
  - `src/config/schema.ts`, `src/config/manager.ts` 를 추가해 `.wid/config.json` 경로, default value, dot-notation CRUD, upward discovery, credential-like key guard를 고정했다.
  - `doctor`, `agent:run`, `viewer:open`, `server:run`, autostart 경로가 config 기반 data-dir 해석과 기본 fallback을 사용하도록 연결했다.
  - `init`이 SQLite 초기화와 함께 `.wid/config.json`을 생성하도록 바뀌었다.
  - `src/config/manager.test.ts`, `src/cli.test.ts` 를 추가해 config CRUD, auto-discovery, `agent:run --data-dir` 하위 호환을 검증했다.
- 다음 단계로 넘길 입력
  - 일관된 data-dir/config 해석 규칙
  - interactive init이 재사용할 config persistence 계층

### M12. Init Wizard + Environment Detection

- 상태
  - 완료(2026-03-18)
- 목표
  - `wid init`을 데이터 디렉토리 생성, 토큰 생성, 도구 감지까지 포함한 interactive entrypoint로 바꾼다.
- 구현 메모
  - `src/tools/detect.ts`를 추가해 `gws`, `git`, `gh`와 analyzer credential baseline 감지를 공통 모듈로 고정했다.
  - `src/init/flow.ts`와 `src/cli/prompts.ts`를 추가해 `init --interactive`에서 data dir, ingest token, collector 선택, 기본 LLM 설정 흐름을 연결했다.
  - plain `init`도 첫 실행 시 ingest token을 자동 생성하도록 바뀌었다.
  - `src/tools/detect.test.ts`, `src/integration/cli.test.ts`를 확장해 detection parsing, interactive init, ingest token provisioning을 검증했다.
- 다음 단계로 넘길 입력
  - collector/analyzer detect surface
  - tool setup prompt 기본 흐름

### M13. Tool Registry + Credential Integration

- 상태
  - 완료(2026-03-18)
- 목표
  - collector와 analyzer를 공통 registry로 관리하고, secure credential storage와 연결한다.
- 구현 메모
  - `src/tools/registry.ts`, `src/tools/service.ts`, `src/tools/runtime.ts` 를 추가해 managed collector/analyzer registry, `tools add/remove/refresh/auth`, agent runtime collector resolution을 공통 레이어로 고정했다.
  - `credential` 저장 계층에 Linux plaintext file fallback 경고 경로를 추가해 CI/Linux에서도 analyzer credential flow를 검증 가능하게 만들었다.
  - `init`에서 설정한 analyzer가 `tools` registry와 같은 config shape를 사용하도록 맞췄고, `agent:run`은 config에 등록된 gws/git collector를 런타임 readiness 기준으로 다시 걸러 올리도록 바뀌었다.
  - `src/tools/registry.test.ts`, `src/tools/runtime.test.ts`, `src/tools/service.test.ts`, `src/integration/cli.test.ts` 확장을 통해 registry, credential integration, refresh flow, CLI `tools` command를 검증했다.
- 다음 단계로 넘길 입력
  - alias와 `wid up`이 재사용할 tool state

### M14. Short Aliases + `wid` Binary

- 목표
  - 짧은 alias와 `wid` binary를 도입해 실제 사용 흐름을 한 줄 실행 중심으로 단순화한다.
- 다음 단계로 넘길 입력
  - env/config/alias 일관 실행면

### M15. Edge Cases + Migration Chain

- 목표
  - 기존 데이터 디렉토리 재설정, config version migration, env override chain을 닫아 운영 edge case를 정리한다.
- 닫힘 조건
  - migration과 재초기화 경로가 테스트로 고정되어 있다.

## Sequential Delivery Rule

이 열차는 아래 순서로만 진행한다.

```text
M11 -> M12 -> M13 -> M14 -> M15
```

운영 절차:

1. milestone 전용 worktree 생성
2. 구현 + 테스트 + 문서 갱신
3. PR 생성
4. 직접 승인 후 merge
5. 다음 milestone worktree를 최신 `develop` 기준으로 생성
