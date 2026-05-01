# CLAUDE.md — Prophet by PDM
## Master Brain File — Read This Completely Before Taking Any Action

> *"See what's coming before it arrives."*

**Owner:** William Summers — Salesforce Admin & Systems Architect, Progressive Dental Marketing
**Project Path:** `/Users/williamsummers/salesforce-retention-mcp`
**Last Updated:** May 2026
**Status:** Active build — 18 tools compiled | Workflows 5, 9, 10 live | Call_Intelligence__c built | Competitor_Snapshot__c built | Event_Engagement__c built | Workflow 11 (CI Processing) next

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

**Prophet** is PDM's AI intelligence platform. It connects Claude Desktop directly to Salesforce via a TypeScript MCP (Model Context Protocol) server using jsforce. It gives Account Managers and Sales Reps AI-powered intelligence about their clients and prospects without leaving their workflow — seeing churn, renewals, competitive threats, and opportunities before they become obvious.

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
**Null Status__c = TCI Event ticket buyer or converted Lead that never became a client.** These accounts exist because Salesforce creates an Account record when a Lead converts, or when a TCI Event ticket is sold. They are NOT marketing clients. Always add `AND Status__c != null` to any query that is intended to return active clients. Never score, report on, or include null-status accounts in operational health scans, churn risk, or weekly synopses.

### 6. Sales Orders
Multiple Sales Orders per Account = proposals, not separate deals. Filter to Signed/Active status only.

### 7. Architecture Library First
Before designing anything new, search the architecture library first. Do not duplicate what is already documented. If a doc needs updating, flag it explicitly.

### 8. Field API Names Are Law
Always use confirmed field API names from the field maps or the CSV export. Never guess at field names.

---

## PDM Product Line Structure — Critical Context

PDM sells across four distinct product lines. Understanding these is essential for correct account classification, revenue analysis, and filtering.

### Phase 1 — One-Time / Non-Recurring Services
Foundation services. Sold once. No ongoing monthly commitment.
- Website Development & Publish
- Video Production
- Graphic Design
- Traditional Media: TV, Radio, Newspaper, Billboards, Direct Mail

### Phase 2 — Recurring Marketing Services (Core Client Revenue)
Monthly recurring. This is the primary MRR-generating product line. Clients on Phase 2 are the "active clients" Prophet is designed to retain.
- PPC (Pay-Per-Click / Google Ads)
- Social Media Marketing
- SEO (Search Engine Optimization)

### TCI Events — Conference Ticket Sales (NOT Client Commitments)
The Closing Institute hosts 3 major conferences per year. Ticket purchasers are **prospects and leads, not necessarily clients.** They can be existing clients but do not have to be. An Opportunity with Phase = "TCI Events" represents a ticket sale, not a marketing engagement.

**2026 Conference Schedule:**
- **Las Vegas Bootcamp** — March 27–28, 2026 (Opportunity name pattern: FABC26 Vegas)
- **Dallas Bootcamp** — Late July 2026
- **Full Arch Growth Conference (FAGC)** — Early November 2026, Orlando (annual flagship event)

**FAGC History:**
- 2024: Tom Brady, Mark Wahlberg, Ray Lewis, Andrew Bustamante (no musical guest)
- 2025: Tony Robbins, Andrew Bustamante; Masquerade Ball on Saturday with 50 Cent

**Salesforce signal:** `Opportunity.Phase__c = 'TCI Events'` or Opportunity name contains "FABC" or "FAGC". Account `Status__c` is typically `null` for pure ticket buyers.

**Revenue note:** TCI Events + sponsorships represent major revenue. Sponsors pay significant fees for visibility at these events. Track separately from Phase 2 MRR.

### TCI Mentorship — Recurring Training Program
The Closing Institute (https://www.theclosinginstitute.com/) trains dental practice staff on converting leads into patients. This is a recurring monthly program. Members are often (but not always) also Phase 2 marketing clients.
- Tracked via `TCI_Status__c` and `TCI_Enrolled__c` on Account
- Separate from marketing services — a client can have TCI Mentorship without Phase 2 or vice versa

### Pricebook Alignment
Each product line has its own Salesforce Pricebook:
- Pricebook 1: Phase 1 (one-time)
- Pricebook 2: Phase 2 (recurring marketing)
- Pricebook 3: TCI Events (ticket sales)
- Pricebook 4: TCI Mentorship (recurring training)

### Filtering Rules by Product Line
| Use Case | Filter |
|---|---|
| Active marketing clients (Phase 2) | `Status__c IN ('Active','Renewal','Non Renewing','Reinstated','Delinquent','Paused','Pending')` AND `Status__c != null` |
| TCI Event accounts only | `Status__c = null` AND has Opp with Phase = 'TCI Events' |
| All operational accounts | `Status__c != null` AND `Status__c NOT IN ('Cancelled','Inactive','Expired')` |
| TCI Mentorship members | `TCI_Enrolled__c = true` OR `TCI_Status__c != null` |

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

- `Call_Intelligence__c` — ✅ BUILT — Per-call AI analysis library. Every VideoCall processed by Workflow 11 gets a record here. Fields (26 custom, confirmed from org 5/1/2026):
  - `VideoCall__c` — Lookup(Video Call) — links to the source call
  - `Account__c` — Lookup(Account) — links to the client account
  - `Call_Date__c` — Date/Time
  - `Call_Duration_Seconds__c` — Number(8,0)
  - `Is_Recorded__c` — Checkbox
  - `Language__c` — Text(10)
  - `Vendor__c` — Text(50) — e.g., ZOOM
  - `Processing_Status__c` — Picklist: Pending / Processing / Processed / Error
  - `Sentiment_Label__c` — Picklist: Positive / Neutral / Negative / Mixed
  - `Sentiment_Score__c` — Number(5,0), range -100 to +100
  - `Tone_Shift__c` — Picklist: Improved / Stable / Declined / N/A
  - `SF_Intelligence_Score__c` — Number(8,0), Salesforce CI-generated score
  - `Key_Topics__c` — Long Text Area(1000)
  - `Commitments_Made__c` — Long Text Area(5000)
  - `Risk_Signals__c` — Long Text Area(3000)
  - `Competitor_Mentions__c` — Long Text Area(1000)
  - `AI_Summary__c` — Long Text Area(10000) — Claude's synthesis
  - `Doctor_Reached__c` — Checkbox
  - `Satisfaction_Signal__c` — Picklist: Satisfied / Neutral / Frustrated / Escalation Risk
  - `Follow_Up_Required__c` — Checkbox
  - `Budget_Concern__c` — Checkbox
  - `Pause_Cancel_Language__c` — Checkbox — triggers save play in Workflow 10
  - `Competitor_Mentioned__c` — Checkbox
  - `Processed_Date__c` — Date/Time
  - `Processing_Error__c` — Long Text Area(500)
  - `Transcript_Char_Count__c` — Number(10,0)

- `Competitor_Snapshot__c` — ✅ BUILT — Quarterly competitor intelligence snapshots per Account or Lead. One record per competitor per period. Drives sf_get_competitive_alerts and save plays. Fields (24 custom, confirmed from org 5/1/2026):
  - `Account__c` — Lookup(Account)
  - `Lead__c` — Lookup(Lead)
  - `Competitor_Name__c` — Text(255), required
  - `Competitor_Website__c` — URL(255)
  - `Snapshot_Date__c` — Date — when this snapshot was taken
  - `Previous_Snapshot_Date__c` — Date — date of prior snapshot for delta calc
  - `Google_Review_Count__c` — Number(6,0) — current review count
  - `Previous_Review_Count__c` — Number(6,0) — count at last snapshot
  - `Review_Delta__c` — Formula(Number) — `IF(ISBLANK(Previous_Review_Count__c), 0, Google_Review_Count__c - Previous_Review_Count__c)` — reviews gained since last snapshot
  - `Estimated_Monthly_Reviews__c` — Number(4,0) — velocity estimate
  - `Google_Star_Rating__c` — Number(3,1) — e.g., 4.8
  - `Maps_Pack_Position__c` — Number(2,0) — Maps Pack rank for primary keyword
  - `Running_Google_Ads__c` — Checkbox
  - `Running_Facebook_Ads__c` — Checkbox
  - `Has_YouTube_Channel__c` — Checkbox
  - `Social_Platforms__c` — Text(255) — comma-delimited active platforms
  - `Primary_Services__c` — Text(255) — short label, e.g. "Implants, All-on-4"
  - `Primary_Services_Marketed__c` — Long Text Area(500) — full breakdown
  - `Competitive_Pressure_Score__c` — Number(3,0), 0–100 — composite pressure score
  - `Is_Primary_Competitor__c` — Checkbox — flags the dominant competitor for this account
  - `Alert_Triggered__c` — Checkbox — set true when delta exceeds threshold and alert was sent
  - `Research_Notes__c` — Long Text Area(2000) — analyst notes
  - `Scan_Analysis__c` — Rich Text Area(32768) — full AI-written competitive analysis
  - `Record_Name__c` — Auto Number (system name field)

- `Event_Engagement__c` — ✅ BUILT — Tracks individual engagement records from ANY PDM event — TCI conferences (Bootcamp, FAGC) or Progressive Dental corporate events. One record per person-interaction. Captures conversation intelligence, buying signals, and follow-up pipeline at the event level. Links to Account, Contact, TCI_Events__c, and Opportunity. Fields (27 custom, confirmed from org 5/1/2026):
  - `Account__c` — Lookup(Account) — matched account if known
  - `Contact__c` — Lookup(Contact) — matched contact if known
  - `TCI_Events__c` — Lookup(TCI_Events__c) — the event this engagement belongs to
  - `Opportunity__c` — Lookup(Opportunity) — linked deal if created
  - `Interaction_Date_Time__c` — Date/Time — when the interaction occurred
  - `Interaction_Type__c` — Picklist — e.g., Booth Visit / Breakout / Hallway / One-on-One
  - `Source__c` — Picklist — how engagement was captured
  - `Matched_By__c` — Picklist — how account/contact was matched (Email / Name / Company / Manual)
  - `Duplicate_Check_Key__c` — Text(255), **Unique** — deduplication key; prevents double-logging the same person at the same event
  - `Engagement_Level__c` — Picklist — Hot / Warm / Cold / Existing Client
  - `Buying_Signal__c` — Picklist — signal detected during conversation
  - `Urgency__c` — Picklist — timeframe indicated by the prospect
  - `Primary_Interest__c` — Picklist — which PDM product/service they asked about
  - `Services_Discussed__c` — Multi-Select Picklist — all PDM services that came up
  - `Pain_Point__c` — Multi-Select Picklist — problems they described
  - `Confidence_Score__c` — Number(2,0), 0–99 — rep's confidence this lead is real
  - `Conversation_Summary__c` — Long Text Area(3000) — what was said
  - `Original_Message__c` — Long Text Area(2000) — raw rep notes or inbound message
  - `Notes__c` — Long Text Area(2000) — additional context
  - `Follow_Up_Date__c` — Date — when to reach out
  - `Follow_Up_Channel__c` — Picklist — how to follow up (Phone / Email / Text / LinkedIn)
  - `Follow_Up_Status__c` — Picklist — Not Started / In Progress / Complete / No Response
  - `Next_Step__c` — Picklist — agreed next action
  - `Next_Step_Type__c` — Picklist — category of next step
  - `Opportunity_Created__c` — Checkbox — true once a deal was opened from this engagement
  - `Task_Created__c` — Checkbox — true once a follow-up task was created
  - `Revenue_Influence__c` — Currency(18,0) — closed revenue attributed to this event interaction

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
  - `Competitive_Gap_Summary__c` — Structured gap analysis: every PDM product/phase mapped against what competitor has vs. what client has (see Competitive Intelligence Engine section)
  - `Estimated_Monthly_Gap_Value__c` — Currency: sum of recurring PDM products that would close all identified gaps
**n8n trigger on completion:** Research complete → n8n formats JSON → Gamma API → deck link returned to rep
**Output format:** Matches full Sales Market Research GPT output format exactly

**Plus It additions over base spec:**
- Competitor snapshot stored as related records (re-checked quarterly for delta alerts)
- `External_Competitive_Pressure__c` field updated quarterly via scheduled n8n workflow
- `Competitive_Gap_Summary__c` refreshed quarterly — AM always has a current gap brief, not stale research
- Auto-generated draft prospecting email from findings (second tool call or Agentforce action)
- Territory heat map data written to support PowerBI visualization
- PDM benchmark comparison: "practices like this started at X and are now at Y"
- "What If You Do Nothing" projection: competitor review velocity × 12 months = concrete urgency number

### TOOL 10: sf_get_competitive_alerts
**Purpose:** Delta report on stored competitor snapshots for an Account or Lead — the engine that powers save plays, upsell conversations, and renewal presentations
**Queries:** Stored competitor snapshot records, checks current period vs. last snapshot
**Signals mapped to PDM products:**

| Competitor Signal | Gap | PDM Product |
|---|---|---|
| YouTube channel / procedure videos / patient testimonials | Client has no video presence | Phase 1: Video Production |
| Modern website, fresh content, implant-specific pages | Client site is dated or missing pages | Phase 1: Website Development |
| Professional branding, polished social creative | Client brand is inconsistent | Phase 1: Graphic Design |
| TV / radio / billboard presence detected | Client not in traditional media | Phase 1: Traditional Media |
| Running Google Ads on implant/full-arch/All-on-4 keywords | Client not on PPC or underspending | Phase 2: PPC Add-on / Budget Increase |
| Ranking #1-3 for implant keywords | Client buried on page 2+ | Phase 2: SEO |
| Local landing pages for multiple ZIP codes | Client has no local pages | Phase 2: SEO Local Expansion |
| Appearing in Maps Pack for multiple queries | Client shows up for few or none | Phase 2: SEO / Local SEO |
| Active Facebook/Instagram/TikTok, running social ads | Client social dormant or absent | Phase 2: Social Media Marketing |
| 300+ reviews, gaining 15+/month, strong sentiment | Client falling behind on reputation | Phase 2: SEO / Reputation |
| Reviews mention "great consultation" / "financing explained" | Staff may not be trained on case acceptance | TCI Mentorship |

**Output:**
- Competitor activity delta since last snapshot (review gains, ranking shifts, new platforms, new ad activity)
- Service gap table: competitor vs. client, mapped to specific PDM product
- `Estimated_Monthly_Gap_Value__c` — revenue opportunity if all gaps closed
- Save Play hook (for Paused/Cancellation accounts): pre-written urgency statement for AM use
- Upsell hook (for Active accounts): "Your competitor just did X — here's how we respond"

**Four conversation contexts — same data, different framing:**

1. **New Prospect:** "Here's what your competitors have that you don't — and here's exactly how PDM closes those gaps." → Close the deal
2. **Active Client (Quarterly Review):** "Your competitor gained X reviews and launched YouTube since your last review. You're ahead in SEO but the PPC gap is widening." → Upsell + reinforce value
3. **Renewal Conversation:** "When you started, you had 47 reviews and no SEO. Today you have 312 reviews and rank #2. Meanwhile your top competitor dropped from #1 to #4." → Renew with proof + expand scope
4. **Paused/Cancellation Save Play:** "While you've been paused, Valley Implant Center gained 89 reviews, launched Google Ads, and jumped ahead in Maps. Here's the three-move play to re-establish dominance — and it starts with getting back on schedule." → Re-activate with urgency and a new strategy vision

**Use cases:** Weekly AM brief, Workflow 10 task enrichment, save play generation, renewal proof package, upsell identification

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

### Workflow 11: Nightly Conversation Intelligence Processing (NEXT BUILD)
**Trigger:** Nightly 1:00 AM (after Workflow 3 churn scan at 11 PM)
**Purpose:** Process every VideoCall record that doesn't yet have a Call_Intelligence__c record. Extract AI intelligence from each transcript and write structured signals back to Salesforce. Builds the cumulative call library that powers coaching, churn prediction, and sentiment trending.
**Steps:**
1. Query VideoCall records with no linked Call_Intelligence__c (Processing_Status__c != 'Processed')
   - Filter: `StartDateTime >= LAST_N_DAYS:90` for nightly runs (no filter for historical backfill)
   - Exclude: VideoCall records where RelatedRecordId is null
   - Limit: 50 per run (rate limiting)
2. For each VideoCall: fetch CITranscriptEvent transcript via Salesforce REST API
3. POST transcript + metadata to Anthropic API (Claude claude-sonnet-4-6)
   - System prompt: PDM call intelligence extraction instructions
   - Extract: sentiment score/label, tone shift, key topics, commitments, risk signals, competitor mentions, doctor reached, satisfaction signal, budget concern, pause/cancel language
   - Return: structured JSON
4. Create Call_Intelligence__c record with all extracted fields
5. Set Processing_Status__c = 'Processed' and Processed_Date__c = NOW
6. If risk signals found OR Pause_Cancel_Language__c = true:
   - Update Account.Sentiment_Trend__c
   - If Critical signal: create Salesforce Task for AM immediately (don't wait for Workflow 10)
7. Error handling: if transcript unavailable, set Processing_Status__c = 'Pending', Processing_Error__c = error message — retry next night

**Historical Backfill (one-time run):**
- Same workflow, remove date filter
- Process all VideoCall records with no Call_Intelligence__c record
- Run in batches of 50 until all historical calls are processed
- Expected volume: potentially hundreds of calls going back years

**What this enables once running:**
- Sentiment_Trend__c on Account reflects actual call tone, not just activity dates
- AMs see "last 3 calls: Neutral → Neutral → Frustrated" in pre-call brief
- Workflow 10 tasks for Paused accounts include: "⚠️ Pause/cancel language detected in last call"
- sf_get_call_intelligence returns structured AI analysis, not just raw transcript
- 6-month dataset enables: churn pattern detection, AM coaching benchmarks, commitment tracking

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
| Competitive_Gap_Summary__c | Lead + Account | Long Text Area (32,000) | Structured gap analysis: all PDM products vs. competitor, written by sf_research_prospect and refreshed quarterly |
| Estimated_Monthly_Gap_Value__c | Lead + Account | Currency | Sum of recurring PDM products that would close all identified gaps — upsell opportunity dollar value |
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

**Competitive Gap Output — written to `Competitive_Gap_Summary__c` (required field, not optional):**

For every PDM product across all four phases, audit whether the dominant competitor has it and whether the client/prospect has it. This field powers four distinct conversations — new prospect close, active client upsell, paused/cancellation save play, and renewal proof. Structure as:

```
═══ PHASE 1: FOUNDATION SERVICES (one-time) ═══

Website
  Competitor: [Modern/Dated] — implant-specific pages [YES/NO], before/after gallery [YES/NO],
              financing CTA [YES/NO], mobile-optimized [YES/NO], fresh content [YES/NO]
  Client: [Current state from Assets / observation]
  Gap: YES / NO
  PDM Product: Website Development & Publish

Video
  Competitor: YouTube channel [YES/NO] — [X videos], procedure walkthroughs [YES/NO],
              patient testimonials [YES/NO], doctor authority content [YES/NO],
              video embedded on site [YES/NO]
  Client: [Current state]
  Gap: YES / NO
  PDM Product: Video Production

Branding / Creative
  Competitor: Consistent professional brand [YES/NO], custom graphics [YES/NO],
              polished social creative [YES/NO], branded signage / photography [YES/NO]
  Client: [Current state]
  Gap: YES / NO
  PDM Product: Graphic Design

Traditional Media
  Competitor: TV presence [YES/NO], Radio [YES/NO], Billboard [YES/NO],
              Direct Mail [YES/NO]
  Client: [Current state]
  Gap: YES / NO
  PDM Product: Traditional Media (TV / Radio / Billboard / Direct Mail)

═══ PHASE 2: RECURRING MARKETING SERVICES ═══

PPC / Google Ads
  Competitor: Running ads [YES/NO] — keywords: [list], estimated spend: $X/mo
  Client: On PPC [YES/NO] — budget: $X/mo
  Gap: YES / NO
  Urgency: HIGH if competitor spending aggressively and client not on PPC
  PDM Product: PPC Add-on / PPC Budget Increase

SEO — Organic Rankings
  Competitor: Ranking #[X] for [keywords] — implant pages [YES/NO], All-on-4 page [YES/NO],
              full-arch page [YES/NO], blog content [YES/NO]
  Client: Ranking #[X] for [keywords]
  Gap: YES / NO
  PDM Product: SEO / SEO Expansion

SEO — Local Landing Pages
  Competitor: Local pages for [ZIP/city list] — [X pages total]
  Client: Single location page [YES/NO], local pages [YES/NO — X pages]
  Gap: YES / NO
  PDM Product: SEO Local Expansion

SEO — Google Maps / Local Pack
  Competitor: Maps Pack for [X queries] — ranked #[X]
  Client: Maps Pack for [Y queries] — ranked #[Y]
  Gap: YES / NO
  PDM Product: SEO / Local SEO

Reputation / Reviews
  Competitor: [X] reviews, [Y.Y] stars, gaining [Z]/month — sentiment: [themes]
  Client: [X] reviews, [Y.Y] stars, gaining [Z]/month
  Gap: YES (falling behind) / NO (competitive or ahead)
  Trend: Widening / Stable / Closing
  PDM Product: SEO / Reputation Strategy

Social Media
  Competitor: Active on [platforms] — posting [X/week], running social ads [YES/NO],
              before/after content [YES/NO], doctor reels [YES/NO], TikTok [YES/NO],
              engagement rate [high/low]
  Client: Active on [platforms] — [current posting frequency]
  Gap: YES / NO
  PDM Product: Social Media Marketing

═══ TCI EVENTS ═══

Event Attendance / Market Presence
  Competitor: Doctor has attended TCI events [YES/NO — inferred from network signals]
  Client: TCI Events attended [X] — last event: [name/date]
  Note: TCI Events are PDM-hosted — competitor attendance is indirect intelligence only
  PDM Product: TCI Events (ticket sale / sponsorship opportunity)

═══ TCI MENTORSHIP ═══

Staff Training / Case Acceptance
  Competitor: Reviews mention "great consultation", "financing explained clearly",
              "staff was knowledgeable" [YES/NO — signal from review sentiment]
  Client: TCI enrolled [YES/NO] — TCI Status: [value]
  Gap: Signal present / No signal
  PDM Product: TCI Mentorship

═══ COMPOSITE ═══
Total Gaps Identified: X (Phase 1: X | Phase 2: X | TCI: X)
Estimated One-Time Opportunity: $X,XXX (Phase 1 services client is missing)
Estimated Monthly Recurring Opportunity: $X,XXX/mo (Phase 2 + TCI Mentorship gaps)
Total Estimated Monthly Gap Value: $X,XXX/mo recurring + $X,XXX one-time
Highest Urgency Gap: [Product] — [one-line reason why this one first]
Recommended First Conversation: [Product] — [why this drives the most immediate impact]

Save Play Hook (Paused / Cancellation accounts):
  [Pre-written urgency statement grounded in specific competitor gains since pause date.
   Format: "While you've been paused, [Competitor] has [specific action]. Meanwhile,
   your [metric] has [changed]. Here's the three-move play to re-establish dominance —
   and it starts with [specific PDM product]."]

Upsell Hook (Active accounts — quarterly review):
  [Pre-written talking point for AM use. Format: "Your competitor just [specific action].
   You're ahead in [area] but the [gap] is widening. Here's how we respond."]

Renewal Hook (Renewal conversation):
  [Evidence-based renewal statement. Format: "When you started, [baseline].
   Today, [current state]. Meanwhile, [top competitor] has [shifted].
   Here's Phase [X] of the strategy."]
```

**The four conversations, one data source — one engine, four revenue outcomes:**

The same `Competitive_Gap_Summary__c` field powers four distinct revenue conversations. Frame based on account status:

- **Buy (new prospect):** "Here's what your competitors have that you don't — and here's exactly how PDM closes those gaps." → Close the deal. Every gap maps to a specific PDM product. Every hook cites a specific observed competitor action.

- **Resume (Paused/Save Play):** "While you've been paused, [Competitor] has [specific action]. Your [metric] has [changed]. Here's the three-move play to re-establish dominance — and it starts with [specific PDM product]." → Re-activate with urgency and a brand new strategy vision. This is the most emotionally powerful conversation: "While you were on the sideline, this happened." Workflow 10 task descriptions for Paused accounts must include this hook pulled from Competitive_Gap_Summary__c.

- **Upsell (active client — quarterly review):** "Your competitor just [specific action]. You're ahead in [area] but the [gap] is widening. Here's how we respond." → Grow the account with evidence, not pressure. Every PDM product not yet purchased that the competitor has = an upsell line item with dollar value.

- **Renew:** "When you started, [baseline from Baseline_Marketing_Maturity__c]. Today, [current state]. Meanwhile, [top competitor] has [shifted]. Here's Phase [X] of the strategy." → Renew with proof of results and expand scope. The gap delta (what's closed vs. what's new) is the renewal narrative.

**Estimated_Monthly_Gap_Value__c — the upsell dollar engine:**
Sum ONLY recurring Phase 2 + TCI Mentorship gaps (not one-time Phase 1). This number is the "revenue opportunity if all gaps closed with PDM." It appears in:
- sf_get_upsell_opportunities (Tool 7) — makes every upsell conversation evidence-based
- Workflow 10 Paused account tasks — "your competitor has $X/mo in services you don't"
- The renewal proof package — shows what's still on the table
- Executive dashboard — total upsell opportunity across the book of business

**Accuracy rules (enforce strictly):**
- Never fabricate missing data — if a signal cannot be confirmed, state clearly
- Clearly label assumptions and estimates
- Do not claim Progressive Dental works with the practice without public evidence
- Tie every gap to a specific PDM product — no gaps without a solution
- Every hook (Save Play, Upsell, Renewal) must cite a specific observed competitor action, not a generic statement
- `Estimated_Monthly_Gap_Value__c` must be populated — sum only recurring Phase 2 + TCI Mentorship gaps (not one-time Phase 1)

---

## PDM Intelligence Flywheel — The Long-Term Vision

Every action on this platform contributes to a proprietary dataset that becomes more valuable and more unreplicable over time:

1. **sf_research_prospect** runs on a new lead → Marketing Maturity Score + full Competitive Gap Summary written to Salesforce
2. **Lead converts to client** → Baseline_Marketing_Maturity__c locked forever (proof-of-value benchmark). Competitive Gap Summary becomes the upsell roadmap for the first year.
3. **Client receives services** → Health scores tracked monthly, call intelligence captured. As PDM closes gaps, `Competitive_Gap_Summary__c` is refreshed — gaps close, new ones surface.
4. **Quarterly competitive re-research** → Competitor data refreshed. `Competitive_Gap_Summary__c` and `Estimated_Monthly_Gap_Value__c` updated. AM gets a "what changed this quarter" brief.
5. **Client goes Paused or flags cancellation** → Workflow 10 triggers. Save Play hook pulled from `Competitive_Gap_Summary__c`. AM walks into the re-activation call with concrete competitive ammunition: "While you were paused, this happened in your market — here's the three-move response."
6. **At renewal** → sf_get_renewal_proof_package assembles the delta: "You were at 34 maturity, now at 71. Here are 3 competitors you've passed. Here are 2 new gaps that opened. Here's Phase 2 of the strategy."
7. **After close/churn** → Data enters the benchmark dataset
8. **Next prospect in same market** → sf_get_benchmark_comparison + existing competitor data already on file from prior research: "We already know your market — here's what the top 3 competitors are doing right now."

**The competitive gap compounds the flywheel.** The same research that closes a new sale becomes the upsell roadmap, then the retention tool, then the save play, then the renewal proof. Every conversation is grounded in data no competitor can replicate. That is the moat.

**The four conversations, one engine — one competitive intelligence database, four revenue outcomes:**
- **Buy (new prospect):** Competitive gap shows what they're missing vs. competitors → close the deal
- **Resume (Paused/Save Play):** Competitive gap shows what moved in their market while they were paused → re-activate with urgency and a brand new strategy vision. This is the most emotionally powerful conversation: "While you were on the sideline, this happened."
- **Upsell (active client quarterly review):** Competitive gap shows what services to add, mapped to exact PDM products → grow the account with evidence, not pressure
- **Renew:** Competitive gap delta shows how far they've come (baseline vs. today) and what new gaps have opened → renew with proof of results and expand scope into Phase 2 or 3 services

The same data that closes the sale becomes the retention engine. Every client conversation is grounded in live competitive intelligence no competitor can replicate. That is the moat.

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
