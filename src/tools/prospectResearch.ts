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
      },
      required: ['marketingMaturityScore', 'likelihoodToBuyScore', 'priorityLevel', 'primaryGapType', 'researchSummary'],
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
  practiceName:           z.string().optional(),
  city:                   z.string().optional(),
  state:                  z.string().optional(),
  websiteUrl:             z.string().optional(),
  leadId:                 z.string().optional(),
  accountId:              z.string().optional(),
  marketingMaturityScore: z.number().min(0).max(100),
  likelihoodToBuyScore:   z.number().min(0).max(100),
  priorityLevel:          z.enum(VALID_PRIORITY_LEVELS),
  primaryGapType:         z.enum(VALID_GAP_TYPES),
  researchSummary:        z.string().max(500),
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
      if (city)       newLeadFields['City']    = city;
      if (state)      newLeadFields['State']   = state;
      if (websiteUrl) newLeadFields['Website'] = websiteUrl;

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
  writeErrors.forEach(e => lines.push(`- ❌ ${e}`));

  if (writeErrors.length === 0) {
    lines.push('');
    lines.push(`✅ Research complete. Intelligence is now persisted in Salesforce.`);
  }

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const prospectResearchHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_research_prospect:     handleProspectResearch,
  sf_save_research_scores:  handleSaveResearchScores,
};
