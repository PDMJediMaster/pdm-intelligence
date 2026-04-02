// ─────────────────────────────────────────────────────────────────────────────
// Prospect Research Tools
//
// Two-tool architecture — no internal Anthropic API call required:
//
//   Tool 1: sf_research_prospect
//     - Salesforce pre-check (Lead + Account lookup)
//     - Returns SF context + full PDM research instructions
//     - Claude Desktop runs the web research natively
//
//   Tool 2: sf_save_research_scores
//     - Accepts scores extracted by Claude from the research output
//     - Creates Lead if no existing record found
//     - Writes all scores to Lead and/or Account in Salesforce
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const WILLIAM_SUMMERS_USER_ID = '005PU000001eUQDYA2';

const VALID_PRIORITY_LEVELS = ['Low', 'Moderate', 'High', 'Top Priority'] as const;
const VALID_GAP_TYPES        = ['SEO', 'Reputation', 'Video', 'Authority', 'Maps'] as const;

type PriorityLevel = typeof VALID_PRIORITY_LEVELS[number];
type GapType       = typeof VALID_GAP_TYPES[number];

// ─── Salesforce Record Types ──────────────────────────────────────────────────

interface SFLead {
  Id: string;
  Name: string;
  Company?: string;
  Status?: string;
  OwnerId?: string;
  Owner?: { Name: string };
  LastActivityDate?: string;
  Website?: string;
  City?: string;
  State?: string;
  Marketing_Maturity_Score__c?: number;
  Likelihood_to_Buy_Score__c?: number;
  Priority_Level__c?: string;
  Research_Summary__c?: string;
  Primary_Gap_Type__c?: string;
}

interface SFAccount {
  Id: string;
  Name: string;
  Status__c?: string;
  OwnerId?: string;
  Owner?: { Name: string };
  LastActivityDate?: string;
  Website?: string;
  BillingCity?: string;
  BillingState?: string;
  Marketing_Maturity_Score__c?: number;
  Likelihood_to_Buy_Score__c?: number;
  Priority_Level__c?: string;
  Research_Summary__c?: string;
  Primary_Gap_Type__c?: string;
  Baseline_Marketing_Maturity__c?: number;
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

// Gap-type → Gamma theme mapping (professional dental sales decks)
const GAP_TYPE_THEME: Record<string, string> = {
  SEO:        'consultant', // Clean blue/white, analytics feel
  Reputation: 'serene',    // Calm blue, trust-building
  Video:      'aurora',    // Modern, dynamic, gradient
  Authority:  'marine',    // Navy, bold, professional authority
  Maps:       'icebreaker', // Clean blue, local/approachable
};

export const prospectResearchTools: Tool[] = [
  {
    name: 'sf_research_prospect',
    description:
      'Step 1 of prospect research. Checks Salesforce for existing Lead/Account records and returns ' +
      'the full PDM Sales Market Research GPT instructions for Claude to execute via web search. ' +
      'After calling this tool, Claude should immediately run the web research as instructed in the ' +
      'output, then call sf_save_research_scores to write results back to Salesforce. ' +
      'Use when a rep asks to research a prospect, wants market analysis before a discovery call, ' +
      'or asks "what do we know about X dental practice".',
    inputSchema: {
      type: 'object',
      properties: {
        practiceName: {
          type: 'string',
          description: 'Name of the dental practice',
        },
        city: {
          type: 'string',
          description: 'City where the practice is located',
        },
        state: {
          type: 'string',
          description: 'State (2-letter code preferred, e.g., "TX", "CA")',
        },
        zip: {
          type: 'string',
          description: 'ZIP code of the practice — more precise than city/state for market radius analysis',
        },
        websiteUrl: {
          type: 'string',
          description: 'Practice website URL',
        },
        leadId: {
          type: 'string',
          description: 'Salesforce Lead ID if already known — skips name lookup',
        },
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID if the practice is an existing client',
        },
      },
      required: [],
    },
  },
  {
    name: 'sf_save_research_scores',
    description:
      'Step 2 of prospect research. Saves scores and summary from completed web research back to ' +
      'Salesforce. Creates a new Lead if no existing record was found. Call this immediately after ' +
      'completing the research requested by sf_research_prospect.',
    inputSchema: {
      type: 'object',
      properties: {
        practiceName: {
          type: 'string',
          description: 'Practice name — used to create a new Lead if no existing record',
        },
        city:       { type: 'string', description: 'City — stored on new Lead if created' },
        state:      { type: 'string', description: 'State — stored on new Lead if created' },
        websiteUrl: { type: 'string', description: 'Website — stored on new Lead if created' },
        leadId: {
          type: 'string',
          description: 'Salesforce Lead ID returned by sf_research_prospect (if a record was found)',
        },
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID returned by sf_research_prospect (if a record was found)',
        },
        marketingMaturityScore: {
          type: 'number',
          description: 'Marketing maturity score 0-100',
        },
        likelihoodToBuyScore: {
          type: 'number',
          description: 'Likelihood to buy score 0-100',
        },
        priorityLevel: {
          type: 'string',
          enum: ['Low', 'Moderate', 'High', 'Top Priority'],
          description: 'Priority classification',
        },
        primaryGapType: {
          type: 'string',
          enum: ['SEO', 'Reputation', 'Video', 'Authority', 'Maps'],
          description: 'Primary marketing gap identified',
        },
        researchSummary: {
          type: 'string',
          description: 'One-paragraph summary of key findings, max 500 characters',
        },
        primaryCompetitorName: {
          type: 'string',
          description: 'Name of the #1 competitor identified in the research',
        },
        primaryCompetitorWebsite: {
          type: 'string',
          description: 'Website URL of the primary competitor',
        },
        competitorReviewCount: {
          type: 'number',
          description: 'Current Google review count for the primary competitor',
        },
        competitorStarRating: {
          type: 'number',
          description: 'Current Google star rating for the primary competitor (e.g. 4.7)',
        },
        competitorRunningAds: {
          type: 'boolean',
          description: 'Is the primary competitor running Google Ads?',
        },
        competitorRunningFacebookAds: {
          type: 'boolean',
          description: 'Is the primary competitor running Facebook/Meta ads?',
        },
        competitorMapsPosition: {
          type: 'number',
          description: 'Primary competitor Google Maps pack position (1-3 = in pack, 0 = not in pack)',
        },
        competitorPressureScore: {
          type: 'number',
          description: 'Competitive pressure score 0-100 for the primary competitor',
        },
        competitorPrimaryServices: {
          type: 'string',
          description: 'Key services/procedures the competitor markets (e.g. "All-on-4, Full-Arch, Implants")',
        },
        competitorNotes: {
          type: 'string',
          description: 'Qualitative notes on the competitor — what makes them a threat',
        },
      },
      required: ['marketingMaturityScore', 'likelihoodToBuyScore', 'priorityLevel', 'primaryGapType', 'researchSummary'],
    },
  },
  {
    name: 'sf_save_deck_url',
    description:
      'Step 3 of prospect research. Saves a Gamma prospect deck URL to Salesforce after it has been ' +
      'generated by the Gamma generate tool. Creates a Gamma__c record linked to the Lead or Account, ' +
      'and creates a Task for the rep notifying them the deck is ready to share. ' +
      'Call this immediately after the Gamma generate tool returns a gammaUrl.',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: {
          type: 'string',
          description: 'Salesforce Lead ID to link the deck to',
        },
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID to link the deck to',
        },
        gammaUrl: {
          type: 'string',
          description: 'The Gamma deck URL returned by the Gamma generate tool',
        },
        deckTitle: {
          type: 'string',
          description: 'Title for the deck (e.g. "Excel Dental — Market Opportunity Assessment")',
        },
        primaryGapType: {
          type: 'string',
          enum: ['SEO', 'Reputation', 'Video', 'Authority', 'Maps'],
          description: 'Primary gap type from the research — recorded on the Gamma record for future reference',
        },
      },
      required: ['gammaUrl'],
    },
  },
];

// ─── Input Schemas ────────────────────────────────────────────────────────────

const ProspectResearchArgs = z.object({
  practiceName: z.string().optional(),
  city:         z.string().optional(),
  state:        z.string().optional(),
  zip:          z.string().optional(),
  websiteUrl:   z.string().optional(),
  leadId:       z.string().optional(),
  accountId:    z.string().optional(),
});

const SaveResearchScoresArgs = z.object({
  practiceName:               z.string().optional(),
  city:                       z.string().optional(),
  state:                      z.string().optional(),
  websiteUrl:                 z.string().optional(),
  leadId:                     z.string().optional(),
  accountId:                  z.string().optional(),
  marketingMaturityScore:     z.number().min(0).max(100),
  likelihoodToBuyScore:       z.number().min(0).max(100),
  priorityLevel:              z.enum(VALID_PRIORITY_LEVELS),
  primaryGapType:             z.enum(VALID_GAP_TYPES),
  researchSummary:            z.string().max(500),
  // Competitor snapshot fields (optional)
  primaryCompetitorName:      z.string().optional(),
  primaryCompetitorWebsite:   z.string().optional(),
  competitorReviewCount:      z.number().optional(),
  competitorStarRating:       z.number().optional(),
  competitorRunningAds:       z.boolean().optional(),
  competitorRunningFacebookAds: z.boolean().optional(),
  competitorMapsPosition:     z.number().optional(),
  competitorPressureScore:    z.number().min(0).max(100).optional(),
  competitorPrimaryServices:  z.string().optional(),
  competitorNotes:            z.string().optional(),
});

const SaveDeckUrlArgs = z.object({
  leadId:         z.string().optional(),
  accountId:      z.string().optional(),
  gammaUrl:       z.string().url('gammaUrl must be a valid URL'),
  deckTitle:      z.string().optional(),
  primaryGapType: z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null | undefined): string {
  if (!d) return 'Unknown';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Build a fuzzy SOQL WHERE clause that finds a practice even when the search name
// has extra words (e.g. "Sloan Canyon Dental Care" matches "Sloan canyon dental").
// Strategy: extract the 2-3 most significant words and require ALL of them to appear
// in Company (or fall back to Name), using chained LIKE '%word%' AND conditions.
const NOISE_WORDS = new Set([
  'dental', 'dentistry', 'dentist', 'care', 'family', 'group', 'center', 'centre',
  'associates', 'and', 'the', 'of', 'at', 'dr', 'llc', 'pllc', 'pc', 'inc',
  'practice', 'clinic', 'office', 'studio', 'smiles', 'smile',
]);

function buildPracticeNameFilter(rawName: string): string {
  const escaped = rawName.replace(/'/g, "\\'");

  // Collect unique significant words (length > 2, not noise)
  const words = [...new Set(
    rawName.split(/\s+/)
      .filter(w => w.length > 2 && !NOISE_WORDS.has(w.toLowerCase()))
  )];

  if (words.length < 2) {
    // Not enough signal words — fall back to full-name LIKE on both fields
    return `(Name LIKE '%${escaped}%' OR Company LIKE '%${escaped}%')`;
  }

  // Require ALL significant words to appear somewhere in Company
  const companyAnd = words.map(w => `Company LIKE '%${w.replace(/'/g, "\\'")}%'`).join(' AND ');
  const nameAnd    = words.map(w => `Name    LIKE '%${w.replace(/'/g, "\\'")}%'`).join(' AND ');

  // Also keep a full-name fallback in case the Company is an exact match
  return `((${companyAnd}) OR (${nameAnd}) OR Company LIKE '%${escaped}%' OR Name LIKE '%${escaped}%')`;
}

// ─── Tool 1 Handler: sf_research_prospect ────────────────────────────────────

async function handleProspectResearch(rawArgs: unknown): Promise<string> {
  const { practiceName, city, state, zip, websiteUrl, leadId, accountId } =
    ProspectResearchArgs.parse(rawArgs ?? {});

  if (!practiceName && !websiteUrl && !leadId && !accountId) {
    return '❌ Please provide at least a practice name, website URL, or Salesforce record ID.';
  }

  // ── ZIP → City/State + DMA lookup ────────────────────────────────────────
  let resolvedCity  = city;
  let resolvedState = state;
  let dmaName: string | null = null;
  let dmaCode: string | null = null;

  if (zip) {
    const [dmaResults] = await Promise.all([
      salesforceService.rawQuery<{ Id: string; Name: string; DMA_Code__c?: string; Zip_Code__c?: string }>(
        `SELECT Id, Name, DMA_Code__c, Zip_Code__c
         FROM DMA_Markets__c
         WHERE Zip_Code__c = '${zip.trim()}'
         LIMIT 1`
      ).catch(() => [] as { Id: string; Name: string; DMA_Code__c?: string; Zip_Code__c?: string }[]),
    ]);

    if (dmaResults.length > 0) {
      dmaName = dmaResults[0].Name;
      dmaCode = dmaResults[0].DMA_Code__c ?? null;
    }

    // Derive city/state from zip if not already provided
    if (!resolvedCity || !resolvedState) {
      try {
        const resp = await fetch(`https://api.zippopotam.us/us/${zip.trim()}`);
        if (resp.ok) {
          const data = await resp.json() as {
            places?: Array<{ 'place name': string; 'state abbreviation': string }>;
          };
          if (data.places?.[0]) {
            resolvedCity  = resolvedCity  ?? data.places[0]['place name'];
            resolvedState = resolvedState ?? data.places[0]['state abbreviation'];
          }
        }
      } catch {
        // zip lookup failed — proceed with whatever city/state we have
      }
    }
  }

  // ── Salesforce Pre-Check ──────────────────────────────────────────────────

  let resolvedLeadId    = leadId;
  let resolvedAccountId = accountId;
  let sfLead: SFLead | null    = null;
  let sfAccount: SFAccount | null = null;

  if (!resolvedLeadId && !resolvedAccountId && practiceName) {
    const nameFilter    = buildPracticeNameFilter(practiceName);
    const escapedName   = practiceName.replace(/'/g, "\\'");
    const accountFilter = buildPracticeNameFilter(practiceName).replace(/Company LIKE/g, 'Name LIKE');

    const [leadResults, accountResults] = await Promise.all([
      salesforceService.rawQuery<SFLead>(
        `SELECT Id, Name, Company, Status, OwnerId, Owner.Name,
                LastActivityDate, Website, City, State,
                Marketing_Maturity_Score__c, Likelihood_to_Buy_Score__c,
                Priority_Level__c, Research_Summary__c, Primary_Gap_Type__c
         FROM Lead
         WHERE ${nameFilter}
           AND IsConverted = false
         ORDER BY LastActivityDate DESC NULLS LAST
         LIMIT 3`
      ),
      salesforceService.rawQuery<SFAccount>(
        `SELECT Id, Name, Status__c, OwnerId, Owner.Name,
                LastActivityDate, Website, BillingCity, BillingState,
                Marketing_Maturity_Score__c, Likelihood_to_Buy_Score__c,
                Priority_Level__c, Research_Summary__c, Primary_Gap_Type__c,
                Baseline_Marketing_Maturity__c
         FROM Account
         WHERE (Name LIKE '%${escapedName}%' OR ${accountFilter})
           AND OwnerId != '${WILLIAM_SUMMERS_USER_ID}'
         ORDER BY LastActivityDate DESC NULLS LAST
         LIMIT 3`
      ),
    ]);

    if (leadResults.length > 0) { sfLead = leadResults[0]; resolvedLeadId = sfLead.Id; }
    if (accountResults.length > 0) { sfAccount = accountResults[0]; resolvedAccountId = sfAccount.Id; }
  } else {
    if (resolvedLeadId) {
      const r = await salesforceService.rawQuery<SFLead>(
        `SELECT Id, Name, Company, Status, OwnerId, Owner.Name,
                LastActivityDate, Website, City, State,
                Marketing_Maturity_Score__c, Likelihood_to_Buy_Score__c,
                Priority_Level__c, Research_Summary__c, Primary_Gap_Type__c
         FROM Lead WHERE Id = '${resolvedLeadId}' LIMIT 1`
      );
      if (r.length > 0) sfLead = r[0];
    }
    if (resolvedAccountId) {
      const r = await salesforceService.rawQuery<SFAccount>(
        `SELECT Id, Name, Status__c, OwnerId, Owner.Name,
                LastActivityDate, Website, BillingCity, BillingState,
                Marketing_Maturity_Score__c, Likelihood_to_Buy_Score__c,
                Priority_Level__c, Research_Summary__c, Primary_Gap_Type__c,
                Baseline_Marketing_Maturity__c
         FROM Account WHERE Id = '${resolvedAccountId}' LIMIT 1`
      );
      if (r.length > 0) sfAccount = r[0];
    }
  }

  // ── Build Output ──────────────────────────────────────────────────────────

  const lines: string[] = [];
  const locationStr = [resolvedCity, resolvedState].filter(Boolean).join(', ');
  const geoAnchor   = zip ? `ZIP ${zip}` : locationStr;

  lines.push(`# 🔍 PDM Prospect Research: ${practiceName ?? websiteUrl ?? 'Unknown Practice'}`);
  if (locationStr) lines.push(`**Location:** ${locationStr}${zip ? ` (ZIP: ${zip})` : ''}`);
  if (dmaName)     lines.push(`**DMA Market:** ${dmaName}${dmaCode ? ` (Code: ${dmaCode})` : ''}`);
  if (websiteUrl)  lines.push(`**Website:** ${websiteUrl}`);
  lines.push(`**Date:** ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
  lines.push('');

  // SF record status
  if (sfLead) {
    lines.push(`## 📋 Salesforce Record Found`);
    lines.push(`✅ **Lead:** ${sfLead.Name} (${sfLead.Company ?? ''}) | Owner: ${(sfLead.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown'} | Last Activity: ${formatDate(sfLead.LastActivityDate)}`);
    lines.push(`- **Lead ID:** \`${sfLead.Id}\` ← pass this to sf_save_research_scores`);
    if (sfLead.Marketing_Maturity_Score__c != null) {
      lines.push(`- **Prior research on file:** Maturity ${sfLead.Marketing_Maturity_Score__c}/100 | LTB ${sfLead.Likelihood_to_Buy_Score__c ?? 'N/A'}/100 | Priority: ${sfLead.Priority_Level__c ?? 'N/A'}`);
      if (sfLead.Research_Summary__c) lines.push(`- **Prior summary:** ${sfLead.Research_Summary__c}`);
      lines.push(`*Running fresh research to update scores.*`);
    }
    lines.push('');
  } else if (sfAccount) {
    lines.push(`## ⚠️ Existing Client Found in Salesforce`);
    lines.push(`**Account:** ${sfAccount.Name} | Status: ${sfAccount.Status__c ?? 'Unknown'} | Owner: ${(sfAccount.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown'}`);
    lines.push(`- **Account ID:** \`${sfAccount.Id}\` ← pass this to sf_save_research_scores`);
    if (sfAccount.Baseline_Marketing_Maturity__c != null) {
      lines.push(`- **Baseline maturity (at close):** ${sfAccount.Baseline_Marketing_Maturity__c}/100`);
    }
    lines.push('');
  } else {
    lines.push(`## 📋 Salesforce Status`);
    lines.push(`No existing Lead or Account found — this is a cold prospect. sf_save_research_scores will create a new Lead automatically.`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`## 🔎 Research Instructions`);
  lines.push('');
  lines.push(`You are PDM's senior market intelligence analyst. Run a full Sales Market Research analysis on this practice using web search. This report must win on TWO levels simultaneously: (1) the business case — market opportunity, competitive gaps, tactical urgency; and (2) the implant-belief case — patient psychology, authority, safety narrative, trust architecture. A report that only does one of these is incomplete.`);
  lines.push('');
  lines.push(`**Practice:** ${practiceName ?? 'Identify from website'}`);
  lines.push(`**Location:** ${locationStr || 'Determine from website'}${zip ? ` | ZIP: ${zip}` : ''}`);
  if (dmaName) lines.push(`**DMA Market:** ${dmaName} (Code: ${dmaCode ?? 'N/A'}) — use ZIP ${zip} as the geographic anchor for all competitive analysis. The DMA is market context only, NOT the research boundary.`);
  lines.push(`**Website:** ${websiteUrl ?? 'Search for it'}`);
  lines.push('');
  lines.push(`**CRITICAL — Geographic Scope:** All competitive and market analysis is scoped to a 10–20 mile radius from ${geoAnchor}. Never expand to full DMA or metro. Local competition is what the patient chooses from.`);
  lines.push('');
  lines.push(`**Search for:**`);
  lines.push(`- Practice website, Google Maps listing, Google reviews, social media`);
  lines.push(`- SEO: search "dental implants ${locationStr || geoAnchor}", "All-on-4 ${locationStr || geoAnchor}", "full arch ${locationStr || geoAnchor}", "same day teeth ${locationStr || geoAnchor}"`);
  lines.push(`- Competitor authority content: doctor videos, before/after galleries, patient testimonials, CBCT/guided surgery mentions`);
  lines.push(`- How competitors frame safety, trust, and implant candidacy — what language do they use?`);
  lines.push(`- Patient FAQs on competitor websites (pain, recovery, cost, candidacy)`);
  lines.push(`- 55+ demographics in the local market — retirement communities, migration patterns, "new to [city]" population`);
  lines.push(`- Any ads running (Google Ads, Facebook/Meta)`);
  lines.push('');
  lines.push(`---`);
  lines.push('');
  lines.push(`**PRODUCE THE COMPLETE RESEARCH REPORT IN THIS EXACT ORDER.**`);
  lines.push(`**⚠️ MANDATORY SECTIONS — DO NOT SKIP OR ABBREVIATE:**`);
  lines.push(`Sections 3 (Patient Psychology), 4 (Clinical Authority), 11 (Trust Signals), 12 (Local Differentiation), 14 (Safety Hierarchy), 15 (Patient Decision Journey), and 17 (3-Engine Growth System) are NOT optional. These sections differentiate PDM from every other marketing agency. If web research yields limited data for a section, use market-level inference and label assumptions — but produce the section.`);
  lines.push('');
  lines.push(`### 1. Practice Overview`);
  lines.push(`Practice name, website, location, doctor name(s), specialty focus, years in practice, facility impressions. Note any unique differentiators: boutique vs. chain feel, bilingual staff, technology mentioned, financing offered.`);
  lines.push('');
  lines.push(`### 2. Market Snapshot`);
  lines.push(`10–20 mile radius from ${geoAnchor}. Cover:`);
  lines.push(`- Population 45+ (the core implant-age demographic)`);
  lines.push(`- Median household income and affluent ZIP codes within radius`);
  lines.push(`- Retirement communities, 55+ developments, assisted living clusters nearby`);
  lines.push(`- Migration patterns: is this a "new to [city]" market? Snowbirds? Relocating retirees?`);
  lines.push(`- Estimated full-arch/implant case volume potential [Estimated]`);
  lines.push(`- Revenue opportunity: at avg $25K–$45K per full-arch case, what does capturing 2–4 additional cases/month represent?`);
  lines.push(dmaName ? `- DMA context: ${dmaName} — relevant for media buying, but local radius drives actual patient decisions` : '');
  lines.push('');
  lines.push(`### 3. Patient Psychology & Trust Architecture`);
  lines.push(`This section is mandatory. Full-arch implant cases are emotionally loaded decisions — not just high-ticket purchases. Address:`);
  lines.push(`- **The fearful patient:** What anxieties does a typical implant candidate in this market carry? Fear of surgery, fear of pain, fear of commitment, embarrassment about their current teeth, age-related identity concerns.`);
  lines.push(`- **The trust decision:** Why does a patient choose one implant doctor over another? Safety perception ("this doctor knows what they're doing"), visible authority ("I've seen their work"), financial confidence ("I can actually afford this and understand the terms"), and social proof ("people like me did this and it worked").`);
  lines.push(`- **The 55+ narrative:** How does a 65-year-old think about full-arch? Eating with grandchildren, confidence at social events, not wanting removable dentures, longevity of investment, wanting to feel younger. Speak to this identity shift, not just the procedure.`);
  lines.push(`- **Recovery anxiety:** What questions hold patients back? "How long until I can eat normally? Will I have teeth during healing? What does the first week actually look like?" These are the FAQ gaps that stall case acceptance.`);
  lines.push(`- **Financial confidence vs. sticker shock:** "I can't afford $30K" is often really "I don't believe I can have this." How does this practice (and should this practice) address monthly payment framing, insurance limitations, and the cost-of-doing-nothing argument?`);
  lines.push('');
  lines.push(`### 4. Clinical Authority Assessment`);
  lines.push(`Evaluate how well the practice communicates clinical credibility — in plain English, not jargon. Check:`);
  lines.push(`- **Guided surgery:** Do they mention CBCT, 3D planning, surgical guides, or treatment planning precision? This is a major safety signal for patients. "We plan your surgery in 3D before we touch you" is powerful.`);
  lines.push(`- **All-on-X/Full-Arch workflow:** Do they explain the process? Same-day teeth vs. staged approach? What is their case pathway? Patients who understand the process are far more likely to proceed.`);
  lines.push(`- **Bone grafting & candidacy:** Do they address who IS and ISN'T a candidate? Do they mention bone grafting as a solution for patients who were told they "don't have enough bone"? This expands the addressable market.`);
  lines.push(`- **Materials:** Do they mention titanium vs. zirconia? Screw-retained vs. cement? Immediate load? These are trust signals for educated implant researchers.`);
  lines.push(`- **Sedation & comfort:** Is IV sedation, oral sedation, or sleep dentistry mentioned? Fear of pain is a top barrier. Practices that address sedation convert more fearful patients.`);
  lines.push(`- **Doctor credentials:** Implant training, surgical volume, board certifications, continuing education. Is the doctor positioned as a specialist or a generalist who does implants?`);
  lines.push('');
  lines.push(`### 5. Competitive Landscape`);
  lines.push(`Identify 3–5 competitor practices within 15 miles of ${geoAnchor} targeting implant/full-arch cases. For each:`);
  lines.push(`- Name, website, Google review count and rating`);
  lines.push(`- Who dominates local implant search rankings`);
  lines.push(`- Who is running Google Ads or Facebook Ads`);
  lines.push(`- Who owns the Maps Pack (top 3 Google Maps positions)`);
  lines.push(`- Who has the strongest authority content (video, before/after, testimonials)`);
  lines.push(`- Who is easiest to disrupt and why`);
  lines.push(`- What narrative are they owning? ("trusted implant center," "same-day smiles," "affordable full-arch") — and what narrative is unclaimed?`);
  lines.push(`- Are any competitors corporate chains? If so, "boutique without the chain feel" is a positioning opportunity.`);
  lines.push('');
  lines.push(`### 6. Practice Marketing Evaluation`);
  lines.push(`Score the practice across these dimensions (Strong / Weak / Missing):`);
  lines.push(`- Website: mobile speed, implant-specific landing pages, All-on-X page, before/after gallery, patient stories, doctor bio with authority signals`);
  lines.push(`- Trust architecture: Does the site answer "why choose this doctor?" convincingly? Does it reduce fear? Does it build financial confidence?`);
  lines.push(`- Doctor authority: Video presence, photo professionalism, credentials displayed, "meet the doctor" page quality`);
  lines.push(`- Proof assets: Before/after photos (quantity and quality), patient video testimonials (fear→transformation→lifestyle arc), written reviews on site`);
  lines.push(`- Candidacy and FAQ content: Is there a page answering "Am I a candidate?" and "What does the process look like?" and "How much does it cost?"`);
  lines.push(`- Financing: Is flexible payment clearly communicated? Monthly payment examples? Third-party financing (CareCredit, Sunbit, etc.)?`);
  lines.push(`- Call-to-action: Is there a specific implant consultation CTA? "Same-day consult" or "free consultation" framing?`);
  lines.push('');
  lines.push(`### 7. SEO Gap Analysis`);
  lines.push(`- Do they rank for "dental implants ${locationStr || geoAnchor}"? "All-on-4 ${locationStr || geoAnchor}"? "full arch ${locationStr || geoAnchor}"? "same day teeth ${locationStr || geoAnchor}"?`);
  lines.push(`- Do they have dedicated landing pages for each service? Or does one generic implant page try to cover everything?`);
  lines.push(`- Are there FAQ pages targeting "how much do implants cost," "am I a candidate," "how long does recovery take"? These are high-converting long-tail terms.`);
  lines.push(`- Google Maps presence: Are they in the local 3-pack for implant searches? How many reviews vs. top competitor?`);
  lines.push(`- Content gaps: What implant topics do competitors rank for that this practice doesn't address?`);
  lines.push('');
  lines.push(`### 8. Google Ads Opportunity`);
  lines.push(`- Are competitors running Google Ads for implant/full-arch terms? Who?`);
  lines.push(`- Is this practice running ads? Effectively?`);
  lines.push(`- Estimated cost-per-click and competition level for target keywords [Estimated]`);
  lines.push(`- What is the ROI math? (1 additional full-arch case = $25K–$45K revenue vs. estimated monthly ad spend)`);
  lines.push('');
  lines.push(`### 9. Reputation & Proof Architecture`);
  lines.push(`Go beyond review counts. Evaluate proof as a conversion system:`);
  lines.push(`- Google review count and star rating vs. top 3 competitors`);
  lines.push(`- Review velocity: are they gaining reviews steadily or stagnant?`);
  lines.push(`- Review sentiment: do patients specifically mention implants, full-arch, or doctor trust? Or are reviews generic?`);
  lines.push(`- Before/after photos: Do they exist? Quantity? Quality? Are they on Google Maps, the website, and social?`);
  lines.push(`- Patient video testimonials: Do they follow the fear→transformation→lifestyle narrative arc? (Before: "I was embarrassed to smile." During: "The team made me feel safe." After: "I can eat anything. I feel like myself again.")`);
  lines.push(`- Doctor-led authority video: Does the doctor appear on camera explaining the process, building trust, and reducing fear? This is the single highest-converting trust asset for implant cases.`);
  lines.push(`- What proof does the competitor leader have that this practice lacks?`);
  lines.push('');
  lines.push(`### 10. Google Maps & Local Visibility`);
  lines.push(`- Maps Pack position for "dental implants ${locationStr || geoAnchor}" and "All-on-4 ${locationStr || geoAnchor}"`);
  lines.push(`- Google Business Profile completeness: photos, services listed, Q&A, posts`);
  lines.push(`- Citation consistency across directories`);
  lines.push('');
  lines.push(`### 11. Trust Signal Assessment`);
  lines.push(`Evaluate how well the practice earns patient trust — not just lists credentials:`);
  lines.push(`- **Safety narrative:** Does the practice communicate that the procedure is safe and predictable? CBCT planning, surgical guides, sedation options, experience volume all build this.`);
  lines.push(`- **Authority positioning:** Is the doctor positioned as THE implant expert in the local market, or just a dentist who offers implants?`);
  lines.push(`- **Life-changing framing:** Is the outcome framed as life-changing? ("You'll eat what you want. You'll smile without thinking about it. You'll feel like yourself again.") Or is it clinical and transactional?`);
  lines.push(`- **Long-term value:** Is the permanence and durability of implants communicated? "This is a 20-year decision, not a one-time purchase" is a powerful reframe of cost objections.`);
  lines.push(`- **Social proof architecture:** Certifications, associations, success rates, case volume claims, recognizable training programs.`);
  lines.push('');
  lines.push(`### 12. Local Differentiation & Positioning Opportunities`);
  lines.push(`Identify what makes or could make this practice uniquely positioned in this specific market:`);
  lines.push(`- **Boutique vs. chain:** If competitors are corporate DSOs, "personal relationship, not a number" is a strong positioning angle. "Affordable full-arch without the chain feel" is a specific hook.`);
  lines.push(`- **Bilingual capability:** If the local market has a significant Spanish-speaking population and the practice serves them, this is a major competitive wedge.`);
  lines.push(`- **New-to-market angle:** If this is a retirement/migration market, "Welcome to [City] — your trusted implant home" is a specific patient acquisition hook.`);
  lines.push(`- **Community ties:** Local associations, sponsorships, schools, churches, civic groups that competitors haven't captured.`);
  lines.push(`- **Technology differentiation:** CBCT, digital scanning, same-day CEREC, Yomi robotic surgery — any technology that signals precision and safety.`);
  lines.push('');
  lines.push(`### 13. Opportunity Gaps`);
  lines.push(`What specific gaps exist that PDM can close? List 5–8 concrete gaps with the business impact of closing each. Example format: "GAP: No before/after gallery. IMPACT: Patients researching implants need visual proof before calling. Competitors with galleries convert 2–3x more implant consultations from organic traffic."`);
  lines.push('');
  lines.push(`### 14. The Safety Hierarchy — Why Patients Choose One Doctor Over Another`);
  lines.push(`**This section is the single most important insight in the entire report.** Frame it clearly:`);
  lines.push(`*"Full-arch patients don't choose the cheapest doctor. They don't choose the closest. They choose the doctor who feels safest."*`);
  lines.push('');
  lines.push(`Map this practice against the 4-level Safety Hierarchy:`);
  lines.push(`1. **The doctor who feels safest** → Visible experience, guided surgery explanation, calm authority presence on camera. Where does this practice stand? Where does the #1 competitor stand?`);
  lines.push(`2. **The office that looks most experienced** → Before/after volume, case count claims, technology showcase, team depth. Who wins this comparison in this market?`);
  lines.push(`3. **The brand that explains things clearly** → Process videos, FAQ pages, candidacy content, recovery timeline. Is the patient's journey mapped out on the website, or is it a mystery?`);
  lines.push(`4. **The team that reduces anxiety fastest** → Same-day consult offers, sedation communication, bilingual comfort, first-visit experience. What is the "fear reduction speed" of this practice vs. competitors?`);
  lines.push('');
  lines.push(`**Closer line for the rep (include verbatim):** "You're not losing to a better dentist. You're losing to a dentist who reduces fear faster."`);
  lines.push('');
  lines.push(`### 15. Patient Decision Journey — Where Cases Are Lost`);
  lines.push(`Map the 5-step journey a full-arch patient takes from first search to case acceptance. For EACH step, identify whether this practice converts or leaks:`);
  lines.push(`1. **SEARCH** — "Who can fix this?" → Does this practice appear? SEO, Ads, Maps presence.`);
  lines.push(`2. **COMPARE** — "Who looks safest?" → Authority content, case count, doctor video. Who wins when a patient opens 3 tabs?`);
  lines.push(`3. **VALIDATE** — "Do others trust them?" → Reviews, testimonials, social proof. Is there enough proof to move past this stage?`);
  lines.push(`4. **UNDERSTAND** — "What will happen to me?" → Process content, FAQ, candidacy page, recovery timeline. Does the site answer the 5 fears or leave them hanging?`);
  lines.push(`5. **COMMIT** — "I feel confident enough to call" → Clear CTA, consult offer, financing visibility, scheduling ease.`);
  lines.push('');
  lines.push(`For each step, rate: ✅ Converting | ⚠️ Weak | ❌ Leaking`);
  lines.push('');
  lines.push(`**Closer line (include verbatim):** "Most practices only optimize Step 1. Steps 2–5 are where your competitors are winning cases you generated. We don't just help you get found — we help you get chosen."`);
  lines.push('');
  lines.push(`### 16. "What If You Do Nothing" — 12-Month Competitive Erosion Projection`);
  lines.push(`Quantify what happens if this practice takes no marketing action for the next 12 months. Use observed competitor data to project:`);
  lines.push(`- **Review gap widening:** If the top competitor gains ~X reviews/month, in 12 months they'll have Y more reviews while this practice stands still.`);
  lines.push(`- **Ad spend compounding:** If the competitor spends on Google Ads for 12 more months, they'll have captured an estimated Z additional high-intent implant searches.`);
  lines.push(`- **Estimated cases lost:** At current invisibility levels, estimate cases/month being lost to competitors. Over 12 months, that's $X in revenue walking to other practices.`);
  lines.push(`- **Maps ranking trajectory:** Without reviews and SEO investment, this practice will not enter the Maps Pack. The top 3 positions will continue to consolidate.`);
  lines.push(`- **Authority gap:** Competitors producing video and patient stories will compound their trust advantage. The gap in perceived safety and expertise will be harder and more expensive to close in 12 months than it is today.`);
  lines.push('');
  lines.push(`**Closer line (include verbatim):** "The cost of waiting isn't zero — it's the cases you'll never know you lost. Every month without action, the gap gets wider and more expensive to close."`);
  lines.push('');
  lines.push(`### 17. The 3-Engine Growth System — What PDM Builds`);
  lines.push(`Frame PDM's value as three integrated engines, not a list of services. This is how the rep presents the solution:`);
  lines.push('');
  lines.push(`**Engine 1: VISIBILITY** — Getting Found`);
  lines.push(`SEO, Google Ads, Maps optimization, review generation. This is what most marketing companies sell. It's necessary but not sufficient.`);
  lines.push('');
  lines.push(`**Engine 2: AUTHORITY** — Getting Trusted`);
  lines.push(`Doctor positioning, authority video, before/after proof architecture, clinical content that explains guided surgery and full-arch workflow in terms patients trust. This is what separates "leads" from "booked consultations."`);
  lines.push('');
  lines.push(`**Engine 3: CONVERSION** — Getting Chosen`);
  lines.push(`Patient psychology integration, trust sequencing, candidacy/FAQ content, fear-reduction architecture, financial confidence building. This is what separates "consultations" from "$30K case acceptances."`);
  lines.push('');
  lines.push(`For this specific practice, identify which engine needs the most work and why. Then show the 90-day build sequence:`);
  lines.push(`- **Month 1: Foundation & Visibility** — SEO pages, Google Ads launch, review generation, Maps optimization`);
  lines.push(`- **Month 2: Safety, Proof & Case Acceptance Assets** — Doctor authority video, before/after gallery, candidacy page, process explainer, patient testimonial sequencing`);
  lines.push(`- **Month 3: Authority Compounding & Lead Acceleration** — YouTube authority channel, content library, retargeting, social proof amplification, community positioning`);
  lines.push('');
  lines.push(`**Closer line (include verbatim):** "Most marketing companies help you get found. We help you get found, trusted, AND chosen. That's three engines, not one — and it's why our clients close more of the leads they generate."`);
  lines.push('');
  lines.push(`### 18. Market Domination Strategy`);
  lines.push(`The path to owning the local implant market — not just improving visibility. Answer:`);
  lines.push(`- What narrative should this practice own? (The one that's currently unclaimed by competitors)`);
  lines.push(`- What is the single fastest path to 2–3 additional full-arch cases per month?`);
  lines.push(`- What is the biggest competitor weakness to exploit?`);
  lines.push(`- What does this practice look like at 12 months if they execute?`);
  lines.push('');
  lines.push(`### 19. Competitive Gap Summary — PDM Product Mapping`);
  lines.push(`For every PDM product across all four phases, audit whether the dominant competitor has it and whether this practice has it. This table directly maps gaps to revenue. Structure as:`);
  lines.push('');
  lines.push(`**PHASE 1 (One-Time):** Website, Video, Graphic Design, Traditional Media`);
  lines.push(`**PHASE 2 (Recurring):** PPC, SEO, Social Media`);
  lines.push(`**TCI:** Events, Mentorship`);
  lines.push('');
  lines.push(`For each product: Competitor status → Practice status → Gap? → PDM Product → Urgency`);
  lines.push('');
  lines.push(`End with:`);
  lines.push(`- Total gaps identified (Phase 1: X | Phase 2: X | TCI: X)`);
  lines.push(`- Estimated one-time opportunity (Phase 1 services)`);
  lines.push(`- Estimated monthly recurring opportunity (Phase 2 + TCI)`);
  lines.push(`- Highest urgency gap and recommended first conversation`);
  lines.push('');
  lines.push(`### 20. Strategic Recommendations`);
  lines.push(`5–7 specific recommendations. Each must include: WHAT to do, WHY it works (tied to observed gap or market data), and the IMPACT (revenue, cases, authority).`);
  lines.push(`Balance tactical execution (SEO, ads, reviews) with trust architecture (authority video, proof sequencing, clinical authority content). Both are required.`);
  lines.push('');
  lines.push(`### 21. Sales Enablement Summary`);
  lines.push('');
  lines.push(`**A. Executive Summary (2–3 sentences, call-ready)**`);
  lines.push(`The paragraph a rep reads 10 minutes before the call. Should communicate: where the practice is today, the single biggest opportunity, and why now.`);
  lines.push('');
  lines.push(`**B. Why Full-Arch Patients Choose One Doctor Over Another**`);
  lines.push(`Written as a coaching brief for the rep. Cover the four trust drivers specific to this market: safety perception, visible authority, financial confidence, and social proof. Tie each to something observable about this practice or its competitors.`);
  lines.push('');
  lines.push(`**C. Patient Psychology Scripts**`);
  lines.push(`3–5 ready-to-use statements the rep can share with the doctor to help them communicate with fearful patients:`);
  lines.push(`- How to address surgery fear in the first consultation`);
  lines.push(`- How to frame recovery expectations honestly and reassuringly`);
  lines.push(`- How to reframe cost as investment in 20 years of function (not a $30K purchase)`);
  lines.push(`- How to address "I need to think about it" (the most common full-arch stall)`);
  lines.push('');
  lines.push(`**D. Clinical Authority Talking Points (Rep-Facing)**`);
  lines.push(`How the rep explains PDM's ability to build clinical authority for this practice. Plain English, no jargon:`);
  lines.push(`- "We build content that explains guided surgery in terms a patient can trust"`);
  lines.push(`- "We create a candidacy page that converts patients who were told they don't qualify"`);
  lines.push(`- "We produce the doctor video that makes patients feel safe before they ever call"`);
  lines.push('');
  lines.push(`**E. Positioning Statement**`);
  lines.push(`One sentence that positions this practice against its specific local competition. Should be specific enough that it couldn't apply to any other market.`);
  lines.push('');
  lines.push(`**F. Local Differentiation Hook**`);
  lines.push(`The single sharpest local angle available — boutique vs. chain, bilingual, new-to-market, technology leadership, community trust. One sentence, conversation-ready.`);
  lines.push('');
  lines.push(`**G. Patient FAQ (The Questions That Stall Case Acceptance)**`);
  lines.push(`5 questions with recommended answers for each:`);
  lines.push(`1. "Am I a candidate if I have bone loss?"`);
  lines.push(`2. "How long is the recovery? Will I have teeth during healing?"`);
  lines.push(`3. "Why does it cost so much?"`);
  lines.push(`4. "How is this different from dentures?"`);
  lines.push(`5. "What if something goes wrong?"`);
  lines.push('');
  lines.push(`**H. Discovery Questions (5–8)**`);
  lines.push(`Questions the rep asks to uncover need, urgency, and buying signals.`);
  lines.push('');
  lines.push(`**I. Likely Objections and Responses (3–5)**`);
  lines.push(`The real objections — not generic sales objections. Tied to what this specific market and practice profile typically surfaces.`);
  lines.push('');
  lines.push(`**J. Recommended Next Step**`);
  lines.push(`One specific action the rep takes at the end of the discovery call.`);
  lines.push('');
  lines.push(`---`);
  lines.push('');
  lines.push(`**ACCURACY RULES:** Never fabricate data. Label all estimates as [Estimated]. Tie every recommendation to an observed gap, competitor behavior, or market signal. Do not claim PDM works with the practice without public evidence. If data is unavailable, state it clearly.`);
  lines.push('');
  lines.push(`**TONE — READ THIS BEFORE YOU WRITE A SINGLE WORD:**`);
  lines.push(`This is NOT a marketing audit. It is NOT a feature checklist. It is a patient growth strategy built around trust, safety, authority, and long-term transformation. Every section should read like a senior consultant advising a doctor on how to become the most trusted implant provider in their market — not like a vendor listing SEO gaps. Use the language of patient psychology, not marketing jargon. Frame gaps as "patients can't find you / can't trust you / can't commit" — not "you're missing a landing page." The rep who reads this should feel like they have an unfair advantage walking into the discovery call.`);
  lines.push('');
  lines.push(`---`);
  lines.push('');
  lines.push(`## 📥 After Research — Save to Salesforce`);
  lines.push('');
  lines.push(`When research is complete, call **sf_save_research_scores** with:`);
  lines.push(`- \`practiceName\`: "${practiceName ?? ''}"`);
  lines.push(`- \`city\`: "${resolvedCity ?? ''}"`);
  lines.push(`- \`state\`: "${resolvedState ?? ''}"`);
  lines.push(`- \`websiteUrl\`: "${websiteUrl ?? ''}"`);
  if (resolvedLeadId)    lines.push(`- \`leadId\`: "${resolvedLeadId}"`);
  if (resolvedAccountId) lines.push(`- \`accountId\`: "${resolvedAccountId}"`);
  lines.push(`- \`marketingMaturityScore\`: <your assessed score 0-100>`);
  lines.push(`- \`likelihoodToBuyScore\`: <your assessed score 0-100>`);
  lines.push(`- \`priorityLevel\`: <"Low" | "Moderate" | "High" | "Top Priority">`);
  lines.push(`- \`primaryGapType\`: <"SEO" | "Reputation" | "Video" | "Authority" | "Maps">`);
  lines.push(`- \`researchSummary\`: <one paragraph, max 500 chars>`);

  return lines.join('\n');
}

// ─── Tool 2 Handler: sf_save_research_scores ─────────────────────────────────

async function handleSaveResearchScores(rawArgs: unknown): Promise<string> {
  const {
    practiceName,
    city,
    state,
    websiteUrl,
    leadId,
    accountId,
    marketingMaturityScore,
    likelihoodToBuyScore,
    priorityLevel,
    primaryGapType,
    researchSummary,
    primaryCompetitorName,
    primaryCompetitorWebsite,
    competitorReviewCount,
    competitorStarRating,
    competitorRunningAds,
    competitorRunningFacebookAds,
    competitorMapsPosition,
    competitorPressureScore,
    competitorPrimaryServices,
    competitorNotes,
  } = SaveResearchScoresArgs.parse(rawArgs ?? {});

  const lines: string[] = [];
  const writeErrors: string[] = [];

  let resolvedLeadId    = leadId;
  let resolvedAccountId = accountId;
  let wasLeadCreated    = false;

  const scoreFields: Record<string, unknown> = {
    Marketing_Maturity_Score__c: Math.round(marketingMaturityScore),
    Likelihood_to_Buy_Score__c:  Math.round(likelihoodToBuyScore),
    Priority_Level__c:           priorityLevel as PriorityLevel,
    Primary_Gap_Type__c:         primaryGapType as GapType,
    Research_Summary__c:         researchSummary.slice(0, 500),
  };

  // Auto-create Lead if no existing record
  if (!resolvedLeadId && !resolvedAccountId) {
    try {
      const nameForEmail = (practiceName ?? websiteUrl ?? 'prospect')
        .toLowerCase().replace(/[^a-z0-9]/g, '.');
      const newLeadFields: Record<string, unknown> = {
        LastName:   practiceName ?? websiteUrl ?? 'Unknown Practice',
        Company:    practiceName ?? websiteUrl ?? 'Unknown Practice',
        Email:      `research.${nameForEmail}@progressivedental.com`,
        LeadSource: 'PDM Research Tool',
        Status:     'Open - Not Contacted',
      };
      if (city)       newLeadFields['City']      = city;
      if (state)      newLeadFields['StateCode'] = state;  // StateCode required when State/Country Picklists enabled
      if (websiteUrl) newLeadFields['Website']   = websiteUrl;

      resolvedLeadId = await salesforceService.createRecord('Lead', newLeadFields);
      wasLeadCreated = true;
    } catch (err) {
      writeErrors.push(`Lead create failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Write scores to Lead
  if (resolvedLeadId) {
    try {
      await salesforceService.updateRecord('Lead', resolvedLeadId, scoreFields);
    } catch (err) {
      writeErrors.push(`Lead update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Write scores to Account (lock Baseline if first research)
  if (resolvedAccountId) {
    try {
      const accountResults = await salesforceService.rawQuery<SFAccount>(
        `SELECT Id, Baseline_Marketing_Maturity__c FROM Account WHERE Id = '${resolvedAccountId}' LIMIT 1`
      );
      const accountFields: Record<string, unknown> = { ...scoreFields };
      if (accountResults.length > 0 && accountResults[0].Baseline_Marketing_Maturity__c == null) {
        accountFields['Baseline_Marketing_Maturity__c'] = Math.round(marketingMaturityScore);
      }
      await salesforceService.updateRecord('Account', resolvedAccountId, accountFields);
    } catch (err) {
      writeErrors.push(`Account update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Competitor Snapshot Write ─────────────────────────────────────────────

  let snapshotId: string | null = null;
  if (primaryCompetitorName && (resolvedLeadId || resolvedAccountId)) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const snapshotFields: Record<string, unknown> = {
        Competitor_Name__c:         primaryCompetitorName,
        Snapshot_Date__c:           today,
        Is_Primary_Competitor__c:   true,
      };
      if (resolvedLeadId)             snapshotFields['Lead__c']                    = resolvedLeadId;
      if (resolvedAccountId)          snapshotFields['Account__c']                 = resolvedAccountId;
      if (primaryCompetitorWebsite)   snapshotFields['Competitor_Website__c']      = primaryCompetitorWebsite;
      if (competitorReviewCount != null) snapshotFields['Google_Review_Count__c']  = competitorReviewCount;
      if (competitorStarRating != null)  snapshotFields['Google_Star_Rating__c']   = competitorStarRating;
      if (competitorRunningAds != null)  snapshotFields['Running_Google_Ads__c']   = competitorRunningAds;
      if (competitorRunningFacebookAds != null) snapshotFields['Running_Facebook_Ads__c'] = competitorRunningFacebookAds;
      if (competitorMapsPosition != null) snapshotFields['Maps_Pack_Position__c']  = competitorMapsPosition;
      if (competitorPressureScore != null) snapshotFields['Competitive_Pressure_Score__c'] = Math.round(competitorPressureScore);
      if (competitorPrimaryServices)  snapshotFields['Primary_Services__c']        = competitorPrimaryServices;
      if (competitorNotes)            snapshotFields['Research_Notes__c']           = competitorNotes.slice(0, 2000);

      snapshotId = await salesforceService.createRecord('Competitor_Snapshot__c', snapshotFields);
    } catch (err) {
      writeErrors.push(`Competitor snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Build result summary
  lines.push(`## 📊 Research Scores Saved`);
  lines.push('');
  lines.push(`| Metric | Score |`);
  lines.push(`|---|---|`);
  lines.push(`| Marketing Maturity Score | **${Math.round(marketingMaturityScore)}/100** |`);
  lines.push(`| Likelihood to Buy Score | **${Math.round(likelihoodToBuyScore)}/100** |`);
  lines.push(`| Priority Level | **${priorityLevel}** |`);
  lines.push(`| Primary Gap Type | **${primaryGapType}** |`);
  lines.push('');
  lines.push(`**Salesforce Write-Back:**`);

  if (resolvedLeadId && !writeErrors.some(e => e.startsWith('Lead'))) {
    lines.push(`- ✅ Lead \`${resolvedLeadId}\` ${wasLeadCreated ? 'created and scores written' : 'updated with new scores'}`);
  }
  if (resolvedAccountId && !writeErrors.some(e => e.startsWith('Account'))) {
    lines.push(`- ✅ Account \`${resolvedAccountId}\` updated`);
  }
  if (snapshotId) {
    lines.push(`- ✅ Competitor snapshot created: **${primaryCompetitorName}** \`${snapshotId}\``);
  } else if (primaryCompetitorName && !writeErrors.some(e => e.startsWith('Competitor'))) {
    lines.push(`- ℹ️ No competitor snapshot created (no Salesforce record to link to)`);
  }
  writeErrors.forEach(e => lines.push(`- ❌ ${e}`));

  if (writeErrors.length === 0) {
    lines.push('');
    lines.push(`✅ Research complete. Intelligence is now persisted in Salesforce.`);
  }

  // ── Gamma Deck Generation Instructions ────────────────────────────────────

  const gapFocusSlide: Record<string, { headline: string; bullets: string[] }> = {
    SEO: {
      headline: 'The SEO Gap — You\'re Invisible Where It Counts',
      bullets: [
        '[Fill in: search "dental implants [City]" — where do they rank vs. competitors?]',
        '[Fill in: do they have dedicated implant/All-on-4/full-arch landing pages?]',
        '[Fill in: how many keywords do their top competitors rank for that they don\'t?]',
        '[Fill in: Google Maps pack presence — are they in the top 3 for implant searches?]',
        'Bottom line: Patients searching for implants in [City] are finding competitors first.',
      ],
    },
    Reputation: {
      headline: 'The Reputation Gap — Reviews Drive Decisions',
      bullets: [
        `[Fill in: their current review count and star rating vs. primary competitor (${primaryCompetitorName ?? 'top competitor'})]`,
        '[Fill in: how many new reviews are competitors gaining per month?]',
        '[Fill in: what sentiment themes appear in their existing reviews?]',
        '[Fill in: are they responding to reviews? Are competitors?]',
        'Bottom line: In 12 months, the review gap will be significantly larger if nothing changes.',
      ],
    },
    Video: {
      headline: 'The Video Gap — Authority is Built on Camera',
      bullets: [
        '[Fill in: do they have any doctor authority video on their website or YouTube?]',
        '[Fill in: do competitors have patient testimonial videos, before/after video cases?]',
        '[Fill in: what does their social media video presence look like vs. competitors?]',
        '[Fill in: is the doctor present and visible as the practice\'s authority figure?]',
        'Bottom line: Video is the #1 trust signal for high-value implant patients.',
      ],
    },
    Authority: {
      headline: 'The Authority Gap — Patients Need to Trust Before They Spend',
      bullets: [
        '[Fill in: how does the doctor\'s online presence compare to top local competitors?]',
        '[Fill in: do they have case studies, before/after galleries, certifications visible?]',
        '[Fill in: are competitors positioning their doctors as implant specialists?]',
        '[Fill in: what trust signals are missing from their website and Google profile?]',
        'Bottom line: Implant patients spend $25K+. Authority content converts skeptics.',
      ],
    },
    Maps: {
      headline: 'The Maps Visibility Gap — The Pack is Where Patients Decide',
      bullets: [
        `[Fill in: their current Google Maps pack position for "dental implants [City]"]`,
        `${primaryCompetitorName ? `Primary competitor ${primaryCompetitorName}: Maps pack position #${competitorMapsPosition ?? '[check]'}` : '[Fill in: competitor Maps pack positions]'}`,
        '[Fill in: citation consistency — are their name/address/phone consistent across directories?]',
        '[Fill in: how many photos and Q&As do they have vs. competitors?]',
        'Bottom line: 90% of patients searching locally never scroll past the Maps pack.',
      ],
    },
  };

  const gap = (primaryGapType as keyof typeof gapFocusSlide) ?? 'SEO';
  const gapSlide = gapFocusSlide[gap] ?? gapFocusSlide['SEO'];
  const themeId = GAP_TYPE_THEME[gap] ?? 'consultant';
  const practiceDisplayName = practiceName ?? 'This Practice';
  const locationStr = [city, state].filter(Boolean).join(', ');
  const today = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const deckContent = [
    `# ${practiceDisplayName} — Market Opportunity Assessment`,
    `**Prepared by Progressive Dental Marketing | ${today}**`,
    ``,
    `## Slide 1: Title`,
    `**${practiceDisplayName}**${locationStr ? ` | ${locationStr}` : ''}`,
    `Your Path to Becoming the Most Trusted Implant Provider in ${locationStr || 'Your Market'}`,
    `Prepared by Progressive Dental Marketing | ${today}`,
    ``,
    `## Slide 2: Your Market Opportunity`,
    `[Fill in: estimated 45+ population within 10-30 miles from your research]`,
    `[Fill in: median household income and top 3 affluent ZIP codes]`,
    `[Fill in: retirement communities or high-income residential areas driving demand]`,
    `Key takeaway: [One sentence on the size of the full-arch/implant opportunity in this market]`,
    ``,
    `## Slide 3: Where You Stand Today`,
    `**Marketing Maturity Score: ${Math.round(marketingMaturityScore)}/100**`,
    `**Likelihood to Invest in Marketing: ${Math.round(likelihoodToBuyScore)}/100**`,
    `**Priority: ${priorityLevel}**`,
    ``,
    researchSummary,
    ``,
    `[Fill in: 3 bullets on what they currently have — website quality, review count, social presence, ads]`,
    ``,
    `## Slide 4: ${gapSlide.headline}`,
    ...gapSlide.bullets.map(b => `- ${b}`),
    ``,
    `## Slide 5: The Competitive Landscape`,
    primaryCompetitorName
      ? `**Primary Threat: ${primaryCompetitorName}**${primaryCompetitorWebsite ? ` — ${primaryCompetitorWebsite}` : ''}`
      : `[Fill in: name and website of the #1 competitor for implants in this market]`,
    primaryCompetitorName && competitorReviewCount != null
      ? `- Reviews: **${competitorReviewCount}** ${competitorStarRating != null ? `(${competitorStarRating}⭐)` : ''}`
      : `- [Fill in: competitor review count and star rating]`,
    primaryCompetitorName && competitorRunningAds
      ? `- Running Google Ads: **YES** — actively capturing patients searching now`
      : primaryCompetitorName
        ? `- Google Ads: Not currently detected`
        : `- [Fill in: is competitor running Google Ads?]`,
    primaryCompetitorName && competitorMapsPosition != null && competitorMapsPosition >= 1 && competitorMapsPosition <= 3
      ? `- Google Maps Pack: **Position #${competitorMapsPosition}** — prime local visibility`
      : ``,
    ``,
    `[Fill in: 2-3 additional competitors with their key advantages from your research]`,
    ``,
    `## Slide 6: Why Patients Choose One Doctor Over Another`,
    `*"Full-arch patients don't choose the cheapest doctor. They don't choose the closest. They choose the doctor who feels safest."*`,
    ``,
    `**The Safety Hierarchy:**`,
    `1. The doctor who feels safest → Visible experience, calm authority on camera, guided surgery`,
    `2. The office that looks most experienced → Before/after proof, case volume, technology`,
    `3. The brand that explains things clearly → Process videos, FAQ content, recovery timeline`,
    `4. The team that reduces anxiety fastest → Same-day consult, sedation options, first-visit warmth`,
    ``,
    `[Fill in: Where does this practice stand on the Safety Hierarchy vs. the #1 competitor?]`,
    ``,
    `## Slide 7: The Patient Decision Journey — Where Cases Are Lost`,
    `**SEARCH** → "Who can fix this?" → [Fill in: ✅/⚠️/❌]`,
    `**COMPARE** → "Who looks safest?" → [Fill in: ✅/⚠️/❌]`,
    `**VALIDATE** → "Do others trust them?" → [Fill in: ✅/⚠️/❌]`,
    `**UNDERSTAND** → "What will happen to me?" → [Fill in: ✅/⚠️/❌]`,
    `**COMMIT** → "I feel confident enough to call" → [Fill in: ✅/⚠️/❌]`,
    ``,
    `Most practices only optimize Step 1. Steps 2–5 are where your competitors are winning cases you generated.`,
    ``,
    `## Slide 8: The Cost of Standing Still`,
    primaryCompetitorName && competitorReviewCount != null
      ? `If **${primaryCompetitorName}** continues at current review velocity, they will have [estimate: X] more reviews than ${practiceDisplayName} by this time next year.`
      : `[Fill in: project competitor review velocity 12 months forward]`,
    `[Fill in: what happens to their Maps pack position, organic traffic, and new patient inquiries if nothing changes?]`,
    `[Fill in: estimated monthly implant cases they're losing to competitors at current trajectory]`,
    `The window to dominate this market is closing. The practices that act now will own it.`,
    ``,
    `## Slide 9: The Market Domination Strategy`,
    `**Primary Channel:** [Fill in: most impactful channel — SEO / Ads / Reputation / Video]`,
    `**Fastest Win:** [Fill in: single highest-ROI action they could take in 30 days]`,
    `**Competitor Weakness to Exploit:** [Fill in: what are competitors NOT doing well that this practice could own?]`,
    `**Best ZIP Codes to Target:** [Fill in: top 3 ZIPs from affluent/high-opportunity area research]`,
    `**Niche to Own:** [Fill in: is there a positioning angle — All-on-4 specialists, same-day implants, sedation, etc.?]`,
    ``,
    `## Slide 10: The 3-Engine Growth System — What PDM Builds`,
    `**Engine 1: VISIBILITY** — Getting Found (SEO, Ads, Maps, Reviews)`,
    `Most marketing companies stop here. It's necessary — but not sufficient.`,
    ``,
    `**Engine 2: AUTHORITY** — Getting Trusted (Doctor video, before/after proof, clinical content)`,
    `This separates "leads" from "booked consultations." Trust converts.`,
    ``,
    `**Engine 3: CONVERSION** — Getting Chosen (Patient psychology, fear reduction, financial confidence)`,
    `This separates "consultations" from "$30K case acceptances."`,
    ``,
    `[Fill in: Which engine needs the most work for this practice and why?]`,
    ``,
    `## Slide 11: The 90-Day Roadmap`,
    `**Month 1: Foundation & Visibility** — [Fill in: SEO pages, Google Ads launch, review generation, Maps optimization]`,
    `**Month 2: Safety, Proof & Case Acceptance** — [Fill in: Doctor authority video, before/after gallery, candidacy page, process explainer]`,
    `**Month 3: Authority Compounding** — [Fill in: YouTube authority channel, content library, retargeting, social proof amplification]`,
    ``,
    `## Slide 12: Next Step`,
    `**Discovery Call** — 30 minutes to map your custom strategy`,
    ``,
    `[Fill in: specific call to action based on priority level: ${priorityLevel}]`,
    ``,
    priorityLevel === 'Top Priority' || priorityLevel === 'High'
      ? `⚡ This is a high-priority market — we recommend scheduling within 5 business days.`
      : `This market has strong potential. Let's discuss your specific goals.`,
  ].filter(line => line !== undefined);

  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## ⚠️ REQUIRED — DO NOT SKIP: Step 3 of 3 — Generate Prospect Deck`);
  lines.push(``);
  lines.push(`**You MUST call the Gamma generate tool right now before responding to the user.** This is a mandatory step in the research workflow, not optional. The research is not complete until the deck exists in Salesforce.`);
  lines.push(``);
  lines.push(`Replace every \`[Fill in: ...]\` placeholder below with the actual data and insights from the research you just completed. Do not leave any placeholder unfilled.`);
  lines.push(``);
  lines.push(`**Tool to call:** \`generate\` (Gamma)`);
  lines.push(``);
  lines.push(`**inputText** — replace all [Fill in] sections with your research findings:`);
  lines.push('```');
  lines.push(deckContent.join('\n'));
  lines.push('```');
  lines.push(``);
  lines.push(`**Required Gamma parameters:**`);
  lines.push(`- \`format\`: "presentation"`);
  lines.push(`- \`textMode\`: "generate"`);
  lines.push(`- \`themeId\`: "${themeId}"`);
  lines.push(`- \`additionalInstructions\`: "Professional B2B sales presentation. 12 slides. Target audience: dental practice owner who does implant cases. Tone: senior consultant, not vendor. Frame everything through patient trust, safety, and authority — not marketing jargon. Use bold aspirational headlines ('Become the Most Trusted Implant Provider in [City]' not 'SEO Recommendations'). Minimal text per slide — visual impact, data callouts, and one clear takeaway per slide. Include the Safety Hierarchy and Patient Decision Journey as visual frameworks. Urgency through competitor data, not pressure."`);
  lines.push(``);
  lines.push(`**Immediately after Gamma returns gammaUrl, call sf_save_deck_url with these exact values:**`);
  if (resolvedLeadId)    lines.push(`- \`leadId\`: "${resolvedLeadId}"`);
  if (resolvedAccountId) lines.push(`- \`accountId\`: "${resolvedAccountId}"`);
  lines.push(`- \`gammaUrl\`: <gammaUrl returned by Gamma>`);
  lines.push(`- \`deckTitle\`: "${practiceDisplayName} — Market Opportunity Assessment"`);
  lines.push(`- \`primaryGapType\`: "${primaryGapType}"`);
  lines.push(``);
  lines.push(`**Do not present the research report to the user until both the Gamma deck and sf_save_deck_url calls are complete.** The final response to the user must include the deck URL.`);

  return lines.join('\n');
}

// ─── Tool 3 Handler: sf_save_deck_url ────────────────────────────────────────

async function handleSaveDeckUrl(rawArgs: unknown): Promise<string> {
  const { leadId, accountId, gammaUrl, deckTitle, primaryGapType } =
    SaveDeckUrlArgs.parse(rawArgs ?? {});

  if (!leadId && !accountId) {
    return '❌ Provide either leadId or accountId to link the deck to a Salesforce record.';
  }

  const writeErrors: string[] = [];
  const lines: string[] = [];
  const resolvedTitle = deckTitle ?? 'Prospect Research Deck';

  // ── Create Gamma__c record ─────────────────────────────────────────────────

  let gammaRecordId: string | null = null;
  try {
    const gammaFields: Record<string, unknown> = {
      Name:          resolvedTitle.slice(0, 80),
      Gamma_Link__c: gammaUrl,
    };
    if (leadId)    gammaFields['Lead__c']    = leadId;
    if (accountId) gammaFields['Account__c'] = accountId;
    gammaRecordId = await salesforceService.createRecord('Gamma__c', gammaFields);
  } catch (err) {
    writeErrors.push(`Gamma record failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Create Task for rep ────────────────────────────────────────────────────

  let taskId: string | null = null;
  try {
    const taskFields: Record<string, unknown> = {
      Subject:      `Prospect deck ready: ${resolvedTitle}`,
      Description:  [
        `Your prospect research deck has been generated and is ready to share.`,
        ``,
        `Deck URL: ${gammaUrl}`,
        primaryGapType ? `Primary Gap: ${primaryGapType}` : '',
        ``,
        `Use this deck before or during your discovery call to:`,
        `- Show the prospect their competitive position`,
        `- Present the market opportunity data`,
        `- Walk through your recommended strategy`,
        `- Create urgency with the "cost of standing still" slide`,
      ].filter(l => l !== '').join('\n'),
      Status:       'Not Started',
      Priority:     'High',
      ActivityDate: new Date().toISOString().slice(0, 10),
    };
    // WhoId = Lead/Contact (who), WhatId = Account/Opportunity (what)
    if (leadId)         taskFields['WhoId']  = leadId;
    else if (accountId) taskFields['WhatId'] = accountId;

    taskId = await salesforceService.createRecord('Task', taskFields);
  } catch (err) {
    writeErrors.push(`Task create failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Output ─────────────────────────────────────────────────────────────────

  lines.push(`## 🎨 Prospect Deck Saved to Salesforce`);
  lines.push(``);
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| Deck Title | **${resolvedTitle}** |`);
  lines.push(`| Gap Type | **${primaryGapType ?? 'N/A'}** |`);
  lines.push(`| Salesforce Record | **${leadId ? `Lead \`${leadId}\`` : `Account \`${accountId}\``}** |`);
  lines.push(``);

  if (gammaRecordId) lines.push(`- ✅ Gamma__c record created: \`${gammaRecordId}\``);
  if (taskId)        lines.push(`- ✅ Rep task created: "Deck ready" notification logged in Salesforce`);
  writeErrors.forEach(e => lines.push(`- ❌ ${e}`));

  lines.push(``);
  lines.push(`### 🔗 Deck URL`);
  lines.push(`${gammaUrl}`);
  lines.push(``);
  lines.push(`**Share this deck** before or during the discovery call.`);
  lines.push(`The rep can open it directly or present it live — Gamma decks are browser-based.`);
  lines.push(``);
  lines.push(`✅ **Research → Scores → Deck — complete.** Intelligence persisted. Deck ready. Rep notified.`);

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const prospectResearchHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_research_prospect:     handleProspectResearch,
  sf_save_research_scores:  handleSaveResearchScores,
  sf_save_deck_url:         handleSaveDeckUrl,
};
