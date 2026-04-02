// ─────────────────────────────────────────────────────────────────────────────
// Opportunity Lifecycle Management — Prophet by PDM
//
// sf_get_opportunity_lifecycle
//   Full funnel report: Lead → Closed Won/Lost/Expired with conversion rates,
//   stage velocity, win/loss analysis, and rep performance benchmarks.
//   Uses OpportunityFieldHistory for historical stage transitions,
//   Lead date track fields for pre-opportunity funnel, and live Opportunity
//   stage data for current pipeline health.
//
// Data sources:
//   - Lead: Date track fields (Lead_Contact_Date__c, Stage_Scheduled_Consult__c,
//           Stage_Consult_Held_Date__c, Date_of_Actual_New_Consult__c, ConvertedDate)
//   - Opportunity: StageName, Stage_Entry_Date__c, Days_in_Current_Stage__c,
//                  LastStageChangeDate, LastStageChangeInDays, Phase__c
//   - OpportunityFieldHistory: Stage transitions with timestamps
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const WILLIAM_SUMMERS_USER_ID = '005PU000001eUQDYA2';

/** Ordered funnel stages — canonical PDM sales process */
const STAGE_ORDER = [
  'New',
  'Nurture',
  'Strategy Call Scheduled',
  'Strategy Call Held',
  'Proposal',
  'Negotiation',
  'Order Forms',
  'Closed Won',
  'Closed Lost',
  'Expired',
] as const;

/** Active stages (not terminal) */
const ACTIVE_STAGES = ['New', 'Nurture', 'Strategy Call Scheduled', 'Strategy Call Held', 'Proposal', 'Negotiation', 'Order Forms'];

/** Terminal stages */
const TERMINAL_STAGES = ['Closed Won', 'Closed Lost', 'Expired'];

/** Lead funnel stages with their date track fields */
const LEAD_FUNNEL_FIELDS = [
  { label: 'Created',             field: 'CreatedDate' },
  { label: 'Contacted',           field: 'Lead_Contact_Date__c' },
  { label: 'Consult Scheduled',   field: 'Stage_Scheduled_Consult__c' },
  { label: 'Consult Actual',      field: 'Date_of_Actual_New_Consult__c' },
  { label: 'Consult Completed',   field: 'Stage_Consult_Held_Date__c' },
  { label: 'Converted',           field: 'ConvertedDate' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface SFUser {
  Id: string;
  Name: string;
}

interface SFLead {
  Id: string;
  Name: string;
  Status?: string;
  OwnerId?: string;
  Owner?: { Name: string };
  CreatedDate?: string;
  Lead_Contact_Date__c?: string;
  Stage_Scheduled_Consult__c?: string;
  Date_of_Actual_New_Consult__c?: string;
  Stage_Consult_Held_Date__c?: string;
  ConvertedDate?: string;
  nwcs_ldl__ConvertedDateTime__c?: string;
  IsConverted?: boolean;
  ConvertedOpportunityId?: string;
  ConvertedAccountId?: string;
  LeadSource?: string;
}

interface SFOpportunity {
  Id: string;
  Name: string;
  StageName?: string;
  CloseDate?: string;
  Amount?: number;
  Phase__c?: string;
  CreatedDate?: string;
  LastModifiedDate?: string;
  LastStageChangeDate?: string;
  LastStageChangeInDays?: number;
  Stage_Entry_Date__c?: string;
  Days_in_Current_Stage__c?: number;
  IsClosed?: boolean;
  IsWon?: boolean;
  OwnerId?: string;
  Owner?: { Name: string };
  AccountId?: string;
  Account?: { Name: string };
  Probability?: number;
  LeadSource?: string;
  StageSortKey?: number;
}

interface StageHistory {
  Id: string;
  OpportunityId: string;
  Field: string;
  OldValue?: string;
  NewValue?: string;
  CreatedDate: string;
}

interface SFSalesOrder {
  Id: string;
  Name?: string;
  AccountId__c?: string;
  AccountId__r?: { Name: string };
  Phase_2_Opportunity__c?: string;
  Status__c?: string;
  Sales_Order_Type__c?: string;
  Recurring_Amount__c?: number;
  One_Time_Amount__c?: number;
  TCI_Amount__c?: number;
  Signature_Date__c?: string;
  Proposal_Sent_Date__c?: string;
  CreatedDate?: string;
  OwnerId?: string;
  Owner?: { Name: string };
}

/** Cluster gap threshold in days — SOs/Opps created further apart than this are separate sales cycles */
const SIBLING_CLUSTER_DAYS = 45;

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const opportunityLifecycleTools: Tool[] = [
  {
    name: 'sf_get_opportunity_lifecycle',
    description:
      'Full sales funnel report: Lead-to-Close lifecycle with conversion rates, stage velocity, ' +
      'win/loss analysis, and rep performance benchmarks. ' +
      'Covers both the Lead funnel (Created → Contacted → Consult Scheduled → Consult Completed → Converted) ' +
      'and the Opportunity funnel (New → Nurture → Strategy Call → Proposal → Negotiation → Order Forms → Closed). ' +
      'Uses OpportunityFieldHistory for historical stage transitions and Lead date track fields for pre-Opp funnel. ' +
      'Use when asked about "funnel metrics", "conversion rates", "stage velocity", "win rate", ' +
      '"pipeline analysis", "lifecycle report", "how long do deals take", "rep performance", ' +
      '"lead to close", or "opportunity lifecycle".',
    inputSchema: {
      type: 'object',
      properties: {
        owner_name: {
          type: 'string',
          description: 'Filter by rep name (fuzzy match). Omit for all reps.',
        },
        owner_id: {
          type: 'string',
          description: 'Filter by Salesforce User ID. Use owner_name instead if possible.',
        },
        days_back: {
          type: 'number',
          description: 'How far back to analyze (default: 180 days)',
        },
        phase: {
          type: 'string',
          description: 'Filter opportunities by Phase__c (e.g. "Phase 2", "TCI Events")',
        },
      },
    },
  },
];

// ─── Args Schema ──────────────────────────────────────────────────────────────

const LifecycleArgs = z.object({
  owner_name: z.string().optional(),
  owner_id: z.string().optional(),
  days_back: z.number().min(7).max(730).default(180),
  phase: z.string().optional(),
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function daysBetween(d1: string | undefined, d2: string | undefined): number | null {
  if (!d1 || !d2) return null;
  const ms = new Date(d2).getTime() - new Date(d1).getTime();
  return Math.round(ms / 86_400_000);
}

function daysSince(dateStr: string | undefined): number {
  if (!dateStr) return 9999;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000));
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function currency(amount: number | undefined | null): string {
  if (amount == null) return '$0';
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function stageIdx(stage: string | undefined): number {
  if (!stage) return -1;
  return STAGE_ORDER.indexOf(stage as typeof STAGE_ORDER[number]);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleOpportunityLifecycle(rawArgs: unknown): Promise<string> {
  const args = LifecycleArgs.parse(rawArgs ?? {});
  const { days_back, phase } = args;
  let { owner_id } = args;

  // ── Resolve owner name → ID ───────────────────────────────────────────────
  let resolvedName: string | undefined;
  if (args.owner_name && !owner_id) {
    const users = await salesforceService.rawQuery<SFUser>(
      `SELECT Id, Name FROM User WHERE Name LIKE '%${args.owner_name.replace(/'/g, "\\'")}%' AND IsActive = true LIMIT 5`
    );
    if (users.length === 1) {
      owner_id = users[0].Id;
      resolvedName = users[0].Name;
    } else if (users.length > 1) {
      return `Multiple users match "${args.owner_name}": ${users.map(u => `${u.Name} (${u.Id})`).join(', ')}. Please be more specific.`;
    } else {
      return `No active user found matching "${args.owner_name}".`;
    }
  }

  const ownerFilter = owner_id ? `AND OwnerId = '${owner_id}'` : '';
  const ownerFilterWhere = owner_id ? `WHERE OwnerId = '${owner_id}'` : '';
  const dateFilter = `LAST_N_DAYS:${days_back}`;
  const phaseFilter = phase ? `AND Phase__c = '${phase.replace(/'/g, "\\'")}'` : '';

  // ── Parallel queries ──────────────────────────────────────────────────────
  const [leads, opportunities, stageHistory, allReps, salesOrders] = await Promise.all([
    // 1. Leads with date track fields
    salesforceService.rawQuery<SFLead>(
      `SELECT Id, Name, Status, OwnerId, Owner.Name, CreatedDate,
              Lead_Contact_Date__c, Stage_Scheduled_Consult__c,
              Date_of_Actual_New_Consult__c, Stage_Consult_Held_Date__c,
              ConvertedDate, nwcs_ldl__ConvertedDateTime__c, IsConverted,
              ConvertedOpportunityId, LeadSource
       FROM Lead
       WHERE CreatedDate >= ${dateFilter}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         ${ownerFilter}
       ORDER BY CreatedDate DESC
       LIMIT 5000`
    ),

    // 2. Opportunities with stage and velocity data
    salesforceService.rawQuery<SFOpportunity>(
      `SELECT Id, Name, StageName, CloseDate, Amount, Phase__c,
              CreatedDate, LastModifiedDate, LastStageChangeDate,
              LastStageChangeInDays, Stage_Entry_Date__c,
              Days_in_Current_Stage__c,
              IsClosed, IsWon, OwnerId, Owner.Name,
              AccountId, Account.Name, Probability, LeadSource
       FROM Opportunity
       WHERE CreatedDate >= ${dateFilter}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         ${ownerFilter}
         ${phaseFilter}
       ORDER BY CreatedDate DESC
       LIMIT 5000`
    ),

    // 3. Stage history for velocity calculation
    salesforceService.rawQuery<StageHistory>(
      `SELECT Id, OpportunityId, Field, OldValue, NewValue, CreatedDate
       FROM OpportunityFieldHistory
       WHERE Field = 'StageName'
         AND CreatedDate >= ${dateFilter}
       ORDER BY CreatedDate ASC
       LIMIT 10000`
    ),

    // 4. Active reps (for leaderboard)
    owner_id
      ? Promise.resolve([] as SFUser[])
      : salesforceService.rawQuery<SFUser>(
          `SELECT Id, Name FROM User
           WHERE IsActive = true
             AND Id != '${WILLIAM_SUMMERS_USER_ID}'
             AND UserRole.Name IN ('Sales Execs', 'Practice Growth Advisor', 'CEO', 'System Administrator')
           ORDER BY Name`
        ),

    // 5. Sales Orders — for sibling proposal detection
    salesforceService.rawQuery<SFSalesOrder>(
      `SELECT Id, Name, AccountId__c, AccountId__r.Name,
              Phase_2_Opportunity__c, Status__c, Sales_Order_Type__c,
              Recurring_Amount__c, One_Time_Amount__c, TCI_Amount__c,
              Signature_Date__c, Proposal_Sent_Date__c, CreatedDate,
              OwnerId, Owner.Name
       FROM SalesOrder__c
       WHERE CreatedDate >= ${dateFilter}
       ORDER BY CreatedDate ASC
       LIMIT 5000`
    ),
  ]);

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Lead Funnel Analysis
  // ══════════════════════════════════════════════════════════════════════════

  const totalLeads = leads.length;
  const contacted = leads.filter(l => l.Lead_Contact_Date__c);
  const consultScheduled = leads.filter(l => l.Stage_Scheduled_Consult__c);
  const consultActual = leads.filter(l => l.Date_of_Actual_New_Consult__c);
  const consultCompleted = leads.filter(l => l.Stage_Consult_Held_Date__c);
  const converted = leads.filter(l => l.IsConverted);

  // Speed calculations
  const speedToContact: number[] = [];
  for (const l of contacted) {
    const d = daysBetween(l.CreatedDate, l.Lead_Contact_Date__c);
    if (d != null && d >= 0 && d < 365) speedToContact.push(d);
  }

  const contactToConsult: number[] = [];
  for (const l of consultScheduled) {
    const d = daysBetween(l.Lead_Contact_Date__c, l.Stage_Scheduled_Consult__c);
    if (d != null && d >= 0 && d < 365) contactToConsult.push(d);
  }

  const scheduledToActual: number[] = [];
  for (const l of consultActual) {
    const d = daysBetween(l.Stage_Scheduled_Consult__c, l.Date_of_Actual_New_Consult__c);
    if (d != null && d >= 0 && d < 365) scheduledToActual.push(d);
  }

  const consultToConvert: number[] = [];
  for (const l of converted) {
    const d = daysBetween(l.Stage_Consult_Held_Date__c ?? l.Date_of_Actual_New_Consult__c, l.ConvertedDate);
    if (d != null && d >= 0 && d < 365) consultToConvert.push(d);
  }

  const totalLifecycleDays: number[] = [];
  for (const l of converted) {
    const d = daysBetween(l.CreatedDate, l.ConvertedDate);
    if (d != null && d >= 0 && d < 730) totalLifecycleDays.push(d);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Opportunity Stage Analysis
  // ══════════════════════════════════════════════════════════════════════════

  const closedWon = opportunities.filter(o => o.IsWon === true);
  const closedLost = opportunities.filter(o => o.IsClosed && !o.IsWon && o.StageName === 'Closed Lost');
  const expired = opportunities.filter(o => o.StageName === 'Expired');
  const openOpps = opportunities.filter(o => !o.IsClosed);

  // Stage distribution
  const stageCounts: Record<string, number> = {};
  const stageAmounts: Record<string, number> = {};
  for (const o of opportunities) {
    const s = o.StageName ?? 'Unknown';
    stageCounts[s] = (stageCounts[s] ?? 0) + 1;
    stageAmounts[s] = (stageAmounts[s] ?? 0) + (o.Amount ?? 0);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Stage Velocity from History
  // ══════════════════════════════════════════════════════════════════════════

  // Group history by opportunity
  const historyByOpp = new Map<string, StageHistory[]>();
  for (const h of stageHistory) {
    const arr = historyByOpp.get(h.OpportunityId) ?? [];
    arr.push(h);
    historyByOpp.set(h.OpportunityId, arr);
  }

  // Calculate time in each stage
  const stageVelocity: Record<string, number[]> = {};
  for (const [oppId, history] of historyByOpp) {
    // Find the opp to get its CreatedDate
    const opp = opportunities.find(o => o.Id === oppId);
    if (!opp) continue;

    // Build a timeline: creation → stage1 → stage2 → ...
    const timeline: { stage: string; enteredAt: string }[] = [];

    // First stage = whatever it was before the first change, entered at CreatedDate
    if (history.length > 0 && history[0].OldValue) {
      timeline.push({ stage: history[0].OldValue, enteredAt: opp.CreatedDate ?? history[0].CreatedDate });
    }

    for (const h of history) {
      if (h.NewValue) {
        timeline.push({ stage: h.NewValue, enteredAt: h.CreatedDate });
      }
    }

    // Calculate duration for each stage transition
    for (let i = 0; i < timeline.length - 1; i++) {
      const stage = timeline[i].stage;
      const days = daysBetween(timeline[i].enteredAt, timeline[i + 1].enteredAt);
      if (days != null && days >= 0 && days < 365) {
        if (!stageVelocity[stage]) stageVelocity[stage] = [];
        stageVelocity[stage].push(days);
      }
    }

    // For the last/current stage, calculate time from entry to now (if open)
    if (timeline.length > 0 && !opp.IsClosed) {
      const last = timeline[timeline.length - 1];
      const days = daysSince(last.enteredAt);
      if (days >= 0 && days < 365) {
        if (!stageVelocity[last.stage]) stageVelocity[last.stage] = [];
        stageVelocity[last.stage].push(days);
      }
    }
  }

  // Closed Won velocity: Created → Closed Won
  const wonVelocity: number[] = [];
  for (const o of closedWon) {
    const d = daysBetween(o.CreatedDate, o.CloseDate ?? o.LastModifiedDate);
    if (d != null && d >= 0 && d < 730) wonVelocity.push(d);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Sibling-Aware Deal Cycle Analysis
  //
  // Sales Reps create multiple Sales Orders (pricing tiers) for the same
  // Account before events. One signature = the deal. The others aren't losses.
  // We cluster Opps by AccountId + 45-day creation window to identify siblings,
  // then calculate win/loss per DEAL CYCLE, not per Opp.
  //
  // Primary method: Use SalesOrder__c.Phase_2_Opportunity__c to link SOs → Opps
  // Fallback: Cluster Opps by AccountId + CreatedDate gap
  // ══════════════════════════════════════════════════════════════════════════

  // ── Step 1: Build Sales Order → Opportunity mapping ─────────────────────
  const soByOppId = new Map<string, SFSalesOrder>();
  const sosByAccount = new Map<string, SFSalesOrder[]>();
  for (const so of salesOrders) {
    if (so.Phase_2_Opportunity__c) {
      soByOppId.set(so.Phase_2_Opportunity__c, so);
    }
    if (so.AccountId__c) {
      const arr = sosByAccount.get(so.AccountId__c) ?? [];
      arr.push(so);
      sosByAccount.set(so.AccountId__c, arr);
    }
  }

  // ── Step 2: Cluster Opps into Deal Cycles ───────────────────────────────
  interface DealCycle {
    accountId: string;
    accountName: string;
    opps: SFOpportunity[];
    salesOrders: SFSalesOrder[];
    outcome: 'won' | 'lost' | 'open';
    winningOpp?: SFOpportunity;
    winningAmount: number;
    totalProposalCount: number;
    siblingCount: number;
  }

  // Group Opps by AccountId
  const oppsByAccount = new Map<string, SFOpportunity[]>();
  for (const o of opportunities) {
    if (!o.AccountId) continue;
    const arr = oppsByAccount.get(o.AccountId) ?? [];
    arr.push(o);
    oppsByAccount.set(o.AccountId, arr);
  }

  const dealCycles: DealCycle[] = [];

  for (const [accountId, acctOpps] of oppsByAccount) {
    // Sort by CreatedDate ascending
    const sorted = [...acctOpps].sort((a, b) =>
      new Date(a.CreatedDate ?? '').getTime() - new Date(b.CreatedDate ?? '').getTime()
    );

    // Cluster by 45-day gap
    let currentCluster: SFOpportunity[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(sorted[i - 1].CreatedDate, sorted[i].CreatedDate);
      if (gap != null && gap <= SIBLING_CLUSTER_DAYS) {
        currentCluster.push(sorted[i]);
      } else {
        // Finalize previous cluster
        dealCycles.push(buildDealCycle(accountId, currentCluster, sosByAccount.get(accountId) ?? []));
        currentCluster = [sorted[i]];
      }
    }
    // Finalize last cluster
    dealCycles.push(buildDealCycle(accountId, currentCluster, sosByAccount.get(accountId) ?? []));
  }

  function buildDealCycle(accountId: string, opps: SFOpportunity[], accountSOs: SFSalesOrder[]): DealCycle {
    const acctName = opps[0]?.Account?.Name ?? 'Unknown';
    const hasWon = opps.some(o => o.IsWon);
    const allTerminal = opps.every(o => o.IsClosed);
    const hasOpen = opps.some(o => !o.IsClosed);

    // Find matching Sales Orders (created within the same window as this cluster)
    const clusterStart = opps[0]?.CreatedDate;
    const clusterEnd = opps[opps.length - 1]?.CreatedDate;
    const matchingSOs = accountSOs.filter(so => {
      if (!so.CreatedDate || !clusterStart) return false;
      const soDate = new Date(so.CreatedDate).getTime();
      const startDate = new Date(clusterStart).getTime() - (SIBLING_CLUSTER_DAYS * 86_400_000);
      const endDate = new Date(clusterEnd ?? clusterStart).getTime() + (SIBLING_CLUSTER_DAYS * 86_400_000);
      return soDate >= startDate && soDate <= endDate;
    });

    let outcome: 'won' | 'lost' | 'open';
    let winningOpp: SFOpportunity | undefined;

    if (hasWon) {
      outcome = 'won';
      winningOpp = opps.find(o => o.IsWon);
    } else if (allTerminal) {
      outcome = 'lost';
    } else {
      outcome = 'open';
    }

    // For won deals, use the signed Sales Order amount if available, else the Opp amount
    let winAmount = 0;
    if (winningOpp) {
      const signedSO = matchingSOs.find(so => so.Status__c === 'Signed');
      if (signedSO) {
        winAmount = (signedSO.Recurring_Amount__c ?? 0) + (signedSO.One_Time_Amount__c ?? 0) + (signedSO.TCI_Amount__c ?? 0);
      }
      if (winAmount === 0) {
        winAmount = winningOpp.Amount ?? 0;
      }
    }

    return {
      accountId,
      accountName: acctName,
      opps,
      salesOrders: matchingSOs,
      outcome,
      winningOpp,
      winningAmount: winAmount,
      totalProposalCount: opps.length,
      siblingCount: Math.max(0, opps.length - 1),
    };
  }

  // ── Step 3: Calculate deal-cycle metrics ────────────────────────────────
  const cyclesWon = dealCycles.filter(dc => dc.outcome === 'won');
  const cyclesLost = dealCycles.filter(dc => dc.outcome === 'lost');
  const cyclesOpen = dealCycles.filter(dc => dc.outcome === 'open');
  const totalSiblings = dealCycles.reduce((s, dc) => s + dc.siblingCount, 0);
  const cyclesWithSiblings = dealCycles.filter(dc => dc.siblingCount > 0);

  // Raw Opp counts (for stage distribution — still per-Opp)
  const wonRevenue = closedWon.reduce((sum, o) => sum + (o.Amount ?? 0), 0);
  const lostRevenue = closedLost.reduce((sum, o) => sum + (o.Amount ?? 0), 0);
  const expiredRevenue = expired.reduce((sum, o) => sum + (o.Amount ?? 0), 0);
  const openRevenue = openOpps.reduce((sum, o) => sum + (o.Amount ?? 0), 0);

  // Deal-cycle win rate (the TRUE win rate)
  const closedCycles = cyclesWon.length + cyclesLost.length;
  const dealCycleWinRate = closedCycles > 0 ? (cyclesWon.length / closedCycles) * 100 : 0;
  const dealCycleWonRevenue = cyclesWon.reduce((s, dc) => s + dc.winningAmount, 0);

  // Naive per-Opp win rate (for comparison)
  const naiveWinRate = (closedWon.length + closedLost.length) > 0
    ? (closedWon.length / (closedWon.length + closedLost.length)) * 100 : 0;

  // Lead source analysis (per deal cycle)
  const sourceWins: Record<string, { won: number; total: number; revenue: number }> = {};
  for (const dc of dealCycles) {
    if (dc.outcome === 'open') continue; // only count closed cycles
    const src = dc.opps[0]?.LeadSource ?? 'Unknown';
    if (!sourceWins[src]) sourceWins[src] = { won: 0, total: 0, revenue: 0 };
    sourceWins[src].total++;
    if (dc.outcome === 'won') {
      sourceWins[src].won++;
      sourceWins[src].revenue += dc.winningAmount;
    }
  }

  // Phase analysis (per deal cycle)
  const phaseStats: Record<string, { won: number; lost: number; expired: number; open: number; revenue: number }> = {};
  for (const dc of dealCycles) {
    const p = dc.opps[0]?.Phase__c ?? 'Unknown';
    if (!phaseStats[p]) phaseStats[p] = { won: 0, lost: 0, expired: 0, open: 0, revenue: 0 };
    if (dc.outcome === 'won') { phaseStats[p].won++; phaseStats[p].revenue += dc.winningAmount; }
    else if (dc.outcome === 'lost') phaseStats[p].lost++;
    else phaseStats[p].open++;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Rep Performance (if no owner filter)
  // ══════════════════════════════════════════════════════════════════════════

  interface RepStats {
    name: string;
    dealCyclesWon: number;
    dealCyclesLost: number;
    dealCyclesOpen: number;
    dealCycleWinRate: number;
    naiveWon: number;
    naiveLost: number;
    expired: number;
    revenue: number;
    avgDaysToClose: number;
    leadsContacted: number;
    leadsConverted: number;
    siblingProposals: number;
  }

  const repStats: RepStats[] = [];
  if (!owner_id && allReps.length > 0) {
    for (const rep of allReps) {
      const repOpps = opportunities.filter(o => o.OwnerId === rep.Id);
      if (repOpps.length === 0) continue;

      // Deal-cycle win rate for this rep
      const repCycles = dealCycles.filter(dc =>
        dc.opps.some(o => o.OwnerId === rep.Id)
      );
      const repCyclesWon = repCycles.filter(dc => dc.outcome === 'won');
      const repCyclesLost = repCycles.filter(dc => dc.outcome === 'lost');
      const repCyclesOpen = repCycles.filter(dc => dc.outcome === 'open');
      const repClosedCycles = repCyclesWon.length + repCyclesLost.length;
      const repDealCycleWR = repClosedCycles > 0 ? (repCyclesWon.length / repClosedCycles) * 100 : 0;
      const repSiblings = repCycles.reduce((s, dc) => s + dc.siblingCount, 0);

      // Naive counts (for context)
      const repWon = repOpps.filter(o => o.IsWon);
      const repLost = repOpps.filter(o => o.IsClosed && !o.IsWon && o.StageName === 'Closed Lost');
      const repExpired = repOpps.filter(o => o.StageName === 'Expired');
      const repRevenue = repCyclesWon.reduce((s, dc) => s + dc.winningAmount, 0);

      const repWonDays: number[] = [];
      for (const o of repWon) {
        const d = daysBetween(o.CreatedDate, o.CloseDate ?? o.LastModifiedDate);
        if (d != null && d >= 0) repWonDays.push(d);
      }

      const repLeads = leads.filter(l => l.OwnerId === rep.Id);
      const repContacted = repLeads.filter(l => l.Lead_Contact_Date__c).length;
      const repConverted = repLeads.filter(l => l.IsConverted).length;

      repStats.push({
        name: rep.Name,
        dealCyclesWon: repCyclesWon.length,
        dealCyclesLost: repCyclesLost.length,
        dealCyclesOpen: repCyclesOpen.length,
        dealCycleWinRate: repDealCycleWR,
        naiveWon: repWon.length,
        naiveLost: repLost.length,
        expired: repExpired.length,
        revenue: repRevenue,
        avgDaysToClose: repWonDays.length > 0 ? Math.round(avg(repWonDays)) : 0,
        leadsContacted: repContacted,
        leadsConverted: repConverted,
        siblingProposals: repSiblings,
      });
    }
    repStats.sort((a, b) => b.revenue - a.revenue);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BUILD OUTPUT
  // ══════════════════════════════════════════════════════════════════════════

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const lines: string[] = [];

  lines.push(`# 🔄 Opportunity Lifecycle Report`);
  lines.push(`**${today}** | Last ${days_back} days`);
  if (resolvedName) lines.push(`**Rep:** ${resolvedName}`);
  if (phase) lines.push(`**Phase:** ${phase}`);
  lines.push('');

  // ── Executive Summary ─────────────────────────────────────────────────────
  lines.push(`## 📊 Executive Summary`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Leads Created | **${totalLeads.toLocaleString()}** |`);
  lines.push(`| Leads Contacted | **${contacted.length.toLocaleString()}** (${pct(contacted.length, totalLeads)}) |`);
  lines.push(`| Leads Converted | **${converted.length.toLocaleString()}** (${pct(converted.length, totalLeads)}) |`);
  lines.push(`| Opportunities Created | **${opportunities.length.toLocaleString()}** |`);
  lines.push(`| Closed Won | **${closedWon.length}** (${currency(wonRevenue)}) |`);
  lines.push(`| Closed Lost | **${closedLost.length}** (${currency(lostRevenue)}) |`);
  lines.push(`| Expired | **${expired.length}** (${currency(expiredRevenue)}) |`);
  lines.push(`| Open Pipeline | **${openOpps.length}** (${currency(openRevenue)}) |`);
  lines.push(`| **Deal Cycle Win Rate** | **${dealCycleWinRate.toFixed(1)}%** (${cyclesWon.length}W / ${closedCycles} closed cycles) |`);
  if (naiveWinRate !== dealCycleWinRate) {
    lines.push(`| ↳ Naive Per-Opp Win Rate | ${naiveWinRate.toFixed(1)}% *(inflated — counts sibling proposals as separate deals)* |`);
  }
  lines.push(`| Deal Cycles Identified | **${dealCycles.length}** (${cyclesWon.length} won, ${cyclesLost.length} lost, ${cyclesOpen.length} open) |`);
  if (totalSiblings > 0) {
    lines.push(`| Sibling Proposals Detected | **${totalSiblings}** across ${cyclesWithSiblings.length} cycles *(excluded from win/loss math)* |`);
  }
  if (wonVelocity.length > 0) {
    lines.push(`| Avg Days to Close (Won) | **${Math.round(avg(wonVelocity))} days** (median: ${Math.round(median(wonVelocity))}) |`);
  }
  if (totalLifecycleDays.length > 0) {
    lines.push(`| Avg Lead-to-Conversion | **${Math.round(avg(totalLifecycleDays))} days** (median: ${Math.round(median(totalLifecycleDays))}) |`);
  }
  lines.push('');

  // ── Lead Funnel ───────────────────────────────────────────────────────────
  lines.push(`## 🔽 Lead Funnel`);
  lines.push('');
  lines.push(`| Stage | Count | Conversion | Avg Days to Next |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| Created | ${totalLeads.toLocaleString()} | — | ${speedToContact.length > 0 ? `${avg(speedToContact).toFixed(1)}d → Contact` : '—'} |`);
  lines.push(`| Contacted | ${contacted.length.toLocaleString()} | ${pct(contacted.length, totalLeads)} | ${contactToConsult.length > 0 ? `${avg(contactToConsult).toFixed(1)}d → Consult` : '—'} |`);
  lines.push(`| Consult Scheduled | ${consultScheduled.length.toLocaleString()} | ${pct(consultScheduled.length, contacted.length || 1)} of contacted | ${scheduledToActual.length > 0 ? `${avg(scheduledToActual).toFixed(1)}d → Actual` : '—'} |`);
  lines.push(`| Consult Actual | ${consultActual.length.toLocaleString()} | ${consultScheduled.length > 0 ? pct(consultActual.length, consultScheduled.length) + ' show rate' : '—'} | — |`);
  lines.push(`| Consult Completed | ${consultCompleted.length.toLocaleString()} | ${pct(consultCompleted.length, consultActual.length || 1)} of actual | ${consultToConvert.length > 0 ? `${avg(consultToConvert).toFixed(1)}d → Convert` : '—'} |`);
  lines.push(`| Converted | ${converted.length.toLocaleString()} | ${pct(converted.length, totalLeads)} of all leads | — |`);
  lines.push('');

  if (speedToContact.length > 0) {
    const sameDay = speedToContact.filter(d => d === 0).length;
    const within3 = speedToContact.filter(d => d <= 3).length;
    lines.push(`**Speed-to-Lead:** ${pct(sameDay, speedToContact.length)} same-day contact, ${pct(within3, speedToContact.length)} within 3 days`);
    lines.push('');
  }

  // ── Opportunity Stage Distribution ────────────────────────────────────────
  lines.push(`## 📈 Opportunity Stage Distribution`);
  lines.push('');
  lines.push(`| Stage | Count | Revenue | % of Total |`);
  lines.push(`|---|---|---|---|`);
  for (const stage of STAGE_ORDER) {
    const cnt = stageCounts[stage] ?? 0;
    if (cnt === 0) continue;
    const amt = stageAmounts[stage] ?? 0;
    const icon = stage === 'Closed Won' ? '✅' : stage === 'Closed Lost' ? '❌' : stage === 'Expired' ? '⏰' : '📋';
    lines.push(`| ${icon} ${stage} | ${cnt} | ${currency(amt)} | ${pct(cnt, opportunities.length)} |`);
  }
  // Any stages not in our canonical list
  for (const [stage, cnt] of Object.entries(stageCounts)) {
    if (!STAGE_ORDER.includes(stage as typeof STAGE_ORDER[number]) && stage !== 'Unknown') {
      lines.push(`| ❓ ${stage} | ${cnt} | ${currency(stageAmounts[stage] ?? 0)} | ${pct(cnt, opportunities.length)} |`);
    }
  }
  lines.push('');

  // ── Stage Velocity ────────────────────────────────────────────────────────
  lines.push(`## ⏱️ Stage Velocity (from OpportunityFieldHistory)`);
  lines.push('');
  lines.push(`| Stage | Avg Days | Median Days | Transitions Tracked |`);
  lines.push(`|---|---|---|---|`);
  for (const stage of STAGE_ORDER) {
    const times = stageVelocity[stage];
    if (!times || times.length === 0) continue;
    if (TERMINAL_STAGES.includes(stage)) continue; // Don't show velocity for terminal stages
    lines.push(`| ${stage} | ${avg(times).toFixed(1)} | ${median(times).toFixed(1)} | ${times.length} |`);
  }
  lines.push('');

  if (wonVelocity.length > 0) {
    lines.push(`**Full cycle (Created → Closed Won):** avg ${Math.round(avg(wonVelocity))} days, median ${Math.round(median(wonVelocity))} days (n=${wonVelocity.length})`);
    lines.push('');
  }

  // ── Stage-to-Stage Conversion ─────────────────────────────────────────────
  lines.push(`## 🔄 Stage-to-Stage Conversion`);
  lines.push('');

  // Build a conversion matrix from history
  const stageTransitions: Record<string, Record<string, number>> = {};
  for (const h of stageHistory) {
    if (!h.OldValue || !h.NewValue) continue;
    if (!stageTransitions[h.OldValue]) stageTransitions[h.OldValue] = {};
    stageTransitions[h.OldValue][h.NewValue] = (stageTransitions[h.OldValue][h.NewValue] ?? 0) + 1;
  }

  if (Object.keys(stageTransitions).length > 0) {
    lines.push(`| From Stage | → Advanced | → Closed Won | → Closed Lost | → Expired | Total Exits |`);
    lines.push(`|---|---|---|---|---|---|`);

    for (const stage of ACTIVE_STAGES) {
      const transitions = stageTransitions[stage];
      if (!transitions) continue;

      const totalExits = Object.values(transitions).reduce((s, n) => s + n, 0);
      const toWon = transitions['Closed Won'] ?? 0;
      const toLost = transitions['Closed Lost'] ?? 0;
      const toExpired = transitions['Expired'] ?? 0;
      const advanced = totalExits - toWon - toLost - toExpired;

      lines.push(`| ${stage} | ${advanced} (${pct(advanced, totalExits)}) | ${toWon} (${pct(toWon, totalExits)}) | ${toLost} (${pct(toLost, totalExits)}) | ${toExpired} (${pct(toExpired, totalExits)}) | ${totalExits} |`);
    }
    lines.push('');
  }

  // ── Win/Loss by Lead Source ───────────────────────────────────────────────
  const meaningfulSources = Object.entries(sourceWins)
    .filter(([, v]) => v.total >= 3)
    .sort((a, b) => b[1].revenue - a[1].revenue);

  if (meaningfulSources.length > 0) {
    lines.push(`## 📊 Win Rate by Lead Source`);
    lines.push('');
    lines.push(`| Lead Source | Won | Total | Win Rate | Revenue Won |`);
    lines.push(`|---|---|---|---|---|`);
    for (const [src, stats] of meaningfulSources) {
      lines.push(`| ${src} | ${stats.won} | ${stats.total} | ${pct(stats.won, stats.total)} | ${currency(stats.revenue)} |`);
    }
    lines.push('');
  }

  // ── Phase Breakdown ───────────────────────────────────────────────────────
  const phaseEntries = Object.entries(phaseStats).filter(([, v]) => v.won + v.lost + v.expired + v.open > 0);
  if (phaseEntries.length > 1) {
    lines.push(`## 🏷️ Performance by Phase (Product Line)`);
    lines.push('');
    lines.push(`| Phase | Won | Lost | Expired | Open | Revenue Won | Win Rate |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const [p, s] of phaseEntries.sort((a, b) => b[1].revenue - a[1].revenue)) {
      const wr = (s.won + s.lost) > 0 ? pct(s.won, s.won + s.lost) : 'N/A';
      lines.push(`| ${p} | ${s.won} | ${s.lost} | ${s.expired} | ${s.open} | ${currency(s.revenue)} | ${wr} |`);
    }
    lines.push('');
  }

  // ── Deal Cycle Analysis (Sibling-Aware) ────────────────────────────────────
  lines.push(`## 🎯 Deal Cycle Analysis (Sibling-Aware Win Rate)`);
  lines.push('');
  lines.push(`> **Why this matters:** Sales Reps create multiple Sales Orders (pricing tiers) for the same Account — especially before TCI events. One signature = the deal. The others are proposal options, not separate losses. This section groups Opportunities by Account + 45-day creation window to calculate the TRUE win rate per deal cycle.`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total Deal Cycles | ${dealCycles.length} |`);
  lines.push(`| Won Cycles | ${cyclesWon.length} (${currency(dealCycleWonRevenue)}) |`);
  lines.push(`| Lost Cycles | ${cyclesLost.length} |`);
  lines.push(`| Open Cycles | ${cyclesOpen.length} |`);
  lines.push(`| **Deal Cycle Win Rate** | **${dealCycleWinRate.toFixed(1)}%** |`);
  lines.push(`| Naive Per-Opp Win Rate | ${naiveWinRate.toFixed(1)}% |`);
  if (totalSiblings > 0) {
    lines.push(`| Sibling Proposals Reclassified | ${totalSiblings} (across ${cyclesWithSiblings.length} cycles) |`);
    lines.push(`| Sales Orders Matched | ${salesOrders.length} |`);
  }
  lines.push('');

  // Show notable multi-proposal cycles
  if (cyclesWithSiblings.length > 0) {
    const topSiblingCycles = [...cyclesWithSiblings]
      .sort((a, b) => b.totalProposalCount - a.totalProposalCount)
      .slice(0, 10);

    lines.push(`### 📋 Multi-Proposal Deal Cycles`);
    lines.push('');
    for (const dc of topSiblingCycles) {
      const icon = dc.outcome === 'won' ? '✅' : dc.outcome === 'lost' ? '❌' : '🔵';
      const amount = dc.outcome === 'won' ? ` — ${currency(dc.winningAmount)}` : '';
      const soNote = dc.salesOrders.length > 0 ? ` | ${dc.salesOrders.length} Sales Orders` : '';
      lines.push(`- ${icon} **${dc.accountName}** — ${dc.totalProposalCount} proposals → ${dc.outcome.toUpperCase()}${amount}${soNote}`);
    }
    lines.push('');
  }

  // ── Current Pipeline Health ───────────────────────────────────────────────
  lines.push(`## 🚦 Current Pipeline Health`);
  lines.push('');

  const staleThreshold = 14;
  const staleOpps = openOpps.filter(o => {
    const days = o.Days_in_Current_Stage__c ?? o.LastStageChangeInDays ?? daysSince(o.LastModifiedDate);
    return days >= staleThreshold;
  });

  const criticalOpps = openOpps.filter(o => {
    const days = o.Days_in_Current_Stage__c ?? o.LastStageChangeInDays ?? daysSince(o.LastModifiedDate);
    return days >= 30;
  });

  lines.push(`| Health Metric | Count | Revenue |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Active Pipeline | ${openOpps.length} | ${currency(openRevenue)} |`);
  lines.push(`| Stale (>${staleThreshold}d in stage) | ⚠️ ${staleOpps.length} | ${currency(staleOpps.reduce((s, o) => s + (o.Amount ?? 0), 0))} |`);
  lines.push(`| Critical (>30d in stage) | 🔴 ${criticalOpps.length} | ${currency(criticalOpps.reduce((s, o) => s + (o.Amount ?? 0), 0))} |`);
  lines.push('');

  // Top stale deals
  if (staleOpps.length > 0) {
    const topStale = staleOpps
      .sort((a, b) => (b.Amount ?? 0) - (a.Amount ?? 0))
      .slice(0, 10);

    lines.push(`### ⚠️ Top Stale Deals (Need Attention)`);
    lines.push('');
    for (const o of topStale) {
      const days = o.Days_in_Current_Stage__c ?? o.LastStageChangeInDays ?? daysSince(o.LastModifiedDate);
      const acct = o.Account?.Name ?? 'Unknown';
      const owner = o.Owner?.Name ?? 'Unknown';
      const icon = days >= 30 ? '🔴' : '⚠️';
      lines.push(`- ${icon} **${acct}** — ${o.StageName} | ${days}d in stage | ${currency(o.Amount)} | ${owner}`);
    }
    lines.push('');
  }

  // ── Rep Leaderboard ───────────────────────────────────────────────────────
  if (repStats.length > 0) {
    lines.push(`## 🏆 Rep Performance Leaderboard`);
    lines.push('');
    lines.push(`> Win rates below use **deal-cycle** math: sibling proposals on the same Account are grouped, not counted as separate wins/losses.`);
    lines.push('');
    lines.push(`| Rep | Cycles Won | Cycles Lost | Deal Win Rate | Revenue | Avg Days to Close | Leads Contacted | Leads Converted |`);
    lines.push(`|---|---|---|---|---|---|---|---|`);
    for (const r of repStats) {
      const idx = repStats.indexOf(r);
      const medal = idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : '';
      const siblings = r.siblingProposals > 0 ? ` *(${r.siblingProposals} siblings excl.)*` : '';
      lines.push(`| ${medal}${r.name} | ${r.dealCyclesWon} | ${r.dealCyclesLost} | ${r.dealCycleWinRate.toFixed(1)}%${siblings} | ${currency(r.revenue)} | ${r.avgDaysToClose || '—'}d | ${r.leadsContacted} | ${r.leadsConverted} |`);
    }
    lines.push('');
  }

  // ── Insights & Recommendations ────────────────────────────────────────────
  lines.push(`## 💡 Insights & Recommendations`);
  lines.push('');

  // Speed-to-lead insight
  if (speedToContact.length > 0) {
    const avgSpeed = avg(speedToContact);
    if (avgSpeed > 2) {
      lines.push(`⚠️ **Speed-to-lead is ${avgSpeed.toFixed(1)} days avg.** Best practice is same-day contact. Leads contacted within 24 hours convert at 3-5x higher rates.`);
    } else {
      lines.push(`✅ **Speed-to-lead is strong at ${avgSpeed.toFixed(1)} days avg.** Keep it up — fast response drives higher conversion.`);
    }
  }

  // Show rate insight
  if (consultScheduled.length > 0 && consultActual.length > 0) {
    const showRate = (consultActual.length / consultScheduled.length) * 100;
    if (showRate < 70) {
      lines.push(`⚠️ **Consult show rate is ${showRate.toFixed(0)}%.** Consider confirmation calls, reminder sequences, or same-day booking when possible.`);
    } else {
      lines.push(`✅ **Consult show rate is ${showRate.toFixed(0)}%.** Solid follow-through from scheduled to actual consult.`);
    }
  }

  // Pipeline staleness
  if (staleOpps.length > 0) {
    const stalePct = (staleOpps.length / Math.max(openOpps.length, 1)) * 100;
    if (stalePct > 40) {
      lines.push(`🔴 **${stalePct.toFixed(0)}% of open pipeline is stale (>${staleThreshold}d in stage).** This represents ${currency(staleOpps.reduce((s, o) => s + (o.Amount ?? 0), 0))} in at-risk revenue. Prioritize moving or closing these deals.`);
    } else if (stalePct > 20) {
      lines.push(`⚠️ **${stalePct.toFixed(0)}% of pipeline is stale.** Review the stale deals above for advancement or closure.`);
    }
  }

  // Sibling proposal insight
  if (totalSiblings > 0) {
    const rateGap = Math.abs(naiveWinRate - dealCycleWinRate);
    if (rateGap > 5) {
      lines.push(`📊 **Sibling proposals shifted win rate by ${rateGap.toFixed(1)} percentage points.** Naive per-Opp rate was ${naiveWinRate.toFixed(1)}%; deal-cycle rate is ${dealCycleWinRate.toFixed(1)}%. ${naiveWinRate > dealCycleWinRate ? 'The naive rate was inflated — multiple proposals per Account made individual Opp counts misleading.' : 'Sibling detection revealed a higher actual close rate than raw numbers suggested.'}`);
    }
  }

  // Expired vs Lost
  if (expired.length > closedLost.length * 3 && expired.length > 10) {
    lines.push(`⚠️ **${expired.length} Expired vs. ${closedLost.length} Closed Lost.** Most deals are expiring rather than being explicitly lost. Consider more aggressive follow-up before proposals expire, or tighter proposal validity windows.`);
  }

  // Conversion funnel drop-off
  if (totalLeads > 0 && contacted.length > 0) {
    const contactRate = contacted.length / totalLeads;
    if (contactRate < 0.05) {
      lines.push(`🔴 **Only ${pct(contacted.length, totalLeads)} of leads are being contacted.** Massive drop-off at the top of funnel. Review lead assignment rules and SLA enforcement.`);
    }
  }

  lines.push('');
  lines.push(`---`);
  lines.push(`*Report generated ${today}. Data covers last ${days_back} days. Excludes William Summers test accounts.*`);

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const opportunityLifecycleHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_opportunity_lifecycle: handleOpportunityLifecycle,
};
