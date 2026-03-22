# Prophet by PDM — User Guide
### The AI Intelligence Platform for Progressive Dental Marketing
*Version 1.0 — March 2026*

---

## What Is Prophet?

Prophet is PDM's AI intelligence platform. It connects Claude Desktop directly to Salesforce, giving Account Managers and Sales Reps real-time intelligence about every client and prospect — without leaving their workflow.

**What Prophet does that no other tool can:**
- Sees churn signals before they become cancellation calls
- Assembles a complete pre-call brief in seconds instead of 20 minutes of Salesforce hunting
- Identifies what competitors are doing that your client isn't
- Tells you whether the doctor is actually engaged — not just whether calls are happening
- Surfaces what services clients are talking about (and complaining about) across their last 90 days of calls

**The strategic goal:** Increase average client length from 2 years to 8 years. Every tool in Prophet serves that goal — either by protecting existing revenue or acquiring better-fit clients who stay longer.

---

## How to Access Prophet

Prophet runs inside Claude Desktop. You interact with it by talking to Claude naturally — no commands to memorize, no dashboards to navigate.

**Access:** Open Claude Desktop → Start a new conversation → Talk to it like a colleague.

**Example:**
> "Give me a pre-call brief for Sullivan Dental before my 2pm call."

Claude routes the request to Salesforce, pulls everything relevant, and returns a complete brief. You do not need to know which tool is running. Just ask for what you need.

---

## The 16 Tools — What They Do and How to Ask

---

### 1. Weekly Synopsis
**Tool:** `sf_get_weekly_synopsis`

**What it does:** Your Monday morning brief. Pulls every account with a call scheduled this week, enriched with health tier, MRR, days since last contact, doctor contact status, renewal proximity, open refund requests, and suggested talking points.

**When to use it:** Start of every work week.

**How to ask:**
> "Give me my weekly synopsis."
> "What accounts do I have this week?"
> "Show me my weekly digest."
> "Weekly synopsis for Jordan Stewart's accounts." *(add owner filter for managers)*

**What you'll get:**
- Every account with a scheduled call this week, color-coded by health (🟢/🟡/🔴)
- MRR, tier, and owner for each account
- Days since last contact + doctor contact badge
- Alerts for open refund requests, cancellation requests, delinquency
- Renewal countdown for accounts renewing within 30 days
- Section 2: All open refund requests across your book (churn signal list)

---

### 2. Pre-Call Brief
**Tool:** `sf_get_pre_call_brief`

**What it does:** The most comprehensive brief in the platform. Assembles everything you need to walk into any client call fully prepared — in under 10 seconds.

**When to use it:** Before every client call. Especially critical for renewal calls, any account with open alerts, and accounts you haven't spoken to recently.

**How to ask:**
> "Pre-call brief for Sullivan Dental."
> "Brief for account ID 001PU00001ENQ4VYAX."
> "Get me everything on Smith Family Dentistry before my call."

**What you'll get:**
1. **Critical Alerts** — Refund requests, cancellation flags, delinquency, high-priority cases, renewal deadlines
2. **Account Overview** — Status, MRR, tier, owner, last contact, doctor last contacted, next alignment call
3. **Account Intel** — AM notes field from Salesforce
4. **Budget Snapshot** — Management fee, total budget, SEO/Social budget breakdown
5. **Active Services** — Installed Asset records
6. **Active PDM Products** — Detected from Opportunities and Assets; what they're missing listed below
7. **Services Discussed in Recent Calls** — Which services came up in the last 90 days of Zoom AI summaries, with sentiment (🔴 risk / ⚠️ concern / ✅ positive) and exact quote from the call
8. **Competitive Gap Analysis** — Primary competitor's review count, Google Ads status, Facebook Ads status, Maps Pack position vs. what the client has
9. **"What Happens If You Do Nothing"** — Competitor review velocity projected 3 and 12 months forward
10. **Business Objectives** — Goals on record in Salesforce
11. **AM Transition History** — Prior account manager handoffs
12. **Doctor Engagement Score** — Call attendance rate (last 90 days), average talk ratio from Conversation Intelligence, trend (improving/stable/declining)
13. **Call Sentiment Analysis** — Overall sentiment score with trend, call-by-call breakdown, critical/warning signals with exact quotes
14. **Zoom Meeting AI Summaries** — Full AI summaries from recent recorded calls
15. **Key Contacts** — Doctor, primary contact, all active contacts with phone and email
16. **Recent Activity** — Last 10 tasks with full notes
17. **Open Tickets** — All open Cases (called "tickets" in PDM)
18. **Active Opportunities** — Open opportunities with stage and close date
19. **Health Score Breakdown** — Engagement (40%) + Case Health (30%) + Renewal (30%)
20. **Suggested Talking Points** — AI-generated based on health score and account signals

---

### 3. Log an Account Note
**Tool:** `sf_log_account_note`

**What it does:** Creates a completed Task in Salesforce directly from your Claude conversation. Captures calls, emails, meetings, and notes without opening Salesforce.

**When to use it:** Immediately after any client interaction. The faster notes go in, the more accurate the intelligence is for everyone.

**How to ask:**
> "Log a call with Sullivan Dental. We discussed their SEO performance. Doctor expressed concern about lead volume but was receptive to increasing their ad budget. No action items."
> "Log a note for Smith Family Dentistry — I emailed their office manager about the renewal package."
> "Log a meeting with [Account] — [notes]."

**Parameters you can include:**
- Account name or ID
- Type: Call / Email / Meeting / Note
- Subject (optional — auto-generated if not provided)
- Full notes
- Contact name (optional — links the task to a specific contact)

**What you'll get:** Confirmation that the Task was created in Salesforce with the record ID.

---

### 4. Account Health Report
**Tool:** `sf_get_account_health_report`

**What it does:** A focused health score calculation for one account. Shows the composite score breakdown, tier classification, and the specific signals driving the score up or down.

**When to use it:** When you want to understand exactly why an account is scoring the way it is, or to validate a gut feeling about an account's health.

**How to ask:**
> "What's the health score for Sullivan Dental?"
> "Health report for account ID 001PU00001ENQ4VYAX."
> "How healthy is Smith Family Dentistry?"

**Scoring model:**
- **Engagement (40%)** — Based on LastActivityDate recency and call/email/meeting frequency
- **Case Health (30%)** — Open case count, priority levels, case age
- **Renewal (30%)** — Contract renewal date proximity

**Tiers:**
- 🟢 **Healthy** — 70–100
- 🟡 **At Risk** — 40–69
- 🔴 **Critical** — 0–39

---

### 5. Churn Risk Accounts
**Tool:** `sf_get_churn_risk_accounts`

**What it does:** A ranked list of active accounts most at risk of churning, sorted by health score. Accounts with open Refund Requests are forced to the top regardless of score.

**When to use it:** Weekly review. Any time leadership asks for churn exposure. Before team meetings where retention is on the agenda.

**How to ask:**
> "Show me my churn risk accounts."
> "Which accounts are most at risk right now?"
> "Churn risk list for Shelby's accounts." *(add owner filter)*
> "Give me the top 10 churn risks." *(add limit)*

**Parameters:**
- `owner_id` — Filter to one AM's book (optional)
- `limit` — How many accounts to return (default: 25)
- `threshold` — Health score cutoff (default: 50 — only shows accounts below this)

**Priority signals shown:**
- Open Refund Requests (hard override to top)
- Cancellation/Pause Request Date on file
- Delinquency flag
- Active cancellation Change Orders
- Days since last contact
- Contract renewal proximity

---

### 6. Renewal Pipeline
**Tool:** `sf_get_renewal_pipeline`

**What it does:** All upcoming renewals within a configurable window, each enriched with health score, MRR, and owner. Sorted by closest renewal date first.

**When to use it:** Weekly pipeline review. Monthly leadership reporting. Any time you need to see renewal exposure.

**How to ask:**
> "Show me my renewal pipeline."
> "What renewals do I have in the next 60 days?"
> "Renewal pipeline for the next 90 days."

**Parameters:**
- `days_ahead` — Lookback window in days (default: 90)
- `owner_id` — Filter to one AM (optional)
- `limit` — Max accounts returned (default: 25)

---

### 7. Upsell Opportunities
**Tool:** `sf_get_upsell_opportunities`

**What it does:** Gap analysis across your book of business. Identifies accounts that are healthy enough to buy more and shows which PDM services they're not currently using.

**When to use it:** Monthly upsell planning. Before QBRs. Any time you're building a case to expand a client's service footprint.

**How to ask:**
> "Show me upsell opportunities."
> "Which of my accounts could be buying more?"
> "Upsell report for healthy accounts only."

**Parameters:**
- `owner_id` — Filter to one AM (optional)
- `limit` — Max accounts (default: 25)
- `min_health_score` — Only show accounts above this score (default: 40)

**Logic:** Compares active products (from Opportunities and Assets) against the full PDM product catalog. Surfaces the gap — what they have vs. what they don't.

---

### 8. Call Intelligence
**Tool:** `sf_get_call_intelligence`

**What it does:** Pulls AI summaries from Zoom meetings and Zoom Phone calls for a specific account. Shows what was discussed, action items, and whether the doctor was on the call.

**When to use it:** When you need to catch up on an account quickly. When taking over a client. When prepping for a renewal without reading 10 call notes manually.

**How to ask:**
> "What happened on the last few calls with Sullivan Dental?"
> "Call intelligence for Smith Family Dentistry."
> "Show me the call history for [account] from the last 6 months."

**Parameters:**
- `accountId` or `accountName`
- `lookback_days` — How far back to look (default: 90)
- `max_calls` — Max calls to return (default: 5)

---

### 9. Research a Prospect
**Tool:** `sf_research_prospect`

**What it does:** The full Sales Market Research GPT — implemented as a governed Salesforce tool. Checks Salesforce first for any existing history, then runs comprehensive web research on the practice and market, then writes all scores back to Salesforce so the intelligence is permanent.

**When to use it:** Before any discovery call with a new prospect. When prioritizing which leads to pursue. When building a territory strategy.

**How to ask:**
> "Research Sullivan Family Dental in Tampa, Florida."
> "Prospect research on smithsmilecenter.com."
> "Research Dr. Johnson's practice in Phoenix."

**What you'll get:**
1. Location / Practice / Website
2. Market Snapshot (10–30 mile radius, 45+ population, income, affluent ZIPs)
3. Competitive Landscape (dominant competitor, easiest to disrupt, most pressure)
4. Practice Evaluation (website, branding, mobile, trust signals, authority)
5. SEO Gap Analysis (implant/full-arch/All-on-4 keyword targeting)
6. Google Ads Opportunity
7. Reputation Analysis (rating, review count, sentiment themes)
8. Google Maps & Local Visibility
9. Opportunity Gaps
10. **Marketing Maturity Score** (0–100) — Written to Salesforce
11. **Likelihood to Buy Score** (0–100) — Written to Salesforce
12. **Priority Level** (Low / Moderate / High / Top Priority) — Written to Salesforce
13. Market Domination Strategy
14. Strategic Recommendations
15. Sales Enablement Summary — Talking points, discovery questions, objections & responses, positioning statement

**Critical advantage over ChatGPT:** The scores, summary, and gap type are written back to Salesforce. The intelligence is permanent, searchable, and compounds over time.

---

### 10. Competitive Alerts
**Tool:** `sf_get_competitive_alerts`

**What it does:** Delta report on stored competitor snapshots. Compares current week vs. last snapshot for each tracked competitor and surfaces meaningful changes.

**When to use it:** Weekly check on active accounts and high-priority leads. Before any renewal conversation where competitive pressure is a factor.

**How to ask:**
> "Any competitive alerts for Sullivan Dental?"
> "Competitive alerts across my book."
> "What are competitors doing for my high-priority leads?"

**Signals reported:**
- Review count gain (weekly velocity)
- Google Maps ranking change
- New Google Ads or Facebook Ads activity
- Competitor pressure score change

---

### 11. Renewal Proof Package
**Tool:** `sf_get_renewal_proof_package`

**What it does:** Auto-assembles the renewal presentation data. Pulls the baseline Marketing Maturity Score from when the client signed, compares to current, surfaces competitive position change, and formats everything for a renewal conversation.

**When to use it:** 30–45 days before any renewal. This is the data behind the renewal narrative.

**How to ask:**
> "Build a renewal proof package for Sullivan Dental."
> "Renewal package for [account] — they renew next month."

**What you'll get:**
- Baseline Marketing Maturity Score (locked at close, never changes)
- Current Marketing Maturity Score (delta = proof of value)
- Competitive position change since they started
- Call sentiment trend over the engagement
- Benchmark comparison: how clients like them perform at this stage
- Talking points for the renewal conversation

---

### 12. Rep Pipeline Synopsis
**Tool:** `sf_get_rep_pipeline_synopsis`

**What it does:** Monday morning brief for Sales Reps. Leads ranked by Likelihood to Buy Score, competitive alerts on active leads, stagnant opportunities with recommended actions.

**When to use it:** Start of every sales week.

**How to ask:**
> "Give me my pipeline synopsis."
> "What should I focus on this week?"
> "Rep brief for [Rep Name]." *(managers)*

**What you'll get:**
- Leads ranked by LTB score with priority level
- Competitive alerts on active leads
- Stagnant opportunities (too long in current stage) with recommended next actions
- Recommended first calls ranked by priority

---

### 13. Lead Intelligence
**Tool:** `sf_get_lead_intelligence`

**What it does:** Full lead brief with Pardot UTM source, lead score, grade, conversion history, and campaign attribution. The pre-call brief equivalent for inbound leads.

**When to use it:** Before any discovery call with an inbound lead.

**How to ask:**
> "Lead intelligence on Dr. Jennifer Walsh."
> "Give me everything on this lead: [name or ID]."
> "Pre-call brief for the lead from Tampa who filled out the implant form."

---

### 14. Nightly Health Scan
**Tool:** `sf_run_nightly_health_scan`

**What it does:** Recalculates health scores for all active accounts, writes the scores back to Salesforce (`Health_Score__c`, `Health_Tier__c`, `Health_Score_Date__c`), and posts a summary to Google Chat when accounts drop tiers.

**When to use it:** This runs automatically every night. You can also trigger it manually any time to force a refresh.

**How to ask:**
> "Run the nightly health scan."
> "Refresh all health scores."

---

### 15. Save Research Scores
**Tool:** `sf_save_research_scores`

**What it does:** Writes prospect research scores (Marketing Maturity, Likelihood to Buy, Priority Level, Primary Gap Type, Research Summary) to a Lead or Account record in Salesforce.

**When to use it:** Automatically called by `sf_research_prospect` after research completes. Can also be called manually to update scores after additional research.

---

### 16. AM Coaching Brief
**Tool:** `sf_get_am_coaching_brief`

**What it does:** Performance coaching intelligence for Account Managers. Shows health trends across their book vs. team average, doctor contact frequency, call activity levels, and which accounts need attention.

**When to use it:** Weekly for managers reviewing their team. For AMs who want to see how their book compares.

**How to ask:**
> "AM coaching brief for Shelby Hicks."
> "How is Jordan's book trending?"
> "Show me team coaching metrics."

---

## Best Practices by Role

---

### Account Manager — Daily Workflow

**Morning (15 minutes):**
1. Open Claude Desktop
2. Ask for your weekly synopsis (Monday only) OR ask "what calls do I have today?"
3. For each call today — pull a pre-call brief at least 30 minutes before the call
4. Note any critical alerts and plan your talking points

**After every call (5 minutes):**
1. Log the call using `sf_log_account_note` while it's fresh
2. Include: what was discussed, doctor's mood/engagement, any concerns raised, next steps
3. If the doctor expressed concern about a specific service — note it verbatim

**Why this matters:** Prophet learns from what's in Salesforce. Every note you log makes the next brief smarter. AMs who log consistently get better briefs than AMs who don't.

---

### Account Manager — Weekly Workflow

**Monday:**
- Pull weekly synopsis first thing
- Identify any Critical-tier accounts — those get a proactive call this week even if not scheduled
- Check churn risk list for accounts that may have dropped tier over the weekend

**Mid-week:**
- Any account with a 🔴 alert that you haven't called — call them today
- Log any meetings, emails, or calls that haven't been logged yet

**Friday:**
- Log this week's notes if any remain
- Flag accounts that didn't engage this week so next week's synopsis reflects it

---

### Account Manager — Renewal Calls

**30–45 days before renewal:**
1. Pull a pre-call brief — check health score trend and sentiment section
2. Pull a renewal proof package — assemble the narrative around maturity delta
3. Review the competitive gap analysis — know what competitors are doing in their market
4. Review "Services Discussed in Recent Calls" — know which services have come up and in what context

**On the renewal call:**
- Lead with proof: "When you started with us, your marketing score was X. Today it's Y."
- Use the competitive data: "Your top competitor gained 180 reviews this year — here's what we're doing to protect your position."
- Reference the doctor's own words from past calls when possible

---

### Sales Rep — Weekly Workflow

**Monday:**
1. Pull pipeline synopsis — "Give me my rep brief for this week."
2. For every lead with a scheduled call — pull lead intelligence or prospect research
3. Identify stagnant opportunities flagged in the synopsis — take action today

**Before every discovery call:**
1. Pull research on the prospect if not already done
2. Use the Sales Enablement Summary — especially the discovery questions and objection responses

**After closing:**
- The baseline Marketing Maturity Score gets locked automatically at close. This becomes the proof-of-value benchmark for renewal.

---

### Manager / Director — Weekly Workflow

**Monday:**
1. Pull weekly synopsis with no owner filter to see all AMs' accounts
2. Pull churn risk list — identify accounts in Critical tier that need intervention
3. Review AM coaching briefs for any AM whose book is trending down

**Monthly:**
1. Pull upsell opportunities across all accounts — identify expansion revenue
2. Review renewal pipeline for the next 90 days — flag any renewal that's below 70 health score
3. Check competitive alerts for high-pressure markets

---

## Understanding the Output — Key Signals

### Health Tiers
| Tier | Score | What It Means |
|------|-------|---------------|
| 🟢 Healthy | 70–100 | Engaged, stable, low risk |
| 🟡 At Risk | 40–69 | Warning signs present — monitor closely |
| 🔴 Critical | 0–39 | Churn risk — needs immediate attention |

### Doctor Contact Badges
| Badge | Meaning |
|-------|---------|
| 🩺 Doctor: 14d ago ✅ | Contacted within 30 days — good |
| 🩺 Doctor: 45d ago | Between 30–60 days — acceptable |
| 🩺 Doctor: 75d ago ⚠️ | Over 60 days — action needed |
| 🩺 Doctor: Never contacted | No record of doctor contact — high risk |

**Why doctor contact matters:** Research shows that AMs who regularly reach the doctor have dramatically lower churn rates. The doctor is the decision-maker on renewal. If only the office manager knows PDM, the doctor can cancel with no friction.

### Sentiment Signals
| Signal | Meaning |
|--------|---------|
| 😊 Positive | Client expressing satisfaction and results |
| 😐 Neutral | Normal conversation, no strong indicators |
| 😟 Concerning | Warning language detected — monitor |
| 🚨 Critical | Cancellation language, competitor mentions, or anger signals |
| 📈 Improving | Recent calls scoring higher than older calls |
| 📉 Declining | Recent calls scoring lower — watch closely |

### Services Discussed in Recent Calls
| Icon | Meaning |
|------|---------|
| ✅ | Service mentioned with positive language |
| ➡️ | Service mentioned, neutral context |
| ⚠️ | Service mentioned with concern language |
| 🔴 | Service mentioned with critical/risk language |
| 🔇 | Active service not mentioned in 90 days |

---

## Frequently Asked Questions

**Q: Can I use an account name instead of an ID?**
A: Yes, for pre-call brief, health report, call intelligence, and competitive alerts. If multiple accounts match the name, Prophet will ask you to specify.

**Q: What if a tool says it can't find an account?**
A: Try the account ID instead of the name. You can find the ID in the Salesforce URL when viewing the account record (the 15–18 character code starting with 001).

**Q: How current is the data?**
A: All data is pulled live from Salesforce at the moment you ask. Health scores on the Account record are updated nightly by the automated scanner. Competitor snapshots are updated weekly.

**Q: Can Prophet log calls for me automatically?**
A: Not automatically — you tell it what happened and it logs it. Example: "Log a call with Sullivan Dental — we discussed their Q2 results and the doctor had questions about SEO performance. They're happy overall."

**Q: What if a section in my brief says "No data found"?**
A: It means that data doesn't exist in Salesforce yet. Most commonly this happens with:
- Business Objectives — not all accounts have these entered
- Competitor Snapshots — requires the competitive research workflow
- Doctor Engagement Score — requires recorded Zoom calls linked to the account

**Q: Can managers see all AMs' data?**
A: Yes. Omit the `owner_id` filter on any tool and you get all accounts (excluding William Summers' test accounts). Add an AM's User ID to filter to their book.

**Q: Is my conversation with Claude private?**
A: Prophet reads from Salesforce — it doesn't write anything back to Salesforce except when you explicitly ask it to (logging notes, saving research). Your conversation text stays in Claude Desktop.

---

## Quick Reference — What to Say

| You need... | Say... |
|-------------|--------|
| Monday brief | "Weekly synopsis" |
| Pre-call prep | "Pre-call brief for [account]" |
| Log a call | "Log a call with [account] — [notes]" |
| Health check | "Health report for [account]" |
| At-risk list | "Churn risk accounts" |
| Renewal list | "Renewal pipeline" |
| Upsell list | "Upsell opportunities" |
| Call history | "Call intelligence for [account]" |
| Prospect research | "Research [practice] in [city, state]" |
| Competitive intel | "Competitive alerts for [account]" |
| Renewal narrative | "Renewal proof package for [account]" |
| Rep morning brief | "Pipeline synopsis" |
| Lead prep | "Lead intelligence for [name]" |

---

*Prophet by PDM — See what's coming before it arrives.*
*Questions or feedback: Contact William Summers, Salesforce Admin & Systems Architect*
