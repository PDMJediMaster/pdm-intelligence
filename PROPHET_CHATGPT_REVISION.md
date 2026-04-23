# REVISION PROMPT — Prophet Feature Presentation v3

> **Instructions to ChatGPT:** You already created Version 2 of the Prophet Feature Presentation. It is a strong foundation but needs significant revision before it is ready. Apply ALL of the following changes to produce Version 3. Do not skip any item. The original master prompt (PROPHET_CHATGPT_PROMPT.md) remains your source of truth for all technical details.

---

## 1. FIX THE SLIDE ORDER

Version 2 jumps between topics. Reorder to follow a narrative arc: **Problem → Cost → Solution → How → Proof → Demos → Strategy → ROI → Action.**

Use this exact slide sequence:

| Slide | Content | Notes |
|---|---|---|
| 1 | Title — "Prophet by PDM — See What's Coming Before It Arrives" | Keep V2 subtitle: "AI Intelligence for Every Client Conversation" |
| 2 | The Reality Today | V2 Slide 12 content. AMs manage 50+ clients, signals buried, problems found too late, churn builds quietly. |
| 3 | The Cost of Missing Signals | V2 Slide 16 content. 2-year avg = 35.7% churn. 8-year target = 12.5%. $4M+ revenue protected. Use a visual: two gauges or two columns showing "Today" vs. "Target." |
| 4 | The Real Problem — Visibility, Not Effort | V2 Slide 17. "You can't act on what you can't see." |
| 5 | What Is Prophet? | V2 Slide 18. AI platform connected to Salesforce. Plain English. Real-time. No reports, no digging. |
| 6 | How Prophet Works (Architecture Diagram) | V2 Slide 19. Add a visual flow: User → Claude Desktop → Prophet MCP → Salesforce → AI Analysis → Intelligence Brief → User Takes Action. Make this a proper diagram, not just text. |
| 7 | Before vs. After Prophet | V2 Slide 20. Split-screen layout: Left = Without Prophet (reactive, manual, scrambling). Right = With Prophet (proactive, informed, confident). Be specific — use real examples like "45 minutes prepping for a call" vs. "30 seconds asking Prophet." |
| 8 | What Prophet Covers — 6 Intelligence Categories | V2 Slide 21, but expand into a visual map. Show 6 hex/circle categories with tool counts: Account Management (3 tools), Health & Risk (3 tools), Pipeline (2 tools), Sales Intelligence (6 tools), Conversation Intelligence (1 tool), Competitive Intelligence (2 tools). TOTAL: 18 tools. |
| 9 | Account Management Tools — Detail Slide | NEW. Name the tools: sf_get_weekly_synopsis, sf_get_pre_call_brief, sf_log_account_note. For each: one-line description + example prompt. E.g., Weekly Synopsis: "Show me my week" — Monday morning digest with health tiers, MRR, talking points for every scheduled call. |
| 10 | Health & Risk Tools — Detail Slide | NEW. Name the tools: sf_get_account_health_report, sf_get_churn_risk_accounts, sf_run_nightly_health_scan. Include the health score gauge visual: Engagement 40% + Case Health 30% + Renewal 30% = composite 0-100. Show tier colors: Green (70-100), Yellow (40-69), Red (0-39). |
| 11 | Pipeline Tools — Detail Slide | NEW. Name: sf_get_renewal_pipeline, sf_get_upsell_opportunities. Renewal pipeline: auto-billing means no Opportunity — Prophet watches the dates. Upsell: gap analysis mapping missing services to specific PDM products with dollar values. |
| 12 | Sales Intelligence Tools — Detail Slide | NEW. Name: sf_research_prospect, sf_save_research_scores, sf_save_deck_url, sf_get_rep_pipeline_synopsis, sf_get_lead_intelligence, sf_get_event_conversion_pipeline. Highlight the 3-step research pipeline: Research → Scores → Gamma Deck. Show the research pipeline flow diagram from the master prompt. |
| 13 | Competitive & Conversation Intelligence — Detail Slide | NEW. Name: sf_get_competitive_alerts, sf_get_renewal_proof_package, sf_get_call_intelligence. Competitive alerts: stored competitor snapshots refreshed quarterly, delta reports surface what changed. Call intelligence: Zoom meeting metadata, AI summaries, sentiment scoring. |
| 14 | Scenario: Before a Client Call | V2 Slide 22. "Brief me on One Solution Dental." Show the 10 parallel queries. Emphasize: health score dropping, refund request open, doctor not contacted in 90+ days. |
| 15 | Scenario: Churn Prevention | V2 Slide 2. "Show me churn risk." Accounts ranked by urgency. Refund + cancellation signals forced to top. Revenue at risk clearly visible. |
| 16 | Scenario: Prospect Research | V2 Slide 3. "Research Smile Design Studio in Scottsdale, AZ." Full market analysis, competitive landscape, scores, auto-generated Gamma deck. Show the 3-step pipeline: Research → Scores Written to SF → Deck Generated → Rep Notified. |
| 17 | The Competitive Intelligence Engine | **NEW — THIS IS THE MOST IMPORTANT MISSING SLIDE.** Prophet maps every competitor signal to a specific PDM product. Example table: Competitor has YouTube channel → Client has no video → Gap = YES → PDM Product: Video Production. Competitor running Google Ads → Client not on PPC → Gap = YES → PDM Product: PPC. Show 4-5 rows of the gap mapping from the master prompt's Competitive Gap Output section. |
| 18 | 4 Revenue Conversations — One Data Source | V2 Slide 5, but expand significantly. Show 4 quadrants with center label "One Competitive Intelligence Database." Each quadrant: BUY (new prospect) — "Here's what competitors have that you don't." RESUME (paused/save play) — "While you were paused, [Competitor] gained 89 reviews." UPSELL (active client) — "Your competitor just launched Google Ads." RENEW (renewal) — "You started at 34 maturity, now at 71." Each quadrant should have the trigger, data used, and revenue outcome. |
| 19 | The Intelligence Flywheel | V2 Slide 4, but make it a proper circular diagram with 8 labeled stations: Research → Close → Serve → Monitor → Alert → Renew → Grow → Learn. Center text: "Every action compounds intelligence." Each station should have a one-line description. See Part 4 of the master prompt for exact descriptions. |
| 20 | The Competitive Moat | V2 Slide 10. Proprietary dataset. Every interaction builds intelligence. No competitor can replicate this. Add: "Every call analyzed, every market researched, every competitor tracked — this data compounds over time." |
| 21 | The ROI Is Simple | V2 Slide 9. Keep the math: save 5 accounts/quarter = ~$480K/year. One Platinum account saved = $240K+. Add: "Prophet doesn't cost money. Churn costs money. Prophet prevents churn." |
| 22 | Your New Daily Workflow | V2 Slide 7. Monday: Weekly Synopsis. Before every call: Pre-call brief. Weekly: Churn risk review. Monthly: Renewal pipeline. Always: Log notes instantly. Make this a visual timeline/calendar layout. |
| 23 | What This Means for You (by Role) | V2 Slide 8. Account Managers: always prepared. Sales Reps: know more than the prospect. Leadership: see revenue risk early. TCI: track training engagement. |
| 24 | This Is How We Operate Now | V2 Slide 13. Prophet becomes part of daily workflow. Not optional. This is the new standard. |
| 25 | What's Next — Roadmap | V2 Slide 11. Agentforce (AI inside Salesforce UI), n8n automation (nightly scans, auto-alerts, Gamma decks), Conversation Intelligence v2 (sentiment trending, coaching), PowerBI executive dashboards. Show a timeline: Now → 30 days → 60 days → 90 days → 6 months. |
| 26 | Getting Started | V2 Slide 14. Open Claude. Ask a question. Take action. That's it. Include 3 starter prompts: "Show me my week," "Brief me on [account]," "Show me churn risk." |
| 27 | Closing — See What's Coming Before It Arrives | V2 Slide 15. Prophet gives you clarity, confidence, and control. |

**Total: 27 slides.** This is within acceptable range for a feature presentation that will also serve as the primary internal launch document.

---

## 2. ADD TOOL NAMES AND EXAMPLE PROMPTS

Version 2 grouped tools into vague categories ("Account Management Intelligence," "Health & Churn Risk Detection") without naming a single tool. Users need to know what to type. Every tool category slide (9-13) must include:

- The exact tool name (e.g., `sf_get_weekly_synopsis`)
- A one-line description
- An example prompt the user would type (e.g., "Show me my week")

This is what makes Prophet actionable, not theoretical.

---

## 3. ADD THE COMPETITIVE INTELLIGENCE ENGINE (Slide 17)

This is Prophet's most powerful and most unique capability. Version 2 completely omitted it. The Competitive Intelligence Engine:

- Stores competitor data as Salesforce records
- Maps every competitor signal to a specific PDM product
- Shows the gap: what the competitor has vs. what the client has
- Powers four different revenue conversations from one data source
- Calculates `Estimated_Monthly_Gap_Value__c` — the dollar value of closing all gaps

Show a sample gap table with 4-5 rows. Use real PDM product names:

| Signal | Competitor | Client | Gap? | PDM Product |
|---|---|---|---|---|
| YouTube channel, 47 videos | Yes | No video presence | YES | Video Production |
| Running Google Ads on implant keywords | Yes, ~$8k/mo | Not on PPC | YES | PPC |
| 412 reviews, 4.8 stars, gaining 18/mo | Yes | 127 reviews, gaining 3/mo | YES | SEO / Reputation |
| Active Facebook + Instagram, running ads | Yes | Social dormant | YES | Social Media Marketing |
| Reviews mention "great consultation" | Training signals | TCI not enrolled | YES | TCI Mentorship |

**Estimated Monthly Gap Value: $12,400/mo** — this is the upsell opportunity if all gaps are closed.

---

## 4. EXPAND THE 4-CONVERSATION FRAMEWORK (Slide 18)

Version 2 listed Buy/Resume/Upsell/Renew as bullet points. This needs to be a visual framework showing how ONE competitive intelligence database drives FOUR different revenue conversations:

**BUY (New Prospect):**
- Trigger: New lead or discovery call
- Data: Competitive Gap Summary from sf_research_prospect
- Conversation: "Here's what your competitors have that you don't — and exactly how PDM closes those gaps."
- Outcome: Close the deal with evidence

**RESUME (Paused / Save Play):**
- Trigger: Client pauses or files cancellation
- Data: Competitive Gap Summary + delta since pause date
- Conversation: "While you've been paused, Valley Implant Center gained 89 reviews and launched Google Ads. Here's the three-move play to re-establish dominance."
- Outcome: Re-activate with urgency and a new strategy vision
- Note: This is the MOST emotionally powerful conversation

**UPSELL (Active Client — Quarterly Review):**
- Trigger: Quarterly review or competitive alert
- Data: Competitive Gap Summary showing services client doesn't have
- Conversation: "Your competitor just launched YouTube and is running social ads. You're ahead in SEO but the video gap is widening. Here's how we respond."
- Outcome: Grow the account with evidence, not pressure

**RENEW (Renewal):**
- Trigger: 30 days before Contract_Renewal_Date__c
- Data: Baseline vs. current maturity delta + competitive position change
- Conversation: "When you started, you had 47 reviews and no SEO. Today you have 312 reviews and rank #2. Meanwhile your top competitor dropped from #1 to #4. Here's Phase 2."
- Outcome: Renew with proof of results + expand scope

---

## 5. ADD SCREENSHOT PLACEHOLDERS

For every demo/scenario slide (14-16), add a placeholder box labeled:

```
[SCREENSHOT: sf_get_pre_call_brief output in Claude Desktop]
```

These will be replaced with actual screenshots before the presentation is delivered. Having the placeholder ensures the final version includes visual proof.

Also add placeholders on:
- Slide 6: `[DIAGRAM: Prophet Architecture Flow]`
- Slide 8: `[DIAGRAM: 6 Intelligence Categories — Hex Map]`
- Slide 10: `[VISUAL: Health Score Gauge — 3 Components]`
- Slide 17: `[TABLE: Competitive Gap Mapping — 5 Rows]`
- Slide 18: `[DIAGRAM: 4-Conversation Framework — Quadrant Layout]`
- Slide 19: `[DIAGRAM: Intelligence Flywheel — 8 Stations]`

---

## 6. ADD DEPTH TO THIN SLIDES

Several V2 slides are one-liners. Flesh them out:

**Slide 2 (The Reality Today):** Add specific pain points:
- You prep for a call by scanning 3 tabs in Salesforce, reading old notes, and hoping you remember the context
- A client files a refund request and you find out 2 weeks later
- A renewal auto-bills and the client churns because nobody called them
- Your competitor launched Google Ads in your client's market and you didn't know

**Slide 4 (The Real Problem):** Add the reframe: "Your AMs aren't bad at their jobs. They're operating blind. Prophet gives them eyes."

**Slide 7 (Before vs. After):** Use a concrete comparison:
| | Before Prophet | With Prophet |
|---|---|---|
| Pre-call prep | 15-45 min scanning Salesforce tabs | 30 seconds: "Brief me on this account" |
| Knowing churn risk | Find out when the client cancels | Find out 30-60 days before they cancel |
| Renewal prep | Manual deck building from memory | Auto-assembled proof package with competitive delta |
| Prospect research | Google the practice for 20 min | Full market analysis with scores and auto-generated deck |
| Logging a call | Navigate to Salesforce, find record, click new task, fill fields | "Log a note on Acme Dental: discussed PPC expansion, doctor wants to see next month's results" |

---

## 7. KEEP WHAT V2 GOT RIGHT

These elements from V2 are strong — keep them:
- Scenario-led storytelling (slides 2, 3, 22)
- ROI math with concrete dollars (slide 9)
- "This is how we operate now" framing (slide 13)
- Role-specific value statements (slide 8)
- "No reports. No digging. No guessing." tagline (slide 18)
- Closing trio: "clarity, confidence, control" (slide 15)

---

## 8. REMAINING DELIVERABLES

After completing the Feature Presentation v3, proceed to create the remaining 5 deliverables from the master prompt:

1. **AM Training Guide** (20-30 pages) — Step-by-step with exact prompts, expected outputs, and workflow integration. See DELIVERABLE 2 in master prompt.
2. **Sales Rep / PGA Training Guide** (15-20 pages) — See DELIVERABLE 3 in master prompt.
3. **Standard Operating Procedures** (6 SOPs) — See DELIVERABLE 4 in master prompt.
4. **Quick Reference Card** (1 page, both sides) — See DELIVERABLE 5 in master prompt. This is the laminated card every AM and rep keeps at their desk.
5. **Leadership Brief** (5-7 slides or 3-page doc) — See DELIVERABLE 6 in master prompt. Executive, ROI-focused.

Also create if capacity allows:
- **Video Script: "Prophet in 3 Minutes"** — See PART 9 of master prompt
- **Onboarding Email Sequence (3 emails)** — See PART 9
- **FAQ Document (Top 20 questions)** — See PART 9

---

## 9. FORMATTING & BRAND REMINDERS

- **Colors:** Navy (#1a2b4a), Teal (#1abc9c), White (#ffffff), Gold (#f4d03f), Red (#e74c3c) for alerts
- **Never say "Case"** — always "Ticket"
- **Never say "Sales Rep"** — say "Practice Growth Advisor" or "PGA"
- **Never reference internal tech** (MCP, jsforce, TypeScript) in user-facing slides — just say "AI platform connected to Salesforce"
- **PDM acronym:** Progressive Dental Marketing — spell out on first use, abbreviate after
- **Health Score tiers** always include emoji color: 🟢 Healthy, 🟡 At Risk, 🔴 Critical

---

**END OF REVISION PROMPT**

*Apply all 9 sections above to produce Version 3. The master prompt (PROPHET_CHATGPT_PROMPT.md) remains your complete source of truth for tool details, scoring models, and output examples. Every claim in the presentation must be traceable to that document.*
