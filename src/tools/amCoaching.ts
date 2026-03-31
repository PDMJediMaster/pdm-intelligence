import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import { WILLIAM_SUMMERS_USER_ID } from './accountManagement.js';
import { ACTIVE_CLIENT_FILTER, ACTIVE_ROLE_FILTER } from './healthReports.js';

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
  // Call Intelligence sentiment
  sentimentScores: number[];
  pauseCancelCallCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  return Math.max(0, days); // future dates clamp to 0
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

  // Parallel: all active accounts + open refund requests + CI sentiment data
  interface CISentiment {
    Account__c: string;
    Account__r?: { OwnerId?: string };
    Sentiment_Score__c?: number;
    Sentiment_Label__c?: string;
    Pause_Cancel_Language__c?: boolean;
    SF_Intelligence_Score__c?: number;
    Call_Duration_Seconds__c?: number;
    Doctor_Reached__c?: boolean;
    Key_Topics__c?: string;
    Satisfaction_Signal__c?: string;
    Budget_Concern__c?: boolean;
    Competitor_Mentioned__c?: boolean;
    Tone_Shift__c?: string;
  }

  const [accounts, refundRequests, ciSentimentData] = await Promise.all([
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
         AND (NOT Name LIKE '%Test%') AND (NOT Name LIKE '%test%') AND Name != 'House of Mouse'
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         AND ${ACTIVE_ROLE_FILTER}
         ${ownerFilter}
       ORDER BY OwnerId, Name`
    ),

    salesforceService.rawQuery<{ Account__c: string }>(
      `SELECT Account__c
       FROM Refund_Request__c
       WHERE Status__c != 'Closed' AND Account__c != null
       LIMIT 200`
    ).catch(() => [] as { Account__c: string }[]),

    // Call Intelligence sentiment scores from last 90 days
    salesforceService.rawQuery<CISentiment>(
      `SELECT Account__c, Account__r.OwnerId,
              Sentiment_Score__c, Sentiment_Label__c, Pause_Cancel_Language__c,
              SF_Intelligence_Score__c, Call_Duration_Seconds__c, Doctor_Reached__c,
              Key_Topics__c, Satisfaction_Signal__c, Budget_Concern__c,
              Competitor_Mentioned__c, Tone_Shift__c
       FROM Call_Intelligence__c
       WHERE Processing_Status__c = 'Processed'
         AND Call_Date__c >= LAST_N_DAYS:90
         AND Account__c != null
       ORDER BY Call_Date__c DESC
       LIMIT 1000`
    ).catch(() => [] as CISentiment[]),
  ]);

  if (accounts.length === 0) {
    return 'No active accounts found for the specified criteria.';
  }

  // Build refund set by account ID
  const refundAccountIds = new Set(refundRequests.map((r) => r.Account__c));

  // Build CI sentiment lookup by owner
  const ciByOwner = new Map<string, CISentiment[]>();
  for (const ci of ciSentimentData) {
    const ownerId = ci.Account__r?.OwnerId;
    if (!ownerId) continue;
    const list = ciByOwner.get(ownerId) ?? [];
    list.push(ci);
    ciByOwner.set(ownerId, list);
  }

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
        sentimentScores: [], pauseCancelCallCount: 0,
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
  // Populate CI sentiment into AM stats
  for (const [ownerId, ciList] of ciByOwner) {
    const am = amMap.get(ownerId);
    if (!am) continue;
    for (const ci of ciList) {
      if (ci.Sentiment_Score__c != null) am.sentimentScores.push(ci.Sentiment_Score__c);
      if (ci.Pause_Cancel_Language__c) am.pauseCancelCallCount++;
    }
  }

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
    ...(ciSentimentData.length > 0 ? [
      `- **Call Sentiment (90d):** ${avg(ciSentimentData.filter(c => c.Sentiment_Score__c != null).map(c => c.Sentiment_Score__c!))}/100 avg across ${ciSentimentData.length} processed calls`,
      `- **Pause/Cancel Language:** ${ciSentimentData.filter(c => c.Pause_Cancel_Language__c).length} calls flagged`,
    ] : []),
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

    // Call Intelligence sentiment
    if (am.sentimentScores.length > 0) {
      const amSentAvg = avg(am.sentimentScores);
      const teamSentScores = ciSentimentData.filter(c => c.Sentiment_Score__c != null).map(c => c.Sentiment_Score__c!);
      const teamSentAvg = teamSentScores.length > 0 ? avg(teamSentScores) : 0;
      const sentVsTeam = amSentAvg - teamSentAvg;
      const sentVsStr = sentVsTeam >= 0 ? `+${sentVsTeam}` : `${sentVsTeam}`;
      const sentBadge = amSentAvg >= 70 ? '🟢' : amSentAvg >= 40 ? '🟡' : '🔴';

      lines.push(`### 🧠 Call Sentiment (90d)`);
      lines.push(
        `- **Avg Sentiment:** ${sentBadge} ${amSentAvg}/100 (${sentVsStr} vs team) — ${am.sentimentScores.length} calls analyzed`
      );
      if (am.pauseCancelCallCount > 0) {
        lines.push(`- **⚠️ ${am.pauseCancelCallCount} call(s) flagged pause/cancel language**`);
      }
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
    if (am.sentimentScores.length > 0 && avg(am.sentimentScores) < 40) {
      callouts.push(
        `Call sentiment is critically low (${avg(am.sentimentScores)}/100). ` +
        `Review recent call recordings and coach on tone, empathy, and value delivery.`
      );
    }
    if (am.pauseCancelCallCount >= 2) {
      callouts.push(
        `${am.pauseCancelCallCount} calls flagged pause/cancel language in 90 days. ` +
        `Review these accounts immediately for save play opportunities.`
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
  lines.push('| AM | Accounts | MRR | Avg Health | 🟢 | 🟡 | 🔴 | Doctor 30d | Sentiment | Refunds |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');

  const leaderboard = [...sortedAMs].sort((a, b) => avg(b.healthScores) - avg(a.healthScores));
  for (const am of leaderboard) {
    const amAvg = avg(am.healthScores);
    const mrr   = am.totalMrr > 0 ? `$${Math.round(am.totalMrr / 1000)}k` : '—';
    lines.push(
      `| ${am.ownerName} | ${am.accounts.length} | ${mrr} | ${amAvg}/100 | ` +
      `${am.healthy} | ${am.atRisk} | ${am.critical} | ` +
      `${am.doctorWithin30} (${pct(am.doctorWithin30, am.accounts.length)}) | ` +
      `${am.sentimentScores.length > 0 ? `${avg(am.sentimentScores)}/100` : '—'} | ` +
      `${am.refundCount} |`
    );
  }

  // ── Call Pattern Analysis: High vs Low Scoring Calls ─────────────────────
  const scoredCalls = ciSentimentData.filter(c => c.SF_Intelligence_Score__c != null);
  const highCalls = scoredCalls.filter(c => c.SF_Intelligence_Score__c! >= 70);
  const lowCalls  = scoredCalls.filter(c => c.SF_Intelligence_Score__c! < 50);

  if (highCalls.length >= 3 || lowCalls.length >= 3) {
    lines.push('');
    lines.push('## 🔬 Call Pattern Analysis — High vs. Low Scoring Calls (90d)');
    lines.push('');

    const analyzeGroup = (calls: CISentiment[]) => {
      const durations = calls.filter(c => c.Call_Duration_Seconds__c != null).map(c => c.Call_Duration_Seconds__c!);
      const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
      const doctorReached = calls.filter(c => c.Doctor_Reached__c).length;
      const budgetConcern = calls.filter(c => c.Budget_Concern__c).length;
      const competitorMentioned = calls.filter(c => c.Competitor_Mentioned__c).length;
      const pauseCancel = calls.filter(c => c.Pause_Cancel_Language__c).length;

      const satisfactionCounts: Record<string, number> = {};
      for (const c of calls) {
        const sig = c.Satisfaction_Signal__c ?? 'Unknown';
        satisfactionCounts[sig] = (satisfactionCounts[sig] ?? 0) + 1;
      }

      const toneShiftCounts: Record<string, number> = {};
      for (const c of calls) {
        const tone = c.Tone_Shift__c ?? 'N/A';
        toneShiftCounts[tone] = (toneShiftCounts[tone] ?? 0) + 1;
      }

      // Extract top topics across all calls
      const topicFreq: Record<string, number> = {};
      for (const c of calls) {
        if (!c.Key_Topics__c) continue;
        const topics = c.Key_Topics__c.split(/[,;|\n]/).map(t => t.trim().toLowerCase()).filter(Boolean);
        for (const t of topics) topicFreq[t] = (topicFreq[t] ?? 0) + 1;
      }
      const topTopics = Object.entries(topicFreq).sort((a, b) => b[1] - a[1]).slice(0, 5);

      return { avgDuration, doctorReached, budgetConcern, competitorMentioned, pauseCancel, satisfactionCounts, toneShiftCounts, topTopics, total: calls.length };
    };

    const high = analyzeGroup(highCalls);
    const low  = analyzeGroup(lowCalls);

    const fmtMin = (sec: number) => sec > 0 ? `${Math.round(sec / 60)}m` : '—';
    const fmtPct = (n: number, total: number) => total > 0 ? `${Math.round((n / total) * 100)}%` : '—';

    lines.push(`| Metric | High Score (≥70) | Low Score (<50) | Delta |`);
    lines.push(`|---|---|---|---|`);
    lines.push(`| **Calls Analyzed** | ${high.total} | ${low.total} | — |`);
    lines.push(`| **Avg Duration** | ${fmtMin(high.avgDuration)} | ${fmtMin(low.avgDuration)} | ${high.avgDuration > 0 && low.avgDuration > 0 ? `${Math.round((high.avgDuration - low.avgDuration) / 60)}m` : '—'} |`);
    lines.push(`| **Doctor Reached** | ${fmtPct(high.doctorReached, high.total)} | ${fmtPct(low.doctorReached, low.total)} | ${high.total > 0 && low.total > 0 ? `${Math.round((high.doctorReached / high.total - low.doctorReached / low.total) * 100)}pp` : '—'} |`);
    lines.push(`| **Budget Concern** | ${fmtPct(high.budgetConcern, high.total)} | ${fmtPct(low.budgetConcern, low.total)} | — |`);
    lines.push(`| **Competitor Mentioned** | ${fmtPct(high.competitorMentioned, high.total)} | ${fmtPct(low.competitorMentioned, low.total)} | — |`);
    lines.push(`| **Pause/Cancel Language** | ${fmtPct(high.pauseCancel, high.total)} | ${fmtPct(low.pauseCancel, low.total)} | — |`);
    lines.push('');

    // Tone shift comparison
    lines.push('### Tone Shift Distribution');
    lines.push(`| Tone Shift | High Score Calls | Low Score Calls |`);
    lines.push(`|---|---|---|`);
    for (const tone of ['Improved', 'Stable', 'Declined', 'N/A']) {
      lines.push(`| ${tone} | ${fmtPct(high.toneShiftCounts[tone] ?? 0, high.total)} | ${fmtPct(low.toneShiftCounts[tone] ?? 0, low.total)} |`);
    }
    lines.push('');

    // Satisfaction signal comparison
    lines.push('### Satisfaction Signals');
    lines.push(`| Signal | High Score Calls | Low Score Calls |`);
    lines.push(`|---|---|---|`);
    for (const sig of ['Satisfied', 'Neutral', 'Frustrated', 'Escalation Risk']) {
      lines.push(`| ${sig} | ${fmtPct(high.satisfactionCounts[sig] ?? 0, high.total)} | ${fmtPct(low.satisfactionCounts[sig] ?? 0, low.total)} |`);
    }
    lines.push('');

    // Top topics comparison
    if (high.topTopics.length > 0 || low.topTopics.length > 0) {
      lines.push('### Top Topics');
      lines.push(`| High Score Calls | Low Score Calls |`);
      lines.push(`|---|---|`);
      const maxTopics = Math.max(high.topTopics.length, low.topTopics.length);
      for (let i = 0; i < maxTopics; i++) {
        const h = high.topTopics[i] ? `${high.topTopics[i][0]} (${high.topTopics[i][1]})` : '—';
        const l = low.topTopics[i]  ? `${low.topTopics[i][0]} (${low.topTopics[i][1]})` : '—';
        lines.push(`| ${h} | ${l} |`);
      }
      lines.push('');
    }

    // Coaching insights derived from the comparison
    const insights: string[] = [];
    if (high.avgDuration > 0 && low.avgDuration > 0 && high.avgDuration > low.avgDuration * 1.2) {
      insights.push(`High-scoring calls average **${Math.round(high.avgDuration / 60)}min** vs **${Math.round(low.avgDuration / 60)}min** for low. Longer conversations correlate with better outcomes — coach AMs to stay on the call longer.`);
    }
    if (high.total > 0 && low.total > 0 && (high.doctorReached / high.total) > (low.doctorReached / low.total) + 0.15) {
      insights.push(`Doctor-reached rate is **${fmtPct(high.doctorReached, high.total)}** on high-scoring calls vs **${fmtPct(low.doctorReached, low.total)}** on low. Getting the doctor on the call is a strong predictor of call quality.`);
    }
    if (low.total > 0 && low.pauseCancel / low.total > 0.2) {
      insights.push(`**${fmtPct(low.pauseCancel, low.total)}** of low-scoring calls contain pause/cancel language. These accounts need immediate save play intervention.`);
    }
    if (low.total > 0 && low.competitorMentioned / low.total > 0.15) {
      insights.push(`Competitor mentions appear in **${fmtPct(low.competitorMentioned, low.total)}** of low-scoring calls. Equip AMs with competitive battlecards and proactive positioning.`);
    }
    if (low.total > 0 && low.budgetConcern / low.total > 0.25) {
      insights.push(`Budget concern appears in **${fmtPct(low.budgetConcern, low.total)}** of low-scoring calls. Coach AMs on ROI storytelling and value reinforcement before price discussions.`);
    }

    if (insights.length > 0) {
      lines.push('### 💡 Pattern Insights');
      for (const ins of insights) lines.push(`- ${ins}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── Router ───────────────────────────────────────────────────────────────

export const amCoachingHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_am_coaching_brief: handleAMCoachingBrief,
};
