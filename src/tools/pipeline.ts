import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import { detectProducts } from '../services/healthScoring.js';
import {
  DEFAULT_RENEWAL_DAYS,
  DETECTABLE_PRODUCTS,
  PDM_PRODUCT_LIST,
  PDM_PRODUCT_PRICING,
} from '../constants.js';
import type { PDMProduct } from '../constants.js';

// ─── Tool Definitions ─────────────────────────────────────────────────────

export const pipelineTools: Tool[] = [
  {
    name: 'sf_get_renewal_pipeline',
    description:
      'Get all active accounts with Contract_Renewal_Date__c within the next N days, ' +
      'sorted by renewal date. Shows MRR, health, risk flags, and days remaining. ' +
      'PDM renewals are auto-billing — no new Opportunity is created. Use for weekly renewal reviews.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: `Number of days to look ahead (default: ${DEFAULT_RENEWAL_DAYS})`,
        },
        owner_id: {
          type: 'string',
          description: 'Filter to a specific AM by Salesforce User ID (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_upsell_opportunities',
    description:
      'Identify active accounts that are missing PDM products they do not currently subscribe to. ' +
      'Optionally filter by a specific product to target. Returns accounts with current products, ' +
      'missing products, and a recommended upsell reason.',
    inputSchema: {
      type: 'object',
      properties: {
        product: {
          type: 'string',
          enum: PDM_PRODUCT_LIST,
          description: 'Filter to accounts missing this specific product (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max accounts to return (default: 20)',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schemas ────────────────────────────────────────────────────────

const RenewalPipelineArgs = z.object({
  days:     z.number().min(1).max(365).default(DEFAULT_RENEWAL_DAYS),
  owner_id: z.string().optional(),
});

const UpsellArgs = z.object({
  product: z.string().optional(),
  limit:   z.number().min(1).max(100).default(20),
});

// ─── Handlers ─────────────────────────────────────────────────────────────

async function handleRenewalPipeline(rawArgs: unknown): Promise<string> {
  const { days, owner_id } = RenewalPipelineArgs.parse(rawArgs ?? {});

  const accounts = await salesforceService.getUpcomingRenewals(days, owner_id);

  const lines: string[] = [
    `# Renewal Pipeline — Next ${days} Days`,
    `${accounts.length} account${accounts.length === 1 ? '' : 's'} renewing`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
  ];

  if (accounts.length === 0) {
    lines.push(`No accounts with Contract_Renewal_Date__c in the next ${days} days.`);
    return lines.join('\n');
  }

  const totalMrr = accounts.reduce((sum, a) => sum + (a.Total_Monthly_Recurring_Amount__c ?? 0), 0);
  lines.push(`**Total MRR renewing:** $${totalMrr.toLocaleString()}/mo`);
  lines.push('');

  // Group by urgency
  const critical = accounts.filter((a) => daysBetween(a.Contract_Renewal_Date__c) <= 14);
  const soon     = accounts.filter((a) => { const d = daysBetween(a.Contract_Renewal_Date__c); return d > 14 && d <= 30; });
  const upcoming = accounts.filter((a) => daysBetween(a.Contract_Renewal_Date__c) > 30);

  const renderGroup = (label: string, group: typeof accounts): void => {
    if (group.length === 0) return;
    lines.push(`## ${label} (${group.length})`);
    for (const a of group) {
      const daysLeft  = daysBetween(a.Contract_Renewal_Date__c);
      const owner     = (a.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
      const mrr       = a.Total_Monthly_Recurring_Amount__c
        ? `$${a.Total_Monthly_Recurring_Amount__c.toLocaleString()}/mo` : 'MRR unknown';
      const tier      = a.Tier__c ? ` | ${a.Tier__c}` : '';
      const health    = a.Health_Tier__c
        ? ` | Health: ${a.Health_Tier__c}${a.Health_Score__c != null ? ` (${a.Health_Score__c})` : ''}`
        : '';
      const daysSince = a.LastActivityDate
        ? Math.floor((Date.now() - new Date(a.LastActivityDate).getTime()) / 86_400_000)
        : null;
      const contact   = daysSince != null
        ? (daysSince < 0 ? `Last contact: scheduled ${Math.abs(daysSince)}d from now` : `Last contact: ${daysSince}d ago`)
        : 'Last contact: Never';

      // Risk flags
      const flags: string[] = [];
      if (a.Flagged_Status__c)                         flags.push('🚩 Flagged');
      if (a.Delinquent__c)                              flags.push('💸 Delinquent');
      if (a.Cancellation_or_Pause_Request_Date__c)      flags.push('⚠️ Cancel/Pause request on file');
      if (a.Status__c === 'Non Renewing')               flags.push('🚨 Non Renewing');
      if (a.Status__c === 'Paused')                     flags.push('⏸️ Paused');

      lines.push(`### ${a.Name}`);
      lines.push(`**Renews:** ${a.Contract_Renewal_Date__c} (${daysLeft}d) | **MRR:** ${mrr}${tier}${health}`);
      lines.push(`**Owner:** ${owner} | **Status:** ${a.Status__c ?? 'Unknown'} | ${contact}`);
      if (flags.length) lines.push(`**⚠️ Risks:** ${flags.join(' · ')}`);
      lines.push('');
    }
  };

  renderGroup('🚨 Renewing in ≤ 14 Days — Act Now', critical);
  renderGroup('⚠️ Renewing in 15–30 Days', soon);
  renderGroup('📅 Renewing in 31+ Days', upcoming);

  return lines.join('\n');
}

async function handleUpsellOpportunities(rawArgs: unknown): Promise<string> {
  const { product: targetProduct, limit } = UpsellArgs.parse(rawArgs ?? {});

  // Fetch all active accounts and their products in bulk
  const [activeAccounts, allProductData] = await Promise.all([
    salesforceService.getActiveAccounts(5000),
    salesforceService.getAllActiveAccountProducts(),
  ]);

  // Build a map of accountId → Set<product>
  const accountProducts = new Map<string, Set<string>>();
  for (const { accountId, productName } of allProductData) {
    if (!accountId) continue;
    if (!accountProducts.has(accountId)) {
      accountProducts.set(accountId, new Set());
    }
    // Detect which PDM product this raw name maps to
    const detected = detectProducts([productName]);
    for (const p of detected) {
      accountProducts.get(accountId)!.add(p);
    }
  }

  // Find accounts missing the target product (or any product if no filter)
  const results: {
    accountId:   string;
    accountName: string;
    ownerName:   string;
    mrr?:        number;
    current:     string[];
    missing:     string[];
    reason:      string;
  }[] = [];

  let noProductDataCount = 0;
  for (const account of activeAccounts) {
    const current = Array.from(accountProducts.get(account.Id) ?? []);

    // Skip accounts with no product data — these are data gaps (no budget fields set),
    // not actionable upsell targets. Count them for the summary line.
    if (current.length === 0) { noProductDataCount++; continue; }

    // TCI Events = ticket sales, not recurring service gaps — exclude from upsell analysis
    const missing = PDM_PRODUCT_LIST.filter(
      (p) => !current.includes(p) && p !== 'TCI Events'
    );
    if (missing.length === 0) continue;
    if (targetProduct && !missing.includes(targetProduct as PDMProduct)) continue;

    const ownerName = (account.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
    const topMissing = targetProduct
      ? [targetProduct, ...missing.filter((p) => p !== targetProduct)]
      : missing;

    results.push({
      accountId:   account.Id,
      accountName: account.Name,
      ownerName,
      mrr:         account.Total_Monthly_Recurring_Amount__c,
      current,
      missing:     topMissing,
      reason:      buildUpsellReason(topMissing[0] as PDMProduct, account.TCI_Status__c),
    });
  }

  // Sort by MRR descending — highest revenue accounts first
  results.sort((a, b) => (b.mrr ?? 0) - (a.mrr ?? 0));

  const displayed = results.slice(0, limit);

  const lines: string[] = [
    `# Upsell Opportunities${targetProduct ? ` — ${targetProduct}` : ''}`,
    `${results.length} account(s) with upsell gaps | Showing top ${displayed.length} by MRR`,
    `*${noProductDataCount} additional accounts skipped — no budget data on file*`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
  ];

  if (displayed.length === 0) {
    lines.push('No upsell opportunities found matching the criteria.');
    return lines.join('\n');
  }

  for (const r of displayed) {
    const pricing = targetProduct
      ? PDM_PRODUCT_PRICING[targetProduct as PDMProduct]
      : null;
    const pricingNote = pricing?.monthly
      ? ` (${pricing.notes})`
      : pricing?.notes
      ? ` (${pricing.notes})`
      : '';

    const RESEARCH_PRODUCTS: PDMProduct[] = ['Web Development', 'Video & Photography', 'Traditional Media'];
    const researchGaps = r.missing.filter((p) => RESEARCH_PRODUCTS.includes(p as PDMProduct));
    const confirmedGaps = r.missing.filter((p) => !RESEARCH_PRODUCTS.includes(p as PDMProduct));

    const mrrStr = r.mrr ? `$${r.mrr.toLocaleString()}/mo` : 'MRR unknown';
    lines.push(`### ${r.accountName}`);
    lines.push(`**Owner:** ${r.ownerName} | **MRR:** ${mrrStr} | **ID:** ${r.accountId}`);
    lines.push(
      `**Current products (${r.current.length}):** ${r.current.length > 0 ? r.current.join(', ') : 'None recorded'}`
    );
    if (confirmedGaps.length > 0) {
      lines.push(`**Confirmed gaps:** ${confirmedGaps.join(', ')}${pricingNote}`);
    }
    if (researchGaps.length > 0) {
      lines.push(`**Research recommended:** ${researchGaps.join(', ')} — run \`sf_research_prospect\` to audit website, video presence, and competitive gap`);
    }
    lines.push(`**Why:** ${r.reason}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function daysBetween(isoDate: string): number {
  return Math.floor((new Date(isoDate).getTime() - Date.now()) / 86_400_000);
}

function buildUpsellReason(product: PDMProduct, tciStatus?: string): string {
  const reasons: Partial<Record<PDMProduct, string>> = {
    'TCI Mentorship':
      tciStatus === 'Member'
        ? 'Already a TCI member — upgrade to monthly mentorship program'
        : 'Not yet a TCI member — strong pipeline for mentorship at $3,500/mo',
    'PPC':
      'PPC is highest-ROI digital channel for dental implant practices; no paid ads on record',
    'SEO':
      'Organic search drives 40%+ of dental inquiries — no SEO service on record',
    'Social Media':
      'Social proof is critical for elective dental procedures; no social management on record',
    'Video & Photography':
      'Before/after content drives case acceptance; no video/photo service on record',
    'Web Development':
      'No web development service — site may be outdated or unoptimized for conversions',
    'TCI Events':
      'TCI events accelerate implant case volume; not registered for any events',
    'Traditional Media':
      'Traditional media (radio/direct mail) can expand reach in local market',
  };
  return reasons[product] ?? `Not currently subscribed to ${product}`;
}

// ─── Router ───────────────────────────────────────────────────────────────

export const pipelineHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_renewal_pipeline:      handleRenewalPipeline,
  sf_get_upsell_opportunities:  handleUpsellOpportunities,
};
