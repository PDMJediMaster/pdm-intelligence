// ─────────────────────────────────────────────────────────────────────────────
// Auto Lead Scan — Market Crawler → Dedup → Lead Creator
//
// Two modes:
//   Mode 1 (auto-crawl): city + state → Firecrawl search → parse → dedup → create Leads
//   Mode 2 (import): practices[] array → dedup → create Leads
//
// All created Leads get:
//   LeadSource = 'PDM Prophet Scan'
//   OwnerId = '005PU000009AWCkYAO' (Service Account → Kubaru round-robin)
//   Status = 'Open - Not Contacted'
//
// After scan: run sf_research_prospect on each new Lead for full scoring.
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_ID = '005PU000009AWCkYAO';

/** Domains that are directories / aggregators — not actual practice websites */
const DIRECTORY_DOMAINS = new Set([
  'yelp.com', 'healthgrades.com', 'zocdoc.com', 'google.com',
  'facebook.com', 'instagram.com', 'youtube.com', 'tiktok.com',
  'realself.com', 'vitals.com', 'webmd.com', 'nerdwallet.com',
  'forbes.com', 'ada.org', 'wikipedia.org', 'reddit.com', 'quora.com',
  'bbb.org', 'yellowpages.com', 'manta.com', 'mapquest.com',
  'progressivedental.com', 'theclosinginstitute.com',
  'linkedin.com', 'twitter.com', 'x.com', 'pinterest.com',
  'bing.com', 'apple.com', 'nextdoor.com', 'angi.com',
  'dentalimplants.com', 'dentalimplantcostguide.com',
  'aspendentalimplants.com', 'clearchoice.com',
]);

/** Title patterns that indicate directory / article pages, not practices */
const NON_PRACTICE_PATTERNS = [
  /best\s+\d+\s+dentist/i,
  /top\s+\d+/i,
  /dental\s+directory/i,
  /find\s+a\s+dentist/i,
  /how\s+(to|much)\s+/i,
  /what\s+(is|are)\s+/i,
  /cost\s+of\s+dental/i,
  /^reviews\s+of/i,
  /affordable\s+dental\s+implants\s+near/i,
  /\d+\s+best\s+/i,
  /vs\.?\s+/i,
];

// ─── Firecrawl Types ─────────────────────────────────────────────────────────

interface FirecrawlSearchResult {
  url: string;
  title: string;
  description?: string;
}

interface FirecrawlSearchResponse {
  success: boolean;
  data?: FirecrawlSearchResult[];
  error?: string;
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface PracticeCandidate {
  name: string;
  website?: string;
  city?: string;
  state?: string;
  phone?: string;
  address?: string;
  source: string;
}

interface SFRecord {
  Id: string;
  Name?: string;
  Company?: string;
  Website?: string;
  City?: string;
  State?: string;
  BillingCity?: string;
  BillingState?: string;
  Status__c?: string;
  LastActivityDate?: string;
  OwnerId?: string;
  LeadSource?: string;
}

interface CreatedLead {
  id: string;
  name: string;
  website?: string;
  city?: string;
  state?: string;
}

interface RevivedLead {
  id: string;
  name: string;
  previousOwner?: string;
  previousSource?: string;
  daysSinceActivity?: number;
}

// ─── Zod Schema ──────────────────────────────────────────────────────────────

const PracticeInput = z.object({
  name:    z.string(),
  website: z.string().optional(),
  city:    z.string().optional(),
  state:   z.string().optional(),
  phone:   z.string().optional(),
  address: z.string().optional(),
});

const AutoLeadScanArgs = z.object({
  city:        z.string().optional(),
  state:       z.string().optional(),
  max_results: z.number().min(1).max(100).default(20),
  practices:   z.array(PracticeInput).optional(),
  send_email:  z.boolean().default(true),
});

// ─── Tool Definition ─────────────────────────────────────────────────────────

export const autoLeadScanTools: Tool[] = [
  {
    name: 'sf_auto_lead_scan',
    description:
      'Auto lead generation pipeline. Crawls a dental implant market via Firecrawl search, ' +
      'deduplicates against existing Salesforce Leads and Accounts, creates new Lead records ' +
      'with LeadSource = "PDM Prophet Scan" and OwnerId = Service Account for Kubaru round-robin. ' +
      'Returns created Lead IDs for follow-up sf_research_prospect scoring. ' +
      'Can also accept a pre-crawled practices array from Apify Google Places or manual input. ' +
      'After this tool runs, call sf_research_prospect on each new Lead for full scoring, ' +
      'then send the email notification included in the output.',
    inputSchema: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'Target market city (e.g., "Dallas"). Required for auto-crawl mode.',
        },
        state: {
          type: 'string',
          description: 'Target market state 2-letter code (e.g., "TX"). Required for auto-crawl mode.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum practices to scan per market (default 20, max 100)',
        },
        practices: {
          type: 'array',
          description:
            'Pre-crawled practice list from Apify Google Places, Firecrawl, or manual input. ' +
            'If provided, skips Firecrawl auto-crawl and uses this list directly for dedup + Lead creation.',
          items: {
            type: 'object',
            properties: {
              name:    { type: 'string', description: 'Practice name (required)' },
              website: { type: 'string', description: 'Website URL' },
              city:    { type: 'string', description: 'City' },
              state:   { type: 'string', description: 'State (2-letter code)' },
              phone:   { type: 'string', description: 'Phone number' },
              address: { type: 'string', description: 'Street address' },
            },
            required: ['name'],
          },
        },
        send_email: {
          type: 'boolean',
          description: 'Include email notification instructions in output (default true)',
        },
      },
      required: [],
    },
  },
];

// ─── Firecrawl Search ────────────────────────────────────────────────────────

async function firecrawlSearch(query: string, limit: number): Promise<FirecrawlSearchResult[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error(
      'FIRECRAWL_API_KEY not set in .env — required for auto-crawl mode. ' +
      'Use import mode (practices[] param) as an alternative.'
    );
  }

  const response = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit,
      lang: 'en',
      country: 'us',
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'unknown error');
    throw new Error(`Firecrawl search failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as FirecrawlSearchResponse;
  if (!data.success) {
    throw new Error(`Firecrawl search error: ${data.error ?? 'unknown'}`);
  }

  return data.data ?? [];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isDirectorySite(url: string): boolean {
  const domain = extractDomain(url);
  for (const blocked of DIRECTORY_DOMAINS) {
    if (domain === blocked || domain.endsWith('.' + blocked)) return true;
  }
  return false;
}

function extractPracticeName(title: string): string | null {
  // Strip trailing site identifiers
  const cleaned = title
    .replace(/\s*[-|–—:]\s*(Google Maps|Yelp|Facebook|Healthgrades|Zocdoc|RealSelf|Vitals|Reviews).*$/i, '')
    .replace(/\s*[-|–—:]\s*(Dental Office|Dentist|DDS|DMD|Home)$/i, '')
    .replace(/^\d+\.\s*/, '')
    .trim();

  if (cleaned.length < 3 || cleaned.length > 120) return null;
  if (NON_PRACTICE_PATTERNS.some(p => p.test(cleaned))) return null;

  return cleaned;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function soqlEscape(s: string): string {
  return s.replace(/'/g, "\\'");
}

// ─── Firecrawl Market Crawl ──────────────────────────────────────────────────

async function crawlMarket(
  city: string,
  state: string,
  maxResults: number,
): Promise<{ candidates: PracticeCandidate[]; rawCount: number; queryCount: number }> {
  const queries = [
    `dental implant dentist ${city} ${state}`,
    `full arch dental implants ${city} ${state}`,
    `All-on-4 dental ${city} ${state}`,
  ];

  const allResults: FirecrawlSearchResult[] = [];
  const seenDomains = new Set<string>();

  for (const query of queries) {
    try {
      const results = await firecrawlSearch(query, Math.ceil(maxResults / 2));
      for (const r of results) {
        const domain = extractDomain(r.url);
        if (!seenDomains.has(domain)) {
          seenDomains.add(domain);
          allResults.push(r);
        }
      }
    } catch (err) {
      // Log but continue — partial results are better than none
      process.stderr.write(
        `[AutoLeadScan] Search error for "${query}": ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  // Filter to actual practice websites
  const candidates: PracticeCandidate[] = [];
  for (const result of allResults) {
    if (isDirectorySite(result.url)) continue;

    const practiceName = extractPracticeName(result.title);
    if (!practiceName) continue;

    candidates.push({
      name: practiceName,
      website: result.url,
      city,
      state,
      source: 'firecrawl',
    });

    if (candidates.length >= maxResults) break;
  }

  return { candidates, rawCount: allResults.length, queryCount: queries.length };
}

// ─── Salesforce Dedup ────────────────────────────────────────────────────────
// Only excludes ACTIVE client Accounts (operational Status__c values).
// Cancelled/Inactive/Expired accounts and null-status TCI ticket buyers pass through.
// Stale Leads (no activity in 45+ days) get re-assigned to Service Account instead of skipped.

const ACTIVE_STATUSES = [
  'Active', 'Renewal', 'Non Renewing', 'Reinstated', 'Delinquent', 'Paused', 'Pending',
];
const STALE_LEAD_DAYS = 45;

async function dedup(
  practices: PracticeCandidate[],
): Promise<{
  newPractices: PracticeCandidate[];
  existingCount: number;
  existingNames: string[];
  revivedLeads: RevivedLead[];
}> {
  if (practices.length === 0) {
    return { newPractices: [], existingCount: 0, existingNames: [], revivedLeads: [] };
  }

  // Build LIKE conditions — limit to first 40 to avoid huge queries
  const fragments = practices
    .slice(0, 40)
    .map(p => soqlEscape(p.name.substring(0, 50)))
    .filter(n => n.length > 2);

  if (fragments.length === 0) {
    return { newPractices: practices, existingCount: 0, existingNames: [], revivedLeads: [] };
  }

  const leadLike = fragments.map(n => `Company LIKE '%${n}%'`).join(' OR ');
  const acctLike = fragments.map(n => `Name LIKE '%${n}%'`).join(' OR ');

  // Only exclude Accounts that are ACTIVE clients — allow Cancelled/Inactive/Expired/null through
  const statusFilter = ACTIVE_STATUSES.map(s => `'${s}'`).join(',');

  const [existingLeads, existingAccounts] = await Promise.all([
    salesforceService.rawQuery<SFRecord>(
      `SELECT Id, Company, Name, Website, LastActivityDate, OwnerId, LeadSource ` +
      `FROM Lead WHERE (${leadLike}) LIMIT 200`
    ).catch(() => [] as SFRecord[]),
    salesforceService.rawQuery<SFRecord>(
      `SELECT Id, Name, Website, Status__c FROM Account ` +
      `WHERE (${acctLike}) AND (Status__c IN (${statusFilter}) OR TCI_Status__c = 'Member') LIMIT 200`
    ).catch(() => [] as SFRecord[]),
  ]);

  // Build sets ONLY from active-client Accounts and fresh Leads
  const activeAccountNames = new Set<string>();
  const activeAccountDomains = new Set<string>();
  const existingNames: string[] = [];

  // Active Accounts → always block (these are current clients)
  for (const acct of existingAccounts) {
    activeAccountNames.add(normalize(acct.Name!));
    existingNames.push(acct.Name!);
    if (acct.Website) activeAccountDomains.add(extractDomain(acct.Website));
  }

  // Categorize Leads: fresh (block) vs. stale (revive)
  const freshLeadNames = new Set<string>();
  const freshLeadDomains = new Set<string>();
  const staleLeadMap = new Map<string, SFRecord>(); // normalized name → Lead record

  const now = Date.now();
  for (const lead of existingLeads) {
    const daysSince = lead.LastActivityDate
      ? Math.floor((now - new Date(lead.LastActivityDate).getTime()) / 86_400_000)
      : 999; // No activity ever = definitely stale

    if (daysSince >= STALE_LEAD_DAYS) {
      // Stale — mark for re-assignment
      const normName = normalize(lead.Company || lead.Name || '');
      if (normName) staleLeadMap.set(normName, lead);
    } else {
      // Fresh — block as duplicate
      if (lead.Company) { freshLeadNames.add(normalize(lead.Company)); existingNames.push(lead.Company); }
      if (lead.Name)    freshLeadNames.add(normalize(lead.Name));
      if (lead.Website) freshLeadDomains.add(extractDomain(lead.Website));
    }
  }

  // Filter practices and collect stale leads to revive
  const newPractices: PracticeCandidate[] = [];
  const revivedLeads: RevivedLead[] = [];
  let blockedCount = 0;

  for (const p of practices) {
    const norm = normalize(p.name);
    const domain = p.website ? extractDomain(p.website) : '';

    // Check 1: Active Account match → block entirely (this is a current client)
    let isActiveClient = false;
    for (const known of activeAccountNames) {
      if (known.length >= 5 && (norm.includes(known) || known.includes(norm))) {
        isActiveClient = true;
        break;
      }
    }
    if (!isActiveClient && domain && activeAccountDomains.has(domain)) {
      isActiveClient = true;
    }
    if (isActiveClient) {
      blockedCount++;
      continue;
    }

    // Check 2: Fresh Lead match → block (already being worked)
    let isFreshLead = false;
    for (const known of freshLeadNames) {
      if (known.length >= 5 && (norm.includes(known) || known.includes(norm))) {
        isFreshLead = true;
        break;
      }
    }
    if (!isFreshLead && domain && freshLeadDomains.has(domain)) {
      isFreshLead = true;
    }
    if (isFreshLead) {
      blockedCount++;
      continue;
    }

    // Check 3: Stale Lead match → revive instead of creating new
    let staleMatch: SFRecord | undefined;
    for (const [staleName, record] of staleLeadMap) {
      if (staleName.length >= 5 && (norm.includes(staleName) || staleName.includes(norm))) {
        staleMatch = record;
        break;
      }
    }

    if (staleMatch) {
      // Re-assign stale Lead to Service Account with Prophet source
      try {
        const daysSince = staleMatch.LastActivityDate
          ? Math.floor((now - new Date(staleMatch.LastActivityDate).getTime()) / 86_400_000)
          : 999;

        await salesforceService.updateRecord('Lead', staleMatch.Id, {
          OwnerId:    SERVICE_ACCOUNT_ID,
          LeadSource: 'PDM Prophet Scan',
          Status:     'Open - Not Contacted',
          Description:
            `Re-assigned by Prophet Auto Lead Scan on ${new Date().toISOString().slice(0, 10)}. ` +
            `Previously owned by ${staleMatch.OwnerId || 'unknown'}. ` +
            `No activity for ${daysSince} days. Re-entering pipeline for Kubaru round-robin.`,
        });

        revivedLeads.push({
          id: staleMatch.Id,
          name: staleMatch.Company || staleMatch.Name || p.name,
          previousOwner: staleMatch.OwnerId,
          previousSource: staleMatch.LeadSource,
          daysSinceActivity: daysSince,
        });

        // Remove from staleLeadMap so we don't double-match
        for (const [key, val] of staleLeadMap) {
          if (val.Id === staleMatch.Id) { staleLeadMap.delete(key); break; }
        }
      } catch (err) {
        // If update fails, treat as new practice
        newPractices.push(p);
      }
      continue;
    }

    // No match at all → truly new practice
    newPractices.push(p);
  }

  return {
    newPractices,
    existingCount: blockedCount,
    existingNames: [...new Set(existingNames)].slice(0, 20),
    revivedLeads,
  };
}

// ─── Lead Creation ───────────────────────────────────────────────────────────

async function createLeads(
  practices: PracticeCandidate[],
  defaultCity?: string,
  defaultState?: string,
): Promise<{ created: CreatedLead[]; errors: string[] }> {
  const created: CreatedLead[] = [];
  const errors: string[] = [];

  for (const practice of practices) {
    try {
      const city  = practice.city ?? defaultCity;
      const state = practice.state ?? defaultState;

      const slug = practice.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '.')
        .replace(/\.{2,}/g, '.')
        .replace(/^\.|\.$/, '')
        .slice(0, 50);

      const fields: Record<string, unknown> = {
        LastName:   practice.name,
        Company:    practice.name,
        Email:      `scan.${slug}@progressivedental.com`,
        LeadSource: 'PDM Prophet Scan',
        OwnerId:    SERVICE_ACCOUNT_ID,
        Status:     'Open - Not Contacted',
        Description:
          `Auto-discovered by Prophet market scan on ${new Date().toISOString().slice(0, 10)}. ` +
          `Source: ${practice.source}.` +
          (practice.address ? ` Address: ${practice.address}` : ''),
      };

      if (city)             fields['City']      = city;
      if (state)            fields['StateCode']  = state;
      if (practice.website) fields['Website']    = practice.website;
      if (practice.phone)   fields['Phone']      = practice.phone;

      const leadId = await salesforceService.createRecord('Lead', fields);
      created.push({ id: leadId, name: practice.name, website: practice.website, city, state });
    } catch (err) {
      errors.push(`${practice.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { created, errors };
}

// ─── Email Body Builder ──────────────────────────────────────────────────────

function buildEmailBody(created: CreatedLead[], market: string): string {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const practiceList = created
    .map(l => `  • ${l.name}${l.website ? ` — ${l.website}` : ''}`)
    .join('\n');

  return (
    `Prophet Auto Lead Scan — ${date}\n` +
    `Market: ${market}\n` +
    `New Leads Found: ${created.length}\n\n` +
    `${practiceList}\n\n` +
    `These leads have been created in Salesforce and assigned to the round-robin queue (Kubaru).\n` +
    `Full research scoring will follow — watch for updated Lead records with Marketing Maturity and Priority scores.\n\n` +
    `— Prophet by PDM`
  );
}

// ─── Main Handler ────────────────────────────────────────────────────────────

async function handleAutoLeadScan(rawArgs: unknown): Promise<string> {
  const args = AutoLeadScanArgs.parse(rawArgs ?? {});
  const { city, state, max_results, practices: importedPractices, send_email } = args;

  const lines: string[] = [];
  let candidates: PracticeCandidate[] = [];
  let market = 'Imported Market';

  // ── Mode 1: Import pre-crawled practices ────────────────────────────────
  if (importedPractices && importedPractices.length > 0) {
    candidates = importedPractices.map(p => ({ ...p, source: 'import' }));
    market = city && state ? `${city}, ${state}` : 'Imported List';

    lines.push(`## 🔍 Prophet Auto Lead Scan — Import Mode`);
    lines.push('');
    lines.push(`**Imported:** ${candidates.length} practices`);
    lines.push(`**Market:** ${market}`);
  }
  // ── Mode 2: Auto-crawl via Firecrawl ────────────────────────────────────
  else if (city && state) {
    market = `${city}, ${state}`;
    lines.push(`## 🔍 Prophet Auto Lead Scan — ${market}`);
    lines.push('');

    try {
      const { candidates: found, rawCount, queryCount } = await crawlMarket(city, state, max_results);
      candidates = found;

      lines.push(`**Firecrawl searches:** ${queryCount} queries`);
      lines.push(`**Raw results:** ${rawCount} unique domains`);
      lines.push(`**Filtered candidates:** ${candidates.length} dental practices identified`);
    } catch (err) {
      lines.push(`❌ **Crawl failed:** ${err instanceof Error ? err.message : String(err)}`);
      lines.push('');
      lines.push('**Alternative:** Use Apify Google Places crawler or Firecrawl MCP search tool, ' +
        'then pass the results via the `practices` parameter in import mode.');
      return lines.join('\n');
    }
  } else {
    return (
      '❌ Provide either:\n' +
      '- `city` + `state` for auto-crawl mode (requires FIRECRAWL_API_KEY in .env)\n' +
      '- `practices` array for import mode (from Apify Google Places, Firecrawl MCP, or manual list)'
    );
  }

  if (candidates.length === 0) {
    lines.push('');
    lines.push('⚠️ No practice candidates found. Try broader search terms or import a practices list from Apify Google Places.');
    return lines.join('\n');
  }

  // ── Dedup Against Salesforce ────────────────────────────────────────────
  lines.push('');
  lines.push('### Salesforce Dedup');

  const { newPractices, existingCount, existingNames, revivedLeads } = await dedup(candidates);

  lines.push(`- **Active clients skipped:** ${existingCount} (already in Salesforce with active Status)`);
  if (existingNames.length > 0 && existingNames.length <= 15) {
    lines.push(`  - ${existingNames.join(', ')}`);
  } else if (existingNames.length > 15) {
    lines.push(`  - ${existingNames.slice(0, 15).join(', ')} … and ${existingNames.length - 15} more`);
  }
  lines.push(`- **Stale Leads revived:** ${revivedLeads.length} (re-assigned to Service Account)`);
  lines.push(`- **New practices:** ${newPractices.length} to create as Leads`);

  // Show revived leads
  if (revivedLeads.length > 0) {
    lines.push('');
    lines.push('### ♻️ Revived Stale Leads');
    lines.push('');
    lines.push('| # | Practice | Lead ID | Days Since Activity |');
    lines.push('|---|---|---|---|');
    revivedLeads.forEach((lead, i) => {
      lines.push(`| ${i + 1} | ${lead.name} | \`${lead.id}\` | ${lead.daysSinceActivity ?? '∞'} |`);
    });
    lines.push('');
    lines.push('These leads have been re-assigned to Service Account → Kubaru round-robin.');
  }

  if (newPractices.length === 0 && revivedLeads.length === 0) {
    lines.push('');
    lines.push('✅ All discovered practices already exist in Salesforce as active clients. No new Leads created.');
    return lines.join('\n');
  }

  if (newPractices.length === 0) {
    // Only revived leads, no new creates — still output the JSON summary
    lines.push('');
    lines.push('---');
    lines.push('```json');
    lines.push(JSON.stringify({
      scan_type:        'firecrawl',
      market:           city && state ? `${city}, ${state}` : 'Imported',
      total_candidates: candidates.length,
      existing_skipped: existingCount,
      leads_created:    0,
      leads_revived:    revivedLeads.length,
      revived_ids:      revivedLeads.map(l => l.id),
      revived_names:    revivedLeads.map(l => l.name),
      lead_ids:         revivedLeads.map(l => l.id),
      lead_names:       revivedLeads.map(l => l.name),
      creation_errors:  0,
      timestamp:        new Date().toISOString(),
    }, null, 2));
    lines.push('```');
    return lines.join('\n');
  }

  // ── Create Leads ───────────────────────────────────────────────────────
  lines.push('');
  lines.push('### 🆕 New Leads Created');
  lines.push('');
  lines.push('| # | Practice | Website | Lead ID |');
  lines.push('|---|---|---|---|');

  const { created, errors } = await createLeads(newPractices, city, state);

  created.forEach((lead, i) => {
    const site = lead.website
      ? `[${extractDomain(lead.website)}](${lead.website})`
      : '—';
    lines.push(`| ${i + 1} | ${lead.name} | ${site} | \`${lead.id}\` |`);
  });

  if (errors.length > 0) {
    lines.push('');
    lines.push('**Creation errors:**');
    errors.forEach(e => lines.push(`- ❌ ${e}`));
  }

  lines.push('');
  lines.push('**LeadSource:** `PDM Prophet Scan`');
  lines.push('**Owner:** Service Account → Kubaru round-robin to sales reps');

  // ── Next Steps ─────────────────────────────────────────────────────────
  lines.push('');
  lines.push('### 🎯 Next Steps — Research Each Lead');
  lines.push('');
  lines.push('Run `sf_research_prospect` on each new Lead for full scoring:');
  lines.push('');

  for (const lead of created.slice(0, 10)) {
    lines.push(`1. **${lead.name}** — \`sf_research_prospect(leadId: "${lead.id}")\``);
  }
  if (created.length > 10) {
    lines.push(`… and ${created.length - 10} more`);
  }

  // ── Email Notification ─────────────────────────────────────────────────
  if (send_email && created.length > 0) {
    const emailBody = buildEmailBody(created, market);

    lines.push('');
    lines.push('### 📧 Send Email Notification');
    lines.push('');
    lines.push('Send this notification using **send_gmail_message**:');
    lines.push('');
    lines.push('**TO:** alex.ahladis@progressivedental.com, angus@progressivedental.com, gerritt@progressivedental.com');
    lines.push('**BCC:** william@progressivedental.com, jason@progressivedental.com');
    lines.push(`**Subject:** 🔍 Prophet Lead Scan: ${created.length} New Leads — ${market}`);
    lines.push('');
    lines.push('**Body:**');
    lines.push('```');
    lines.push(emailBody);
    lines.push('```');
  }

  // ── JSON Summary (for n8n consumption) ─────────────────────────────────
  lines.push('');
  lines.push('---');
  lines.push('```json');
  const allLeadIds   = [...created.map(l => l.id), ...revivedLeads.map(l => l.id)];
  const allLeadNames = [...created.map(l => l.name), ...revivedLeads.map(l => l.name)];

  lines.push(JSON.stringify({
    scan_type:        importedPractices ? 'import' : 'firecrawl',
    market,
    total_candidates: candidates.length,
    existing_skipped: existingCount,
    leads_created:    created.length,
    leads_revived:    revivedLeads.length,
    creation_errors:  errors.length,
    lead_ids:         allLeadIds,
    lead_names:       allLeadNames,
    revived_ids:      revivedLeads.map(l => l.id),
    revived_names:    revivedLeads.map(l => l.name),
    timestamp:        new Date().toISOString(),
  }, null, 2));
  lines.push('```');

  return lines.join('\n');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const autoLeadScanHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_auto_lead_scan: handleAutoLeadScan,
};
