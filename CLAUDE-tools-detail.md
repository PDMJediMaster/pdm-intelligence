# CLAUDE-tools-detail.md — Tool Specs & n8n Workflows
*Load this file when adding, modifying, or debugging tools or n8n workflows.*

---

## Live Tool Details

### TOOL 1: sf_get_weekly_synopsis
**File:** `src/tools/accountManagement.ts`
**Output:** Health tier, MRR, days since contact, open refund requests, doctor contact badges, renewal proximity, flagged risks, suggested talking points
**Excludes:** William Summers accounts (`OwnerId != '005PU000001eUQDYA2'`), Cancelled/Inactive/Expired
**Parallel queries:** Account + Cases + Opportunities + Tasks + Contacts + Refund Requests

### TOOL 2: sf_get_pre_call_brief
**File:** `src/tools/accountManagement.ts`
**Accepts:** accountId OR accountName (fuzzy search)
**10 parallel queries:** Account (25+ fields), Contacts, Cases, Opportunities, Tasks (full Description + Spoke_with_Doctor__c), Assets, Business Objectives, Reassignments, Refund Requests, Zoom AI Summaries
**Output sections:** Critical Alerts → Account Overview → Account Intel → Budget → Active Services → Business Objectives → AM Transition History → Zoom AI Summary → Key Contacts → Recent Activity → Open Tickets → Active Opportunities → Health Score Breakdown

### TOOL 3: sf_log_account_note
**File:** `src/tools/accountManagement.ts`
**Creates:** Task with Status = Completed, optionally links to Contact

### TOOL 4: sf_get_account_health_report
**File:** `src/tools/healthReports.ts`
**Scoring:** Engagement 40% + Case Health 30% + Renewal 30% = 0–100
**Tiers:** 🟢 Healthy 70–100 | 🟡 At Risk 40–69 | 🔴 Critical 0–39

### TOOL 5: sf_get_churn_risk_accounts
**File:** `src/tools/healthReports.ts`
**Parameters:** owner_id (optional), limit (default 25), threshold (default 50)
**Priority override:** Accounts with open Refund Requests → top of list regardless of score
**Additional signals:** Cancellation Change Orders, delinquency, cancellation/pause request date, flagged status

### TOOL 6: sf_get_renewal_pipeline
**File:** `src/tools/pipeline.ts`
**Parameters:** days_ahead, owner_id, limit

### TOOL 7: sf_get_upsell_opportunities
**File:** `src/tools/pipeline.ts`
**Parameters:** owner_id, limit, min_health_score

### TOOL 8: sf_get_call_intelligence
**File:** `src/tools/callIntelligence.ts`
**Accepts:** accountId OR accountName
**Parameters:** lookback_days (default 90), max_calls (default 5), include_transcript (default false)
**Phase 1 (Zoom AI Summary):** Tasks with ZVC__Zoom_Meeting__c → ZVC__Meeting_AI_Summary__c + ZVC__Zoom_Call_Log__c → ZVC__AIC_Call_Summary__c
**Phase 2 (CITranscriptEvent):** Enabled via include_transcript: true. Token guard: truncate at 50,000 chars.

---

## Planned Tool Specs

### TOOL 9: sf_research_prospect
See `CLAUDE-research-spec.md` for full specification including output format, competitive gap structure, and four-conversation framework.

### TOOL 10: sf_get_competitive_alerts
**Purpose:** Delta report on Competitor_Snapshot__c records — powers save plays, upsell, renewals
**Competitor signal → PDM product mapping:**

| Signal | Gap | Product |
|---|---|---|
| YouTube / procedure videos | No video presence | Phase 1: Video Production |
| Modern website, implant pages | Dated site | Phase 1: Website Development |
| Polished social creative | Inconsistent brand | Phase 1: Graphic Design |
| TV / radio / billboard | Not in traditional media | Phase 1: Traditional Media |
| Running Google Ads | Not on PPC or underspending | Phase 2: PPC |
| Ranking #1-3 for implant keywords | Buried on page 2+ | Phase 2: SEO |
| Local landing pages by ZIP | No local pages | Phase 2: SEO Local Expansion |
| Maps Pack #1-3 | Client barely shows up | Phase 2: SEO / Local SEO |
| Active social + running ads | Dormant social | Phase 2: Social Media |
| 300+ reviews, 15+/mo | Falling behind | Phase 2: SEO / Reputation |
| Reviews: "great consultation" | Staff not trained on case acceptance | TCI Mentorship |

**Output:** Delta since last snapshot · Service gap table mapped to PDM products · Estimated_Monthly_Gap_Value__c · Save Play hook · Upsell hook

### TOOL 11: sf_get_sales_objection_patterns
**Purpose:** Mine CI transcripts for objection patterns by outcome
**Output:** "Price objection in 67% of closed-won deals, only 12% required >2 responses"

### TOOL 12: sf_get_benchmark_comparison
**Purpose:** Compare prospect/client against PDM benchmark dataset
**Output:** "Practices like yours started at 34 maturity, averaged 71 after 18 months"

### TOOL 13: sf_get_renewal_proof_package
**Triggers:** 30 days before Contract_Renewal_Date__c
**Queries:** Baseline_Marketing_Maturity__c delta, competitive position change, 6-month call sentiment, benchmark comparison
**Output:** Structured data for Gamma-generated renewal deck via n8n

### TOOL 14: sf_get_rep_pipeline_synopsis
**Purpose:** Monday morning rep brief
**Queries:** Leads by Likelihood_to_Buy_Score__c, competitive alerts on active leads, stagnant opps (Days_In_Current_Stage__c > threshold)

### TOOL 15: tci_get_student_status
**Queries:** TCI_Training_Progress__c, TCI_Events__c

### TOOL 16: sf_get_lead_intelligence
**Queries:** Lead with pi__utm_source__c, pi__score__c, pi__grade__c, ConvertedDate, pi__campaign__c

---

## n8n Workflows
**n8n endpoint:** https://pdm2026.app.n8n.cloud/mcp-server/http

### Workflow 1: Prospect Research + Gamma Deck
**Trigger:** sf_research_prospect completes → structured JSON
1. Receive JSON → select Gamma template by Primary_Gap_Type__c (SEO / Reputation / Video / Authority)
2. POST to Gamma API → receive deck URL
3. Create Gamma__c record in Salesforce (Gamma_Link__c = URL, Account__c or Lead__c = parent)
4. Create Task for rep: "Your prospect deck is ready — [URL]"

### Workflow 2: Competitive Monitor (Weekly)
**Trigger:** Monday 6:00 AM
1. Query active Leads with Priority_Level__c = High or Top Priority
2. Run lightweight competitive check → compare to Competitor_Snapshot__c
3. Delta > threshold → create Salesforce Task for rep + update snapshot

### Workflow 3: Churn Signal Scanner (Nightly)
**Trigger:** Nightly 11:00 PM
1. Query active Accounts (exclude terminal statuses + William Summers)
2. Recalculate health scores → flag accounts that dropped tier
3. Create Case/Task for AM on At Risk or Critical · Post to Google Chat if Critical

### Workflow 4: Stage Velocity Alert (Daily)
**Trigger:** Daily 7:00 AM
1. Query Opps where Days_In_Current_Stage__c > stage threshold
2. Create Task for rep with AI action suggestion · Escalate to manager if >2x threshold

### Workflow 5: Renewal Proof Package (30-Day Trigger)
**Trigger:** Contract_Renewal_Date__c = TODAY + 30
1. Assemble JSON: maturity delta, competitive change, sentiment trend, benchmark
2. POST to Gamma API with renewal deck template → write URL to Account.Renewal_Deck_URL__c
3. Create Task for AM: "Renewal deck ready — [URL]"

### Workflow 6: Quarterly Competitive Re-Research
**Trigger:** Quarterly, all active Accounts
1. Lightweight competitive audit → update External_Competitive_Pressure__c
2. Significant increase → flag for AM with alert

### Workflow 7: Weekly Executive Briefing
**Trigger:** Monday 5:00 AM
1. Query health distribution, stage velocity, churn signals, market opportunity by territory
2. Assemble and email to leadership

### Workflow 11: Nightly Conversation Intelligence Processing
**Trigger:** Nightly 1:00 AM
**Purpose:** Process every VideoCall without a Call_Intelligence__c record. Mine transcripts → write structured AI signals to Salesforce.
1. Query VideoCall records: no linked CI record, StartDateTime >= LAST_N_DAYS:90, limit 50/run
2. Fetch CITranscriptEvent via Salesforce REST API
3. POST to Anthropic API (Claude Sonnet) → extract: sentiment, tone shift, topics, commitments, risk signals, competitor mentions, doctor reached, satisfaction, budget concern, pause/cancel language
4. Create Call_Intelligence__c record → set Processing_Status__c = 'Processed'
5. Risk signals found OR Pause_Cancel_Language__c = true → update Account.Sentiment_Trend__c → if Critical: create Task for AM immediately
6. Error: set Processing_Status__c = 'Pending', log Processing_Error__c → retry next night

**Historical Backfill:** Same workflow, remove date filter. Process all historical VideoCall records in batches of 50.

**Enables:** Sentiment_Trend__c reflects actual call tone · "Last 3 calls: Neutral → Neutral → Frustrated" in pre-call brief · Churn pattern detection · AM coaching benchmarks · Commitment tracking

### Workflow 22: Lead Activation Pipeline (IN BUILD)
**Trigger:** Manual (Schedule trigger when production-ready)
**Source:** Google Sheet — PDM Lead Activation Queue (`1Osbm4wjyytFv5ah2aAO2JmCWTmO-1Htxn-0f19sM51w`)
**Sheet columns:** Practice Name (A) · Website (B) · City (C) · State (D) · Doctor First Name (E) · Doctor Last Name (F) · Email (G) · Phone (H) · Source (I) · Status (J) · SF Lead ID (K) · Processed Date (L) · Notes (M)
**Gate logic:** RocketReach must return direct mobile OR personal non-generic email. Generic role emails (info@, contactus@, office@, etc.) rejected — Account Engagement won't send to them.
**Flow:** Read Queue → Filter Unprocessed → Split In Batches (1) → Mark Processing → Normalize Row → RocketReach Lookup → Check Enrichment Gate → [PASS] Create SF Lead → Prophet Research → Gamma [FAIL] Mark Failed with reason
**RocketReach API:** POST https://api.rocketreach.co/v2/api/search · Header: Api-Key
**Current version:** v7m (in `/tmp/` and Desktop)
