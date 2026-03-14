# Product Requirements
## What I’ve done

---

# 1. Product Definition

**What I’ve done** is a local workflow pattern analyzer designed for internal employees.

The system observes desktop and browser activity, groups actions into sessions,
detects repetitive workflows, and produces daily, weekly, and long-horizon reports
identifying potential automation opportunities.

This product is **not an automation tool**.

Automation execution will be considered only in future phases.

---

# 2. Product Objectives

Primary objectives:

1. Capture workflow behavior locally.
2. Identify repetitive tasks.
3. Quantify time spent on workflows.
4. Surface useful daily and weekly summaries before long-horizon patterns fully converge.
5. Recommend automation opportunities.

The system should help answer:

- What did I spend time on today?
- Which workflows repeated most this week?
- What tasks are repeated most frequently?
- Which workflows consume the most time?
- Which workflows could be automated?

---

# 3. Target Users

Internal employees performing operational or repetitive PC tasks.

Examples include:

- Operations teams
- Customer support agents
- Administrative staff
- Back-office operators
- Product operations

---

# 4. MVP Scope

The MVP includes the following capabilities.

## Activity Collection

Capture activity metadata from:

### Windows

- Active application name
- Window title
- Application switch events
- Mouse click metadata
- Clipboard usage events (without content)
- File operations metadata
- Timestamp of interaction

### macOS

Initial macOS support is included in the MVP so the product can be tested and used locally
without a separate Windows machine.

The first macOS release focuses on the minimum desktop signals needed for workflow detection:

- Active application name
- Window title when available and permitted by macOS privacy settings
- Application switch events
- Timestamp of interaction
- Collector metadata such as bundle identifier or process identifier when available

The initial macOS collector does **not** need full parity with every Windows-specific desktop
signal before the MVP can ship.

### Chrome

- URL
- Tab title
- Domain
- Navigation events
- Click metadata
- Form submission metadata
- Upload/download events
- Page interaction hints (DOM metadata when available)

The same Chrome extension flow should work on both Windows and macOS by sending browser
metadata to the local ingest server.

---

# 5. Data Exclusions

The following data must never be collected:

- Raw keystrokes
- Password values
- Email body content
- Document content
- Clipboard text
- Authentication tokens
- Session cookies
- Full screen recordings
- Continuous screenshots

Only behavioral metadata should be collected.

---

# 6. Local Storage

All collected data must be stored locally using:

SQLite

No remote storage is allowed in the MVP.

Users must be able to:

- delete all stored data
- delete individual sessions
- exclude workflows from analysis
- reset the database

Suggested storage location:

- OS standard application data directory

Examples:

Windows:
`%APPDATA%/what-ive-done/`

macOS:
`~/Library/Application Support/what-ive-done/`

---

# 7. Event Processing Pipeline

Collected events must pass through the following processing pipeline.

1. Raw Event Collection  
2. Event Normalization  
3. Sessionization  
4. Workflow Clustering  
5. LLM Interpretation  
6. Report Generation

---

# 8. Event Normalization

Raw system events must be converted into semantic events.

Example mapping:

| Raw Signal | Normalized Event |
|-------------|------------------|
Mouse click | button_click |
Tab navigation | page_navigation |
File download | file_download |
Form submission | form_submit |
App switch | application_switch |

Normalized events should include:

- timestamp
- application
- domain
- action type
- optional metadata

Example normalized event:

```
{
  "timestamp": "2026-03-14T10:12:23Z",
  "application": "chrome",
  "domain": "admin.internal",
  "action": "button_click",
  "target": "search_order"
}
```

---

# 9. Sessionization

Events must be grouped into workflow sessions.

A session represents a single coherent work activity.

Session boundaries may occur when:

- inactivity threshold exceeded
- application context changes significantly
- domain context changes significantly

Suggested default inactivity threshold:

5 minutes

Each session must store:

- session_id
- start_time
- end_time
- primary_application
- primary_domain
- ordered list of steps

---

# 10. Workflow Detection

Sessions are analyzed to detect repetitive workflows.

A workflow cluster is defined as a group of similar sessions.

Initial detection criteria:

- workflow appears at least **3 times within 7 days**
- step sequence similarity exceeds threshold
- application/domain context is similar
- minimum duration threshold (for example > 1 minute)

These criteria define **confirmed workflow clusters** used for automation-oriented analysis.
Shorter-horizon reports may additionally surface **emerging workflows** that have not yet met
the confirmed-cluster threshold.

For each detected workflow cluster the system must produce:

- workflow name (auto generated)
- frequency
- average duration
- total duration
- representative steps
- automation suitability score
- recommended automation approach

---

# 11. LLM Analysis

LLM usage is limited to **interpretation and summarization**.

The LLM may be used to:

- generate human-readable workflow names
- summarize workflow descriptions
- evaluate automation suitability
- recommend automation approaches
- produce readable reports

Only summarized workflow information may be sent to the LLM.

Example LLM payload:

```
{
  "workflow_steps": [
    "open order admin page",
    "search order id",
    "check shipping status",
    "send response in Slack"
  ],
  "frequency": 21,
  "average_duration_seconds": 125,
  "applications": ["chrome", "slack"],
  "domains": ["admin.internal"]
}
```

Raw activity logs must **never** be sent to external services.

---

# 12. LLM Authentication

The system must support two authentication methods:

### BYOK (Bring Your Own Key)

Users provide their own API key.

### OAuth Login

Users authenticate using a provider account.

API keys must be stored using **OS secure credential storage**.

Examples:

Windows:
- Credential Manager
- DPAPI

macOS:
- Keychain

Plaintext storage is prohibited.

---

# 13. Reports

The application must generate local analysis reports in multiple time windows.

Required report types for the MVP:

- all-time report for the full locally stored dataset
- daily report for one local calendar day
- weekly report for the latest 7 days ending on the selected local report date

Daily and weekly reports must remain useful even before the system accumulates 1-2 weeks of data.
When confirmed workflow clusters are not yet available, the report may label items as
emerging workflows or provisional patterns instead of final automation candidates.

Required metrics per confirmed workflow:

- workflow name
- frequency
- average duration
- total duration
- automation suitability
- recommended automation approach

Required summary fields for daily and weekly reports:

- report window start and end
- total captured sessions
- total tracked time
- top workflows by frequency or total duration
- emerging workflows when confidence is still low

Example report entry:

Workflow: Order status lookup  
Frequency: 23  
Average Duration: 2m 10s  
Automation Suitability: High  
Recommendation: Browser automation

---

# 14. Automation Suitability

Automation suitability is an estimate of how easily a workflow could be automated.

Factors may include:

- repetition frequency
- consistency of step sequence
- variability of input
- browser dominance
- number of manual steps
- external system dependency

Output categories:

- High
- Medium
- Low

---

# 15. User Feedback

Users must be able to adjust workflow results.

Supported actions:

- rename workflow
- exclude workflow
- delete session
- hide incorrect clusters

User feedback must be persisted locally.

---

# 16. Security Requirements

The system must enforce the following rules:

- API keys stored only in OS credential storage
- no plaintext secrets stored in configuration files
- sensitive data filtered before database insertion
- only summarized workflow data allowed for external transmission
- data deletion available to users at any time

---

# 17. Non Goals

The following features are explicitly out of scope for the MVP:

- automated workflow execution
- robotic process automation
- auto clicking or typing
- cloud synchronization
- multi-user analytics
- organization dashboards
- mobile support

---

# 18. PoC Success Criteria

The MVP is considered successful if the following conditions are met:

1. users can run the system continuously for **1–2 weeks**
2. users can inspect a useful daily report after one working day of data collection
3. users can inspect a useful weekly report after one week of data collection
4. at least **5 repetitive workflows** are detected over the longer 1-2 week horizon
5. detected workflows match real user activity
6. time spent per workflow is measurable
7. automation candidates are suggested
8. no sensitive information is transmitted externally
9. API keys are never stored in plaintext

---

# 19. Future Considerations (Post-MVP)

Possible future enhancements:

- deeper macOS desktop event coverage
- automation script generation
- team-level analytics
- enterprise SSO integration
- internal workflow knowledge base
- automation execution engine

These are **not part of the MVP scope**.
