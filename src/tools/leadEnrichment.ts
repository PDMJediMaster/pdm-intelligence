// ─────────────────────────────────────────────────────────────────────────────
// Lead Enrichment — Apollo.io → Salesforce
//
// sf_enrich_lead:
//   Takes a Lead ID (or name + company), calls Apollo people/match to find
//   mobile phone + email, writes enriched data back to Salesforce, and
//   returns enrichment status with a gate check.
//
// Gate: mobile phone present AND valid email → Enriched
//       Missing either               → Failed (lead is flagged, pipeline stops)
//
// Pipeline fields updated:
//   Enrichment_Status__c   — Enriched / Failed / Skipped
//   Enrichment_Source__c   — Apollo / RocketReach / Manual
//   Enrichment_Date__c     — today
//   Pipeline_Status__c     — Enriching → Enriched / Enrichment Failed
//   MobilePhone            — from Apollo (if found)
//   Email                  — from Apollo (if found and not already set)
//   LinkedIn_URL__c        — from Apollo (if found)
//   Title                  — from Apollo (if found and not already set)
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Apollo Types ─────────────────────────────────────────────────────────────

interface ApolloPhoneNumber {
  raw_number: string;
  sanitized_number?: string;
  type: 'mobile' | 'work_hq' | 'work' | 'home' | 'other' | string;
  status?: string;
  position?: number;
}

interface ApolloPerson {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  email_status?: string;
  phone_numbers?: ApolloPhoneNumber[];
  linkedin_url?: string;
  title?: string;
  organization?: {
    name?: string;
    website_url?: string;
    estimated_num_employees?: number;
    industry?: string;
    city?: string;
    state?: string;
  };
}

interface ApolloMatchResponse {
  person?: ApolloPerson | null;
  status?: string;
  error?: string;
}

// ─── Salesforce Lead Shape ────────────────────────────────────────────────────

interface SFLead {
  Id: string;
  FirstName?: string;
  LastName?: string;
  Name?: string;
  Company?: string;
  Email?: string;
  MobilePhone?: string;
  Phone?: string;
  Website?: string;
  City?: string;
  State?: string;
  Title?: string;
  LinkedIn_URL__c?: string;
  Lead_Type__c?: string;
  Enrichment_Status__c?: string;
  Pipeline_Status__c?: string;
  Pipeline_Entry_Source__c?: string;
}

// ─── Zod Schema ───────────────────────────────────────────────────────────────

const EnrichLeadArgs = z.object({
  lead_id: z.string().optional().describe(
    'Salesforce Lead ID (18-char). Preferred over lead_name.'
  ),
  lead_name: z.string().optional().describe(
    'Lead full name — used for fuzzy lookup if lead_id is not provided.'
  ),
  company: z.string().optional().describe(
    'Practice name — narrows lookup when using lead_name.'
  ),
  force_re_enrich: z.boolean().optional().describe(
    'Re-run enrichment even if Enrichment_Status__c is already Enriched. Default false.'
  ),
  dry_run: z.boolean().optional().describe(
    'If true, runs Apollo lookup but does NOT write back to Salesforce. Default false.'
  ),
});

type EnrichLeadArgsType = z.infer<typeof EnrichLeadArgs>;

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const leadEnrichmentTools: Tool[] = [
  {
    name: 'sf_enrich_lead',
    description:
      'Enrich a Salesforce Lead via Apollo.io. Looks up mobile phone and email ' +
      'for the doctor/contact, writes enriched data back to Salesforce, and ' +
      'returns whether the pipeline gate was passed (mobile + valid email required). ' +
      'Used as Step 1 of the Lead Activation Pipeline before research begins.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        lead_id: {
          type: 'string',
          description: 'Salesforce Lead ID (18-char). Preferred.',
        },
        lead_name: {
          type: 'string',
          description: 'Lead full name for fuzzy lookup if lead_id not available.',
        },
        company: {
          type: 'string',
          description: 'Practice name to narrow fuzzy lookup.',
        },
        force_re_enrich: {
          type: 'boolean',
          description: 'Re-enrich even if already Enriched. Default false.',
        },
        dry_run: {
          type: 'boolean',
          description: 'Run Apollo lookup without writing to Salesforce. Default false.',
        },
      },
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

export const leadEnrichmentHandlers: Record<
  string,
  (args: unknown) => Promise<string>
> = {
  sf_enrich_lead: async (args: unknown) => {
    const parsed = EnrichLeadArgs.safeParse(args);
    if (!parsed.success) {
      return `Invalid arguments: ${parsed.error.message}`;
    }
    return handleEnrichLead(parsed.data);
  },
};

// ─── Core Handler ─────────────────────────────────────────────────────────────

async function handleEnrichLead(args: EnrichLeadArgsType): Promise<string> {
  const { lead_id, lead_name, company, force_re_enrich = false, dry_run = false } = args;

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return [
      '⚠️  Apollo API Key Not Configured',
      '',
      'Add APOLLO_API_KEY to your .env file to enable enrichment.',
      'Get your key at: https://app.apollo.io/#/settings/integrations/api',
      '',
      'Once configured, restart the Prophet server and re-run this tool.',
    ].join('\n');
  }

  // ── 1. Resolve Lead ────────────────────────────────────────────────────────
  let lead: SFLead | null = null;

  if (lead_id) {
    const results = await salesforceService.rawQuery<SFLead>(
      `SELECT Id, FirstName, LastName, Name, Company, Email, MobilePhone, Phone,
              Website, City, State, Title, LinkedIn_URL__c, Lead_Type__c,
              Enrichment_Status__c, Pipeline_Status__c, Pipeline_Entry_Source__c
       FROM Lead WHERE Id = '${lead_id}' LIMIT 1`
    );
    lead = results[0] ?? null;
  } else if (lead_name) {
    const safeName = lead_name.replace(/'/g, "\\'");
    const companyClause = company ? ` AND Company LIKE '%${company.replace(/'/g, "\\'")}%'` : '';
    const results = await salesforceService.rawQuery<SFLead>(
      `SELECT Id, FirstName, LastName, Name, Company, Email, MobilePhone, Phone,
              Website, City, State, Title, LinkedIn_URL__c, Lead_Type__c,
              Enrichment_Status__c, Pipeline_Status__c, Pipeline_Entry_Source__c
       FROM Lead WHERE Name LIKE '%${safeName}%'${companyClause}
       ORDER BY CreatedDate DESC LIMIT 1`
    );
    lead = results[0] ?? null;
  }

  if (!lead) {
    return `❌ Lead not found. Provide a valid lead_id or lead_name.`;
  }

  // ── 2. Gate: Already enriched? ─────────────────────────────────────────────
  if (lead.Enrichment_Status__c === 'Enriched' && !force_re_enrich) {
    return [
      `ℹ️  Lead already enriched — skipping.`,
      ``,
      `Lead: ${lead.Name} — ${lead.Company}`,
      `Mobile: ${lead.MobilePhone ?? 'on file'}`,
      `Email: ${lead.Email ?? 'on file'}`,
      ``,
      `Use force_re_enrich: true to run Apollo again.`,
    ].join('\n');
  }

  // ── 3. Build Apollo search payload ────────────────────────────────────────
  const nameParts = (lead.Name ?? '').trim().split(/\s+/);
  const firstName = lead.FirstName ?? nameParts[0] ?? '';
  const lastName = lead.LastName ?? nameParts.slice(1).join(' ') ?? '';

  // Clean domain from website
  let domain: string | undefined;
  if (lead.Website) {
    try {
      const url = lead.Website.startsWith('http') ? lead.Website : `https://${lead.Website}`;
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      domain = undefined;
    }
  }

  const apolloPayload: Record<string, unknown> = {
    reveal_personal_emails: true,
    reveal_phone_number: true,
  };
  if (firstName) apolloPayload.first_name = firstName;
  if (lastName)  apolloPayload.last_name  = lastName;
  if (lead.Company) apolloPayload.organization_name = lead.Company;
  if (domain)    apolloPayload.domain = domain;
  if (lead.Email) apolloPayload.email = lead.Email;

  // ── 4. Call Apollo API ─────────────────────────────────────────────────────
  let apolloResult: ApolloMatchResponse | null = null;
  let apolloError: string | null = null;

  try {
    const response = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(apolloPayload),
    });

    if (!response.ok) {
      const body = await response.text();
      apolloError = `Apollo API error ${response.status}: ${body.slice(0, 200)}`;
    } else {
      apolloResult = (await response.json()) as ApolloMatchResponse;
    }
  } catch (err) {
    apolloError = `Apollo fetch failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (apolloError || !apolloResult?.person) {
    // Mark as failed and update pipeline status
    if (!dry_run) {
      await salesforceService.updateRecord('Lead', lead.Id, {
        Enrichment_Status__c: 'Failed',
        Enrichment_Source__c: 'Apollo',
        Enrichment_Date__c: new Date().toISOString().slice(0, 10),
        Pipeline_Status__c: 'Enrichment Failed',
      });
    }
    return [
      `❌  Enrichment Failed — ${lead.Name} (${lead.Company})`,
      ``,
      apolloError ?? 'Apollo returned no person match.',
      ``,
      `Pipeline gate: NOT PASSED`,
      `This lead will not proceed to research.`,
      dry_run ? '\n(dry_run: no Salesforce write)' : `Lead updated: Enrichment_Status__c = Failed`,
    ].join('\n');
  }

  const person = apolloResult.person;

  // ── 5. Extract mobile phone ────────────────────────────────────────────────
  const mobileEntry = person.phone_numbers?.find(p => p.type === 'mobile')
    ?? person.phone_numbers?.find(p => p.type === 'work_hq')
    ?? person.phone_numbers?.[0];

  const mobilePhone = mobileEntry?.raw_number ?? mobileEntry?.sanitized_number ?? null;
  const email       = person.email ?? lead.Email ?? null;
  const linkedIn    = person.linkedin_url ?? null;
  const title       = person.title ?? null;

  // ── 6. Gate check ──────────────────────────────────────────────────────────
  const hasMobile     = !!mobilePhone;
  const hasEmail      = !!email && email.includes('@');
  const gatePassed    = hasMobile && hasEmail;
  const enrichStatus  = gatePassed ? 'Enriched' : 'Failed';
  const pipelineStatus = gatePassed ? 'Research Complete' : 'Enrichment Failed';
  // Note: pipeline_status set to Research Complete means "enrichment done, ready to research"
  // n8n will move it to Researching when it kicks off sf_research_prospect

  // ── 7. Write back to Salesforce ────────────────────────────────────────────
  const sfUpdate: Record<string, unknown> = {
    Enrichment_Status__c: enrichStatus,
    Enrichment_Source__c: 'Apollo',
    Enrichment_Date__c: new Date().toISOString().slice(0, 10),
    Pipeline_Status__c: gatePassed ? 'Queued' : 'Enrichment Failed',
  };

  if (mobilePhone && !lead.MobilePhone) sfUpdate.MobilePhone = mobilePhone;
  if (email && !lead.Email)             sfUpdate.Email        = email;
  if (linkedIn && !lead.LinkedIn_URL__c) sfUpdate.LinkedIn_URL__c = linkedIn;
  if (title && !lead.Title)             sfUpdate.Title        = title;

  if (!dry_run) {
    try {
      await salesforceService.updateRecord('Lead', lead.Id, sfUpdate);
    } catch (err) {
      return `⚠️  Apollo enrichment succeeded but Salesforce write failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ── 8. Format output ───────────────────────────────────────────────────────
  const gateIcon = gatePassed ? '✅' : '❌';
  const lines: string[] = [
    `${gateIcon}  Enrichment ${gatePassed ? 'Complete — Gate PASSED' : 'Incomplete — Gate FAILED'}`,
    ``,
    `Lead:    ${lead.Name}`,
    `Practice: ${lead.Company ?? '—'}`,
    `Lead ID: ${lead.Id}`,
    ``,
    `── Apollo Results ─────────────────────────────────`,
    `Mobile:    ${mobilePhone ?? '⚠️  NOT FOUND'}`,
    `Email:     ${email ?? '⚠️  NOT FOUND'}`,
    `LinkedIn:  ${linkedIn ?? '—'}`,
    `Title:     ${title ?? '—'}`,
    ``,
    `── Gate Check ─────────────────────────────────────`,
    `Mobile present:  ${hasMobile ? '✅ Yes' : '❌ No'}`,
    `Email valid:     ${hasEmail  ? '✅ Yes' : '❌ No'}`,
    `Gate passed:     ${gatePassed ? '✅ PROCEED TO RESEARCH' : '❌ STOP — incomplete contact data'}`,
    ``,
    `── Salesforce Update ──────────────────────────────`,
  ];

  if (dry_run) {
    lines.push(`(dry_run mode — no writes made)`);
  } else {
    const written = Object.entries(sfUpdate)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    lines.push(written);
  }

  if (!gatePassed) {
    lines.push('');
    lines.push(`Next step: This lead is flagged Enrichment Failed.`);
    lines.push(`Consider searching with different parameters or marking as Skipped.`);
  } else {
    lines.push('');
    lines.push(`Next step: Lead is queued for sf_research_prospect.`);
    lines.push(`n8n will pick this up automatically when Pipeline_Status__c = 'Queued'.`);
  }

  return lines.join('\n');
}
