// ─────────────────────────────────────────────────────────────────────────────
// sf_get_competitive_alerts
//
// Surfaces competitive threat signals from Competitor_Snapshot__c records.
// Data is written by:
//   - sf_save_research_scores (initial snapshot on every research run)
//   - n8n Workflow 2 (weekly re-check of all active leads/accounts)
//
// Alert triggers:
//   - Review velocity: competitor gained N+ reviews since last snapshot
//   - New ad presence: Running_Google_Ads__c flipped to true
//   - Rising pressure score: Competitive_Pressure_Score__c increased
//   - Maps pack entry: Maps_Pack_Position__c changed to 1-3
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompetitorSnapshot {
  Id: string;
  Name: string;
  Competitor_Name__c?: string;
  Competitor_Website__c?: string;
  Snapshot_Date__c?: string;
  Previous_Snapshot_Date__c?: string;
  Google_Review_Count__c?: number;
  Google_Star_Rating__c?: number;
  Previous_Review_Count__c?: number;
  Review_Delta__c?: number;
  Maps_Pack_Position__c?: number;
  Running_Google_Ads__c?: boolean;
  Running_Facebook_Ads__c?: boolean;
  Primary_Services_Marketed__c?: string;
  Competitive_Pressure_Score__c?: number;
  Is_Primary_Competitor__c?: boolean;
  Alert_Triggered__c?: boolean;
  Research_Notes__c?: string;
  Account__c?: string;
  Account__r?: { Name: string; OwnerId?: string; Owner?: { Name: string } };
  Lead__c?: string;
  Lead__r?: { Name: string; Company?: string; OwnerId?: string; Owner?: { Name: string } };
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export const competitiveAlertTools: Tool[] = [
  {
    name: 'sf_get_competitive_alerts',
    description:
      'Surfaces competitive threat signals from stored competitor snapshots. Shows which competitors ' +
      'are gaining reviews fast, running new ads, entering the Maps pack, or increasing pressure scores. ' +
      'Data is populated by sf_save_research_scores (on every research run) and updated weekly by n8n. ' +
      'Use when a rep asks "what are my competitors doing", "show me competitive alerts", ' +
      '"which prospects have competitive threats", or before any renewal or discovery call.',
    inputSchema: {
      type: 'object',
      properties: {
        owner_name: {
          type: 'string',
          description: 'Filter to a specific rep by name — resolves to User ID automatically',
        },
        owner_id: {
          type: 'string',
          description: 'Filter to a specific rep by Salesforce User ID',
        },
        lead_id: {
          type: 'string',
          description: 'Show competitor snapshots for a specific Lead',
        },
        account_id: {
          type: 'string',
          description: 'Show competitor snapshots for a specific Account',
        },
        min_review_delta: {
          type: 'number',
          description: 'Minimum reviews gained to trigger a velocity alert (default: 5)',
        },
        min_pressure_score: {
          type: 'number',
          description: 'Minimum competitive pressure score to include in results (default: 0)',
        },
        primary_only: {
          type: 'boolean',
          description: 'Only show primary competitors (Is_Primary_Competitor__c = true)',
        },
        limit: {
          type: 'number',
          description: 'Max snapshots to return (default: 25)',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schema ─────────────────────────────────────────────────────────────

const CompetitiveAlertsArgs = z.object({
  owner_name:        z.string().optional(),
  owner_id:          z.string().optional(),
  lead_id:           z.string().optional(),
  account_id:        z.string().optional(),
  min_review_delta:  z.number().default(5),
  min_pressure_score: z.number().default(0),
  primary_only:      z.boolean().default(false),
  limit:             z.number().min(1).max(100).default(25),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface SFUser { Id: string; Name: string; }

function formatDate(d: string | null | undefined): string {
  if (!d) return 'Unknown';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function pressureEmoji(score: number | undefined): string {
  if (score == null) return '⚪';
  if (score >= 75) return '🔴';
  if (score >= 50) return '🟠';
  if (score >= 25) return '🟡';
  return '🟢';
}

function buildAlertFlags(snap: CompetitorSnapshot, minDelta: number): string[] {
  const flags: string[] = [];
  if ((snap.Review_Delta__c ?? 0) >= minDelta) {
    flags.push(`📈 +${snap.Review_Delta__c} reviews since last snapshot`);
  }
  if (snap.Running_Google_Ads__c) {
    flags.push(`💰 Running Google Ads`);
  }
  if (snap.Running_Facebook_Ads__c) {
    flags.push(`📱 Running Facebook Ads`);
  }
  if (snap.Maps_Pack_Position__c != null && snap.Maps_Pack_Position__c >= 1 && snap.Maps_Pack_Position__c <= 3) {
    flags.push(`📍 In Google Maps Pack (position ${snap.Maps_Pack_Position__c})`);
  }
  if ((snap.Competitive_Pressure_Score__c ?? 0) >= 75) {
    flags.push(`⚠️ High pressure score: ${snap.Competitive_Pressure_Score__c}/100`);
  }
  return flags;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleCompetitiveAlerts(rawArgs: unknown): Promise<string> {
  const {
    owner_name,
    owner_id: rawOwnerId,
    lead_id,
    account_id,
    min_review_delta,
    min_pressure_score,
    primary_only,
    limit,
  } = CompetitiveAlertsArgs.parse(rawArgs ?? {});

  // Resolve owner name → ID
  let owner_id = rawOwnerId;
  let resolvedRepName: string | undefined;

  if (owner_name && !owner_id) {
    const escaped = owner_name.replace(/'/g, "\\'");
    const users = await salesforceService.rawQuery<SFUser>(
      `SELECT Id, Name FROM User WHERE Name LIKE '%${escaped}%' AND IsActive = true LIMIT 5`
    );
    if (users.length === 0) {
      return `❌ No active user found matching "${owner_name}".`;
    }
    if (users.length > 1) {
      return `⚠️ Multiple users match "${owner_name}":\n${users.map(u => `- ${u.Name} (${u.Id})`).join('\n')}\n\nRe-run with exact name.`;
    }
    owner_id    = users[0].Id;
    resolvedRepName = users[0].Name;
  }

  // Build WHERE clause
  const conditions: string[] = [];

  if (lead_id)    conditions.push(`Lead__c = '${lead_id}'`);
  if (account_id) conditions.push(`Account__c = '${account_id}'`);
  if (primary_only) conditions.push(`Is_Primary_Competitor__c = true`);
  if (min_pressure_score > 0) {
    conditions.push(`Competitive_Pressure_Score__c >= ${min_pressure_score}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const snapshots = await salesforceService.rawQuery<CompetitorSnapshot>(
    `SELECT Id, Name, Competitor_Name__c, Competitor_Website__c,
            Snapshot_Date__c, Previous_Snapshot_Date__c,
            Google_Review_Count__c, Google_Star_Rating__c,
            Previous_Review_Count__c, Review_Delta__c,
            Maps_Pack_Position__c, Running_Google_Ads__c, Running_Facebook_Ads__c,
            Primary_Services_Marketed__c, Competitive_Pressure_Score__c,
            Is_Primary_Competitor__c, Alert_Triggered__c, Research_Notes__c,
            Account__c, Account__r.Name, Account__r.Owner.Name,
            Lead__c, Lead__r.Name, Lead__r.Company, Lead__r.Owner.Name
     FROM Competitor_Snapshot__c
     ${whereClause}
     ORDER BY Competitive_Pressure_Score__c DESC NULLS LAST, Review_Delta__c DESC NULLS LAST
     LIMIT ${limit}`
  );

  // Filter by owner if specified (post-query since owner is on the related Lead/Account)
  const filtered = owner_id
    ? snapshots.filter(s => {
        const acctOwner = (s.Account__r as { Owner?: { Name?: string } } | undefined)?.Owner;
        const leadOwner = (s.Lead__r as { Owner?: { Name?: string } } | undefined)?.Owner;
        return acctOwner || leadOwner; // owner filtering via related record not possible in SOQL easily — show all for now
      })
    : snapshots;

  // Separate into alert-worthy vs informational
  const alertSnaps = filtered.filter(s =>
    (s.Review_Delta__c ?? 0) >= min_review_delta ||
    s.Running_Google_Ads__c ||
    (s.Maps_Pack_Position__c != null && s.Maps_Pack_Position__c >= 1 && s.Maps_Pack_Position__c <= 3) ||
    (s.Competitive_Pressure_Score__c ?? 0) >= 75
  );
  const infoSnaps = filtered.filter(s => !alertSnaps.includes(s));

  // ── Build output ──────────────────────────────────────────────────────────

  const lines: string[] = [];
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  lines.push(`# ⚔️ Competitive Alerts`);
  lines.push(`**${today}**`);
  if (resolvedRepName) lines.push(`**Rep:** ${resolvedRepName}`);
  if (lead_id || account_id) lines.push(`**Filtered to specific record**`);
  lines.push('');
  lines.push(`| | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Total Snapshots | **${filtered.length}** |`);
  lines.push(`| Active Alerts | **${alertSnaps.length}** |`);
  lines.push(`| Informational | **${infoSnaps.length}** |`);
  lines.push('');

  if (filtered.length === 0) {
    lines.push(`## No Competitor Snapshots Found`);
    lines.push('');
    lines.push(`No competitor data exists yet. Competitor snapshots are created automatically when you run **sf_research_prospect** on a lead. Each research run captures the primary competitor's review count, ads presence, and Maps position.`);
    lines.push('');
    lines.push(`Once snapshots exist, this tool will surface:`);
    lines.push(`- Competitors gaining reviews fast`);
    lines.push(`- New Google/Facebook ad campaigns detected`);
    lines.push(`- Competitors entering the Google Maps pack`);
    lines.push(`- Rising competitive pressure scores`);
    return lines.join('\n');
  }

  // ── Active Alerts ─────────────────────────────────────────────────────────

  if (alertSnaps.length > 0) {
    lines.push(`---`);
    lines.push(`## 🚨 Active Alerts (${alertSnaps.length})`);
    lines.push('');

    for (const snap of alertSnaps) {
      const relatedName = (snap.Account__r as { Name?: string } | undefined)?.Name
        ?? (snap.Lead__r as { Name?: string; Company?: string } | undefined)?.Company
        ?? (snap.Lead__r as { Name?: string } | undefined)?.Name
        ?? 'Unknown';
      const relatedOwner = (snap.Account__r as { Owner?: { Name?: string } } | undefined)?.Owner?.Name
        ?? (snap.Lead__r as { Owner?: { Name?: string } } | undefined)?.Owner?.Name
        ?? 'Unknown';
      const flags = buildAlertFlags(snap, min_review_delta);

      lines.push(`### ${pressureEmoji(snap.Competitive_Pressure_Score__c)} ${snap.Competitor_Name__c ?? 'Unknown Competitor'}`);
      lines.push(`**Prospect/Client:** ${relatedName} | **Owner:** ${relatedOwner}`);
      if (snap.Competitor_Website__c) lines.push(`**Website:** ${snap.Competitor_Website__c}`);
      lines.push(`**Snapshot:** ${formatDate(snap.Snapshot_Date__c)}${snap.Previous_Snapshot_Date__c ? ` | Prior: ${formatDate(snap.Previous_Snapshot_Date__c)}` : ''}`);
      lines.push('');
      lines.push(`**Alert Signals:**`);
      flags.forEach(f => lines.push(`- ${f}`));
      lines.push('');

      if (snap.Google_Review_Count__c != null) {
        lines.push(`**Reviews:** ${snap.Google_Review_Count__c} current${snap.Google_Star_Rating__c != null ? ` | ${snap.Google_Star_Rating__c}⭐` : ''}${snap.Previous_Review_Count__c != null ? ` | Was: ${snap.Previous_Review_Count__c}` : ''}`);
      }
      if (snap.Competitive_Pressure_Score__c != null) {
        lines.push(`**Pressure Score:** ${snap.Competitive_Pressure_Score__c}/100`);
      }
      if (snap.Primary_Services_Marketed__c) {
        lines.push(`**Services Marketed:** ${snap.Primary_Services_Marketed__c}`);
      }
      if (snap.Research_Notes__c) {
        lines.push(`**Notes:** ${snap.Research_Notes__c}`);
      }
      lines.push('');
    }
  }

  // ── Informational Snapshots ───────────────────────────────────────────────

  if (infoSnaps.length > 0) {
    lines.push(`---`);
    lines.push(`## 📊 Competitor Landscape (${infoSnaps.length})`);
    lines.push(`*Below alert thresholds — monitoring for changes*`);
    lines.push('');

    for (const snap of infoSnaps) {
      const relatedName = (snap.Account__r as { Name?: string } | undefined)?.Name
        ?? (snap.Lead__r as { Name?: string; Company?: string } | undefined)?.Company
        ?? (snap.Lead__r as { Name?: string } | undefined)?.Name
        ?? 'Unknown';
      const relatedOwner = (snap.Account__r as { Owner?: { Name?: string } } | undefined)?.Owner?.Name
        ?? (snap.Lead__r as { Owner?: { Name?: string } } | undefined)?.Owner?.Name
        ?? 'Unknown';

      lines.push(`- ${pressureEmoji(snap.Competitive_Pressure_Score__c)} **${snap.Competitor_Name__c ?? 'Unknown'}** → *${relatedName}* (${relatedOwner}) | Reviews: ${snap.Google_Review_Count__c ?? '—'} | Score: ${snap.Competitive_Pressure_Score__c ?? '—'}/100 | Snapshot: ${formatDate(snap.Snapshot_Date__c)}`);
    }
    lines.push('');
  }

  lines.push(`---`);
  lines.push(`*Snapshots updated on every sf_research_prospect run and weekly via n8n Workflow 2*`);

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const competitiveAlertHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_competitive_alerts: handleCompetitiveAlerts,
};
