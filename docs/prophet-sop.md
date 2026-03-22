# Prophet by PDM — Standard Operating Procedures
### Official Protocols for Account Managers, Sales Reps, and Managers
*Version 1.0 — March 2026*

---

## SOP Overview

This document defines the standard protocols for using Prophet at Progressive Dental Marketing. Following these procedures consistently ensures that Prophet's intelligence is accurate, that no client falls through the cracks, and that the platform compounds in value over time.

**The core principle:** Prophet is only as intelligent as what goes into Salesforce. Your notes, your call logs, and your updates to contact records are the raw material that makes every brief smarter for every AM who touches that account after you.

---

## SOP-001: Weekly Synopsis — Monday Morning Ritual

**Applies to:** All Account Managers, Team Leads, Directors
**Frequency:** Every Monday, first thing

### Procedure

**Step 1 — Pull the weekly synopsis**
Open Claude Desktop and say: *"Give me my weekly synopsis."*

For managers reviewing team: *"Weekly synopsis for [AM Name]'s accounts"* or omit the filter to see all.

**Step 2 — Review the output in this order:**
1. **Critical Alerts first** — Any accounts with open refund requests, cancellation flags, or delinquency get triaged before anything else. These are the accounts that need a call today, not when it's convenient.
2. **Red-tier accounts** — Any scheduled call this week where the health score is 🔴 Critical requires additional prep. Pull a full pre-call brief.
3. **Doctor contact badges** — Any account showing "Doctor: 60+ days ⚠️" needs a doctor outreach strategy on this week's call. Do not leave without speaking to the doctor.
4. **Renewal countdowns** — Any account renewing within 30 days needs a renewal proof package pulled.

**Step 3 — Build your weekly action list**
Categorize accounts into:
- **Call ready** — Health is 🟢, no alerts, standard check-in
- **Needs prep** — 🟡 or alerts — pull pre-call brief before the call
- **Priority intervention** — 🔴 or refund/cancellation — call same day if not already scheduled

**Step 4 — Flag to your manager**
Any account that is 🔴 Critical AND has an open refund request or cancellation request — notify your Team Lead or Director before end of Monday. Do not wait.

---

## SOP-002: Pre-Call Protocol

**Applies to:** All Account Managers, Sales Reps
**Frequency:** Before every scheduled client or prospect call

### Procedure

**Step 1 — Pull the brief (minimum 30 minutes before the call)**
> "Pre-call brief for [account name]."

Never pull a brief on the way into a call. You need time to absorb the alerts and prepare your approach.

**Step 2 — Read in this order:**
1. **Critical Alerts** (top of brief) — These change what the call is about. A refund request means this is a retention call, not a check-in.
2. **Sentiment section** — Is the client's tone improving or declining? A declining score from the last 3 calls means something is brewing. Go in ready to address it.
3. **Services Discussed in Recent Calls** — What have they been talking about? A 🔴 on SEO means they've expressed concern. A ⚠️ on PPC means there are questions. Know this before the call starts.
4. **Doctor Engagement Score** — Are they bringing the doctor to calls? Is the doctor's talk ratio declining? A declining trend is a churn early warning.
5. **Competitive Gap Analysis** — What is their top competitor doing that they're not? This is conversation ammunition.
6. **Health Score breakdown** — Understand which factor is pulling the score down.
7. **Talking points** — Review the AI-generated suggestions but personalize them.

**Step 3 — Prepare your agenda**
Based on the brief, define:
- Your primary objective (check-in / concern resolution / renewal conversation / upsell introduction)
- The one thing you must accomplish before hanging up
- Your doctor engagement strategy (how are you going to get the doctor on or mentioned?)

**Step 4 — Note any questions you want to ask**
The discovery questions in the brief are starting points. Add your own based on what you read.

---

## SOP-003: Post-Call Protocol — Note Logging

**Applies to:** All Account Managers, Sales Reps
**Frequency:** Within 30 minutes of every client interaction

### Non-negotiable: All calls must be logged.

Notes that don't exist in Salesforce don't exist. An AM who takes excellent notes helps every future brief, every future AM, and the renewal conversation 12 months from now.

### Procedure

**Step 1 — Log within 30 minutes**
Do not let notes sit until the end of the day. Memory degrades. Details that are vivid now are gone by 5pm.

**Step 2 — Ask Prophet to log it**
> "Log a call with [account name]. [Your notes here.]"

Or with more structure:
> "Log a meeting with Sullivan Dental. Topics discussed: Q1 SEO performance review, doctor concern about lead volume in March, upcoming campaign refresh. Doctor James Sullivan was on the call — he expressed that they're happy overall but wants to see improvement in implant consult bookings. Action item: Send updated keyword ranking report by Friday. Tone was positive."

**Step 3 — What to include in your notes (required)**
- Topics discussed
- Doctor's tone and any specific concerns raised (use their words if you can)
- Any concerns about a specific PDM service
- Action items and who owns them
- Whether the doctor was on the call
- Any mention of competitors, other agencies, or cancellation language
- Overall vibe/temperature of the relationship

**Step 4 — What NOT to do**
- Do not write vague notes like "check-in call, all good" — these provide zero intelligence
- Do not skip logging because Zoom recorded it — Zoom AI summaries are a supplement, not a replacement for your human context
- Do not log days later — the detail and accuracy will suffer

### Note Quality Standards

| Quality Level | Example |
|---------------|---------|
| ❌ Insufficient | "Called client. Everything is fine." |
| ⚠️ Minimal | "Quarterly review. Client happy. Following up on SEO report." |
| ✅ Acceptable | "Q1 review. Dr. Smith expressed concern about lead volume but confirmed overall satisfaction. Agreed to review SEO keyword rankings together next call. No churn signals." |
| 🟢 Excellent | "Q1 review with Dr. Smith and Office Manager Karen. Doctor specifically asked about implant-related keyword rankings and whether we're targeting 'dental implants near me' — says he sees competitors showing up above him on that term. I reassured him we're running that campaign and offered to send a ranking snapshot by Friday. Karen mentioned they added a new hygienist and could handle more new patient volume. Doctor was positive overall, no signs of dissatisfaction. Great opportunity to introduce the reputation management service — they only have 84 reviews and their competitor has 240. Action: Send ranking report Friday, prep upsell proposal for next call." |

---

## SOP-004: Churn Signal Response Protocol

**Applies to:** All Account Managers, Team Leads, Directors
**Trigger:** Any of the following signals appear

### Tier 1 Signals — Respond Same Day
These signals indicate an imminent churn risk. Do not wait for the scheduled call.

| Signal | Required Action |
|--------|-----------------|
| Open Refund Request | Call the account manager. If you are the AM, call the client within 2 hours. Loop in your Team Lead. |
| Cancellation or Pause Request Date on file | Pull pre-call brief immediately. Call client within 24 hours. Notify Team Lead. |
| 🔴 Critical sentiment in most recent call | Review the call summary. Identify what triggered it. Call within 48 hours. |
| Competitor mentioned in Zoom AI summary | Review the context. Was it the client comparing, or the AM mentioning it? If client-initiated, treat as Tier 1. |

### Tier 2 Signals — Address Within 5 Business Days
| Signal | Required Action |
|--------|-----------------|
| 🔴 Critical health score (0–39) | Pull pre-call brief. Schedule a call if not already within 5 days. |
| Delinquent flag | Coordinate with Finance on billing resolution. Keep AM informed of status. |
| Doctor contact > 90 days | Make doctor outreach the explicit goal of the next call. |
| Sentiment trend = Declining over 3+ calls | Acknowledge the pattern. Open the next call with "I want to make sure we're meeting your expectations — let me share what we've been doing and I'd love your honest feedback." |

### Tier 3 Signals — Address at Next Scheduled Call
| Signal | Required Action |
|--------|-----------------|
| 🟡 At Risk health score (40–69) | Include health improvement in next call agenda. |
| Service mentioned with ⚠️ concern sentiment | Proactively address that service in the call. Come prepared with results data. |
| Active service not mentioned in 90 days (🔇) | Proactively introduce it. "I want to make sure you're seeing the value from our [service] work — can I walk you through what we've accomplished?" |

### Escalation Path
1. **AM** identifies Tier 1 signal
2. **AM** attempts to reach client within response window above
3. If no response within 24 hours — notify **Team Lead**
4. **Team Lead** attempts contact and loops in **Director** if no response in 48 hours
5. **Director** determines intervention strategy (executive outreach, service credit, contract review)

---

## SOP-005: Renewal Preparation Protocol

**Applies to:** All Account Managers
**Timeline:** Begin 45 days before Contract Renewal Date

### 45 Days Before Renewal

**Step 1 — Pull the renewal proof package**
> "Renewal proof package for [account name]."

**Step 2 — Review the data:**
- What was the Marketing Maturity Score when they signed? What is it now? This is your proof of value.
- What has changed in their competitive landscape since they started?
- What does the call sentiment trend show over the engagement?

**Step 3 — Request the renewal deck**
The renewal deck is auto-generated via n8n when the proof package is run (when this workflow is live). Until then, use the data from the proof package to brief your presentation manually.

**Step 4 — Identify risks**
- Is the health score below 70? Resolve underlying issues before the renewal conversation.
- Is sentiment declining? Address what's causing it before asking for a renewal.
- Are there open tickets or refund requests? These must be resolved or formally acknowledged before the renewal.

### 30 Days Before Renewal

**Step 5 — Schedule the renewal call**
Explicitly calendar a renewal call — not a regular check-in. The agenda should be clear: "I'd like to set time to review our partnership and talk about the next year."

**Step 6 — Pull a pre-call brief before the renewal call**
Review every section with renewal in mind. The doctor engagement score and sentiment section are especially important.

**Step 7 — During the renewal call**
Lead with value proof, not with asking for the signature. The sequence:
1. "Let me show you where you were when we started and where you are today."
2. Review competitive position changes.
3. Present the next-year plan.
4. Ask for the renewal.

### After the Renewal Call

**Step 8 — Log detailed notes immediately**
Include: client's response, any concerns raised, any commitments made, and the decision (signed / pending / at risk).

---

## SOP-006: Prospect Research Protocol

**Applies to:** Sales Reps, Team Leads
**Trigger:** Any inbound lead or outreach target before a discovery call

### Procedure

**Step 1 — Research the prospect**
> "Research [practice name] in [city, state]."
or
> "Research [website URL]."

Prophet will check Salesforce first for any existing history, then run full market research, then write scores back to Salesforce automatically.

**Step 2 — Review the output:**
- **Marketing Maturity Score** — Tells you how sophisticated they are. Low score = easier to impress. High score = they know what they're doing and you need to come in sharper.
- **Likelihood to Buy Score** — Higher = prioritize. Below 40 = they may not be ready to buy or may not be a good fit.
- **Priority Level** — Top Priority > High > Moderate > Low
- **Primary Gap Type** — The single biggest opportunity. This drives which Gamma deck gets built.
- **Sales Enablement Summary** — Use the discovery questions and talking points. Don't wing it.

**Step 3 — Build your discovery call agenda from the research**
The research gives you:
- What questions to ask (discovery questions section)
- What objections to expect and how to respond
- The urgency argument (competitor review velocity projections)
- The positioning statement

**Step 4 — Log the discovery call after**
> "Log a call with [lead name]. [Notes from discovery call]."

Even for leads — notes in Salesforce ensure the next person who touches this lead has context.

---

## SOP-007: New Client Onboarding Intelligence Protocol

**Applies to:** Account Managers receiving a new client assignment
**Trigger:** New Account created or AM reassignment

### Procedure

**Step 1 — Pull a pre-call brief immediately**
Before you introduce yourself, know the account:
> "Pre-call brief for [account name]."

**Step 2 — Check the AM transition history section**
How many times has this account been reassigned? Why? What did previous AMs note? This tells you the relationship history before you say a word.

**Step 3 — Review the baseline Marketing Maturity Score**
This was locked at close. It tells you where they were when they signed. Combined with current data, you can already frame what progress looks like for them.

**Step 4 — Identify the doctor**
Find the doctor contact in the Key Contacts section. Make doctor engagement a priority from day one.

**Step 5 — Log your introduction call**
> "Log a call with [account]. This was my introduction call as the new Account Manager. [Notes about the call, doctor/contact names, their current concerns, and initial relationship temperature]."

---

## SOP-008: Doctor Engagement Protocol

**Applies to:** All Account Managers
**Standard:** Doctor should be on or briefed after a minimum of 40% of calls

### Why This Matters
The doctor is the decision-maker on renewal. If only the office manager knows PDM, the doctor can cancel without friction when renewal comes. Every interaction where you build rapport with the doctor extends the client relationship.

### Procedure

**Step 1 — Know your doctor contact frequency**
The pre-call brief shows:
- Days since last doctor contact (`AM_Spoke_to_Doctor__c`)
- Doctor Engagement Score (call attendance rate + talk ratio trend from Conversation Intelligence)

**Step 2 — Strategy for getting the doctor on calls**
- Ask the office manager at the end of every call: "Would Dr. [Name] be available for 5 minutes on our next call? I'd love to share some results with them directly."
- Schedule calls during times the doctor is typically in the office (not during procedures)
- Frame doctor calls as "results reviews" not "check-ins"

**Step 3 — When you do speak to the doctor**
- Address them as the decision-maker, not a passenger on the account
- Lead with results in their language (more implant consults, not more keyword rankings)
- Ask: "Is there anything about your marketing that you'd like us to focus on differently?"
- Log the call with `Spoke_with_Doctor__c` noted in your notes

**Step 4 — When you can't reach the doctor**
After 60 days without doctor contact:
- Escalate the approach — ask for a specific 15-minute results review
- Consider sending a written update directly to the doctor via email (with office manager CC)
- Log all attempts — this creates a record that shows your engagement effort

---

## SOP-009: Data Quality Standards

**Applies to:** All Prophet users
**This is a shared responsibility. Bad data hurts everyone.**

### Required fields — Always keep current

| Field | Who Updates It | How to Update |
|-------|---------------|---------------|
| `AM_Spoke_to_Doctor__c` | Account Manager | Log with Prophet or update manually in Salesforce after doctor contact |
| Task Description | Account Manager | Log with Prophet after every call |
| `Spoke_with_Doctor__c` | Account Manager | Include in call notes |
| Contact: Doctor__c checkbox | Account Manager | Verify on new accounts |
| `Next_Alignment_Call__c` | Account Manager | Update in Salesforce after scheduling |

### Common data quality failures

**Problem:** Health score looks wrong for an account.
**Cause:** `LastActivityDate` not updating because tasks aren't being logged.
**Fix:** Log all activities with Prophet.

**Problem:** Doctor Engagement Score shows "No contact record."
**Cause:** No Contact record exists with `Doctor__c = true` for this account.
**Fix:** Create the Contact record in Salesforce and check the Doctor checkbox.

**Problem:** Services Discussed section is empty even though calls are happening.
**Cause:** Calls aren't being recorded through Zoom, or Zoom AI summaries aren't being generated.
**Fix:** Ensure Zoom is set to record meetings and AI Companion is enabled.

**Problem:** Pre-call brief shows no Zoom AI summaries.
**Cause:** Calls are using Zoom but tasks aren't being linked to the account record.
**Fix:** Ensure the Zoom meeting is associated with the Salesforce account.

---

## SOP-010: Escalation and Manager Review Protocol

**Applies to:** Team Leads, Directors
**Frequency:** Weekly

### Weekly Manager Review Checklist

**Pull these every Monday:**

1. **Churn risk across all AMs** (no owner filter)
   > "Churn risk accounts" — look for any Critical accounts not owned by the right AM or not contacted recently

2. **Renewal pipeline across all AMs**
   > "Renewal pipeline for 90 days" — identify any renewal that has a health score below 70 and intervene

3. **AM coaching briefs for each AM**
   > "AM coaching brief for [name]" — compare book health trends, doctor contact frequency, call activity

### Warning signs to act on immediately
- Any AM with more than 3 accounts in Critical tier without recent activity
- Any renewal in the next 30 days with a Critical health score
- Any open refund request that's been open > 14 days without resolution
- Any account where sentiment has been Declining for 3+ consecutive calls

### Intervention protocol
1. Review the pre-call brief for the flagged account
2. Assess whether the AM needs coaching support or account escalation
3. If escalating: loop in Director, review if executive outreach is warranted
4. Document the intervention in Salesforce as a Task on the account record

---

## SOP-011: Prophet Platform Maintenance

**Applies to:** William Summers (Salesforce Admin)
**Frequency:** As indicated

### Weekly
- Verify nightly health scan ran successfully (check Google Chat #churn-alerts)
- Verify competitive snapshot data is refreshing for high-priority leads
- Review any tool errors reported by AMs

### Monthly
- Review field API names for any new custom fields needed
- Verify Zoom AI summaries are generating for all recorded calls
- Check that `Health_Score_Date__c` is updating nightly (confirms scanner is running)

### After any Salesforce password change
1. Reset the security token in Salesforce Settings → My Personal Information → Reset My Security Token
2. Update `.env` file: `SF_PASSWORD` and `SF_SECURITY_TOKEN`
3. Restart the Prophet server: `node dist/index.js`
4. Verify Claude Desktop reconnects to the tool

### After any tool updates
1. Run `npm run build` in `/Users/williamsummers/salesforce-retention-mcp`
2. Restart Claude Desktop
3. Verify tool appears in Settings → Developer → pdm-salesforce

---

## Quick Reference Card — For Daily Use

### Before any client call:
1. "Pre-call brief for [account]."
2. Read alerts → sentiment → services discussed → doctor score → health score
3. Prepare your agenda

### After any client call:
1. "Log a call with [account]. [Notes including doctor engagement, service concerns, action items, tone]."
2. Done.

### Every Monday:
1. "Weekly synopsis."
2. Triage alerts → prep critical accounts → set your week's priority list

### When an account is at risk:
1. "Pre-call brief for [account]." — know everything
2. "Health report for [account]." — understand the score drivers
3. Call the client — don't wait for the scheduled call date

### Before any renewal:
1. "Renewal proof package for [account]."
2. Know the maturity delta, competitive change, and sentiment trend before you pick up the phone

---

## Terminology Reference

| Prophet Term | Salesforce Field | What It Means |
|-------------|-----------------|---------------|
| Health Score | `Health_Score__c` | Composite 0–100 score (Engagement 40% + Cases 30% + Renewal 30%) |
| Health Tier | `Health_Tier__c` | Healthy / At Risk / Critical |
| MRR | `Total_Monthly_Recurring_Amount__c` | Monthly recurring revenue for this account |
| Marketing Status | `Status__c` | Active / Renewal / Non Renewing / Delinquent / etc. |
| Ticket | Case | Support/service tickets (Salesforce Case object) |
| Doctor Contact | `AM_Spoke_to_Doctor__c` | Date AM last confirmed doctor-level contact |
| Renewal Date | `Contract_Renewal_Date__c` | Authoritative contract renewal date |
| Account Intel | `Account_Intel__c` | AM notes field — rich text, 2000 char limit |
| Doctor Engagement Score | VideoCall + UVCP data | Attendance rate + TalkRatio from Conversation Intelligence |
| Marketing Maturity Score | `Marketing_Maturity_Score__c` | 0–100 scale of how sophisticated their marketing is |
| Likelihood to Buy Score | `Likelihood_to_Buy_Score__c` | 0–100 scale of prospect conversion likelihood |

---

*Prophet by PDM — Standard Operating Procedures*
*Owner: William Summers, Salesforce Admin & Systems Architect*
*Questions: Contact William Summers directly*
*This document should be reviewed and updated quarterly as the platform evolves.*
