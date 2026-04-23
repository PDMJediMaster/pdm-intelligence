# MASTER PROMPT — Prophet by PDM: Complete Documentation Package

> **Instructions to ChatGPT:** You are creating a complete documentation package for Prophet, an AI intelligence platform built by Progressive Dental Marketing (PDM). Read this entire prompt before starting. It contains everything you need — the full system architecture, all 18 tools with exact capabilities, real example outputs, user roles, workflows, and specifications for each deliverable. Create all deliverables as polished, professional documents with diagrams, flowcharts, screenshots placeholders, and visual guides. Use PDM branding colors: Navy (#1a2b4a), Teal (#1abc9c), White, Gold accents.

---

## PART 1: WHAT IS PROPHET?

### The Platform
Prophet is PDM's proprietary AI intelligence platform. It connects Claude (Anthropic's AI) directly to Salesforce via a TypeScript MCP (Model Context Protocol) server. It gives Account Managers and Sales Reps AI-powered intelligence about their clients and prospects — seeing churn, renewals, competitive threats, and opportunities before they become obvious.

### The Business Problem It Solves
PDM is a dental implant marketing agency. Account Managers manage 50+ client relationships simultaneously. Without AI assistance, they:
- Walk into renewal calls unprepared
- Miss churn signals until it's too late
- Can't quickly research new prospects
- Spend hours on admin work that should take minutes

### The Strategic Goal
Increase average client length from **2 years to 8 years**. At 8 years, annual churn drops from 35.7% to 12.5% — protecting **$4M+ in annual revenue** on the current client base. Every tool in Prophet serves that goal.

### How It Works (Diagram Spec)
```
[User opens Claude Desktop]
    → [Types natural language request]
    → [Claude routes to Prophet MCP tool]
    → [Prophet queries Salesforce in real-time]
    → [AI analyzes data, scores risks, generates insights]
    → [Returns formatted intelligence brief to user]
    → [User takes action with full context]
```

The user never leaves Claude Desktop. They ask questions in plain English. Prophet handles the Salesforce queries, data analysis, health scoring, and formatting automatically.

### PDM Product Lines (Critical Context)

| Product Line | Type | Revenue Model | Examples |
|---|---|---|---|
| **Phase 1** | One-time services | Single payment | Website Development, Video Production, Graphic Design, Traditional Media |
| **Phase 2** | Recurring marketing | Monthly recurring (MRR) | PPC (Google Ads), Social Media, SEO |
| **TCI Events** | Conference tickets | Per-ticket | Full Arch Boot Camp (Vegas, Dallas), FAGC Orlando |
| **TCI Mentorship** | Recurring training | Monthly recurring | The Closing Institute training program |

### PDM Terminology
- **Ticket** = Salesforce Case (always say "Ticket" in user-facing docs)
- **Marketing Status** = `Status__c` field on Account (Active, Renewal, Non Renewing, Paused, Delinquent, Pending, Reinstated)
- **MRR** = Monthly Recurring Revenue (`Total_Monthly_Recurring_Amount__c`)
- **Tier** = Account tier based on MRR: Standard (<$10k), Gold ($10k-19,999), Platinum ($20k+), Enterprise
- **Health Score** = Composite 0-100 score: Healthy (70-100), At Risk (40-69), Critical (0-39)
- **AM** = Account Manager
- **PGA / Practice Growth Advisor** = Sales Rep title at PDM

---

## PART 2: WHO USES PROPHET AND HOW

### User Roles

| Role | Primary Tools | Daily Workflow |
|---|---|---|
| **Account Manager** | Weekly Synopsis, Pre-Call Brief, Health Report, Churn Risk, Renewal Pipeline, Call Intelligence, Log Note | Monday: check synopsis. Before every call: pull pre-call brief. Weekly: review churn risk list. Monthly: renewal pipeline review. |
| **Practice Growth Advisor (Sales Rep)** | Rep Pipeline Synopsis, Lead Intelligence, Research Prospect, Event Conversion Pipeline | Monday: check pipeline synopsis. Before discovery calls: pull lead intelligence. New leads: run prospect research. Pre-event: check event conversion pipeline. |
| **AM Team Lead / Director** | AM Coaching Brief, Churn Risk (all AMs), Nightly Health Scan | Monday: coaching brief for all AMs. Weekly: review team-wide churn risk. Daily: monitor nightly scan results. |
| **CEO / Leadership** | AM Coaching Brief, Churn Risk, Renewal Pipeline | Weekly: team performance review. Monthly: renewal pipeline + revenue at risk. Quarterly: strategic planning with health data. |
| **TCI Department** | Call Intelligence, Event Conversion Pipeline | Monitor training engagement. Track event registrant conversion. |

---

## PART 3: ALL 18 TOOLS — COMPLETE REFERENCE

### TOOL 1: sf_get_weekly_synopsis
**Category:** Account Management
**User says:** "Show me my week" / "What's on my calendar?" / "Weekly brief"
**What it does:** Generates a Monday-morning digest showing all scheduled calls this week with full client enrichment. For each scheduled call, it pulls health tier, MRR, days since last contact, open refund requests, doctor contact history, renewal proximity, flagged risks, and AI-generated talking points.
**Who uses it:** Account Managers, AM Team Leads
**Key features:**
- Pulls from the AM's actual Salesforce calendar
- Cross-references 6 data sources in parallel: Account, Cases, Opportunities, Tasks, Contacts, Refund Requests
- Generates suggested talking points based on account signals
- Shows upcoming renewals in next 30 days
- Flags accounts with open refund requests or cancellation notices
**Example prompt:** "Show me my synopsis for this week"
**Example output sections:**
```
📅 WEEKLY SYNOPSIS — March 27, 2026
Accounts scheduled this week: 12
Total MRR scheduled: $187,450

━━━ MONDAY ━━━
🔴 Acme Dental — Health: Critical (28/100)
   MRR: $18,447 | Tier: Gold | Last contact: 45d ago
   ⚠️ Open refund request | 🚩 Flagged for attention
   📋 Talking Points:
   • Address refund request status — client may be testing exit path
   • Doctor not reached in 90+ days — request doctor join next call
   • Renewal in 22 days — prepare renewal proof package
```

---

### TOOL 2: sf_get_pre_call_brief
**Category:** Account Management
**User says:** "Brief me on [account name]" / "Pre-call brief for Acme Dental" / "What do I need to know about this client?"
**What it does:** The most comprehensive tool in Prophet. Runs 10 parallel Salesforce queries and assembles a complete intelligence package for any single account.
**Who uses it:** Account Managers (before every client call)
**Accepts:** Account name (fuzzy search) OR Salesforce Account ID
**10 parallel queries:**
1. Account (25+ fields including MRR, tier, health, renewal date, budgets, specialty)
2. Contacts (doctor flags, primary contact, titles, email, phone)
3. Cases/Tickets (open tickets, priority, age)
4. Opportunities (active deals, stages, amounts)
5. Tasks (last 20 activities with full call notes + Spoke_with_Doctor flag)
6. Assets (active services — PPC, SEO, Social, etc.)
7. Business Objectives (client's stated goals)
8. Reassignments (AM transition history)
9. Refund Requests (open refund requests with amounts)
10. Cancellation Requests (active cancellation requests with reason, effective date, new agency name, save attempt outcome)
11. Zoom Meeting AI Summaries (last 3 meeting summaries)
**Output sections:**
- 🚨 Critical Alerts (refund requests, cancellation notices, delinquency)
- 📊 Account Overview (MRR, tier, health score breakdown, renewal date)
- 🧠 Account Intel (AM intelligence notes from Account_Intel__c)
- 💰 Budget Snapshot (PPC, SEO, Social, Management Fee breakdowns)
- 🛠️ Active Services (from Asset records)
- 🎯 Business Objectives
- 🔄 AM Transition History
- 🎥 Zoom Meeting AI Summary (last meeting summary)
- 👥 Key Contacts (with doctor flag, primary contact flag)
- 📋 Recent Activity (full call notes, Spoke_with_Doctor badges)
- 🎫 Open Tickets
- 💼 Active Opportunities
- ❤️ Health Score Breakdown (Engagement 40% + Case Health 30% + Renewal 30%)
**Example prompt:** "Brief me on One Solution Dental"

---

### TOOL 3: sf_log_account_note
**Category:** Account Management
**User says:** "Log a note on Acme Dental" / "Record that I called Dr. Smith"
**What it does:** Creates a completed Task record in Salesforce. Supports Call, Email, Meeting, or Note types. Optionally links to a specific Contact.
**Who uses it:** Account Managers (after every client interaction)
**Key features:**
- Creates Task with Status = Completed
- Supports multiple activity types
- Links to Contact if specified
- Saves AM from manually navigating to Salesforce to log

---

### TOOL 4: sf_get_account_health_report
**Category:** Health & Risk
**User says:** "How healthy is Acme Dental?" / "Health report for this account"
**What it does:** Calculates a composite health score (0-100) for a single account with full breakdown.
**Accepts:** Account name OR Account ID
**Scoring model (v1):**
- **Engagement Score (40%):** Based on LastActivityDate — how recently has the AM contacted the client?
  - Last 7 days = 100 | 8-14 days = 80 | 15-30 days = 60 | 31-60 days = 30 | 60+ days = 0
- **Case Health Score (30%):** Based on open ticket count and priority
  - 0 open = 100 | 1-2 low priority = 70 | 3+ or high priority = 30 | Critical = 0
- **Renewal Score (30%):** Based on Contract_Renewal_Date__c proximity
  - 90+ days = 100 | 60-89 days = 80 | 30-59 days = 50 | <30 days = 20 | Expired = 0
- **Overall = Weighted average → Tier assignment**
**Tiers:**
- 🟢 Healthy: 70-100
- 🟡 At Risk: 40-69
- 🔴 Critical: 0-39
**Additional data shown:** MRR, Tier, active service count, next alignment call date, delinquency status

---

### TOOL 5: sf_get_churn_risk_accounts
**Category:** Health & Risk
**User says:** "Which accounts are at risk?" / "Show me churn risk" / "Who needs attention?"
**What it does:** Returns a ranked list of ALL active accounts most at risk of churning. Accounts with open Refund Requests or Cancellation Requests are forced to the top regardless of score.
**Who uses it:** Account Managers, AM Team Leads, Leadership
**Parameters:**
- `owner_id` — filter to specific AM (optional)
- `limit` — max accounts to return (default 25)
- `threshold` — health score cutoff (default 50)
**Priority override system:**
1. 🚨 Accounts with open Refund Requests → always top
2. 🚨 Accounts with active Cancellation Requests → next (shows reason, effective date, new agency, save attempt)
3. ⚠️ Status signals: Non Renewing (-40 pts), Paused (-30 pts), Delinquent (-30 pts)
4. 📊 Score-based ranking for remaining accounts
**Filters (automatic):**
- Excludes test/noise accounts (Test, House of Mouse)
- Excludes William Summers (admin accounts)
- Only includes accounts owned by active users in PDM roles
- Excludes Cancelled/Inactive/Expired accounts
**Example output:**
```
# 🚨 Churn Risk Report
42 accounts at risk | Revenue at risk: $487,230/mo

## 🚨 PRIORITY — Open Refund Requests
### Valley Dental Group
Owner: Stephanie Bolivar | MRR: $12,447 | Tier: Gold
Health: 22/100 (Critical) | Status: Active
⚠️ Refund request open | Contract expired
💡 Action: Address refund immediately, schedule doctor call

## ⚠️ STATUS RISK — Non Renewing / Paused / Delinquent
### Idaho Perio
Owner: Tara Schulman | MRR: $5,199 | Status: Non Renewing
🚨 Status: Non Renewing | Last contact: 3d ago
```

---

### TOOL 6: sf_get_renewal_pipeline
**Category:** Pipeline
**User says:** "What's renewing soon?" / "Renewal pipeline" / "Who's up for renewal?"
**What it does:** Shows all active accounts with Contract_Renewal_Date__c within the next N days, sorted by urgency. PDM renewals are auto-billing — no new Opportunity is created. This tool watches the dates and flags risk.
**Parameters:**
- `days` — days to look ahead (default 90)
- `owner_id` — filter to specific AM
**Urgency groups:**
- 🚨 Renewing in ≤ 14 Days — Act Now
- ⚠️ Renewing in 15-30 Days
- 📅 Renewing in 31+ Days
**Risk flags shown:** Flagged, Delinquent, Cancel/Pause request on file, Non Renewing, Paused
**Key data per account:** Renewal date, days remaining, MRR, Tier, Health Tier, Owner, Status, Last contact

---

### TOOL 7: sf_get_upsell_opportunities
**Category:** Pipeline
**User says:** "Upsell opportunities" / "Who should I upsell?" / "Which clients are missing services?"
**What it does:** Gap analysis — compares what services each active client has vs. what PDM offers. Identifies accounts missing PPC, SEO, Social Media, TCI Mentorship, Web Development, or Video.
**How it detects current services:** Reads Budget__c, SEO_Budget__c, Social_Budget__c fields on Account. Budget > 0 = service is active.
**What it surfaces:**
- Current services the account has
- Missing services (gaps)
- Recommended upsell reason based on gap type
- TCI Events excluded (ticket sales, not recurring services)

---

### TOOL 8: sf_get_call_intelligence
**Category:** Conversation Intelligence
**User says:** "Show me call history for Acme Dental" / "What happened in the last calls?"
**What it does:** Returns AI-generated intelligence from recent calls and meetings for any account.
**Accepts:** Account name OR Account ID
**Parameters:**
- `lookback_days` — how far back to search (default 90)
- `max_calls` — max call summaries (default 5)
- `include_transcript` — set true for full transcript (Phase 2)
**Phase 1 (Live):** Pulls Zoom meeting metadata (topic, date, duration, participant count, intelligence score) from Salesforce Conversation Insights
**Phase 2 (Planned):** Full verbatim transcript from CITranscriptEvent with 50,000 character guard

---

### TOOL 9: sf_research_prospect
**Category:** Sales Intelligence
**User says:** "Research [Practice Name] in [City, State]" / "Look up this dental practice"
**What it does:** The full Sales Market Research GPT implemented as a governed Salesforce-connected tool. Checks Salesforce FIRST for existing Lead/Account history, then runs comprehensive web research.
**Critical difference from ChatGPT version:** Intelligence persists in Salesforce. Scores are written back. Gamma prospect deck is auto-generated.
**3-step pipeline:**
1. **sf_research_prospect** — Salesforce pre-check + web research → returns structured analysis
2. **sf_save_research_scores** — Writes scores back to Lead/Account + creates Competitor Snapshot
3. **sf_save_deck_url** — Saves Gamma deck URL to Salesforce + notifies rep
**Research output sections:**
- Market Snapshot (population 45+, income, affluent ZIPs)
- Competitive Landscape (dominant competitor, easiest to disrupt)
- Practice Marketing Audit (website, SEO, social, reviews)
- SEO Gap Analysis
- Google Ads Opportunity
- Reputation Analysis
- Competitive Gap Summary (every PDM product mapped against competitor)
- Marketing Maturity Score (0-100)
- Likelihood to Buy Score (0-100)
- Priority Level (Low / Moderate / High / Top Priority)
- Market Domination Strategy
- Sales Enablement Summary (talking points, discovery questions, objections, positioning)

---

### TOOL 10: sf_save_research_scores
**Category:** Sales Intelligence (Pipeline Step 2)
**User says:** (Called automatically after sf_research_prospect)
**What it does:** Writes research scores back to Salesforce Lead or Account. Creates a Competitor Snapshot record with the primary competitor's data (review count, star rating, Maps position, ad activity, services).
**Fields written:**
- Marketing_Maturity_Score__c
- Likelihood_to_Buy_Score__c
- Priority_Level__c
- Primary_Gap_Type__c (SEO / Reputation / Video / Authority / Maps)
- Research_Summary__c
**Also creates:** Competitor Snapshot record linked to Lead/Account

---

### TOOL 11: sf_save_deck_url
**Category:** Sales Intelligence (Pipeline Step 3)
**User says:** (Called automatically after Gamma deck generation)
**What it does:** Creates a Gamma__c record in Salesforce linking the prospect deck to the Lead or Account. Creates a Task for the rep: "Your prospect deck is ready."
**Output:** Gamma deck URL + Salesforce record confirmation

---

### TOOL 12: sf_get_competitive_alerts
**Category:** Competitive Intelligence
**User says:** "Competitive alerts for Acme Dental" / "What are my competitors doing?"
**What it does:** Pulls stored Competitor Snapshot records for an account and surfaces changes since last snapshot. Shows which PDM products the competitor has that the client doesn't.
**Four conversation contexts — same data, different framing:**
1. **New Prospect (Buy):** "Here's what your competitors have that you don't"
2. **Active Client (Upsell):** "Your competitor just did X — here's how we respond"
3. **Renewal:** "When you started at 34 maturity, now at 71. Here's Phase 2 of the strategy"
4. **Paused/Save Play (Resume):** "While you've been paused, [Competitor] gained 89 reviews and launched Google Ads"

---

### TOOL 13: sf_get_renewal_proof_package
**Category:** Retention
**User says:** "Renewal proof for Acme Dental" / "Build renewal package"
**What it does:** Assembles the data narrative for a renewal presentation. Pulls baseline vs. current maturity delta, competitive position change, call sentiment trend, benchmark comparison.
**Triggers:** Best used 30 days before Contract_Renewal_Date__c
**Output:** Structured data that can feed a Gamma renewal deck

---

### TOOL 14: sf_get_rep_pipeline_synopsis
**Category:** Sales
**User says:** "Show me my pipeline" / "Monday morning brief" / "What should I focus on?"
**What it does:** Monday morning brief for Sales Reps / Practice Growth Advisors. Comprehensive pipeline view.
**Accepts:** `owner_name` (e.g., "Liam Copsey") — resolves to User ID automatically
**Sections:**
- 📊 Pipeline summary (scored leads, unscored, open opps, stale opps, scheduled calls)
- 🎟️ Vegas Bootcamp (or current event) pre-event outreach — registered practices that haven't converted
- 📅 Scheduled calls/events this week
- 🎯 Top Priority Prospects ranked by Likelihood to Buy score with full research summary
- 🧊 Going Cold — high-LTB leads with no activity in 7+ days
- 🔍 New Leads needing research (created in last 30 days, no scores)
- 💼 Open Opportunities with stage, amount, days stagnant, recommended action
**Example output:**
```
# 📋 Rep Pipeline Synopsis
Friday, March 27, 2026 | Rep: Liam Copsey

| | Count |
|---|---|
| Scored Leads | 1 |
| Unscored Leads | 99 |
| Open Opportunities | 100 |
| Stale Opportunities (>14d) | 100 |
| 🚨 Vegas Bootcamp — unconverted registrants | 13 |

🎯 Top Priority: Sloan Canyon Dental
LTB: 72/100 | Maturity: 18/100 | Gap: Maps
Intel: No web presence, invisible online. Southern NV Dental Implants
(1,153 reviews, 5.0★) dominates Maps pack. Massive opportunity.
```

---

### TOOL 15: sf_get_call_intelligence
**(Same as Tool 8 — see above)**

---

### TOOL 16: sf_get_lead_intelligence
**Category:** Sales
**User says:** "What do we know about this lead?" / "Lead intel on [name]" / "Brief me on this prospect"
**What it does:** Full pre-call intelligence brief for a Sales Rep on any Lead.
**Accepts:** Lead name (fuzzy search on Name or Company) OR Lead ID
**Data pulled:**
- Contact info (name, email, phone, mobile)
- Pardot engagement score and grade
- UTM source and campaign attribution
- Prophet research scores (Marketing Maturity, LTB, Priority, Gap Type)
- Research summary
- Recent activity history with full call notes and email bodies
- Linked Gamma prospect decks
**Call prep section includes:**
- How they found PDM (lead source)
- Engagement signal interpretation
- Market readiness assessment
- Recommended conversation opener
- Deck status (generated or not)

---

### TOOL 17: sf_get_event_conversion_pipeline
**Category:** Sales / TCI
**User says:** "Event conversion pipeline" / "Who registered but hasn't become a client?" / "Vegas Bootcamp prospects"
**What it does:** Shows all TCI conference ticket purchasers who have NOT converted to Phase 2 marketing clients or TCI Mentorship members.
**Ranked by urgency:**
1. Upcoming event registrants first (contact before they walk in the door)
2. Past attendees sorted by days since last contact
**Data per practice:** Account name, city/state, contact name/title/email/mobile, event name, check-in status, preregistration, first event flag, days since last contact
**Key use case:** Pre-event outreach — the 2 weeks before a conference are the highest-conversion window

---

### TOOL 18: sf_run_nightly_health_scan
**Category:** Operations
**User says:** "Run health scan" / "Nightly scan"
**What it does:** Scans ALL active accounts, recalculates proxy health scores, identifies tier changes, flags at-risk accounts. Designed to run nightly via automation but can be triggered manually.
**Surfaces:**
- Accounts that dropped health tier since last scan
- Onboarding gaps (new accounts without Client_Onboarding__c records)
- Team-wide health distribution
- Accounts needing immediate attention

---

## PART 4: THE INTELLIGENCE FLYWHEEL

This is Prophet's strategic moat. Every action compounds:

```
[DIAGRAM: Circular flywheel with 8 stations]

1. RESEARCH → sf_research_prospect runs on new lead
   ↓ Maturity Score + Competitive Gap → written to Salesforce

2. CLOSE → Lead converts to client
   ↓ Baseline_Marketing_Maturity__c locked forever

3. SERVE → Client receives Phase 2 services
   ↓ Health scores tracked monthly, call intelligence captured

4. MONITOR → Quarterly competitive re-research
   ↓ Competitor data refreshed, gap summary updated

5. ALERT → Churn signals detected
   ↓ AM notified, save play generated from competitive data

6. RENEW → Renewal proof package assembled
   ↓ Delta: "You were at 34, now at 71. Here's Phase 2."

7. GROW → Upsell gaps identified
   ↓ Every missing service = revenue opportunity with $ value

8. LEARN → Data enters benchmark dataset
   ↓ Next prospect in same market benefits from prior research

[Arrow loops back to 1]
```

**The four conversations, one data source:**
- **BUY** (new prospect): "Here's what your competitors have that you don't"
- **RESUME** (paused/save play): "While you were paused, this happened in your market"
- **UPSELL** (active client): "Your competitor just did X — here's how we respond"
- **RENEW** (renewal): "When you started at 34, now at 71. Here's the next phase"

---

## PART 5: GOVERNANCE & DATA QUALITY

### Automatic Filters (Built Into Every Bulk Query)
- **Active Role Filter:** Only accounts owned by active users in 7 PDM roles (Account Manager, AM Team Lead, Sales Execs, CEO, Practice Growth Advisor, System Administrator, TCI Mentorship)
- **Noise Account Filter:** Excludes test accounts ("Test", "test", "House of Mouse")
- **Excluded Owners:** William Summers (admin), Service Account, Gerritt Cora, Ariel Canchani
- **Status Filter:** Excludes Cancelled, Inactive, Expired accounts from operational queries
- **Null Status Guard:** Accounts with no Status__c are TCI ticket buyers, not clients — excluded from all client queries

### Health Scoring Model v1
| Component | Weight | Signal |
|---|---|---|
| Engagement | 40% | LastActivityDate — recency of AM contact |
| Case Health | 30% | Open ticket count and priority |
| Renewal | 30% | Days until Contract_Renewal_Date__c |

### Health Tiers
| Tier | Score Range | Color | Meaning |
|---|---|---|---|
| Healthy | 70-100 | 🟢 Green | On track, regular engagement |
| At Risk | 40-69 | 🟡 Yellow | Warning signs, needs attention |
| Critical | 0-39 | 🔴 Red | Immediate intervention required |

---

## PART 6: DELIVERABLE SPECIFICATIONS

### DELIVERABLE 1: Prophet Feature Presentation (20-25 slides)
**Audience:** All staff — leadership, AMs, sales reps, department heads
**Purpose:** "Here's what Prophet does and why it matters"
**Tone:** Confident, data-driven, exciting but professional
**Slide outline:**

1. **Title Slide** — "Prophet by PDM — See What's Coming Before It Arrives"
2. **The Problem** — AMs manage 50+ accounts. Signals get missed. Clients churn.
3. **The Cost of Churn** — At 2-year avg client length: 35.7% annual churn = $X lost. At 8 years: 12.5% = $4M+ saved.
4. **What Is Prophet?** — AI platform connecting Claude to Salesforce. Ask in English, get intelligence.
5. **How It Works** — [Diagram: User → Claude → Prophet → Salesforce → Intelligence → User]
6. **Tool Category: Account Management** — Weekly Synopsis, Pre-Call Brief, Log Note (with example output screenshots)
7. **Tool Category: Health & Risk** — Health Report, Churn Risk, Nightly Scan (with health tier visual)
8. **Tool Category: Pipeline** — Renewal Pipeline, Upsell Opportunities (with gap analysis visual)
9. **Tool Category: Sales Intelligence** — Research Prospect, Lead Intelligence, Rep Synopsis, Event Conversion (with LTB score visual)
10. **Tool Category: Conversation Intelligence** — Call Intelligence, CI Processing (with sentiment trend visual)
11. **Tool Category: Competitive Intelligence** — Competitive Alerts, Renewal Proof Package (with 4-conversation framework)
12. **Demo: Weekly Synopsis** — Real example (sanitized) showing what an AM sees Monday morning
13. **Demo: Pre-Call Brief** — Real example showing the 10-query intelligence package
14. **Demo: Churn Risk** — Real example showing priority-ranked risk list
15. **Demo: Research Prospect** — Real example showing the full market research + Gamma deck pipeline
16. **The Intelligence Flywheel** — [Diagram: 8-station flywheel]
17. **Four Conversations, One Engine** — Buy, Resume, Upsell, Renew — same data, four revenue outcomes
18. **Health Scoring Model** — [Visual: Engagement 40% + Case Health 30% + Renewal 30%]
19. **What's Coming Next** — Agentforce (AI in Salesforce UI), n8n automation, Conversation Intelligence v2, PowerBI dashboards
20. **The Competitive Moat** — No competitor has this dataset. Every call makes Prophet smarter.
21. **Your Daily Routine with Prophet** — [Visual: AM's day before vs. after Prophet]
22. **Getting Started** — Open Claude Desktop → Ask a question → Get intelligence
23. **Q&A**

### DELIVERABLE 2: AM Training Guide (20-30 pages)
**Audience:** Account Managers
**Format:** Step-by-step guide with screenshots, example prompts, and expected outputs
**Sections:**

1. **Getting Started**
   - Opening Claude Desktop
   - The MCP connector (what it is, why it matters)
   - Your first query: "Show me my synopsis"

2. **Your Monday Morning Routine**
   - Step 1: "Show me my weekly synopsis" → review scheduled calls
   - Step 2: "Show me churn risk" → identify urgent accounts
   - Step 3: "Renewal pipeline" → check upcoming renewals
   - Step 4: Prioritize your week based on Prophet's recommendations

3. **Before Every Client Call**
   - "Brief me on [Account Name]" → get the full pre-call brief
   - What each section means and how to use it
   - Reading health scores — what 28/100 really means
   - Identifying the #1 thing to address on this call

4. **After Every Client Call**
   - "Log a note on [Account Name]: [what happened]"
   - Why logging matters for health scores (LastActivityDate drives 40% of score)
   - Doctor contact — always note when you spoke to the doctor

5. **Weekly Risk Review**
   - Understanding the churn risk ranking
   - Priority overrides: refund requests and cancellation notices always top
   - Status signals: what Non Renewing, Paused, and Delinquent mean for your book
   - Creating save plays from competitive data

6. **Renewal Preparation**
   - 30 days out: pull renewal proof package
   - Building the renewal narrative: baseline → today → what's next
   - Using competitive gap data in renewal conversations

7. **Upsell Conversations**
   - "Show me upsell opportunities" → identify service gaps
   - How to frame: "Your competitor has X, you don't" (evidence, not pressure)
   - Tying gaps to specific PDM products with dollar values

8. **Call Intelligence**
   - "Show me calls for [Account Name]" → review meeting history
   - Understanding intelligence scores
   - Using AI summaries to prep for follow-ups

9. **Tips & Best Practices**
   - Contact every client at least once every 30 days (drives health score)
   - Always reach the doctor — doctor-spoke frequency correlates with retention
   - Log notes immediately after every call
   - Check churn risk every week, not just when something feels wrong

10. **Example Prompts — Copy & Paste Ready**
    (Full list of 20+ exact prompts AMs can use)

### DELIVERABLE 3: Sales Rep / PGA Training Guide (15-20 pages)
**Audience:** Practice Growth Advisors (Sales Reps)
**Sections:**

1. **Your Monday Morning Routine**
   - "Show me my pipeline" → rep pipeline synopsis
   - Reading LTB scores — what 72/100 means
   - Identifying your best calls this week

2. **Before Every Discovery Call**
   - "Lead intel on [Practice Name]" → full lead intelligence brief
   - Using Pardot engagement scores to gauge interest level
   - Reading the research summary for conversation starters

3. **Researching a New Prospect**
   - "Research [Practice Name] in [City, State]"
   - Understanding the 3-step pipeline: Research → Scores → Deck
   - Using the Gamma deck in your presentation

4. **Pre-Event Outreach (TCI Conferences)**
   - "Event conversion pipeline" → who's registered but not a client?
   - The 2-week pre-event outreach window
   - Warm them up before they walk in the door

5. **Working Stale Opportunities**
   - Understanding stage velocity (days in current stage)
   - Action recommendations by stage
   - When to escalate vs. disqualify

6. **Example Prompts**
    (Full list of 15+ exact prompts reps can use)

### DELIVERABLE 4: Standard Operating Procedures (SOPs)
**Format:** Numbered step procedures with decision trees

**SOP 1: Pre-Call Preparation**
1. Open Claude Desktop
2. Type: "Brief me on [Account Name]"
3. Review Critical Alerts section first
4. Check health score — if Critical, escalate to Team Lead before call
5. Review last 3 activities — note any commitments made
6. Check doctor contact history — if 90+ days, request doctor join call
7. Review talking points section
8. If renewal within 30 days: also pull renewal proof package
9. Make the call
10. Log note immediately after

**SOP 2: Weekly Churn Risk Review**
1. Every Monday, type: "Show me churn risk"
2. Accounts with refund requests → address within 24 hours
3. Accounts with cancellation requests → schedule save play call within 48 hours
4. Non Renewing status → review competitive gap, prepare counter-offer
5. Score below 30 → immediate outreach, involve Team Lead
6. Score 30-50 → schedule call this week
7. Document actions taken for each at-risk account

**SOP 3: Renewal Preparation (30-Day Process)**
1. Day 30: Pull renewal proof package
2. Day 30: Review competitive gap summary — what's new since last review?
3. Day 25: Schedule renewal call with client
4. Day 20: Prepare renewal deck (competitive delta + results proof)
5. Day 15: Conduct renewal call
6. Day 10: Follow up on any outstanding questions
7. Day 5: Confirm renewal or escalate if at risk
8. Day 0: Auto-billing continues (no action needed if renewed)

**SOP 4: New Client Onboarding (First 30 Days)**
1. Day 1: Pull pre-call brief to understand baseline
2. Day 1: Check if research exists — if not, run sf_research_prospect
3. Day 3: Conduct introduction/launch call
4. Day 7: Log first-week check-in note
5. Day 14: Pull health report — verify engagement score is healthy
6. Day 21: Schedule first alignment call
7. Day 30: Full health check — all systems active, doctor contacted, tickets resolved

**SOP 5: Save Play (Paused / Cancellation Response)**
1. Notification received: client paused or cancellation request filed
2. Pull pre-call brief — review full account context
3. Pull competitive alerts — get "while you were paused" ammunition
4. Review cancellation request details: reason, effective date, new agency
5. Prepare save play: 3 specific actions grounded in competitive data
6. Schedule call within 48 hours
7. Present competitive gap: "While you were on the sideline, [Competitor] did [X]"
8. Propose revised strategy with specific PDM products
9. Log outcome in Salesforce
10. If saved: update plan, schedule follow-up in 2 weeks

**SOP 6: Prospect Research Pipeline**
1. New lead received or rep wants to research a prospect
2. Type: "Research [Practice Name] in [City, State]"
3. Prophet checks Salesforce first for existing records
4. Web research runs automatically
5. Scores written back to Salesforce (LTB, Maturity, Priority, Gap)
6. Gamma prospect deck auto-generated
7. Rep receives "Deck ready" task notification
8. Review deck before discovery call
9. Customize talking points based on Primary Gap Type
10. Conduct discovery call with full competitive intelligence

### DELIVERABLE 5: Quick Reference Card (1 page, both sides)
**Format:** Laminated card or one-page PDF

**SIDE 1: Account Manager Prompts**
```
📅 MONDAY MORNING
"Show me my synopsis"
"Show me churn risk"
"Renewal pipeline"

📞 BEFORE A CALL
"Brief me on [Account Name]"
"Health report for [Account Name]"
"Show me calls for [Account Name]"

📝 AFTER A CALL
"Log a note on [Account Name]: [summary]"

📊 WEEKLY REVIEW
"Show me churn risk for my accounts"
"Upsell opportunities"
"AM coaching brief"

🔄 RENEWAL PREP
"Renewal proof for [Account Name]"
"Competitive alerts for [Account Name]"
```

**SIDE 2: Sales Rep Prompts**
```
📋 MONDAY MORNING
"Show me my pipeline"

🎯 BEFORE A DISCOVERY CALL
"Lead intel on [Practice Name]"
"Research [Practice Name] in [City, State]"

🎟️ PRE-EVENT
"Event conversion pipeline"

💼 PIPELINE MANAGEMENT
"Show me my pipeline" (includes stale opps)

🔍 HEALTH SCORE GUIDE
🟢 70-100 = Healthy (on track)
🟡 40-69 = At Risk (needs attention)
🔴 0-39 = Critical (intervene now)

📊 SCORE GUIDE
LTB 70+ = High intent — call this week
LTB 40-69 = Moderate — nurture
LTB <40 = Low — long-term play
Maturity 0-30 = Massive opportunity
Maturity 70+ = Already mature market
```

### DELIVERABLE 6: Leadership Brief (5-7 slides or 3-page doc)
**Audience:** CEO, VP Sales, VP Account Management
**Tone:** Executive, ROI-focused, strategic
**Content:**

1. **The Retention Math**
   - Current: 2.8-year avg client length → 35.7% annual churn → $X lost/year
   - Target: 8-year avg → 12.5% annual churn → $4M+ protected
   - Prophet's role: detect churn 30-60 days earlier, arm AMs with intelligence

2. **Platform Capability Summary**
   - 18 AI tools live and tested
   - Real-time Salesforce intelligence (no manual reports)
   - Proprietary competitive intelligence dataset (no competitor can replicate)

3. **Key Metrics Prophet Tracks**
   - Health Score distribution across all accounts
   - Revenue at risk (MRR of accounts scoring Critical)
   - Doctor contact frequency (correlates with retention)
   - Renewal pipeline coverage
   - Upsell opportunity pipeline (total gap value)

4. **The Competitive Moat**
   - Every research run builds proprietary market data
   - Every call analyzed builds coaching intelligence
   - Every competitive snapshot compounds over time
   - No other dental marketing agency has this infrastructure

5. **Investment & ROI**
   - Prophet protects against churn on $X monthly MRR
   - If it saves 5 accounts/quarter at avg $8k MRR = $480k/year protected
   - One Platinum account saved ($20k+ MRR) = $240k+ annual revenue retained

6. **Roadmap**
   - Now: 18 tools live for AMs and Reps via Claude Desktop
   - Next 30 days: HTTP transport → entire team has access
   - Next 60 days: Agentforce → AI embedded in Salesforce UI
   - Next 90 days: n8n automation → nightly scans, auto-alerts, Gamma decks
   - 6 months: PowerBI executive dashboards, Conversation Intelligence v2

---

## PART 7: VISUAL SPECIFICATIONS FOR CHATGPT

### Diagrams to Create

1. **System Architecture Diagram**
   - Show: Claude Desktop → MCP Protocol → Prophet Server → jsforce → Salesforce
   - Style: Clean, modern, navy/teal color scheme
   - Include: Data flow arrows, security boundary notation

2. **Tool Category Map**
   - 6 categories arranged in a hex/circle layout:
     - Account Management (4 tools)
     - Health & Risk (3 tools)
     - Pipeline (2 tools)
     - Sales Intelligence (6 tools)
     - Conversation Intelligence (1 tool)
     - Competitive Intelligence (2 tools)

3. **Intelligence Flywheel**
   - 8-station circular diagram (see Part 4 above)
   - Each station shows: action → data written → next station
   - Center text: "Every action compounds"

4. **Health Score Visual**
   - Gauge/meter showing 0-100 with color zones
   - Breakdown: 3 weighted components shown as stacked bars

5. **AM Daily Workflow — Before vs. After Prophet**
   - Split screen: Left = "Without Prophet" (manual, reactive, unprepared)
   - Right = "With Prophet" (informed, proactive, data-driven)

6. **The 4-Conversation Framework**
   - 4 quadrants: Buy, Resume, Upsell, Renew
   - Center: "One Competitive Intelligence Database"
   - Each quadrant shows: trigger, data used, outcome

7. **Churn Risk Priority Pyramid**
   - Top: Refund Requests (highest priority)
   - Middle: Cancellation Requests
   - Next: Status Signals (Non Renewing, Paused, Delinquent)
   - Base: Score-based ranking

8. **Research → Deck Pipeline Flow**
   - Linear flow: Ask Prophet → Salesforce Check → Web Research → Scores Written → Gamma Deck Generated → Rep Notified
   - 3 tool icons: sf_research_prospect → sf_save_research_scores → sf_save_deck_url

### Image Style Guide
- **Colors:** Navy (#1a2b4a), Teal (#1abc9c), White (#ffffff), Gold (#f4d03f), Red (#e74c3c) for alerts
- **Fonts:** Clean sans-serif (Montserrat, Open Sans, or similar)
- **Icons:** Use dental/medical themed icons where appropriate (tooth, stethoscope, chart)
- **Screenshots:** Create mockup-style screenshots showing example tool outputs in a Claude Desktop-like interface
- **Charts:** Use clean, modern chart styles — no 3D effects, no gradients

---

## PART 8: BRAND & TONE GUIDE

### Writing Style
- Confident but not arrogant
- Data-driven — always cite specific numbers
- Action-oriented — tell people what to DO, not just what exists
- PDM-specific — use real terminology (Tickets, not Cases; Practice Growth Advisor, not Sales Rep)

### Key Messages
1. **For AMs:** "Prophet makes you the most prepared person in every conversation."
2. **For Reps:** "Know more about the prospect's market than they do — before you ever call."
3. **For Leadership:** "Every client conversation is grounded in live competitive intelligence no competitor can replicate."
4. **For Everyone:** "See what's coming before it arrives."

### What NOT to Say
- Don't call it "just a Salesforce dashboard" — it's an intelligence platform
- Don't say "AI replaces" anything — it amplifies human judgment
- Don't promise specific churn reduction numbers — focus on capability and data quality
- Don't reference internal technical details (MCP, jsforce, TypeScript) in user-facing docs

---

## PART 9: ADDITIONAL DELIVERABLES (PLUS IT)

If you have capacity, also create:

### Video Script: "Prophet in 3 Minutes"
30-second hook → problem → solution → 3 demo highlights → closing CTA
For internal launch event or team meeting

### Onboarding Email Sequence (3 emails)
- Email 1: "Welcome to Prophet — here's your first 5 prompts"
- Email 2: "Your Monday morning routine with Prophet"
- Email 3: "Advanced moves: churn risk, competitive intel, and save plays"

### FAQ Document
Top 20 questions users will ask:
- "Does Prophet change data in Salesforce?" (Only sf_log_account_note, sf_save_research_scores, and sf_save_deck_url write data)
- "Can other people see my queries?" (No — Prophet runs locally in your Claude Desktop)
- "What if the data looks wrong?" (Prophet reads live Salesforce data — if it's wrong in SF, it's wrong in Prophet)
- "How often is data updated?" (Real-time — every query hits live Salesforce)
- etc.

---

**END OF PROMPT**

*This prompt contains the complete knowledge base for Prophet by PDM. Every tool, every field, every workflow, every use case. Use it to create world-class documentation that makes this platform accessible to every team member at Progressive Dental Marketing.*
