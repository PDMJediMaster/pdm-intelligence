import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import { detectProducts } from '../services/healthScoring.js';
import {
  DEFAULT_RENEWAL_DAYS,
  DETECTABLE_PRODUCTS,
  PDM_PRODUCT_LIST,
  PDM_PRODUCT_PRICING,
  PRODUCT_CLASSIFICATION,
  PRODUCT_KEYWORDS,
} from '../constants.js';
import type { PDMProduct, ProductLifecycle } from '../constants.js';
import { statusLabel, ACTIVE_STATUS_VALUES } from './healthReports.js';

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
      'Intelligent upsell engine that analyzes purchase history, product lifecycle, and time since purchase ' +
      'to classify gaps as Upsell (ready to buy), Nurture (needs cultivation), or Win Back (had it, lost it). ' +
      'Checks Closed Won Opportunities + line items, budget fields, and TCI status. ' +
      'Website bought 2 years ago = not an upsell. Video bought 2 years ago = refreshable content, nurture. ' +
      'TCI Mentorship cancelled 6 months ago = too soon. Cancelled 2 years ago = re-engage. ' +
      'Optionally filter by product, owner, or classification type.',
    inputSchema: {
      type: 'object',
      properties: {
        product: {
          type: 'string',
          enum: PDM_PRODUCT_LIST,
          description: 'Filter to accounts missing this specific product (optional)',
        },
        owner_id: {
          type: 'string',
          description: 'Filter to a specific AM by Salesforce User ID (optional)',
        },
        classification: {
          type: 'string',
          enum: ['upsell', 'nurture', 'win_back', 'all'],
          description: 'Filter by gap classification (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Max accounts to return (default: 25)',
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
  product:        z.string().optional(),
  owner_id:       z.string().optional(),
  classification: z.enum(['upsell', 'nurture', 'win_back', 'all']).default('all'),
  limit:          z.number().min(1).max(100).default(25),
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
      if (a.Status__c === '24' || a.Status__c === 'Non Renewing')  flags.push('🚨 Non Renewing');
      if (a.Status__c === '120' || a.Status__c === 'Paused')     flags.push('⏸️ Paused');

      lines.push(`### ${a.Name}`);
      lines.push(`**Renews:** ${a.Contract_Renewal_Date__c} (${daysLeft}d) | **MRR:** ${mrr}${tier}${health}`);
      lines.push(`**Owner:** ${owner} | **Status:** ${statusLabel(a.Status__c)} | ${contact}`);
      if (flags.length) lines.push(`**⚠️ Risks:** ${flags.join(' · ')}`);
      lines.push('');
    }
  };

  renderGroup('🚨 Renewing in ≤ 14 Days — Act Now', critical);
  renderGroup('⚠️ Renewing in 15–30 Days', soon);
  renderGroup('📅 Renewing in 31+ Days', upcoming);

  return lines.join('\n');
}

// ─── Upsell Classification Types ─────────────────────────────────────────

type GapClassification = 'upsell' | 'nurture' | 'win_back';

interface ProductGap {
  product:        PDMProduct;
  classification: GapClassification;
  reason:         string;
  lastPurchased?: string; // ISO date of last closed-won Opp with this product
  monthsSince?:   number; // months since last purchase
  hadBefore:      boolean;
}

interface UpsellResult {
  accountId:   string;
  accountName: string;
  ownerName:   string;
  status:      string;
  mrr?:        number;
  current:     string[];
  gaps:        ProductGap[];
}

async function handleUpsellOpportunities(rawArgs: unknown): Promise<string> {
  const { product: targetProduct, owner_id, classification: classFilter, limit } =
    UpsellArgs.parse(rawArgs ?? {});

  // ── Step 1: Parallel data fetch ──────────────────────────────────────────
  // Active accounts + budget-based products + ALL historical Opp line items
  const ownerClause = owner_id ? `AND OwnerId = '${owner_id}'` : '';

  const [activeAccounts, allProductData, historicalProducts, oppsByPhase] = await Promise.all([
    salesforceService.getActiveAccounts(5000),
    salesforceService.getAllActiveAccountProducts(),
    // Fetch ALL closed-won Opp line items across all accounts for product history
    salesforceService.rawQuery<{
      Id: string;
      OpportunityId: string;
      Product2: { Name: string; Family: string | null } | null;
      Opportunity: { CloseDate: string; Phase__c: string | null; AccountId: string } | null;
    }>(`
      SELECT Id, OpportunityId, Product2.Name, Product2.Family,
             Opportunity.CloseDate, Opportunity.Phase__c,
             Opportunity.AccountId
      FROM OpportunityLineItem
      WHERE Opportunity.StageName = 'Closed Won'
        AND Opportunity.AccountId != null
        AND Opportunity.Account.OwnerId != '005PU000001eUQDYA2'
        AND Product2.Name != null
        ${ownerClause ? `AND Opportunity.Account.${ownerClause.replace('AND ', '')}` : ''}
      ORDER BY Opportunity.CloseDate DESC
    `),
    // Fallback: Fetch Opps by Phase (catches Phase 1 Opps with no line items)
    salesforceService.rawQuery<{
      Id: string;
      AccountId: string;
      Phase__c: string;
      CloseDate: string;
      Name: string;
    }>(`
      SELECT Id, AccountId, Phase__c, CloseDate, Name
      FROM Opportunity
      WHERE StageName = 'Closed Won'
        AND Phase__c IN ('Phase 1', 'TCI Mentorship')
        AND AccountId != null
        AND Account.OwnerId != '005PU000001eUQDYA2'
        ${ownerClause ? `AND Account.${ownerClause.replace('AND ', '')}` : ''}
      ORDER BY CloseDate DESC
    `),
  ]);

  // ── Step 2: Build account → current active products (from budget fields) ─
  const accountActiveProducts = new Map<string, Set<string>>();
  for (const { accountId, productName } of allProductData) {
    if (!accountId) continue;
    if (!accountActiveProducts.has(accountId)) accountActiveProducts.set(accountId, new Set());
    const detected = detectProducts([productName]);
    for (const p of detected) accountActiveProducts.get(accountId)!.add(p);
  }

  // ── Step 3: Build account → product purchase history ─────────────────────
  // For each account+product combo, store the MOST RECENT close date
  const accountHistory = new Map<string, Map<PDMProduct, string>>(); // acctId → (product → lastCloseDate)

  for (const item of historicalProducts) {
    const acctId = item.Opportunity?.AccountId;
    if (!acctId) continue;

    // Detect which PDM product(s) this line item maps to
    const productName = item.Product2?.Name ?? '';
    const family = item.Product2?.Family ?? '';
    const closeDate = item.Opportunity?.CloseDate ?? '';
    const phase = item.Opportunity?.Phase__c ?? null;
    const matchedProducts = detectProductFromLineItem(productName, family, phase);

    for (const pdmProduct of matchedProducts) {
      if (!accountHistory.has(acctId)) accountHistory.set(acctId, new Map());
      const history = accountHistory.get(acctId)!;
      // Keep the most recent close date
      const existing = history.get(pdmProduct);
      if (!existing || closeDate > existing) {
        history.set(pdmProduct, closeDate);
      }
    }
  }

  // ── Step 3b: Fallback — use Opp Phase to infer products when no line items ──
  // Phase 1 Opps typically include Website + Video (the foundation package).
  // Use the Opp name to try to narrow it down; fallback to both Web + Video.
  for (const opp of oppsByPhase) {
    if (!opp.AccountId) continue;
    if (!accountHistory.has(opp.AccountId)) accountHistory.set(opp.AccountId, new Map());
    const history = accountHistory.get(opp.AccountId)!;
    const nameLower = opp.Name.toLowerCase();

    if (opp.Phase__c === 'Phase 1') {
      // If line items already identified specific products, skip the fallback
      const hasWebFromLineItems = history.has('Web Development');
      const hasVideoFromLineItems = history.has('Video & Photography');

      // Use Opp name to narrow — but Phase 1 usually includes both
      if (!hasWebFromLineItems) {
        // Phase 1 almost always includes a website unless name says otherwise
        if (!nameLower.includes('video only') && !nameLower.includes('video package')) {
          const existing = history.get('Web Development');
          if (!existing || opp.CloseDate > existing) {
            history.set('Web Development', opp.CloseDate);
          }
        }
      }
      if (!hasVideoFromLineItems) {
        // Most Phase 1 packages include video
        if (nameLower.includes('video') || nameLower.includes('momentum') ||
            nameLower.includes('cultural') || nameLower.includes('package') ||
            nameLower.includes('development')) {
          const existing = history.get('Video & Photography');
          if (!existing || opp.CloseDate > existing) {
            history.set('Video & Photography', opp.CloseDate);
          }
        }
      }
    }

    if (opp.Phase__c === 'TCI Mentorship') {
      // Ensure TCI Mentorship history is captured even without line items
      const existing = history.get('TCI Mentorship');
      if (!existing || opp.CloseDate > existing) {
        history.set('TCI Mentorship', opp.CloseDate);
      }
    }
  }

  // ── Step 4: Build account map for quick lookup ───────────────────────────
  const accountMap = new Map(activeAccounts.map((a) => [a.Id, a]));

  // ── Step 5: Classify gaps per account ────────────────────────────────────
  const results: UpsellResult[] = [];
  let noProductDataCount = 0;

  // Filter by owner if specified
  const filteredAccounts = owner_id
    ? activeAccounts.filter((a) => a.OwnerId === owner_id)
    : activeAccounts;

  for (const account of filteredAccounts) {
    const currentActive = Array.from(accountActiveProducts.get(account.Id) ?? []);
    const history = accountHistory.get(account.Id) ?? new Map<PDMProduct, string>();

    // Skip accounts with zero current products AND zero history — data gaps
    if (currentActive.length === 0 && history.size === 0) { noProductDataCount++; continue; }

    const gaps: ProductGap[] = [];

    for (const product of PDM_PRODUCT_LIST) {
      const classification = PRODUCT_CLASSIFICATION[product];

      const isCurrentlyActive = currentActive.includes(product);
      const lastPurchaseDate = history.get(product);
      const monthsSince = lastPurchaseDate ? monthsBetween(lastPurchaseDate) : null;

      // ── TCI Events (conference tickets — ALWAYS a product) ──
      // 3 conferences/year: Vegas (March), Dallas (July), FAGC (November).
      // No cooldown — the moment one event ends, the next one is selling.
      if (classification.lifecycle === 'event') {
        if (lastPurchaseDate && monthsSince != null) {
          gaps.push({
            product,
            classification: 'upsell',
            reason: `Last event: ${formatMonthsAgo(monthsSince)}. Next conference is selling now — Vegas (March), Dallas (July), FAGC Orlando (November).`,
            lastPurchased: lastPurchaseDate,
            monthsSince,
            hadBefore: true,
          });
        } else {
          gaps.push({
            product,
            classification: 'upsell',
            reason: 'Never attended a TCI Event. Conferences accelerate implant case volume — 3 events/year.',
            hadBefore: false,
          });
        }
        continue;
      }

      // ── Recurring products (PPC, SEO, Social, Traditional Media) ──
      if (classification.lifecycle === 'recurring') {
        if (isCurrentlyActive) continue; // Has it now — skip

        if (lastPurchaseDate && monthsSince != null) {
          // Had it before, doesn't have it now = Win Back
          gaps.push({
            product,
            classification: 'win_back',
            reason: `Had ${product} (last active ${formatMonthsAgo(monthsSince)}) — no longer subscribed. Win-back opportunity.`,
            lastPurchased: lastPurchaseDate,
            monthsSince,
            hadBefore: true,
          });
        } else {
          // Never had it = Upsell
          gaps.push({
            product,
            classification: 'upsell',
            reason: buildNewProductReason(product),
            hadBefore: false,
          });
        }
        continue;
      }

      // ── TCI Mentorship (recurring_cancellable) ──
      if (classification.lifecycle === 'recurring_cancellable') {
        const tciStatus = account.TCI_Status__c;

        // Currently active = skip
        if (tciStatus === 'Member' || tciStatus === 'Pending Onboarding' ||
            tciStatus === 'No Start Date' || tciStatus === 'Funds Transferred' ||
            account.TCI_Enrolled__c) continue;

        // In transition (30 Day Notice, Paused, Delinquent) = skip, not an upsell target right now
        if (tciStatus === '30 Day Notice Rcvd' || tciStatus === 'Paused' || tciStatus === 'Delinquent') continue;

        const nurtureThresh = classification.nurtureAfterMonths ?? 12;
        const upsellThresh  = classification.upsellAfterMonths ?? 18;

        if (tciStatus === 'Cancelled' || tciStatus === 'Non-Renewal') {
          // Use last TCI Opp close date as proxy for cancellation timing
          if (monthsSince != null) {
            if (monthsSince < nurtureThresh) {
              // Too soon — skip entirely. Cancelled < 12 months ago.
              continue;
            } else if (monthsSince < upsellThresh) {
              gaps.push({
                product,
                classification: 'nurture',
                reason: `TCI ${tciStatus} ${formatMonthsAgo(monthsSince)}. Enough time has passed to start planting the seed for re-enrollment.`,
                lastPurchased: lastPurchaseDate,
                monthsSince,
                hadBefore: true,
              });
            } else {
              gaps.push({
                product,
                classification: 'win_back',
                reason: `TCI ${tciStatus} ${formatMonthsAgo(monthsSince)}. Significant time has passed — ready for re-engagement conversation.`,
                lastPurchased: lastPurchaseDate,
                monthsSince,
                hadBefore: true,
              });
            }
          } else {
            // Cancelled but no Opp date — treat as nurture (conservative)
            gaps.push({
              product,
              classification: 'nurture',
              reason: `TCI ${tciStatus} (enrollment date unknown). Approach carefully for re-enrollment conversation.`,
              lastPurchased: undefined,
              hadBefore: true,
            });
          }
        } else if (tciStatus === 'Not Enrolled' || !tciStatus) {
          // Never enrolled = Upsell
          gaps.push({
            product,
            classification: 'upsell',
            reason: 'Not enrolled in TCI Mentorship. Staff training drives case acceptance and implant revenue at $3,500/mo.',
            hadBefore: false,
          });
        }
        continue;
      }

      // ── One-time permanent / refreshable (Website, Video, Graphic Design) ──
      if (classification.lifecycle === 'permanent' || classification.lifecycle === 'refreshable') {
        const nurtureThresh = classification.nurtureAfterMonths ?? 36;
        const upsellThresh  = classification.upsellAfterMonths ?? 48;

        if (lastPurchaseDate && monthsSince != null) {
          if (monthsSince < nurtureThresh) {
            // Bought recently enough — not an upsell or nurture
            continue;
          } else if (monthsSince < upsellThresh) {
            // In the nurture window
            const reason = classification.lifecycle === 'refreshable'
              ? `${product} purchased ${formatMonthsAgo(monthsSince)}. Content ages — new patients, new staff, new procedures. Time to start the refresh conversation.`
              : `${product} purchased ${formatMonthsAgo(monthsSince)}. May be approaching time for a refresh. Start planting the seed.`;
            gaps.push({
              product,
              classification: 'nurture',
              reason,
              lastPurchased: lastPurchaseDate,
              monthsSince,
              hadBefore: true,
            });
          } else {
            // Past upsell threshold
            const reason = classification.lifecycle === 'refreshable'
              ? `${product} purchased ${formatMonthsAgo(monthsSince)}. Content is stale — before/after photos, testimonials, and staff have all changed. Ready for a new package.`
              : `${product} purchased ${formatMonthsAgo(monthsSince)}. Likely outdated and due for a rebuild.`;
            gaps.push({
              product,
              classification: 'upsell',
              reason,
              lastPurchased: lastPurchaseDate,
              monthsSince,
              hadBefore: true,
            });
          }
        } else {
          // Never purchased = Upsell
          gaps.push({
            product,
            classification: 'upsell',
            reason: buildNewProductReason(product),
            hadBefore: false,
          });
        }
        continue;
      }
    }

    // Apply filters
    const filteredGaps = gaps.filter((g) => {
      if (targetProduct && g.product !== targetProduct) return false;
      if (classFilter !== 'all' && g.classification !== classFilter) return false;
      return true;
    });

    if (filteredGaps.length === 0) continue;

    // Sort gaps: upsell first, then win_back, then nurture
    const classOrder: Record<GapClassification, number> = { upsell: 0, win_back: 1, nurture: 2 };
    filteredGaps.sort((a, b) => classOrder[a.classification] - classOrder[b.classification]);

    const ownerName = (account.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown';
    results.push({
      accountId:   account.Id,
      accountName: account.Name,
      ownerName,
      status:      statusLabel(account.Status__c),
      mrr:         account.Total_Monthly_Recurring_Amount__c,
      current:     currentActive,
      gaps:        filteredGaps,
    });
  }

  // Sort by MRR descending — highest revenue accounts first
  results.sort((a, b) => (b.mrr ?? 0) - (a.mrr ?? 0));

  const displayed = results.slice(0, limit);

  // ── Step 6: Summary stats ────────────────────────────────────────────────
  const allGaps = results.flatMap((r) => r.gaps);
  const upsellCount   = allGaps.filter((g) => g.classification === 'upsell').length;
  const nurtureCount  = allGaps.filter((g) => g.classification === 'nurture').length;
  const winBackCount  = allGaps.filter((g) => g.classification === 'win_back').length;

  const classLabel = classFilter === 'all' ? '' : ` — ${classFilter.replace('_', ' ').toUpperCase()} only`;
  const lines: string[] = [
    `# Upsell Intelligence${targetProduct ? ` — ${targetProduct}` : ''}${classLabel}`,
    `${results.length} account(s) with actionable gaps | Showing top ${displayed.length} by MRR`,
    `**🎯 Upsell:** ${upsellCount} gaps | **🌱 Nurture:** ${nurtureCount} gaps | **🔄 Win Back:** ${winBackCount} gaps`,
    `*${noProductDataCount} additional accounts skipped — no product data or purchase history*`,
    `Generated: ${new Date().toLocaleString()}`,
    '',
    '**Legend:** 🎯 Upsell = ready to buy | 🌱 Nurture = plant the seed | 🔄 Win Back = had it, re-engage',
    '',
  ];

  if (displayed.length === 0) {
    lines.push('No upsell opportunities found matching the criteria.');
    return lines.join('\n');
  }

  for (const r of displayed) {
    const mrrStr = r.mrr ? `$${r.mrr.toLocaleString()}/mo` : 'MRR unknown';
    lines.push(`### ${r.accountName}`);
    lines.push(`**Owner:** ${r.ownerName} | **MRR:** ${mrrStr} | **Status:** ${r.status}`);
    lines.push(
      `**Active products (${r.current.length}):** ${r.current.length > 0 ? r.current.join(', ') : 'None detected'}`
    );

    // Group gaps by classification
    const upsellGaps  = r.gaps.filter((g) => g.classification === 'upsell');
    const nurtureGaps = r.gaps.filter((g) => g.classification === 'nurture');
    const winBackGaps = r.gaps.filter((g) => g.classification === 'win_back');

    if (upsellGaps.length > 0) {
      lines.push(`**🎯 Upsell (${upsellGaps.length}):**`);
      for (const g of upsellGaps) {
        const historyTag = g.lastPurchased ? ` *(last: ${g.lastPurchased})*` : ' *(never purchased)*';
        lines.push(`  - **${g.product}**${historyTag} — ${g.reason}`);
      }
    }

    if (winBackGaps.length > 0) {
      lines.push(`**🔄 Win Back (${winBackGaps.length}):**`);
      for (const g of winBackGaps) {
        const dateTag = g.lastPurchased ? ` *(last: ${g.lastPurchased})*` : '';
        lines.push(`  - **${g.product}**${dateTag} — ${g.reason}`);
      }
    }

    if (nurtureGaps.length > 0) {
      lines.push(`**🌱 Nurture (${nurtureGaps.length}):**`);
      for (const g of nurtureGaps) {
        const dateTag = g.lastPurchased ? ` *(last: ${g.lastPurchased})*` : '';
        lines.push(`  - **${g.product}**${dateTag} — ${g.reason}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function daysBetween(isoDate: string): number {
  return Math.floor((new Date(isoDate).getTime() - Date.now()) / 86_400_000);
}

function monthsBetween(isoDate: string): number {
  const then = new Date(isoDate);
  const now = new Date();
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}

function formatMonthsAgo(months: number): string {
  if (months < 1) return 'less than a month ago';
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem === 0) return `${years} year${years === 1 ? '' : 's'} ago`;
  return `${years}y ${rem}m ago`;
}

/**
 * Detect which PDM product(s) a line item maps to, using Product2.Name, Family, and Opp Phase.
 * More accurate than detectProducts() because it also uses Phase__c context.
 */
function detectProductFromLineItem(
  productName: string,
  family: string,
  phase: string | null
): PDMProduct[] {
  const nameLower = productName.toLowerCase();
  const familyLower = (family ?? '').toLowerCase();

  // Skip discounts, setup fees, and non-product items
  if (nameLower.includes('discount') || nameLower.includes('credit')) return [];

  // Use Product2.Family as primary signal when available
  if (familyLower === 'web') return ['Web Development'];
  if (familyLower === 'video') return ['Video & Photography'];
  if (familyLower === 'graphics') return ['Web Development']; // Graphic design = Phase 1 foundation
  if (familyLower === 'traditional media') return ['Traditional Media'];
  if (familyLower === 'tci') return ['TCI Mentorship'];
  if (familyLower === 'tci tickets') return ['TCI Events'];

  // Marketing family needs keyword sub-matching (could be PPC, SEO, or Social)
  if (familyLower === 'marketing') {
    const matched: PDMProduct[] = [];
    if (nameLower.includes('ppc') || nameLower.includes('pay per click') || nameLower.includes('google ad'))
      matched.push('PPC');
    if (nameLower.includes('seo') || nameLower.includes('search engine'))
      matched.push('SEO');
    if (nameLower.includes('social'))
      matched.push('Social Media');
    // Setup fees / drip systems / generic marketing — use Phase context
    if (matched.length === 0 && nameLower.includes('setup'))
      return []; // Setup fees are not a product
    if (matched.length === 0 && nameLower.includes('drip'))
      return []; // Drip system is add-on, not standalone product
    if (matched.length === 0 && nameLower.includes('digital monthly'))
      return ['PPC', 'SEO', 'Social Media']; // Bundled service
    return matched.length > 0 ? matched : [];
  }

  // No family — fall back to keyword matching on name
  if (familyLower === '' || familyLower === 'none' || familyLower === 'bundle') {
    // Check for bundles that contain multiple products
    if (nameLower.includes('bundle') || nameLower.includes('practice development') ||
        nameLower.includes('package advanced') || nameLower.includes('package -')) {
      // Bundles typically include Web + Video + Events — count both
      const bundleProducts: PDMProduct[] = ['Web Development', 'Video & Photography'];
      return bundleProducts;
    }

    // Keyword matching against product names
    for (const [product, keywords] of Object.entries(PRODUCT_KEYWORDS)) {
      for (const kw of keywords) {
        if (nameLower.includes(kw.toLowerCase())) {
          return [product as PDMProduct];
        }
      }
    }
  }

  return [];
}

function buildNewProductReason(product: PDMProduct): string {
  const reasons: Partial<Record<PDMProduct, string>> = {
    'PPC':
      'PPC is highest-ROI digital channel for dental implant practices. No paid ads history on record.',
    'SEO':
      'Organic search drives 40%+ of dental inquiries. No SEO service history on record.',
    'Social Media':
      'Social proof is critical for elective dental procedures. No social management history on record.',
    'Video & Photography':
      'Before/after content drives case acceptance. No video/photo purchase history on record.',
    'Web Development':
      'No website development history — site may be outdated or unoptimized for conversions.',
    'Traditional Media':
      'Traditional media (radio/direct mail) can expand reach in local market. No history on record.',
    'TCI Mentorship':
      'Not enrolled in TCI Mentorship. Staff training drives case acceptance and implant revenue at $3,500/mo.',
    'TCI Events':
      'No TCI Event history on record. TCI conferences accelerate implant case volume — 3 events/year.',
  };
  return reasons[product] ?? `No purchase history for ${product}.`;
}

// ─── Router ───────────────────────────────────────────────────────────────

export const pipelineHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_renewal_pipeline:      handleRenewalPipeline,
  sf_get_upsell_opportunities:  handleUpsellOpportunities,
};
