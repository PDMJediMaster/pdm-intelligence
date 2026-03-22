import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import { WILLIAM_SUMMERS_USER_ID } from './accountManagement.js';
import { ACTIVE_CLIENT_FILTER } from './healthReports.js';

// ─── Tool Definition ──────────────────────────────────────────────────────

export const amCoachingTools: Tool[] = [
  {
    name: 'sf_get_am_coaching_brief',
    description:
      'Manager-facing coaching brief showing performance metrics for each Account Manager. ' +
      'Returns health tier distribution, doctor contact rates, MRR managed, at-risk accounts, ' +
      'and how each AM compares against team benchmarks. ' +
      'Use to identify coaching opportunities, recognize top performers, and surface AMs ' +
      'whose books of business are trending the wrong direction. ' +
      'Optionally filter to a single AM by owner_id.',
    inputSchema: {
      type: 'object',
      properties: {
        owner_id: {
          type: 'string',
          description: 'Filter to a specific AM by Salesforce User ID (optional — omit for full team view)',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schema ─────────────────────────────────────────────────────────

const AMCoachingArgs = z.object({
  owner_id: z.string().optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────

interface CoachingAccount {
  Id: string; Name: string;
  OwnerId: string; Owner?: { Name: string };
  Status__c?: string;
  Total_Monthly_Recurring_Amount__c?: number;
  LastActivityDate?: string;
  AM_Spoke_to_Doctor__c?: string;
  Contract_Renewal_Date__c?: string; Contract_End_Date__c?: string;
  Flagged_Status__c?: boolean; Delinquent__c?: boolean;
  Cancellation_or_Pause_Request_Date__c?: string;
  Health_Score__c?: number; Health_Tier__c?: string;
}

interface AMStats {
  ownerId: string;
  ownerName: string;
  accounts: CoachingAccount[];
  totalMrr: number;
  healthScores: number[];
  // Doctor contact buckets
  doctorWithin30: number;
  doctorWithin60: number;
  doctorWithin90: number;
  doctorNever: number;
  // Risk signals
  flaggedCount: number;
  delinquentCount: number;
  cancellationCount: number;
  refundCount: number;
  // Activity
  neverContacted: CoachingAccount[];
  stalest: { name: string; days: number } | null;
  // Health tiers
  healthy: number; atRisk: number; critical: number; unknown: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function proxyHealthScore(acct: CoachingAccount): number {
  // Use stored Health_Score__c if available; otherwise calculate proxy
  if (acct.Health_Score__c !== undefined && acct.Health_Score__c !== null) {
    return acct.Health_Score__c;
  }
  let score = 100;
  const lastActivity = daysSince(acct.LastActivityDate);
  if (lastActivity === null)        score -= 40;
  else if (lastActivity > 60)       score -= 35;
  else if (lastActivity > 30)       score -= 20;
  const renewalDays = daysUntil(acct.Contract_Renewal_Date__c ?? acct.Contract_End_Date__c);
  if (renewalDays !== null && renewalDays < 0)    score -= 30;
  else if (renewalDays !== null && renewalDays <= 30) score -= 20;
  if (acct.Delinquent__c)                          score -= 20;
  if (acct.Flagged_Status__c)                      score -= 10;
  if (acct.Cancellation_or_Pause_Request_Date__c)  score -= 25;
  return Math.max(0, score);
}

function healthTierLabel(score: number): string {
  if (score >= 70) return '🟢 Healthy';
  if (score >= 40) return '🟡 At Risk';
  return '🔴 Critical';
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

// ─── Handler ──────────────────────────────────────────────────────────────

async function handleAMCoachingBrief(rawArgs: unknown): Promise<string> {
  const { owner_id } = AMCoachingArgs.parse(rawArgs ?? {});

  const ownerFilter = owner_id ? `AND OwnerId = '${owner_id}'` : '';

  // Parallel: all active accounts + open refund requests
  const [accounts, refundRequests] = await Promise.all([
    salesforceService.rawQuery<CoachingAccount>(
      `SELECT Id, Name, OwnerId, Owner.Name,
              Status__c, Total_Monthly_Recurring_Amount__c,
              LastActivityDate, AM_Spoke_to_Doctor__c,
              Contract_Renewal_Date__c, Contract_End_Date__c,
              Flagged_Status__c, Delinquent__c,
              Cancellation_or_Pause_Request_Date__c,
              Health_Score__c, Health_Tier__c
       FROM Account
       WHERE ${ACTIVE_CLIENT_FILTER}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         ${ownerFilter}
       ORDER BY OwnerId, Name
       LIMIT 500`
    ),

    salesforceService.rawQuery<{ Account__c: string }>(
      `SELECT Account__c
       FROM Refund_Request__c
       WHERE Status__c != 'Closed' AND Account__c != null
       LIMIT 200`
    ).catch(() => [] as { Account__c: string }[]),
  ]);

  if (accounts.length === 0) {
    return 'No active accounts found for the specified criteria.';
  }

  // Build refund set by account ID
  const refundAccountIds = new Set(refundRequests.map((r) => r.Account__c));

  // Group accounts by AM
  const amMap = new Map<string, AMStats>();

  for (const acct of accounts) {
    const ownerId   = acct.OwnerId;
    const ownerName = (acct.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';

    if (!amMap.has(ownerId)) {
      amMap.set(ownerId, {
        ownerId, ownerName, accounts: [],
        totalMrr: 0, healthScores: [],
        doctorWithin30: 0, doctorWithin60: 0, doctorWithin90: 0, doctorNever: 0,
        flaggedCount: 0, delinquentCount: 0, cancellationCount: 0, refundCount: 0,
        neverContacted: [], stalest: null,
        healthy: 0, atRisk: 0, critical: 0, unknown: 0,
      });
    }

    const am = amMap.get(ownerId)!;
    am.accounts.push(acct);

    // MRR
    am.totalMrr += acct.Total_Monthly_Recurring_Amount__c ?? 0;

    // Health score
    const score = proxyHealthScore(acct);
    am.healthScores.push(score);
    if (score >= 70)      am.healthy++;
    else if (score >= 40) am.atRisk++;
    else                  am.critical++;

    // Doctor contact
    const doctorDays = daysSince(acct.AM_Spoke_to_Doctor__c);
    if (doctorDays === null)       am.doctorNever++;
    else if (doctorDays <= 30)     am.doctorWithin30++;
    else if (doctorDays <= 60)     am.doctorWithin60++;
    else if (doctorDays <= 90)     am.doctorWithin90++;
    else                           am.doctorNever++;    // 90+ treated same as never for coaching

    // Risk signals
    if (acct.Flagged_Status__c)                       am.flaggedCount++;
    if (acct.Delinquent__c)                           am.delinquentCount++;
    if (acct.Cancellation_or_Pause_Request_Date__c)   am.cancellationCount++;
    if (refundAccountIds.has(acct.Id))                am.refundCount++;

    // Activity staleness
    const lastActivityDays = daysSince(acct.LastActivityDate);
    if (lastActivityDays === null) {
      am.neverContacted.push(acct);
    } else if (am.stalest === null || lastActivityDays > am.stalest.days) {
      am.stalest = { name: acct.Name, days: lastActivityDays };
    }
  }

  // Sort AMs: most critical accounts first (highest risk books)
  const sortedAMs = [...amMap.values()].sort((a, b) => b.critical - a.critical || b.atRisk - a.atRisk);

  // ── Team Benchmarks ────────────────────────────────────────────────────
  const allScores      = accounts.map((a) => proxyHealthScore(a));
  const teamAvgScore   = avg(allScores);
  const teamTotalMrr   = sortedAMs.reduce((s, a) => s + a.totalMrr, 0);
  const totalAccounts  = accounts.length;

  // Doctor contact rate across team (within 30 days)
  const teamDoctorWithin30 = sortedAMs.reduce((s, a) => s + a.doctorWithin30, 0);
  const teamDoctorRate     = pct(teamDoctorWithin30, totalAccounts);

  // ── Format Output ──────────────────────────────────────────────────────
  const lines: string[] = [
    `# AM Performance Coaching Brief`,
    `*Generated ${new Date().toLocaleString()}*`,
    `*${totalAccounts} active accounts | ${sortedAMs.length} Account Managers | ` +
    `$${Math.round(teamTotalMrr).toLocaleString()}/mo total MRR*`,
    '',
    '## 🏆 Team Benchmarks',
    `- **Average Health Score:** ${teamAvgScore}/100 — ${healthTierLabel(teamAvgScore)}`,
    `- **Doctor Contact Rate (30d):** ${teamDoctorRate} of all accounts reached doctor in last 30 days`,
    `- **Total At-Risk Accounts:** ${sortedAMs.reduce((s, a) => s + a.atRisk, 0)} 🟡 | ` +
    `**Critical:** ${sortedAMs.reduce((s, a) => s + a.critical, 0)} 🔴`,
    `- **Open Refund Requests:** ${refundRequests.length} across ${refundAccountIds.size} accounts`,
    '',
    '---',
    '',
  ];

  // ── Per-AM Sections ────────────────────────────────────────────────────
  for (const am of sortedAMs) {
    const amAvgScore    = avg(am.healthScores);
    const amTotal       = am.accounts.length;
    const vsTeam        = amAvgScore - teamAvgScore;
    const vsTeamStr     = vsTeam >= 0 ? `+${vsTeam} vs team avg` : `${vsTeam} vs team avg`;
    const doctorRate30  = pct(am.doctorWithin30, amTotal);
    const mrr           = am.totalMrr > 0 ? `$${Math.round(am.totalMrr).toLocaleString()}/mo` : 'Not set';

    // Performance badge
    const perfBadge = amAvgScore >= teamAvgScore + 5
      ? ' 🌟 Above Average'
      : amAvgScore <= teamAvgScore - 10
        ? ' ⚠️ Needs Attention'
        : '';

    lines.push(`## ${am.ownerName}${perfBadge}`);
    lines.push(
      `**${amTotal} accounts** | **MRR: ${mrr}** | ` +
      `**Avg Health: ${amAvgScore}/100** (${vsTeamStr})`
    );
    lines.push('');

    // Health tier distribution
    lines.push(`### Health Distribution`);
    lines.push(
      `🟢 Healthy: ${am.healthy} (${pct(am.healthy, amTotal)}) | ` +
      `🟡 At Risk: ${am.atRisk} (${pct(am.atRisk, amTotal)}) | ` +
      `🔴 Critical: ${am.critical} (${pct(am.critical, amTotal)})`
    );
    lines.push('');

    // Doctor contact breakdown
    lines.push(`### 🩺 Doctor Contact`);
    lines.push(`- Within 30 days: **${am.doctorWithin30}** accounts (${doctorRate30})`);
    lines.push(`- 31–60 days: ${am.doctorWithin60} accounts`);
    lines.push(`- 61–90 days: ${am.doctorWithin90} accounts`);
    lines.push(`- Never / 90+ days: **${am.doctorNever}** accounts` +
      (am.doctorNever > 0 ? ' ⚠️' : ' ✅'));
    lines.push('');

    // Risk signals
    const risks: string[] = [];
    if (am.refundCount > 0)       risks.push(`🚨 ${am.refundCount} open refund request(s)`);
    if (am.cancellationCount > 0) risks.push(`🚨 ${am.cancellationCount} cancellation/pause request(s) on file`);
    if (am.delinquentCount > 0)   risks.push(`💳 ${am.delinquentCount} delinquent account(s)`);
    if (am.flaggedCount > 0)      risks.push(`🚩 ${am.flaggedCount} flagged account(s)`);

    if (risks.length > 0) {
      lines.push(`### ⚠️ Active Risk Signals`);
      for (const r of risks) lines.push(`- ${r}`);
      lines.push('');
    }

    // Activity gaps
    if (am.neverContacted.length > 0) {
      lines.push(`### 📵 Never Contacted (${am.neverContacted.length})`);
      for (const a of am.neverContacted.slice(0, 5)) lines.push(`- ${a.Name}`);
      if (am.neverContacted.length > 5) lines.push(`  *...and ${am.neverContacted.length - 5} more*`);
      lines.push('');
    }

    if (am.stalest) {
      lines.push(`### 📅 Longest Gap Since Contact`);
      lines.push(`- **${am.stalest.name}** — ${am.stalest.days} days ago`);
      lines.push('');
    }

    // Coaching callout
    const callouts: string[] = [];
    if (am.doctorNever > Math.round(amTotal * 0.4)) {
      callouts.push(
        `Doctor outreach is a priority — ${am.doctorNever} of ${amTotal} accounts have no recent doctor contact. ` +
        `AMs who reach doctors regularly have significantly lower churn rates.`
      );
    }
    if (am.critical > 0) {
      callouts.push(
        `${am.critical} account(s) are in Critical tier — review immediately and create action plans.`
      );
    }
    if (amAvgScore < teamAvgScore - 10) {
      callouts.push(
        `This book of business is ${Math.abs(vsTeam)} points below the team average. ` +
        `Schedule a 1:1 to review engagement cadence and client health strategy.`
      );
    }
    if (callouts.length > 0) {
      lines.push(`### 💡 Coaching Notes`);
      for (const c of callouts) lines.push(`- ${c}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // ── Team Leaderboard ───────────────────────────────────────────────────
  lines.push('## 📊 Team Leaderboard');
  lines.push('');
  lines.push('| AM | Accounts | MRR | Avg Health | 🟢 | 🟡 | 🔴 | Doctor 30d | Refunds |');
  lines.push('|---|---|---|---|---|---|---|---|---|');

  const leaderboard = [...sortedAMs].sort((a, b) => avg(b.healthScores) - avg(a.healthScores));
  for (const am of leaderboard) {
    const amAvg = avg(am.healthScores);
    const mrr   = am.totalMrr > 0 ? `$${Math.round(am.totalMrr / 1000)}k` : '—';
    lines.push(
      `| ${am.ownerName} | ${am.accounts.length} | ${mrr} | ${amAvg}/100 | ` +
      `${am.healthy} | ${am.atRisk} | ${am.critical} | ` +
      `${am.doctorWithin30} (${pct(am.doctorWithin30, am.accounts.length)}) | ` +
      `${am.refundCount} |`
    );
  }

  return lines.join('\n');
}

// ─── Router ───────────────────────────────────────────────────────────────

export const amCoachingHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_am_coaching_brief: handleAMCoachingBrief,
};
