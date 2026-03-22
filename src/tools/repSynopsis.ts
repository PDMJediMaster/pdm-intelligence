// ─────────────────────────────────────────────────────────────────────────────
// sf_get_rep_pipeline_synopsis
//
// Monday morning brief for Sales Reps.
// Parallel to sf_get_weekly_synopsis for Account Managers, but prospect-side.
//
// Sections:
//   1. Top Priority Prospects  — Leads ranked by Likelihood to Buy score
//   2. Leads Needing Research  — Leads with no scores yet (run sf_research_prospect)
//   3. Leads Going Cold        — High-LTB leads with no activity in 7+ days
//   4. Open Opportunities      — Active deals grouped by urgency/staleness
//   5. Stale Deals Alert       — Opps not touched in > stale_days with suggested action
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const WILLIAM_SUMMERS_USER_ID = '005PU000001eUQDYA2';

const DEAD_LEAD_STATUSES = [
  'Closed - Converted',
  'Unqualified',
  'Dead',
  'Disqualified',
  'Converted',
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface SFLead {
  Id: string;
  Name: string;
  Company?: string;
  City?: string;
  State?: string;
  Phone?: string;
  Email?: string;
  Status?: string;
  OwnerId?: string;
  Owner?: { Name: string };
  Sales_Rep__c?: string;
  Sales_Rep__r?: { Name: string };
  LeadSource?: string;
  LastActivityDate?: string;
  CreatedDate?: string;
  Website?: string;
  Likelihood_to_Buy_Score__c?: number;
  Marketing_Maturity_Score__c?: number;
  Priority_Level__c?: string;
  Primary_Gap_Type__c?: string;
  Research_Summary__c?: string;
}

interface SFEvent {
  Id: string;
  Subject?: string;
  StartDateTime?: string;
  EndDateTime?: string;
  WhoId?: string;
  Who?: { Name: string };
  WhatId?: string;
  What?: { Name: string };
  OwnerId?: string;
  Owner?: { Name: string };
  Description?: string;
}

interface SFOpportunity {
  Id: string;
  Name: string;
  StageName?: string;
  CloseDate?: string;
  Amount?: number;
  LastModifiedDate?: string;
  CreatedDate?: string;
  Stage_Entry_Date__c?: string;
  Days_In_Current_Stage__c?: number;
  AccountId?: string;
  Account?: { Name: string };
  OwnerId?: string;
  Owner?: { Name: string };
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export const repSynopsisTools: Tool[] = [
  {
    name: 'sf_get_rep_pipeline_synopsis',
    description:
      'Monday morning pipeline brief for Sales Reps. Shows top priority prospects ranked by ' +
      'Likelihood to Buy score, leads needing research, leads going cold, open opportunities ' +
      'by stage, and stale deals flagged for action. ' +
      'Use when a rep asks "what should I focus on this week", "show me my pipeline", ' +
      '"what are my best leads", or "what deals need attention". ' +
      'Accepts either owner_name (e.g. "Liam Copsey") or owner_id — name is resolved automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        owner_name: {
          type: 'string',
          description: 'Rep full name (e.g. "Liam Copsey") — tool resolves to User ID automatically. Use instead of owner_id when the name is known.',
        },
        owner_id: {
          type: 'string',
          description: 'Salesforce User ID — use only if owner_name is not available.',
        },
        lead_limit: {
          type: 'number',
          description: 'Max leads to show in the priority list (default: 15)',
        },
        opp_stale_days: {
          type: 'number',
          description: 'Flag opportunities not modified in this many days (default: 14)',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schema ─────────────────────────────────────────────────────────────

const RepSynopsisArgs = z.object({
  owner_name:     z.string().optional(),
  owner_id:       z.string().optional(),
  lead_limit:     z.number().min(1).max(50).default(15),
  opp_stale_days: z.number().min(1).max(90).default(14),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(isoDate: string | null | undefined): number {
  if (!isoDate) return 9999;
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}

function formatDate(d: string | null | undefined): string {
  if (!d) return 'Never';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function priorityEmoji(level: string | undefined): string {
  switch (level) {
    case 'Top Priority': return '🔴';
    case 'High':         return '🟠';
    case 'Moderate':     return '🟡';
    case 'Low':          return '🟢';
    default:             return '⚪';
  }
}

function ltbBar(score: number | undefined): string {
  if (score == null) return '—';
  const filled = Math.round((score / 100) * 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${score}/100`;
}

function staleOppAction(stage: string | undefined, daysSinceModified: number): string {
  const s = (stage ?? '').toLowerCase();
  if (s.includes('prospect') || s.includes('qualify')) {
    return `No movement in ${daysSinceModified}d — book a discovery call or disqualify`;
  }
  if (s.includes('discovery') || s.includes('connect')) {
    return `No movement in ${daysSinceModified}d — send proposal or schedule next step`;
  }
  if (s.includes('proposal') || s.includes('present')) {
    return `No movement in ${daysSinceModified}d — follow up on proposal, address objections`;
  }
  if (s.includes('negotiat') || s.includes('contract')) {
    return `No movement in ${daysSinceModified}d — escalate or close this week`;
  }
  return `No movement in ${daysSinceModified}d — define next step immediately`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

interface SFUser { Id: string; Name: string; }

async function handleRepPipelineSynopsis(rawArgs: unknown): Promise<string> {
  const { owner_name, owner_id: rawOwnerId, lead_limit, opp_stale_days } = RepSynopsisArgs.parse(rawArgs ?? {});

  // Resolve owner_name → owner_id if a name was provided
  let owner_id = rawOwnerId;
  let resolvedRepName: string | undefined;

  if (owner_name && !owner_id) {
    const escaped = owner_name.replace(/'/g, "\\'");
    const users = await salesforceService.rawQuery<SFUser>(
      `SELECT Id, Name FROM User WHERE Name LIKE '%${escaped}%' AND IsActive = true LIMIT 5`
    );
    if (users.length === 0) {
      return `❌ No active Salesforce user found matching "${owner_name}". Check the spelling and try again.`;
    }
    if (users.length > 1) {
      const names = users.map(u => `${u.Name} (${u.Id})`).join('\n- ');
      return `⚠️ Multiple users match "${owner_name}":\n- ${names}\n\nPlease re-run with the exact name or provide the owner_id directly.`;
    }
    owner_id = users[0].Id;
    resolvedRepName = users[0].Name;
  }

  // Owner filters — Leads use Sales_Rep__c OR OwnerId; Opps/Events use OwnerId
  const oppOwnerFilter   = owner_id ? `AND OwnerId = '${owner_id}'` : `AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`;
  const leadOwnerFilter  = owner_id
    ? `AND (OwnerId = '${owner_id}' OR Sales_Rep__c = '${owner_id}')`
    : `AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`;
  const eventOwnerFilter = owner_id ? `AND OwnerId = '${owner_id}'` : `AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`;

  const deadStatusList = DEAD_LEAD_STATUSES.map(s => `'${s}'`).join(', ');

  // ── Parallel queries ──────────────────────────────────────────────────────

  interface UpcomingEventAccount {
    Id: string; Name: string; Phone?: string;
    BillingCity?: string; BillingState?: string;
    LastActivityDate?: string; Status__c?: string; TCI_Status__c?: string;
    OwnerId?: string; Owner?: { Name: string };
  }

  const [allLeads, openOpps, thisWeekEvents, upcomingEventAccounts] = await Promise.all([
    salesforceService.rawQuery<SFLead>(
      `SELECT Id, Name, Company, City, State, Phone, Email,
              Status, OwnerId, Owner.Name,
              Sales_Rep__c, Sales_Rep__r.Name,
              LeadSource, LastActivityDate, CreatedDate, Website,
              Likelihood_to_Buy_Score__c, Marketing_Maturity_Score__c,
              Priority_Level__c, Primary_Gap_Type__c, Research_Summary__c
       FROM Lead
       WHERE IsConverted = false
         AND Status NOT IN (${deadStatusList})
         ${leadOwnerFilter}
       ORDER BY Likelihood_to_Buy_Score__c DESC NULLS LAST, LastActivityDate DESC NULLS LAST
       LIMIT 100`
    ),
    salesforceService.rawQuery<SFOpportunity>(
      `SELECT Id, Name, StageName, CloseDate, Amount,
              LastModifiedDate, CreatedDate,
              Stage_Entry_Date__c, Days_In_Current_Stage__c,
              AccountId, Account.Name, OwnerId, Owner.Name
       FROM Opportunity
       WHERE IsClosed = false
         ${oppOwnerFilter}
       ORDER BY CloseDate ASC NULLS LAST
       LIMIT 100`
    ),
    salesforceService.rawQuery<SFEvent>(
      `SELECT Id, Subject, StartDateTime, EndDateTime,
              WhoId, Who.Name, WhatId, What.Name,
              OwnerId, Owner.Name
       FROM Event
       WHERE StartDateTime >= TODAY
         AND StartDateTime <= NEXT_N_DAYS:7
         ${eventOwnerFilter}
       ORDER BY StartDateTime ASC
       LIMIT 50`
    ),

    // Accounts registered for the upcoming Vegas Bootcamp not yet converted.
    // Queries TCI_Events_Attended__c — the authoritative attendance source — using
    // a semi-join subquery to get unique Account records.
    salesforceService.rawQuery<UpcomingEventAccount>(
      `SELECT Id, Name, Phone, BillingCity, BillingState,
              LastActivityDate, Status__c, TCI_Status__c,
              OwnerId, Owner.Name
       FROM Account
       WHERE OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         ${oppOwnerFilter}
         AND Status__c NOT IN ('Active', 'Reinstated')
         AND (TCI_Status__c = null OR TCI_Status__c != 'Member')
         AND Id IN (
           SELECT Account__c FROM TCI_Events_Attended__c
           WHERE Is_This_A_Sponsor__c = false
             AND Account__c != null
             AND (TCI_Events__r.Name LIKE '%Vegas%'
                  OR TCI_Events__r.Name LIKE '%FABC26%'
                  OR TCI_Events__r.Name LIKE '%Bootcamp%')
         )
       ORDER BY LastActivityDate ASC NULLS FIRST
       LIMIT 25`
    ).catch(() => [] as UpcomingEventAccount[]),
  ]);

  // ── Segment leads ─────────────────────────────────────────────────────────

  const scoredLeads   = allLeads.filter(l => l.Likelihood_to_Buy_Score__c != null);
  const unscoredLeads = allLeads.filter(l => l.Likelihood_to_Buy_Score__c == null);

  // Top priority — scored leads, already sorted by LTB desc
  const topLeads = scoredLeads.slice(0, lead_limit);

  // Going cold — scored leads with no activity in 7+ days, high priority
  const goingCold = scoredLeads.filter(l =>
    (l.Likelihood_to_Buy_Score__c ?? 0) >= 50 &&
    daysSince(l.LastActivityDate) >= 7
  ).slice(0, 10);

  // Unscored but recently created (worth researching)
  const needsResearch = unscoredLeads
    .filter(l => daysSince(l.CreatedDate) <= 30)
    .slice(0, 10);

  // ── Segment opportunities ─────────────────────────────────────────────────

  // Use Days_In_Current_Stage__c (exact) if populated; fall back to LastModifiedDate proxy
  const daysInStage = (o: SFOpportunity): number =>
    (o.Days_In_Current_Stage__c != null && o.Days_In_Current_Stage__c > 0)
      ? o.Days_In_Current_Stage__c
      : daysSince(o.LastModifiedDate);

  const staleOpps  = openOpps.filter(o => daysInStage(o) >= opp_stale_days);
  const activeOpps = openOpps.filter(o => daysInStage(o) < opp_stale_days);

  // ── Build output ──────────────────────────────────────────────────────────

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const lines: string[] = [];

  lines.push(`# 📋 Rep Pipeline Synopsis`);
  lines.push(`**${today}**`);
  if (resolvedRepName) lines.push(`**Rep:** ${resolvedRepName}`);
  else if (owner_id)   lines.push(`**Filtered to:** ${owner_id}`);
  lines.push('');
  lines.push(`| | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Scored Leads | **${scoredLeads.length}** |`);
  lines.push(`| Unscored Leads | **${unscoredLeads.length}** |`);
  lines.push(`| Open Opportunities | **${openOpps.length}** |`);
  lines.push(`| Stale Opportunities (>${opp_stale_days}d) | **${staleOpps.length}** |`);
  lines.push(`| Calls/Events This Week | **${thisWeekEvents.length}** |`);
  if (upcomingEventAccounts.length > 0) {
    lines.push(`| 🚨 Vegas Bootcamp — unconverted registrants | **${upcomingEventAccounts.length}** |`);
  }
  lines.push('');

  // ── Section 0A: Vegas Bootcamp Pre-Event Outreach (time-sensitive) ────────

  if (upcomingEventAccounts.length > 0) {
    const today2     = new Date();
    const eventDate  = new Date('2026-03-27');
    const daysToGo   = Math.max(0, Math.floor((eventDate.getTime() - today2.getTime()) / 86_400_000));
    const urgencyTag = daysToGo <= 3  ? '🚨 HAPPENING NOW'
                     : daysToGo <= 7  ? `🚨 ${daysToGo} DAYS AWAY`
                     : daysToGo <= 14 ? `⚠️ ${daysToGo} DAYS AWAY`
                     : `📅 ${daysToGo} days away`;

    lines.push(`---`);
    lines.push(`## 🎟️ Vegas Bootcamp Pre-Event Outreach — ${urgencyTag}`);
    lines.push(`### March 27–28 | Las Vegas, NV`);
    lines.push(`*${upcomingEventAccounts.length} registered practices haven't converted. They're walking in the door in ${daysToGo} days. Call them before they arrive — warm them up, book a 1:1 at the event, bring a Phase 2 proposal.*`);
    lines.push('');

    for (const acct of upcomingEventAccounts) {
      const location    = [acct.BillingCity, acct.BillingState].filter(Boolean).join(', ');
      const owner       = (acct.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
      const daysSinceLast = acct.LastActivityDate
        ? Math.floor((Date.now() - new Date(acct.LastActivityDate).getTime()) / 86_400_000)
        : null;
      const contactNote = daysSinceLast === null ? '⚠️ Never contacted' : `${daysSinceLast}d since last contact`;
      const statusNote  = acct.Status__c ?? 'No marketing status';

      lines.push(`- **${acct.Name}**${location ? ` | ${location}` : ''} | ${contactNote} | ${statusNote} | Owner: ${owner}`);
      if (acct.Phone) lines.push(`  📞 ${acct.Phone}`);
    }
    lines.push('');
    lines.push(`*For full pipeline view: run \`sf_get_event_conversion_pipeline\`*`);
    lines.push('');
  }

  // ── Section 0: This Week's Calendar ──────────────────────────────────────

  lines.push(`---`);
  lines.push(`## 📅 Scheduled This Week`);
  lines.push('');

  if (thisWeekEvents.length === 0) {
    lines.push(`⚠️ **No events scheduled in Salesforce for the next 7 days.**`);
    lines.push(`Schedule calls for your top prospects to ensure consistent outreach.`);
  } else {
    for (const evt of thisWeekEvents) {
      const start    = evt.StartDateTime
        ? new Date(evt.StartDateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : 'No time set';
      const contact  = (evt.Who as { Name?: string } | undefined)?.Name;
      const related  = (evt.What as { Name?: string } | undefined)?.Name;
      const owner    = (evt.Owner as { Name?: string } | undefined)?.Name;
      const details  = [contact, related].filter(Boolean).join(' — ');

      lines.push(`- **${evt.Subject ?? 'Untitled Event'}** | ${start}${details ? ` | ${details}` : ''}${owner ? ` | ${owner}` : ''}`);
    }
  }
  lines.push('');

  // ── Section 1: Top Priority Prospects ────────────────────────────────────

  lines.push(`---`);
  lines.push(`## 🎯 Top Priority Prospects`);
  lines.push(`*Ranked by Likelihood to Buy score — these are your best calls this week*`);
  lines.push('');

  if (topLeads.length === 0) {
    lines.push('No scored leads found. Run `sf_research_prospect` on your leads to generate scores.');
  } else {
    for (const lead of topLeads) {
      const location = [lead.City, lead.State].filter(Boolean).join(', ');
      const owner    = (lead.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
      const sinceDays = daysSince(lead.LastActivityDate);
      const activityNote = sinceDays === 9999 ? 'No activity on record' : `Last contact: ${sinceDays}d ago`;

      lines.push(`### ${priorityEmoji(lead.Priority_Level__c)} ${lead.Company ?? lead.Name}`);
      lines.push(`**Contact:** ${lead.Name}${location ? ` | ${location}` : ''} | **Owner:** ${owner}`);
      lines.push(`**LTB:** ${ltbBar(lead.Likelihood_to_Buy_Score__c)} | **Maturity:** ${lead.Marketing_Maturity_Score__c ?? '—'}/100`);
      lines.push(`**Priority:** ${lead.Priority_Level__c ?? 'Not set'} | **Gap:** ${lead.Primary_Gap_Type__c ?? 'Not set'} | ${activityNote}`);
      if (lead.Research_Summary__c) {
        lines.push(`**Intel:** ${lead.Research_Summary__c}`);
      }
      if (lead.Phone) lines.push(`**Phone:** ${lead.Phone}`);
      lines.push('');
    }
  }

  // ── Section 2: Leads Going Cold ───────────────────────────────────────────

  if (goingCold.length > 0) {
    lines.push(`---`);
    lines.push(`## 🧊 Going Cold — Re-Engage This Week`);
    lines.push(`*High-potential leads (LTB ≥ 50) with no activity in 7+ days*`);
    lines.push('');

    for (const lead of goingCold) {
      const daysSinceActivity = daysSince(lead.LastActivityDate);
      const owner = (lead.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
      lines.push(`- **${lead.Company ?? lead.Name}** (${lead.City ?? ''}, ${lead.State ?? ''}) — LTB: ${lead.Likelihood_to_Buy_Score__c}/100 | ${daysSinceActivity}d since last contact | Owner: ${owner}`);
    }
    lines.push('');
  }

  // ── Section 3: Needs Research ─────────────────────────────────────────────

  if (needsResearch.length > 0) {
    lines.push(`---`);
    lines.push(`## 🔍 New Leads — Run Research to Score`);
    lines.push(`*Created in the last 30 days with no research scores yet*`);
    lines.push('');

    for (const lead of needsResearch) {
      const daysOld = daysSince(lead.CreatedDate);
      const owner   = (lead.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
      lines.push(`- **${lead.Company ?? lead.Name}** (${lead.City ?? ''}, ${lead.State ?? ''}) — Created ${daysOld}d ago | Owner: ${owner}`);
    }
    lines.push('');
    lines.push(`*Run: "Research a prospect: [Name] in [City, State]" to generate LTB scores*`);
    lines.push('');
  }

  // ── Section 4: Open Opportunities ────────────────────────────────────────

  if (openOpps.length > 0) {
    lines.push(`---`);
    lines.push(`## 💼 Open Opportunities`);
    lines.push('');

    if (activeOpps.length > 0) {
      lines.push(`### ✅ Active (${activeOpps.length})`);
      for (const opp of activeOpps) {
        const acctName = (opp.Account as { Name?: string } | undefined)?.Name ?? opp.AccountId ?? 'Unknown';
        const owner    = (opp.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
        const amt      = opp.Amount ? `$${opp.Amount.toLocaleString()}` : 'No amount';
        const closeIn  = opp.CloseDate
          ? Math.floor((new Date(opp.CloseDate).getTime() - Date.now()) / 86_400_000)
          : null;
        const closeNote = closeIn != null
          ? (closeIn < 0 ? `⚠️ Past close date by ${Math.abs(closeIn)}d` : `Closes in ${closeIn}d`)
          : 'No close date';

        lines.push(`- **${acctName}** — ${opp.StageName ?? 'Unknown stage'} | ${amt} | ${closeNote} | Owner: ${owner}`);
      }
      lines.push('');
    }

    if (staleOpps.length > 0) {
      lines.push(`### 🚨 Stale — No Movement in ${opp_stale_days}+ Days (${staleOpps.length})`);
      lines.push('');
      for (const opp of staleOpps) {
        const acctName  = (opp.Account as { Name?: string } | undefined)?.Name ?? opp.AccountId ?? 'Unknown';
        const owner     = (opp.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
        const amt       = opp.Amount ? `$${opp.Amount.toLocaleString()}` : 'No amount';
        const staledays = daysInStage(opp);
        const stageNote = opp.Stage_Entry_Date__c
          ? `Entered stage: ${formatDate(opp.Stage_Entry_Date__c)}`
          : `Last modified: ${formatDate(opp.LastModifiedDate)} (est.)`;
        const action    = staleOppAction(opp.StageName, staledays);

        lines.push(`#### ${acctName}`);
        lines.push(`**Stage:** ${opp.StageName ?? 'Unknown'} | **Amount:** ${amt} | **Owner:** ${owner}`);
        lines.push(`**${stageNote}** | **${staledays} days in current stage**`);
        lines.push(`**Action:** ${action}`);
        lines.push('');
      }
    }
  } else {
    lines.push(`---`);
    lines.push(`## 💼 Open Opportunities`);
    lines.push('No open opportunities found.');
    lines.push('');
  }

  // ── Footer ────────────────────────────────────────────────────────────────

  lines.push(`---`);
  lines.push(`*Generated ${new Date().toLocaleString()} | PDM Account Intelligence Hub*`);

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// sf_get_event_conversion_pipeline
//
// Shows all TCI Event attendees (closed-won ticket purchases) who have NOT yet
// converted to Phase 2 marketing clients or TCI Mentorship members.
//
// These are warm prospects — they've already paid to be in the room with PDM.
// They need proactive Sales Rep outreach, ideally BEFORE each event.
//
// Priority ranking:
//   1. Upcoming event registrants (e.g. Vegas Bootcamp in days) — contact NOW
//   2. Past event attendees with zero activity — dormant warm leads
//   3. Everyone else sorted by days since last contact
// ─────────────────────────────────────────────────────────────────────────────

repSynopsisTools.push({
  name: 'sf_get_event_conversion_pipeline',
  description:
    'Shows all TCI conference ticket purchasers who have NOT converted to Phase 2 marketing ' +
    'clients or TCI Mentorship members. These are warm prospects who paid to attend a PDM event. ' +
    'Ranked by urgency: upcoming event registrants appear first (contact before they walk in the door), ' +
    'then past attendees sorted by days since last contact. ' +
    'Use when planning pre-event outreach, or to find warm leads who went cold after an event. ' +
    'Accepts optional owner_id to filter to a specific rep.',
  inputSchema: {
    type: 'object',
    properties: {
      owner_id: {
        type: 'string',
        description: 'Filter to a specific Sales Rep by Salesforce User ID (optional)',
      },
      limit: {
        type: 'number',
        description: 'Max accounts to return (default: 50)',
      },
    },
    required: [],
  },
});

// ─── Input Schema ─────────────────────────────────────────────────────────────

const EventConversionArgs = z.object({
  owner_id: z.string().optional(),
  limit:    z.number().min(1).max(200).default(50),
});

// ─── Upcoming Events Registry ─────────────────────────────────────────────────
// Update this list each year with the confirmed event schedule.

const UPCOMING_EVENTS: Array<{ name: string; keywords: RegExp; date: string; location: string }> = [
  {
    name:     'Progressive Dental Bootcamp — Las Vegas',
    keywords: /fabc26.?vegas|las.?vegas.*2026|vegas.*bootcamp|bootcamp.*vegas/i,
    date:     '2026-03-27',
    location: 'Las Vegas, NV',
  },
  {
    name:     'Progressive Dental Bootcamp — Dallas',
    keywords: /fabc26.?dallas|dallas.*2026|dallas.*bootcamp|bootcamp.*dallas/i,
    date:     '2026-07-01', // Approximate — update when confirmed
    location: 'Dallas, TX',
  },
  {
    name:     'Full Arch Growth Conference — Orlando',
    keywords: /fagc|full.?arch.?growth|orlando.*2026|2026.*orlando/i,
    date:     '2026-11-01', // Approximate — update when confirmed
    location: 'Orlando, FL',
  },
];

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleEventConversionPipeline(rawArgs: unknown): Promise<string> {
  const { owner_id, limit } = EventConversionArgs.parse(rawArgs ?? {});

  // Filter on Account__r.OwnerId since we query TCI_Events_Attended__c directly
  const ownerClause = owner_id
    ? `AND Account__r.OwnerId = '${owner_id}'`
    : `AND Account__r.OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`;

  // ── Step 1: Query TCI_Events_Attended__c — the authoritative attendance source ──
  //
  // Contact-level precision: actual person who registered, their direct email/mobile
  // from formula fields, confirmed check-in status, and the specific event they attended.
  // Filter to non-sponsors, self-reported non-clients, accounts not yet converted.

  interface EventAttendance {
    Id: string; Name: string;
    Account__c?: string;
    Account__r?: {
      Name?: string; Status__c?: string; TCI_Status__c?: string;
      Phone?: string; Website?: string;
      BillingCity?: string; BillingState?: string;
      LastActivityDate?: string; OwnerId?: string;
      Owner?: { Name?: string };
    };
    Contact__c?: string;
    Contact__r?: { Name?: string; Title?: string };
    TCI_Events__c?: string;
    TCI_Events__r?: { Name?: string };
    Did_They_Check_In__c?: boolean;
    Are_You_A_Current_PDM_Client__c?: boolean;
    Is_This_A_Sponsor__c?: boolean;
    Completed_Preregistration__c?: boolean;
    Is__c?: boolean;          // Is This Your First Event?
    Contact_Email__c?: string;
    Contact_Mobile__c?: string;
  }

  const attendances = await salesforceService.rawQuery<EventAttendance>(
    `SELECT Id, Name,
            Account__c, Account__r.Name, Account__r.Status__c, Account__r.TCI_Status__c,
            Account__r.Phone, Account__r.Website,
            Account__r.BillingCity, Account__r.BillingState,
            Account__r.LastActivityDate, Account__r.OwnerId, Account__r.Owner.Name,
            Contact__c, Contact__r.Name, Contact__r.Title,
            TCI_Events__c, TCI_Events__r.Name,
            Did_They_Check_In__c, Are_You_A_Current_PDM_Client__c,
            Is_This_A_Sponsor__c, Completed_Preregistration__c, Is__c,
            Contact_Email__c, Contact_Mobile__c
     FROM TCI_Events_Attended__c
     WHERE Account__c != null
       AND Is_This_A_Sponsor__c = false
       AND Are_You_A_Current_PDM_Client__c = false
       AND Account__r.Status__c NOT IN ('Active', 'Reinstated')
       AND (Account__r.TCI_Status__c = null OR Account__r.TCI_Status__c != 'Member')
       ${ownerClause}
     ORDER BY Account__r.LastActivityDate ASC NULLS FIRST
     LIMIT ${Math.min(limit * 5, 500)}`
  ).catch(() => [] as EventAttendance[]);

  if (attendances.length === 0) {
    return [
      '# 🎟️ Event Conversion Pipeline',
      '',
      '✅ No unconverted TCI Event attendees found matching the criteria.',
      'All ticket purchasers have either converted to active clients or TCI Members,',
      'or no attendance records exist yet in TCI_Events_Attended__c.',
    ].join('\n');
  }

  // ── Step 2: Group by Account — surface practice-level view with contact detail ──

  const today = new Date();

  interface AttendeeContact {
    contactId: string; name: string; title: string | undefined;
    email: string | undefined; mobile: string | undefined;
    isFirstEvent: boolean;
  }

  interface AttendedEvent {
    eventId: string | undefined; eventName: string;
    checkedIn: boolean; preregistered: boolean;
  }

  interface AccountGroup {
    accountId: string; accountName: string;
    status: string | undefined; tciStatus: string | undefined;
    phone: string | undefined; website: string | undefined;
    city: string | undefined; state: string | undefined;
    lastActivityDate: string | undefined;
    ownerId: string | undefined; ownerName: string | undefined;
    contacts: AttendeeContact[];
    events: AttendedEvent[];
    upcomingEvent: typeof UPCOMING_EVENTS[number] | undefined;
    daysToEvent: number | undefined;
    daysSinceContact: number;
  }

  const accountMap = new Map<string, AccountGroup>();

  for (const att of attendances) {
    if (!att.Account__c) continue;

    const acctR  = att.Account__r ?? {};
    const acctId = att.Account__c;

    if (!accountMap.has(acctId)) {
      const daysSinceContact = acctR.LastActivityDate
        ? Math.floor((today.getTime() - new Date(acctR.LastActivityDate).getTime()) / 86_400_000)
        : 9999;

      accountMap.set(acctId, {
        accountId:        acctId,
        accountName:      acctR.Name ?? 'Unknown Account',
        status:           acctR.Status__c,
        tciStatus:        acctR.TCI_Status__c,
        phone:            acctR.Phone,
        website:          acctR.Website,
        city:             acctR.BillingCity,
        state:            acctR.BillingState,
        lastActivityDate: acctR.LastActivityDate,
        ownerId:          acctR.OwnerId,
        ownerName:        (acctR.Owner as { Name?: string } | undefined)?.Name,
        contacts:         [],
        events:           [],
        upcomingEvent:    undefined,
        daysToEvent:      undefined,
        daysSinceContact,
      });
    }

    const group = accountMap.get(acctId)!;

    // Add contact — deduplicate by Contact__c
    if (att.Contact__c && !group.contacts.some(c => c.contactId === att.Contact__c)) {
      group.contacts.push({
        contactId:   att.Contact__c,
        name:        (att.Contact__r as { Name?: string } | undefined)?.Name ?? 'Unknown',
        title:       (att.Contact__r as { Title?: string } | undefined)?.Title,
        email:       att.Contact_Email__c,
        mobile:      att.Contact_Mobile__c,
        isFirstEvent: att.Is__c ?? false,
      });
    }

    // Add event — deduplicate by TCI_Events__c + name
    const eventName = (att.TCI_Events__r as { Name?: string } | undefined)?.Name ?? att.Name ?? 'Unknown Event';
    if (!group.events.some(e => e.eventId === att.TCI_Events__c)) {
      group.events.push({
        eventId:      att.TCI_Events__c,
        eventName,
        checkedIn:    att.Did_They_Check_In__c ?? false,
        preregistered: att.Completed_Preregistration__c ?? false,
      });
    }

    // Match against upcoming events registry
    for (const upcomingEvt of UPCOMING_EVENTS) {
      const eventDate = new Date(upcomingEvt.date);
      const daysUntil = Math.floor((eventDate.getTime() - today.getTime()) / 86_400_000);
      if (daysUntil >= -3 && daysUntil <= 60 && upcomingEvt.keywords.test(eventName)) {
        if (group.daysToEvent === undefined || daysUntil < group.daysToEvent) {
          group.upcomingEvent = upcomingEvt;
          group.daysToEvent   = daysUntil;
        }
      }
    }
  }

  // ── Step 3: Sort and cap ────────────────────────────────────────────────────

  const allGroups = [...accountMap.values()]
    .sort((a, b) => {
      // Upcoming event registrants always first
      const aUp = a.upcomingEvent !== undefined ? 0 : 1;
      const bUp = b.upcomingEvent !== undefined ? 0 : 1;
      if (aUp !== bUp) return aUp - bUp;
      // Among upcoming: soonest event first
      if (a.daysToEvent !== undefined && b.daysToEvent !== undefined && a.daysToEvent !== b.daysToEvent) {
        return a.daysToEvent - b.daysToEvent;
      }
      // Then: longest dormant — they need the most attention
      return b.daysSinceContact - a.daysSinceContact;
    })
    .slice(0, limit);

  const upcomingGroups = allGroups.filter(g => g.upcomingEvent !== undefined);
  const pastGroups     = allGroups.filter(g => g.upcomingEvent === undefined);

  // ── Step 4: Build output ────────────────────────────────────────────────────

  const lines: string[] = [];

  lines.push(`# 🎟️ TCI Event Conversion Pipeline`);
  lines.push(`*Generated ${today.toLocaleString()}*`);
  lines.push('');
  lines.push(
    `**${allGroups.length} unconverted practices** (${attendances.length} attendance records) — ` +
    `paid to be in the room, haven't become Phase 2 clients or TCI Members yet.`
  );
  lines.push('');
  lines.push(`| | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| 🚨 Registered for upcoming event | **${upcomingGroups.length}** |`);
  lines.push(`| Past attendees — not yet converted | **${pastGroups.length}** |`);
  lines.push('');

  // ── Upcoming Event Groups ─────────────────────────────────────────────────

  if (upcomingGroups.length > 0) {
    const byEvent = new Map<string, AccountGroup[]>();
    for (const g of upcomingGroups) {
      const key = g.upcomingEvent!.name;
      if (!byEvent.has(key)) byEvent.set(key, []);
      byEvent.get(key)!.push(g);
    }

    for (const [, group] of byEvent) {
      const evt      = group[0].upcomingEvent!;
      const daysLeft = group[0].daysToEvent!;
      const urgency  = daysLeft <= 0  ? '🚨 HAPPENING NOW'
                     : daysLeft <= 7  ? `🚨 ${daysLeft} DAYS AWAY`
                     : daysLeft <= 14 ? `⚠️ ${daysLeft} DAYS AWAY`
                     : `📅 ${daysLeft} days`;

      lines.push(`---`);
      lines.push(`## 🚨 Registered for Upcoming Event — ${urgency}`);
      lines.push(`### ${evt.name} | ${evt.location} | ${evt.date}`);
      lines.push(
        `*${group.length} practices walk through the door ${daysLeft <= 0 ? 'NOW' : `in ${daysLeft} days`}. ` +
        `Call them BEFORE the event — warm them up, book a 1:1 at the conference, bring a Phase 2 proposal.*`
      );
      lines.push('');

      for (const g of group) {
        const location    = [g.city, g.state].filter(Boolean).join(', ');
        const owner       = g.ownerName ?? 'Unknown';
        const lastContact = g.daysSinceContact === 9999 ? 'Never contacted' : `Last contact: ${g.daysSinceContact}d ago`;
        const statusNote  = g.status ? ` | Status: ${g.status}` : ' | No marketing status';
        const tciNote     = g.tciStatus ? ` | TCI: ${g.tciStatus}` : '';
        const multiEvt    = g.events.length > 1 ? ` | 🔁 ${g.events.length} events` : '';
        const checkedIn   = g.events.some(e => e.checkedIn);
        const attendBadge = checkedIn ? ' ✅ Checked in' : ' ⏳ Registered';

        lines.push(`#### ${g.accountName}${attendBadge}${multiEvt}`);
        lines.push(`${location ? `📍 ${location} | ` : ''}👤 Owner: ${owner} | ${lastContact}${statusNote}${tciNote}`);
        if (g.phone) lines.push(`📞 ${g.phone}${g.website ? ` | 🌐 ${g.website}` : ''}`);

        // Contact-level details — this is the person walking in the door
        for (const c of g.contacts) {
          const parts = [`👤 **${c.name}**`];
          if (c.title)  parts.push(c.title);
          if (c.email)  parts.push(`✉️ ${c.email}`);
          if (c.mobile) parts.push(`📱 ${c.mobile}`);
          if (c.isFirstEvent) parts.push('🆕 First event');
          lines.push(`  ${parts.join(' | ')}`);
        }

        lines.push(`**Action:** Book a 1:1 at the event. Bring Phase 2 proposal. Ask what they're hoping to get out of the conference.`);
        lines.push('');
      }
    }
  }

  // ── Past Attendees Section ─────────────────────────────────────────────────

  if (pastGroups.length > 0) {
    lines.push(`---`);
    lines.push(`## 📋 Past Event Attendees — Not Yet Converted (${pastGroups.length})`);
    lines.push(`*Attended a PDM event but haven't started Phase 2 services or TCI Mentorship.*`);
    lines.push('');

    for (const g of pastGroups) {
      const location    = [g.city, g.state].filter(Boolean).join(', ');
      const lastContact = g.daysSinceContact === 9999 ? '⚠️ Never contacted' : `${g.daysSinceContact}d since last contact`;
      const dormantFlag = g.daysSinceContact > 90 ? ' 🧊 COLD' : g.daysSinceContact > 30 ? ' ⚠️ Going cold' : '';
      const multiEvt    = g.events.length > 1 ? ` | 🔁 **${g.events.length} events attended** — high intent` : '';
      const statusNote  = g.status ? `Status: ${g.status}` : 'No marketing status';
      const confirmedAttendee = g.events.some(e => e.checkedIn);
      const eventsList  = g.events
        .map(e => `${e.eventName}${e.checkedIn ? ' ✅' : ' (registered)'}`)
        .join(', ');

      lines.push(`- **${g.accountName}**${dormantFlag}${multiEvt}`);
      lines.push(`  ${location ? `📍 ${location} | ` : ''}${lastContact} | ${statusNote}${confirmedAttendee ? ' | ✅ Confirmed attendee' : ''}`);
      lines.push(`  Events: ${eventsList}`);

      // Primary contact info — direct outreach details
      if (g.contacts.length > 0) {
        const primary = g.contacts[0];
        const contactParts = [`👤 ${primary.name}`];
        if (primary.email)  contactParts.push(`✉️ ${primary.email}`);
        if (primary.mobile) contactParts.push(`📱 ${primary.mobile}`);
        if (g.contacts.length > 1) contactParts.push(`+${g.contacts.length - 1} more`);
        lines.push(`  ${contactParts.join(' | ')}`);
      } else if (g.phone) {
        lines.push(`  📞 ${g.phone}`);
      }

      lines.push('');
    }
  }

  lines.push(`---`);
  lines.push(`*Tip: Run \`sf_research_prospect\` on any of these practices to generate a full market analysis and talking points before you call.*`);

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const repSynopsisHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_rep_pipeline_synopsis:       handleRepPipelineSynopsis,
  sf_get_event_conversion_pipeline:   handleEventConversionPipeline,
};
