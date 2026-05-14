# CLAUDE-research-spec.md — Sales Market Research GPT Spec
*Load this file when building or modifying sf_research_prospect or sf_get_competitive_alerts.*

---

## sf_research_prospect — Core Architecture

**The critical upgrade over ChatGPT version:** Check Salesforce FIRST. Write scores back AFTER. Intelligence persists — doesn't evaporate when the conversation ends.

**Inputs:** Practice name + city/state OR website URL
**Salesforce pre-check:** Query Lead and Account for existing records, activity history, prior touches, account owner
**Web research:** Full market analysis via Anthropic tool-use API

---

## Output Sections (in order)

1. 📍 Location / Practice / Website
2. Market Snapshot (10–30 mile radius, 45+ population, income, affluent ZIPs, retirement communities)
3. Competitive Landscape (dominant competitor, easiest to disrupt, most competitive pressure)
4. Practice Evaluation (website, branding, mobile, trust signals, doctor authority, before/after, financing CTA)
5. SEO Gap Analysis (implant/full-arch/All-on-4 pages, keyword targeting, local landing pages, Maps relevance)
6. Google Ads Opportunity
7. Reputation Analysis (rating, review count, sentiment themes)
8. Google Maps & Local Visibility
9. Opportunity Gaps (missing elements, competitor advantages, "what if you do nothing")
10. Marketing Maturity Score (0–100)
11. Likelihood to Buy Score (0–100)
12. Priority Level (Low / Moderate / High / Top Priority)
13. Market Domination Strategy (most important channel, fastest path to growth, biggest competitor weakness, best ZIPs, niche positioning, short and long term)
14. Strategic Recommendations (3–5 with what/why/impact)
15. Sales Enablement Summary:
    - Executive Summary for the Rep
    - Why This Matters to the Prospect
    - Talking Points (7–10)
    - Discovery Questions (5–8)
    - Likely Objections and Responses (3–5)
    - Positioning Statement
    - Recommended Next Step

---

## Salesforce Write-Back (all required)

| Field | Notes |
|---|---|
| `Marketing_Maturity_Score__c` | 0–100 |
| `Likelihood_to_Buy_Score__c` | 0–100 |
| `Priority_Level__c` | Low / Moderate / High / Top Priority |
| `Research_Summary__c` | Rich text snapshot |
| `Primary_Gap_Type__c` | SEO / Reputation / Video / Authority / Maps — drives Gamma template |
| `Baseline_Marketing_Maturity__c` | Locked at close, never changes — proof-of-value benchmark |
| `Competitive_Gap_Summary__c` | Full structured gap analysis (see format below) |
| `Estimated_Monthly_Gap_Value__c` | Sum of recurring Phase 2 + TCI Mentorship gaps ONLY (not Phase 1) |

**On completion:** Trigger n8n Workflow 1 → select Gamma template by Primary_Gap_Type__c → generate deck → write URL to Gamma__c → create Task for rep

---

## Competitive Gap Summary Format (Competitive_Gap_Summary__c)

Required field. Powers four revenue conversations. Structure exactly as:

```
═══ PHASE 1: FOUNDATION SERVICES (one-time) ═══

Website
  Competitor: [Modern/Dated] — implant pages [YES/NO], before/after [YES/NO], financing CTA [YES/NO], mobile [YES/NO]
  Client: [Current state]
  Gap: YES / NO
  PDM Product: Website Development & Publish

Video
  Competitor: YouTube [YES/NO] — [X videos], procedure walkthroughs [YES/NO], patient testimonials [YES/NO], doctor authority [YES/NO]
  Client: [Current state]
  Gap: YES / NO
  PDM Product: Video Production

Branding / Creative
  Competitor: Consistent brand [YES/NO], custom graphics [YES/NO], polished social creative [YES/NO]
  Client: [Current state]
  Gap: YES / NO
  PDM Product: Graphic Design

Traditional Media
  Competitor: TV [YES/NO], Radio [YES/NO], Billboard [YES/NO], Direct Mail [YES/NO]
  Client: [Current state]
  Gap: YES / NO
  PDM Product: Traditional Media

═══ PHASE 2: RECURRING MARKETING SERVICES ═══

PPC / Google Ads
  Competitor: Running ads [YES/NO] — keywords: [list], est. spend: $X/mo
  Client: On PPC [YES/NO] — budget: $X/mo
  Gap: YES / NO
  PDM Product: PPC Add-on / PPC Budget Increase

SEO — Organic Rankings
  Competitor: Ranking #[X] for [keywords] — implant page [YES/NO], All-on-4 [YES/NO], full-arch [YES/NO]
  Client: Ranking #[X] for [keywords]
  Gap: YES / NO
  PDM Product: SEO / SEO Expansion

SEO — Local Landing Pages
  Competitor: Local pages for [ZIP/city list] — [X pages]
  Client: Single location [YES/NO], local pages [X]
  Gap: YES / NO
  PDM Product: SEO Local Expansion

SEO — Google Maps / Local Pack
  Competitor: Maps Pack for [X queries] — ranked #[X]
  Client: Maps Pack for [Y queries] — ranked #[Y]
  Gap: YES / NO
  PDM Product: SEO / Local SEO

Reputation / Reviews
  Competitor: [X] reviews, [Y.Y] stars, gaining [Z]/month
  Client: [X] reviews, [Y.Y] stars, gaining [Z]/month
  Gap: YES / NO · Trend: Widening / Stable / Closing
  PDM Product: SEO / Reputation Strategy

Social Media
  Competitor: Active on [platforms], posting [X/week], social ads [YES/NO], doctor reels [YES/NO]
  Client: Active on [platforms], posting [X/week]
  Gap: YES / NO
  PDM Product: Social Media Marketing

═══ TCI EVENTS ═══

Event Attendance / Market Presence
  Competitor: Attended TCI events [YES/NO — inferred]
  Client: TCI Events attended [X] — last: [name/date]
  PDM Product: TCI Events (ticket / sponsorship)

═══ TCI MENTORSHIP ═══

Staff Training / Case Acceptance
  Competitor: Reviews mention "great consultation", "financing explained" [YES/NO]
  Client: TCI enrolled [YES/NO] — TCI Status: [value]
  Gap: Signal present / No signal
  PDM Product: TCI Mentorship

═══ COMPOSITE ═══
Total Gaps: X (Phase 1: X | Phase 2: X | TCI: X)
Estimated One-Time Opportunity: $X,XXX
Estimated Monthly Recurring Opportunity: $X,XXX/mo
Total Monthly Gap Value: $X,XXX/mo recurring + $X,XXX one-time
Highest Urgency Gap: [Product] — [one-line reason]
Recommended First Conversation: [Product] — [why]

Save Play Hook (Paused/Cancellation):
  "While you've been paused, [Competitor] has [specific action]. Meanwhile, your [metric] has [changed].
   Here's the three-move play to re-establish dominance — and it starts with [specific PDM product]."

Upsell Hook (Active — quarterly review):
  "Your competitor just [specific action]. You're ahead in [area] but the [gap] is widening. Here's how we respond."

Renewal Hook:
  "When you started, [baseline]. Today, [current state]. Meanwhile, [top competitor] has [shifted].
   Here's Phase [X] of the strategy."
```

---

## The Four Conversations — One Data Source

| Context | Frame | Revenue Outcome |
|---|---|---|
| New Prospect | "Here's what competitors have that you don't — and how PDM closes those gaps" | Close the deal |
| Paused/Save Play | "While you were paused, [Competitor] did [X]. Here's the three-move response." | Re-activate with urgency |
| Active Client (Quarterly) | "Competitor gained X reviews. You're ahead in SEO but PPC gap is widening." | Upsell with evidence |
| Renewal | "You were at 34 maturity, now 71. Competitor dropped from #1 to #4. Here's Phase 2." | Renew + expand scope |

---

## Accuracy Rules (Enforce Strictly)
- Never fabricate — if signal can't be confirmed, say so
- Label all assumptions and estimates
- Do not claim PDM works with practice without public evidence
- Every gap must map to a specific PDM product
- Every hook must cite a specific observed competitor action — no generic statements
- `Estimated_Monthly_Gap_Value__c` = Phase 2 + TCI Mentorship gaps ONLY (never include one-time Phase 1)

---

## Plus It Additions for sf_research_prospect
- Competitor snapshot stored as Competitor_Snapshot__c records → re-checked quarterly for delta alerts
- `External_Competitive_Pressure__c` updated quarterly via n8n Workflow 6
- Auto-generated draft prospecting email from findings
- Territory heat map data written to support PowerBI visualization
- PDM benchmark: "Practices like this started at X and are now at Y"
- "What If You Do Nothing" projection: competitor review velocity × 12 months = concrete urgency number
