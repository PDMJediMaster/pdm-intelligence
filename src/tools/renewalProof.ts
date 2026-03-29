// ─────────────────────────────────────────────────────────────────────────────
// Renewal Proof Package — Prophet by PDM
//
// sf_get_renewal_proof_package
//   Assembles the complete renewal conversation for an Account Manager.
//   Pulls baseline maturity vs. current score, competitive position change,
//   health trajectory, call sentiment, active services, business objectives,
//   and open risks — then generates a Gamma renewal deck automatically.
//
//   The strategic goal: every AM walks into every renewal call with proof
//   of growth, competitive context, and a polished deck — zero manual prep.
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Salesforce Types ─────────────────────────────────────────────────────────

interface SFAccount {
  Id: string;
  Name: string;
  Status__c?: string;
  Contract_Renewal_Date__c?: string;
  Total_Monthly_Recurring_Amount__c?: number;
  Tier__c?: string;
  Phase__c?: string;
  Specialty__c?: string;
  Health_Score__c?: number;
  Health_Tier__c?: string;
  Sentiment_Trend__c?: string;
  Baseline_Marketing_Maturity__c?: number;
  Marketing_Maturity_Score__c?: number;
  Next_Alignment_Call__c?: string;
  AM_Spoke_to_Doctor__c?: string;
  Cancellation_or_Pause_Request_Date__c?: string;
  Flagged_Status__c?: boolean;
  Delinquent__c?: boolean;
  Upsell_Opportunity__c?: string;
  Account_Intel__c?: string;
  OwnerId?: string;
  Owner?: { Name: string };
  Account_Manager_Lookup__c?: string;
  Account_Manager_Lookup__r?: { Name: string };
  LastActivityDate?: string;
  Website?: string;
  BillingCity?: string;
  BillingState?: string;
}

interface SFTask {
  Id: string;
  Subject?: string;
  Description?: string;
  ActivityDate?: string;
  CreatedDate?: string;
  Type?: string;
  Spoke_with_Doctor__c?: boolean;
  Owner?: { Name: string };
}

interface SFCase {
  Id: string;
  Subject?: string;
  Status?: string;
  Priority?: string;
  CreatedDate?: string;
  Description?: string;
}

interface SFAsset {
  Id: string;
  Name?: string;
  Status?: string;
  Price?: number;
  InstallDate?: string;
  Product2?: { Name: string };
}

interface SFBusinessObjective {
  Id: string;
  Name?: string;
  Objective__c?: string;
  Status__c?: string;
  Target_Date__c?: string;
}

interface SFCompetitorSnapshot {
  Id: string;
  Competitor_Name__c?: string;
  Google_Review_Count__c?: number;
  Google_Star_Rating__c?: number;
  Running_Google_Ads__c?: boolean;
  Maps_Pack_Position__c?: number;
  Competitive_Pressure_Score__c?: number;
  Snapshot_Date__c?: string;
  Is_Primary_Competitor__c?: boolean;
}

interface SFReassignment {
  Id: string;
  Previous_AM__c?: string;
  Previous_AM__r?: { Name: string };
  New_AM__c?: string;
  New_AM__r?: { Name: string };
  Reassignment_Date__c?: string;
  Reason__c?: string;
}

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const renewalProofTools: Tool[] = [
  {
    name: 'sf_get_renewal_proof_package',
    description:
      'Assembles the complete renewal conversation package for an Account Manager. ' +
      'Pulls baseline marketing maturity vs. current score (proof of growth), competitive position ' +
      'change since onboarding, health score trajectory, call sentiment from recent activity, ' +
      'active services, business objectives progress, and open risks. ' +
      'After assembling the brief, automatically generates a Gamma renewal presentation deck ' +
      'and saves it to Salesforce. ' +
      'Use 30–90 days before Contract_Renewal_Date__c, or when an AM asks how to prepare ' +
      'for a renewal call. Accepts account name (fuzzy) or Salesforce Account ID.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID — use if known',
        },
        accountName: {
          type: 'string',
          description: 'Account/practice name — fuzzy searched if ID not provided',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schema ─────────────────────────────────────────────────────────────

const RenewalProofArgs = z.object({
  accountId:   z.string().optional(),
  accountName: z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined): string {
  if (!d) return 'Unknown';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMonth(d: string | null | undefined): string {
  if (!d) return 'Unknown';
  return new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function daysSince(d: string | null | undefined): number | null {
  if (!d) return null;
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  return Math.max(0, days); // future dates clamp to 0
}

function renewalUrgency(days: number | null): { emoji: string; label: string } {
  if (days === null) return { emoji: '⚪', label: 'No renewal date set' };
  if (days < 0)      return { emoji: '🚨', label: `${Math.abs(days)} days PAST renewal` };
  if (days <= 14)    return { emoji: '🔴', label: `${days} days — CRITICAL` };
  if (days <= 30)    return { emoji: '🟠', label: `${days} days — URGENT` };
  if (days <= 60)    return { emoji: '🟡', label: `${days} days — Prepare now` };
  return { emoji: '🟢', label: `${days} days` };
}

function healthEmoji(tier: string | undefined): string {
  if (!tier) return '⚪';
  if (tier === 'Healthy')  return '🟢';
  if (tier === 'Watch')    return '🟡';
  if (tier === 'At Risk')  return '🟠';
  if (tier === 'Critical') return '🔴';
  return '⚪';
}

function maturityBar(score: number): string {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${score}/100`;
}

function sentimentEmoji(trend: string | undefined): string {
  if (!trend) return '⚪';
  if (trend === 'Improving') return '📈';
  if (trend === 'Stable')    return '➡️';
  if (trend === 'Declining') return '📉';
  return '⚪';
}

function mrrFormat(mrr: number | undefined): string {
  if (!mrr) return 'Unknown';
  return `$${mrr.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}/mo`;
}

// Scan task descriptions for positive/negative sentiment signals
function extractSentimentSignals(tasks: SFTask[]): { positives: string[]; concerns: string[] } {
  const positiveKeywords = ['great', 'love', 'amazing', 'excellent', 'happy', 'thrilled', 'impressed',
    'results', 'leads', 'calls', 'patients', 'growing', 'increase', 'up', 'better', 'strong', 'refer'];
  const concernKeywords  = ['frustrated', 'disappointed', 'cancel', 'pause', 'unhappy', 'concerned',
    'slow', 'no results', 'not working', 'leaving', 'competitor', 'cheaper', 'budget', 'reduce'];

  const positives: string[] = [];
  const concerns: string[]  = [];

  for (const task of tasks.slice(0, 10)) {
    const text = ((task.Subject ?? '') + ' ' + (task.Description ?? '')).toLowerCase();
    const hasPositive = positiveKeywords.some(kw => text.includes(kw));
    const hasConcern  = concernKeywords.some(kw => text.includes(kw));

    if (hasPositive && task.Description) {
      const snippet = task.Description.slice(0, 150).replace(/\n/g, ' ');
      positives.push(`${fmt(task.ActivityDate ?? task.CreatedDate)}: "${snippet}…"`);
    }
    if (hasConcern && task.Description) {
      const snippet = task.Description.slice(0, 150).replace(/\n/g, ' ');
      concerns.push(`${fmt(task.ActivityDate ?? task.CreatedDate)}: "${snippet}…"`);
    }
  }

  return { positives: positives.slice(0, 3), concerns: concerns.slice(0, 3) };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleRenewalProof(rawArgs: unknown): Promise<string> {
  const { accountId, accountName } = RenewalProofArgs.parse(rawArgs ?? {});

  if (!accountId && !accountName) {
    return '❌ Provide either an accountId or accountName to pull a renewal proof package.';
  }

  // ── Step 1: Resolve Account ───────────────────────────────────────────────

  const WILLIAM_ID = '005PU000001eUQDYA2';
  const accountFields = [
    'Id', 'Name', 'Status__c', 'Contract_Renewal_Date__c',
    'Total_Monthly_Recurring_Amount__c', 'Tier__c', 'Phase__c', 'Specialty__c',
    'Health_Score__c', 'Health_Tier__c', 'Sentiment_Trend__c',
    'Baseline_Marketing_Maturity__c', 'Marketing_Maturity_Score__c',
    'Next_Alignment_Call__c', 'AM_Spoke_to_Doctor__c',
    'Cancellation_or_Pause_Request_Date__c', 'Flagged_Status__c', 'Delinquent__c',
    'Upsell_Opportunity__c', 'Account_Intel__c',
    'OwnerId', 'Owner.Name', 'Account_Manager_Lookup__c', 'Account_Manager_Lookup__r.Name',
    'LastActivityDate', 'Website', 'BillingCity', 'BillingState',
  ].join(', ');

  let sfAccount: SFAccount | null = null;
  let resolvedAccountId = accountId;

  if (resolvedAccountId) {
    const r = await salesforceService.rawQuery<SFAccount>(
      `SELECT ${accountFields} FROM Account WHERE Id = '${resolvedAccountId}' LIMIT 1`
    );
    if (r.length > 0) sfAccount = r[0];
  } else if (accountName) {
    const escaped = accountName.replace(/'/g, "\\'");
    const r = await salesforceService.rawQuery<SFAccount>(
      `SELECT ${accountFields}
       FROM Account
       WHERE Name LIKE '%${escaped}%'
         AND OwnerId != '${WILLIAM_ID}'
       ORDER BY Contract_Renewal_Date__c ASC NULLS LAST
       LIMIT 3`
    );
    if (r.length > 0) { sfAccount = r[0]; resolvedAccountId = sfAccount.Id; }
  }

  if (!sfAccount || !resolvedAccountId) {
    return `❌ No Account found matching "${accountId ?? accountName}". Check the name and try again.`;
  }

  // ── Step 2: Parallel data pull ────────────────────────────────────────────

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixMonthsAgoStr = sixMonthsAgo.toISOString().slice(0, 10);

  const [tasks, openCases, assets, objectives, competitorSnapshots, reassignments] =
    await Promise.all([
      // Call notes — last 6 months
      salesforceService.rawQuery<SFTask>(
        `SELECT Id, Subject, Description, ActivityDate, CreatedDate, Type,
                Spoke_with_Doctor__c, Owner.Name
         FROM Task
         WHERE WhatId = '${resolvedAccountId}'
           AND CreatedDate >= ${sixMonthsAgoStr}
         ORDER BY CreatedDate DESC
         LIMIT 20`
      ).catch(() => [] as SFTask[]),

      // Open tickets
      salesforceService.rawQuery<SFCase>(
        `SELECT Id, Subject, Status, Priority, CreatedDate, Description
         FROM Case
         WHERE AccountId = '${resolvedAccountId}'
           AND IsClosed = false
         ORDER BY CreatedDate DESC
         LIMIT 10`
      ).catch(() => [] as SFCase[]),

      // Active services
      salesforceService.rawQuery<SFAsset>(
        `SELECT Id, Name, Status, Price, InstallDate, Product2.Name
         FROM Asset
         WHERE AccountId = '${resolvedAccountId}'
           AND Status = 'Installed'
         ORDER BY InstallDate ASC
         LIMIT 15`
      ).catch(() => [] as SFAsset[]),

      // Business objectives
      salesforceService.rawQuery<SFBusinessObjective>(
        `SELECT Id, Name, Objective__c, Status__c, Target_Date__c
         FROM Business_Objectives__c
         WHERE Account__c = '${resolvedAccountId}'
         ORDER BY CreatedDate DESC
         LIMIT 5`
      ).catch(() => [] as SFBusinessObjective[]),

      // Competitor snapshots
      salesforceService.rawQuery<SFCompetitorSnapshot>(
        `SELECT Id, Competitor_Name__c, Google_Review_Count__c, Google_Star_Rating__c,
                Running_Google_Ads__c, Maps_Pack_Position__c, Competitive_Pressure_Score__c,
                Snapshot_Date__c, Is_Primary_Competitor__c
         FROM Competitor_Snapshot__c
         WHERE Account__c = '${resolvedAccountId}'
         ORDER BY Is_Primary_Competitor__c DESC, Competitive_Pressure_Score__c DESC
         LIMIT 3`
      ).catch(() => [] as SFCompetitorSnapshot[]),

      // AM transition history
      salesforceService.rawQuery<SFReassignment>(
        `SELECT Id, Previous_AM__r.Name, New_AM__r.Name, Reassignment_Date__c, Reason__c
         FROM Reassignments__c
         WHERE Account__c = '${resolvedAccountId}'
         ORDER BY Reassignment_Date__c DESC
         LIMIT 3`
      ).catch(() => [] as SFReassignment[]),
    ]);

  // ── Step 3: Calculations ──────────────────────────────────────────────────

  const renewalDays   = daysUntil(sfAccount.Contract_Renewal_Date__c);
  const urgency       = renewalUrgency(renewalDays);
  const amName        = (sfAccount.Account_Manager_Lookup__r as { Name?: string } | undefined)?.Name
                     ?? (sfAccount.Owner as { Name?: string } | undefined)?.Name
                     ?? 'Unknown AM';

  const baseline      = sfAccount.Baseline_Marketing_Maturity__c;
  const current       = sfAccount.Marketing_Maturity_Score__c;
  const maturityDelta = (baseline != null && current != null) ? current - baseline : null;

  const doctorCallsDays = daysSince(sfAccount.AM_Spoke_to_Doctor__c);
  const sentimentSignals = extractSentimentSignals(tasks);

  const totalMRR = sfAccount.Total_Monthly_Recurring_Amount__c;
  const annualValue = totalMRR ? totalMRR * 12 : null;

  // ── Step 4: Build Output ──────────────────────────────────────────────────

  const lines: string[] = [];
  const location = [sfAccount.BillingCity, sfAccount.BillingState].filter(Boolean).join(', ');

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`# 🔄 Renewal Proof Package: ${sfAccount.Name}`);
  if (location) lines.push(`**${location}**${sfAccount.Website ? ` | ${sfAccount.Website}` : ''}`);
  lines.push(`AM: **${amName}** | MRR: **${mrrFormat(totalMRR)}**${annualValue ? ` (${mrrFormat(annualValue / 12)} × 12 = $${annualValue.toLocaleString()}/yr)` : ''}`);
  lines.push(`Status: **${sfAccount.Status__c ?? 'Unknown'}** | Tier: ${sfAccount.Tier__c ?? 'Unknown'}`);
  lines.push('');

  // ── Renewal Countdown ─────────────────────────────────────────────────────
  lines.push(`## ${urgency.emoji} Renewal: ${urgency.label}`);
  lines.push(`**Renewal Date:** ${fmt(sfAccount.Contract_Renewal_Date__c)}`);
  if (sfAccount.Next_Alignment_Call__c) {
    lines.push(`**Next Alignment Call:** ${fmt(sfAccount.Next_Alignment_Call__c)}`);
  }
  lines.push('');

  // ── Critical Alerts ───────────────────────────────────────────────────────
  const alerts: string[] = [];
  if (sfAccount.Cancellation_or_Pause_Request_Date__c)
    alerts.push(`🚨 Cancellation/Pause request on file: ${fmt(sfAccount.Cancellation_or_Pause_Request_Date__c)}`);
  if (sfAccount.Flagged_Status__c)
    alerts.push(`🚩 Account is flagged for attention`);
  if (sfAccount.Delinquent__c)
    alerts.push(`💳 Billing delinquency on file — resolve before renewal conversation`);
  if (openCases.some(c => c.Priority === 'High' || c.Priority === 'Critical'))
    alerts.push(`🎫 Open high-priority Ticket — resolve before renewal call`);
  if (doctorCallsDays !== null && doctorCallsDays > 60)
    alerts.push(`👨‍⚕️ Doctor last reached ${doctorCallsDays} days ago — get doctor on renewal call`);
  if (sentimentSignals.concerns.length > 0)
    alerts.push(`📉 Concern signals detected in recent call notes — review below`);

  if (alerts.length > 0) {
    lines.push(`## ⚠️ Pre-Renewal Alerts`);
    alerts.forEach(a => lines.push(a));
    lines.push('');
  }

  // ── Proof of Value: Maturity Growth ───────────────────────────────────────
  lines.push(`## 📈 Proof of Value — Marketing Growth`);
  if (baseline != null && current != null) {
    lines.push(`| | Score |`);
    lines.push(`|---|---|`);
    lines.push(`| **Baseline at Start** | ${maturityBar(baseline)} |`);
    lines.push(`| **Current Score** | ${maturityBar(current)} |`);
    lines.push(`| **Growth** | ${maturityDelta! >= 0 ? '▲' : '▼'} **${Math.abs(maturityDelta!)} points** |`);
    lines.push('');
    if (maturityDelta! >= 20) {
      lines.push(`✅ **Strong growth story** — ${maturityDelta} point improvement is the headline of this renewal.`);
    } else if (maturityDelta! >= 10) {
      lines.push(`✅ **Solid improvement** — pair the ${maturityDelta} point gain with service delivery specifics.`);
    } else if (maturityDelta! >= 0) {
      lines.push(`🟡 **Modest growth** — lean on qualitative wins and forward roadmap rather than score delta.`);
    } else {
      lines.push(`🔴 **Score declined** — do not lead with maturity score. Focus on service delivery and future opportunity.`);
    }
  } else if (current != null) {
    lines.push(`**Current Marketing Maturity:** ${maturityBar(current)}`);
    lines.push(`⚠️ No baseline score locked at close — run \`sf_research_prospect\` on this account to establish the benchmark for future renewals.`);
  } else {
    lines.push(`No maturity scores on file. Run \`sf_research_prospect\` to generate baseline data.`);
  }
  lines.push('');

  // ── Account Health ─────────────────────────────────────────────────────────
  lines.push(`## ${healthEmoji(sfAccount.Health_Tier__c)} Account Health`);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  if (sfAccount.Health_Score__c != null) lines.push(`| Health Score | **${sfAccount.Health_Score__c}/100** |`);
  if (sfAccount.Health_Tier__c)          lines.push(`| Health Tier | **${sfAccount.Health_Tier__c}** |`);
  if (sfAccount.Sentiment_Trend__c)      lines.push(`| Sentiment Trend | ${sentimentEmoji(sfAccount.Sentiment_Trend__c)} ${sfAccount.Sentiment_Trend__c} |`);
  if (doctorCallsDays !== null)          lines.push(`| Last Doctor Contact | ${doctorCallsDays} days ago |`);
  lines.push('');

  // ── Competitive Position ──────────────────────────────────────────────────
  if (competitorSnapshots.length > 0) {
    lines.push(`## ⚔️ Competitive Position`);
    const primary = competitorSnapshots.find(s => s.Is_Primary_Competitor__c) ?? competitorSnapshots[0];
    lines.push(`**Primary Competitor: ${primary.Competitor_Name__c ?? 'Unknown'}**`);
    if (primary.Google_Review_Count__c != null)
      lines.push(`- Reviews: ${primary.Google_Review_Count__c}${primary.Google_Star_Rating__c ? ` (${primary.Google_Star_Rating__c}⭐)` : ''}`);
    if (primary.Running_Google_Ads__c) lines.push(`- Running Google Ads: ✅ YES — actively competing for patients`);
    if (primary.Maps_Pack_Position__c != null)
      lines.push(`- Maps Position: #${primary.Maps_Pack_Position__c}`);
    if (primary.Competitive_Pressure_Score__c != null)
      lines.push(`- Pressure Score: ${primary.Competitive_Pressure_Score__c}/100`);
    if (primary.Snapshot_Date__c)
      lines.push(`- Snapshot Date: ${fmt(primary.Snapshot_Date__c)}`);
    lines.push('');
    lines.push(`💬 **Renewal talking point:** "${sfAccount.Name} has been building its digital presence while ${primary.Competitor_Name__c ?? 'competitors'} continue to invest. Stopping now means ceding ground that took a year to earn."`);
    lines.push('');
  }

  // ── Active Services ───────────────────────────────────────────────────────
  if (assets.length > 0) {
    lines.push(`## 🛠️ Active Services (${assets.length})`);
    for (const asset of assets) {
      const productName = (asset.Product2 as { Name?: string } | undefined)?.Name ?? asset.Name ?? 'Service';
      lines.push(`- **${productName}**${asset.Price ? ` — $${asset.Price.toLocaleString()}/mo` : ''}${asset.InstallDate ? ` (since ${fmtMonth(asset.InstallDate)})` : ''}`);
    }
    lines.push('');
  }

  // ── Business Objectives ───────────────────────────────────────────────────
  if (objectives.length > 0) {
    lines.push(`## 🎯 Business Objectives`);
    for (const obj of objectives) {
      const status = obj.Status__c ?? 'In Progress';
      const emoji  = status === 'Achieved' ? '✅' : status === 'At Risk' ? '🔴' : '🟡';
      lines.push(`${emoji} **${obj.Name ?? 'Objective'}** — ${status}${obj.Target_Date__c ? ` (target: ${fmt(obj.Target_Date__c)})` : ''}`);
      if (obj.Objective__c) lines.push(`  > ${obj.Objective__c}`);
    }
    lines.push('');
  }

  // ── Upsell Opportunity ────────────────────────────────────────────────────
  if (sfAccount.Upsell_Opportunity__c) {
    lines.push(`## 💡 Upsell Opportunity`);
    lines.push(`**${sfAccount.Upsell_Opportunity__c}** — flag this for discussion after renewal is secured.`);
    lines.push('');
  }

  // ── Open Tickets ─────────────────────────────────────────────────────────
  if (openCases.length > 0) {
    lines.push(`## 🎫 Open Tickets (${openCases.length})`);
    for (const ticket of openCases) {
      const priorityEmoji = ticket.Priority === 'High' || ticket.Priority === 'Critical' ? '🔴' : '🟡';
      lines.push(`${priorityEmoji} **${ticket.Subject ?? 'Ticket'}** — ${ticket.Status ?? 'Open'} (opened ${fmt(ticket.CreatedDate)})`);
    }
    lines.push(`⚠️ Resolve open tickets before the renewal call — unresolved issues undermine the proof-of-value story.`);
    lines.push('');
  }

  // ── Call Sentiment ────────────────────────────────────────────────────────
  lines.push(`## 💬 Recent Call Sentiment`);
  if (sentimentSignals.positives.length > 0) {
    lines.push(`**Positive signals:**`);
    sentimentSignals.positives.forEach(s => lines.push(`- ${s}`));
  }
  if (sentimentSignals.concerns.length > 0) {
    lines.push(`**⚠️ Concern signals — address before renewal:**`);
    sentimentSignals.concerns.forEach(s => lines.push(`- ${s}`));
  }
  if (sentimentSignals.positives.length === 0 && sentimentSignals.concerns.length === 0) {
    lines.push(`No clear sentiment signals in recent call notes. Review the full activity history for context.`);
  }
  lines.push('');

  // ── AM Account Intel ──────────────────────────────────────────────────────
  if (sfAccount.Account_Intel__c) {
    lines.push(`## 🧠 AM Intelligence Notes`);
    lines.push(`> ${sfAccount.Account_Intel__c.slice(0, 800).replace(/\n/g, '\n> ')}`);
    lines.push('');
  }

  // ── Renewal Talking Points ────────────────────────────────────────────────
  lines.push(`## 🎤 Renewal Talking Points`);
  lines.push('');

  if (maturityDelta != null && maturityDelta >= 10) {
    lines.push(`1. **The Growth Story:** "When you started with PDM, your marketing maturity score was ${baseline}. Today it's ${current} — a ${maturityDelta}-point improvement. That's not just a number; it means [specific wins from call notes]."`);
  } else {
    lines.push(`1. **The Service Story:** Walk through the specific deliverables and work completed — campaigns launched, content built, rankings improved, reviews generated.`);
  }

  lines.push(`2. **The Competitive Angle:** "Your competitors are continuing to invest. The practices that pull back on marketing are the ones that lose ground fastest. The gains you've made this year are at risk if we stop."`);
  lines.push(`3. **The Compound Effect:** "Dental SEO and reputation compound over time. Month 13 builds on Month 12. Stopping now means starting over — and that's expensive."`);
  lines.push(`4. **The Forward Roadmap:** "Here's what Year 2 looks like — specifically what we'll do differently and what we expect to achieve."`);

  if (sfAccount.Upsell_Opportunity__c) {
    lines.push(`5. **The Expansion Conversation:** After renewal is secured — "${sfAccount.Upsell_Opportunity__c} is the next opportunity we see for this practice."`);
  }
  lines.push('');

  // ── AM Transition Context ─────────────────────────────────────────────────
  if (reassignments.length > 0) {
    lines.push(`## 👥 AM History`);
    for (const r of reassignments) {
      const prev = (r.Previous_AM__r as { Name?: string } | undefined)?.Name ?? 'Unknown';
      const next = (r.New_AM__r as { Name?: string } | undefined)?.Name ?? 'Unknown';
      lines.push(`- ${fmt(r.Reassignment_Date__c)}: ${prev} → ${next}${r.Reason__c ? ` (${r.Reason__c})` : ''}`);
    }
    lines.push('');
  }

  lines.push(`Account ID: \`${resolvedAccountId}\``);

  // ── Step 5: Gamma Renewal Deck Instructions ───────────────────────────────

  const deckTitle = `${sfAccount.Name} — Growth Review & Renewal`;
  const renewalYear = sfAccount.Contract_Renewal_Date__c
    ? new Date(sfAccount.Contract_Renewal_Date__c).getFullYear()
    : new Date().getFullYear();

  const deckContent = [
    `# ${sfAccount.Name} — Year in Review`,
    `**Progressive Dental Marketing | Renewal ${renewalYear}**`,
    ``,
    `## Slide 1: Title`,
    `**${sfAccount.Name}**`,
    `${renewalYear} Partnership Review`,
    `Prepared by ${amName} | Progressive Dental Marketing`,
    ``,
    `## Slide 2: Where You Started`,
    `When we began working together, here was the starting point:`,
    baseline != null ? `- **Marketing Maturity Score: ${baseline}/100**` : `- [Fill in: practice's digital presence at start — website, reviews, SEO, ads status]`,
    `- [Fill in: review count and star rating at the start of the engagement]`,
    `- [Fill in: Maps pack position or organic ranking at the start]`,
    `- [Fill in: key gaps identified at onboarding]`,
    ``,
    `## Slide 3: Where You Are Today`,
    current != null ? `**Marketing Maturity Score: ${current}/100**` : `[Fill in: current maturity assessment]`,
    maturityDelta != null && maturityDelta > 0 ? `**▲ ${maturityDelta} point improvement since we started**` : '',
    sfAccount.Health_Tier__c ? `**Account Health: ${sfAccount.Health_Tier__c}**` : '',
    `[Fill in: current review count, star rating, Maps pack position, organic rankings]`,
    `[Fill in: 3 most impactful wins delivered in the last 12 months with specific numbers]`,
    ``,
    `## Slide 4: The Growth Story`,
    `[Fill in: highlight the single most compelling metric improvement — patient calls, ranking gains, review velocity, lead volume]`,
    `[Fill in: before vs. after comparison — pick the metric that tells the strongest story]`,
    `[Fill in: quote or sentiment from doctor/staff if available from call notes]`,
    ``,
    `## Slide 5: What We Built Together`,
    assets.length > 0
      ? assets.slice(0, 6).map(a => {
          const name = (a.Product2 as { Name?: string } | undefined)?.Name ?? a.Name ?? 'Service';
          return `- **${name}**${a.InstallDate ? ` (live since ${fmtMonth(a.InstallDate)})` : ''}`;
        }).join('\n')
      : `[Fill in: list of active services — SEO, PPC, Social, Video, Reputation, etc.]`,
    ``,
    `## Slide 6: The Competitive Landscape — Then vs. Now`,
    competitorSnapshots.length > 0
      ? [
          `**Primary Competitor: ${competitorSnapshots[0].Competitor_Name__c ?? 'Top Competitor'}**`,
          competitorSnapshots[0].Google_Review_Count__c != null ? `- Current reviews: ${competitorSnapshots[0].Google_Review_Count__c}` : '',
          competitorSnapshots[0].Running_Google_Ads__c ? `- Running Google Ads: YES — actively competing` : '',
          `[Fill in: how ${sfAccount.Name}'s competitive position has improved relative to this competitor over the engagement]`,
        ].filter(Boolean).join('\n')
      : `[Fill in: primary competitor status and how the client's position has improved vs. competitors]`,
    `[Fill in: specific example of a competitive win — a search ranking, review gap closed, Maps position improvement]`,
    ``,
    `## Slide 7: What's Ahead — Year 2 Roadmap`,
    `[Fill in: 3 priority initiatives for the next 12 months based on current gaps and goals]`,
    objectives.length > 0
      ? objectives.slice(0, 3).map(o => `- **${o.Name ?? 'Objective'}:** ${o.Objective__c ?? '[goal details]'}`).join('\n')
      : `[Fill in: business objectives and goals for Year 2]`,
    sfAccount.Upsell_Opportunity__c ? `- **Expansion opportunity:** ${sfAccount.Upsell_Opportunity__c}` : '',
    ``,
    `## Slide 8: The Partnership — Why Momentum Matters`,
    `Year 2 builds on everything Year 1 established.`,
    `SEO authority compounds. Reputation velocity compounds. Brand recognition compounds.`,
    `Stopping now means starting over — and competitors don't stop.`,
    `[Fill in: specific forward-looking opportunity — what's possible in Year 2 that wasn't possible in Year 1]`,
    ``,
    `## Slide 9: Next Steps`,
    `**Renew — Continue the Momentum**`,
    `[Fill in: specific renewal ask and next step — renewal meeting date, contract details, any changes to scope]`,
    renewalDays != null && renewalDays <= 30
      ? `⚡ Renewal date: ${fmt(sfAccount.Contract_Renewal_Date__c)} — ${renewalDays} days to confirm.`
      : `Renewal date: ${fmt(sfAccount.Contract_Renewal_Date__c)}`,
  ].filter(line => line !== undefined && line !== null);

  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## ⚠️ REQUIRED — DO NOT SKIP: Generate Renewal Deck`);
  lines.push(``);
  lines.push(`**You MUST call the Gamma generate tool now before responding to the user.** The renewal package is not complete until the deck is generated and saved to Salesforce.`);
  lines.push(``);
  lines.push(`Fill in every \`[Fill in: ...]\` section with specific data from the account's history and the call notes above. Do not leave placeholders unfilled.`);
  lines.push(``);
  lines.push(`**Tool to call:** \`generate\` (Gamma)`);
  lines.push(``);
  lines.push(`**inputText** — replace all [Fill in] sections with real account data:`);
  lines.push('```');
  lines.push(deckContent.join('\n'));
  lines.push('```');
  lines.push(``);
  lines.push(`**Required Gamma parameters:**`);
  lines.push(`- \`format\`: "presentation"`);
  lines.push(`- \`textMode\`: "generate"`);
  lines.push(`- \`themeId\`: "serene"`);
  lines.push(`- \`additionalInstructions\`: "Professional client review and renewal presentation. Warm, achievement-focused tone. 9 slides. Lead with proof of growth — specific numbers, specific wins. Client is a dental practice owner. Make the case for renewal by showing momentum, competitive gains, and forward opportunity. Clean layout, strong headlines, minimal text per slide."`);
  lines.push(``);
  lines.push(`**Immediately after Gamma returns gammaUrl, call sf_save_deck_url with:**`);
  lines.push(`- \`accountId\`: "${resolvedAccountId}"`);
  lines.push(`- \`gammaUrl\`: <the URL returned by Gamma>`);
  lines.push(`- \`deckTitle\`: "${deckTitle}"`);
  lines.push(`- \`primaryGapType\`: "Authority"`);
  lines.push(``);
  lines.push(`**Do not present the renewal package to the user until the deck is complete. The final response must include the Gamma deck URL.**`);

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const renewalProofHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_renewal_proof_package: handleRenewalProof,
};
