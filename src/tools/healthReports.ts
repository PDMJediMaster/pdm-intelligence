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
import type { SalesforceRefundRequest, SalesforceChangeOrder } from '../types.js';

// ─── Governance Constants ──────────────────────────────────────────────────

/** Terminal statuses excluded from all operational bulk queries */
export const INACTIVE_STATUS_VALUES = ['Cancelled', 'Inactive', 'Expired'] as const;
const INACTIVE_STATUS_SOQL = INACTIVE_STATUS_VALUES.map((s) => `'${s}'`).join(', ');

/**
 * Standard WHERE fragment for any query that should return active marketing clients only.
 * Excludes: terminal statuses (Cancelled/Inactive/Expired) AND null status (TCI ticket buyers /
 * converted leads that never became clients). Always combine with OwnerId != WILLIAM_SUMMERS.
 *
 * Usage: `WHERE ${ACTIVE_CLIENT_FILTER} AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`
 */
export const ACTIVE_CLIENT_FILTER =
  `Status__c NOT IN (${INACTIVE_STATUS_SOQL}) AND Status__c != null`;

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
    OwnerId: string; Owner?: { Name: string };
    Total_Monthly_Recurring_Amount__c?: number; Tier__c?: string;
    Contract_End_Date__c?: string; Contract_Renewal_Date__c?: string;
    LastActivityDate?: string; Next_Alignment_Call__c?: string;
    Delinquent__c?: boolean; Flagged_Status__c?: boolean;
    Cancellation_or_Pause_Request_Date__c?: string;
    Upsell_Opportunity__c?: string; Engagement_Status__c?: string;
  }

  const [accountRaw, tasks, openCases, opportunities, lineItems] = await Promise.all([
    salesforceService.rawQuery<HealthAccount>(
      `SELECT Id, Name, Status__c, TCI_Status__c, OwnerId, Owner.Name,
              Total_Monthly_Recurring_Amount__c, Tier__c,
              Contract_End_Date__c, Contract_Renewal_Date__c,
              LastActivityDate, Next_Alignment_Call__c,
              Delinquent__c, Flagged_Status__c,
              Cancellation_or_Pause_Request_Date__c,
              Upsell_Opportunity__c, Engagement_Status__c
       FROM Account WHERE Id = '${id}'`
    ).then((r) => r[0]),
    salesforceService.getRecentTasks(id, 30),
    salesforceService.getCases(id, { openOnly: true }),
    salesforceService.getOpportunities(id, { isClosed: false }),
    salesforceService.getOpportunityLineItems(id),
  ]);

  if (!accountRaw) throw new Error(`Account not found: ${id}`);

  const healthScore = calculateHealthScore(
    tasks,
    openCases,
    opportunities,
    accountRaw.Contract_End_Date__c
  );

  const wonOpps = await salesforceService.getOpportunities(id, { isWon: true, limit: 20 });
  const rawNames = [
    ...lineItems.map((li) => li.Product2?.Name ?? li.Name ?? ''),
    ...wonOpps.map((o) => o.Name),
  ];
  const activeProducts = detectProducts(rawNames);

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

  // Run account query + refund request query + cancellation change order query in parallel
  const [accounts, allRefundRequests, cancellationOrders] = await Promise.all([
    salesforceService.rawQuery<ChurnAccount>(
      `SELECT Id, Name, Status__c, OwnerId, Owner.Name,
              Total_Monthly_Recurring_Amount__c, Tier__c,
              LastActivityDate, Contract_End_Date__c, Contract_Renewal_Date__c,
              Delinquent__c, Flagged_Status__c,
              Cancellation_or_Pause_Request_Date__c,
              Next_Alignment_Call__c
       FROM Account
       WHERE ${ACTIVE_CLIENT_FILTER}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         ${ownerFilter}
         AND IsDeleted = false
       ORDER BY LastActivityDate ASC NULLS FIRST
       LIMIT ${limit * 4}`
    ),

    salesforceService.rawQuery<SalesforceRefundRequest>(
      `SELECT Id, Account__c, Name, Status__c, Refund_Amount__c, Reason__c, CreatedDate
       FROM Refund_Request__c
       WHERE Status__c != 'Closed'
         AND Account__c != null
       ORDER BY CreatedDate DESC
       LIMIT 200`
    ).catch(() => [] as SalesforceRefundRequest[]),

    salesforceService.rawQuery<SalesforceChangeOrder>(
      `SELECT Id, Account__c, Name, Type__c, Status__c, Cancellation_Date__c, CreatedDate
       FROM Change_Order__c
       WHERE (Type__c = 'Cancellation' OR Type__c = 'Pause')
         AND Status__c != 'Closed'
         AND Account__c != null
       ORDER BY CreatedDate DESC
       LIMIT 200`
    ).catch(() => [] as SalesforceChangeOrder[]),
  ]);

  // Build lookup maps
  const refundAccountIds = new Set(allRefundRequests.map((r) => r.Account__c));
  const cancelOrderAccountIds = new Set(cancellationOrders.map((o) => o.Account__c));

  // Score accounts
  type ScoredEntry = {
    accountId: string; accountName: string; ownerName: string;
    mrr?: number; tier?: string;
    score: number; riskFactors: string[];
    hasRefundRequest: boolean; hasCancelOrder: boolean;
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

    const hasRefundRequest = refundAccountIds.has(account.Id);
    const hasCancelOrder   = cancelOrderAccountIds.has(account.Id);

    if (hasRefundRequest) {
      score = Math.max(0, score - 30);
      riskFactors.push('⚠️ Open refund request');
    }
    if (hasCancelOrder) {
      score = Math.max(0, score - 20);
      riskFactors.push('Open cancellation/pause change order');
    }

    if (score <= threshold || hasRefundRequest || hasCancelOrder) {
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
        hasCancelOrder,
      });
    }
  }

  // Sort: refund requests and cancel orders first (priority override), then by score ascending
  scored.sort((a, b) => {
    const aPriority = (a.hasRefundRequest || a.hasCancelOrder) ? 0 : 1;
    const bPriority = (b.hasRefundRequest || b.hasCancelOrder) ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.score - b.score;
  });

  const results = scored.slice(0, limit);

  const lines: string[] = [
    `# Churn Risk Accounts (score ≤ ${threshold})`,
    `${results.length} accounts flagged | ${accounts.length} active accounts scanned`,
    `Excludes: William Summers accounts | Statuses: ${INACTIVE_STATUS_VALUES.join(', ')}`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    '> Accounts with open Refund Requests or Cancellation Change Orders appear first regardless of score.',
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
        r.hasRefundRequest ? '⚠️ REFUND REQUEST' : '',
        r.hasCancelOrder   ? '🚨 CANCEL ORDER'   : '',
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
