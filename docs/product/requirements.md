# Product Requirements
## What I've Done

---

# 1. Product Definition

**What I've Done** is a local-first workflow discovery product for internal employees.

The product observes desktop and browser activity metadata, converts noisy events into
stable workflow signals, discovers repeated work patterns, and produces reports that help
users understand what they do often and what may be worth automating themselves.

This product is:

- a workflow discovery tool
- a repetitive task analysis tool
- a builder enablement tool

This product is **not**:

- a surveillance tool
- an automation execution tool
- an auto-clicking or unsafe action runner

---

# 2. Product Objectives

Primary objectives:

1. Capture workflow behavior locally.
2. Normalize noisy events into stable contexts.
3. Convert low-level events into understandable actions.
4. Split activity into explainable task sessions.
5. Detect repeated workflows across real usage.
6. Let users correct workflow meaning locally.
7. Recommend practical automation approaches without executing them.

The system should help answer:

- What did I spend time on today?
- Which workflows repeated most this week?
- Which workflows consumed the most time?
- Which workflows are likely worth automating?
- What kind of automation could I build for them?

---

# 3. Target Users

Internal employees performing operational or repetitive PC tasks.

Examples:

- operations teams
- customer support agents
- administrative staff
- back-office operators
- product operations

---

# 4. MVP Scope

The MVP includes:

- local metadata collection from Windows, macOS, and Chrome
- deterministic event normalization
- rule-based action abstraction
- configurable session segmentation
- explainable workflow pattern mining with near-match grouping
- local workflow feedback persistence and reuse
- workflow-centric reports and stored snapshots
- practical automation hints for likely candidates

No remote storage is allowed in the MVP.

---

# 5. Data Collection

## Windows

- active application name
- window title
- application switch events
- mouse click metadata
- clipboard usage events without content
- file operation metadata
- timestamp of interaction

## macOS

- active application name
- window title when available and permitted
- application switch events
- timestamp of interaction
- collector metadata such as bundle identifier or process identifier when available

## Chrome

- URL
- tab title
- domain
- navigation events
- click metadata
- form submission metadata
- upload or download events
- page interaction hints when available

The Chrome extension flow should work on both Windows and macOS by sending browser metadata
to the local ingest server.

---

# 6. Privacy and Exclusions

The product must store behavioral metadata only.

The following must never be collected:

- raw keystrokes
- password values
- email body content
- document content
- clipboard text
- authentication tokens
- session cookies
- full screen recordings
- continuous screenshots

---

# 7. Local Storage

All collected and derived data must be stored locally in SQLite.

Users must be able to:

- delete all stored data
- delete individual sessions
- exclude workflows from analysis
- reset the database

The system must preserve raw event storage and use additive schema changes when possible.

---

# 8. Event Processing Pipeline

Collected events must pass through the following pipeline:

1. Raw Event Collection
2. Event Normalization
3. Action Abstraction
4. Session Segmentation
5. Workflow Pattern Mining
6. Human Feedback Reuse
7. Report Generation
8. Optional LLM Interpretation

Each transition must expose enough internal detail for debugging when quality issues occur.

---

# 9. Event Normalization

## Goal

Reduce noise in raw activity events so similar work can be grouped correctly.

## Requirements

Normalization must derive stable fields from raw events while keeping raw fields intact.

Required normalized fields:

- `app_name_normalized`
- `domain`
- `url`
- `path_pattern`
- `page_type`
- `resource_hint`
- `title_pattern`

## Baseline rules

- strip query parameters by default
- normalize numeric IDs in paths
- normalize UUID-like strings in paths
- normalize identifier-like values in titles
- group similar admin pages into stable page types

## Constraints

- deterministic
- rule-based by default
- configurable and extensible
- suitable for local execution without network dependence

---

# 10. Action Abstraction

## Goal

Convert normalized low-level events into semantic action units that humans can understand.

## Inputs

- normalized app name
- domain
- path pattern
- page type
- title pattern
- event type
- nearby event context

## Outputs

Each normalized event must produce:

- `action_name`
- `action_confidence`
- `action_source`

`action_source` must support at least:

- `rule`
- `inferred`
- `user_labeled`

## Requirements

- default path must work locally with rules
- LLM dependence is optional and must not be required
- ambiguous cases may fall back to inferred labels with lower confidence

---

# 11. Session Segmentation

## Goal

Split flat activity streams into meaningful task sessions.

## Baseline heuristics

- idle-gap segmentation
- context-shift segmentation
- interruption reset detection

## Suggested defaults

- inactivity threshold: 120 to 180 seconds
- stronger split when both inactivity and context change occur

## Required outputs

Each session must store:

- `session_id`
- `start_time`
- `end_time`
- `primary_application`
- `primary_domain`
- `session_boundary_reason`
- `session_boundary_details`
- ordered list of steps

Boundary reasons must be explainable.

---

# 12. Workflow Pattern Mining

## Goal

Detect repeated workflows across sessions, including near matches.

## MVP approach

The implementation may combine:

- sequence similarity
- n-gram style matching
- frequent subsequence logic

Explainability is more important than optimization for the MVP.

## Requirements

Workflow mining must support near-match grouping, not only exact matches.

Each detected workflow pattern must provide:

- `workflow_id`
- `workflow_signature`
- representative sequence
- occurrence count
- average duration
- total duration
- involved apps
- confidence score
- top variants

Confirmed patterns for automation-oriented reporting should normally appear at least
3 times within 7 days, but short-horizon reports may surface provisional patterns.

---

# 13. Human Feedback Loop

## Goal

Allow users to correct discovered workflows and improve future interpretation.

## Required user feedback fields

For each workflow pattern, the product must allow:

- assigning a workflow name
- describing its business purpose
- marking it repetitive or not
- marking it as an automation candidate or not
- selecting automation difficulty: `low`, `medium`, `high`
- merging it into another workflow
- splitting it after a selected action when clustering was wrong
- excluding or hiding it from reporting
- approving an automation candidate

## Persistence requirements

Feedback must be stored locally and reused on later analyses.

The system must persist:

- workflow labels
- business purpose
- user corrections
- ignore rules
- approved automation candidates

Feedback reuse should prefer workflow signatures rather than only transient cluster IDs.

---

# 14. Reporting and Visualization

## Goal

Make results understandable for non-technical employees and useful for builder growth.

## Required report windows

- all-time report
- daily report for one local calendar day
- weekly report for the latest 7 days ending on the selected local report date

## Required workflow fields in reports

Each workflow report entry must include:

- workflow name
- optional business purpose
- representative step sequence
- frequency
- frequency per week
- average duration
- estimated total time spent
- involved tools or apps
- automation suitability score
- confidence score
- labeled or unlabeled state
- simple graph view

## Required summary sections

- top repetitive workflows
- highest time-consuming repetitive workflows
- quick-win automation candidates
- workflows needing human judgment

Short-horizon windows may show provisional emerging workflows before long-horizon patterns converge.

---

# 15. Automation Hints

## Goal

Help users move from insight to action without executing automation.

## Required hint fields

Each likely automation candidate should provide one or more hints with:

- suggested approach
- why the approach fits
- estimated difficulty
- prerequisites
- expected time savings

## Example approaches

- Python script
- Playwright
- PowerShell
- Google Apps Script
- Excel macro
- n8n workflow
- internal admin API integration

These are recommendations only.
The system must not execute automation automatically.

---

# 16. Configurability

The MVP must support configuration for at least:

- normalization rules
- session thresholds
- clustering thresholds
- reporting thresholds

Defaults should be safe and practical for real-world tuning.

---

# 17. Observability

The product must expose internal debug visibility for:

- raw event -> normalized event
- normalized event -> semantic action
- action sequence -> session
- session -> workflow cluster

The goal is to make interpretation quality debuggable when real-world accuracy problems happen.

---

# 18. Success Criteria

The MVP is successful when:

1. noisy browser and admin activity can be normalized into stable contexts
2. low-level signals are translated into human-readable action labels
3. sessions have explainable boundaries
4. repeated workflows can be detected across 1-2 weeks of usage
5. users can label, merge, split, exclude, and review workflows locally
6. reports help users recognize what they truly do often
7. practical automation hints are suggested without executing anything

---

# 19. Out of Scope for Now

The following are not required now:

- screenshot capture
- team-shared workflow dictionaries
- reusable workflow templates
- automation spec export
- automation execution engines
- remote sync

These may be considered later if architecture permits.
