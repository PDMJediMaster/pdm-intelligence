// ─────────────────────────────────────────────────────────────────────────────
// Health Scanner — Prophet by PDM
//
// sf_run_nightly_health_scan
//   Batch health score recalculation for all active accounts.
//   Called nightly by n8n Workflow 3 at 11pm.
//
//   For each active account:
//     1. Calculates proxy health score (LastActivityDate + open cases + renewal)
//     2. Determines new Health_Tier__c (Healthy / Watch / At Risk / Critical)
//     3. Compares to stored tier — detects tier drops
//     4. Writes back Health_Score__c, Health_Tier__c, Health_Score_Date__c
//     5. Creates an AM Task when an account drops tier
//     6. Returns a machine-readable JSON summary for n8n to route Slack alerts
//
//   Excludes: William Summers accounts + Cancelled/Inactive/Expired statuses
//   Limit: 300 accounts per run (API safety cap)
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import { proxyHealthScore } from '../services/healthScoring.js';
import { WILLIAM_SUMMERS_USER_ID } from './accountManagement.js';
import { INACTIVE_STATUS_VALUES, ACTIVE_CLIENT_FILTER } from './healthReports.js';

// ─── Salesforce Types ─────────────────────────────────────────────────────────

interface SFAccount {
  Id: string;
  Name: string;
  Status__c?: string;
  OwnerId?: string;
  Owner?: { Name: string };
  Account_Manager_Lookup__c?: string;
  Account_Manager_Lookup__r?: { Name: string };
  LastActivityDate?: string;
  Contract_Renewal_Date__c?: string;
  Health_Score__c?: number;
  Health_Tier__c?: string;
  Cancellation_or_Pause_Request_Date__c?: string;
  Flagged_Status__c?: boolean;
  Delinquent__c?: boolean;
  Total_Monthly_Recurring_Amount__c?: number;
}

interface SFCaseCount {
  AccountId: string;
  expr0: number; // COUNT(Id) — Salesforce aggregate alias
}

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const healthScannerTools: Tool[] = [
  {
    name: 'sf_run_nightly_health_scan',
    description:
      'Nightly batch health scan for all active PDM accounts. ' +
      'Recalculates health scores using activity, case, and renewal data. ' +
      'Writes Health_Score__c, Health_Tier__c, and Health_Score_Date__c back to Salesforce. ' +
      'Creates AM Tasks for accounts that dropped tier since last scan. ' +
      'Returns a JSON-parseable summary for n8n to route Slack alerts on Critical accounts. ' +
      'Designed to be called by n8n Workflow 3 on a nightly schedule — not for manual use. ' +
      'Set dry_run: true to preview what would change without writing to Salesforce.',
    inputSchema: {
      type: 'object',
      properties: {
        dry_run: {
          type: 'boolean',
          description: 'If true, calculates scores and shows changes without writing to Salesforce (default: false)',
        },
        limit: {
          type: 'number',
          description: 'Max accounts to process per run (default: 300, max: 500)',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schema ─────────────────────────────────────────────────────────────

const HealthScanArgs = z.object({
  dry_run: z.boolean().default(false),
  limit:   z.number().min(1).max(500).default(300),
});

// ─── Tier Logic ───────────────────────────────────────────────────────────────

const TIER_RANK: Record<string, number> = {
  'Healthy':  1,
  'Watch':    2,
  'At Risk':  3,
  'Critical': 4,
};

function scoreToTier(score: number): string {
  if (score >= 65) return 'Healthy';
  if (score >= 50) return 'Watch';
  if (score >= 35) return 'At Risk';
  return 'Critical';
}

function tierDropped(oldTier: string | undefined, newTier: string): boolean {
  if (!oldTier) return false; // No prior tier — just store, no alert
  return (TIER_RANK[newTier] ?? 0) > (TIER_RANK[oldTier] ?? 0);
}

function tierEmoji(tier: string): string {
  if (tier === 'Healthy')  return '🟢';
  if (tier === 'Watch')    return '🟡';
  if (tier === 'At Risk')  return '🟠';
  if (tier === 'Critical') return '🔴';
  return '⚪';
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleHealthScan(rawArgs: unknown): Promise<string> {
  const { dry_run, limit } = HealthScanArgs.parse(rawArgs ?? {});

  const today = new Date().toISOString().slice(0, 10);

  // ── Step 1: Query all active accounts ────────────────────────────────────

  const accounts = await salesforceService.rawQuery<SFAccount>(
    `SELECT Id, Name, Status__c, OwnerId, Owner.Name,
            Account_Manager_Lookup__c, Account_Manager_Lookup__r.Name,
            LastActivityDate, Contract_Renewal_Date__c,
            Health_Score__c, Health_Tier__c,
            Cancellation_or_Pause_Request_Date__c, Flagged_Status__c,
            Delinquent__c, Total_Monthly_Recurring_Amount__c
     FROM Account
     WHERE ${ACTIVE_CLIENT_FILTER}
       AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
     ORDER BY LastActivityDate ASC NULLS FIRST
     LIMIT ${limit}`
  );

  if (accounts.length === 0) {
    return '✅ Health scan complete — no active accounts found.';
  }

  // ── Step 2: Query open case counts for all accounts in one SOQL ──────────

  const accountIds = accounts.map(a => `'${a.Id}'`).join(', ');

  const caseCounts = await salesforceService.rawQuery<SFCaseCount>(
    `SELECT AccountId, COUNT(Id) expr0
     FROM Case
     WHERE IsClosed = false
       AND AccountId IN (${accountIds})
     GROUP BY AccountId`
  ).catch(() => [] as SFCaseCount[]);

  const caseCountMap = new Map<string, number>();
  for (const row of caseCounts) {
    caseCountMap.set(row.AccountId, row.expr0);
  }

  // ── Step 3: Score each account ────────────────────────────────────────────

  type ScanResult = {
    id: string;
    name: string;
    amName: string;
    amId: string;
    oldTier: string | undefined;
    newTier: string;
    newScore: number;
    dropped: boolean;
    isCritical: boolean;
    riskFactors: string[];
    mrr: number | undefined;
  };

  const results: ScanResult[] = [];

  for (const account of accounts) {
    const daysSinceActivity = account.LastActivityDate
      ? Math.floor((Date.now() - new Date(account.LastActivityDate).getTime()) / 86400000)
      : null;

    const openCaseCount = caseCountMap.get(account.Id) ?? 0;

    // Priority overrides — force to Critical tier regardless of calculated score
    const hasCriticalSignal =
      !!account.Cancellation_or_Pause_Request_Date__c ||
      account.Flagged_Status__c === true;

    let newScore: number;
    let riskFactors: string[];

    if (hasCriticalSignal) {
      newScore = 15; // Force into Critical tier
      riskFactors = [];
      if (account.Cancellation_or_Pause_Request_Date__c)
        riskFactors.push('Cancellation/pause request on file');
      if (account.Flagged_Status__c)
        riskFactors.push('Flagged for attention');
    } else {
      const proxy = proxyHealthScore({
        daysSinceActivity,
        openCaseCount,
        contractEndDate: account.Contract_Renewal_Date__c,
      });
      newScore = proxy.score;
      riskFactors = proxy.riskFactors;
    }

    if (account.Delinquent__c) riskFactors.push('Billing delinquency');

    const oldTier = account.Health_Tier__c;
    const newTier = scoreToTier(newScore);
    const dropped = tierDropped(oldTier, newTier);

    results.push({
      id:          account.Id,
      name:        account.Name,
      amName:      (account.Account_Manager_Lookup__r as { Name?: string } | undefined)?.Name
                ?? (account.Owner as { Name?: string } | undefined)?.Name
                ?? 'Unknown AM',
      amId:        account.Account_Manager_Lookup__c ?? account.OwnerId ?? '',
      oldTier,
      newTier,
      newScore,
      dropped,
      isCritical:  newTier === 'Critical',
      riskFactors,
      mrr:         account.Total_Monthly_Recurring_Amount__c,
    });
  }

  // ── Orphaned Zoom Audit ────────────────────────────────────────────────────
  // Find VideoCall records with no account linked + Zoom Tasks with no WhatId.
  // Attempt to match back to Contacts/Accounts via email (high confidence)
  // or participant display name (low confidence, single-match only).

  interface OrphanVideoCall {
    Id: string;
    Name?: string;
    StartDateTime?: string;
    DurationInSeconds?: number;
    OwnerId?: string;
    Owner?: { Name: string };
  }
  interface OrphanVCParticipant {
    Id: string;
    VideoCallId: string;
    Name?: string;
    Email?: string;
  }
  interface OrphanZoomTask {
    Id: string;
    Subject?: string;
    ActivityDate?: string;
    OwnerId?: string;
    Owner?: { Name: string };
    WhoId?: string;
    Who?: { Name: string; Email?: string };
    ZVC__Zoom_Meeting__c?: string;
    ZVC__Zoom_Meeting__r?: { ZVC__Meeting_Topic__c?: string } | null;
    ZVC__Zoom_Call_Log__c?: string;
  }
  interface ZoomContactMatch {
    Id: string;
    Name: string;
    Email?: string;
    Phone?: string;
    MobilePhone?: string;
    AccountId: string;
    Account?: { Name: string; Owner?: { Name: string } };
  }

  const zoomLookback     = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const zoomLookbackDate = zoomLookback.split('T')[0];

  const [orphanedVideoCalls, orphanedMeetingTasks, orphanedPhoneTasks] = await Promise.all([
    salesforceService.rawQuery<OrphanVideoCall>(
      `SELECT Id, Name, StartDateTime, DurationInSeconds, OwnerId, Owner.Name
       FROM VideoCall
       WHERE RelatedRecordId = null
         AND StartDateTime >= ${zoomLookback}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
       ORDER BY StartDateTime DESC
       LIMIT 100`
    ).catch(() => [] as OrphanVideoCall[]),

    salesforceService.rawQuery<OrphanZoomTask>(
      `SELECT Id, Subject, ActivityDate, OwnerId, Owner.Name,
              WhoId, Who.Name, Who.Email,
              ZVC__Zoom_Meeting__c,
              ZVC__Zoom_Meeting__r.ZVC__Meeting_Topic__c
       FROM Task
       WHERE ZVC__Zoom_Meeting__c != null
         AND WhatId = null
         AND ActivityDate >= ${zoomLookbackDate}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
       ORDER BY ActivityDate DESC
       LIMIT 50`
    ).catch(() => [] as OrphanZoomTask[]),

    salesforceService.rawQuery<OrphanZoomTask>(
      `SELECT Id, Subject, ActivityDate, OwnerId, Owner.Name,
              WhoId, Who.Name, Who.Email,
              ZVC__Zoom_Call_Log__c
       FROM Task
       WHERE ZVC__Zoom_Call_Log__c != null
         AND WhatId = null
         AND ActivityDate >= ${zoomLookbackDate}
         AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
       ORDER BY ActivityDate DESC
       LIMIT 50`
    ).catch(() => [] as OrphanZoomTask[]),
  ]);

  let orphanParticipants: OrphanVCParticipant[] = [];
  if (orphanedVideoCalls.length > 0) {
    const callIds = orphanedVideoCalls.map(c => `'${c.Id}'`).join(',');
    orphanParticipants = await salesforceService.rawQuery<OrphanVCParticipant>(
      `SELECT Id, VideoCallId, Name, Email
       FROM VideoCallParticipant
       WHERE VideoCallId IN (${callIds})
       LIMIT 500`
    ).catch(() => [] as OrphanVCParticipant[]);
  }

  const orphanEmailSet = new Set<string>();
  const orphanNameSet  = new Set<string>();
  for (const p of orphanParticipants) {
    if (p.Email) orphanEmailSet.add(p.Email.toLowerCase().trim());
    if (p.Name)  orphanNameSet.add(p.Name.trim());
  }
  for (const t of [...orphanedMeetingTasks, ...orphanedPhoneTasks]) {
    const who = t.Who as { Name?: string; Email?: string } | undefined;
    if (who?.Email) orphanEmailSet.add(who.Email.toLowerCase().trim());
    if (who?.Name)  orphanNameSet.add(who.Name.trim());
  }

  let zoomContactMatches: ZoomContactMatch[] = [];
  const emailList = [...orphanEmailSet];
  const nameList  = [...orphanNameSet];
  if (emailList.length > 0 || nameList.length > 0) {
    const emailClause = emailList.length > 0
      ? `Email IN (${emailList.map(e => `'${e}'`).join(',')})`
      : null;
    const nameClause = nameList.length > 0 && emailList.length === 0
      ? `Name IN (${nameList.map(n => `'${n}'`).join(',')})`
      : null;
    const whereClause = [emailClause, nameClause].filter(Boolean).join(' OR ');
    if (whereClause) {
      zoomContactMatches = await salesforceService.rawQuery<ZoomContactMatch>(
        `SELECT Id, Name, Email, Phone, MobilePhone, AccountId,
                Account.Name, Account.Owner.Name
         FROM Contact
         WHERE (${whereClause})
           AND AccountId != null
         LIMIT 200`
      ).catch(() => [] as ZoomContactMatch[]);
    }
  }

  const emailToZoomContact = new Map<string, ZoomContactMatch>();
  const nameToZoomContacts = new Map<string, ZoomContactMatch[]>();
  for (const c of zoomContactMatches) {
    if (c.Email) emailToZoomContact.set(c.Email.toLowerCase().trim(), c);
    const key = c.Name.trim().toLowerCase();
    if (!nameToZoomContacts.has(key)) nameToZoomContacts.set(key, []);
    nameToZoomContacts.get(key)!.push(c);
  }

  type CallMatch = {
    callDate:         string;
    durationMins:     number;
    amName:           string;
    amId:             string;
    participantCount: number;
    likelyAccounts:   Array<{ accountName: string; matchedVia: string; confidence: 'High' | 'Low' }>;
  };

  const callMatchResults: CallMatch[] = orphanedVideoCalls.map(call => {
    const participants   = orphanParticipants.filter(p => p.VideoCallId === call.Id);
    const likelyAccounts: CallMatch['likelyAccounts'] = [];
    const seenAccounts   = new Set<string>();
    for (const p of participants) {
      if (p.Email) {
        const c = emailToZoomContact.get(p.Email.toLowerCase().trim());
        if (c && !seenAccounts.has(c.AccountId)) {
          seenAccounts.add(c.AccountId);
          likelyAccounts.push({
            accountName: (c.Account as { Name?: string } | undefined)?.Name ?? 'Unknown',
            matchedVia:  `${p.Email} → ${c.Name}`,
            confidence:  'High',
          });
        }
      }
      if (p.Name && likelyAccounts.length === 0) {
        const key     = p.Name.trim().toLowerCase();
        const matches = nameToZoomContacts.get(key);
        if (matches?.length === 1 && !seenAccounts.has(matches[0].AccountId)) {
          seenAccounts.add(matches[0].AccountId);
          likelyAccounts.push({
            accountName: (matches[0].Account as { Name?: string } | undefined)?.Name ?? 'Unknown',
            matchedVia:  `Name match: "${p.Name}" → ${matches[0].Name} — verify before linking`,
            confidence:  'Low',
          });
        }
      }
    }
    return {
      callDate:         call.StartDateTime?.split('T')[0] ?? 'Unknown',
      durationMins:     Math.round((call.DurationInSeconds ?? 0) / 60),
      amName:           (call.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown AM',
      amId:             call.OwnerId ?? '',
      participantCount: participants.length,
      likelyAccounts,
    };
  });

  type TaskMatch = {
    subject:        string;
    date:           string;
    type:           'meeting' | 'phone';
    amName:         string;
    amId:           string;
    whoName?:       string;
    whoEmail?:      string;
    likelyAccount?: { accountName: string; matchedVia: string };
  };

  const taskMatchResults: TaskMatch[] = [
    ...orphanedMeetingTasks.map(t => ({ ...t, _type: 'meeting' as const })),
    ...orphanedPhoneTasks.map(t => ({ ...t, _type: 'phone' as const })),
  ].map(task => {
    const who      = task.Who as { Name?: string; Email?: string } | undefined;
    const whoEmail = who?.Email;
    const whoName  = who?.Name;
    let likelyAccount: TaskMatch['likelyAccount'];
    if (whoEmail) {
      const c = emailToZoomContact.get(whoEmail.toLowerCase().trim());
      if (c) {
        likelyAccount = {
          accountName: (c.Account as { Name?: string } | undefined)?.Name ?? 'Unknown',
          matchedVia:  `WhoId: ${whoEmail} → ${c.Name}`,
        };
      }
    }
    return {
      subject:  task.Subject ?? 'Zoom Activity',
      date:     task.ActivityDate ?? 'Unknown',
      type:     task._type,
      amName:   (task.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown AM',
      amId:     task.OwnerId ?? '',
      whoName,
      whoEmail,
      likelyAccount,
    };
  });

  // ── Step 4: Write back to Salesforce (unless dry run) ────────────────────

  const tierDrops   = results.filter(r => r.dropped);
  const criticalNow = results.filter(r => r.isCritical);
  const writeErrors: string[] = [];
  let tasksCreated = 0;
  let scoresWritten = 0;

  if (!dry_run) {
    for (const result of results) {
      // Write health score back to every account
      try {
        await salesforceService.updateRecord('Account', result.id, {
          Health_Score__c:    result.newScore,
          Health_Tier__c:     result.newTier,
          Health_Score_Date__c: today,
        });
        scoresWritten++;
      } catch (err) {
        writeErrors.push(`Score write failed for ${result.name}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Create Task for AM when tier drops — one per account
      if (result.dropped) {
        try {
          const taskSubject = `⚠️ Prophet Alert: ${result.name} dropped to ${result.newTier}`;
          const taskDesc = [
            `Prophet Nightly Health Scan — ${today}`,
            ``,
            `Account: ${result.name}`,
            `Previous Tier: ${result.oldTier ?? 'Unknown'}`,
            `New Tier: ${result.newTier}`,
            `Health Score: ${result.newScore}/100`,
            result.riskFactors.length > 0
              ? `Risk Factors:\n${result.riskFactors.map(f => `  - ${f}`).join('\n')}`
              : '',
            ``,
            `Recommended action: Review account health and schedule a call with the client before this escalates further.`,
            result.newTier === 'Critical'
              ? `\n🚨 CRITICAL: This account needs immediate attention. Contact the client this week.`
              : '',
          ].filter(Boolean).join('\n');

          await salesforceService.createRecord('Task', {
            Subject:      taskSubject,
            Description:  taskDesc,
            WhatId:       result.id,
            OwnerId:      result.amId || undefined,
            Status:       'Not Started',
            Priority:     result.newTier === 'Critical' ? 'High' : 'Normal',
            ActivityDate: today,
          });
          tasksCreated++;
        } catch (err) {
          writeErrors.push(`Task create failed for ${result.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // ── Create one Task per AM for all their orphaned Zoom calls ─────────────
    // Group all orphaned activity by AM user ID
    type OrphanGroup = {
      amName: string;
      calls:  CallMatch[];
      tasks:  TaskMatch[];
    };
    const orphanByAm = new Map<string, OrphanGroup>();

    for (const r of callMatchResults) {
      if (!r.amId) continue;
      if (!orphanByAm.has(r.amId)) orphanByAm.set(r.amId, { amName: r.amName, calls: [], tasks: [] });
      orphanByAm.get(r.amId)!.calls.push(r);
    }
    for (const r of taskMatchResults) {
      if (!r.amId) continue;
      if (!orphanByAm.has(r.amId)) orphanByAm.set(r.amId, { amName: r.amName, calls: [], tasks: [] });
      orphanByAm.get(r.amId)!.tasks.push(r);
    }

    for (const [amId, group] of orphanByAm) {
      const totalCount = group.calls.length + group.tasks.length;
      const taskSubject = `🔗 Prophet: ${totalCount} Zoom call${totalCount > 1 ? 's' : ''} not linked to any account — action required`;

      const descLines: string[] = [
        `Prophet Nightly Scan — ${today}`,
        ``,
        `${group.amName}, you have ${totalCount} Zoom recording${totalCount > 1 ? 's' : ''} in Salesforce that are not linked to any account.`,
        `Unlinked calls are invisible to health scoring. These accounts may appear disengaged when they are not.`,
        `Please open each call in Salesforce and link it to the correct account.`,
        ``,
      ];

      if (group.calls.length > 0) {
        descLines.push(`VIDEO CALLS (${group.calls.length}):`);
        for (const c of group.calls) {
          const match = c.likelyAccounts[0];
          const suggestion = match
            ? `Likely account: ${match.accountName} (${match.confidence} confidence)`
            : `No account match found — manual review needed`;
          descLines.push(`  • ${c.callDate} | ${c.durationMins}m | ${suggestion}`);
        }
        descLines.push(``);
      }

      if (group.tasks.length > 0) {
        descLines.push(`ZOOM TASKS (${group.tasks.length}):`);
        for (const t of group.tasks) {
          const icon = t.type === 'meeting' ? 'Meeting' : 'Phone Call';
          const match = t.likelyAccount
            ? `Likely account: ${t.likelyAccount.accountName}`
            : t.whoName
              ? `Contact on file: ${t.whoName} — link to their account`
              : `No contact or account — manual review needed`;
          descLines.push(`  • ${t.date} | ${icon}: ${t.subject} | ${match}`);
        }
        descLines.push(``);
      }

      descLines.push(`To link a call: Open the VideoCall or Task in Salesforce → Edit → set the Account field.`);

      try {
        await salesforceService.createRecord('Task', {
          Subject:      taskSubject,
          Description:  descLines.join('\n'),
          OwnerId:      amId,
          Status:       'Not Started',
          Priority:     'High',
          ActivityDate: today,
        });
        tasksCreated++;
      } catch (err) {
        writeErrors.push(`Orphan Task create failed for ${group.amName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ── Step 5: Build output ──────────────────────────────────────────────────

  const lines: string[] = [];

  lines.push(`# ${dry_run ? '🔍 DRY RUN — ' : ''}Prophet Nightly Health Scan`);
  lines.push(`**Date:** ${today} | **Accounts Scanned:** ${results.length}`);
  lines.push('');

  // Summary table
  const healthyCount   = results.filter(r => r.newTier === 'Healthy').length;
  const watchCount     = results.filter(r => r.newTier === 'Watch').length;
  const atRiskCount    = results.filter(r => r.newTier === 'At Risk').length;
  const criticalCount  = criticalNow.length;

  lines.push(`## 📊 Tier Distribution`);
  lines.push(`| Tier | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| 🟢 Healthy | ${healthyCount} |`);
  lines.push(`| 🟡 Watch | ${watchCount} |`);
  lines.push(`| 🟠 At Risk | ${atRiskCount} |`);
  lines.push(`| 🔴 Critical | ${criticalCount} |`);
  lines.push('');

  // Tier drops
  if (tierDrops.length > 0) {
    lines.push(`## ⚠️ Tier Drops Detected (${tierDrops.length})`);
    for (const r of tierDrops) {
      const mrrStr = r.mrr ? ` | $${r.mrr.toLocaleString()}/mo` : '';
      lines.push(`${tierEmoji(r.newTier)} **${r.name}** — ${r.oldTier ?? '?'} → **${r.newTier}** | AM: ${r.amName}${mrrStr}`);
      if (r.riskFactors.length > 0) {
        lines.push(`  Factors: ${r.riskFactors.join(', ')}`);
      }
    }
    lines.push('');
  } else {
    lines.push(`## ✅ No Tier Drops`);
    lines.push(`All accounts held their tier from the previous scan.`);
    lines.push('');
  }

  // ── Onboarding Gap Detection (accounts since Feb 1 with no onboarding record) ──

  interface OnboardingGapAccount {
    Id: string;
    Name: string;
    Status__c?: string;
    CreatedDate: string;
    OwnerId?: string;
    Owner?: { Name: string };
    Account_Manager_Lookup__r?: { Name: string };
    Total_Monthly_Recurring_Amount__c?: number;
  }

  const onboardingGapAccounts = await salesforceService.rawQuery<OnboardingGapAccount>(
    `SELECT Id, Name, Status__c, CreatedDate, OwnerId, Owner.Name,
            Account_Manager_Lookup__r.Name, Total_Monthly_Recurring_Amount__c
     FROM Account
     WHERE CreatedDate >= 2026-02-01T00:00:00Z
       AND ${ACTIVE_CLIENT_FILTER}
       AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
       AND Id NOT IN (SELECT Account__c FROM Client_Onboarding__c WHERE Account__c != null)
     ORDER BY CreatedDate DESC
     LIMIT 50`
  ).catch(() => [] as OnboardingGapAccount[]);

  // Critical accounts
  if (criticalNow.length > 0) {
    lines.push(`## 🔴 Critical Accounts (${criticalNow.length})`);
    for (const r of criticalNow) {
      const mrrStr = r.mrr ? ` — $${r.mrr.toLocaleString()}/mo` : '';
      lines.push(`- **${r.name}** | Score: ${r.newScore} | AM: ${r.amName}${mrrStr}`);
      if (r.riskFactors.length > 0) {
        lines.push(`  Risk: ${r.riskFactors.join(', ')}`);
      }
    }
    lines.push('');
  }

  // Onboarding Gap Report
  if (onboardingGapAccounts.length > 0) {
    lines.push(`## 📋 Missing Onboarding Records — Active Clients Since Feb 1, 2026 (${onboardingGapAccounts.length})`);
    lines.push('*Every new client since Feb 1 must have a Client Onboarding record. These do not.*');
    lines.push('');
    for (const acct of onboardingGapAccounts) {
      const amName = (acct.Account_Manager_Lookup__r as { Name?: string } | undefined)?.Name
        ?? (acct.Owner as { Name?: string } | undefined)?.Name
        ?? 'Unknown AM';
      const mrr = acct.Total_Monthly_Recurring_Amount__c
        ? ` | $${acct.Total_Monthly_Recurring_Amount__c.toLocaleString()}/mo`
        : '';
      const created = acct.CreatedDate.split('T')[0];
      lines.push(`- **${acct.Name}** | Created: ${created} | Status: ${acct.Status__c ?? 'Unknown'} | AM: ${amName}${mrr}`);
    }
    lines.push('');
  } else {
    lines.push(`## ✅ Onboarding Records — All Clear`);
    lines.push(`All active clients created since Feb 1, 2026 have an onboarding record.`);
    lines.push('');
  }

  // ── Orphaned Zoom Activity Output ─────────────────────────────────────────
  const totalOrphaned       = orphanedVideoCalls.length + orphanedMeetingTasks.length + orphanedPhoneTasks.length;
  const highConfMatches     = callMatchResults.filter(r => r.likelyAccounts.some(a => a.confidence === 'High')).length;
  const lowConfMatches      = callMatchResults.filter(r => r.likelyAccounts.length > 0 && r.likelyAccounts.every(a => a.confidence === 'Low')).length;
  const unmatchedCalls      = callMatchResults.filter(r => r.likelyAccounts.length === 0).length;
  const matchedTasks        = taskMatchResults.filter(t => t.likelyAccount).length;
  const unmatchedTasks      = taskMatchResults.filter(t => !t.likelyAccount).length;

  if (totalOrphaned > 0) {
    lines.push(`## 🔗 Orphaned Zoom Activity — Unlinked to Accounts (${totalOrphaned})`);
    lines.push('*These Zoom recordings exist in Salesforce but have no account attached. Prophet cannot score or surface them.*');
    lines.push(`*${highConfMatches} high-confidence matches found via email | ${lowConfMatches} low-confidence (name only) | ${unmatchedCalls + unmatchedTasks} unresolved*`);
    lines.push('');

    if (callMatchResults.length > 0) {
      lines.push(`### 📹 Video Calls — No Account Linked (${callMatchResults.length})`);
      for (const r of callMatchResults) {
        lines.push(`**${r.callDate}** | ${r.durationMins}m | ${r.participantCount} participant(s) | AM: ${r.amName}`);
        if (r.likelyAccounts.length > 0) {
          for (const a of r.likelyAccounts) {
            const icon = a.confidence === 'High' ? '✅' : '⚠️';
            lines.push(`  ${icon} **Likely: ${a.accountName}** — matched via ${a.matchedVia}`);
          }
        } else {
          lines.push(`  ❓ No match found — no participant emails on file in Salesforce`);
        }
      }
      lines.push('');
    }

    if (taskMatchResults.length > 0) {
      lines.push(`### 📞 Zoom Tasks — No Account Linked (${taskMatchResults.length})`);
      for (const r of taskMatchResults) {
        const icon = r.type === 'meeting' ? '🎥' : '📞';
        lines.push(`${icon} **${r.date}** — ${r.subject} | AM: ${r.amName}`);
        if (r.likelyAccount) {
          lines.push(`  ✅ **Likely: ${r.likelyAccount.accountName}** — ${r.likelyAccount.matchedVia}`);
        } else if (r.whoName || r.whoEmail) {
          lines.push(`  ❓ Contact on record: ${r.whoName ?? ''}${r.whoEmail ? ` (${r.whoEmail})` : ''} — no Salesforce account match`);
        } else {
          lines.push(`  ❓ No contact or account linked — AM must resolve manually`);
        }
      }
      lines.push('');
    }

    lines.push('**Why this matters:** Every unlinked call is invisible to health scoring. An account that looks silent may actually have active engagement — it just isn\'t credited. AMs must link calls or Prophet will misclassify these accounts as disengaged.');
    lines.push('');
  } else {
    lines.push(`## ✅ Zoom Linkage — All Clear`);
    lines.push(`All Zoom calls from the last 30 days are linked to Salesforce accounts.`);
    lines.push('');
  }

  // Write results
  if (!dry_run) {
    lines.push(`## 📝 Salesforce Write-Back`);
    lines.push(`- ✅ Health scores written: **${scoresWritten}** accounts`);
    lines.push(`- ✅ AM Tasks created: **${tasksCreated}** (one per tier drop)`);
    if (writeErrors.length > 0) {
      lines.push(`- ❌ Errors: ${writeErrors.length}`);
      writeErrors.forEach(e => lines.push(`  - ${e}`));
    }
    lines.push('');
  } else {
    lines.push(`**DRY RUN — no data was written to Salesforce.**`);
    lines.push(`Run with \`dry_run: false\` to apply changes.`);
    lines.push('');
  }

  // Machine-readable summary for n8n (always last line)
  const scanSummary = {
    date:          today,
    scanned:       results.length,
    healthy:       healthyCount,
    watch:         watchCount,
    atRisk:        atRiskCount,
    critical:      criticalCount,
    tierDrops:     tierDrops.length,
    tasksCreated,
    dryRun:        dry_run,
    criticalAccounts: criticalNow.map(r => ({
      name:    r.name,
      score:   r.newScore,
      amName:  r.amName,
      dropped: r.dropped,
      mrr:     r.mrr ?? null,
    })),
    tierDropAccounts: tierDrops.map(r => ({
      name:    r.name,
      oldTier: r.oldTier ?? 'Unknown',
      newTier: r.newTier,
      amName:  r.amName,
    })),
    onboardingGap: onboardingGapAccounts.length,
    orphanedZoomCalls: totalOrphaned,
    orphanedCallsMatched: highConfMatches + matchedTasks,
    orphanedCallsUnresolved: unmatchedCalls + unmatchedTasks,
    onboardingGapAccounts: onboardingGapAccounts.map(a => ({
      name:    a.Name,
      created: a.CreatedDate.split('T')[0],
      status:  a.Status__c ?? 'Unknown',
      amName:  (a.Account_Manager_Lookup__r as { Name?: string } | undefined)?.Name
            ?? (a.Owner as { Name?: string } | undefined)?.Name
            ?? 'Unknown',
    })),
  };

  lines.push(`\`\`\`json`);
  lines.push(`SCAN_RESULT:${JSON.stringify(scanSummary)}`);
  lines.push(`\`\`\``);

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const healthScannerHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_run_nightly_health_scan: handleHealthScan,
};
