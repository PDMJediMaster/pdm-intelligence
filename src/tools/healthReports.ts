import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import {
  calculateHealthScore,
  detectProducts,
  proxyHealthScore,
} from '../services/healthScoring.js';
import { CHURN_RISK_THRESHOLD, DEFAULT_CHURN_LIMIT } from '../constants.js';
import { WILLIAM_SUMMERS_USER_ID } from './accountManagement.js';
import type { SalesforceRefundRequest, SalesforceCancellationRequest } from '../types.js';

// ─── Governance Constants ──────────────────────────────────────────────────

/** Terminal statuses excluded from all operational bulk queries */
export const INACTIVE_STATUS_VALUES = ['Cancelled', 'Inactive', 'Expired'] as const;
const INACTIVE_STATUS_SOQL = INACTIVE_STATUS_VALUES.map((s) => `'${s}'`).join(', ');

/**
 * Standard WHERE fragment for any query that should return active marketing clients only.
 * Excludes: terminal statuses (Cancelled/Inactive/Expired) AND null status (TCI ticket buyers /
 * converted leads that never became clients). Always combine with OwnerId != WILLIAM_SUMMERS.
 *
 * Usage: `WHERE ${ACTIVE_CLIENT_FILTER} AND ${NOISE_ACCOUNT_FILTER} AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`
 */
export const ACTIVE_CLIENT_FILTER =
  `Status__c NOT IN (${INACTIVE_STATUS_SOQL}) AND Status__c != null`;

/**
 * Filters out known test and noise accounts from bulk operational queries.
 * Applies to: churn risk, upsell, renewal pipeline, weekly synopsis, nightly scan.
 * Does NOT apply to per-account lookups (pre-call brief, health report).
 */
export const NOISE_ACCOUNT_FILTER =
  `(NOT Name LIKE '%Test%') AND (NOT Name LIKE '%test%') AND Name != 'House of Mouse'`;

/**
 * Restricts bulk queries to accounts owned by active users in recognized PDM roles.
 * Excludes system/integration accounts (Inovi Admin, etc.) and deactivated users.
 */
export const ACTIVE_ROLE_FILTER =
  `Owner.IsActive = true AND Owner.UserRole.Name IN (
    'Account Manager',
    'Account Manager Team Lead',
    'Sales Execs',
    'CEO',
    'Practice Growth Advisor',
    'System Administrator',
    'TCI Mentorship'
  )`;

// ─── Tool Definitions ─────────────────────────────────────────────────────

export const healthReportTools: Tool[] = [
  {
    name: 'sf_get_account_health_report',
    description:
      'Get a detailed health score report for a specific account. Calculates the composite ' +
      'score across Engagement (40%), Case Health (30%), and Renewal (30%) with full ' +
      'breakdown, active products list, MRR, tier, and delinquency status.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID',
        },
        accountName: {
          type: 'string',
          description: 'Account name to search (used when accountId is not known)',
        },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_churn_risk_accounts',
    description:
      'Return a ranked list of active accounts most at risk of churning. Accounts with open ' +
      'Refund Requests are forced to the top regardless of health score. Additional signals: ' +
      'Cancellation Change Orders, delinquency flag, cancellation/pause request date, flagged ' +
      'status. Excludes William Summers accounts and Cancelled/Inactive/Expired accounts at ' +
      'the SOQL level.',
    inputSchema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description: `Health score cutoff — accounts below this are included (default: ${CHURN_RISK_THRESHOLD})`,
        },
        limit: {
          type: 'number',
          description: `Max accounts to return (default: ${DEFAULT_CHURN_LIMIT})`,
        },
        owner_id: {
          type: 'string',
          description: 'Filter to a specific AM by Salesforce User ID (optional)',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schemas ────────────────────────────────────────────────────────

const HealthReportArgs = z.object({
  accountId:   z.string().optional(),
  accountName: z.string().optional(),
});

const ChurnRiskArgs = z.object({
  threshold: z.number().min(0).max(100).default(CHURN_RISK_THRESHOLD),
  limit:     z.number().min(1).max(200).default(DEFAULT_CHURN_LIMIT),
  owner_id:  z.string().optional(),
});

// ─── Handlers ─────────────────────────────────────────────────────────────

async function handleHealthReport(rawArgs: unknown): Promise<string> {
  const { accountId, accountName } = HealthReportArgs.parse(rawArgs);

  if (!accountId && !accountName) {
    throw new Error('Provide either accountId or accountName.');
  }

  let resolvedId = accountId;

  if (!resolvedId && accountName) {
    const matches = await salesforceService.searchAccountsByName(accountName);
    if (matches.length === 0) throw new Error(`No active account found matching "${accountName}".`);
    if (matches.length > 1) {
      const list = matches.map((m) => `${m.Name} (${m.Id})`).join('\n  ');
      throw new Error(`Multiple accounts match "${accountName}". Use accountId:\n  ${list}`);
    }
    resolvedId = matches[0].Id;
  }

  const id = resolvedId!;

  // Enriched account query
  interface HealthAccount {
    Id: string; Name: string; Status__c?: string; TCI_Status__c?: string;
    TCI_Enrolled__c?: boolean;
    OwnerId: string; Owner?: { Name: string };
    Total_Monthly_Recurring_Amount__c?: number; Tier__c?: string;
    Contract_End_Date__c?: string; Contract_Renewal_Date__c?: string;
    LastActivityDate?: string; Next_Alignment_Call__c?: string;
    Delinquent__c?: boolean; Flagged_Status__c?: boolean;
    Cancellation_or_Pause_Request_Date__c?: string;
    Upsell_Opportunity__c?: string; Engagement_Status__c?: string;
    Budget__c?: number; SEO_Budget__c?: number; Social_Budget__c?: number;
  }

  const [accountRaw, tasks, openCases, opportunities] = await Promise.all([
    salesforceService.rawQuery<HealthAccount>(
      `SELECT Id, Name, Status__c, TCI_Status__c, TCI_Enrolled__c, OwnerId, Owner.Name,
              Total_Monthly_Recurring_Amount__c, Tier__c,
              Contract_End_Date__c, Contract_Renewal_Date__c,
              LastActivityDate, Next_Alignment_Call__c,
              Delinquent__c, Flagged_Status__c,
              Cancellation_or_Pause_Request_Date__c,
              Upsell_Opportunity__c, Engagement_Status__c,
              Budget__c, SEO_Budget__c, Social_Budget__c
       FROM Account WHERE Id = '${id}'`
    ).then((r) => r[0]),
    salesforceService.getRecentTasks(id, 30),
    salesforceService.getCases(id, { openOnly: true }),
    salesforceService.getOpportunities(id, { isClosed: false }),
  ]);

  if (!accountRaw) throw new Error(`Account not found: ${id}`);

  const healthScore = calculateHealthScore(
    tasks,
    openCases,
    opportunities,
    accountRaw.Contract_End_Date__c
  );

  // Detect active products from budget fields (reliable for all accounts).
  // Only flag Phase 2 services when Status = Active AND budget > 0.
  const isActive = accountRaw.Status__c === 'Active';
  const productNames: string[] = [];
  if (isActive && (accountRaw.Budget__c ?? 0) > 0)        productNames.push('PPC');
  if (isActive && (accountRaw.SEO_Budget__c ?? 0) > 0)    productNames.push('SEO');
  if (isActive && (accountRaw.Social_Budget__c ?? 0) > 0) productNames.push('Social Media');
  if (accountRaw.TCI_Status__c === 'Member' || accountRaw.TCI_Enrolled__c)
    productNames.push('TCI Mentorship');
  const activeProducts = detectProducts(productNames);

  const ownerName = (accountRaw.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
  const mrr = accountRaw.Total_Monthly_Recurring_Amount__c
    ? `$${accountRaw.Total_Monthly_Recurring_Amount__c.toLocaleString()}/mo`
    : 'Not set';

  const scoreBar = (score: number): string => {
    const filled = Math.round(score / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${score}/100`;
  };

  const lines: string[] = [
    `# Health Report: ${accountRaw.Name}`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    `**Owner:** ${ownerName} | **Status:** ${accountRaw.Status__c ?? 'Unknown'} | **TCI:** ${accountRaw.TCI_Status__c ?? 'N/A'}`,
    `**MRR:** ${mrr} | **Tier:** ${accountRaw.Tier__c ?? 'N/A'}`,
  ];

  // Delinquency / flags
  const flags: string[] = [];
  if (accountRaw.Delinquent__c)                          flags.push('💳 DELINQUENT');
  if (accountRaw.Flagged_Status__c)                      flags.push('🚩 FLAGGED');
  if (accountRaw.Cancellation_or_Pause_Request_Date__c)  flags.push(`🚨 CANCEL/PAUSE REQUEST (${accountRaw.Cancellation_or_Pause_Request_Date__c})`);
  if (accountRaw.Upsell_Opportunity__c)                  flags.push(`💡 UPSELL: ${accountRaw.Upsell_Opportunity__c}`);
  if (flags.length > 0) {
    lines.push(`**Signals:** ${flags.join(' | ')}`);
  }

  lines.push(
    '',
    `## Overall Score: ${healthScore.overall}/100 — ${healthScore.rating}`,
    `${scoreBar(healthScore.overall)}`,
    '',
    '## Score Breakdown',
    `### Engagement (40% weight) — ${healthScore.engagement}/100`,
    `${scoreBar(healthScore.engagement)}`,
    `*${healthScore.breakdown.engagementDetails}*`,
    '',
    `### Case Health (30% weight) — ${healthScore.cases}/100`,
    `${scoreBar(healthScore.cases)}`,
    `*${healthScore.breakdown.casesDetails}*`,
    '',
    `### Renewal Health (30% weight) — ${healthScore.renewal}/100`,
    `${scoreBar(healthScore.renewal)}`,
    `*${healthScore.breakdown.renewalDetails}*`,
    '',
    '## Active PDM Products',
  );

  if (activeProducts.length > 0) {
    lines.push(...activeProducts.map((p) => `- ${p}`));
  } else {
    lines.push('No product data found.');
  }

  lines.push('');
  lines.push(`## Open Cases (${openCases.length})`);
  if (openCases.length === 0) {
    lines.push('No open cases.');
  } else {
    for (const c of openCases) {
      const ageDays = Math.floor((Date.now() - new Date(c.CreatedDate).getTime()) / 86_400_000);
      lines.push(
        `- [${c.CaseNumber}] ${c.Subject} | ${c.Priority} | ${ageDays}d old` +
        (c.IsEscalated ? ' ⚠️' : '')
      );
    }
  }

  lines.push('');
  const displayTasks = tasks.filter((t) => !t.Subject?.startsWith('Pardot List Email:'));
  lines.push(`## Recent Activity (30 days) — ${displayTasks.length} task(s)`);
  for (const t of displayTasks.slice(0, 5)) {
    lines.push(`- ${t.ActivityDate ?? t.CreatedDate.split('T')[0]}: ${t.Type ?? 'Task'} — ${t.Subject}`);
  }
  if (displayTasks.length === 0) lines.push('No recorded activity in the last 30 days.');

  return lines.join('\n');
}

async function handleChurnRisk(rawArgs: unknown): Promise<string> {
  const { threshold, limit, owner_id } = ChurnRiskArgs.parse(rawArgs ?? {});

  const ownerFilter = owner_id ? `AND OwnerId = '${owner_id}'` : '';

  // ── Bulk account query with SOQL-level exclusions ──────────────────────
  interface ChurnAccount {
    Id: string; Name: string; Status__c?: string;
    OwnerId: string; Owner?: { Name: string };
    Total_Monthly_Recurring_Amount__c?: number; Tier__c?: string;
    LastActivityDate?: string; Contract_End_Date__c?: string;
    Contract_Renewal_Date__c?: string;
    Delinquent__c?: boolean; Flagged_Status__c?: boolean;
    Cancellation_or_Pause_Request_Date__c?: string;
    Next_Alignment_Call__c?: string;
  }

  // Run account query + refund request query + cancellation request query in parallel
  const [accounts, allRefundRequests, cancellationRequests] = await Promise.all([
    salesforceService.rawQuery<ChurnAccount>(
      `SELECT Id, Name, Status__c, OwnerId, Owner.Name,
              Total_Monthly_Recurring_Amount__c, Tier__c,
              LastActivityDate, Contract_End_Date__c, Contract_Renewal_Date__c,
              Delinquent__c, Flagged_Status__c,
              Cancellation_or_Pause_Request_Date__c,
              Next_Alignment_Call__c
       FROM Account
       WHERE ${ACTIVE_CLIENT_FILTER}
         AND ${NOISE_ACCOUNT_FILTER}
         AND ${ACTIVE_ROLE_FILTER}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         ${ownerFilter}
         AND IsDeleted = false
       ORDER BY LastActivityDate ASC NULLS FIRST`
    ),

    salesforceService.rawQuery<SalesforceRefundRequest>(
      `SELECT Id, Account__c, Name, Status__c, Refund_Amount__c, Reason__c, CreatedDate
       FROM Refund_Request__c
       WHERE Status__c != 'Closed'
         AND Account__c != null
       ORDER BY CreatedDate DESC
       LIMIT 200`
    ).catch(() => [] as SalesforceRefundRequest[]),

    salesforceService.rawQuery<SalesforceCancellationRequest>(
      `SELECT Id, Account__c, Name, Status__c, Primary_Cancellation_Reason__c,
              Cancellation_Type__c, Effective_Cancellation_Date__c,
              Days_Until_Effective_Cancellation__c, Requested_Date__c,
              Save_Attempted__c, Save_Outcome__c, New_Agency_Name__c
       FROM Cancellation_Request__c
       WHERE Status__c NOT IN ('Rejected', 'Cancelled Process', 'Completed')
         AND Account__c != null
       ORDER BY Effective_Cancellation_Date__c ASC NULLS LAST
       LIMIT 200`
    ).catch(() => [] as SalesforceCancellationRequest[]),
  ]);

  // Build lookup maps
  const refundAccountIds = new Set(allRefundRequests.map((r) => r.Account__c));
  const cancelRequestsByAccount = new Map<string, SalesforceCancellationRequest[]>();
  for (const cr of cancellationRequests) {
    const list = cancelRequestsByAccount.get(cr.Account__c) ?? [];
    list.push(cr);
    cancelRequestsByAccount.set(cr.Account__c, list);
  }

  // Score accounts
  type ScoredEntry = {
    accountId: string; accountName: string; ownerName: string;
    mrr?: number; tier?: string;
    score: number; riskFactors: string[];
    hasRefundRequest: boolean; hasCancelRequest: boolean;
  };

  const scored: ScoredEntry[] = [];

  for (const account of accounts) {
    const daysSinceActivity = account.LastActivityDate
      ? Math.floor((Date.now() - new Date(account.LastActivityDate).getTime()) / 86_400_000)
      : null;

    const { score: baseScore, riskFactors } = proxyHealthScore({
      daysSinceActivity,
      openCaseCount: 0,
      contractEndDate: account.Contract_Renewal_Date__c ?? account.Contract_End_Date__c,
    });

    // Additional deductions for new churn signals
    let score = baseScore;
    if (account.Delinquent__c) {
      score = Math.max(0, score - 20);
      riskFactors.push('Delinquent billing');
    }
    if (account.Cancellation_or_Pause_Request_Date__c) {
      score = Math.max(0, score - 25);
      riskFactors.push(`Cancellation/pause request (${account.Cancellation_or_Pause_Request_Date__c})`);
    }
    if (account.Flagged_Status__c) {
      score = Math.max(0, score - 10);
      riskFactors.push('Flagged for attention');
    }

    // Status__c is a direct churn signal — force inclusion for terminal-adjacent statuses
    const status = account.Status__c ?? '';
    const isNonRenewing = status === 'Non Renewing';
    const isPaused      = status === 'Paused';
    const isDelinquent  = status === 'Delinquent';

    if (isNonRenewing) {
      score = Math.max(0, score - 40);
      riskFactors.push('🚨 Status: Non Renewing');
    }
    if (isPaused) {
      score = Math.max(0, score - 30);
      riskFactors.push('⏸️ Status: Paused');
    }
    if (isDelinquent) {
      score = Math.max(0, score - 30);
      riskFactors.push('💸 Status: Delinquent');
    }

    const hasRefundRequest = refundAccountIds.has(account.Id);
    const accountCancelRequests = cancelRequestsByAccount.get(account.Id) ?? [];
    const hasCancelRequest = accountCancelRequests.length > 0;

    if (hasRefundRequest) {
      score = Math.max(0, score - 30);
      riskFactors.push('⚠️ Open refund request');
    }
    if (hasCancelRequest) {
      const cr = accountCancelRequests[0]; // most urgent (sorted by effective date)
      score = Math.max(0, score - 30);
      const daysUntil = cr.Days_Until_Effective_Cancellation__c;
      const reason = cr.Primary_Cancellation_Reason__c ?? 'No reason given';
      const dateStr = cr.Effective_Cancellation_Date__c ?? 'TBD';
      const urgency = daysUntil != null && daysUntil <= 14 ? '🚨' : '⚠️';
      riskFactors.push(`${urgency} Cancellation Request (${cr.Status__c}) — ${reason}`);
      riskFactors.push(`  Effective: ${dateStr}${daysUntil != null ? ` (${daysUntil}d)` : ''}`);
      if (cr.New_Agency_Name__c) riskFactors.push(`  Going to: ${cr.New_Agency_Name__c}`);
      if (cr.Save_Attempted__c) riskFactors.push(`  Save attempted — outcome: ${cr.Save_Outcome__c ?? 'pending'}`);
    }

    const isStatusRisk = isNonRenewing || isPaused || isDelinquent;
    if (score <= threshold || hasRefundRequest || hasCancelRequest || isStatusRisk) {
      const ownerName = (account.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
      scored.push({
        accountId:   account.Id,
        accountName: account.Name,
        ownerName,
        mrr:         account.Total_Monthly_Recurring_Amount__c,
        tier:        account.Tier__c,
        score,
        riskFactors,
        hasRefundRequest,
        hasCancelRequest,
      });
    }
  }

  // Sort: refund/cancel requests first, then status risks, then by score ascending
  scored.sort((a, b) => {
    const priority = (e: typeof scored[0]) =>
      (e.hasRefundRequest || e.hasCancelRequest) ? 0 :
      e.riskFactors.some((f) => f.includes('Non Renewing') || f.includes('Paused') || f.includes('Delinquent')) ? 1 :
      2;
    const pa = priority(a), pb = priority(b);
    if (pa !== pb) return pa - pb;
    return a.score - b.score;
  });

  const results = scored.slice(0, limit);

  const lines: string[] = [
    `# Churn Risk Accounts (score ≤ ${threshold})`,
    `${results.length} accounts flagged | ${accounts.length} active accounts scanned`,
    `Excludes: William Summers accounts | Statuses: ${INACTIVE_STATUS_VALUES.join(', ')}`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    '> Accounts with open Refund Requests or Cancellation Requests appear first regardless of score.',
    '> Run `sf_get_account_health_report` for a full score on any individual account.',
    '',
  ];

  if (results.length === 0) {
    lines.push(`No accounts found below the ${threshold} threshold. 🎉`);
  } else {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const rating =
        r.score < 35 ? '🔴 Critical' :
        r.score < 50 ? '🟡 At Risk'  :
        '🟡 Watch';
      const mrr  = r.mrr ? ` | MRR: $${r.mrr.toLocaleString()}` : '';
      const tier = r.tier ? ` | Tier: ${r.tier}` : '';
      const badges = [
        r.hasRefundRequest  ? '⚠️ REFUND REQUEST'      : '',
        r.hasCancelRequest  ? '🚨 CANCELLATION REQUEST' : '',
      ].filter(Boolean).join(' ');

      lines.push(`### ${i + 1}. ${r.accountName}${badges ? `  ${badges}` : ''}`);
      lines.push(`**Score:** ${r.score}/100 — ${rating} | **Owner:** ${r.ownerName}${mrr}${tier}`);
      lines.push(`**Risk factors:**`);
      for (const f of r.riskFactors) {
        lines.push(`  - ${f}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── Router ───────────────────────────────────────────────────────────────

export const healthReportHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_account_health_report: handleHealthReport,
  sf_get_churn_risk_accounts:   handleChurnRisk,
};
