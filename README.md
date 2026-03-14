# What I've Done

Local-first workflow pattern analyzer for discovering repetitive work before deciding what to automate.

Language guide:

- [English](#english)
- [한국어](#ko)
- [中文](#zh)
- [日本語](#ja)
- [Technical Reference](#technical-reference)

<a id="english"></a>
## English

### Project Description

**What I've Done** is a TypeScript CLI application that analyzes repetitive work performed on a desktop and in Chrome. It captures workflow metadata, stores it locally in SQLite, converts raw events into normalized actions, groups those actions into sessions, clusters similar sessions into workflows, and prints reports that highlight automation candidates.

The current repository focuses on **workflow analysis and discovery**, not automation execution. It is intended to answer questions such as:

- Which workflows are repeated most often?
- How much time does each workflow consume?
- Which workflows look suitable for browser automation, desktop automation, or hybrid automation?

### What Is Implemented

- TypeScript CLI
- local SQLite storage using `node:sqlite`
- sensitive metadata sanitization before persistence
- deterministic mock workflow generator
- JSON and NDJSON raw-event import
- local HTTP ingest server for live collectors
- Chrome extension scaffold for browser activity metadata
- first Windows native collector script for active-window changes
- first macOS native collector script for frontmost app and focused window changes
- workflow clustering and reporting
- workflow feedback persistence for rename, exclude, include, hide, and unhide
- session listing and deletion with automatic reanalysis
- summarized workflow payload export that is safe to send to an LLM
- OpenAI Responses API adapter for summarized workflow analysis
- macOS Keychain-backed secure storage for the OpenAI API key

### What Is Not Implemented Yet

- Windows collectors for clicks, file operations, and clipboard events
- desktop UI
- workflow feedback UI
- additional LLM providers beyond the current OpenAI adapter
- secure credential storage on non-macOS platforms

### How the Analysis Pipeline Works

1. Raw events are collected from mock data, imported files, the local ingest server, or desktop collectors such as the Windows and macOS active-window collectors.
2. Sensitive fields are sanitized before they are written to SQLite.
3. Raw events are normalized into semantic actions such as `application_switch`, `page_navigation`, `button_click`, and `form_submit`.
4. Events are grouped into sessions.
5. Similar sessions are clustered into workflows.
6. Reports and safe LLM summary payloads are generated from those workflow clusters.

Current heuristic defaults in code:

- session inactivity split: 5 minutes
- context-shift split: 90 seconds with app/domain change
- minimum workflow session duration: 60 seconds
- minimum workflow frequency: 3 similar sessions within 7 days

### Privacy Principles

Collected metadata:

- application name
- window title
- URL and domain
- event action and target hints
- timestamps
- session structure

Never collected:

- raw keystrokes
- passwords
- email body content
- document content
- clipboard text content
- authentication tokens or cookies
- continuous screenshots or screen recordings

### Requirements

- Node.js `22.x` or later
- npm `10.x` or later
- Chrome, if you want live browser collection
- Windows PowerShell, if you want to run the Windows active-window collector script
- Xcode or Xcode Command Line Tools with Swift, if you want to run the macOS active-window collector
- `OPENAI_API_KEY`, if you want to run `llm:analyze` without storing a key in secure storage

Notes:

- SQLite is currently backed by Node's `node:sqlite`.
- On Node 22, you may see an experimental warning during execution.
- The CLI still works normally in this setup.

### Installation

Install dependencies:

```bash
npm install
```

Recommended verification:

```bash
npm run typecheck
npm test
npm run build
```

Run the CLI locally:

```bash
npm run dev -- doctor
```

Optional global install:

```bash
npm link
what-ive-done doctor
```

### Quick Start

Fastest demo:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

JSON output:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data --json
```

Step-by-step local flow:

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- report --data-dir ./tmp/local-data
```

Useful report variants:

```bash
npm run dev -- report --data-dir ./tmp/local-data --json
npm run dev -- report --data-dir ./tmp/local-data --json --include-excluded
npm run dev -- report --data-dir ./tmp/local-data --json --include-hidden
```

### Additional Data Ingestion Options

Import saved events from JSON or NDJSON:

```bash
npm run dev -- import:events ./fixtures/windows-active-window-sample.ndjson --data-dir ./tmp/import-data
```

List available collectors:

```bash
npm run dev -- collector:list --json
```

Show Windows collector usage:

```bash
npm run dev -- collector:windows:info --json
```

Show macOS collector usage:

```bash
npm run dev -- collector:macos:info --json
```

### Live Browser Test with Chrome Extension

1. Start the local ingest server:

```bash
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
```

2. Open `chrome://extensions`, enable `Developer mode`, and load `extension/chrome` as an unpacked extension.
3. Set the ingest endpoint in the extension options page to `http://127.0.0.1:4318/events`.
4. Browse normally and perform safe test actions.
5. Analyze the captured events:

```bash
npm run dev -- analyze --data-dir ./tmp/live-data
npm run dev -- report --data-dir ./tmp/live-data
```

### Windows Collector Flow

The repository includes a PowerShell collector that captures active-window changes on Windows and either writes NDJSON or posts events to the local ingest server.

Typical usage:

```powershell
pwsh -File ".\collectors\windows\active-window-collector.ps1" -OutputPath ".\events.ndjson"
```

Or post directly to the local ingest server:

```powershell
pwsh -File ".\collectors\windows\active-window-collector.ps1" -IngestUrl "http://127.0.0.1:4318/events"
```

### macOS Collector Flow

The repository also includes a Swift collector for macOS. It captures the frontmost application without extra permissions and captures the focused window title when Accessibility permission is granted.

1. Check the current permission state:

```bash
swift ./collectors/macos/active-window-collector.swift --check-permissions --json
```

2. If `accessibilityTrusted` is `false`, grant access at `System Settings > Privacy & Security > Accessibility`.
3. Capture a single event to stdout:

```bash
swift ./collectors/macos/active-window-collector.swift --once --stdout
```

4. Write live events to NDJSON:

```bash
swift ./collectors/macos/active-window-collector.swift --output-path ./tmp/macos-events.ndjson
```

5. Or post directly to the local ingest server:

```bash
swift ./collectors/macos/active-window-collector.swift --ingest-url http://127.0.0.1:4318/events
```

Optional: compile a reusable binary first:

```bash
swiftc ./collectors/macos/active-window-collector.swift -o ./tmp/macos-active-window-collector
./tmp/macos-active-window-collector --once --stdout
```

### macOS End-to-End Local Test

This is the fastest path to validate the full local workflow on one macOS machine:

1. Start the ingest server:

```bash
npm run dev -- serve --data-dir ./tmp/macos-live-data --host 127.0.0.1 --port 4318
```

2. In another terminal, start the macOS collector:

```bash
swift ./collectors/macos/active-window-collector.swift --ingest-url http://127.0.0.1:4318/events
```

3. Optionally also load the Chrome extension and point it to the same ingest URL.
4. Switch between a few desktop apps and browser tabs.
5. Analyze and print the report:

```bash
npm run dev -- analyze --data-dir ./tmp/macos-live-data
npm run dev -- report --data-dir ./tmp/macos-live-data --json
```

### Workflow Review and LLM-Safe Export

List workflows:

```bash
npm run dev -- workflow:list --data-dir ./tmp/local-data --json
```

Show one workflow cluster in detail:

```bash
npm run dev -- workflow:show <workflow-id> --data-dir ./tmp/local-data --json
```

List sessions:

```bash
npm run dev -- session:list --data-dir ./tmp/local-data --json
```

Show one session with ordered steps:

```bash
npm run dev -- session:show <session-id> --data-dir ./tmp/local-data --json
```

Delete a session and rerun analysis automatically:

```bash
npm run dev -- session:delete <session-id> --data-dir ./tmp/local-data
```

Print summarized workflow payloads that exclude raw logs and are safer to send to an LLM:

```bash
npm run dev -- llm:payloads --data-dir ./tmp/local-data
```

Run OpenAI analysis on summarized payloads:

```bash
export OPENAI_API_KEY="your-api-key"
npm run dev -- llm:analyze --data-dir ./tmp/local-data --json
```

Store your OpenAI API key in macOS Keychain:

```bash
npm run dev -- credential:set-openai
```

Check secure credential status:

```bash
npm run dev -- credential:status
```

Delete the stored OpenAI API key:

```bash
npm run dev -- credential:delete-openai
```

Store the LLM-generated workflow names as local rename feedback:

```bash
npm run dev -- llm:analyze --data-dir ./tmp/local-data --apply-names --json
```

List stored LLM results:

```bash
npm run dev -- llm:results --data-dir ./tmp/local-data --json
```

For local testing with a mock endpoint:

```bash
npm run dev -- llm:analyze --data-dir ./tmp/local-data --base-url http://127.0.0.1:4545/v1 --json
```

This integration sends only summarized workflow payloads and does not send raw logs, URLs, or window titles.
On macOS, `llm:analyze` will read the key from Keychain first and fall back to `OPENAI_API_KEY`.

<a id="ko"></a>
## 한국어

### 프로젝트 설명

**What I've Done**은 데스크톱과 Chrome에서 반복적으로 수행되는 작업 흐름을 분석하는 TypeScript CLI 애플리케이션입니다. 이 프로젝트는 활동 메타데이터를 로컬 SQLite에 저장하고, 원시 이벤트를 정규화한 뒤 세션으로 묶고, 유사한 세션을 워크플로우로 군집화하여 자동화 후보를 찾는 보고서를 출력합니다.

현재 저장소의 초점은 **자동화 실행이 아니라 워크플로우 분석과 발견**입니다. 즉, 다음과 같은 질문에 답하는 데 목적이 있습니다.

- 어떤 워크플로우가 가장 자주 반복되는가?
- 각 워크플로우에 얼마나 많은 시간이 소비되는가?
- 브라우저 자동화, 데스크톱 자동화, 하이브리드 자동화 중 무엇이 적합한가?

### 현재 구현된 기능

- TypeScript CLI
- `node:sqlite` 기반 로컬 SQLite 저장소
- 저장 전 민감 메타데이터 정제
- 결정적 mock 워크플로우 생성기
- JSON 및 NDJSON 원시 이벤트 import
- 라이브 수집용 로컬 HTTP ingest 서버
- 브라우저 활동 메타데이터용 Chrome 확장 스캐폴드
- Windows active-window 변경 수집용 첫 번째 네이티브 PowerShell 수집기
- macOS 전면 앱 및 포커스 윈도우 변경 수집용 첫 번째 네이티브 Swift 수집기
- 워크플로우 군집화 및 보고서 출력
- 이름 변경, 제외, 재포함, 숨김, 숨김 해제를 위한 워크플로우 피드백 저장
- 세션 목록 조회 및 삭제 후 자동 재분석
- LLM에 보내기 비교적 안전한 요약 워크플로우 payload 출력
- OpenAI Responses API 기반 요약 워크플로우 분석 adapter
- macOS Keychain 기반 OpenAI API 키 보안 저장

### 아직 구현되지 않은 기능

- 클릭, 파일 작업, 클립보드용 Windows 수집기
- 데스크톱 UI
- 워크플로우 피드백 UI
- 현재 OpenAI adapter 외 추가 LLM provider 연동
- macOS 외 플랫폼의 보안 자격 증명 저장

### 분석 파이프라인

1. mock 데이터, import 파일, 로컬 ingest 서버, Windows/macOS active-window 수집기 같은 데스크톱 수집기에서 원시 이벤트를 수집합니다.
2. 민감한 필드를 SQLite 저장 전에 정제합니다.
3. 원시 이벤트를 `application_switch`, `page_navigation`, `button_click`, `form_submit` 같은 의미 있는 액션으로 정규화합니다.
4. 이벤트를 세션으로 그룹화합니다.
5. 유사한 세션을 워크플로우로 군집화합니다.
6. 군집 결과로 보고서와 LLM-safe 요약 payload를 생성합니다.

현재 코드 기준 기본 휴리스틱:

- 세션 비활성 분리 기준: 5분
- 문맥 전환 분리 기준: 90초 이상 간격 + 앱/도메인 변경
- 워크플로우 최소 세션 길이: 60초
- 워크플로우 최소 반복 횟수: 7일 내 유사 세션 3회

### 개인정보 원칙

수집되는 메타데이터:

- 애플리케이션 이름
- 창 제목
- URL 및 도메인
- 이벤트 액션 및 대상 힌트
- 타임스탬프
- 세션 구조

수집하지 않는 정보:

- 실제 키 입력
- 비밀번호
- 이메일 본문
- 문서 본문
- 클립보드 텍스트
- 인증 토큰 및 쿠키
- 연속 스크린샷 또는 화면 녹화

### 요구 사항

- Node.js `22.x` 이상
- npm `10.x` 이상
- 실시간 브라우저 수집을 원하면 Chrome
- Windows active-window 수집기를 실행하려면 Windows PowerShell
- macOS active-window 수집기를 실행하려면 Xcode 또는 Xcode Command Line Tools의 Swift
- secure storage에 키를 저장하지 않았다면 `llm:analyze` 실행에 `OPENAI_API_KEY`

참고:

- 현재 SQLite는 Node의 `node:sqlite`를 사용합니다.
- Node 22에서는 experimental 경고가 출력될 수 있습니다.
- 경고가 있어도 CLI 동작에는 문제가 없습니다.

### 설치 방법

의존성 설치:

```bash
npm install
```

권장 검증:

```bash
npm run typecheck
npm test
npm run build
```

로컬 실행:

```bash
npm run dev -- doctor
```

선택 사항: 전역 CLI 연결:

```bash
npm link
what-ive-done doctor
```

### 빠른 시작

가장 빠른 데모:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

JSON 출력:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data --json
```

단계별 로컬 흐름:

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- report --data-dir ./tmp/local-data
```

자주 쓰는 리포트 옵션:

```bash
npm run dev -- report --data-dir ./tmp/local-data --json
npm run dev -- report --data-dir ./tmp/local-data --json --include-excluded
npm run dev -- report --data-dir ./tmp/local-data --json --include-hidden
```

### 추가 데이터 입력 방법

JSON 또는 NDJSON 이벤트 import:

```bash
npm run dev -- import:events ./fixtures/windows-active-window-sample.ndjson --data-dir ./tmp/import-data
```

사용 가능한 수집기 조회:

```bash
npm run dev -- collector:list --json
```

Windows 수집기 사용 정보:

```bash
npm run dev -- collector:windows:info --json
```

macOS 수집기 사용 정보:

```bash
npm run dev -- collector:macos:info --json
```

### Chrome 확장 실시간 테스트

1. 로컬 ingest 서버 실행:

```bash
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
```

2. `chrome://extensions`에서 `Developer mode`를 켜고 `extension/chrome` 폴더를 `Load unpacked`로 불러옵니다.
3. 확장 옵션 페이지에서 ingest endpoint를 `http://127.0.0.1:4318/events`로 설정합니다.
4. 브라우저에서 안전한 테스트 동작을 수행합니다.
5. 수집 결과를 분석합니다.

```bash
npm run dev -- analyze --data-dir ./tmp/live-data
npm run dev -- report --data-dir ./tmp/live-data
```

### Windows 수집기 흐름

이 저장소에는 Windows에서 active-window 변경을 수집하고 NDJSON으로 저장하거나 로컬 ingest 서버로 전송하는 PowerShell 수집기가 포함되어 있습니다.

일반적인 사용 예:

```powershell
pwsh -File ".\collectors\windows\active-window-collector.ps1" -OutputPath ".\events.ndjson"
```

또는 로컬 ingest 서버로 직접 전송:

```powershell
pwsh -File ".\collectors\windows\active-window-collector.ps1" -IngestUrl "http://127.0.0.1:4318/events"
```

### macOS 수집기 흐름

이 저장소에는 macOS용 Swift 수집기도 포함되어 있습니다. 추가 권한 없이 전면 앱을 수집할 수 있고, Accessibility 권한이 있으면 포커스된 윈도우 제목도 함께 수집합니다.

1. 현재 권한 상태 확인:

```bash
swift ./collectors/macos/active-window-collector.swift --check-permissions --json
```

2. `accessibilityTrusted`가 `false`라면 `System Settings > Privacy & Security > Accessibility`에서 권한을 부여합니다.
3. 현재 전면 앱을 한 번만 stdout으로 확인:

```bash
swift ./collectors/macos/active-window-collector.swift --once --stdout
```

4. 라이브 이벤트를 NDJSON으로 저장:

```bash
swift ./collectors/macos/active-window-collector.swift --output-path ./tmp/macos-events.ndjson
```

5. 또는 로컬 ingest 서버로 직접 전송:

```bash
swift ./collectors/macos/active-window-collector.swift --ingest-url http://127.0.0.1:4318/events
```

선택 사항: 재사용할 바이너리로 먼저 컴파일:

```bash
swiftc ./collectors/macos/active-window-collector.swift -o ./tmp/macos-active-window-collector
./tmp/macos-active-window-collector --once --stdout
```

### macOS 단일 머신 end-to-end 테스트

한 대의 macOS 머신에서 전체 로컬 흐름을 검증하는 가장 빠른 순서입니다.

1. ingest 서버 시작:

```bash
npm run dev -- serve --data-dir ./tmp/macos-live-data --host 127.0.0.1 --port 4318
```

2. 다른 터미널에서 macOS 수집기 시작:

```bash
swift ./collectors/macos/active-window-collector.swift --ingest-url http://127.0.0.1:4318/events
```

3. 필요하면 Chrome 확장도 같은 ingest URL로 연결합니다.
4. 데스크톱 앱과 브라우저 탭을 몇 번 전환합니다.
5. 분석과 리포트 실행:

```bash
npm run dev -- analyze --data-dir ./tmp/macos-live-data
npm run dev -- report --data-dir ./tmp/macos-live-data --json
```

### 워크플로우 검토와 LLM-safe export

워크플로우 목록:

```bash
npm run dev -- workflow:list --data-dir ./tmp/local-data --json
```

워크플로우 cluster 상세 보기:

```bash
npm run dev -- workflow:show <workflow-id> --data-dir ./tmp/local-data --json
```

세션 목록:

```bash
npm run dev -- session:list --data-dir ./tmp/local-data --json
```

세션 step 상세 보기:

```bash
npm run dev -- session:show <session-id> --data-dir ./tmp/local-data --json
```

세션 삭제 후 자동 재분석:

```bash
npm run dev -- session:delete <session-id> --data-dir ./tmp/local-data
```

원시 로그를 제외한 요약 payload 출력:

```bash
npm run dev -- llm:payloads --data-dir ./tmp/local-data
```

OpenAI로 요약 payload 분석:

```bash
export OPENAI_API_KEY="your-api-key"
npm run dev -- llm:analyze --data-dir ./tmp/local-data --json
```

macOS Keychain에 OpenAI API 키 저장:

```bash
npm run dev -- credential:set-openai
```

보안 자격 증명 상태 확인:

```bash
npm run dev -- credential:status
```

저장된 OpenAI API 키 삭제:

```bash
npm run dev -- credential:delete-openai
```

LLM이 제안한 workflow 이름을 로컬 rename feedback으로 저장:

```bash
npm run dev -- llm:analyze --data-dir ./tmp/local-data --apply-names --json
```

저장된 LLM 분석 결과 조회:

```bash
npm run dev -- llm:results --data-dir ./tmp/local-data --json
```

로컬 mock endpoint로 테스트:

```bash
npm run dev -- llm:analyze --data-dir ./tmp/local-data --base-url http://127.0.0.1:4545/v1 --json
```

이 경로는 요약 payload만 전송하며 raw log, URL, window title은 보내지 않습니다.
macOS에서는 `llm:analyze`가 Keychain의 키를 우선 사용하고, 없으면 `OPENAI_API_KEY`를 사용합니다.

<a id="zh"></a>
## 中文

### 项目说明

**What I've Done** 是一个基于 TypeScript 的 CLI 应用，用于分析桌面和 Chrome 中重复执行的工作流程。它会把活动元数据保存在本地 SQLite 中，将原始事件标准化，再按会话进行分组，把相似会话聚类为工作流，并输出用于识别自动化机会的报告。

当前仓库的重点是**工作流分析与发现**，而不是自动化执行。它主要帮助回答以下问题：

- 哪些工作流重复最频繁？
- 每个工作流消耗了多少时间？
- 哪些工作流更适合浏览器自动化、桌面自动化或混合自动化？

### 当前已实现功能

- TypeScript CLI
- 基于 `node:sqlite` 的本地 SQLite 存储
- 写入前的敏感元数据清洗
- 可重复的 mock 工作流生成器
- JSON 与 NDJSON 原始事件导入
- 用于实时采集的本地 HTTP ingest 服务
- 用于浏览器活动元数据采集的 Chrome 扩展脚手架
- 第一个用于 Windows active-window 变化的原生 PowerShell 采集脚本
- 工作流聚类与报告输出
- 对工作流进行重命名、排除、重新包含、隐藏、取消隐藏的反馈持久化
- 会话列表与会话删除后自动重新分析
- 可安全发送给 LLM 的摘要工作流 payload 导出

### 尚未实现的功能

- Windows 点击、文件操作、剪贴板采集器
- 桌面 UI
- 工作流反馈 UI
- 直接的 LLM provider 集成
- 安全凭证存储

### 分析流程

1. 从 mock 数据、导入文件、本地 ingest 服务或 Windows 采集器接收原始事件。
2. 在写入 SQLite 之前先清洗敏感字段。
3. 将原始事件标准化为 `application_switch`、`page_navigation`、`button_click`、`form_submit` 等语义动作。
4. 将事件分组为会话。
5. 将相似会话聚类为工作流。
6. 基于这些工作流输出报告和 LLM-safe 摘要 payload。

当前代码中的默认启发式规则：

- 会话空闲切分阈值：5 分钟
- 上下文切分阈值：90 秒以上间隔并伴随应用或域名变化
- 工作流最短会话时长：60 秒
- 工作流最小频次：7 天内至少 3 个相似会话

### 隐私原则

会收集的元数据：

- 应用名称
- 窗口标题
- URL 与域名
- 事件动作与目标提示
- 时间戳
- 会话结构

绝不会收集：

- 原始键盘输入
- 密码
- 邮件正文
- 文档正文
- 剪贴板文本
- 认证令牌或 Cookie
- 连续截图或屏幕录像

### 环境要求

- Node.js `22.x` 或更高版本
- npm `10.x` 或更高版本
- 如需实时浏览器采集，需要 Chrome
- 如需运行 Windows active-window 采集器，需要 Windows PowerShell

说明：

- 当前 SQLite 由 Node 的 `node:sqlite` 提供。
- 在 Node 22 下运行时可能会看到 experimental 警告。
- 该警告不会影响 CLI 的正常使用。

### 安装方法

安装依赖：

```bash
npm install
```

建议先执行验证：

```bash
npm run typecheck
npm test
npm run build
```

本地运行：

```bash
npm run dev -- doctor
```

可选：链接为全局 CLI：

```bash
npm link
what-ive-done doctor
```

### 快速开始

最快的演示方式：

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

JSON 输出：

```bash
npm run dev -- demo --data-dir ./tmp/demo-data --json
```

分步骤本地流程：

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- report --data-dir ./tmp/local-data
```

常用报告选项：

```bash
npm run dev -- report --data-dir ./tmp/local-data --json
npm run dev -- report --data-dir ./tmp/local-data --json --include-excluded
npm run dev -- report --data-dir ./tmp/local-data --json --include-hidden
```

### 额外数据输入方式

导入 JSON 或 NDJSON 事件：

```bash
npm run dev -- import:events ./fixtures/windows-active-window-sample.ndjson --data-dir ./tmp/import-data
```

查看可用采集器：

```bash
npm run dev -- collector:list --json
```

查看 Windows 采集器信息：

```bash
npm run dev -- collector:windows:info --json
```

### Chrome 扩展实时测试

1. 启动本地 ingest 服务：

```bash
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
```

2. 打开 `chrome://extensions`，启用 `Developer mode`，并通过 `Load unpacked` 加载 `extension/chrome`。
3. 在扩展选项页中将 ingest endpoint 设置为 `http://127.0.0.1:4318/events`。
4. 在浏览器中执行安全的测试操作。
5. 分析采集结果：

```bash
npm run dev -- analyze --data-dir ./tmp/live-data
npm run dev -- report --data-dir ./tmp/live-data
```

### Windows 采集器流程

仓库中包含一个 PowerShell 采集器，可在 Windows 上采集 active-window 变化，并写入 NDJSON 或直接发送到本地 ingest 服务。

常见用法：

```powershell
pwsh -File ".\collectors\windows\active-window-collector.ps1" -OutputPath ".\events.ndjson"
```

或直接发送到本地 ingest 服务：

```powershell
pwsh -File ".\collectors\windows\active-window-collector.ps1" -IngestUrl "http://127.0.0.1:4318/events"
```

### 工作流审查与 LLM-safe 导出

工作流列表：

```bash
npm run dev -- workflow:list --data-dir ./tmp/local-data --json
```

会话列表：

```bash
npm run dev -- session:list --data-dir ./tmp/local-data --json
```

删除会话并自动重新分析：

```bash
npm run dev -- session:delete <session-id> --data-dir ./tmp/local-data
```

输出排除原始日志的摘要 payload：

```bash
npm run dev -- llm:payloads --data-dir ./tmp/local-data
```

<a id="ja"></a>
## 日本語

### プロジェクト説明

**What I've Done** は、デスクトップと Chrome 上で繰り返される作業フローを分析する TypeScript 製 CLI アプリケーションです。操作メタデータをローカル SQLite に保存し、Raw Event を正規化してセッション化し、類似するセッションをワークフローとしてクラスタリングし、自動化候補を見つけるためのレポートを出力します。

現在のリポジトリの目的は**自動化の実行ではなく、ワークフロー分析と発見**です。主に次のような問いに答えることを狙っています。

- どのワークフローが最も頻繁に繰り返されているか
- 各ワークフローにどれだけ時間がかかっているか
- ブラウザ自動化、デスクトップ自動化、またはハイブリッド自動化のどれが適しているか

### 現在実装されている機能

- TypeScript CLI
- `node:sqlite` によるローカル SQLite ストレージ
- 保存前の機密メタデータサニタイズ
- 再現可能な mock ワークフロー生成器
- JSON / NDJSON の Raw Event import
- ライブ収集用のローカル HTTP ingest サーバー
- ブラウザ活動メタデータ用 Chrome 拡張スキャフォールド
- Windows の active-window 変化を収集する最初のネイティブ PowerShell コレクタ
- ワークフロークラスタリングとレポート出力
- 名前変更、除外、再表示、非表示解除を含むワークフローフィードバック保存
- セッション一覧表示と削除後の自動再分析
- LLM に送っても比較的安全な要約ワークフロー payload 出力

### まだ未実装の機能

- クリック、ファイル操作、クリップボード向け Windows コレクタ
- デスクトップ UI
- ワークフローフィードバック UI
- 直接的な LLM provider 連携
- セキュアな認証情報保存

### 分析パイプライン

1. mock データ、import ファイル、ローカル ingest サーバー、Windows コレクタから Raw Event を取得します。
2. SQLite に保存する前に機密フィールドをサニタイズします。
3. Raw Event を `application_switch`、`page_navigation`、`button_click`、`form_submit` などの意味的なアクションに正規化します。
4. イベントをセッションにまとめます。
5. 類似するセッションをワークフローにクラスタリングします。
6. その結果からレポートと LLM-safe な要約 payload を生成します。

現在のコードにおける既定ヒューリスティック：

- セッション無操作分割: 5 分
- コンテキスト分割: 90 秒以上の間隔 + アプリまたはドメイン変更
- ワークフロー最小セッション長: 60 秒
- ワークフロー最小出現頻度: 7 日以内に類似セッション 3 回

### プライバシー方針

収集するメタデータ：

- アプリケーション名
- ウィンドウタイトル
- URL とドメイン
- イベントアクションと対象ヒント
- タイムスタンプ
- セッション構造

収集しない情報：

- 生のキーストローク
- パスワード
- メール本文
- ドキュメント本文
- クリップボードテキスト
- 認証トークンや Cookie
- 連続スクリーンショットや画面録画

### 動作要件

- Node.js `22.x` 以上
- npm `10.x` 以上
- ライブブラウザ収集を試す場合は Chrome
- Windows active-window コレクタを動かす場合は Windows PowerShell

補足：

- 現在の SQLite は Node の `node:sqlite` を利用しています。
- Node 22 では実行時に experimental 警告が表示されることがあります。
- それでも CLI は通常どおり動作します。

### インストール方法

依存関係をインストール：

```bash
npm install
```

推奨確認手順：

```bash
npm run typecheck
npm test
npm run build
```

ローカル実行：

```bash
npm run dev -- doctor
```

任意: グローバル CLI としてリンク：

```bash
npm link
what-ive-done doctor
```

### クイックスタート

最速のデモ:

```bash
npm run dev -- demo --data-dir ./tmp/demo-data
```

JSON 出力：

```bash
npm run dev -- demo --data-dir ./tmp/demo-data --json
```

段階的なローカル実行：

```bash
npm run dev -- init --data-dir ./tmp/local-data
npm run dev -- collect:mock --data-dir ./tmp/local-data
npm run dev -- analyze --data-dir ./tmp/local-data
npm run dev -- report --data-dir ./tmp/local-data
```

よく使うレポートオプション：

```bash
npm run dev -- report --data-dir ./tmp/local-data --json
npm run dev -- report --data-dir ./tmp/local-data --json --include-excluded
npm run dev -- report --data-dir ./tmp/local-data --json --include-hidden
```

### 追加データ入力方法

JSON または NDJSON のイベントを import：

```bash
npm run dev -- import:events ./fixtures/windows-active-window-sample.ndjson --data-dir ./tmp/import-data
```

利用可能なコレクタ一覧：

```bash
npm run dev -- collector:list --json
```

Windows コレクタ情報：

```bash
npm run dev -- collector:windows:info --json
```

### Chrome 拡張のライブテスト

1. ローカル ingest サーバーを起動：

```bash
npm run dev -- serve --data-dir ./tmp/live-data --host 127.0.0.1 --port 4318
```

2. `chrome://extensions` を開き、`Developer mode` を有効にして `extension/chrome` を `Load unpacked` で読み込みます。
3. 拡張オプション画面で ingest endpoint を `http://127.0.0.1:4318/events` に設定します。
4. ブラウザで安全なテスト操作を行います。
5. 収集結果を分析します。

```bash
npm run dev -- analyze --data-dir ./tmp/live-data
npm run dev -- report --data-dir ./tmp/live-data
```

### Windows コレクタの流れ

このリポジトリには、Windows で active-window 変化を収集し、NDJSON に保存するかローカル ingest サーバーへ送信する PowerShell コレクタが含まれています。

典型的な使い方：

```powershell
pwsh -File ".\collectors\windows\active-window-collector.ps1" -OutputPath ".\events.ndjson"
```

またはローカル ingest サーバーへ直接送信：

```powershell
pwsh -File ".\collectors\windows\active-window-collector.ps1" -IngestUrl "http://127.0.0.1:4318/events"
```

### ワークフロー確認と LLM-safe export

ワークフロー一覧：

```bash
npm run dev -- workflow:list --data-dir ./tmp/local-data --json
```

セッション一覧：

```bash
npm run dev -- session:list --data-dir ./tmp/local-data --json
```

セッション削除後に自動再分析：

```bash
npm run dev -- session:delete <session-id> --data-dir ./tmp/local-data
```

生ログを含まない要約 payload を出力：

```bash
npm run dev -- llm:payloads --data-dir ./tmp/local-data
```

<a id="technical-reference"></a>
## Technical Reference

### CLI Commands

| Command | Description |
| --- | --- |
| `doctor` | Print runtime information and default storage paths. |
| `init` | Initialize local SQLite storage. |
| `collect:mock` | Insert deterministic sample events for testing. |
| `import:events` | Import raw events from a JSON or NDJSON file. |
| `analyze` | Normalize events, build sessions, and detect workflows. |
| `collector:list` | List available collectors and scripts. |
| `collector:macos:info` | Show macOS collector usage, permissions, and file paths. |
| `collector:windows:info` | Show Windows collector usage and file paths. |
| `report` | Print workflow report as a table or JSON. |
| `workflow:list` | List workflow clusters with feedback state. |
| `workflow:show` | Show one workflow cluster in detail. |
| `workflow:rename` | Rename a workflow cluster. |
| `workflow:exclude` | Exclude a workflow cluster from report output. |
| `workflow:include` | Re-include an excluded workflow cluster. |
| `workflow:hide` | Hide an incorrect workflow cluster. |
| `workflow:unhide` | Show a hidden workflow cluster again. |
| `session:list` | List analyzed sessions. |
| `session:show` | Show one analyzed session with ordered steps. |
| `session:delete` | Delete a session's source events and rerun analysis. |
| `llm:payloads` | Print summarized workflow payloads without raw logs. |
| `llm:analyze` | Run summarized workflow analysis through the OpenAI adapter. |
| `llm:results` | List stored LLM analysis results. |
| `credential:status` | Show secure credential backend status. |
| `credential:set-openai` | Store the OpenAI API key in secure OS credential storage. |
| `credential:delete-openai` | Delete the stored OpenAI API key from secure storage. |
| `serve` | Run the local HTTP ingest server for collectors. |
| `demo` | Reset data, seed mock events, run analysis, and print a report. |
| `reset` | Delete all locally stored events and analysis artifacts. |

### Default Local Storage Paths

- Windows: `%APPDATA%/what-ive-done/`
- macOS: `~/Library/Application Support/what-ive-done/`
- Linux: `$XDG_DATA_HOME/what-ive-done/` or `~/.local/share/what-ive-done/`

Run this to print the actual path used on your machine:

```bash
npm run dev -- doctor
```

### Project Structure

- `src/cli.ts`: CLI entry point and command definitions
- `src/storage/database.ts`: SQLite persistence layer
- `src/storage/schema.ts`: database schema
- `src/privacy/sanitize.ts`: sensitive metadata filtering
- `src/importers/events.ts`: JSON and NDJSON event import
- `src/collectors/mock.ts`: deterministic mock event generator
- `src/collectors/index.ts`: shared collector registry
- `src/collectors/macos.ts`: macOS collector metadata and script lookup
- `src/collectors/windows.ts`: Windows collector metadata and script lookup
- `collectors/macos/active-window-collector.swift`: macOS active-window collector script
- `collectors/windows/active-window-collector.ps1`: Windows active-window collector script
- `src/pipeline/normalize.ts`: raw event normalization
- `src/pipeline/sessionize.ts`: session boundary logic
- `src/pipeline/cluster.ts`: workflow clustering heuristics
- `src/reporting/report.ts`: report formatting
- `src/llm/payloads.ts`: summarized LLM-safe workflow payload builder
- `src/llm/openai.ts`: OpenAI Responses API adapter for workflow analysis
- `src/credentials/store.ts`: secure credential storage abstraction and macOS Keychain integration
- `src/server/ingest-server.ts`: local HTTP ingest server
- `src/server/ingest.ts`: incoming collector payload coercion
- `extension/chrome`: Chrome extension scaffold for live browser collection

### Known Limitations

- Browser ingestion currently uses a local HTTP endpoint without authentication.
- Browser collection is for local development and proof-of-concept validation.
- The Windows and macOS native collectors currently capture only active-window changes.
- macOS window title capture depends on Accessibility permission.
- Workflow naming remains heuristic.
- Report output is CLI-only.
- Secure credential storage is implemented only for macOS Keychain today.
