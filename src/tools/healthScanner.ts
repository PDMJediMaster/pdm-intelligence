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
import { INACTIVE_STATUS_VALUES } from './healthReports.js';

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
  const inactiveStatusSoql = INACTIVE_STATUS_VALUES.map(s => `'${s}'`).join(', ');

  // ── Step 1: Query all active accounts ────────────────────────────────────

  const accounts = await salesforceService.rawQuery<SFAccount>(
    `SELECT Id, Name, Status__c, OwnerId, Owner.Name,
            Account_Manager_Lookup__c, Account_Manager_Lookup__r.Name,
            LastActivityDate, Contract_Renewal_Date__c,
            Health_Score__c, Health_Tier__c,
            Cancellation_or_Pause_Request_Date__c, Flagged_Status__c,
            Delinquent__c, Total_Monthly_Recurring_Amount__c
     FROM Account
     WHERE Status__c NOT IN (${inactiveStatusSoql})
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

      // Create Task for AM when tier drops
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
