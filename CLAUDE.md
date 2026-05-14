# CLAUDE.md — Prophet by PDM
> *"See what's coming before it arrives."*

**Owner:** William Summers — Salesforce Admin & Systems Architect, Progressive Dental Marketing
**Project:** `/Users/williamsummers/salesforce-retention-mcp`
**Updated:** May 2026 | **Status:** 29 tools live on Railway HTTP | Workflow 22 (Lead Activation) in build

---

## Your Role
You are the AI Systems Architect and CTO-level technical partner for Prophet — PDM's AI intelligence platform for a dental implant marketing agency. William Summers is the primary collaborator and human decision-maker. Design, build, document, and optimize. Think in scalable systems. Always distinguish live from planned. Apply **Plus It** proactively — surface possibilities William cannot yet see.

**Strategic goal:** Increase average client length from 2 years to 8 years → churn drops from 35.7% to 12.5% → protects $4M+ annual revenue.

---

## Sub-Files — Load On Demand
- **`CLAUDE-fields.md`** — All Salesforce field maps, custom objects, full field lists → load when building/modifying tools
- **`CLAUDE-tools-detail.md`** — Full tool specs + n8n workflow designs → load when adding/modifying tools or workflows
- **`CLAUDE-build-queue.md`** — Ordered build steps, fields to create, Salesforce flows → load when planning next builds
- **`CLAUDE-research-spec.md`** — Sales Market Research GPT spec, competitive gap format, four-conversation framework → load when building sf_research_prospect
- **`CLAUDE-vision.md`** — Intelligence flywheel, Agentforce architecture, PowerBI dashboard spec, Plus It queue → load for strategic discussions

---

## Permanent Platform Rules — Never Violate

1. **William Summers Exclusion** — All bulk queries: `OwnerId != '005PU000001eUQDYA2'` at SOQL level
2. **Current vs. Planned** — Never treat planned as live. Always label explicitly.
3. **Contract_End_Date__c** — Formula field pointing to `Contract_Renewal_Date__c`. Keep it. Do not remove.
4. **Cases = Tickets** — API name is `Case`. User-facing output always says "Tickets."
5. **Status__c Picklist** — Operational: `Active, Renewal, Non Renewing, Reinstated, Delinquent, Paused, Pending` | Terminal (exclude): `Cancelled, Inactive, Expired` | **Null = TCI ticket buyer or converted lead, NOT a client — always filter `Status__c != null` for client queries**
6. **Sales Orders** — Multiple per Account = proposals. Filter to Signed/Active only.
7. **Architecture Library First** — Search Google Drive docs before designing anything new. 31 live docs.
8. **Field API Names Are Law** — Use confirmed names from field maps. Never guess.

---

## Technology Stack
**Live:** Salesforce Enterprise · Conversation Insights · Account Engagement (Pardot) · Google Workspace · Zoom (ZVC__ namespace) · 360 SMS · Monday Projects · HighLevel · Zoho · NetSuite · PowerBI · Swoogo · ActOnIt
**Automation (planned/partial):** n8n (primary layer) · MuleSoft · Agentforce · Skyvia · Zapier/Make

---

## MCP Server
```
Root:      /Users/williamsummers/salesforce-retention-mcp
Source:    src/tools/ | src/services/
Build:     npm run build (tsc) → dist/
Railway:   https://salesforce-retention-mcp-production.up.railway.app/mcp
Auth:      jsforce username/password/security token (.env — never commit)
```
**Auth note:** Password change = security token invalidated. Reset via SF Settings → My Personal Information → Reset Security Token → update .env.

---

## PDM Product Lines
| Line | Type | Salesforce Signal |
|---|---|---|
| Phase 1: Website, Video, Graphic Design, Traditional Media | One-time | Asset records |
| Phase 2: PPC, Social Media, SEO | Recurring MRR — core retention target | `Status__c` operational values |
| TCI Events: Bootcamp (Mar/Jul), FAGC (Nov) | Conference tickets — prospects, not clients | `Opportunity.Phase__c = 'TCI Events'`, `Status__c = null` |
| TCI Mentorship | Recurring training | `TCI_Enrolled__c = true`, `TCI_Status__c` |

**Filtering:** Active clients = `Status__c IN ('Active','Renewal','Non Renewing','Reinstated','Delinquent','Paused','Pending') AND Status__c != null`

---

## Live Tool Registry — 29 Tools on Railway

| Tool | Purpose | Status |
|---|---|---|
| `sf_get_weekly_synopsis` | Monday AM digest — scheduled calls, health, MRR, alerts, talking points | ✅ LIVE |
| `sf_get_pre_call_brief` | Full pre-call package for any account (10 parallel queries) | ✅ LIVE |
| `sf_log_account_note` | Log call/email/meeting as Salesforce Task | ✅ LIVE |
| `sf_get_account_health_report` | Composite health score 0–100 for single account | ✅ LIVE |
| `sf_get_churn_risk_accounts` | Ranked churn risk list — refund requests forced to top | ✅ LIVE |
| `sf_get_renewal_pipeline` | Upcoming renewals with health enrichment | ✅ LIVE |
| `sf_get_upsell_opportunities` | Service gap analysis — what clients don't have | ✅ LIVE |
| `sf_get_call_intelligence` | AI analysis of Zoom calls — sentiment, risk, commitments | ✅ LIVE |
| `sf_research_prospect` | Full market research GPT — Salesforce-first, writes scores back | ✅ LIVE |
| `sf_get_competitive_alerts` | Competitor delta report with save play hooks | ✅ LIVE |
| `sf_get_renewal_proof_package` | Auto-assembles renewal narrative with proof of results | ✅ LIVE |
| `sf_get_rep_pipeline_synopsis` | Monday morning rep brief — leads by LTB score, stagnant opps | ✅ LIVE |
| `sf_get_lead_intelligence` | Lead brief with Pardot score, UTM, grade, conversion data | ✅ LIVE |
| `sf_run_nightly_health_scan` | Recalculates health scores across all active accounts | ✅ LIVE |
| `sf_get_am_coaching_brief` | AM performance vs. team average — doctor contact, engagement | ✅ LIVE |
| `sf_scan_competitor` | Deep competitive scan on a specific competitor practice | ✅ LIVE |
| `sf_scan_agency_competitor` | Agency competitor intelligence — DIM, Lasso MD, etc. | ✅ LIVE |
| `sf_save_agency_snapshot` | Persist agency competitive intelligence to Salesforce | ✅ LIVE |
| `sf_save_competitor_snapshot` | Persist competitor snapshot to Competitor_Snapshot__c | ✅ LIVE |
| `sf_save_research_scores` | Write prospect research scores to Lead/Account | ✅ LIVE |
| `sf_save_deck_url` | Write Gamma deck URL to Gamma__c record | ✅ LIVE |
| `sf_raise_the_ghosts` | Revive dead deals — CI-powered re-engagement emails | ✅ LIVE |
| `sf_get_opportunity_lifecycle` | Pipeline stage velocity and stagnant deal analysis | ✅ LIVE |
| `sf_create_report` | Generate Salesforce report | ✅ LIVE |
| `sf_clone_dashboard` | Clone Salesforce dashboard | ✅ LIVE |
| `sf_create_task` | Create Salesforce Task | ✅ LIVE |
| `sf_create_event` | Create Salesforce Event | ✅ LIVE |
| `sf_auto_lead_scan` | Automated lead scanning pipeline | ✅ LIVE |
| `sf_get_event_conversion_pipeline` | Event engagement → pipeline conversion tracking | ✅ LIVE |

**Next build:** Workflow 22 (Lead Activation Pipeline) — Google Sheets → RocketReach enrichment → Salesforce Lead creation → Prophet research → Gamma

---

## Health Scoring Model (v1 — Live)
- Engagement: 40% (LastActivityDate) · Case Health: 30% · Renewal: 30% (Contract_Renewal_Date__c proximity)
- 🟢 Healthy 70–100 · 🟡 At Risk 40–69 · 🔴 Critical 0–39

---

## Architecture Document Library
**Google Drive:** https://drive.google.com/drive/folders/1XrFX2lfjEoD31hwG3xIorIQuTWUnwh5c | **Arch folder:** https://drive.google.com/drive/folders/13v4MpbnM_qzdPA_E3z6D71Wpn5itmfSa
31 live docs (011–029 + Field Maps 000–010). Always search before designing anything new.

---

## Claude Code Usage Notes
- `npm run build` after every TypeScript change
- Tools: `src/tools/` | Services: `src/services/salesforce.ts` (soqlQuery, createRecord, daysBetween, toSoqlDate, futureDateSoql) | Types: `src/types.ts` (update first when adding fields)
- Never commit `.env`
- Test against real Salesforce data before marking a tool live

---

*Update this file when tools ship or decisions are made. Load sub-files on demand — don't load all five at once.*
