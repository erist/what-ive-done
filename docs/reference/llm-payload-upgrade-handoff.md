# LLM Payload Upgrade Handoff

아래 프롬프트를 새 쓰레드에서 그대로 사용하면 됩니다.

```text
/Users/yhchun/Workspace/Projects/ax/what-ive-done 에서 LLM workflow analysis payload를 업그레이드해줘.

먼저 반드시 아래 문서를 읽고 시작해:
- /Users/yhchun/Workspace/Projects/ax/what-ive-done/docs/product/requirements.md
- /Users/yhchun/Workspace/Projects/ax/what-ive-done/docs/plans/active/mvp-implementation.md

현재 상태:
- LLM에는 raw event 전체를 보내지 않고, 요약 payload만 보낸다.
- 현재 payload는 workflowSteps, frequency, averageDurationSeconds, applications, domains 정도만 포함한다.
- 관련 코드:
  - /Users/yhchun/Workspace/Projects/ax/what-ive-done/src/llm/payloads.ts
  - /Users/yhchun/Workspace/Projects/ax/what-ive-done/src/storage/database.ts
  - /Users/yhchun/Workspace/Projects/ax/what-ive-done/src/domain/types.ts
  - /Users/yhchun/Workspace/Projects/ax/what-ive-done/src/llm/shared.ts
  - /Users/yhchun/Workspace/Projects/ax/what-ive-done/src/llm/openai.ts
  - /Users/yhchun/Workspace/Projects/ax/what-ive-done/src/llm/claude.ts
  - /Users/yhchun/Workspace/Projects/ax/what-ive-done/src/llm/gemini.ts
  - /Users/yhchun/Workspace/Projects/ax/what-ive-done/src/storage/database.test.ts
  - /Users/yhchun/Workspace/Projects/ax/what-ive-done/src/llm/payloads.test.ts

목표:
- raw event 원문 전체를 외부 LLM에 보내지 않으면서도, workflow naming/summary/automation suitability 판단 정확도를 높일 수 있게 payload를 richer normalized context 기반으로 개선해줘.

중요 제약:
- requirements.md의 privacy 방향을 지켜야 한다.
- raw URL, raw window title, document content, keystrokes 같은 원문 민감 데이터는 외부 LLM payload에 직접 넣지 않는다.
- deterministic pipeline이 반복 패턴 탐지의 주 역할을 유지하고, LLM은 해석 보조 역할을 유지해야 한다.

원하는 방향:
- payload에 넣을 수 있는 후보를 검토하고, 실제로 유용한 것만 추가해줘.
- 예시 후보:
  - representative sequence와 representative steps를 분리해서 전달
  - top variants 2~3개
  - normalized page/resource context
  - app/domain transition context
  - session count / occurrence count / frequency per week 같은 해석 보조 지표
  - title-derived context가 필요하다면 raw title이 아니라 normalized/sanitized form만 검토
- 너무 많은 필드를 한 번에 다 넣기보다, 해석 품질에 실질적으로 도움이 되는 최소 세트를 설계해줘.

해야 할 일:
1. 현재 payload/analysis 흐름을 읽고 문제를 정리
2. 개선된 payload schema 제안
3. 타입과 payload builder 구현
4. DB payload record 생성 경로 반영
5. provider 호출 경로는 필요한 최소 수정만 반영
6. 테스트 추가/수정
7. 필요하면 llm instructions도 payload 구조에 맞게 조금 다듬기

산출물 기대치:
- 어떤 필드를 왜 추가했는지 설명
- privacy 상 왜 괜찮은지 설명
- typecheck/test 통과
- 가능하면 llm:payloads 출력이 사람 눈으로도 더 유의미해졌는지 확인

주의:
- 현재 브랜치에는 local viewer와 command cleanup 관련 작업이 이미 들어가 있을 수 있으니, 다른 변경을 되돌리지 말고 그 위에서 작업해줘.
```
