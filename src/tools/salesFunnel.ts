// ─────────────────────────────────────────────────────────────────────────────
// sf_get_rep_funnel
//
// M-One Capital — Per-rep sales funnel dashboard.
//
// Shows the full pipeline per Sales Rep:
//   New Leads → In Contact → Consult Scheduled → Consult Held → Qualified
//   → Proposal → Order Forms → Closed Won
//
// Includes:
//   - Current pipeline snapshot by stage
//   - Conversion rates benchmarked against M-One targets
//   - Pipeline forecast (proposals × 30% close rate)
//   - Stale deal alerts (no movement > stale_days)
//
// M-One Capital targets (from 2026 strategy meeting):
//   - Booking rate: 70-80% (lead → consult scheduled)
//   - Show rate:    70%    (scheduled → held)
//   - Close rate:   30%    (proposals → closed won)
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const WILLIAM_SUMMERS_USER_ID = '005PU000001eUQDYA2';

// M-One Capital targets from 2026 growth strategy meeting
const TARGETS = {
  bookingRate: 0.75,  // 70–80% — using mid-point
  showRate:    0.70,
  closeRate:   0.30,
};

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const salesFunnelTools: Tool[] = [
  {
    name: 'sf_get_rep_funnel',
    description:
      'Per-rep sales funnel dashboard. Shows the full Lead→Consult→Proposal→Close pipeline ' +
      'for each Sales Rep with conversion rates benchmarked against M-One Capital growth targets ' +
      '(75% booking, 70% show, 30% close). Includes pipeline forecast and stale deal alerts. ' +
      'Use when leadership asks "show me the rep numbers", "what\'s the real pipeline", ' +
      '"where are we losing deals", "how are reps performing", or "show me the funnel". ' +
      'Filter to a single rep by name or show all reps for a leadership overview.',
    inputSchema: {
      type: 'object',
      properties: {
        owner_name: {
          type: 'string',
          description: 'Filter to a specific rep by name (e.g. "Matt Dunn"). Tool resolves to User ID automatically.',
        },
        owner_id: {
          type: 'string',
          description: 'Filter to a specific rep by Salesforce User ID (optional — use owner_name if name is known).',
        },
        days: {
          type: 'number',
          description: 'Look-back period in days for closed won/lost counts (default: 90)',
        },
        stale_days: {
          type: 'number',
          description: 'Flag proposals and scheduled consults not touched in this many days (default: 21)',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schema ─────────────────────────────────────────────────────────────

const RepFunnelArgs = z.object({
  owner_name:  z.string().optional(),
  owner_id:    z.string().optional(),
  days:        z.number().min(7).max(365).default(90),
  stale_days:  z.number().min(7).max(90).default(21),
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface SFUser { Id: string; Name: string; }

interface SFLeadActive {
  Id: string;
  OwnerId: string;
  Owner?: { Name?: string };
  Sales_Rep__c?: string;
  Sales_Rep__r?: { Name?: string };
  Status: string;
  CreatedDate: string;
  LastActivityDate?: string;
}

interface SFNewLeadCount {
  OwnerId: string;
  expr0?: number;  // COUNT(Id) with no alias → expr0
  total?: number;  // COUNT(Id) with alias 'total' — SOQL returns whichever
}

interface SFOpp {
  Id: string;
  OwnerId: string;
  Owner?: { Name?: string };
  StageName: string;
  Amount?: number;
  LastModifiedDate: string;
  CloseDate?: string;
  Days_In_Current_Stage__c?: number;
}

interface RepFunnelRow {
  repId: string;
  repName: string;
  // Lead funnel stages
  newLeadCount: number;      // Status = 'New' (aggregate count)
  contacted: number;         // Lead Contacted + No Contact
  consultScheduled: number;  // New Consult Scheduled (Lead) + Strategy Call Scheduled (Opp)
  consultHeld: number;       // New Consult Completed (Lead) + Strategy Call Held (Opp)
  qualified: number;         // Qualified leads (ready for Opp creation)
  standBy: number;           // Stand By (Lead) + Nurture (Opp)
  // Opp funnel stages
  proposalOut: number;       // Proposal + Negotiation stages
  proposalValue: number;
  orderForms: number;        // Order Forms (nearly closed)
  orderFormsValue: number;
  // Period performance
  closedWon: number;
  closedWonValue: number;
  closedLost: number;
  // Stale flags
  staleProposals: number;
  staleConsults: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(iso: string | undefined): number {
  if (!iso) return 9999;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '—';
  return `${Math.round((num / denom) * 100)}%`;
}

function statusIcon(rate: number, target: number): string {
  if (rate >= target) return '✅';
  if (rate >= target * 0.85) return '⚠️';
  return '🚨';
}

function fmt$(amount: number): string {
  if (amount === 0) return '—';
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000)    return `$${Math.round(amount / 1_000)}K`;
  return `$${amount.toLocaleString()}`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleRepFunnel(rawArgs: unknown): Promise<string> {
  const { owner_name, owner_id: rawOwnerId, days, stale_days } = RepFunnelArgs.parse(rawArgs ?? {});

  // Resolve owner_name → owner_id
  let owner_id = rawOwnerId;
  let resolvedName: string | undefined;

  if (owner_name && !owner_id) {
    const escaped = owner_name.replace(/'/g, "\\'");
    const users = await salesforceService.rawQuery<SFUser>(
      `SELECT Id, Name FROM User WHERE Name LIKE '%${escaped}%' AND IsActive = true LIMIT 5`
    );
    if (users.length === 0) {
      return `❌ No active Salesforce user found matching "${owner_name}". Check spelling and try again.`;
    }
    if (users.length > 1) {
      return `⚠️ Multiple matches for "${owner_name}":\n${users.map(u => `- ${u.Name} (${u.Id})`).join('\n')}\n\nRe-run with the exact name or use owner_id.`;
    }
    owner_id = users[0].Id;
    resolvedName = users[0].Name;
  }

  // ── Build SOQL filters ────────────────────────────────────────────────────

  // Lead filter — use Sales_Rep__c OR OwnerId for detailed queries
  const leadFilter = owner_id
    ? `AND (OwnerId = '${owner_id}' OR Sales_Rep__c = '${owner_id}')`
    : `AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`;

  // Opp filter — OwnerId only
  const oppFilter = owner_id
    ? `AND OwnerId = '${owner_id}'`
    : `AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`;

  // New lead aggregate filter — OwnerId only (OR not supported in GROUP BY query)
  const newLeadFilter = owner_id
    ? `AND OwnerId = '${owner_id}'`
    : `AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`;

  // ── Parallel queries ──────────────────────────────────────────────────────

  const [activeLeads, newLeadCounts, openOpps, closedOpps] = await Promise.all([

    // Active working leads (excludes raw "New" — handled by aggregate below)
    salesforceService.rawQuery<SFLeadActive>(
      `SELECT Id, OwnerId, Owner.Name, Sales_Rep__c, Sales_Rep__r.Name,
              Status, CreatedDate, LastActivityDate
       FROM Lead
       WHERE IsConverted = false
         AND Status IN ('Lead Contacted', 'No Contact',
                        'New Consult Scheduled', 'New Consult Completed',
                        'Qualified', 'Stand By')
         ${leadFilter}
       ORDER BY OwnerId
       LIMIT 3000`
    ),

    // Count "New" status leads by owner (aggregate — avoids pulling 33k records)
    // Note: SOQL returns COUNT(Id) as field 'expr0' when no alias is used
    salesforceService.rawQuery<SFNewLeadCount>(
      `SELECT OwnerId, COUNT(Id)
       FROM Lead
       WHERE IsConverted = false
         AND Status = 'New'
         ${newLeadFilter}
       GROUP BY OwnerId`
    ).catch(() => [] as SFNewLeadCount[]),

    // All open opportunities
    salesforceService.rawQuery<SFOpp>(
      `SELECT Id, OwnerId, Owner.Name, StageName, Amount,
              LastModifiedDate, CloseDate, Days_In_Current_Stage__c
       FROM Opportunity
       WHERE IsClosed = false
         ${oppFilter}
       ORDER BY OwnerId
       LIMIT 1000`
    ),

    // Closed won/lost this period
    salesforceService.rawQuery<SFOpp>(
      `SELECT Id, OwnerId, Owner.Name, StageName, Amount, CloseDate
       FROM Opportunity
       WHERE CloseDate >= LAST_N_DAYS:${days}
         AND StageName IN ('Closed Won', 'Closed Lost')
         ${oppFilter}
       ORDER BY CloseDate DESC
       LIMIT 500`
    ),
  ]);

  // ── Build per-rep rows ────────────────────────────────────────────────────

  const repMap = new Map<string, RepFunnelRow>();

  function getOrCreate(repId: string, repName: string): RepFunnelRow {
    if (!repMap.has(repId)) {
      repMap.set(repId, {
        repId, repName,
        newLeadCount: 0,
        contacted: 0, consultScheduled: 0, consultHeld: 0, qualified: 0, standBy: 0,
        proposalOut: 0, proposalValue: 0,
        orderForms: 0, orderFormsValue: 0,
        closedWon: 0, closedWonValue: 0, closedLost: 0,
        staleProposals: 0, staleConsults: 0,
      });
    }
    return repMap.get(repId)!;
  }

  // Seed new lead counts (ID-only rows — names resolved later)
  // SOQL returns aggregate COUNT as expr0 (no alias) or 'total' (with alias) — handle both
  for (const row of newLeadCounts) {
    const count = row.expr0 ?? row.total ?? 0;
    if (count === 0) continue;
    const r = getOrCreate(row.OwnerId, row.OwnerId); // placeholder name
    r.newLeadCount += count;
  }

  // Active leads
  for (const lead of activeLeads) {
    // Use Sales_Rep__c owner if set and different from OwnerId
    const repId   = lead.Sales_Rep__c ?? lead.OwnerId;
    const repName = (lead.Sales_Rep__r as { Name?: string } | undefined)?.Name
                  ?? (lead.Owner as { Name?: string } | undefined)?.Name
                  ?? repId;

    const r = getOrCreate(repId, repName);
    if (r.repName === repId) r.repName = repName; // resolve placeholder

    const staleDays = daysSince(lead.LastActivityDate ?? lead.CreatedDate);

    switch (lead.Status) {
      case 'Lead Contacted':
      case 'No Contact':
        r.contacted++;
        break;
      case 'New Consult Scheduled':
        r.consultScheduled++;
        if (staleDays >= stale_days) r.staleConsults++;
        break;
      case 'New Consult Completed':
        r.consultHeld++;
        break;
      case 'Qualified':
        r.qualified++;
        break;
      case 'Stand By':
        r.standBy++;
        break;
    }
  }

  // Open opportunities
  for (const opp of openOpps) {
    const repId   = opp.OwnerId;
    const repName = (opp.Owner as { Name?: string } | undefined)?.Name ?? repId;
    const r = getOrCreate(repId, repName);
    if (r.repName === repId) r.repName = repName;

    const staleDays = opp.Days_In_Current_Stage__c != null && opp.Days_In_Current_Stage__c > 0
      ? opp.Days_In_Current_Stage__c
      : daysSince(opp.LastModifiedDate);
    const amt = opp.Amount ?? 0;

    switch (opp.StageName) {
      case 'Strategy Call Scheduled':
        r.consultScheduled++;
        if (staleDays >= stale_days) r.staleConsults++;
        break;
      case 'Strategy Call Held':
        r.consultHeld++;
        break;
      case 'Proposal':
      case 'Negotiation':
        r.proposalOut++;
        r.proposalValue += amt;
        if (staleDays >= stale_days) r.staleProposals++;
        break;
      case 'Order Forms':
        r.orderForms++;
        r.orderFormsValue += amt;
        break;
      case 'Nurture':
        r.standBy++;
        break;
      // 'Expired', '2025', 'Drop In', 'New' → intentionally excluded from funnel
    }
  }

  // Closed opps (period performance)
  for (const opp of closedOpps) {
    const repId   = opp.OwnerId;
    const repName = (opp.Owner as { Name?: string } | undefined)?.Name ?? repId;
    const r = getOrCreate(repId, repName);
    if (r.repName === repId) r.repName = repName;

    if (opp.StageName === 'Closed Won') {
      r.closedWon++;
      r.closedWonValue += opp.Amount ?? 0;
    } else {
      r.closedLost++;
    }
  }

  // Resolve any remaining placeholder names (from newLeadCounts with no other records)
  const placeholders = [...repMap.entries()]
    .filter(([id, row]) => row.repName === id)
    .map(([id]) => id);

  if (placeholders.length > 0) {
    const idList = placeholders.map(id => `'${id}'`).join(', ');
    const users = await salesforceService.rawQuery<SFUser>(
      `SELECT Id, Name FROM User WHERE Id IN (${idList})`
    ).catch(() => [] as SFUser[]);
    for (const u of users) {
      const row = repMap.get(u.Id);
      if (row) row.repName = u.Name;
    }
  }

  // ── Sort: highest pipeline value first ───────────────────────────────────

  const reps = [...repMap.values()].sort(
    (a, b) => (b.proposalValue + b.orderFormsValue + b.closedWonValue)
              - (a.proposalValue + a.orderFormsValue + a.closedWonValue)
  );

  if (reps.length === 0) {
    return `# 📊 Rep Funnel Dashboard\n\nNo data found. ${owner_id ? 'No active pipeline for this rep.' : 'Check filters.'}`;
  }

  // ── Build output ──────────────────────────────────────────────────────────

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const lines: string[] = [];

  lines.push(`# 📊 Rep Funnel Dashboard`);
  lines.push(`**${today}**`);
  if (resolvedName) lines.push(`**Rep:** ${resolvedName}`);
  lines.push(`*Pipeline snapshot + last ${days}-day closes · Targets: ${Math.round(TARGETS.bookingRate * 100)}% booking · ${Math.round(TARGETS.showRate * 100)}% show · ${Math.round(TARGETS.closeRate * 100)}% close*`);
  lines.push('');

  // ── Summary table (all reps at a glance) ─────────────────────────────────

  if (reps.length > 1) {
    lines.push(`## Summary`);
    lines.push('');
    lines.push(`| Rep | New | Contacted | Sched | Held | Qualified | Proposals | Order Forms | Won (${days}d) | Pipeline |`);
    lines.push(`|---|---|---|---|---|---|---|---|---|---|`);

    for (const r of reps) {
      const pipeline = r.proposalValue + r.orderFormsValue;
      lines.push(
        `| ${r.repName} | ${r.newLeadCount || '—'} | ${r.contacted || '—'} | ` +
        `${r.consultScheduled || '—'} | ${r.consultHeld || '—'} | ${r.qualified || '—'} | ` +
        `${r.proposalOut || '—'} | ${r.orderForms || '—'} | ` +
        `${r.closedWon || '—'} | ${fmt$(pipeline)} |`
      );
    }
    lines.push('');
  }

  // ── Totals ────────────────────────────────────────────────────────────────

  const totals = reps.reduce(
    (acc, r) => ({
      newLeadCount:   acc.newLeadCount + r.newLeadCount,
      contacted:      acc.contacted + r.contacted,
      consultSched:   acc.consultSched + r.consultScheduled,
      consultHeld:    acc.consultHeld + r.consultHeld,
      qualified:      acc.qualified + r.qualified,
      proposals:      acc.proposals + r.proposalOut,
      proposalValue:  acc.proposalValue + r.proposalValue,
      orderForms:     acc.orderForms + r.orderForms,
      orderValue:     acc.orderValue + r.orderFormsValue,
      closedWon:      acc.closedWon + r.closedWon,
      closedWonValue: acc.closedWonValue + r.closedWonValue,
      closedLost:     acc.closedLost + r.closedLost,
    }),
    { newLeadCount: 0, contacted: 0, consultSched: 0, consultHeld: 0, qualified: 0,
      proposals: 0, proposalValue: 0, orderForms: 0, orderValue: 0,
      closedWon: 0, closedWonValue: 0, closedLost: 0 }
  );

  if (reps.length > 1) {
    const totalPipeline = totals.proposalValue + totals.orderValue;
    const totalExpected = Math.round(totals.proposals * TARGETS.closeRate);

    lines.push(`## 🏢 Total Pipeline (All Reps)`);
    lines.push(`| Stage | Count | Value |`);
    lines.push(`|---|---|---|`);
    lines.push(`| 📥 New (unworked) | ${totals.newLeadCount.toLocaleString()} | — |`);
    lines.push(`| 📞 In Contact | ${totals.contacted} | — |`);
    lines.push(`| 📅 Consult Scheduled | ${totals.consultSched} | — |`);
    lines.push(`| ✅ Consult Held | ${totals.consultHeld} | — |`);
    lines.push(`| 🎯 Qualified | ${totals.qualified} | — |`);
    lines.push(`| 📋 Proposals Out | ${totals.proposals} | ${fmt$(totals.proposalValue)} |`);
    lines.push(`| ⏳ Order Forms | ${totals.orderForms} | ${fmt$(totals.orderValue)} |`);
    lines.push(`| 🏆 Closed Won (${days}d) | ${totals.closedWon} | ${fmt$(totals.closedWonValue)} |`);
    lines.push(`| ❌ Closed Lost (${days}d) | ${totals.closedLost} | — |`);
    lines.push('');
    lines.push(`**Total open pipeline:** ${fmt$(totalPipeline)} | **Expected closes:** ~${totalExpected} deals × 30%`);
    lines.push('');
  }

  // ── Per-rep detail ────────────────────────────────────────────────────────

  for (const r of reps) {
    lines.push(`---`);
    lines.push(`## ${r.repName}`);
    lines.push('');

    // Current pipeline
    lines.push(`### Pipeline`);
    lines.push(`| Stage | Count | Value |`);
    lines.push(`|---|---|---|`);

    if (r.newLeadCount > 0)
      lines.push(`| 📥 New (unworked) | ${r.newLeadCount.toLocaleString()} | — |`);
    if (r.contacted > 0)
      lines.push(`| 📞 In Contact | ${r.contacted} | — |`);
    if (r.consultScheduled > 0)
      lines.push(`| 📅 Consult Scheduled | ${r.consultScheduled}${r.staleConsults > 0 ? ` *(${r.staleConsults} stale)*` : ''} | — |`);
    if (r.consultHeld > 0)
      lines.push(`| ✅ Consult Held | ${r.consultHeld} | — |`);
    if (r.qualified > 0)
      lines.push(`| 🎯 Qualified (no Opp yet) | ${r.qualified} | — |`);
    if (r.proposalOut > 0)
      lines.push(`| 📋 Proposal Out | ${r.proposalOut}${r.staleProposals > 0 ? ` *(${r.staleProposals} stale)*` : ''} | ${fmt$(r.proposalValue)} |`);
    if (r.orderForms > 0)
      lines.push(`| ⏳ Order Forms (closing) | ${r.orderForms} | ${fmt$(r.orderFormsValue)} |`);
    if (r.closedWon > 0)
      lines.push(`| 🏆 Closed Won (last ${days}d) | ${r.closedWon} | ${fmt$(r.closedWonValue)} |`);
    if (r.closedLost > 0)
      lines.push(`| ❌ Closed Lost (last ${days}d) | ${r.closedLost} | — |`);
    if (r.standBy > 0)
      lines.push(`| 🌱 Nurture / Stand By | ${r.standBy} | — |`);
    lines.push('');

    // Conversion rates
    const hasRates = (r.contacted + r.consultScheduled + r.consultHeld > 0) ||
                     (r.closedWon + r.closedLost > 0);

    if (hasRates) {
      lines.push(`### Conversion Rates`);
      lines.push(`| Metric | Rate | Target | |`);
      lines.push(`|---|---|---|---|`);

      // Booking rate — how many contacted leads got a consult scheduled
      const bookingDenom = r.contacted + r.consultScheduled + r.consultHeld +
                           r.proposalOut + r.orderForms + r.closedWon;
      const bookingNum   = r.consultScheduled + r.consultHeld +
                           r.proposalOut + r.orderForms + r.closedWon;
      if (bookingDenom > 0) {
        const rate = bookingNum / bookingDenom;
        lines.push(`| Booking Rate | ${pct(bookingNum, bookingDenom)} | ${Math.round(TARGETS.bookingRate * 100)}% | ${statusIcon(rate, TARGETS.bookingRate)} |`);
      }

      // Show rate — held vs scheduled+held (approximation based on current state)
      const showDenom = r.consultScheduled + r.consultHeld;
      if (showDenom > 0) {
        const rate = r.consultHeld / showDenom;
        lines.push(`| Show Rate | ${pct(r.consultHeld, showDenom)} | ${Math.round(TARGETS.showRate * 100)}% | ${statusIcon(rate, TARGETS.showRate)} |`);
      }

      // Close rate — won / (won + lost) for the period
      const closeDenom = r.closedWon + r.closedLost;
      if (closeDenom > 0) {
        const rate = r.closedWon / closeDenom;
        lines.push(`| Close Rate (${days}d) | ${pct(r.closedWon, closeDenom)} | ${Math.round(TARGETS.closeRate * 100)}% | ${statusIcon(rate, TARGETS.closeRate)} |`);
      }
      lines.push('');
    }

    // Pipeline forecast
    if (r.proposalOut > 0 || r.orderForms > 0) {
      const expectedDeals   = Math.round(r.proposalOut * TARGETS.closeRate);
      const expectedRevenue = Math.round(r.proposalValue * TARGETS.closeRate);

      lines.push(`### Pipeline Forecast`);
      lines.push(`- **${r.proposalOut}** open proposals × ${Math.round(TARGETS.closeRate * 100)}% → **~${expectedDeals} projected closes**`);
      if (r.proposalValue > 0) {
        lines.push(`- Projected revenue from proposals: **${fmt$(expectedRevenue)}**`);
      }
      if (r.orderForms > 0) {
        lines.push(`- **${r.orderForms}** at Order Forms (final stage) — ${fmt$(r.orderFormsValue)} nearly closed`);
      }
      lines.push('');
    }

    // Attention items
    const alerts: string[] = [];
    if (r.staleProposals > 0)
      alerts.push(`**${r.staleProposals}** proposal${r.staleProposals === 1 ? '' : 's'} — no movement in ${stale_days}+ days → follow up or close`);
    if (r.staleConsults > 0)
      alerts.push(`**${r.staleConsults}** consult${r.staleConsults === 1 ? '' : 's'} scheduled — stale ${stale_days}+ days → confirm or reschedule`);
    if (r.qualified > 0)
      alerts.push(`**${r.qualified}** lead${r.qualified === 1 ? '' : 's'} marked Qualified — no Opportunity created yet → convert or disqualify`);

    if (alerts.length > 0) {
      lines.push(`### ⚠️ Needs Attention`);
      for (const a of alerts) lines.push(`- ${a}`);
      lines.push('');
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────

  lines.push(`---`);
  lines.push(`*Generated ${new Date().toLocaleString()} | Prophet by PDM*`);
  lines.push(`*M-One Capital targets: ${Math.round(TARGETS.bookingRate * 100)}% booking · ${Math.round(TARGETS.showRate * 100)}% show · ${Math.round(TARGETS.closeRate * 100)}% close rate*`);
  lines.push(`*Recirculation rules: 60d without proposal → back to working | 6mo post-proposal without close → re-engage*`);

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const salesFunnelHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_rep_funnel: handleRepFunnel,
};
