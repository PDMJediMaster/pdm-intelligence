import type { SalesforceCase, SalesforceOpportunity, SalesforceTask, HealthScore } from '../types.js';
import {
  HEALTH_SCORE_WEIGHTS,
  HEALTH_SCORE_THRESHOLDS,
  ENGAGEMENT_SCORING,
  CASE_SCORING,
  PDM_PRODUCT_LIST,
  PRODUCT_KEYWORDS,
} from '../constants.js';
import type { PDMProduct } from '../constants.js';

// ─── Sub-score: Engagement (40%) ───────────────────────────────────────────
//
// Measures how actively the account manager is working this account.
// Scored against completed tasks in the last 30 days:
//   Calls:    15 pts each  (max 60)
//   Emails:    5 pts each  (max 20)
//   Meetings: 20 pts each  (max 20)

function scoreEngagement(
  tasks: SalesforceTask[],
  daysBack = ENGAGEMENT_SCORING.LOOKBACK_DAYS,
  recentVideoCallCount = 0
): { score: number; details: string } {
  const cutoff = Date.now() - daysBack * 86_400_000;
  const now    = Date.now();
  // Use ActivityDate as primary interaction date (not CreatedDate).
  // Exclude: future-dated tasks (not happened yet) and Prophet system-generated tasks.
  // Include: any past task regardless of Status — SF email logging often sets Status='Not Started'.
  const recent = tasks.filter((t) => {
    const dateStr = t.ActivityDate ?? t.CreatedDate?.split('T')[0];
    if (!dateStr) return false;
    const taskTime = new Date(dateStr).getTime();
    const subj = t.Subject ?? '';
    const isSystemTask = subj.startsWith('[Prophet]') || subj.startsWith('Pardot List Email:');
    return taskTime >= cutoff && taskTime <= now && !isSystemTask;
  });

  // Infer type from Subject prefix when Type field is blank/null/generic.
  // Salesforce logged emails often arrive with Type = null OR Type = 'Task' (generic fallback).
  // 'Other' is also treated as unclassified so subject-based inference runs on it too.
  const noMeaningfulType = (t: SalesforceTask) =>
    !t.Type || t.Type === 'Task' || t.Type === 'Other';

  const calls    = recent.filter((t) =>
    t.Type === 'Call'    || (noMeaningfulType(t) && /^call/i.test(t.Subject ?? '')));
  const emails   = recent.filter((t) =>
    t.Type === 'Email'   || (noMeaningfulType(t) && /^(email|re:|fwd:|fw:|meeting recap|call recap)/i.test(t.Subject ?? '')));
  const meetings = recent.filter((t) =>
    t.Type === 'Meeting' || (noMeaningfulType(t) && /meet|zoom|video/i.test(t.Subject ?? '')));

  const totalMeetings = meetings.length + recentVideoCallCount;

  const callPts    = Math.min(calls.length  * ENGAGEMENT_SCORING.CALL_POINTS,    ENGAGEMENT_SCORING.CALL_MAX);
  const emailPts   = Math.min(emails.length * ENGAGEMENT_SCORING.EMAIL_POINTS,   ENGAGEMENT_SCORING.EMAIL_MAX);
  const meetingPts = Math.min(totalMeetings * ENGAGEMENT_SCORING.MEETING_POINTS, ENGAGEMENT_SCORING.MEETING_MAX);

  const score = Math.min(callPts + emailPts + meetingPts, 100);
  const vcNote = recentVideoCallCount > 0 ? `, ${recentVideoCallCount} video call(s)` : '';
  const details = [
    `${calls.length} call(s)`,
    `${emails.length} email(s)`,
    `${meetings.length} meeting(s)${vcNote}`,
    `in last ${daysBack} days`,
  ].join(', ');

  return { score, details };
}

// ─── Sub-score: Case Health (30%) ──────────────────────────────────────────
//
// Starts at 100 and deducts for open cases and stale cases:
//   High/Escalated case:  −30
//   Medium case:          −15
//   Low case:             −5
//   Case open > 14 days:  additional −10

function scoreCases(openCases: SalesforceCase[]): { score: number; details: string } {
  if (openCases.length === 0) {
    return { score: 100, details: 'No open cases' };
  }

  let score = 100;
  const issues: string[] = [];

  for (const c of openCases) {
    const ageDays = Math.floor((Date.now() - new Date(c.CreatedDate).getTime()) / 86_400_000);

    if (c.Priority === 'High' || c.IsEscalated) {
      score -= CASE_SCORING.HIGH_PRIORITY_DEDUCTION;
      issues.push(`High-priority: "${c.Subject}"`);
    } else if (c.Priority === 'Medium') {
      score -= CASE_SCORING.MEDIUM_PRIORITY_DEDUCTION;
      issues.push(`Medium-priority case`);
    } else {
      score -= CASE_SCORING.LOW_PRIORITY_DEDUCTION;
      issues.push(`Low-priority case`);
    }

    if (ageDays > CASE_SCORING.STALE_CASE_DAYS) {
      score -= CASE_SCORING.STALE_CASE_DEDUCTION;
      issues.push(`case open ${ageDays} days`);
    }
  }

  score = Math.max(0, score);
  const details = `${openCases.length} open case(s) — ${issues.join('; ')}`;
  return { score, details };
}

// ─── Sub-score: Renewal (30%) ──────────────────────────────────────────────
//
// Uses Contract_End_Date__c when available; otherwise falls back to open
// opportunities. Closer-to-expiring + lower-stage = lower score.

function scoreRenewal(
  opportunities: SalesforceOpportunity[],
  contractEndDate?: string
): { score: number; details: string } {
  // Prefer explicit contract end date on the Account
  if (contractEndDate) {
    const daysUntil = Math.floor(
      (new Date(contractEndDate).getTime() - Date.now()) / 86_400_000
    );
    if (daysUntil < 0)    return { score: 20,  details: 'Contract has expired' };
    if (daysUntil <= 30)  return { score: 35,  details: `Contract ends in ${daysUntil} days` };
    if (daysUntil <= 60)  return { score: 60,  details: `Contract ends in ${daysUntil} days` };
    if (daysUntil <= 90)  return { score: 80,  details: `Contract ends in ${daysUntil} days` };
    return                       { score: 100, details: `Contract valid for ${daysUntil} more days` };
  }

  const openOpps = opportunities.filter((o) => !o.IsClosed);
  if (openOpps.length === 0) {
    return { score: 55, details: 'No active renewal opportunity on record' };
  }

  // Pick the most-progressed open opportunity
  const stageOrder: Record<string, number> = {
    'Prospecting': 10,
    'Qualification': 20,
    'Needs Analysis': 30,
    'Value Proposition': 40,
    'Id. Decision Makers': 45,
    'Perception Analysis': 50,
    'Proposal/Price Quote': 60,
    'Negotiation/Review': 75,
    'Closed Won': 100,
  };
  const best = openOpps.reduce((a, b) =>
    (stageOrder[a.StageName] ?? 30) >= (stageOrder[b.StageName] ?? 30) ? a : b
  );

  const baseScore = stageOrder[best.StageName] ?? 40;
  const daysUntilClose = Math.floor(
    (new Date(best.CloseDate).getTime() - Date.now()) / 86_400_000
  );

  let score = baseScore;
  if (daysUntilClose < 0)    score = Math.max(score - 25, 10);
  else if (daysUntilClose <= 14) score = Math.max(score - 10, 15);

  const details = `Best opp "${best.Name}" — stage: ${best.StageName}, closes ${best.CloseDate} (${daysUntilClose}d)`;
  return { score, details };
}

// ─── Composite Health Score ────────────────────────────────────────────────

export function calculateHealthScore(
  tasks: SalesforceTask[],
  openCases: SalesforceCase[],
  opportunities: SalesforceOpportunity[],
  contractEndDate?: string,
  recentVideoCallCount = 0
): HealthScore {
  const { score: engagementRaw, details: engagementDetails } = scoreEngagement(tasks, undefined, recentVideoCallCount);
  const { score: casesRaw,      details: casesDetails      } = scoreCases(openCases);
  const { score: renewalRaw,    details: renewalDetails    } = scoreRenewal(opportunities, contractEndDate);

  const overall = Math.round(
    engagementRaw * HEALTH_SCORE_WEIGHTS.ENGAGEMENT +
    casesRaw      * HEALTH_SCORE_WEIGHTS.CASES +
    renewalRaw    * HEALTH_SCORE_WEIGHTS.RENEWAL
  );

  const rating: HealthScore['rating'] =
    overall >= HEALTH_SCORE_THRESHOLDS.EXCELLENT ? 'Excellent' :
    overall >= HEALTH_SCORE_THRESHOLDS.GOOD      ? 'Good'      :
    overall >= HEALTH_SCORE_THRESHOLDS.FAIR      ? 'Fair'      :
    overall >= HEALTH_SCORE_THRESHOLDS.AT_RISK   ? 'At Risk'   :
    'Critical';

  return {
    overall,
    engagement: Math.round(engagementRaw),
    cases:      Math.round(casesRaw),
    renewal:    Math.round(renewalRaw),
    rating,
    breakdown: { engagementDetails, casesDetails, renewalDetails },
  };
}

// ─── Product Detection ────────────────────────────────────────────────────

/** Match raw product/opportunity names from Salesforce to PDM product categories */
export function detectProducts(rawNames: string[]): string[] {
  const detected = new Set<string>();
  for (const raw of rawNames) {
    const lower = raw.toLowerCase();
    for (const product of PDM_PRODUCT_LIST) {
      const keywords = PRODUCT_KEYWORDS[product as PDMProduct];
      if (keywords.some((kw) => lower.includes(kw))) {
        detected.add(product);
      }
    }
  }
  return Array.from(detected);
}

// ─── Talking Points Generator ─────────────────────────────────────────────

export function generateTalkingPoints(
  healthScore: HealthScore,
  activeProducts: string[],
  openCases: SalesforceCase[],
  renewalDaysUntil?: number
): string[] {
  const points: string[] = [];

  if (renewalDaysUntil !== undefined && renewalDaysUntil <= 60) {
    points.push(
      `🔄 Renewal in ${renewalDaysUntil} days — confirm contract continuation and review ROI`
    );
  }

  if (openCases.length > 0) {
    const high = openCases.filter((c) => c.Priority === 'High' || c.IsEscalated);
    if (high.length > 0) {
      points.push(
        `⚠️ ${high.length} high-priority open case(s) — lead with: "${high[0].Subject}"`
      );
    } else {
      points.push(`📋 ${openCases.length} open support case(s) to review status on`);
    }
  }

  if (healthScore.engagement < 40) {
    points.push(`📞 Low engagement score (${healthScore.engagement}) — establish regular check-in cadence`);
  }

  if (healthScore.cases < 50 && openCases.length === 0) {
    points.push(`✅ All cases resolved — good time to confirm satisfaction`);
  }

  // Upsell suggestion only for healthy accounts
  if (healthScore.overall >= 60) {
    const missing = PDM_PRODUCT_LIST.filter((p) => !activeProducts.includes(p));
    if (missing.length > 0) {
      const suggest = missing.slice(0, 2);
      points.push(`💡 Potential upsell opportunity: ${suggest.join(', ')}`);
    }
  }

  if (healthScore.overall >= 80) {
    points.push(`⭐ Account is in excellent health — good moment to discuss growth/expansion`);
  } else if (healthScore.overall < HEALTH_SCORE_THRESHOLDS.AT_RISK) {
    points.push(`🚨 Account at critical risk (score: ${healthScore.overall}) — prioritize retention conversation`);
  }

  return points;
}

// ─── Simple Proxy Score (for bulk queries) ───────────────────────────────
//
// Used when we can't fetch full task/case data for every account.
// Derives a rough score from Account-level fields only.

export function proxyHealthScore(params: {
  daysSinceActivity: number | null;
  openCaseCount: number;
  contractEndDate?: string;
}): { score: number; riskFactors: string[] } {
  const factors: string[] = [];
  let score = 100;

  const days = params.daysSinceActivity;
  if (days === null) {
    score -= 40;
    factors.push('No activity on record');
  } else if (days > 60) {
    score -= 35;
    factors.push(`No activity in ${days} days`);
  } else if (days > 30) {
    score -= 20;
    factors.push(`Low activity (last ${days} days ago)`);
  }

  if (params.openCaseCount >= 3) {
    score -= 30;
    factors.push(`${params.openCaseCount} open cases`);
  } else if (params.openCaseCount > 0) {
    score -= 15;
    factors.push(`${params.openCaseCount} open case(s)`);
  }

  if (params.contractEndDate) {
    const daysLeft = Math.floor(
      (new Date(params.contractEndDate).getTime() - Date.now()) / 86_400_000
    );
    if (daysLeft < 0) {
      score -= 30;
      factors.push('Contract expired');
    } else if (daysLeft <= 30) {
      score -= 20;
      factors.push(`Contract ends in ${daysLeft} days`);
    }
  }

  return { score: Math.max(0, score), riskFactors: factors };
}
