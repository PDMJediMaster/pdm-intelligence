import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import {
  calculateHealthScore,
  detectProducts,
  generateTalkingPoints,
} from '../services/healthScoring.js';
import { PDM_PRODUCT_LIST } from '../constants.js';
import type {
  SalesforceAsset,
  SalesforceBusinessObjective,
  SalesforceRefundRequest,
} from '../types.js';

// ─── Governance Constants ──────────────────────────────────────────────────

/** William Summers user ID — test/admin accounts; excluded from all bulk queries */
export const WILLIAM_SUMMERS_USER_ID = '005PU000001eUQDYA2';

/** Terminal statuses excluded from all operational queries */
const INACTIVE_STATUS_VALUES = ['Cancelled', 'Inactive', 'Expired'];
const INACTIVE_STATUS_SOQL = INACTIVE_STATUS_VALUES.map((s) => `'${s}'`).join(', ');

// ─── Tool Definitions ─────────────────────────────────────────────────────

export const accountManagementTools: Tool[] = [
  {
    name: 'sf_get_weekly_synopsis',
    description:
      'Get a weekly AM digest: accounts with calls scheduled this week, enriched with health ' +
      'tier, MRR, days since last contact, open refund requests, renewal proximity, and flagged ' +
      'risks. Also shows upcoming renewals in 30 days and open refund requests as churn signals. ' +
      'Excludes William Summers accounts and Cancelled/Inactive/Expired accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        owner_id: {
          type: 'string',
          description: 'Filter to a specific AM by Salesforce User ID (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_pre_call_brief',
    description:
      'Get a comprehensive pre-call brief for a Salesforce account. Returns critical alerts, ' +
      'account overview, account intel, budget snapshot, active services, business objectives, ' +
      'AM transition history, Zoom meeting AI summaries, key contacts, recent activity with full ' +
      'notes, open tickets, active opportunities, and health score breakdown. ' +
      'Provide either accountId or accountName.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID (15 or 18 characters)',
        },
        accountName: {
          type: 'string',
          description: 'Account name to search for (used when accountId is not known)',
        },
      },
      required: [],
    },
  },
  {
    name: 'sf_log_account_note',
    description:
      'Log a completed activity (call, email, meeting, or note) against a Salesforce account. ' +
      'Creates a Task record with Status = Completed. Use after any client interaction.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID',
        },
        note: {
          type: 'string',
          description: 'Content of the note or summary of the interaction',
        },
        type: {
          type: 'string',
          enum: ['Call', 'Email', 'Meeting', 'Note'],
          description: 'Type of activity',
        },
        contactId: {
          type: 'string',
          description: 'Optional Salesforce Contact ID to associate with this activity',
        },
        subject: {
          type: 'string',
          description: 'Optional subject line override (defaults to "<Type> — <date>")',
        },
      },
      required: ['accountId', 'note', 'type'],
    },
  },
];

// ─── Input Schemas ────────────────────────────────────────────────────────

const WeeklySynopsisArgs = z.object({
  owner_id: z.string().optional(),
});

const PreCallBriefArgs = z.object({
  accountId:   z.string().optional(),
  accountName: z.string().optional(),
});

const LogNoteArgs = z.object({
  accountId: z.string(),
  note:      z.string().min(1),
  type:      z.enum(['Call', 'Email', 'Meeting', 'Note']),
  contactId: z.string().optional(),
  subject:   z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function healthTier(score: number): string {
  if (score >= 70) return '🟢 Healthy';
  if (score >= 40) return '🟡 At Risk';
  return '🔴 Critical';
}

// ─── Handlers ─────────────────────────────────────────────────────────────

async function handleWeeklySynopsis(rawArgs: unknown): Promise<string> {
  const { owner_id } = WeeklySynopsisArgs.parse(rawArgs ?? {});

  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay()); // Sunday
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);            // Saturday
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr   = weekEnd.toISOString().split('T')[0];
  const in30Days     = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];

  const ownerFilter    = owner_id ? `AND OwnerId = '${owner_id}'` : '';
  const ownerFilterAcc = owner_id ? `AND OwnerId = '${owner_id}'` : '';

  // ── 1. Scheduled calls/meetings this week ────────────────────────────────
  interface ScheduledTask {
    Id: string; WhatId?: string; Subject: string;
    ActivityDate?: string; Type?: string; OwnerId: string;
    Owner?: { Name: string };
  }
  const scheduledTasks = await salesforceService.rawQuery<ScheduledTask>(
    `SELECT Id, WhatId, Subject, ActivityDate, Type, OwnerId, Owner.Name
     FROM Task
     WHERE ActivityDate >= ${weekStartStr}
       AND ActivityDate <= ${weekEndStr}
       AND Status != 'Completed'
       AND WhatId != null
       AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
       ${ownerFilter}
     ORDER BY ActivityDate ASC
     LIMIT 50`
  );

  // Unique account IDs from scheduled tasks
  const scheduledAccountIds = [...new Set(
    scheduledTasks.map((t) => t.WhatId).filter(Boolean) as string[]
  )];

  // ── 2. Enriched account data for scheduled accounts ──────────────────────
  interface ScheduledAccount {
    Id: string; Name: string; Status__c?: string;
    Total_Monthly_Recurring_Amount__c?: number; Tier__c?: string;
    LastActivityDate?: string; Contract_End_Date__c?: string;
    Contract_Renewal_Date__c?: string; Flagged_Status__c?: boolean;
    Delinquent__c?: boolean; Cancellation_or_Pause_Request_Date__c?: string;
    OwnerId: string; Owner?: { Name: string };
  }
  const [scheduledAccounts, openRefundRequests, upcomingRenewals] = await Promise.all([
    scheduledAccountIds.length > 0
      ? salesforceService.rawQuery<ScheduledAccount>(
          `SELECT Id, Name, Status__c, Total_Monthly_Recurring_Amount__c, Tier__c,
                  LastActivityDate, Contract_End_Date__c, Contract_Renewal_Date__c,
                  Flagged_Status__c, Delinquent__c, Cancellation_or_Pause_Request_Date__c,
                  OwnerId, Owner.Name
           FROM Account
           WHERE Id IN (${scheduledAccountIds.map((id) => `'${id}'`).join(',')})
             AND Status__c NOT IN (${INACTIVE_STATUS_SOQL})
             AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'`
        )
      : Promise.resolve([]),

    salesforceService.rawQuery<{ Id: string; Account__c: string; Name: string; Status__c?: string; Refund_Amount__c?: number }>(
      `SELECT Id, Account__c, Name, Status__c, Refund_Amount__c
       FROM Refund_Request__c
       WHERE Status__c != 'Closed'
         AND Account__c != null
       ORDER BY CreatedDate DESC
       LIMIT 100`
    ).catch(() => [] as { Id: string; Account__c: string; Name: string; Status__c?: string; Refund_Amount__c?: number }[]),

    salesforceService.rawQuery<{
      Id: string; Name: string; StageName: string; CloseDate: string;
      Amount?: number; AccountId: string; Account?: { Name: string; Owner?: { Name: string } };
    }>(
      `SELECT Id, Name, StageName, CloseDate, Amount, AccountId, Account.Name, Account.Owner.Name
       FROM Opportunity
       WHERE IsClosed = false
         AND CloseDate >= TODAY
         AND CloseDate <= ${in30Days}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         ${ownerFilter}
       ORDER BY CloseDate ASC
       LIMIT 25`
    ),
  ]);

  // Build refund map by account
  const refundsByAccount = new Map<string, typeof openRefundRequests>();
  for (const r of openRefundRequests) {
    if (!refundsByAccount.has(r.Account__c)) refundsByAccount.set(r.Account__c, []);
    refundsByAccount.get(r.Account__c)!.push(r);
  }

  // Build tasks map by account
  const tasksByAccount = new Map<string, typeof scheduledTasks>();
  for (const t of scheduledTasks) {
    if (!t.WhatId) continue;
    if (!tasksByAccount.has(t.WhatId)) tasksByAccount.set(t.WhatId, []);
    tasksByAccount.get(t.WhatId)!.push(t);
  }

  const lines: string[] = [
    `# Weekly Synopsis — Week of ${weekStartStr}`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
  ];

  // ── Section 1: Scheduled Calls This Week ────────────────────────────────
  lines.push(`## 📞 Scheduled Calls This Week (${scheduledAccounts.length} accounts)`);

  if (scheduledAccounts.length === 0) {
    lines.push('No calls scheduled this week.');
  } else {
    for (const acct of scheduledAccounts) {
      const refunds = refundsByAccount.get(acct.Id) ?? [];
      const tasks   = tasksByAccount.get(acct.Id) ?? [];
      const mrr     = acct.Total_Monthly_Recurring_Amount__c
        ? `$${acct.Total_Monthly_Recurring_Amount__c.toLocaleString()}/mo`
        : 'MRR unknown';
      const lastContact = daysSince(acct.LastActivityDate);
      const renewalDays = daysUntil(acct.Contract_Renewal_Date__c ?? acct.Contract_End_Date__c);
      const ownerName   = (acct.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';

      // Proxy health score from activity + renewal dates
      const daysSinceActivity = lastContact;
      let proxyScore = 100;
      if (daysSinceActivity === null) proxyScore -= 40;
      else if (daysSinceActivity > 60) proxyScore -= 35;
      else if (daysSinceActivity > 30) proxyScore -= 20;
      if (renewalDays !== null && renewalDays < 0)    proxyScore -= 30;
      else if (renewalDays !== null && renewalDays <= 30) proxyScore -= 20;
      if (acct.Delinquent__c)                          proxyScore -= 20;
      if (acct.Flagged_Status__c)                      proxyScore -= 10;
      if (acct.Cancellation_or_Pause_Request_Date__c)  proxyScore -= 25;
      proxyScore = Math.max(0, proxyScore);

      const tier = acct.Tier__c ? ` | Tier: ${acct.Tier__c}` : '';
      lines.push(`### ${acct.Name}`);
      lines.push(
        `${healthTier(proxyScore)} (${proxyScore}/100) | ${mrr}${tier} | ` +
        `Owner: ${ownerName} | Status: ${acct.Status__c ?? 'Unknown'}`
      );

      // Alerts
      if (refunds.length > 0) {
        lines.push(`⚠️ **OPEN REFUND REQUEST** — ${refunds[0].Name}${refunds.length > 1 ? ` (+${refunds.length - 1} more)` : ''}`);
      }
      if (acct.Cancellation_or_Pause_Request_Date__c) {
        lines.push(`🚨 **Cancellation/Pause Request on file** (${acct.Cancellation_or_Pause_Request_Date__c})`);
      }
      if (acct.Delinquent__c) lines.push(`💳 **Delinquent account**`);
      if (acct.Flagged_Status__c) lines.push(`🚩 **Flagged for attention**`);

      // Contact + renewal
      lines.push(
        `Last contact: ${lastContact !== null ? `${lastContact}d ago` : 'Never'} | ` +
        `Renewal: ${renewalDays !== null ? `${renewalDays}d` : 'Unknown'}`
      );

      // Scheduled tasks
      for (const t of tasks) {
        lines.push(`  📅 ${t.ActivityDate}: ${t.Type ?? 'Task'} — ${t.Subject}`);
      }
      lines.push('');
    }
  }

  // ── Section 2: Upcoming Renewals (30 days) ───────────────────────────────
  lines.push(`## 🔄 Renewals Closing in Next 30 Days (${upcomingRenewals.length})`);
  if (upcomingRenewals.length === 0) {
    lines.push('No renewals closing in the next 30 days.');
  } else {
    for (const r of upcomingRenewals) {
      const days = daysUntil(r.CloseDate) ?? 0;
      const amt  = r.Amount ? ` — $${r.Amount.toLocaleString()}` : '';
      const owner = r.Account?.Owner?.Name ?? 'Unknown';
      lines.push(
        `- **${r.Account?.Name ?? r.AccountId}** | ${r.StageName} | ` +
        `Closes ${r.CloseDate} (${days}d)${amt} | Owner: ${owner}`
      );
    }
  }
  lines.push('');

  // ── Section 3: Open Refund Requests ─────────────────────────────────────
  lines.push(`## ⚠️ Open Refund Requests — Churn Signals (${openRefundRequests.length})`);
  if (openRefundRequests.length === 0) {
    lines.push('No open refund requests. ✅');
  } else {
    for (const r of openRefundRequests.slice(0, 15)) {
      const amt = r.Refund_Amount__c ? ` — $${r.Refund_Amount__c.toLocaleString()}` : '';
      lines.push(`- **${r.Name}**${amt} | Status: ${r.Status__c ?? 'Open'}`);
    }
    if (openRefundRequests.length > 15) {
      lines.push(`*...and ${openRefundRequests.length - 15} more*`);
    }
  }

  return lines.join('\n');
}

async function handlePreCallBrief(rawArgs: unknown): Promise<string> {
  const { accountId, accountName } = PreCallBriefArgs.parse(rawArgs);

  if (!accountId && !accountName) {
    throw new Error('Provide either accountId or accountName.');
  }

  let resolvedId = accountId;
  let resolvedName = '';

  if (!resolvedId && accountName) {
    const matches = await salesforceService.searchAccountsByName(accountName);
    if (matches.length === 0) throw new Error(`No active account found matching "${accountName}".`);
    if (matches.length > 1) {
      const names = matches.map((m) => `${m.Name} (${m.Id})`).join('\n  ');
      throw new Error(`Multiple accounts match "${accountName}". Please specify accountId:\n  ${names}`);
    }
    resolvedId = matches[0].Id;
    resolvedName = matches[0].Name;
  }

  const id = resolvedId!;

  // ── 10 parallel queries ────────────────────────────────────────────────
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString().split('T')[0];

  interface FullAccount {
    Id: string; Name: string; Phone?: string; Website?: string;
    BillingCity?: string; BillingState?: string;
    OwnerId: string; Owner?: { Name: string; Email?: string };
    Status__c?: string; TCI_Status__c?: string; TCI_Enrolled__c?: boolean;
    Account_Manager_Lookup__c?: string; Account_Manager_Lookup__r?: { Name: string; Email?: string };
    Account_Manager_Email__c?: string;
    Total_Monthly_Recurring_Amount__c?: number; Tier__c?: string;
    Management_Fee__c?: number; Budget__c?: number; SEO_Budget__c?: number; Social_Budget__c?: number;
    Contract_Start_Date__c?: string; Contract_End_Date__c?: string; Contract_Renewal_Date__c?: string;
    Last_Call__c?: string; LastActivityDate?: string;
    Next_Alignment_Call__c?: string; AM_Spoke_to_Doctor__c?: string;
    Engagement_Status__c?: string; Flagged_Status__c?: boolean; Delinquent__c?: boolean;
    Cancellation_or_Pause_Request_Date__c?: string; Upsell_Opportunity__c?: string;
    Account_Intel__c?: string; Specialty__c?: string; Phase__c?: string;
  }
  interface EnrichedContact {
    Id: string; Name: string; FirstName?: string; LastName: string;
    Title?: string; Email?: string; Phone?: string; MobilePhone?: string;
    Doctor__c?: boolean; Primary_Contact__c?: boolean; Contact_Type__c?: string; Status__c?: string;
  }
  interface FullTask {
    Id: string; Subject: string; Description?: string; Type?: string;
    ActivityDate?: string; CreatedDate: string; Status: string;
    OwnerId: string;
    Spoke_with_Doctor__c?: boolean;
    ZVC__Zoom_Meeting__c?: string;
    ZVC__Zoom_Meeting__r?: {
      ZVC__Meeting_AI_Summary__c?: string;
      ZVC__Meeting_Topic__c?: string;
    } | null;
  }
  interface Reassignment {
    Id: string; Name: string;
    Previous_AM__c?: string; Previous_AM__r?: { Name: string };
    New_AM__c?: string; New_AM__r?: { Name: string };
    Transition_Date__c?: string; Reason__c?: string;
    CreatedDate: string;
  }

  const [
    accountRaw,
    contacts,
    openCases,
    recentCases,
    tasks,
    opportunities,
    lineItems,
    assets,
    businessObjectives,
    refundRequests,
    reassignments,
    zoomTasks,
  ] = await Promise.all([
    salesforceService.rawQuery<FullAccount>(
      `SELECT Id, Name, Phone, Website, BillingCity, BillingState,
              OwnerId, Owner.Name, Owner.Email,
              Status__c, TCI_Status__c, TCI_Enrolled__c,
              Account_Manager_Lookup__c, Account_Manager_Lookup__r.Name, Account_Manager_Lookup__r.Email,
              Account_Manager_Email__c,
              Total_Monthly_Recurring_Amount__c, Tier__c, Management_Fee__c,
              Budget__c, SEO_Budget__c, Social_Budget__c,
              Contract_Start_Date__c, Contract_End_Date__c, Contract_Renewal_Date__c,
              Last_Call__c, LastActivityDate, Next_Alignment_Call__c, AM_Spoke_to_Doctor__c,
              Engagement_Status__c, Flagged_Status__c, Delinquent__c,
              Cancellation_or_Pause_Request_Date__c, Upsell_Opportunity__c,
              Account_Intel__c, Specialty__c, Phase__c
       FROM Account WHERE Id = '${id}'`
    ).then((r) => r[0]),

    salesforceService.rawQuery<EnrichedContact>(
      `SELECT Id, Name, FirstName, LastName, Title, Email, Phone, MobilePhone,
              Doctor__c, Primary_Contact__c, Contact_Type__c, Status__c
       FROM Contact
       WHERE AccountId = '${id}' AND (Status__c = 'Active' OR Status__c = null)
       ORDER BY Doctor__c DESC NULLS LAST, Primary_Contact__c DESC NULLS LAST, LastName ASC
       LIMIT 10`
    ),

    salesforceService.getCases(id, { openOnly: true }),

    salesforceService.getCases(id, { since: since90 }),

    salesforceService.rawQuery<FullTask>(
      `SELECT Id, Subject, Description, Type, ActivityDate, CreatedDate, Status,
              Spoke_with_Doctor__c,
              ZVC__Zoom_Meeting__c,
              ZVC__Zoom_Meeting__r.ZVC__Meeting_AI_Summary__c,
              ZVC__Zoom_Meeting__r.ZVC__Meeting_Topic__c
       FROM Task
       WHERE WhatId = '${id}'
         AND ActivityDate >= ${since90}
       ORDER BY ActivityDate DESC NULLS LAST
       LIMIT 20`
    ),

    salesforceService.getOpportunities(id, { isClosed: false }),

    salesforceService.getOpportunityLineItems(id),

    salesforceService.rawQuery<SalesforceAsset>(
      `SELECT Id, AccountId, Name, Status, Product2Id, Product2.Name,
              InstallDate, UsageEndDate, Quantity, Price, Description
       FROM Asset
       WHERE AccountId = '${id}' AND Status = 'Installed'
       ORDER BY InstallDate DESC NULLS LAST
       LIMIT 20`
    ).catch(() => [] as SalesforceAsset[]),

    salesforceService.rawQuery<SalesforceBusinessObjective>(
      `SELECT Id, Account__c, Name, Objective__c, Status__c, Target_Date__c, Notes__c, CreatedDate
       FROM Business_Objectives__c
       WHERE Account__c = '${id}'
       ORDER BY CreatedDate DESC
       LIMIT 10`
    ).catch(() => [] as SalesforceBusinessObjective[]),

    salesforceService.rawQuery<SalesforceRefundRequest>(
      `SELECT Id, Account__c, Name, Status__c, Refund_Amount__c, Reason__c, CreatedDate
       FROM Refund_Request__c
       WHERE Account__c = '${id}' AND Status__c != 'Closed'
       ORDER BY CreatedDate DESC
       LIMIT 5`
    ).catch(() => [] as SalesforceRefundRequest[]),

    salesforceService.rawQuery<Reassignment>(
      `SELECT Id, Name, Previous_AM__c, Previous_AM__r.Name,
              New_AM__c, New_AM__r.Name, Transition_Date__c, Reason__c, CreatedDate
       FROM Reassignments__c
       WHERE Account__c = '${id}'
       ORDER BY CreatedDate DESC
       LIMIT 5`
    ).catch(() => [] as Reassignment[]),

    salesforceService.rawQuery<FullTask>(
      `SELECT Id, Subject, ActivityDate,
              ZVC__Zoom_Meeting__c,
              ZVC__Zoom_Meeting__r.ZVC__Meeting_AI_Summary__c,
              ZVC__Zoom_Meeting__r.ZVC__Meeting_Topic__c
       FROM Task
       WHERE WhatId = '${id}'
         AND ZVC__Zoom_Meeting__c != null
         AND ActivityDate >= ${new Date(Date.now() - 180 * 86_400_000).toISOString().split('T')[0]}
       ORDER BY ActivityDate DESC NULLS LAST
       LIMIT 3`
    ).catch(() => [] as FullTask[]),
  ]);

  if (!accountRaw) throw new Error(`Account not found: ${id}`);
  resolvedName = accountRaw.Name;

  // Product detection
  const wonOpps = await salesforceService.getOpportunities(id, { isWon: true, limit: 20 });
  const rawProductNames = [
    ...lineItems.map((li) => li.Product2?.Name ?? li.Name ?? ''),
    ...wonOpps.map((o) => o.Name),
    ...assets.map((a) => a.Product2?.Name ?? a.Name),
  ];
  const activeProducts = detectProducts(rawProductNames);

  const healthScore = calculateHealthScore(
    tasks,
    openCases,
    opportunities,
    accountRaw.Contract_End_Date__c
  );

  const nextRenewal = opportunities
    .filter((o) => !o.IsClosed)
    .sort((a, b) => new Date(a.CloseDate).getTime() - new Date(b.CloseDate).getTime())[0];
  const renewalDaysUntil = nextRenewal
    ? Math.floor((new Date(nextRenewal.CloseDate).getTime() - Date.now()) / 86_400_000)
    : undefined;

  const talkingPoints = generateTalkingPoints(healthScore, activeProducts, openCases, renewalDaysUntil);

  // ── Format output ──────────────────────────────────────────────────────
  const lines: string[] = [
    `# Pre-Call Brief: ${resolvedName}`,
    `*Generated ${new Date().toLocaleString()}*`,
    '',
  ];

  // Critical Alerts
  const alerts: string[] = [];
  if (refundRequests.length > 0) {
    const amt = refundRequests[0].Refund_Amount__c
      ? ` — $${refundRequests[0].Refund_Amount__c.toLocaleString()}`
      : '';
    alerts.push(`🚨 OPEN REFUND REQUEST: ${refundRequests[0].Name}${amt}`);
  }
  if (accountRaw.Cancellation_or_Pause_Request_Date__c) {
    alerts.push(`🚨 CANCELLATION/PAUSE REQUEST on file (${accountRaw.Cancellation_or_Pause_Request_Date__c})`);
  }
  if (accountRaw.Delinquent__c) alerts.push(`💳 DELINQUENT ACCOUNT`);
  if (accountRaw.Flagged_Status__c) alerts.push(`🚩 FLAGGED FOR ATTENTION`);
  if (openCases.some((c) => c.Priority === 'High' || c.IsEscalated)) {
    alerts.push(`⚠️ HIGH-PRIORITY OPEN CASE`);
  }
  const contractRenewalDate = accountRaw.Contract_Renewal_Date__c ?? accountRaw.Contract_End_Date__c;
  const renewalDaysFromContract = daysUntil(contractRenewalDate);
  if (renewalDaysFromContract !== null && renewalDaysFromContract <= 30 && renewalDaysFromContract >= 0) {
    alerts.push(`🔄 CONTRACT RENEWS IN ${renewalDaysFromContract} DAYS (${contractRenewalDate})`);
  }

  if (alerts.length > 0) {
    lines.push('## 🚨 Critical Alerts');
    for (const a of alerts) lines.push(`- ${a}`);
    lines.push('');
  }

  // Account Overview
  const ownerName = (accountRaw.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
  const amName    = (accountRaw.Account_Manager_Lookup__r as { Name?: string } | undefined)?.Name;
  const mrr       = accountRaw.Total_Monthly_Recurring_Amount__c
    ? `$${accountRaw.Total_Monthly_Recurring_Amount__c.toLocaleString()}/mo`
    : 'Not set';
  const lastContactDays = daysSince(accountRaw.LastActivityDate);
  const doctorContactDays = daysSince(accountRaw.AM_Spoke_to_Doctor__c);

  lines.push('## Account Overview');
  lines.push(`- **Salesforce ID:** ${accountRaw.Id}`);
  lines.push(`- **Owner:** ${ownerName}${amName && amName !== ownerName ? ` | AM: ${amName}` : ''}`);
  lines.push(`- **Status:** ${accountRaw.Status__c ?? 'Unknown'} | TCI: ${accountRaw.TCI_Status__c ?? 'N/A'}`);
  lines.push(`- **MRR:** ${mrr} | Tier: ${accountRaw.Tier__c ?? 'N/A'}`);
  lines.push(`- **Last Contact:** ${lastContactDays !== null ? `${lastContactDays} days ago` : 'Never'}`);
  lines.push(`- **Doctor Last Contacted:** ${doctorContactDays !== null ? `${doctorContactDays} days ago` : 'Not recorded'}`);
  if (accountRaw.Next_Alignment_Call__c) {
    lines.push(`- **Next Alignment Call:** ${accountRaw.Next_Alignment_Call__c}`);
  }
  if (accountRaw.Engagement_Status__c) {
    lines.push(`- **Engagement Status:** ${accountRaw.Engagement_Status__c}`);
  }
  if (contractRenewalDate) {
    lines.push(`- **Contract Renewal:** ${contractRenewalDate}${renewalDaysFromContract !== null ? ` (${renewalDaysFromContract}d)` : ''}`);
  }
  if (accountRaw.Specialty__c) lines.push(`- **Specialty:** ${accountRaw.Specialty__c}`);
  if (accountRaw.Phase__c)     lines.push(`- **Phase:** ${accountRaw.Phase__c}`);
  lines.push('');

  // Account Intel
  if (accountRaw.Account_Intel__c) {
    lines.push('## Account Intel');
    lines.push(accountRaw.Account_Intel__c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    lines.push('');
  }

  // Budget Snapshot
  const hasBudget = accountRaw.Management_Fee__c || accountRaw.Budget__c ||
                    accountRaw.SEO_Budget__c || accountRaw.Social_Budget__c;
  if (hasBudget) {
    lines.push('## Budget Snapshot');
    if (accountRaw.Management_Fee__c) lines.push(`- Management Fee: $${accountRaw.Management_Fee__c.toLocaleString()}/mo`);
    if (accountRaw.Budget__c)         lines.push(`- Total Budget: $${accountRaw.Budget__c.toLocaleString()}`);
    if (accountRaw.SEO_Budget__c)     lines.push(`- SEO Budget: $${accountRaw.SEO_Budget__c.toLocaleString()}`);
    if (accountRaw.Social_Budget__c)  lines.push(`- Social Budget: $${accountRaw.Social_Budget__c.toLocaleString()}`);
    lines.push('');
  }

  // Active Services (Assets)
  lines.push(`## Active Services (${assets.length})`);
  if (assets.length === 0) {
    lines.push('No installed Asset records found. Check Opportunity Line Items for product history.');
  } else {
    for (const a of assets) {
      const product = a.Product2?.Name ?? a.Name;
      const end = a.UsageEndDate ? ` | Ends: ${a.UsageEndDate}` : '';
      lines.push(`- **${product}**${end}`);
    }
  }
  lines.push('');

  // Active PDM Products (from product detection)
  lines.push('## Active PDM Products');
  if (activeProducts.length > 0) {
    lines.push(...activeProducts.map((p) => `- ${p}`));
  } else {
    lines.push('No product data found in Salesforce.');
  }
  const missingProducts = PDM_PRODUCT_LIST.filter((p) => !activeProducts.includes(p));
  if (missingProducts.length > 0) {
    lines.push(`\n*Not currently using: ${missingProducts.join(', ')}*`);
  }
  lines.push('');

  // Business Objectives
  if (businessObjectives.length > 0) {
    lines.push(`## Business Objectives (${businessObjectives.length})`);
    for (const obj of businessObjectives) {
      const status = obj.Status__c ? ` [${obj.Status__c}]` : '';
      const target = obj.Target_Date__c ? ` | Target: ${obj.Target_Date__c}` : '';
      lines.push(`- **${obj.Name}**${status}${target}`);
      if (obj.Objective__c) lines.push(`  ${obj.Objective__c}`);
    }
    lines.push('');
  }

  // AM Transition History
  if (reassignments.length > 0) {
    lines.push(`## AM Transition History`);
    for (const r of reassignments) {
      const prevAM = (r.Previous_AM__r as { Name?: string } | undefined)?.Name ?? 'Unknown';
      const newAM  = (r.New_AM__r as { Name?: string } | undefined)?.Name ?? 'Unknown';
      const date   = r.Transition_Date__c ?? r.CreatedDate.split('T')[0];
      lines.push(`- ${date}: ${prevAM} → ${newAM}${r.Reason__c ? ` (${r.Reason__c})` : ''}`);
    }
    lines.push('');
  }

  // Zoom Meeting AI Summaries
  const zoomWithSummaries = zoomTasks.filter((t) => t.ZVC__Zoom_Meeting__r?.ZVC__Meeting_AI_Summary__c);
  if (zoomWithSummaries.length > 0) {
    lines.push('## Zoom Meeting AI Summaries');
    for (const t of zoomWithSummaries) {
      const zm = t.ZVC__Zoom_Meeting__r!;
      const topic = zm.ZVC__Meeting_Topic__c ?? t.Subject ?? 'Meeting';
      lines.push(`### ${t.ActivityDate ?? 'Unknown date'} — ${topic}`);
      lines.push(zm.ZVC__Meeting_AI_Summary__c!);
      lines.push('');
    }
  }

  // Key Contacts
  lines.push('## Key Contacts');
  if (contacts.length === 0) {
    lines.push('No active contacts on record.');
  } else {
    for (const c of contacts) {
      const role   = c.Contact_Type__c ?? (c.Doctor__c ? 'Doctor' : c.Title ?? '');
      const badges = [
        c.Doctor__c          ? '🩺 Doctor'          : '',
        c.Primary_Contact__c ? '⭐ Primary'         : '',
      ].filter(Boolean).join(' ');
      lines.push(
        `- **${c.Name}**${role ? ` (${role})` : ''}${badges ? ` ${badges}` : ''} | ` +
        `${c.Email ?? 'no email'} | ${c.Phone ?? c.MobilePhone ?? 'no phone'}`
      );
    }
  }
  lines.push('');

  // Recent Activity (full notes)
  lines.push('## Recent Activity (Last 90 Days)');
  if (tasks.length === 0) {
    lines.push('No recorded activity in the last 90 days.');
  } else {
    for (const t of tasks.slice(0, 10)) {
      const doctorBadge = t.Spoke_with_Doctor__c ? ' 🩺' : '';
      lines.push(
        `### [${t.ActivityDate ?? t.CreatedDate.split('T')[0]}] ${t.Type ?? 'Task'}: ${t.Subject}${doctorBadge}`
      );
      if (t.Description) {
        const notes = t.Description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        lines.push(notes.slice(0, 800) + (notes.length > 800 ? '...' : ''));
      }
      lines.push('');
    }
  }

  // Open Tickets (Cases)
  lines.push(`## Open Tickets (${openCases.length})`);
  if (openCases.length === 0) {
    lines.push('No open tickets. ✅');
  } else {
    for (const c of openCases) {
      const ageDays = Math.floor((Date.now() - new Date(c.CreatedDate).getTime()) / 86_400_000);
      lines.push(
        `- [${c.CaseNumber}] **${c.Subject}** | ${c.Priority} priority | Open ${ageDays} day(s)` +
        (c.IsEscalated ? ' ⚠️ Escalated' : '')
      );
    }
  }
  lines.push('');

  // Active Opportunities
  if (opportunities.length > 0) {
    lines.push('## Active Opportunities');
    for (const o of opportunities) {
      const days = Math.floor((new Date(o.CloseDate).getTime() - Date.now()) / 86_400_000);
      const amt  = o.Amount ? ` — $${o.Amount.toLocaleString()}` : '';
      lines.push(`- **${o.Name}** | ${o.StageName} | Closes ${o.CloseDate} (${days}d)${amt}`);
    }
    lines.push('');
  }

  // Health Score Breakdown
  lines.push(`## Health Score: ${healthScore.overall}/100 — ${healthScore.rating}`);
  lines.push(`- Engagement (40%): ${healthScore.engagement}/100 — ${healthScore.breakdown.engagementDetails}`);
  lines.push(`- Case Health (30%): ${healthScore.cases}/100 — ${healthScore.breakdown.casesDetails}`);
  lines.push(`- Renewal (30%):     ${healthScore.renewal}/100 — ${healthScore.breakdown.renewalDetails}`);
  lines.push('');

  // Suggested Talking Points
  lines.push('## Suggested Talking Points');
  if (talkingPoints.length === 0) {
    lines.push('No specific talking points flagged.');
  } else {
    lines.push(...talkingPoints.map((p) => `- ${p}`));
  }

  return lines.join('\n');
}

async function handleLogNote(rawArgs: unknown): Promise<string> {
  const { accountId, note, type, contactId, subject } = LogNoteArgs.parse(rawArgs);

  const today = new Date().toISOString().split('T')[0];
  const resolvedSubject = subject ?? `${type} — ${today}`;

  const taskId = await salesforceService.createTask({
    whatId:       accountId,
    whoId:        contactId,
    subject:      resolvedSubject,
    description:  note,
    type,
    status:       'Completed',
    activityDate: today,
  });

  return [
    `✅ Activity logged successfully.`,
    `**Type:** ${type}`,
    `**Subject:** ${resolvedSubject}`,
    `**Salesforce Task ID:** ${taskId}`,
    `**Account ID:** ${accountId}`,
  ].join('\n');
}

// ─── Router ───────────────────────────────────────────────────────────────

export const accountManagementHandlers: Record<
  string,
  (args: unknown) => Promise<string>
> = {
  sf_get_weekly_synopsis: handleWeeklySynopsis,
  sf_get_pre_call_brief:  handlePreCallBrief,
  sf_log_account_note:    handleLogNote,
};
