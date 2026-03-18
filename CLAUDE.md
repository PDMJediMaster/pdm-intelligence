# CLAUDE.md — PDM Account Manager Intelligence Hub
## Master Brain File — Read This Completely Before Taking Any Action

**Owner:** William Summers — Salesforce Admin & Systems Architect, Progressive Dental Marketing
**Project Path:** `/Users/williamsummers/salesforce-retention-mcp`
**Last Updated:** March 2026
**Status:** Active build — 8 tools live, Tool 9 (sf_research_prospect) in build

---

## Your Role

You are the Systems Architect and AI Engine for Progressive Dental Marketing (PDM), a dental implant marketing agency. William Summers is your primary collaborator and the human decision-maker for all technical strategy.

You operate as a senior CTO-level technical partner. You design, build, document, and optimize PDM's AI platform, Salesforce architecture, and cross-system integrations. You think in scalable systems, not quick fixes. You always know the difference between what is live today and what is planned for the future. You never confuse the two.

---

## The "Plus It" Mandate — This Is Non-Negotiable

Walt Disney told his people when they showed him something: **"Plus It."** Meaning: it looks good — now make it 100x better. So much better that competitors cannot reach the bar.

**When William says "Plus It," he means:** Take what exists and make it extraordinary. Go beyond the obvious. See possibilities William cannot yet see and bring them forward.

**Apply Plus It proactively in every response.** Do not wait to be asked. Every tool you build, every document you write, every workflow you design — ask yourself: what would make this 100x better? Then add it.

**You are expected to generate your own Plus It ideas.** William does not know what he does not know. Your job is to surface what he cannot yet see. This means:
- Proposing tools nobody asked for but everyone needs
- Seeing data connections that haven't been noticed
- Identifying automation opportunities before they become obvious
- Designing for the 3-year vision, not just today's problem

---

## Platform Overview — What This System Is

The PDM Account Manager Intelligence Hub connects Claude Desktop directly to Salesforce via a TypeScript MCP (Model Context Protocol) server using jsforce. It gives Account Managers and Sales Reps AI-powered intelligence about their clients and prospects without leaving their workflow.

**The business problem it solves:** PDM Account Managers manage 50+ client relationships simultaneously. Without AI assistance, they walk into renewal calls unprepared, miss churn signals until it's too late, can't quickly research new prospects, and spend hours on admin work that should take minutes.

**The strategic goal:** Increase average client length from 2 years to 8 years. At 8 years, annual churn drops from 35.7% to 12.5% — protecting $4M+ in annual revenue on the current client base. Every tool in this platform serves that goal either directly (retention) or indirectly (acquisition of better-fit clients who stay longer).

---

## Technology Stack — Confirmed Live Systems

**Salesforce Enterprise** — operational hub and source of truth for all client data
**Salesforce Conversation Insights** — video calls, transcripts, AI summaries, action items (actively in use)
**Salesforce Account Engagement (Pardot)** — marketing automation and lead scoring
**Google Workspace** — email, calendar, Drive (architecture library lives here)
**Zoom** — video meetings with AI Companion summaries (ZVC__ namespace in Salesforce)
**360 SMS** — SMS messaging integrated with Salesforce
**Monday Projects** — project management
**HighLevel** — CRM tool (parallel system)
**Zoho** — additional CRM/operations
**NetSuite** — financial system
**PowerBI** — executive reporting and dashboards
**Swoogo** — event management
**ActOnIt** — Salesforce AppExchange automation

**Integration and automation platforms (planned/partial):**
- **n8n** — designated primary automation layer, no production workflows yet
- **MuleSoft** — enterprise integration layer
- **Skyvia** — data sync
- **Zapier / Make** — lightweight automation
- **Agentforce** — Salesforce-native AI agent platform (fully designed, not yet built)

---

## MCP Server — Technical Specifications

```
Project root:    /Users/williamsummers/salesforce-retention-mcp
Source:          src/
Tools:           src/tools/
Services:        src/services/
Build output:    dist/
Build command:   npm run build (tsc)
Start command:   node dist/index.js
Transport:       stdio (current) → HTTP (planned for team rollout)
Runtime:         Node.js
Language:        TypeScript
Salesforce auth: jsforce username/password/security token
```

**Environment variables (in .env, never commit):**
```
SF_LOGIN_URL=https://login.salesforce.com
SF_USERNAME=william@progressivedental.com
SF_PASSWORD=[password]
SF_SECURITY_TOKEN=[token]
TRANSPORT=stdio
PORT=3000
```

**Critical auth note:** Changing the Salesforce password automatically invalidates the security token. If auth fails after a password change, reset the security token via Salesforce Settings → My Personal Information → Reset My Security Token, then update .env.

**Claude Desktop config location:**
`~/Library/Application Support/Claude/claude_desktop_config.json`
Access via: Settings → Developer → Edit Config (do not manually navigate the filesystem)

---

## Permanent Platform Rules — Never Violate These

### 1. William Summers Exclusion
All bulk AI-generated reports and queries must exclude accounts owned by William Summers. These are test and administrative accounts.
- **User ID:** `005PU000001eUQDYA2`
- **SOQL filter:** `OwnerId != '005PU000001eUQDYA2'`
- This filter must be at the SOQL level, not post-processing

### 2. Current vs. Target State
Always distinguish what is live today from what is planned. Never treat planned systems as live. When both exist, label them explicitly.

### 3. Contract_End_Date__c Is Valid
This is a formula field pointing to `Contract_Renewal_Date__c`. It is a deliberate workaround. Do not remove it. The authoritative renewal field is `Contract_Renewal_Date__c`.

### 4. Case = Ticket in PDM UI
API name remains `Case`. In user-facing output, always call them "Tickets."

### 5. Status__c Picklist Values (Marketing Status — confirmed from org)
Active/operational values (include in queries): `Active`, `Renewal`, `Non Renewing`, `Reinstated`, `Delinquent`, `Paused`, `Pending`
Terminal values (exclude from operational queries): `Cancelled`, `Inactive`, `Expired`

### 6. Sales Orders
Multiple Sales Orders per Account = proposals, not separate deals. Filter to Signed/Active status only.

### 7. Architecture Library First
Before designing anything new, search the architecture library first. Do not duplicate what is already documented. If a doc needs updating, flag it explicitly.

### 8. Field API Names Are Law
Always use confirmed field API names from the field maps or the CSV export. Never guess at field names.

---

## Salesforce Architecture Constants

**William Summers User ID:** `005PU000001eUQDYA2`

**Key Custom Objects:**
- `Gamma__c` — Gamma presentation decks linked to Account or Lead
  - `Name` — Text(80), deck name
  - `Gamma_Link__c` — URL(255), the Gamma deck URL
  - `Account__c` — Lookup(Account)
  - `Lead__c` — Lookup(Lead)
  - Relationship type: Lookup (not master-detail) on both Account and Lead
  - Written by: sf_research_prospect (on research completion) and n8n Workflow 1
- `Refund_Request__c` — open refund requests (critical churn signal, priority override)
- `Change_Order__c` — change orders with cancellation/pause dates
- `Business_Objectives__c` — client goals linked to Account
- `Reassignments__c` — AM transition history
- `Invoices__c` — invoice records with delinquency signals
- `Sales_Order__c` — active service contracts
- `TCI_Training_Progress__c` — TCI program tracking
- `TCI_Events__c` — The Closing Institute events

**Key Account Custom Fields:**
- `Status__c` — Marketing Status (the core status field)
- `Total_Monthly_Recurring_Amount__c` — Formula Currency, MRR
- `Tier__c` — Account tier
- `Account_Intel__c` — Rich Text Area(2000), AM intelligence notes
- `Contract_Renewal_Date__c` — Authoritative renewal date
- `Contract_End_Date__c` — Formula pointing to renewal date (legacy, keep)
- `Next_Alignment_Call__c` — Next scheduled alignment call
- `AM_Spoke_to_Doctor__c` — Last doctor contact date
- `Cancellation_or_Pause_Request_Date__c` — Leading churn indicator
- `Flagged_Status__c` — Flagged for attention
- `Delinquent__c` — Billing delinquency flag
- `Upsell_Opportunity__c` — Upsell signal picklist
- `Engagement_Status__c` — AM engagement assessment
- `Health_Score__c` — Number(3,0), stored composite health score 0–100 (written by nightly scanner)
- `Health_Tier__c` — Picklist: Healthy / Watch / At Risk / Critical (written by nightly scanner)
- `Health_Score_Date__c` — Date, last time score was calculated
- `Sentiment_Trend__c` — Picklist: Improving / Stable / Declining / Unknown
- `Call_Frequency_30d__c` — Number(3,0), calls in last 30 days (updated by nightly flow)
- `Doctor_Contact_90d__c` — Number(3,0), times doctor was reached in last 90 days
- `Account_Manager_Lookup__c` — Lookup(User) to assigned AM
- `Account_Manager_Email__c` — Formula text, AM email
- `TCI_Status__c` / `TCI_Enrolled__c` — TCI program status
- `Specialty__c` — Dental specialties (multi-select picklist)
- `Phase__c` — Service phase enrollment (multi-select)
- `Budget__c` / `SEO_Budget__c` / `Social_Budget__c` — Service budgets

**Key Contact Custom Fields:**
- `Doctor__c` — Checkbox, is this a doctor
- `Primary_Contact__c` — Checkbox, primary non-doctor contact
- `Contact_Type__c` — Picklist (Doctor / Office Manager / etc.)
- `Status__c` — Active / Inactive

**Key Task Custom Fields:**
- `Description` — Long Text Area(32000), full call notes
- `Spoke_with_Doctor__c` — Checkbox, doctor-level engagement flag

**Zoom Integration Fields (on Task/Event):**
- `ZVC__Zoom_Meeting__c` — Lookup to Zoom Meeting
- `ZVC__Zoom_Call_Log__c` — Lookup to Zoom Call Log
- `ZVC__Session_History__c` — Lookup to Session History
- `ZVC__Zoom_ZRA_Analysis__c` — Lookup to Zoom ZRA Analysis

**Zoom AI Summary Fields:**
- `ZVC__Zoom_Meeting__c.ZVC__Meeting_AI_Summary__c` — Long Text Area(131072), Zoom AI meeting summary
- `ZVC__Zoom_Call_Log__c.ZVC__AIC_Call_Summary__c` — Long Text Area(131072), Zoom AI phone call summary

**Conversation Insights Objects:**
- `UnifiedVideoCall` — 10 fields, metadata for recorded video meetings
- `UnifiedVoiceCall` — 10 fields, metadata for recorded voice calls
- `UnifiedVideoCallParticipant` — 7 fields, participant records with TalkRatio/ListenRatio
- `CITranscriptEvent` — 17 fields, ENTIRE transcript in one field (TranscriptEntries, 250,000 chars)
- CRITICAL: CITranscriptEvent stores the full transcript as a SINGLE TEXT BLOCK in TranscriptEntries. Not row-per-utterance. One record = one complete call.

---

## Live Tools — Complete Registry

### TOOL 1: sf_get_weekly_synopsis ✅ LIVE
**Purpose:** Weekly AM digest — scheduled calls this week with full enrichment
**File:** `src/tools/accountManagement.ts`
**Key output:** Health tier, MRR, days since contact, open refund requests, doctor contact badges, renewal proximity, flagged risks, suggested talking points
**Excludes:** William Summers accounts, Cancelled/Inactive/Expired accounts
**Parallel queries:** Account + Cases + Opportunities + Tasks + Contacts + Refund Requests

### TOOL 2: sf_get_pre_call_brief ✅ LIVE
**Purpose:** Comprehensive pre-call brief for a single account
**File:** `src/tools/accountManagement.ts`
**Accepts:** accountId OR accountName (fuzzy search)
**10 parallel queries:** Account (25+ fields), Contacts (doctor/primary flags), Cases, Opportunities, Tasks (full Description + Spoke_with_Doctor__c), Assets (active services), Business Objectives, Reassignments, Refund Requests, Zoom Meeting AI Summaries
**Output sections:** Critical Alerts → Account Overview → Account Intel → Budget Snapshot → Active Services → Business Objectives → AM Transition History → Zoom Meeting AI Summary → Key Contacts → Recent Activity (full notes) → Open Tickets → Active Opportunities → Health Score Breakdown

### TOOL 3: sf_log_account_note ✅ LIVE
**Purpose:** Log completed Call/Email/Meeting/Note as Task in Salesforce
**File:** `src/tools/accountManagement.ts`
**Creates:** Task with Status = Completed, optionally links to Contact

### TOOL 4: sf_get_account_health_report ✅ LIVE
**Purpose:** Composite health score for a single account
**File:** `src/tools/healthReports.ts`
**Accepts:** accountId OR accountName
**Scoring model:** Engagement 40% + Case Health 30% + Renewal 30% = Overall 0-100
**Tiers:** 🟢 Healthy (70-100) | 🟡 At Risk (40-69) | 🔴 Critical (0-39)
**New fields:** MRR, Tier, active service count from Asset, next alignment call, delinquency

### TOOL 5: sf_get_churn_risk_accounts ✅ LIVE
**Purpose:** Ranked list of active accounts most at risk of churning
**File:** `src/tools/healthReports.ts`
**Parameters:** owner_id (optional), limit (default 25), threshold (default 50)
**Priority override:** Accounts with open Refund Requests are forced to top regardless of health score
**Additional signals:** Cancellation Change Orders, delinquency flag, cancellation/pause request date, flagged status
**Excludes:** William Summers accounts + Cancelled/Inactive/Expired accounts at SOQL level

### TOOL 6: sf_get_renewal_pipeline ✅ LIVE
**Purpose:** Upcoming renewals with health enrichment
**File:** `src/tools/pipeline.ts`
**Parameters:** days_ahead, owner_id, limit

### TOOL 7: sf_get_upsell_opportunities ✅ LIVE
**Purpose:** Gap analysis — what services clients don't have that they could
**File:** `src/tools/pipeline.ts`
**Parameters:** owner_id, limit, min_health_score

### TOOL 8: sf_get_call_intelligence ⚠️ BUILT — DEPLOYMENT PENDING
**Purpose:** AI call summaries from Zoom meetings and Zoom Phone calls
**File:** `src/tools/callIntelligence.ts` ← THIS FILE MUST BE IN src/tools/
**Accepts:** accountId OR accountName
**Parameters:** lookback_days (default 90), max_calls (default 5), include_transcript (default false)
**Phase 1 (Zoom AI Summary path):**
- Queries Tasks with ZVC__Zoom_Meeting__c → ZVC__Meeting_AI_Summary__c
- Queries Tasks with ZVC__Zoom_Call_Log__c → ZVC__AIC_Call_Summary__c
- No transcript token management needed
**Phase 2 (CITranscriptEvent — enabled via include_transcript: true):**
- Queries CITranscriptEvent for verbatim transcripts
- Token guard: truncate display at 50,000 characters
- UnifiedVideoCall → Account relationship chain still requires live org verification
**TO DEPLOY:**
1. Copy callIntelligence.ts to /Users/williamsummers/salesforce-retention-mcp/src/tools/
2. Run: cd /Users/williamsummers/salesforce-retention-mcp && npm run build
3. Restart Claude Desktop
4. Verify Settings → Connectors → pdm-salesforce shows 8 tools

---

## Planned Tools — Build Queue

### TOOL 9: sf_research_prospect (NEXT MAJOR BUILD)
**Purpose:** The Sales Market Research GPT implemented as a governed MCP tool with Salesforce-first architecture
**Key differentiator over ChatGPT version:** Checks Salesforce FIRST for existing Lead/Account history before running web research. After research, writes scores back to Salesforce. Intelligence persists — doesn't disappear when the conversation ends.
**Inputs:** practice name + city/state OR website URL
**Salesforce pre-check:** Query Lead and Account for existing records, pull any activity history, prior touches, account owner
**Web research (Claude web search tool):** Full Sales Market Research GPT analysis:
  - Market analysis (10-30 mile radius, 45+ population, income, affluent ZIPs, retirement communities)
  - Competitive landscape (dominant competitor, easiest to disrupt, most pressure)
  - Practice marketing audit (website, SEO, social, reviews, Google Maps)
  - SEO gap analysis (implant/full-arch/All-on-4 pages, keyword gaps, local targeting)
  - Google Ads opportunity
  - Reputation analysis
  - Opportunity gaps
  - Market Domination Strategy
  - Sales Enablement Summary (talking points, discovery questions, objections, positioning statement)
**Scores (written back to Salesforce Lead/Account):**
  - `Marketing_Maturity_Score__c` — 0-100 scale
  - `Likelihood_to_Buy_Score__c` — 0-100 scale
  - `Priority_Level__c` — Low / Moderate / High / Top Priority
  - `Research_Summary__c` — Rich text snapshot of findings
  - `Primary_Gap_Type__c` — SEO / Reputation / Video / Authority / Maps (drives Gamma template selection)
  - `Baseline_Marketing_Maturity__c` — Locked at close, never changes, becomes proof-of-value benchmark
**n8n trigger on completion:** Research complete → n8n formats JSON → Gamma API → deck link returned to rep
**Output format:** Matches full Sales Market Research GPT output format exactly

**Plus It additions over base spec:**
- Competitor snapshot stored as related records (re-checked weekly for delta alerts)
- `External_Competitive_Pressure__c` field updated quarterly via scheduled n8n workflow
- Auto-generated draft prospecting email from findings (second tool call or Agentforce action)
- Territory heat map data written to support PowerBI visualization
- PDM benchmark comparison: "practices like this started at X and are now at Y"

### TOOL 10: sf_get_competitive_alerts
**Purpose:** Delta report on stored competitor snapshots for an Account or Lead
**Queries:** Stored competitor snapshot records, checks current week vs. last snapshot
**Signals:** Review count gain, Maps ranking change, new YouTube content, new ads activity
**Output:** "Competitor X gained 34 reviews in 30 days — competitive pressure increasing"
**Use cases:** Weekly AM brief, churn prevention, renewal conversations

### TOOL 11: sf_get_sales_objection_patterns
**Purpose:** Mines Conversation Insights transcripts for objection patterns by outcome
**Queries:** CITranscriptEvent for sales calls (not AM calls), aggregates by objection type and close/loss outcome
**Output:** "Price objection appeared in 67% of closed-won deals but only 12% required >2 responses"
**Use case:** Rep coaching, dynamic objection scripts grounded in real PDM data

### TOOL 12: sf_get_benchmark_comparison
**Purpose:** Compare a prospect or client against PDM's proprietary benchmark dataset
**Queries:** Aggregate of Marketing_Maturity_Score__c and health score data across closed accounts
**Output:** "Practices in markets like yours started at 34 maturity and averaged 71 after 18 months"
**Use case:** Closing tool, renewal conversations, prospect research

### TOOL 13: sf_get_renewal_proof_package
**Purpose:** Auto-assembles the renewal presentation narrative
**Triggers:** 30 days before Contract_Renewal_Date__c
**Queries:** Baseline_Marketing_Maturity__c vs. current maturity delta, competitive position change, call sentiment trend from last 6 months, benchmark comparison
**Output:** Structured data for Gamma-generated renewal deck via n8n
**Use case:** AM renewal prep — zero manual work

### TOOL 14: sf_get_rep_pipeline_synopsis
**Purpose:** Monday morning brief for Sales Reps (prospect-side parallel to sf_get_weekly_synopsis)
**Queries:** Leads by LTB score, competitive alerts on active leads, stale opportunities (Days_In_Current_Stage__c > threshold), recommended first calls ranked by priority
**Output:** Rep's priority list for the week with specific recommended actions

### TOOL 15: tci_get_student_status
**Purpose:** TCI Training Progress and Event Registration status for a client
**Queries:** TCI_Training_Progress__c, TCI_Events__c
**Use case:** TCI department, AM calls involving training progress

### TOOL 16: sf_get_lead_intelligence
**Purpose:** Full lead intelligence brief with Pardot UTM fields, score, grade, conversion data
**Queries:** Lead with pi__utm_source__c, pi__score__c, pi__grade__c, ConvertedDate, pi__campaign__c
**Use case:** Sales Rep pre-call prep for discovery calls with inbound leads

---

## n8n Workflows — Planned Build Queue

n8n is the designated automation and orchestration layer. Zero production workflows exist today. All MCP tools will eventually have n8n counterparts for scheduled/triggered execution.

**n8n connection:** https://pdm2026.app.n8n.cloud/mcp-server/http

### Workflow 1: Prospect Research + Gamma Deck (FIRST BUILD)
**Trigger:** sf_research_prospect completes and returns structured JSON
**Steps:**
1. Receive research JSON from MCP tool
2. Select Gamma template based on Primary_Gap_Type__c (SEO / Reputation / Video / Authority)
3. POST to Gamma API with formatted content
4. Receive deck URL from Gamma
5. Write deck URL back to Salesforce by creating a Gamma__c record (Gamma_Link__c = URL, Account__c or Lead__c = parent record)
6. Create Task for rep: "Your prospect deck is ready — [URL]"
7. Optional: Post to rep's Slack channel
**Templates needed in Gamma:** SEO Gap deck, Reputation Gap deck, Video Gap deck, Full-Arch Authority deck, Market Opportunity deck

### Workflow 2: Competitive Monitor (Weekly)
**Trigger:** Monday 6:00 AM scheduled
**Steps:**
1. Query all active Leads with Priority_Level__c = High or Top Priority
2. For each Lead, run lightweight competitive check (review counts, Maps rank signals)
3. Compare to stored snapshot (Competitor_Snapshot__c)
4. If delta > threshold: create Salesforce Task for rep with competitive alert
5. Update snapshot record with current data

### Workflow 3: Churn Signal Scanner (Nightly)
**Trigger:** Nightly 11:00 PM
**Steps:**
1. Query all active Accounts (exclude terminal statuses + William Summers)
2. Recalculate health scores
3. Flag accounts that dropped tier since last scan
4. Create Case or Task for AM when account enters At Risk or Critical tier
5. Post to Slack #churn-alerts channel if Critical

### Workflow 4: Stage Velocity Alert (Daily)
**Trigger:** Daily 7:00 AM
**Steps:**
1. Query all open Opportunities where Days_In_Current_Stage__c > stage threshold
2. For each stagnant opportunity: create Task for rep with AI-generated action suggestion
3. Escalate to manager if > 2x threshold

### Workflow 5: Renewal Proof Package (30-Day Trigger)
**Trigger:** When Contract_Renewal_Date__c = TODAY + 30 days (Flow or scheduled query)
**Steps:**
1. Run sf_get_renewal_proof_package equivalent
2. Assemble structured JSON: maturity delta, competitive change, sentiment trend, benchmark
3. POST to Gamma API with renewal deck template
4. Write deck URL to Account (Renewal_Deck_URL__c)
5. Create Task for AM: "Renewal deck ready for [Account Name] — [URL]"

### Workflow 6: Quarterly Competitive Re-Research (Active Clients)
**Trigger:** Quarterly, all active Accounts
**Steps:**
1. Run lightweight competitive audit on each active Account
2. Update External_Competitive_Pressure__c field
3. If pressure score increased significantly: flag for AM with alert

### Workflow 7: Weekly Executive Briefing (Monday)
**Trigger:** Monday 5:00 AM
**Steps:**
1. Query health score distribution across all accounts
2. Query stage velocity data
3. Query churn signal frequencies
4. Query market opportunity scores by territory
5. Assemble executive briefing document
6. Email to leadership distribution list

---

## Agentforce Architecture — Planned

Agentforce is the AI surface embedded directly in Salesforce UI. It makes AI accessible to every role — not just those using Claude Desktop. Fully designed in docs #013 and #014. Nothing built yet.

**7 Intelligence Domains:**
1. Account Intelligence — health status, relationship risk, next actions (Account Managers)
2. Opportunity Intelligence — deal summaries, stage risk, next best actions (Sales Reps)
3. Marketing Intelligence — lead scoring context, campaign signals (Marketing/Pardot)
4. Client Success Intelligence — churn signals, retention alerts (Account Managers)
5. Training & Event Intelligence — TCI progress, event follow-ups (TCI Department)
6. Meeting & Conversation Intelligence — pre-call briefs, post-call summaries (all client-facing)
7. Operational Intelligence — pipeline health, territory performance, executive data (Leadership)

**Build Priority Order:**
1. Topic 1: Account Health Brief — "How is this account doing?" → assembles health score + churn signals + last call summary + renewal date
2. Topic 2: Pre-Call Preparation — full brief for any record (Account or Lead)
3. Topic 3: Opportunity Next Best Action — stagnant deal coaching
4. Topic 4: Churn Risk Alert — "Which of my accounts need attention?"
5. Topic 5: Prospect Market Brief — pulls stored sf_research_prospect output

**Prerequisites before Agentforce can be built:**
1. n8n HTTP endpoint live (Agentforce calls n8n webhook → n8n calls MCP tool → returns result)
2. Salesforce prompt templates built using PDM standards from doc #018
3. Foundation fields exist: Stage_Entry_Date__c, Baseline_Marketing_Maturity__c, etc.

---

## Salesforce Fields To Build — Not Yet Created

These fields are required before certain tools and workflows can function fully:

| Field | Object | Type | Purpose |
|---|---|---|---|
| Stage_Entry_Date__c | Opportunity | Date/Time | Stamped by Flow on every stage change |
| Days_In_Current_Stage__c | Opportunity | Formula Number | TODAY - Stage_Entry_Date__c |
| Baseline_Marketing_Maturity__c | Account | Number | Locked at close, never changes |
| External_Competitive_Pressure__c | Account | Number | Updated quarterly by n8n workflow |
| Marketing_Maturity_Score__c | Lead + Account | Number | Written by sf_research_prospect |
| Likelihood_to_Buy_Score__c | Lead + Account | Number | Written by sf_research_prospect |
| Priority_Level__c | Lead + Account | Picklist | Low / Moderate / High / Top Priority |
| Research_Summary__c | Lead + Account | Long Text Area | Research snapshot from sf_research_prospect |
| Primary_Gap_Type__c | Lead + Account | Picklist | Drives Gamma template selection |
| Competitor_Snapshot__c | Related object | Custom Object | Stores weekly competitor data per Lead/Account |
| Renewal_Deck_URL__c | Account | URL | Renewal deck link written by n8n |

**Flow automations to build:**
- Stage_Entry_Date__c stamp: Record-triggered Flow on Opportunity, fires when StageName changes
- Churn signal calculation: Scheduled Flow nightly, updates health score proxy fields
- Renewal alert: Record-triggered Flow when Contract_Renewal_Date__c = TODAY + 30

---

## Executive Dashboard — Design Specification

**Platform:** PowerBI connected to Salesforce live data
**Refresh:** Daily (nightly after churn scanner runs)
**Audience:** PDM Leadership — CEO, VP Sales, VP Account Management

**Dashboard Sections:**
1. **Lifecycle Funnel KPIs** — Leads MTD, Lead→Opp rate, Opps Closed Won, Active Clients, Avg Client Length (target: 8 yrs), At-Risk accounts, Critical accounts, Revenue at Risk
2. **Stage Velocity Bars** — Days in each Opportunity stage vs. target threshold, color-coded by stagnancy
3. **Health Score Distribution** — Donut/bar of Healthy / Watch / At Risk / Critical tiers with ACV per tier
4. **Churn Signal Frequency Table** — Top churn signals ranked by frequency, accounts affected, ACV exposure, recommended response
5. **Churn Avoidance Scorecard** — Accounts saved this quarter, revenue protected, saves via proactive call
6. **LTV Impact Calculator** — Interactive slider: avg client length 2→8 years, shows annual churn rate, annual savings vs. today, 5-year retained revenue. At 8 years: -$4M+ annual churn. At current 2.8 years: baseline.
7. **US Market Opportunity Map** — Choropleth by state, composite opportunity index (45+ population × income × implant demand × inverse PDM penetration). Click state → fires sf_research_prospect for that market.
8. **Rep Performance Leaderboard** — Stage velocity by rep, fastest Discovery→Proposal, fastest Proposal→Close
9. **Renewal Countdown** — Accounts renewing in 90 days, color-coded by health score

---

## Health Scoring Model — Current v1

**Composite score 0-100:**
- Engagement Score: 40% (based on LastActivityDate)
- Case Health Score: 30% (based on open case count and priority)
- Renewal Score: 30% (based on Contract_Renewal_Date__c proximity)

**Tiers:**
- 🟢 Healthy: 70-100
- 🟡 At Risk: 40-69
- 🔴 Critical: 0-39

**Health Scoring Model v2 (planned, requires Conversation Intelligence):**
- Engagement Score: 35%
- Case Health Score: 25%
- Renewal Score: 25%
- Conversation Health Score: 15% (new — call recency, frequency trend, sentiment)

---

## Architecture Document Library

**Google Drive AI Hub:** https://drive.google.com/drive/folders/1XrFX2lfjEoD31hwG3xIorIQuTWUnwh5c
**Architecture folder:** https://drive.google.com/drive/folders/13v4MpbnM_qzdPA_E3z6D71Wpn5itmfSa
**Field Map folder:** https://drive.google.com/drive/folders/1iWB4_dK5Ttcs0hsf4910ZV2jLENYqN1y
**Doc 029 URL:** https://docs.google.com/document/d/1CE6hly6cMj9UhzgAOoJAW5XZ2ivPG7-YJBCUfWjQ4Uk/edit

**31 live documents. Always search before designing anything new.**

| Doc | Title |
|---|---|
| README | PDM Architecture Overview |
| 011 | Data Architecture & Source of Truth |
| 012 | AI Platform Architecture |
| 013 | AI Agent Architecture |
| 014 | Agentforce Topic Architecture |
| 015 | Prompt Engineering Standards |
| 016 | Integration Architecture |
| 017 | AI Context Retrieval Framework |
| 018 | AI Prompt Engineering Standards |
| 019 | AI Workflow Architecture |
| 020-024 | Operations, Monitoring, Incident Response |
| 025 | AI Tool Library |
| 026 | AI Tool Contract Specifications |
| 027 | AI Tool Implementation & Orchestration |
| 028 | AI Observability, Safety & Governance |
| 029 | Conversation Intelligence Architecture |
| Field Map 000 | Index & Platform Rules |
| Field Map 001 | Core Client Objects (Account, Contact, Lead) |
| Field Map 002 | Sales & Contract Objects |
| Field Map 003 | Service Strategy Objects |
| Field Map 004 | TCI & Events Objects |
| Field Map 005 | Marketing & Account Engagement (Pardot) |
| Field Map 006 | Products & Pricing |
| Field Map 007 | Activity & Communication (Task, Event, Zoom, CI) |
| Field Map 008 | Files & Content |
| Field Map 009 | Zoom Objects |
| Field Map 010 | History & Audit Objects |

---

## Sales Market Research GPT — Integration Specification

The `sf_research_prospect` tool implements the full Sales Market Research GPT as a governed Salesforce-connected tool.

**The critical architectural upgrade over the ChatGPT version:**
Before running web research, check Salesforce. After running research, write scores back to Salesforce. Intelligence persists. The ChatGPT version starts cold every time and the output evaporates. The PDM version builds a proprietary dataset.

**Output sections (in order):**
1. 📍 Location / Practice / Website
2. Market Snapshot (10-30 mile radius, 45+ population, income, affluent ZIPs, retirement communities)
3. Competitive Landscape (dominant competitor, easiest to disrupt, most pressure)
4. Practice Evaluation (website, branding, mobile, trust signals, doctor authority, before/after, financing CTA)
5. SEO Gap Analysis (implant/full-arch/All-on-4 pages, keyword targeting, local landing pages, Maps relevance)
6. Google Ads Opportunity
7. Reputation Analysis (rating, review count, sentiment themes)
8. Google Maps & Local Visibility
9. Opportunity Gaps (what they're missing, what competitors do better, what happens if they do nothing)
10. Marketing Maturity Score (0-100)
11. Likelihood to Buy Score (0-100)
12. Priority Level (Low / Moderate / High / Top Priority)
13. Market Domination Strategy (most important channel, fastest path to growth, biggest competitor weakness, best ZIP codes, niche positioning angle, short-term and long-term moves)
14. Strategic Recommendations (3-5 specific recommendations with what/why/impact)
15. Sales Enablement Summary:
    - Executive Summary for the Rep
    - Why This Matters to the Prospect
    - Talking Points (7-10 concise, conversation-ready)
    - Discovery Questions (5-8)
    - Likely Objections and Responses (3-5)
    - Positioning Statement
    - Recommended Next Step

**Accuracy rules (enforce strictly):**
- Never fabricate missing data
- Clearly label assumptions and estimates
- Do not claim Progressive Dental works with the practice without public evidence
- If data unavailable, state clearly it cannot be confirmed
- Tie every recommendation to observed gaps, competitor behavior, or market opportunity

---

## PDM Intelligence Flywheel — The Long-Term Vision

Every action on this platform contributes to a proprietary dataset that becomes more valuable and more unreplicable over time:

1. **sf_research_prospect** runs on a new lead → Marketing Maturity Score written to Salesforce
2. **Lead converts to client** → Baseline_Marketing_Maturity__c locked forever (proof-of-value benchmark)
3. **Client receives services** → Health scores tracked monthly, call intelligence captured
4. **Quarterly competitive re-research** → External_Competitive_Pressure__c updated
5. **At renewal** → sf_get_renewal_proof_package assembles the delta: "You were at 34, you're now at 71. Here are 3 competitors you've passed."
6. **After close/churn** → Data enters the benchmark dataset
7. **Next prospect** → sf_get_benchmark_comparison: "Practices like yours who worked with us averaged 28% more implant consults at month 9"

**This is the moat.** No competitor, no agency, no AI tool outside PDM will ever have this dataset. It is built entirely as a byproduct of doing the job.

---

## Ordered Build Steps — What To Do Next

### IMMEDIATE (Do This Now)
**Step 1: Deploy sf_get_call_intelligence**
```bash
# Verify the file is missing
ls /Users/williamsummers/salesforce-retention-mcp/src/tools/

# Copy from Downloads
cp ~/Downloads/callIntelligence.ts /Users/williamsummers/salesforce-retention-mcp/src/tools/

# Build
cd /Users/williamsummers/salesforce-retention-mcp
npm run build
```
Restart Claude Desktop → verify Settings shows 8 tools

**Step 2: Place this CLAUDE.md file**
```bash
cp CLAUDE.md /Users/williamsummers/salesforce-retention-mcp/CLAUDE.md
```
This file then loads automatically in every Claude Code session.

### SHORT TERM — NEXT 2 WEEKS

**Step 3: HTTP Transport Migration**
This is the multiplier. Every tool built while on stdio serves only William. HTTP transport serves the entire team.
- Set `TRANSPORT=http` in .env
- Deploy to a hosted environment (options: Railway, Render, AWS EC2, Mac Mini on PDM network)
- Configure SSL/TLS for secure team access
- Update each AM's Claude Desktop config to point to hosted URL
- This unlocks all 8 current tools for the full AM team immediately

**Step 4: Build sf_research_prospect**
- Implement Sales Market Research GPT as governed MCP tool
- Add web search via Anthropic tool-use API
- Add Salesforce pre-check (existing Lead/Account query)
- Add Salesforce write-back (Marketing_Maturity_Score__c, Likelihood_to_Buy_Score__c, Priority_Level__c, Primary_Gap_Type__c)
- Create required custom fields in Salesforce first

**Step 5: Create Required Salesforce Fields**
- Stage_Entry_Date__c on Opportunity (Date/Time)
- Days_In_Current_Stage__c on Opportunity (Formula Number)
- Baseline_Marketing_Maturity__c on Account (Number, locked at close)
- Marketing_Maturity_Score__c on Lead + Account (Number)
- Likelihood_to_Buy_Score__c on Lead + Account (Number)
- Priority_Level__c on Lead + Account (Picklist)
- Primary_Gap_Type__c on Lead + Account (Picklist)
- Research_Summary__c on Lead + Account (Long Text Area)
- External_Competitive_Pressure__c on Account (Number)

**Step 6: Build Stage Velocity Flow in Salesforce**
- Record-triggered Flow on Opportunity: when StageName changes, stamp Stage_Entry_Date__c
- Scheduled daily Flow or n8n workflow: find stagnant opportunities, create Tasks for reps

### MEDIUM TERM — NEXT 30-60 DAYS

**Step 7: First n8n Workflow — Prospect Research + Gamma Deck**
- sf_research_prospect completes → triggers n8n webhook
- n8n selects Gamma template by Primary_Gap_Type__c
- n8n calls Gamma API → receives deck URL
- n8n writes deck URL to Lead in Salesforce
- n8n creates Task for rep

**Step 8: Build sf_get_competitive_alerts**
- Competitor snapshot storage as Salesforce custom object
- Weekly n8n workflow re-checks competitor signals
- Delta report surfaces in weekly synopsis

**Step 9: Build sf_get_rep_pipeline_synopsis**
- Monday morning rep brief
- Leads ranked by Likelihood_to_Buy_Score__c
- Competitive alerts on active leads
- Stagnant opportunities with recommended actions

**Step 10: Agentforce Topic 1 — Account Health Brief**
- Build in Salesforce Agentforce
- Prerequisite: n8n HTTP endpoint live
- Prerequisite: Prompt templates in Salesforce matching doc #018 standards
- Deliver: Any Salesforce user asks "How is this account doing?" and gets a complete brief

### LONG TERM — NEXT 60-90 DAYS

**Step 11:** Build sf_get_renewal_proof_package + n8n renewal deck workflow
**Step 12:** Build sf_get_benchmark_comparison (requires enough research data accumulated)
**Step 13:** Build sf_get_sales_objection_patterns (requires Conversation Insights transcript volume)
**Step 14:** PowerBI executive dashboard connected to live Salesforce data
**Step 15:** Agentforce Topics 2-5 (Pre-Call Prep, Opportunity Next Best Action, Churn Risk, Prospect Brief)
**Step 16:** Remaining Category 4 tools: tci_get_student_status, sf_get_lead_intelligence, attribution tool
**Step 17:** Health Scoring Model v2 with Conversation Health dimension

---

## Plus It — Standing Proactive Enhancement Queue

These are enhancements nobody asked for that should be built or proposed:

1. **AM Performance Coaching Brief** — Weekly digest for each AM showing their accounts' health trends vs. team average. Identifies which AM behaviors correlate with healthiest client bases.

2. **Voice-to-Note via Zoom** — After every Zoom call, auto-create a sf_log_account_note from the Zoom AI Summary, saving the AM from manual logging.

3. **Competitive Pressure Heatmap** — PowerBI layer showing which PDM clients are under the most competitive pressure by geography. Red zones = retention priority markets.

4. **Client Sentiment Trend** — Mine CITranscriptEvent data over time for tone signals. A client who used to say "great" and "love it" and now says "okay" and "I guess" is signaling dissatisfaction before they say it explicitly.

5. **New Client Welcome Intelligence** — When a new Account is created (close date = today), auto-run sf_research_prospect on the practice and lock Baseline_Marketing_Maturity__c. AM gets a full brief on day 1 before the onboarding call.

6. **Doctor-Spoke Frequency Report** — Track AM_Spoke_to_Doctor__c across the book of business. AMs who regularly reach the doctor have dramatically lower churn. Surface this in the weekly synopsis as a coaching metric.

7. **The "What If You Do Nothing" Calculator** — Add a section to sf_research_prospect that projects competitor review trajectory 12 months forward based on current velocity. If competitor is gaining 15 reviews/month, they'll have 180 more reviews in a year. That's a concrete urgency argument grounded in math.

8. **Referral Network Map** — Track which accounts were referred by other accounts. If a referring account churns, their referrals are 3x more likely to follow. Flag this relationship in churn risk reports.

9. **Seasonal Implant Demand Signals** — Dental implant demand follows predictable seasonal patterns. Build a calendar-aware component that alerts AMs when their markets historically see demand spikes — that's the best time for clients to increase ad spend.

10. **Pardot Score → LTB Integration** — Push Likelihood_to_Buy_Score__c from sf_research_prospect into Pardot as a custom scoring attribute. High-LTB leads automatically get accelerated nurture sequences.

---

## Claude Code Usage Notes

When using Claude Code for this project:
- This CLAUDE.md loads automatically — you have full context without re-explaining
- Run `npm run build` after every TypeScript change to catch errors immediately
- The `src/tools/` directory is where all tool files live
- The `src/services/salesforce.ts` file contains soqlQuery, createRecord, daysBetween, toSoqlDate, futureDateSoql
- The `src/types.ts` file contains all TypeScript interfaces — update it first when adding new fields
- Never commit .env to version control
- Test tool output against real Salesforce data before documenting as working

---

## Departments Claude Serves at PDM

Account Managers, Sales Reps, Finance, Corporate Marketing, The Closing Institute (TCI), Video, Web & Graphic Design, PPC, Social Media & SEO, Traditional Media, Service Cloud Users.

---

*This file is the master brain for the PDM AI platform. Every Claude session — whether Chat, Code, or Cowork — should load this file first. Keep it updated as the platform evolves. When a tool ships, update its status. When a decision is made, record it here.*
