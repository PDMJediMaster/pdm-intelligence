import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import {
  calculateHealthScore,
  detectProducts,
  generateTalkingPoints,
} from '../services/healthScoring.js';
import { PDM_PRODUCT_LIST, PRODUCT_KEYWORDS } from '../constants.js';
import type {
  SalesforceAsset,
  SalesforceBusinessObjective,
  SalesforceRefundRequest,
} from '../types.js';
import {
  analyzeSentiment,
  formatSentimentSection,
  analyzeProductMentions,
  formatProductMentionsSection,
} from '../services/sentimentEngine.js';

// ─── Governance Constants ──────────────────────────────────────────────────

/** William Summers user ID — test/admin accounts; excluded from all bulk queries */
export const WILLIAM_SUMMERS_USER_ID = '005PU000001eUQDYA2';

/** Terminal statuses excluded from all operational queries */
const INACTIVE_STATUS_VALUES = ['Cancelled', 'Inactive', 'Expired'];
const INACTIVE_STATUS_SOQL = INACTIVE_STATUS_VALUES.map((s) => `'${s}'`).join(', ');

/**
 * Standard active-client filter. Excludes terminal statuses AND null status (TCI ticket
 * buyers / converted leads that never became clients). Use on every bulk Account query.
 */
const ACTIVE_CLIENT_FILTER = `Status__c NOT IN (${INACTIVE_STATUS_SOQL}) AND Status__c != null`;

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
    AM_Spoke_to_Doctor__c?: string;
    OwnerId: string; Owner?: { Name: string };
  }
  // ── Orphaned Zoom Tasks (unlinked to any account) — last 14 days ──────────
  interface OrphanTask {
    Id: string; Subject?: string; ActivityDate?: string; OwnerId: string;
    Owner?: { Name: string };
    WhoId?: string; Who?: { Name: string; Email?: string };
    ZVC__Zoom_Meeting__c?: string;
    ZVC__Zoom_Meeting__r?: { ZVC__Meeting_Topic__c?: string } | null;
    ZVC__Zoom_Call_Log__c?: string;
  }
  const orphanLookback    = new Date(Date.now() - 14 * 86_400_000).toISOString().split('T')[0];
  const orphanOwnerFilter = owner_id ? `AND OwnerId = '${owner_id}'` : '';

  const [scheduledAccounts, openRefundRequests, upcomingRenewals, orphanedZoomTasks] = await Promise.all([
    scheduledAccountIds.length > 0
      ? salesforceService.rawQuery<ScheduledAccount>(
          `SELECT Id, Name, Status__c, Total_Monthly_Recurring_Amount__c, Tier__c,
                  LastActivityDate, Contract_End_Date__c, Contract_Renewal_Date__c,
                  Flagged_Status__c, Delinquent__c, Cancellation_or_Pause_Request_Date__c,
                  AM_Spoke_to_Doctor__c, OwnerId, Owner.Name
           FROM Account
           WHERE Id IN (${scheduledAccountIds.map((id) => `'${id}'`).join(',')})
             AND ${ACTIVE_CLIENT_FILTER}
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
      Id: string; Name: string; Status__c?: string;
      Contract_Renewal_Date__c: string;
      Total_Monthly_Recurring_Amount__c?: number;
      OwnerId: string; Owner?: { Name: string };
    }>(
      `SELECT Id, Name, Status__c, Contract_Renewal_Date__c, Total_Monthly_Recurring_Amount__c, OwnerId, Owner.Name
       FROM Account
       WHERE Contract_Renewal_Date__c >= TODAY
         AND Contract_Renewal_Date__c <= ${in30Days}
         AND ${ACTIVE_CLIENT_FILTER}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         ${ownerFilterAcc}
       ORDER BY Contract_Renewal_Date__c ASC
       LIMIT 25`
    ),

    // Orphaned Zoom meetings (no WhatId) — last 14 days
    salesforceService.rawQuery<OrphanTask>(
      `SELECT Id, Subject, ActivityDate, OwnerId, Owner.Name,
              WhoId, Who.Name, Who.Email,
              ZVC__Zoom_Meeting__c,
              ZVC__Zoom_Meeting__r.ZVC__Meeting_Topic__c,
              ZVC__Zoom_Call_Log__c
       FROM Task
       WHERE (ZVC__Zoom_Meeting__c != null OR ZVC__Zoom_Call_Log__c != null)
         AND WhatId = null
         AND ActivityDate >= ${orphanLookback}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         ${orphanOwnerFilter}
       ORDER BY ActivityDate DESC
       LIMIT 25`
    ).catch(() => [] as OrphanTask[]),
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

  // ── Section 0: Orphaned Zoom Activity Alert (shown FIRST if any exist) ───
  if (orphanedZoomTasks.length > 0) {
    lines.push(`## 🚨 ACTION REQUIRED — ${orphanedZoomTasks.length} Zoom Call${orphanedZoomTasks.length > 1 ? 's' : ''} Not Linked to Any Account`);
    lines.push('*These recordings exist in Salesforce but have no account attached. Prophet cannot score them. Your health scores may be wrong until you fix this.*');
    lines.push('');
    for (const t of orphanedZoomTasks) {
      const callType = t.ZVC__Zoom_Meeting__c ? '🎥 Meeting' : '📞 Phone Call';
      const topic    = (t.ZVC__Zoom_Meeting__r as { ZVC__Meeting_Topic__c?: string } | null | undefined)?.ZVC__Meeting_Topic__c;
      const subject  = topic ?? t.Subject ?? 'Zoom Activity';
      const who      = t.Who as { Name?: string; Email?: string } | undefined;
      const contact  = who?.Name ? ` | Contact: ${who.Name}` : '';
      const amName   = (t.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
      lines.push(`- ${callType} **${t.ActivityDate ?? 'Unknown date'}** — ${subject}${contact} | AM: ${amName}`);
    }
    lines.push('');
    lines.push('**To fix:** Open each call in Salesforce → Edit → set the Account field. Or ask Prophet to link them for you.');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

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

      // Contact + renewal + doctor contact
      const doctorDays = daysSince(acct.AM_Spoke_to_Doctor__c);
      const doctorBadge = doctorDays === null
        ? '🩺 Doctor: Never contacted'
        : doctorDays > 60
          ? `🩺 Doctor: ${doctorDays}d ago ⚠️`
          : doctorDays > 30
            ? `🩺 Doctor: ${doctorDays}d ago`
            : `🩺 Doctor: ${doctorDays}d ago ✅`;

      // If LastActivityDate is null (no completed activity), show scheduled call context
      const nextScheduledDate = tasks.length > 0 ? tasks[0].ActivityDate : null;
      const lastContactStr = lastContact !== null
        ? `${lastContact}d ago`
        : nextScheduledDate
          ? `No logged activity (call scheduled ${nextScheduledDate})`
          : 'Never';

      lines.push(
        `Last contact: ${lastContactStr} | ` +
        `Renewal: ${renewalDays !== null ? `${renewalDays}d` : 'Unknown'} | ${doctorBadge}`
      );

      // Scheduled tasks
      for (const t of tasks) {
        lines.push(`  📅 ${t.ActivityDate}: ${t.Type ?? 'Task'} — ${t.Subject}`);
      }
      lines.push('');
    }
  }

  // ── Section 2: Upcoming Renewals (30 days) ───────────────────────────────
  lines.push(`## 🔄 Renewals in Next 30 Days (${upcomingRenewals.length})`);
  if (upcomingRenewals.length === 0) {
    lines.push('No contract renewals in the next 30 days.');
  } else {
    for (const r of upcomingRenewals) {
      const days  = daysUntil(r.Contract_Renewal_Date__c) ?? 0;
      const mrr   = r.Total_Monthly_Recurring_Amount__c
        ? ` — $${r.Total_Monthly_Recurring_Amount__c.toLocaleString()}/mo MRR`
        : '';
      const owner = (r.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
      const urgencyFlag = days <= 7 ? ' 🚨' : days <= 14 ? ' ⚠️' : '';
      lines.push(
        `- **${r.Name}** | ${r.Status__c ?? 'Unknown'} | ` +
        `Renews ${r.Contract_Renewal_Date__c} (${days}d)${mrr} | Owner: ${owner}${urgencyFlag}`
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
  lines.push('');

  // ── Section 4: Doctor Contact Coaching ───────────────────────────────────
  const neverContacted   = scheduledAccounts.filter((a) => !a.AM_Spoke_to_Doctor__c);
  const over60Days       = scheduledAccounts.filter((a) => {
    const d = daysSince(a.AM_Spoke_to_Doctor__c);
    return d !== null && d > 60;
  });
  const between30and60   = scheduledAccounts.filter((a) => {
    const d = daysSince(a.AM_Spoke_to_Doctor__c);
    return d !== null && d > 30 && d <= 60;
  });
  const recentDoctor     = scheduledAccounts.filter((a) => {
    const d = daysSince(a.AM_Spoke_to_Doctor__c);
    return d !== null && d <= 30;
  });

  lines.push('## 🩺 Doctor Contact Coaching');
  lines.push('*AMs who regularly reach the doctor have dramatically lower churn rates.*');
  lines.push('');

  if (neverContacted.length > 0) {
    lines.push(`**🔴 Never contacted doctor (${neverContacted.length}):**`);
    for (const a of neverContacted) {
      lines.push(`- ${a.Name} (Owner: ${(a.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown'})`);
    }
    lines.push('');
  }

  if (over60Days.length > 0) {
    lines.push(`**🟠 Doctor last contacted 60+ days ago (${over60Days.length}):**`);
    for (const a of over60Days) {
      const d = daysSince(a.AM_Spoke_to_Doctor__c)!;
      lines.push(`- ${a.Name} — ${d}d ago`);
    }
    lines.push('');
  }

  if (between30and60.length > 0) {
    lines.push(`**🟡 Doctor last contacted 30–60 days ago (${between30and60.length}):**`);
    for (const a of between30and60) {
      const d = daysSince(a.AM_Spoke_to_Doctor__c)!;
      lines.push(`- ${a.Name} — ${d}d ago`);
    }
    lines.push('');
  }

  if (recentDoctor.length > 0) {
    lines.push(`**🟢 Doctor contacted within 30 days (${recentDoctor.length}):** ✅`);
    for (const a of recentDoctor) {
      const d = daysSince(a.AM_Spoke_to_Doctor__c)!;
      lines.push(`- ${a.Name} — ${d}d ago`);
    }
    lines.push('');
  }

  if (scheduledAccounts.length === 0) {
    lines.push('No scheduled accounts to evaluate.');
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
    Contract_End_Date__c?: string; Contract_Renewal_Date__c?: string;
    LastActivityDate?: string;
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

  interface ClientOnboarding {
    Id: string;
    Name: string;
    Marketing_Launch_Date__c?: string;
    Marketing_Start_Date__c?: string;
    New_Or_Existing_Client__c?: string;
    Video_Shoot_Done__c?: boolean;
    HL_Creation__c?: string;
    Client_Website__c?: string;
    New_Client_Onboarding_Name__c?: string;
    CreatedDate: string;
  }

  interface CompetitorSnapshot {
    Id: string; Name: string;
    Competitor_Name__c?: string; Competitor_Website__c?: string;
    Google_Review_Count__c?: number; Previous_Review_Count__c?: number;
    Review_Delta__c?: number; Google_Star_Rating__c?: number;
    Running_Google_Ads__c?: boolean; Running_Facebook_Ads__c?: boolean;
    Maps_Pack_Position__c?: number; Competitive_Pressure_Score__c?: number;
    Is_Primary_Competitor__c?: boolean; Snapshot_Date__c?: string;
  }

  interface VideoCallRecord {
    Id: string;
    Name?: string;
    StartDateTime?: string;
    DurationInSeconds?: number;
    IsRecorded?: boolean;
  }

  interface VideoCallParticipantRecord {
    Id: string;
    VideoCallId: string;
    Name?: string;
    Email?: string;
    RelatedPersonId?: string;
  }

  interface UVCPRecord {
    Id: string;
    ActivityId: string;
    PersonId?: string;
    ParticipantType?: string;
    TalkRatio?: number;
    ListenRatio?: number;
  }

  interface TciOpportunity {
    Id: string; Name: string; StageName: string; CloseDate: string;
    Amount?: number; Phase__c?: string; Pricebook2?: { Name?: string };
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
    phoneCallTasks,
    competitorSnapshots,
    onboardingRecords,
    tciOpportunities,
  ] = await Promise.all([
    salesforceService.rawQuery<FullAccount>(
      `SELECT Id, Name, Phone, Website, BillingCity, BillingState,
              OwnerId, Owner.Name, Owner.Email,
              Status__c, TCI_Status__c, TCI_Enrolled__c,
              Account_Manager_Lookup__c, Account_Manager_Lookup__r.Name, Account_Manager_Lookup__r.Email,
              Account_Manager_Email__c,
              Total_Monthly_Recurring_Amount__c, Tier__c, Management_Fee__c,
              Budget__c, SEO_Budget__c, Social_Budget__c,
              Contract_End_Date__c, Contract_Renewal_Date__c,
              LastActivityDate, Next_Alignment_Call__c, AM_Spoke_to_Doctor__c,
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
              Spoke_with_Doctor__c,
              ZVC__Zoom_Meeting__c,
              ZVC__Zoom_Meeting__r.ZVC__Meeting_AI_Summary__c,
              ZVC__Zoom_Meeting__r.ZVC__Meeting_Topic__c
       FROM Task
       WHERE WhatId = '${id}'
         AND ZVC__Zoom_Meeting__c != null
         AND ActivityDate >= ${new Date(Date.now() - 180 * 86_400_000).toISOString().split('T')[0]}
       ORDER BY ActivityDate DESC NULLS LAST
       LIMIT 10`
    ).catch(() => [] as FullTask[]),

    salesforceService.rawQuery<{
      Id: string; Subject?: string; ActivityDate?: string;
      Spoke_with_Doctor__c?: boolean;
      ZVC__Zoom_Call_Log__c?: string;
      ZVC__Zoom_Call_Log__r?: { ZVC__AIC_Call_Summary__c?: string } | null;
    }>(
      `SELECT Id, Subject, ActivityDate, Spoke_with_Doctor__c,
              ZVC__Zoom_Call_Log__c,
              ZVC__Zoom_Call_Log__r.ZVC__AIC_Call_Summary__c
       FROM Task
       WHERE WhatId = '${id}'
         AND ZVC__Zoom_Call_Log__c != null
         AND ActivityDate >= ${new Date(Date.now() - 180 * 86_400_000).toISOString().split('T')[0]}
       ORDER BY ActivityDate DESC NULLS LAST
       LIMIT 10`
    ).catch(() => [] as { Id: string; Subject?: string; ActivityDate?: string; Spoke_with_Doctor__c?: boolean; ZVC__Zoom_Call_Log__c?: string; ZVC__Zoom_Call_Log__r?: { ZVC__AIC_Call_Summary__c?: string } | null }[]),

    salesforceService.rawQuery<CompetitorSnapshot>(
      `SELECT Id, Name, Competitor_Name__c, Competitor_Website__c,
              Google_Review_Count__c, Previous_Review_Count__c, Review_Delta__c,
              Google_Star_Rating__c, Running_Google_Ads__c, Running_Facebook_Ads__c,
              Maps_Pack_Position__c, Competitive_Pressure_Score__c,
              Is_Primary_Competitor__c, Snapshot_Date__c
       FROM Competitor_Snapshot__c
       WHERE Account__c = '${id}'
       ORDER BY Is_Primary_Competitor__c DESC NULLS LAST, Competitive_Pressure_Score__c DESC NULLS LAST
       LIMIT 5`
    ).catch(() => [] as CompetitorSnapshot[]),

    salesforceService.rawQuery<ClientOnboarding>(
      `SELECT Id, Name, Marketing_Launch_Date__c, Marketing_Start_Date__c,
              New_Or_Existing_Client__c, Video_Shoot_Done__c, HL_Creation__c,
              Client_Website__c, New_Client_Onboarding_Name__c, CreatedDate
       FROM Client_Onboarding__c
       WHERE Account__c = '${id}'
       ORDER BY CreatedDate DESC
       LIMIT 1`
    ).catch(() => [] as ClientOnboarding[]),

    // TCI Event opportunities — closed-won tickets and event purchases
    salesforceService.rawQuery<TciOpportunity>(
      `SELECT Id, Name, StageName, CloseDate, Amount, Phase__c, Pricebook2.Name
       FROM Opportunity
       WHERE AccountId = '${id}'
         AND IsWon = true
         AND (
           Phase__c = 'TCI Events'
           OR Name LIKE '%FABC%'
           OR Name LIKE '%FAGC%'
           OR Name LIKE '%Bootcamp%'
           OR Name LIKE '%Full Arch Growth Conference%'
           OR Pricebook2.Name LIKE '%TCI Event%'
         )
       ORDER BY CloseDate DESC
       LIMIT 10`
    ).catch(() => [] as TciOpportunity[]),
  ]);

  if (!accountRaw) throw new Error(`Account not found: ${id}`);
  resolvedName = accountRaw.Name;

  // ── TCI Event account detection ───────────────────────────────────────────
  // Primary signal: Status__c = null (universal for TCI ticket buyers / unconverted leads).
  // Secondary signal: has closed-won TCI Event opportunities.
  // Both cases get the same treatment — this is a prospect, not a Phase 2 marketing client.
  const isTCIEventAccount = !accountRaw.Status__c || tciOpportunities.length > 0;

  // Product detection
  const wonOpps = await salesforceService.getOpportunities(id, { isWon: true, limit: 20 });
  const rawProductNames = [
    ...lineItems.map((li) => li.Product2?.Name ?? li.Name ?? ''),
    ...wonOpps.map((o) => o.Name),
    ...assets.map((a) => a.Product2?.Name ?? a.Name),
  ];
  const activeProducts = detectProducts(rawProductNames);

  // ── Doctor Engagement Score queries (sequential — needs contacts first) ──
  const doctorContacts = contacts.filter((c) => c.Doctor__c === true);
  const doctorContactIds = doctorContacts.map((c) => c.Id);
  const videoCallLookback = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const [videoCalls, uvpData] = await Promise.all([
    salesforceService.rawQuery<VideoCallRecord>(
      `SELECT Id, Name, StartDateTime, DurationInSeconds, IsRecorded
       FROM VideoCall
       WHERE RelatedRecordId = '${id}'
         AND StartDateTime >= ${videoCallLookback}
       ORDER BY StartDateTime DESC
       LIMIT 20`
    ).catch(() => [] as VideoCallRecord[]),

    doctorContactIds.length > 0
      ? salesforceService.rawQuery<UVCPRecord>(
          `SELECT Id, ActivityId, PersonId, ParticipantType, TalkRatio, ListenRatio
           FROM UnifiedVideoCallParticipant
           WHERE PersonId IN (${doctorContactIds.map((did) => `'${did}'`).join(',')})
           LIMIT 50`
        ).catch(() => [] as UVCPRecord[])
      : Promise.resolve([] as UVCPRecord[]),
  ]);

  // Get doctor attendance per call (requires VideoCall IDs from above)
  const videoCallIds = videoCalls.map((vc) => vc.Id);
  let callParticipants: VideoCallParticipantRecord[] = [];
  if (videoCallIds.length > 0 && doctorContactIds.length > 0) {
    callParticipants = await salesforceService.rawQuery<VideoCallParticipantRecord>(
      `SELECT Id, VideoCallId, Name, Email, RelatedPersonId
       FROM VideoCallParticipant
       WHERE VideoCallId IN (${videoCallIds.map((vid) => `'${vid}'`).join(',')})
         AND RelatedPersonId IN (${doctorContactIds.map((did) => `'${did}'`).join(',')})
       LIMIT 100`
    ).catch(() => [] as VideoCallParticipantRecord[]);
  }

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

  // TCI Event account — surface at the very top before anything else
  if (isTCIEventAccount) {
    const hasNullStatus  = !accountRaw.Status__c;
    const eventPurchases = tciOpportunities.map(o => {
      const amt = o.Amount ? ` ($${o.Amount.toLocaleString()})` : '';
      const pricebook = o.Pricebook2?.Name ? ` [${o.Pricebook2.Name}]` : '';
      return `${o.Name}${amt}${pricebook} — closed ${o.CloseDate}`;
    });
    alerts.push(
      `🎟️ TCI EVENT ACCOUNT — Conference ticket purchaser, not a Phase 2 marketing client. ` +
      (hasNullStatus ? `Marketing Status not set (Status__c = null). ` : '') +
      (eventPurchases.length > 0
        ? `Ticket purchase(s): ${eventPurchases.join(' | ')}. `
        : `No closed ticket sale found — may be a converted lead. `) +
      `Goal: convert to active Phase 2 client at or after the event.`
    );
  }

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
  if (onboardingRecords.length === 0 && !isTCIEventAccount) {
    alerts.push(`📋 NO CLIENT ONBOARDING RECORD — required for all clients since Feb 1, 2026`);
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
    const alignmentDays = daysUntil(accountRaw.Next_Alignment_Call__c);
    const alignmentFlag = alignmentDays !== null && alignmentDays < 0
      ? ` ⚠️ OVERDUE by ${Math.abs(alignmentDays)}d`
      : alignmentDays !== null && alignmentDays <= 7
        ? ` 📅 in ${alignmentDays}d`
        : '';
    lines.push(`- **Next Alignment Call:** ${accountRaw.Next_Alignment_Call__c}${alignmentFlag}`);
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

  // Client Onboarding Status
  const onboarding = onboardingRecords[0];
  lines.push('## 📋 Client Onboarding Status');
  if (isTCIEventAccount) {
    lines.push('*TCI Event account — Client Onboarding record not required until converted to Phase 2 client.*');
  } else if (!onboarding) {
    lines.push('⚠️ **No Client Onboarding record found.** Required for all clients since Feb 1, 2026.');
    lines.push('*Action: Complete the Client Onboarding screen flow and create a record for this account.*');
  } else {
    lines.push(`**Onboarding Record:** ${onboarding.New_Client_Onboarding_Name__c ?? onboarding.Name}`);
    lines.push(`**Client Type:** ${onboarding.New_Or_Existing_Client__c ?? 'Not set'}`);
    if (onboarding.Marketing_Start_Date__c) lines.push(`**Marketing Start:** ${onboarding.Marketing_Start_Date__c}`);
    if (onboarding.Marketing_Launch_Date__c) lines.push(`**Marketing Launch:** ${onboarding.Marketing_Launch_Date__c}`);
    if (onboarding.Client_Website__c) lines.push(`**Website:** ${onboarding.Client_Website__c}`);
    const videoStatus = onboarding.Video_Shoot_Done__c ? '✅ Complete' : '❌ Not done';
    lines.push(`**Video Shoot:** ${videoStatus}`);
    if (onboarding.HL_Creation__c) lines.push(`**HL Creation:** ${onboarding.HL_Creation__c}`);
    lines.push(`*Record created: ${onboarding.CreatedDate.split('T')[0]}*`);
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

  // ── Services Discussed in Recent Calls ────────────────────────────────
  const callsForProductScan = [
    ...zoomTasks
      .filter((t) => t.ZVC__Zoom_Meeting__r?.ZVC__Meeting_AI_Summary__c)
      .map((t) => ({ date: t.ActivityDate ?? '', summary: t.ZVC__Zoom_Meeting__r!.ZVC__Meeting_AI_Summary__c! })),
    ...phoneCallTasks
      .filter((t) => t.ZVC__Zoom_Call_Log__r?.ZVC__AIC_Call_Summary__c)
      .map((t) => ({ date: t.ActivityDate ?? '', summary: t.ZVC__Zoom_Call_Log__r!.ZVC__AIC_Call_Summary__c! })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  if (callsForProductScan.length > 0) {
    const productMentions = analyzeProductMentions(callsForProductScan, activeProducts, PRODUCT_KEYWORDS);
    lines.push(...formatProductMentionsSection(productMentions, activeProducts));
  }

  // ── Competitive Gap Analysis ───────────────────────────────────────────
  if (competitorSnapshots.length > 0) {
    const primary = competitorSnapshots.find((s) => s.Is_Primary_Competitor__c) ?? competitorSnapshots[0];
    const compName = primary.Competitor_Name__c ?? primary.Name ?? 'Primary Competitor';
    const snapshotDate = primary.Snapshot_Date__c ?? 'recent';
    const pressureScore = primary.Competitive_Pressure_Score__c;

    const clientHasPPC    = activeProducts.some((p) => /ppc|paid|adword|google ad/i.test(p));
    const clientHasSocial = activeProducts.some((p) => /social|facebook|instagram/i.test(p));

    lines.push('## ⚔️ Competitive Gap Analysis — "They\'re Doing This, You\'re Not"');
    lines.push(
      `**Primary Competitor:** ${compName}` +
      `${primary.Competitor_Website__c ? ` (${primary.Competitor_Website__c})` : ''}` +
      `${pressureScore !== undefined ? ` | Pressure Score: ${pressureScore}/100` : ''}` +
      ` | Data as of: ${snapshotDate}`
    );
    lines.push('');

    const gaps: string[] = [];
    const strengths: string[] = [];

    // Reviews
    if (primary.Google_Review_Count__c !== undefined) {
      const reviewStr = `${primary.Google_Review_Count__c} reviews` +
        `${primary.Google_Star_Rating__c ? ` @ ${primary.Google_Star_Rating__c}⭐` : ''}`;
      gaps.push(`📊 **Reviews:** Competitor has ${reviewStr}`);
    }

    // Google Ads
    if (primary.Running_Google_Ads__c) {
      if (!clientHasPPC) {
        gaps.push(`🚨 **Google Ads GAP:** Competitor is running Google Ads — client has NO PPC service`);
      } else {
        strengths.push(`✅ Google Ads: Both running`);
      }
    }

    // Facebook/Social Ads
    if (primary.Running_Facebook_Ads__c) {
      if (!clientHasSocial) {
        gaps.push(`🚨 **Social Ads GAP:** Competitor is running Facebook/Instagram Ads — client has NO social advertising`);
      } else {
        strengths.push(`✅ Social Ads: Both running`);
      }
    }

    // Maps Pack
    if (primary.Maps_Pack_Position__c !== undefined && primary.Maps_Pack_Position__c !== null) {
      const pos = primary.Maps_Pack_Position__c;
      if (pos >= 1 && pos <= 3) {
        gaps.push(`🚨 **Maps Pack GAP:** Competitor ranks #${pos} in the Google Maps Pack`);
      }
    }

    for (const g of gaps) lines.push(`- ${g}`);
    for (const s of strengths) lines.push(`- ${s}`);

    if (gaps.length === 0 && strengths.length === 0) {
      lines.push('- No specific signal gaps detected in stored snapshot data.');
    }

    // Secondary competitors
    if (competitorSnapshots.length > 1) {
      lines.push('');
      lines.push('**Also monitoring:**');
      for (const snap of competitorSnapshots.slice(1)) {
        const name = snap.Competitor_Name__c ?? snap.Name;
        const pressure = snap.Competitive_Pressure_Score__c !== undefined
          ? ` | Pressure: ${snap.Competitive_Pressure_Score__c}/100` : '';
        const reviews = snap.Google_Review_Count__c !== undefined
          ? ` | ${snap.Google_Review_Count__c} reviews` : '';
        lines.push(`- ${name}${reviews}${pressure}`);
      }
    }
    lines.push('');

    // ── "Do Nothing" Projector ─────────────────────────────────────────
    const delta   = primary.Review_Delta__c;
    const current = primary.Google_Review_Count__c;

    if (delta !== undefined && delta !== null && delta > 0 && current !== undefined) {
      // Review_Delta__c = reviews gained since last snapshot (weekly cadence assumed)
      const weeklyGain   = delta;
      const monthlyGain  = Math.round(weeklyGain * 4.3);
      const annualGain   = Math.round(weeklyGain * 52);
      const in3Months    = current + Math.round(weeklyGain * 13);
      const in12Months   = current + annualGain;

      lines.push('## 📉 What Happens If You Do Nothing');
      lines.push(
        `${compName} is gaining ~**${weeklyGain} reviews/week** ` +
        `(currently at ${current}${primary.Google_Star_Rating__c ? ` @ ${primary.Google_Star_Rating__c}⭐` : ''}).`
      );
      lines.push('');
      lines.push(`At this pace, in **3 months** they\'ll have **${in3Months} reviews**.`);
      lines.push(`In **12 months** they\'ll have **${in12Months} reviews** — **+${annualGain} more than today**.`);
      lines.push('');
      lines.push('*Every month without a review strategy widens the gap. This is a math problem, not a marketing opinion.*');
      lines.push('');
    }
  }

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

  // ── Doctor Engagement Score ────────────────────────────────────────────
  if (videoCalls.length > 0 || uvpData.length > 0) {
    const docName = doctorContacts[0]?.Name ?? 'Doctor';
    lines.push('## 🩺 Doctor Engagement Score');

    // Attendance section
    if (videoCalls.length > 0) {
      const callsWithDoctor = new Set(callParticipants.map((p) => p.VideoCallId));
      const attendanceRate  = Math.round((callsWithDoctor.size / videoCalls.length) * 100);

      lines.push(
        `**${docName}** attended **${callsWithDoctor.size} of ${videoCalls.length} calls** ` +
        `in the last 90 days (${attendanceRate}% attendance rate)`
      );

      if (attendanceRate === 0) {
        lines.push('🔴 Doctor has not been on any recorded calls in 90 days — high engagement risk');
      } else if (attendanceRate < 30) {
        lines.push('🔴 Low doctor engagement — under 30% call attendance');
      } else if (attendanceRate < 60) {
        lines.push('🟡 Moderate doctor engagement — target is 60%+ attendance');
      } else {
        lines.push('🟢 Strong doctor engagement — doctor regularly joins calls');
      }
    } else {
      lines.push('No recorded VideoCall records found for this account in the last 90 days.');
    }

    // TalkRatio section
    const talkRatios = uvpData.filter(
      (p) => p.TalkRatio !== undefined && p.TalkRatio !== null
    );
    if (talkRatios.length > 0) {
      const avgTalk   = Math.round(talkRatios.reduce((s, p) => s + (p.TalkRatio ?? 0), 0) / talkRatios.length);
      const avgListen = Math.round(talkRatios.reduce((s, p) => s + (p.ListenRatio ?? 0), 0) / talkRatios.length);
      lines.push(`**Average Talk Ratio:** ${avgTalk}% talking / ${avgListen}% listening (across ${talkRatios.length} CI-recorded calls)`);

      // Trend: data is returned most recent first from the PersonId query — compare halves
      if (talkRatios.length >= 4) {
        const half       = Math.floor(talkRatios.length / 2);
        const recentAvg  = Math.round(talkRatios.slice(0, half).reduce((s, p) => s + (p.TalkRatio ?? 0), 0) / half);
        const olderAvg   = Math.round(talkRatios.slice(half).reduce((s, p) => s + (p.TalkRatio ?? 0), 0) / half);
        const trendLabel = recentAvg > olderAvg + 5
          ? '📈 Increasing — doctor more engaged recently'
          : recentAvg < olderAvg - 5
            ? '📉 Declining — doctor talking less, watch for disengagement'
            : '➡️ Stable';
        lines.push(`**Talk Ratio Trend:** ${trendLabel} (${olderAvg}% → ${recentAvg}%)`);
      }
    } else if (doctorContactIds.length === 0) {
      lines.push('*No doctor contact on record — TalkRatio unavailable.*');
    } else {
      lines.push('*No CI-recorded call data found for the doctor contact.*');
    }

    lines.push('');
  }

  // ── Sentiment Analysis ─────────────────────────────────────────────────
  const sentimentInputs = [
    ...zoomTasks
      .filter((t) => t.ZVC__Zoom_Meeting__r?.ZVC__Meeting_AI_Summary__c)
      .map((t) => ({
        date:        t.ActivityDate ?? '',
        subject:     t.Subject ?? 'Meeting',
        callType:    'meeting' as const,
        summary:     t.ZVC__Zoom_Meeting__r!.ZVC__Meeting_AI_Summary__c!,
        doctorOnCall: t.Spoke_with_Doctor__c ?? false,
      })),
    ...phoneCallTasks
      .filter((t) => t.ZVC__Zoom_Call_Log__r?.ZVC__AIC_Call_Summary__c)
      .map((t) => ({
        date:        t.ActivityDate ?? '',
        subject:     t.Subject ?? 'Call',
        callType:    'call' as const,
        summary:     t.ZVC__Zoom_Call_Log__r!.ZVC__AIC_Call_Summary__c!,
        doctorOnCall: t.Spoke_with_Doctor__c ?? false,
      })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

  const sentiment = analyzeSentiment(sentimentInputs);

  // Add sentiment alert to critical alerts if needed
  if (sentiment.hasAlert) {
    if (sentiment.competitorMentions.length > 0) {
      alerts.push(`🚨 COMPETITOR MENTIONED IN CALLS: ${sentiment.competitorMentions.join(', ')}`);
    }
    if (sentiment.trend === 'Declining') {
      alerts.push(`📉 SENTIMENT DECLINING — last call scored ${sentiment.callBreakdown[0]?.score ?? '?'}/100`);
    }
    if (sentiment.overallLabel === 'Critical') {
      alerts.push(`🚨 CRITICAL SENTIMENT — overall score ${sentiment.overallScore}/100`);
    }
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

  // Sentiment Analysis Section
  lines.push(...formatSentimentSection(sentiment));
  lines.push('');

  // Key Contacts — deduplicate.
  // Primary key: Salesforce record Id (catches same record appearing twice).
  // Secondary key: name+email (catches true org duplicates with different Ids).
  const seenContactIds  = new Set<string>();
  const seenContactKeys = new Set<string>();
  const uniqueContacts = contacts.filter((c) => {
    if (seenContactIds.has(c.Id)) return false;
    seenContactIds.add(c.Id);
    const key = `${c.Name.trim().toLowerCase()}|${(c.Email ?? '').toLowerCase()}`;
    if (seenContactKeys.has(key)) return false;
    seenContactKeys.add(key);
    return true;
  });

  lines.push('## Key Contacts');
  if (uniqueContacts.length === 0) {
    lines.push('No active contacts on record.');
  } else {
    for (const c of uniqueContacts) {
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
