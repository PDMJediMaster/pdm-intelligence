# CLAUDE-build-queue.md — Build Queue & Roadmap
*Load this file during planning sessions or when determining what to build next.*

---

## Session Protocol
Sessions follow this order — do not skip steps:
1. **Build** — Build tools and n8n workflows. Test n8n workflows to confirm they are buttoned up.
2. **Conversation Insights** — Unlock and integrate CI data: videos, transcripts, call recordings.
3. **Testing** — Full end-to-end testing of all tools against real Salesforce data.
4. **Agentforce Fix** — Fix topic routing, remove conflicting Marketing Cloud actions, fix Classification Descriptions.
5. **Plus It Builds** — Build from the prioritized roadmap in CLAUDE-vision.md.

---

## Immediate Build Queue

### IN PROGRESS: Workflow 22 — Lead Activation Pipeline
- Google Sheets → RocketReach enrichment → SF Lead creation → Prophet research → Gamma
- Gate: RocketReach must find direct mobile OR personal email (not generic role address)
- Status: v7m built, RocketReach 400 errors resolved, testing gate logic
- **Next:** Test with real dental practice that RocketReach covers · Add Schedule trigger for production

### NEXT: Workflow 11 — Nightly Conversation Intelligence
- Process all VideoCall records → mine transcripts → write to Call_Intelligence__c
- See CLAUDE-tools-detail.md for full workflow spec
- Prerequisite: Verify UnifiedVideoCall → Account relationship chain in live org

---

## Short Term — Next 2 Weeks

### Salesforce Fields To Build First
Before sf_research_prospect can write data back:

| Field | Object | Type |
|---|---|---|
| `Stage_Entry_Date__c` | Opportunity | Date/Time |
| `Days_In_Current_Stage__c` | Opportunity | Formula: TODAY − Stage_Entry_Date__c |
| `Baseline_Marketing_Maturity__c` | Account | Number — locked at close |
| `External_Competitive_Pressure__c` | Account | Number — updated quarterly |
| `Marketing_Maturity_Score__c` | Lead + Account | Number |
| `Likelihood_to_Buy_Score__c` | Lead + Account | Number |
| `Priority_Level__c` | Lead + Account | Picklist: Low / Moderate / High / Top Priority |
| `Research_Summary__c` | Lead + Account | Long Text Area |
| `Primary_Gap_Type__c` | Lead + Account | Picklist: SEO / Reputation / Video / Authority / Maps |
| `Competitive_Gap_Summary__c` | Lead + Account | Long Text(32,000) |
| `Estimated_Monthly_Gap_Value__c` | Lead + Account | Currency |
| `Renewal_Deck_URL__c` | Account | URL |

### Salesforce Flows To Build
- **Stage_Entry_Date__c stamp:** Record-triggered Flow on Opportunity → fires when StageName changes → stamps Stage_Entry_Date__c
- **Churn signal calculation:** Scheduled nightly Flow → updates health score proxy fields
- **Renewal alert:** Record-triggered Flow when Contract_Renewal_Date__c = TODAY + 30

### Build sf_research_prospect (if not already live)
- Salesforce pre-check first (existing Lead/Account)
- Web research via Anthropic tool-use API
- Write scores back: Marketing_Maturity_Score__c, LTB score, Priority_Level__c, Primary_Gap_Type__c
- Full spec in CLAUDE-research-spec.md

---

## Medium Term — Next 30–60 Days

### Step 7: Workflow 1 — Prospect Research + Gamma Deck
- sf_research_prospect completes → n8n webhook → select Gamma template → POST to Gamma API → write deck URL to Salesforce → create Task for rep

### Step 8: sf_get_competitive_alerts
- Competitor snapshot storage + weekly n8n re-check
- Delta report surfaces in weekly synopsis

### Step 9: sf_get_rep_pipeline_synopsis
- Leads ranked by Likelihood_to_Buy_Score__c
- Competitive alerts on active leads
- Stagnant opps with recommended actions

### Step 10: Agentforce Topic 1 — Account Health Brief
**Prerequisites:**
1. n8n HTTP endpoint live (Agentforce → n8n webhook → MCP → Salesforce)
2. Salesforce prompt templates matching doc #018 standards
3. Foundation fields exist (Stage_Entry_Date__c, Baseline_Marketing_Maturity__c)

---

## Long Term — Next 60–90 Days

- **Step 11:** sf_get_renewal_proof_package + n8n renewal deck workflow
- **Step 12:** sf_get_benchmark_comparison (needs accumulated research data)
- **Step 13:** sf_get_sales_objection_patterns (needs CI transcript volume)
- **Step 14:** PowerBI executive dashboard connected to live Salesforce
- **Step 15:** Agentforce Topics 2–5 (Pre-Call Prep, Opp Next Best Action, Churn Risk, Prospect Brief)
- **Step 16:** tci_get_student_status, sf_get_lead_intelligence, attribution tool
- **Step 17:** Health Scoring Model v2 with Conversation Health dimension (15%)

---

## Agentforce Architecture (Planned — Nothing Built)

**7 Intelligence Domains:**
1. Account Intelligence — health, relationship risk, next actions (AMs)
2. Opportunity Intelligence — deal summaries, stage risk, next best actions (Sales Reps)
3. Marketing Intelligence — lead scoring context, campaign signals (Marketing/Pardot)
4. Client Success Intelligence — churn signals, retention alerts (AMs)
5. Training & Event Intelligence — TCI progress, event follow-ups (TCI Dept)
6. Meeting & Conversation Intelligence — pre-call briefs, post-call summaries (all client-facing)
7. Operational Intelligence — pipeline health, territory performance (Leadership)

**Topic Build Order:**
1. Account Health Brief: "How is this account doing?"
2. Pre-Call Preparation: full brief for Account or Lead
3. Opportunity Next Best Action: stagnant deal coaching
4. Churn Risk Alert: "Which of my accounts need attention?"
5. Prospect Market Brief: pulls stored sf_research_prospect output

**Architecture:** Agentforce → n8n webhook → MCP tool → Salesforce → response
