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

// ─── Tool 1 Handler: sf_research_prospect ────────────────────────────────────

async function handleProspectResearch(rawArgs: unknown): Promise<string> {
  const { practiceName, city, state, websiteUrl, leadId, accountId } =
    ProspectResearchArgs.parse(rawArgs ?? {});

  if (!practiceName && !websiteUrl && !leadId && !accountId) {
    return '❌ Please provide at least a practice name, website URL, or Salesforce record ID.';
  }

  // ── Salesforce Pre-Check ──────────────────────────────────────────────────

  let resolvedLeadId    = leadId;
  let resolvedAccountId = accountId;
  let sfLead: SFLead | null    = null;
  let sfAccount: SFAccount | null = null;

  if (!resolvedLeadId && !resolvedAccountId && practiceName) {
    const escapedName = practiceName.replace(/'/g, "\\'");

    const [leadResults, accountResults] = await Promise.all([
      salesforceService.rawQuery<SFLead>(
        `SELECT Id, Name, Company, Status, OwnerId, Owner.Name,
                LastActivityDate, Website, City, State,
                Marketing_Maturity_Score__c, Likelihood_to_Buy_Score__c,
                Priority_Level__c, Research_Summary__c, Primary_Gap_Type__c
         FROM Lead
         WHERE (Name LIKE '%${escapedName}%' OR Company LIKE '%${escapedName}%')
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
         WHERE Name LIKE '%${escapedName}%'
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
  const locationStr = [city, state].filter(Boolean).join(', ');

  lines.push(`# 🔍 PDM Prospect Research: ${practiceName ?? websiteUrl ?? 'Unknown Practice'}`);
  if (locationStr) lines.push(`**Location:** ${locationStr}`);
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
  lines.push(`Please run a comprehensive PDM Sales Market Research analysis on this practice now using web search. Cover the following in order:`);
  lines.push('');
  lines.push(`**Practice to research:** ${practiceName ?? 'Identify from website'}`);
  lines.push(`**Location:** ${locationStr || 'Determine from website'}`);
  lines.push(`**Website:** ${websiteUrl ?? 'Search for it'}`);
  lines.push('');
  lines.push(`**Search for:**`);
  lines.push(`- Their website, Google Maps listing, and Google reviews`);
  lines.push(`- SEO presence: search "dental implants ${locationStr}" and "All-on-4 ${locationStr}"`);
  lines.push(`- Competitor practices targeting implant/full-arch cases in the area`);
  lines.push(`- Social media presence and any ads running`);
  lines.push(`- Patient reviews and reputation signals`);
  lines.push('');
  lines.push(`**Produce the complete research report covering:**`);
  lines.push(`1. Practice Overview`);
  lines.push(`2. Market Snapshot (10-30 mile radius: population 45+, median income, affluent ZIPs)`);
  lines.push(`3. Competitive Landscape (who dominates local implant/full-arch, easiest to disrupt, most pressure)`);
  lines.push(`4. Practice Marketing Evaluation (website, mobile, branding, doctor authority, before/after, financing CTA)`);
  lines.push(`5. SEO Gap Analysis (implant/full-arch/All-on-4 pages, keyword gaps, Maps relevance)`);
  lines.push(`6. Google Ads Opportunity`);
  lines.push(`7. Reputation Analysis (rating, review count, sentiment, velocity vs competitors)`);
  lines.push(`8. Google Maps & Local Visibility`);
  lines.push(`9. Opportunity Gaps`);
  lines.push(`10. Market Domination Strategy`);
  lines.push(`11. Strategic Recommendations (3-5 specific, evidence-based)`);
  lines.push(`12. Sales Enablement Summary:`);
  lines.push(`    - Executive Summary for the Rep (2-3 sentences, call-ready)`);
  lines.push(`    - Talking Points (7-10)`);
  lines.push(`    - Discovery Questions (5-8)`);
  lines.push(`    - Likely Objections and Responses (3-5)`);
  lines.push(`    - Positioning Statement`);
  lines.push(`    - Recommended Next Step`);
  lines.push('');
  lines.push(`**ACCURACY RULES:** Never fabricate data. Label estimates as [Estimated]. Tie every recommendation to observed gaps or market data.`);
  lines.push('');
  lines.push(`---`);
  lines.push('');
  lines.push(`## 📥 After Research — Save to Salesforce`);
  lines.push('');
  lines.push(`When research is complete, call **sf_save_research_scores** with:`);
  lines.push(`- \`practiceName\`: "${practiceName ?? ''}"`);
  lines.push(`- \`city\`: "${city ?? ''}"`);
  lines.push(`- \`state\`: "${state ?? ''}"`);
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
    `Market Opportunity Assessment`,
    `Prepared for Discovery Call`,
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
    `## Slide 6: The Cost of Standing Still`,
    primaryCompetitorName && competitorReviewCount != null
      ? `If **${primaryCompetitorName}** continues at current review velocity, they will have [estimate: X] more reviews than ${practiceDisplayName} by this time next year.`
      : `[Fill in: project competitor review velocity 12 months forward]`,
    `[Fill in: what happens to their Maps pack position, organic traffic, and new patient inquiries if nothing changes?]`,
    `[Fill in: estimated monthly implant cases they're losing to competitors at current trajectory]`,
    `The window to dominate this market is closing. The practices that act now will own it.`,
    ``,
    `## Slide 7: The Market Domination Strategy`,
    `**Primary Channel:** [Fill in: most impactful channel — SEO / Ads / Reputation / Video]`,
    `**Fastest Win:** [Fill in: single highest-ROI action they could take in 30 days]`,
    `**Competitor Weakness to Exploit:** [Fill in: what are competitors NOT doing well that this practice could own?]`,
    `**Best ZIP Codes to Target:** [Fill in: top 3 ZIPs from affluent/high-opportunity area research]`,
    `**Niche to Own:** [Fill in: is there a positioning angle — All-on-4 specialists, same-day implants, sedation, etc.?]`,
    ``,
    `## Slide 8: What Progressive Dental Marketing Delivers`,
    `- Dental implant marketing specialists — we only work with dental practices`,
    `- [Fill in: 2-3 PDM capabilities most relevant to this practice's primary gap type: ${gap}]`,
    `- Proven results: [Fill in: relevant PDM case study or result for this gap type if you have one]`,
    `- Dedicated account manager + full team: PPC, SEO, Social, Video, Reputation`,
    ``,
    `## Slide 9: The 90-Day Roadmap`,
    `**Month 1:** [Fill in: priority 1 action from your strategic recommendations]`,
    `**Month 2:** [Fill in: priority 2 — build on Month 1 momentum]`,
    `**Month 3:** [Fill in: priority 3 — compound effect begins, first measurable wins]`,
    ``,
    `[Fill in: specific deliverables for each month based on their gap type and priority]`,
    ``,
    `## Slide 10: Next Step`,
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
  lines.push(`## 🎨 Next Step: Generate Prospect Deck`);
  lines.push(``);
  lines.push(`Call the **Gamma generate** tool now. Fill in every bracketed \`[Fill in: ...]\` section with the specific data and insights from the research you just completed.`);
  lines.push(``);
  lines.push(`**inputText** (fill in all bracketed sections from your research):`);
  lines.push('```');
  lines.push(deckContent.join('\n'));
  lines.push('```');
  lines.push(``);
  lines.push(`**Gamma parameters:**`);
  lines.push(`- \`format\`: "presentation"`);
  lines.push(`- \`textMode\`: "generate"`);
  lines.push(`- \`themeId\`: "${themeId}"`);
  lines.push(`- \`additionalInstructions\`: "Professional B2B sales presentation. 10 slides. Data-driven, persuasive, clean. Target audience: dental practice owner or office manager. Emphasize urgency, competitor threat, and market opportunity. Strong headlines. Minimal text per slide — let the data speak."`);
  lines.push(``);
  lines.push(`**After Gamma returns the gammaUrl, immediately call sf_save_deck_url with:**`);
  if (resolvedLeadId)    lines.push(`- \`leadId\`: "${resolvedLeadId}"`);
  if (resolvedAccountId) lines.push(`- \`accountId\`: "${resolvedAccountId}"`);
  lines.push(`- \`gammaUrl\`: <the URL returned by Gamma>`);
  lines.push(`- \`deckTitle\`: "${practiceDisplayName} — Market Opportunity Assessment"`);
  lines.push(`- \`primaryGapType\`: "${primaryGapType}"`);

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
