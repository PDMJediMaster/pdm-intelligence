// ─────────────────────────────────────────────────────────────────────────────
// Prospect Research Tool — sf_research_prospect
//
// Implements the full PDM Sales Market Research GPT as a governed MCP tool.
//
// Flow:
//   1. Salesforce pre-check — search Lead + Account for existing records
//   2. Web research via Anthropic API (claude-opus-4-6 + web_search)
//   3. Score extraction from structured response section
//   4. Salesforce write-back — scores → Lead or Account record
//   5. Return full markdown research report
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { salesforceService } from '../services/salesforce.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const WILLIAM_SUMMERS_USER_ID = '005PU000001eUQDYA2';

const VALID_PRIORITY_LEVELS  = ['Low', 'Moderate', 'High', 'Top Priority'] as const;
const VALID_GAP_TYPES        = ['SEO', 'Reputation', 'Video', 'Authority', 'Maps'] as const;

type PriorityLevel = typeof VALID_PRIORITY_LEVELS[number];
type GapType       = typeof VALID_GAP_TYPES[number];

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface ExtractedScores {
  marketing_maturity_score: number;
  likelihood_to_buy_score: number;
  priority_level: PriorityLevel;
  primary_gap_type: GapType;
  research_summary: string;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export const prospectResearchTools: Tool[] = [
  {
    name: 'sf_research_prospect',
    description:
      'Runs the full PDM Sales Market Research GPT analysis on a dental practice prospect. ' +
      'Checks Salesforce first for existing Lead/Account records and prior research history. ' +
      'Then runs comprehensive web research covering: market snapshot (demographics, competition radius, ' +
      'affluent ZIPs), competitive landscape (dominant competitor, easiest to disrupt), practice evaluation ' +
      '(website, branding, trust signals, doctor authority), SEO gap analysis (implant/full-arch/All-on-4 pages, ' +
      'keyword gaps, local targeting), Google Ads opportunity, reputation analysis (rating, review count, sentiment), ' +
      'Google Maps visibility, opportunity gaps, marketing maturity score (0-100), likelihood to buy score (0-100), ' +
      'priority level, market domination strategy, strategic recommendations, and sales enablement summary ' +
      '(talking points, discovery questions, objections, positioning statement). ' +
      'Writes all scores back to the Salesforce Lead or Account record after research completes. ' +
      'Use when a rep asks to research a prospect, wants market analysis before a discovery call, ' +
      'or asks "what do we know about X dental practice".',
    inputSchema: {
      type: 'object',
      properties: {
        practiceName: {
          type: 'string',
          description: 'Name of the dental practice (e.g., "Smith Implant Center", "Advanced Dental Arts")',
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
          description: 'Practice website URL — use instead of or in addition to name/location',
        },
        leadId: {
          type: 'string',
          description: 'Salesforce Lead ID if already known — skips lookup, writes scores directly to this record',
        },
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID if the practice is an existing client',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schema ─────────────────────────────────────────────────────────────

const ProspectResearchArgs = z.object({
  practiceName: z.string().optional(),
  city:         z.string().optional(),
  state:        z.string().optional(),
  websiteUrl:   z.string().optional(),
  leadId:       z.string().optional(),
  accountId:    z.string().optional(),
});

// ─── Research System Prompt ───────────────────────────────────────────────────

const RESEARCH_SYSTEM_PROMPT = `You are PDM's Sales Market Research GPT — the AI engine for Progressive Dental Marketing, a dental implant marketing agency.

Your job is to produce a comprehensive market research analysis on a dental practice prospect. You have access to web search and should use it extensively to gather real, current data.

ACCURACY RULES (enforce strictly):
- Never fabricate missing data
- Clearly label assumptions and estimates with "[Estimated]" or "[Assumed]"
- Do not claim Progressive Dental works with the practice without public evidence
- If data is unavailable, state: "Could not be confirmed from public sources"
- Tie every recommendation to observed gaps, competitor behavior, or market data

OUTPUT STRUCTURE (follow exactly — each section is required):
1. Practice Overview (name, location, website, specialties observed)
2. Market Snapshot (10-30 mile radius population 45+, median income, affluent ZIPs, retirement communities, implant demand signals)
3. Competitive Landscape (who dominates local implant/full-arch market, easiest competitor to disrupt, which competitor applies most pressure, and why)
4. Practice Marketing Evaluation (website quality, mobile experience, branding, trust signals, doctor authority/bio, before/after gallery, financing CTA, video content)
5. SEO Gap Analysis (do they have dedicated implant/full-arch/All-on-4 pages, keyword targeting assessment, local landing pages, Google Maps relevance signals)
6. Google Ads Opportunity (are they running ads, competitor ad presence, estimated opportunity)
7. Reputation Analysis (Google rating, approximate review count, sentiment themes from visible reviews, review velocity vs competitors)
8. Google Maps & Local Visibility (Maps ranking signals, NAP consistency, citation quality)
9. Opportunity Gaps (what they're missing, what competitors do better, what happens if they do nothing)
10. Marketing Maturity Score (0-100 scale — 0=no digital presence, 100=dominant market leader)
11. Likelihood to Buy Score (0-100 scale — based on gap size, budget signals, decision-maker accessibility, competition urgency)
12. Priority Level (Low / Moderate / High / Top Priority)
13. Market Domination Strategy (most important channel to win first, fastest path to growth, biggest competitor weakness to exploit, best ZIP codes to target, niche positioning angle, short-term moves (0-90 days), long-term moves (6-18 months))
14. Strategic Recommendations (3-5 specific, evidence-based recommendations — each with what, why, and expected impact)
15. Sales Enablement Summary:
    - Executive Summary for the Rep (2-3 sentences, call-ready)
    - Why This Matters to This Prospect (specific to their situation)
    - Talking Points (7-10 concise, conversation-ready)
    - Discovery Questions (5-8 questions to ask on the call)
    - Likely Objections and Responses (3-5 objections with specific responses)
    - Positioning Statement (one paragraph — how PDM uniquely helps this practice)
    - Recommended Next Step (specific action for the rep)

At the very end of your response, output a JSON scores block EXACTLY in this format (no deviation):

\`\`\`json
{
  "marketing_maturity_score": <integer 0-100>,
  "likelihood_to_buy_score": <integer 0-100>,
  "priority_level": "<Low|Moderate|High|Top Priority>",
  "primary_gap_type": "<SEO|Reputation|Video|Authority|Maps>",
  "research_summary": "<one paragraph summary of key findings and opportunity, max 500 chars>"
}
\`\`\``;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildResearchPrompt(
  practiceName: string | undefined,
  city: string | undefined,
  state: string | undefined,
  websiteUrl: string | undefined,
  sfContext: string,
): string {
  const locationStr = [city, state].filter(Boolean).join(', ');
  const identifier = practiceName
    ? `"${practiceName}"${locationStr ? ` in ${locationStr}` : ''}`
    : websiteUrl ?? 'the practice';

  return `Research this dental practice prospect for Progressive Dental Marketing:

**Practice:** ${practiceName ?? 'Unknown — use website to identify'}
**Location:** ${locationStr || 'Unknown — determine from website if possible'}
**Website:** ${websiteUrl ?? 'Search for it'}

${sfContext}

Conduct a thorough web research analysis on ${identifier}. Search for:
- Their website, Google Maps listing, Google reviews
- Their SEO presence (search "dental implants ${locationStr}" and similar queries)
- Competitor practices in the area
- Their social media presence
- Any ads they are running
- Patient reviews and reputation signals

Produce the complete Sales Market Research GPT analysis as instructed in your system prompt. Use real data from your searches. Label any estimates clearly.`;
}

function extractScores(responseText: string): ExtractedScores | null {
  // Find the JSON scores block
  const jsonMatch = responseText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  if (!jsonMatch) return null;

  try {
    const raw = JSON.parse(jsonMatch[1]) as Record<string, unknown>;

    const mms = Number(raw['marketing_maturity_score']);
    const ltb = Number(raw['likelihood_to_buy_score']);
    const pl  = String(raw['priority_level'] ?? '');
    const pgt = String(raw['primary_gap_type'] ?? '');
    const rs  = String(raw['research_summary'] ?? '').slice(0, 500);

    if (
      isNaN(mms) || mms < 0 || mms > 100 ||
      isNaN(ltb) || ltb < 0 || ltb > 100 ||
      !VALID_PRIORITY_LEVELS.includes(pl as PriorityLevel) ||
      !VALID_GAP_TYPES.includes(pgt as GapType)
    ) {
      return null;
    }

    return {
      marketing_maturity_score: Math.round(mms),
      likelihood_to_buy_score:  Math.round(ltb),
      priority_level:           pl as PriorityLevel,
      primary_gap_type:         pgt as GapType,
      research_summary:         rs,
    };
  } catch {
    return null;
  }
}

function formatDate(d: string | null | undefined): string {
  if (!d) return 'Unknown';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

async function handleProspectResearch(rawArgs: unknown): Promise<string> {
  const {
    practiceName,
    city,
    state,
    websiteUrl,
    leadId,
    accountId,
  } = ProspectResearchArgs.parse(rawArgs ?? {});

  // Validate — need at minimum a name or a website
  if (!practiceName && !websiteUrl && !leadId && !accountId) {
    return '❌ Please provide at least a practice name, website URL, or Salesforce record ID.';
  }

  const lines: string[] = [];

  // ── Step 1: Salesforce Pre-Check ─────────────────────────────────────────

  let resolvedLeadId   = leadId;
  let resolvedAccountId = accountId;
  let sfLead: SFLead | null = null;
  let sfAccount: SFAccount | null = null;

  // If direct IDs weren't provided, search by name
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

    if (leadResults.length > 0) {
      sfLead = leadResults[0];
      resolvedLeadId = sfLead.Id;
    }
    if (accountResults.length > 0) {
      sfAccount = accountResults[0];
      resolvedAccountId = sfAccount.Id;
    }
  } else {
    // Fetch the provided IDs
    if (resolvedLeadId) {
      const results = await salesforceService.rawQuery<SFLead>(
        `SELECT Id, Name, Company, Status, OwnerId, Owner.Name,
                LastActivityDate, Website, City, State,
                Marketing_Maturity_Score__c, Likelihood_to_Buy_Score__c,
                Priority_Level__c, Research_Summary__c, Primary_Gap_Type__c
         FROM Lead WHERE Id = '${resolvedLeadId}' LIMIT 1`
      );
      if (results.length > 0) sfLead = results[0];
    }
    if (resolvedAccountId) {
      const results = await salesforceService.rawQuery<SFAccount>(
        `SELECT Id, Name, Status__c, OwnerId, Owner.Name,
                LastActivityDate, Website, BillingCity, BillingState,
                Marketing_Maturity_Score__c, Likelihood_to_Buy_Score__c,
                Priority_Level__c, Research_Summary__c, Primary_Gap_Type__c,
                Baseline_Marketing_Maturity__c
         FROM Account WHERE Id = '${resolvedAccountId}' LIMIT 1`
      );
      if (results.length > 0) sfAccount = results[0];
    }
  }

  // Build SF context string for the research prompt
  let sfContext = '';
  if (sfLead) {
    sfContext += `**Salesforce Lead Record Found:**\n`;
    sfContext += `- Lead ID: ${sfLead.Id}\n`;
    sfContext += `- Name: ${sfLead.Name}\n`;
    sfContext += `- Company: ${sfLead.Company ?? 'Not set'}\n`;
    sfContext += `- Status: ${sfLead.Status ?? 'Unknown'}\n`;
    sfContext += `- Owner: ${(sfLead.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown'}\n`;
    sfContext += `- Last Activity: ${formatDate(sfLead.LastActivityDate)}\n`;
    if (sfLead.Website) sfContext += `- Website on file: ${sfLead.Website}\n`;
    if (sfLead.Marketing_Maturity_Score__c != null) {
      sfContext += `- Previous Maturity Score: ${sfLead.Marketing_Maturity_Score__c}\n`;
      sfContext += `- Previous LTB Score: ${sfLead.Likelihood_to_Buy_Score__c ?? 'N/A'}\n`;
      sfContext += `- Previous Priority: ${sfLead.Priority_Level__c ?? 'N/A'}\n`;
    }
    if (sfLead.Research_Summary__c) {
      sfContext += `- Previous Research Summary: ${sfLead.Research_Summary__c}\n`;
    }
    sfContext += '\n';
  }
  if (sfAccount) {
    sfContext += `**Salesforce Account Record Found (EXISTING CLIENT):**\n`;
    sfContext += `- Account ID: ${sfAccount.Id}\n`;
    sfContext += `- Name: ${sfAccount.Name}\n`;
    sfContext += `- Status: ${sfAccount.Status__c ?? 'Unknown'}\n`;
    sfContext += `- Owner: ${(sfAccount.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown'}\n`;
    sfContext += `- Last Activity: ${formatDate(sfAccount.LastActivityDate)}\n`;
    if (sfAccount.Website) sfContext += `- Website on file: ${sfAccount.Website}\n`;
    if (sfAccount.Baseline_Marketing_Maturity__c != null) {
      sfContext += `- Baseline Maturity (at close): ${sfAccount.Baseline_Marketing_Maturity__c}\n`;
    }
    sfContext += '\n';
  }
  if (!sfLead && !sfAccount) {
    sfContext = '**Salesforce:** No existing Lead or Account record found for this practice. This is a cold prospect.\n\n';
  }

  // ── Step 2: Web Research via Anthropic API ────────────────────────────────

  lines.push(`# 🔍 PDM Sales Market Research`);
  lines.push(`**Practice:** ${practiceName ?? websiteUrl ?? 'Unknown'}`);
  if (city || state) lines.push(`**Location:** ${[city, state].filter(Boolean).join(', ')}`);
  if (websiteUrl) lines.push(`**Website:** ${websiteUrl}`);
  lines.push(`**Generated:** ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
  lines.push('');

  if (sfLead || sfAccount) {
    lines.push('## 📋 Salesforce Record Status');
    if (sfLead) {
      lines.push(`✅ **Lead found:** ${sfLead.Name} (${sfLead.Company ?? ''}) — Owner: ${(sfLead.Owner as { Name?: string } | undefined)?.Name ?? 'Unknown'}`);
      if (sfLead.Marketing_Maturity_Score__c != null) {
        lines.push(`📊 **Prior research on file** — Maturity: ${sfLead.Marketing_Maturity_Score__c}/100 | LTB: ${sfLead.Likelihood_to_Buy_Score__c ?? 'N/A'}/100 | Priority: ${sfLead.Priority_Level__c ?? 'N/A'}`);
        lines.push('*Running fresh research to update scores...*');
      }
    }
    if (sfAccount) {
      lines.push(`⚠️ **EXISTING CLIENT found:** ${sfAccount.Name} — Status: ${sfAccount.Status__c ?? 'Unknown'}`);
      if (sfAccount.Baseline_Marketing_Maturity__c != null) {
        lines.push(`📊 **Baseline maturity at close:** ${sfAccount.Baseline_Marketing_Maturity__c}/100`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  const researchPrompt = buildResearchPrompt(practiceName, city, state, websiteUrl, sfContext);

  // Call Anthropic API with web search, streaming, adaptive thinking
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let researchOutput = '';
  let continueMessages: Anthropic.MessageParam[] = [
    { role: 'user', content: researchPrompt },
  ];

  const MAX_CONTINUATIONS = 5;
  let continuations = 0;

  while (continuations < MAX_CONTINUATIONS) {
    const stream = anthropic.messages.stream({
      model:   'claude-opus-4-6',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system:  RESEARCH_SYSTEM_PROMPT,
      tools:   [{ type: 'web_search_20260209', name: 'web_search' }],
      messages: continueMessages,
    });

    const message = await stream.finalMessage();

    // Collect text from this iteration
    for (const block of message.content) {
      if (block.type === 'text') {
        researchOutput += block.text;
      }
    }

    if (message.stop_reason === 'end_turn') break;

    // Handle pause_turn — server-side tool loop hit iteration limit, continue
    if (message.stop_reason === 'pause_turn') {
      continueMessages.push({ role: 'assistant', content: message.content });
      continuations++;
      continue;
    }

    break;
  }

  if (!researchOutput) {
    lines.push('⚠️ Research did not produce text output. The web search may have been unable to find sufficient data. Please try again or provide a website URL.');
    return lines.join('\n');
  }

  // ── Step 3: Extract Scores ────────────────────────────────────────────────

  const scores = extractScores(researchOutput);

  // Remove the raw JSON scores block from the output (we'll render it nicely)
  const cleanedResearch = researchOutput.replace(/```json[\s\S]*?```\s*$/, '').trim();
  lines.push(cleanedResearch);

  // ── Step 4: Salesforce Write-Back ─────────────────────────────────────────

  const writeErrors: string[] = [];

  if (scores) {
    const scoreFields: Record<string, unknown> = {
      Marketing_Maturity_Score__c: scores.marketing_maturity_score,
      Likelihood_to_Buy_Score__c:  scores.likelihood_to_buy_score,
      Priority_Level__c:           scores.priority_level,
      Primary_Gap_Type__c:         scores.primary_gap_type,
      Research_Summary__c:         scores.research_summary,
    };

    // Auto-create Lead if no existing record found
    if (!resolvedLeadId && !resolvedAccountId) {
      try {
        const newLeadFields: Record<string, unknown> = {
          LastName:   practiceName ?? websiteUrl ?? 'Unknown Practice',
          Company:    practiceName ?? websiteUrl ?? 'Unknown Practice',
          LeadSource: 'PDM Research Tool',
          Status:     'Open - Not Contacted',
        };
        if (city)       newLeadFields['City']    = city;
        if (state)      newLeadFields['State']   = state;
        if (websiteUrl) newLeadFields['Website'] = websiteUrl;

        resolvedLeadId = await salesforceService.createRecord('Lead', newLeadFields);
      } catch (err) {
        writeErrors.push(`Lead create failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Write to Lead
    if (resolvedLeadId) {
      try {
        await salesforceService.updateRecord('Lead', resolvedLeadId, scoreFields);
      } catch (err) {
        writeErrors.push(`Lead update failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Write to Account if found
    if (resolvedAccountId) {
      const accountFields: Record<string, unknown> = { ...scoreFields };
      // Lock Baseline only if it hasn't been set yet
      if (sfAccount && sfAccount.Baseline_Marketing_Maturity__c == null) {
        accountFields['Baseline_Marketing_Maturity__c'] = scores.marketing_maturity_score;
      }
      try {
        await salesforceService.updateRecord('Account', resolvedAccountId, accountFields);
      } catch (err) {
        writeErrors.push(`Account update failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Add score summary section
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 📊 Research Scores Summary');
    lines.push('');
    lines.push(`| Metric | Score |`);
    lines.push(`|---|---|`);
    lines.push(`| Marketing Maturity Score | **${scores.marketing_maturity_score}/100** |`);
    lines.push(`| Likelihood to Buy Score | **${scores.likelihood_to_buy_score}/100** |`);
    lines.push(`| Priority Level | **${scores.priority_level}** |`);
    lines.push(`| Primary Gap Type | **${scores.primary_gap_type}** |`);
    lines.push('');

    const sfStatus: string[] = [];
    if (resolvedLeadId && !writeErrors.some(e => e.startsWith('Lead'))) {
      const wasNew = !sfLead;
      sfStatus.push(`✅ Lead ${resolvedLeadId} ${wasNew ? 'created and scores written' : 'updated'}`);
    }
    if (resolvedAccountId && !writeErrors.some(e => e.startsWith('Account'))) {
      sfStatus.push(`✅ Account ${resolvedAccountId} updated`);
    }
    if (writeErrors.length > 0) {
      writeErrors.forEach(e => sfStatus.push(`❌ ${e}`));
    }

    lines.push('**Salesforce Write-Back:**');
    sfStatus.forEach(s => lines.push(`- ${s}`));
  } else {
    lines.push('');
    lines.push('⚠️ *Could not parse structured scores from research output. Scores were not written to Salesforce. The research content above is still valid.*');
  }

  return lines.join('\n');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const prospectResearchHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_research_prospect: handleProspectResearch,
};
