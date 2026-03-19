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

interface SFOpportunity {
  Id: string;
  Name: string;
  StageName?: string;
  CloseDate?: string;
  Amount?: number;
  LastModifiedDate?: string;
  CreatedDate?: string;
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

  const ownerFilter = owner_id ? `AND OwnerId = '${owner_id}'` : `AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`;
  const deadStatusList = DEAD_LEAD_STATUSES.map(s => `'${s}'`).join(', ');

  // ── Parallel queries ──────────────────────────────────────────────────────

  const [allLeads, openOpps] = await Promise.all([
    salesforceService.rawQuery<SFLead>(
      `SELECT Id, Name, Company, City, State, Phone, Email,
              Status, OwnerId, Owner.Name, LeadSource,
              LastActivityDate, CreatedDate, Website,
              Likelihood_to_Buy_Score__c, Marketing_Maturity_Score__c,
              Priority_Level__c, Primary_Gap_Type__c, Research_Summary__c
       FROM Lead
       WHERE IsConverted = false
         AND Status NOT IN (${deadStatusList})
         ${ownerFilter}
       ORDER BY Likelihood_to_Buy_Score__c DESC NULLS LAST, LastActivityDate DESC NULLS LAST
       LIMIT 100`
    ),
    salesforceService.rawQuery<SFOpportunity>(
      `SELECT Id, Name, StageName, CloseDate, Amount,
              LastModifiedDate, CreatedDate,
              AccountId, Account.Name, OwnerId, Owner.Name
       FROM Opportunity
       WHERE IsClosed = false
         ${ownerFilter}
       ORDER BY CloseDate ASC NULLS LAST
       LIMIT 100`
    ),
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

  const staleOpps = openOpps.filter(o => daysSince(o.LastModifiedDate) >= opp_stale_days);
  const activeOpps = openOpps.filter(o => daysSince(o.LastModifiedDate) < opp_stale_days);

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
        const staledays = daysSince(opp.LastModifiedDate);
        const action    = staleOppAction(opp.StageName, staledays);

        lines.push(`#### ${acctName}`);
        lines.push(`**Stage:** ${opp.StageName ?? 'Unknown'} | **Amount:** ${amt} | **Owner:** ${owner}`);
        lines.push(`**Last modified:** ${formatDate(opp.LastModifiedDate)} (${staledays} days ago)`);
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

// ─── Exports ──────────────────────────────────────────────────────────────────

export const repSynopsisHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_rep_pipeline_synopsis: handleRepPipelineSynopsis,
};
