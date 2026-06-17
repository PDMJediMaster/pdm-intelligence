// ─────────────────────────────────────────────────────────────────────────────
// Marketing Dashboard — Account Engagement (Pardot) Email + Form Analytics
//
// sf_get_marketing_dashboard:
//   Pulls aggregated email performance from Account Engagement via Pardot API
//   v5. Returns open rates, CTR, top/bottom performers, form fills. Falls back
//   to SOQL ListEmail data if the Pardot API is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { salesforceService } from '../services/salesforce.js';
import { getPardotToken, PARDOT_BU_ID, PARDOT_V5_BASE as PARDOT_API_BASE } from '../services/pardotAuth.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PardotEmailStats {
  sent?: number;
  delivered?: number;
  opens?: number;
  uniqueOpens?: number;
  clicks?: number;
  uniqueClicks?: number;
  optOuts?: number;
  bounces?: number;
  spamComplaints?: number;
}

interface PardotEmail {
  id?: number | string;
  name?: string;
  subject?: string;
  sentAt?: string;
  scheduledAt?: string;
  createdAt?: string;
  status?: string;
  stats?: PardotEmailStats;
}

interface PardotFormHandler {
  id?: number | string;
  name?: string;
  successfulSubmissions?: number;
  erroredSubmissions?: number;
  views?: number;
  createdAt?: string;
}

interface PardotApiResponse<T> {
  data?: T[];
  values?: T[];
  nextPageToken?: string;
  totalElements?: number;
}

interface SFListEmail {
  Id: string;
  Name: string;
  Subject?: string;
  Status?: string;
  CampaignId?: string;
  ScheduledDate?: string;
  CreatedDate: string;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export const marketingDashboardTools: Tool[] = [
  {
    name: 'sf_get_marketing_dashboard',
    description:
      'Marketing performance dashboard from Salesforce Account Engagement. Returns aggregated email stats: send counts, open rates, click-through rates, top/bottom performing emails by CTR, and form fill counts — without opening individual emails or using a spreadsheet.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Look-back period in days (default: 30)',
        },
        limit: {
          type: 'number',
          description: 'Max emails to analyze (default: 50)',
        },
        campaign: {
          type: 'string',
          description: 'Filter by campaign name (partial match)',
        },
      },
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function callPardotApi<T>(
  endpoint: string,
  accessToken: string,
  params: Record<string, string> = {}
): Promise<PardotApiResponse<T>> {
  const url = new URL(`${PARDOT_API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Pardot-Business-Unit-Id': PARDOT_BU_ID,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Pardot API ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<PardotApiResponse<T>>;
}

function pct(num = 0, denom = 0): string {
  if (!denom || denom === 0) return '—';
  return ((num / denom) * 100).toFixed(1) + '%';
}

function n(val?: number): number {
  return val ?? 0;
}

function bar(rate: number, max = 100): string {
  const filled = Math.round((rate / max) * 10);
  return '█'.repeat(Math.min(filled, 10)) + '░'.repeat(Math.max(0, 10 - filled));
}

function benchmarkFlag(label: string, value: number, good: number, ok: number): string {
  if (value >= good) return `${label}: ${value.toFixed(1)}%  ✅`;
  if (value >= ok)   return `${label}: ${value.toFixed(1)}%  ⚠️`;
  return `${label}: ${value.toFixed(1)}%  🔴`;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleMarketingDashboard(args: unknown): Promise<string> {
  const { days = 30, limit = 50, campaign } = args as {
    days?: number;
    limit?: number;
    campaign?: string;
  };

  const conn = await salesforceService.getConn();
  const accessToken = await getPardotToken();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0];

  // ── 1. Try Pardot API v5 ──────────────────────────────────────────────────
  let emails: PardotEmail[] = [];
  let formHandlers: PardotFormHandler[] = [];
  let usingPardotApi = false;
  let apiError = '';

  try {
    const emailParams: Record<string, string> = {
      fields: 'id,name,subject,sentAt,status,stats',
      limit: String(limit),
      orderBy: 'sentAt',
      orderByDirection: 'DESC',
      createdAfter: since,
    };
    if (campaign) emailParams['name_contains'] = campaign;

    const emailRes = await callPardotApi<PardotEmail>('emails', accessToken, emailParams);
    emails = emailRes.data ?? emailRes.values ?? [];

    // Form handlers
    const fhRes = await callPardotApi<PardotFormHandler>('form-handlers', accessToken, {
      fields: 'id,name,successfulSubmissions,erroredSubmissions,views,createdAt',
      limit: '25',
      orderBy: 'successfulSubmissions',
      orderByDirection: 'DESC',
    });
    formHandlers = fhRes.data ?? fhRes.values ?? [];

    usingPardotApi = emails.length > 0;
  } catch (err: unknown) {
    apiError = err instanceof Error ? err.message : String(err);
  }

  // ── 2. SOQL fallback if Pardot API failed or returned nothing ────────────
  let soqlEmails: SFListEmail[] = [];
  if (!usingPardotApi) {
    const campaignFilter = campaign ? ` AND Name LIKE '%${campaign.replace(/'/g, "\\'")}%'` : '';
    const soql = `
      SELECT Id, Name, Subject, Status, CampaignId, ScheduledDate, CreatedDate
      FROM ListEmail
      WHERE CreatedDate >= ${since}T00:00:00Z
        AND Status = 'Sent'
        ${campaignFilter}
      ORDER BY CreatedDate DESC
      LIMIT ${limit}
    `;
    const result = await conn.query<SFListEmail>(soql);
    soqlEmails = result.records;
  }

  // ── 3. Build dashboard output ─────────────────────────────────────────────
  const lines: string[] = [];
  const dateRange = `Last ${days} Days`;
  lines.push(`📊  PDM MARKETING DASHBOARD — ${dateRange}`);
  lines.push(`    ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`);
  lines.push('');

  // ── Pardot API path ───────────────────────────────────────────────────────
  if (usingPardotApi) {
    // Aggregate totals
    let totalSent = 0, totalDelivered = 0, totalOpens = 0, totalUniqueOpens = 0;
    let totalClicks = 0, totalUniqueClicks = 0, totalBounces = 0, totalOptOuts = 0;
    let emailsWithStats = 0;

    for (const e of emails) {
      const s = e.stats ?? {};
      if (n(s.sent) > 0) {
        totalSent         += n(s.sent);
        totalDelivered    += n(s.delivered);
        totalOpens        += n(s.opens);
        totalUniqueOpens  += n(s.uniqueOpens);
        totalClicks       += n(s.clicks);
        totalUniqueClicks += n(s.uniqueClicks);
        totalBounces      += n(s.bounces);
        totalOptOuts      += n(s.optOuts);
        emailsWithStats++;
      }
    }

    const avgOpenRate  = totalDelivered > 0 ? (totalUniqueOpens / totalDelivered) * 100 : 0;
    const avgCTR       = totalDelivered > 0 ? (totalUniqueClicks / totalDelivered) * 100 : 0;
    const avgCTOR      = totalUniqueOpens > 0 ? (totalUniqueClicks / totalUniqueOpens) * 100 : 0;
    const avgBounceRate= totalSent > 0 ? (totalBounces / totalSent) * 100 : 0;

    // Summary block
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('  EMAIL PERFORMANCE SUMMARY');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`  Emails Sent:       ${emails.length} campaigns`);
    lines.push(`  Total Sends:       ${totalSent.toLocaleString()}`);
    lines.push(`  Delivered:         ${totalDelivered.toLocaleString()}  (${pct(totalDelivered, totalSent)} delivery rate)`);
    lines.push(`  Bounces:           ${totalBounces.toLocaleString()}  (${pct(totalBounces, totalSent)})`);
    lines.push(`  Unsubscribes:      ${totalOptOuts.toLocaleString()}`);
    lines.push('');
    lines.push('  ENGAGEMENT');
    lines.push(`  ${benchmarkFlag('Open Rate', avgOpenRate, 25, 18)}  [industry avg: 21%]`);
    lines.push(`  ${bar(avgOpenRate, 50)}`);
    lines.push(`  ${benchmarkFlag('Click-Through Rate', avgCTR, 3.5, 2.0)}  [industry avg: 2.6%]`);
    lines.push(`  ${bar(avgCTR, 10)}`);
    lines.push(`  Click-to-Open Rate: ${avgCTOR.toFixed(1)}%`);
    lines.push(`  Bounce Rate: ${avgBounceRate.toFixed(1)}%  ${avgBounceRate < 2 ? '✅' : avgBounceRate < 5 ? '⚠️' : '🔴'}`);
    lines.push('');

    // Sort by CTR for top/bottom
    const scorable = emails.filter(e => n(e.stats?.sent) >= 50);
    scorable.sort((a, b) => {
      const ctrA = n(a.stats?.delivered) > 0 ? n(a.stats?.uniqueClicks) / n(a.stats?.delivered) : 0;
      const ctrB = n(b.stats?.delivered) > 0 ? n(b.stats?.uniqueClicks) / n(b.stats?.delivered) : 0;
      return ctrB - ctrA;
    });

    if (scorable.length > 0) {
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('  TOP PERFORMERS (by CTR)');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      const top = scorable.slice(0, 5);
      for (let i = 0; i < top.length; i++) {
        const e = top[i];
        const s = e.stats ?? {};
        const ctr = n(s.delivered) > 0 ? ((n(s.uniqueClicks) / n(s.delivered)) * 100).toFixed(1) : '—';
        const or  = n(s.delivered) > 0 ? ((n(s.uniqueOpens) / n(s.delivered)) * 100).toFixed(1) : '—';
        const subj = (e.subject ?? e.name ?? 'Untitled').slice(0, 55);
        lines.push(`  ${i + 1}. "${subj}"`);
        lines.push(`     CTR: ${ctr}%  |  Open: ${or}%  |  Sent: ${n(s.sent).toLocaleString()}`);
      }
      lines.push('');

      if (scorable.length >= 4) {
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('  BOTTOM PERFORMERS — Flag for Subject Line Test');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const bottom = scorable.slice(-3).reverse();
        for (let i = 0; i < bottom.length; i++) {
          const e = bottom[i];
          const s = e.stats ?? {};
          const ctr = n(s.delivered) > 0 ? ((n(s.uniqueClicks) / n(s.delivered)) * 100).toFixed(1) : '—';
          const or  = n(s.delivered) > 0 ? ((n(s.uniqueOpens) / n(s.delivered)) * 100).toFixed(1) : '—';
          const subj = (e.subject ?? e.name ?? 'Untitled').slice(0, 55);
          lines.push(`  ${i + 1}. "${subj}"`);
          lines.push(`     CTR: ${ctr}%  |  Open: ${or}%  |  Sent: ${n(s.sent).toLocaleString()}`);
        }
        lines.push('');
      }
    }

    // Form handlers
    if (formHandlers.length > 0) {
      const totalFills = formHandlers.reduce((sum, f) => sum + n(f.successfulSubmissions), 0);
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push('  FORM FILLS');
      lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      lines.push(`  Total Submissions: ${totalFills.toLocaleString()}`);
      lines.push('');
      const sorted = [...formHandlers].sort((a, b) => n(b.successfulSubmissions) - n(a.successfulSubmissions));
      for (const f of sorted.slice(0, 8)) {
        const fills = n(f.successfulSubmissions);
        const views = n(f.views);
        const convRate = views > 0 ? ((fills / views) * 100).toFixed(1) + '%' : '—';
        lines.push(`  ${(f.name ?? 'Unnamed').slice(0, 45).padEnd(45)}  ${String(fills).padStart(4)} fills  ${convRate} conv`);
      }
      lines.push('');
    }

  } else {
    // ── SOQL fallback path ─────────────────────────────────────────────────
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('  EMAIL SENDS (SOQL — engagement stats not available)');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (apiError) {
      lines.push(`  ⚠️  Pardot API unavailable: ${apiError.slice(0, 120)}`);
      lines.push('  Showing send log only. Open/click stats require Pardot API access.');
      lines.push('');
    }
    lines.push(`  Sent emails in last ${days} days: ${soqlEmails.length}`);
    lines.push('');

    // Group by campaign name prefix
    const byCampaign: Record<string, SFListEmail[]> = {};
    for (const e of soqlEmails) {
      const key = e.Name?.split('_')[0] ?? 'Other';
      (byCampaign[key] ??= []).push(e);
    }
    for (const [camp, emails] of Object.entries(byCampaign).slice(0, 10)) {
      lines.push(`  ${camp.slice(0, 50).padEnd(50)}  ${emails.length} sends`);
    }
    lines.push('');
    lines.push('  To unlock open rates, CTR, and form fill data:');
    lines.push('  → Verify Pardot API v5 is enabled in your Account Engagement settings');
    lines.push('  → Check that Connected Campaigns is active in Setup');
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`  Data source: ${usingPardotApi ? 'Pardot API v5' : 'Salesforce SOQL (ListEmail)'}`);
  lines.push(`  Business Unit: ${PARDOT_BU_ID}`);
  lines.push(`  Period: ${since} → today`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

export const marketingDashboardHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_marketing_dashboard: handleMarketingDashboard,
};
