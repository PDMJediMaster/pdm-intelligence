import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import { detectProducts } from '../services/healthScoring.js';
import {
  DEFAULT_RENEWAL_DAYS,
  PDM_PRODUCT_LIST,
  PDM_PRODUCT_PRICING,
} from '../constants.js';
import type { PDMProduct } from '../constants.js';

// ─── Tool Definitions ─────────────────────────────────────────────────────

export const pipelineTools: Tool[] = [
  {
    name: 'sf_get_renewal_pipeline',
    description:
      'Get all active accounts with open opportunities closing within the next N days, ' +
      'sorted by close date. Shows opportunity stage, amount, and days remaining. ' +
      'Use for weekly renewal pipeline reviews.',
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: `Number of days to look ahead (default: ${DEFAULT_RENEWAL_DAYS})`,
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
  days: z.number().min(1).max(365).default(DEFAULT_RENEWAL_DAYS),
});

const UpsellArgs = z.object({
  product: z.string().optional(),
  limit:   z.number().min(1).max(100).default(20),
});

// ─── Handlers ─────────────────────────────────────────────────────────────

async function handleRenewalPipeline(rawArgs: unknown): Promise<string> {
  const { days } = RenewalPipelineArgs.parse(rawArgs ?? {});

  const renewals = await salesforceService.getUpcomingRenewals(days);

  const lines: string[] = [
    `# Renewal Pipeline — Next ${days} Days`,
    `${renewals.length} open opportunit${renewals.length === 1 ? 'y' : 'ies'} found`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
  ];

  if (renewals.length === 0) {
    lines.push(`No open opportunities closing in the next ${days} days.`);
    return lines.join('\n');
  }

  // Group by urgency tier
  const urgent  = renewals.filter((r) => daysBetween(r.CloseDate) <= 14);
  const soon    = renewals.filter((r) => { const d = daysBetween(r.CloseDate); return d > 14 && d <= 30; });
  const upcoming = renewals.filter((r) => daysBetween(r.CloseDate) > 30);

  const totalValue = renewals.reduce((sum, r) => sum + (r.Amount ?? 0), 0);
  lines.push(`**Total pipeline value:** $${totalValue.toLocaleString()}`);
  lines.push('');

  const renderGroup = (label: string, opps: typeof renewals): void => {
    if (opps.length === 0) return;
    lines.push(`## ${label} (${opps.length})`);
    for (const r of opps) {
      const daysLeft = daysBetween(r.CloseDate);
      const amt  = r.Amount ? `$${r.Amount.toLocaleString()}` : 'No amount';
      const owner = r.Account?.Owner?.Name ?? 'Unknown';
      const acctName = r.Account?.Name ?? r.AccountId;

      lines.push(`### ${acctName}`);
      lines.push(`- **Opp:** ${r.Name}`);
      lines.push(`- **Stage:** ${r.StageName} | **Closes:** ${r.CloseDate} (${daysLeft} days)`);
      lines.push(`- **Amount:** ${amt} | **Owner:** ${owner}`);
      lines.push('');
    }
  };

  renderGroup('🚨 Close Immediately (≤ 14 days)', urgent);
  renderGroup('⚠️ Closing Soon (15–30 days)', soon);
  renderGroup('📅 Upcoming (31+ days)', upcoming);

  return lines.join('\n');
}

async function handleUpsellOpportunities(rawArgs: unknown): Promise<string> {
  const { product: targetProduct, limit } = UpsellArgs.parse(rawArgs ?? {});

  // Fetch all active accounts and their products in bulk
  const [activeAccounts, allProductData] = await Promise.all([
    salesforceService.getActiveAccounts(500),
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
    current:     string[];
    missing:     string[];
    reason:      string;
  }[] = [];

  for (const account of activeAccounts) {
    const current = Array.from(accountProducts.get(account.Id) ?? []);
    const missing = PDM_PRODUCT_LIST.filter((p) => !current.includes(p));

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
      current,
      missing:     topMissing,
      reason:      buildUpsellReason(topMissing[0] as PDMProduct, account.TCI_Status__c),
    });
  }

  // Sort: accounts with fewest current products first (most opportunity)
  results.sort((a, b) => a.current.length - b.current.length);

  const displayed = results.slice(0, limit);

  const lines: string[] = [
    `# Upsell Opportunities${targetProduct ? ` — ${targetProduct}` : ''}`,
    `${results.length} account(s) identified | Showing top ${displayed.length}`,
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

    lines.push(`### ${r.accountName}`);
    lines.push(`**Owner:** ${r.ownerName} | **ID:** ${r.accountId}`);
    lines.push(
      `**Current products (${r.current.length}):** ${r.current.length > 0 ? r.current.join(', ') : 'None recorded'}`
    );
    lines.push(
      `**Missing:** ${r.missing.slice(0, 4).join(', ')}${r.missing.length > 4 ? `, +${r.missing.length - 4} more` : ''}${pricingNote}`
    );
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
