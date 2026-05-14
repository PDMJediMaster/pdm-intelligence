# CLAUDE-vision.md — Strategic Vision, Flywheel & Plus It
*Load this file for strategic discussions, executive presentations, or Plus It planning.*

---

## The PDM Intelligence Flywheel

Every action contributes to a proprietary dataset that becomes more valuable and unreplicable over time:

1. **sf_research_prospect** runs on new lead → Maturity Score + Competitive Gap written to Salesforce
2. **Lead converts** → `Baseline_Marketing_Maturity__c` locked forever (proof-of-value benchmark). Gap Summary becomes Year 1 upsell roadmap.
3. **Client receives services** → Health scores tracked monthly, call intelligence captured. Gaps close, new ones surface.
4. **Quarterly re-research** → `Competitive_Gap_Summary__c` and `Estimated_Monthly_Gap_Value__c` refreshed. AM gets "what changed this quarter" brief.
5. **Client goes Paused/flags cancellation** → Workflow 10 triggers. Save Play hook pulled from gap summary. AM walks in with: "While you were paused, this happened in your market."
6. **At renewal** → sf_get_renewal_proof_package: "You were at 34 maturity, now 71. Here are 3 competitors you've passed. Here are 2 new gaps."
7. **After close/churn** → Data enters benchmark dataset
8. **Next prospect in same market** → "We already know your market — here's what the top 3 competitors are doing right now."

**The moat:** The same research that closes a new sale becomes the retention tool, then the save play, then the renewal proof. Every conversation is grounded in data no competitor can replicate.

---

## Health Scoring Model

### v1 (Live)
- Engagement: 40% (LastActivityDate)
- Case Health: 30% (open cases by priority)
- Renewal: 30% (Contract_Renewal_Date__c proximity)
- Tiers: 🟢 Healthy 70–100 · 🟡 At Risk 40–69 · 🔴 Critical 0–39

### v2 (Planned — requires Conversation Intelligence data)
- Engagement: 35%
- Case Health: 25%
- Renewal: 25%
- Conversation Health: 15% (call recency, frequency trend, sentiment from Call_Intelligence__c)

---

## Executive Dashboard — PowerBI Specification

**Platform:** PowerBI connected to Salesforce live data
**Refresh:** Daily (after nightly churn scanner)
**Audience:** CEO, VP Sales, VP Account Management

**9 Dashboard Sections:**
1. **Lifecycle Funnel KPIs** — Leads MTD, Lead→Opp rate, Opps Closed Won, Active Clients, Avg Client Length (target: 8 yrs), At-Risk, Critical, Revenue at Risk
2. **Stage Velocity Bars** — Days in each Opp stage vs. target, color-coded by stagnancy
3. **Health Score Distribution** — Donut: Healthy / Watch / At Risk / Critical with ACV per tier
4. **Churn Signal Frequency Table** — Top signals ranked by frequency, accounts affected, ACV exposure, recommended response
5. **Churn Avoidance Scorecard** — Accounts saved, revenue protected, saves via proactive call
6. **LTV Impact Calculator** — Interactive slider: avg client length 2→8 years → shows annual churn rate, savings vs. today, 5-year retained revenue. At 8 years: −$4M+ annual churn.
7. **US Market Opportunity Map** — Choropleth by state: 45+ population × income × implant demand × inverse PDM penetration. Click state → fires sf_research_prospect.
8. **Rep Performance Leaderboard** — Stage velocity by rep, fastest Discovery→Proposal, fastest Proposal→Close
9. **Renewal Countdown** — Accounts renewing in 90 days, color-coded by health score

---

## Plus It — Standing Enhancement Queue

Proactive enhancements to propose and build:

1. **AM Performance Coaching Brief** — Weekly digest per AM: account health trends vs. team average. Which AM behaviors correlate with healthiest books of business.

2. **Voice-to-Note via Zoom** — After every Zoom call, auto-create sf_log_account_note from the Zoom AI Summary. Eliminates manual logging entirely.

3. **Competitive Pressure Heatmap** — PowerBI layer: which PDM clients face the most competitive pressure by geography. Red zones = retention priority markets.

4. **Client Sentiment Trend** — Mine CITranscriptEvent over time for tone signals. A client saying "great" → "okay" → "I guess" is signaling dissatisfaction before they say it explicitly.

5. **New Client Welcome Intelligence** — When Account created (close date = today), auto-run sf_research_prospect and lock Baseline_Marketing_Maturity__c. AM gets full brief before onboarding call.

6. **Doctor-Spoke Frequency Report** — Track AM_Spoke_to_Doctor__c across the book. AMs who regularly reach the doctor have dramatically lower churn. Surface as coaching metric in weekly synopsis.

7. **"What If You Do Nothing" Calculator** — Project competitor review trajectory 12 months forward. Competitor gaining 15 reviews/month = 180 more reviews next year. Concrete urgency grounded in math.

8. **Referral Network Map** — Track which accounts were referred by others. If referring account churns, referrals are 3× more likely to follow. Flag in churn risk reports.

9. **Seasonal Implant Demand Signals** — Dental implant demand follows seasonal patterns. Calendar-aware component alerts AMs when their markets historically see demand spikes — best time for clients to increase ad spend.

10. **Pardot Score → LTB Integration** — Push Likelihood_to_Buy_Score__c into Pardot as custom scoring attribute. High-LTB leads get accelerated nurture sequences automatically.

---

## Departments Claude Serves at PDM

Account Managers · Sales Reps · Finance · Corporate Marketing · The Closing Institute (TCI) · Video · Web & Graphic Design · PPC · Social Media & SEO · Traditional Media · Service Cloud Users
