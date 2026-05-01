/**
 * Event Intelligence System — Prophet by PDM
 *
 * Transforms live event conversations into structured revenue pipeline.
 * Real-time engagement capture → account intelligence → opportunity detection
 * → segmentation → rep performance → event ROI.
 *
 * Architecture:
 *   Telegram (fast input) → Claude NLP (interpretation) → MCP (execution) → Salesforce (record)
 *   Attendees are always existing Contacts (ticket buyers). Claude never creates Contacts.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { salesforceService } from '../services/salesforce.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContactMatch {
  id: string;
  name: string;
  title: string;
  account: string;
  accountId: string;
  city: string;
  state: string;
  email: string;
  phone: string;
  // Account intelligence fields (enriched when available)
  mrr?: number;
  accountStatus?: string;
  services?: string;          // Phase__c multi-select
  tciStatus?: string;
  tciEnrolled?: boolean;
  healthScore?: number;
  healthTier?: string;
  accountOwner?: string;
  isExistingClient?: boolean;
}

interface LogArgs {
  contact_id: string;
  event_id: string;
  engagement_level?: string;
  services_discussed?: string[];
  primary_interest?: string;
  pain_points?: string[];
  buying_signal?: string;
  urgency?: string;
  notes?: string;
  conversation_summary?: string;
  original_message?: string;
  next_step?: string;
  next_step_type?: string;
  follow_up_date?: string;
  follow_up_channel?: string;
  confidence_score?: number;
  interaction_type?: string;
  source?: string;
  create_task?: boolean;
  logged_by_user_id?: string;
  ae_segment?: string;        // Computed segment label for Account Engagement
}

interface SearchContactsArgs {
  name?: string;
  company?: string;
  city?: string;
  state?: string;
  event_id?: string;          // When set, prioritizes known attendees of this event
  limit?: number;
}

interface GetActiveEventsArgs {
  query?: string;
  days_ahead?: number;
}

interface GetEventSummaryArgs {
  event_id: string;
  user_id?: string;
  limit?: number;
}

interface CreateOpportunityArgs {
  contact_id: string;
  account_id: string;
  event_engagement_id: string;
  event_id: string;
  event_name: string;
  services: string[];
  opportunity_name?: string;
  close_date?: string;
  rep_user_id?: string;
}

interface GetRepPerformanceArgs {
  event_id: string;
  limit?: number;
}

interface RecallConversationArgs {
  contact_name?: string;
  contact_id?: string;
  event_id?: string;
}

// ─── Segment Computation ─────────────────────────────────────────────────────
// Determines the Account Engagement segment for a given engagement.
// When AE_Segment__c exists on Contact, this value gets written there.

export function computeAESegment(
  eventName: string,
  engagementLevel: string,
  services: string[]
): string {
  const s = services.map(s => s.toLowerCase());
  const hasTCI = s.some(x => x.includes('tci'));
  const hasPPC = s.some(x => x.includes('ppc') || x.includes('google ads'));
  const hasSEO = s.some(x => x.includes('seo'));
  const hasSocial = s.some(x => x.includes('social'));

  // Use short event prefix (e.g. "FAGC 2026" → "FAGC26", "Vegas Bootcamp" → "Vegas")
  const prefix = eventName.replace(/\s*bootcamp\s*/i, '').replace(/full\s*arch\s*/i, '').trim().slice(0, 20);

  if (engagementLevel === 'Hot' && hasTCI)      return `${prefix} – Hot TCI`;
  if (engagementLevel === 'Hot' && hasPPC)      return `${prefix} – Hot PPC`;
  if (engagementLevel === 'Hot' && hasSEO)      return `${prefix} – Hot SEO`;
  if (engagementLevel === 'Hot' && hasSocial)   return `${prefix} – Hot Social`;
  if (engagementLevel === 'Hot')                return `${prefix} – Hot Prospect`;
  if (engagementLevel === 'Warm')               return `${prefix} – Warm Nurture`;
  if (engagementLevel === 'Existing Client')    return `${prefix} – Existing Client`;
  return `${prefix} – Cold / No Engagement`;
}

// ─── Account Intelligence Fetch ───────────────────────────────────────────────
// Pulls Account intelligence for a contact to enrich confirmation messages.

export async function fetchAccountIntelligence(accountId: string): Promise<{
  status: string;
  mrr: number;
  services: string;
  tciStatus: string;
  tciEnrolled: boolean;
  healthScore: number | null;
  healthTier: string;
  ownerName: string;
  upsellFlag: string;
  isActiveClient: boolean;
}> {
  const ACTIVE_STATUSES = ['Active', 'Renewal', 'Non Renewing', 'Reinstated', 'Delinquent', 'Paused', 'Pending'];

  try {
    const rows = await salesforceService.rawQuery<{
      Status__c: string;
      Total_Monthly_Recurring_Amount__c: number;
      Phase__c: string;
      TCI_Status__c: string;
      TCI_Enrolled__c: boolean;
      Health_Score__c: number;
      Health_Tier__c: string;
      Owner: { Name: string };
      Upsell_Opportunity__c: string;
    }>(
      `SELECT Status__c, Total_Monthly_Recurring_Amount__c, Phase__c,
              TCI_Status__c, TCI_Enrolled__c, Health_Score__c, Health_Tier__c,
              Owner.Name, Upsell_Opportunity__c
       FROM Account WHERE Id = '${accountId}' LIMIT 1`
    );

    if (!rows.length) {
      return { status: '', mrr: 0, services: '', tciStatus: '', tciEnrolled: false, healthScore: null, healthTier: '', ownerName: '', upsellFlag: '', isActiveClient: false };
    }

    const a = rows[0];
    return {
      status:         a.Status__c ?? '',
      mrr:            a.Total_Monthly_Recurring_Amount__c ?? 0,
      services:       a.Phase__c ?? '',
      tciStatus:      a.TCI_Status__c ?? '',
      tciEnrolled:    a.TCI_Enrolled__c ?? false,
      healthScore:    a.Health_Score__c ?? null,
      healthTier:     a.Health_Tier__c ?? '',
      ownerName:      a.Owner?.Name ?? '',
      upsellFlag:     a.Upsell_Opportunity__c ?? '',
      isActiveClient: ACTIVE_STATUSES.includes(a.Status__c ?? ''),
    };
  } catch {
    return { status: '', mrr: 0, services: '', tciStatus: '', tciEnrolled: false, healthScore: null, healthTier: '', ownerName: '', upsellFlag: '', isActiveClient: false };
  }
}

// ─── Build Intelligence Commentary ───────────────────────────────────────────
// Generates the "magic moment" context lines shown after logging.

export function buildAccountIntelCommentary(
  intel: Awaited<ReturnType<typeof fetchAccountIntelligence>>,
  servicesDiscussed: string[]
): { lines: string[]; shouldSuggestOpportunity: boolean; opportunityReason: string } {
  const lines: string[] = [];
  let shouldSuggestOpportunity = false;
  let opportunityReason = '';

  if (!intel.isActiveClient && !intel.status) {
    lines.push(`🆕 <b>New prospect</b> — not in Salesforce as an active client`);
    shouldSuggestOpportunity = true;
    opportunityReason = 'New prospect with no active account';
  } else if (intel.isActiveClient) {
    const mrrStr = intel.mrr > 0 ? ` ($${intel.mrr.toLocaleString()}/mo)` : '';
    lines.push(`⭐ <b>Existing client</b>${mrrStr}`);

    // TCI upsell detection
    const interestedInTCI = servicesDiscussed.some(s => s.toLowerCase().includes('tci'));
    if (interestedInTCI && !intel.tciEnrolled) {
      lines.push(`🎯 <b>Not in TCI</b> — high upsell opportunity`);
      shouldSuggestOpportunity = true;
      opportunityReason = 'Existing client interested in TCI — not currently enrolled';
    }

    // Services gap detection
    const currentServices = (intel.services ?? '').toLowerCase();
    for (const discussed of servicesDiscussed) {
      const d = discussed.toLowerCase();
      if ((d.includes('ppc') || d.includes('google ads')) && !currentServices.includes('ppc')) {
        lines.push(`📈 <b>No PPC</b> — gap vs. their interest`);
        shouldSuggestOpportunity = true;
        opportunityReason = opportunityReason || 'Service gap — interested in services they don\'t have';
      }
      if (d.includes('seo') && !currentServices.includes('seo')) {
        lines.push(`🔍 <b>No SEO</b> — gap vs. their interest`);
        shouldSuggestOpportunity = true;
        opportunityReason = opportunityReason || 'Service gap — interested in SEO';
      }
      if (d.includes('social') && !currentServices.includes('social')) {
        lines.push(`📱 <b>No Social</b> — gap vs. their interest`);
      }
    }

    // Health context
    if (intel.healthTier === 'Critical' || intel.healthTier === 'At Risk') {
      lines.push(`⚠️ Health: <b>${intel.healthTier}</b> (${intel.healthScore}/100) — handle carefully`);
    } else if (intel.healthTier === 'Healthy' && intel.healthScore && intel.healthScore >= 80) {
      lines.push(`🟢 Health: ${intel.healthTier} (${intel.healthScore}/100)`);
    }

    // Owner context
    if (intel.ownerName) {
      lines.push(`👤 Account Manager: ${intel.ownerName}`);
    }
  }

  return { lines, shouldSuggestOpportunity, opportunityReason };
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const eventEngagementTools: Tool[] = [
  {
    name: 'sf_log_event_engagement',
    description:
      'Create an Event_Engagement__c record in Salesforce for a real-time event conversation. ' +
      'Enforces deduplication via Duplicate_Check_Key__c. ' +
      'Creates a follow-up Task if follow_up_date is provided. ' +
      'Returns account intelligence and segment for post-log enrichment.',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id:           { type: 'string' },
        event_id:             { type: 'string' },
        engagement_level:     { type: 'string', enum: ['Hot', 'Warm', 'Cold', 'Existing Client'] },
        services_discussed:   { type: 'array', items: { type: 'string' } },
        primary_interest:     { type: 'string' },
        pain_points:          { type: 'array', items: { type: 'string' } },
        buying_signal:        { type: 'string' },
        urgency:              { type: 'string' },
        notes:                { type: 'string' },
        conversation_summary: { type: 'string' },
        original_message:     { type: 'string' },
        next_step:            { type: 'string' },
        next_step_type:       { type: 'string' },
        follow_up_date:       { type: 'string' },
        follow_up_channel:    { type: 'string' },
        confidence_score:     { type: 'number' },
        interaction_type:     { type: 'string' },
        source:               { type: 'string' },
        create_task:          { type: 'boolean' },
        logged_by_user_id:    { type: 'string' },
        ae_segment:           { type: 'string', description: 'Pre-computed AE segment label' },
      },
      required: ['contact_id', 'event_id'],
    },
  },

  {
    name: 'sf_search_event_contacts',
    description:
      'Search for Contacts in Salesforce by name, company, city, or state. ' +
      'Returns enriched results including MRR, current services, TCI status, and account owner. ' +
      'This context helps reps instantly understand who they are talking to.',
    inputSchema: {
      type: 'object',
      properties: {
        name:     { type: 'string' },
        company:  { type: 'string' },
        city:     { type: 'string' },
        state:    { type: 'string' },
        event_id: { type: 'string', description: 'Optional: prioritize known attendees of this event' },
        limit:    { type: 'number' },
      },
    },
  },

  {
    name: 'sf_get_active_events',
    description: 'List upcoming or recent PDM events (TCI Bootcamps, FAGC, corporate events) for event mode activation.',
    inputSchema: {
      type: 'object',
      properties: {
        query:      { type: 'string' },
        days_ahead: { type: 'number' },
      },
    },
  },

  {
    name: 'sf_get_event_engagement_summary',
    description:
      'Real-time summary of all engagement records for an event. ' +
      'Shows totals by level, top services of interest, follow-up pipeline, and per-rep counts. ' +
      'Use during events for live visibility or post-event for ROI reporting.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        user_id:  { type: 'string' },
        limit:    { type: 'number' },
      },
      required: ['event_id'],
    },
  },

  {
    name: 'sf_create_event_opportunity',
    description:
      'Create a Salesforce Opportunity from an Event_Engagement__c record. ' +
      'Links back to the engagement record, sets stage to Discovery, and assigns to the rep. ' +
      'Called when a Hot lead warrants a formal opportunity.',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id:           { type: 'string' },
        account_id:           { type: 'string' },
        event_engagement_id:  { type: 'string' },
        event_id:             { type: 'string' },
        event_name:           { type: 'string' },
        services:             { type: 'array', items: { type: 'string' } },
        opportunity_name:     { type: 'string', description: 'Override auto-generated name' },
        close_date:           { type: 'string', description: 'YYYY-MM-DD (default: 90 days out)' },
        rep_user_id:          { type: 'string' },
      },
      required: ['contact_id', 'account_id', 'event_engagement_id', 'event_id', 'event_name', 'services'],
    },
  },

  {
    name: 'sf_get_event_rep_performance',
    description:
      'Rep-by-rep performance breakdown for an event. ' +
      'Shows engagements logged, hot leads generated, tasks created, opportunities opened, and pipeline value. ' +
      'Executive-ready reporting — identifies top performers and gaps.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        limit:    { type: 'number', description: 'Max reps to show (default 20)' },
      },
      required: ['event_id'],
    },
  },

  {
    name: 'sf_recall_event_conversation',
    description:
      'Recall what was discussed with a specific contact at an event. ' +
      'Returns the conversation summary, services discussed, next step, and follow-up status. ' +
      'Powers the memory layer — "What did I discuss with Dr. Smith?"',
    inputSchema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string', description: 'Partial or full name to search for' },
        contact_id:   { type: 'string', description: 'Direct Salesforce Contact Id if known' },
        event_id:     { type: 'string', description: 'Scope to a specific event (optional)' },
      },
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleLogEventEngagement(args: unknown): Promise<string> {
  const a = args as LogArgs;
  if (!a.contact_id || !a.event_id) return '❌ contact_id and event_id are required.';

  // ── Deduplication ──────────────────────────────────────────────────────────
  const dupKey = `${a.contact_id}_${a.event_id}`;
  const existing = await salesforceService.rawQuery<{ Id: string; Name: string; Engagement_Level__c: string }>(
    `SELECT Id, Name, Engagement_Level__c FROM Event_Engagement__c
     WHERE Duplicate_Check_Key__c = '${dupKey}' LIMIT 1`
  );
  if (existing.length > 0) {
    return JSON.stringify({
      success: false, duplicate: true,
      existing_id: existing[0].Id,
      message: `Already logged: ${existing[0].Name} (${existing[0].Engagement_Level__c})`,
    });
  }

  // ── Contact + Account info ─────────────────────────────────────────────────
  const contacts = await salesforceService.rawQuery<{
    Id: string; Name: string; Title: string;
    AccountId: string; Account: { Name: string };
    MailingCity: string; MailingState: string;
  }>(
    `SELECT Id, Name, Title, AccountId, Account.Name, MailingCity, MailingState
     FROM Contact WHERE Id = '${a.contact_id}' LIMIT 1`
  );
  const contact = contacts[0];
  if (!contact) return JSON.stringify({ success: false, message: `Contact ${a.contact_id} not found.` });

  const engLevel    = a.engagement_level ?? 'Warm';
  const accountName = contact.Account?.Name ?? '';

  // Fetch account intelligence for the response payload
  let intel: Awaited<ReturnType<typeof fetchAccountIntelligence>> | null = null;
  if (contact.AccountId) {
    intel = await fetchAccountIntelligence(contact.AccountId);
  }

  // Compute AE segment
  const segment = a.ae_segment ?? computeAESegment(
    '',  // event name — populated by caller
    engLevel,
    a.services_discussed ?? []
  );

  // ── Build record ───────────────────────────────────────────────────────────
  const record: Record<string, unknown> = {
    Contact__c:             a.contact_id,
    TCI_Events__c:          a.event_id,
    Duplicate_Check_Key__c: dupKey,
    Engagement_Level__c:    engLevel,
    Source__c:              a.source ?? 'Telegram',
    Interaction_Type__c:    a.interaction_type ?? 'One-on-One',
    Follow_Up_Status__c:    'Not Started',
  };
  if (contact.AccountId)                    record.Account__c              = contact.AccountId;
  if (a.services_discussed?.length)         record.Services_Discussed__c   = a.services_discussed.join(';');
  if (a.pain_points?.length)                record.Pain_Point__c           = a.pain_points.join(';');
  if (a.primary_interest)                   record.Primary_Interest__c     = a.primary_interest;
  if (a.buying_signal)                      record.Buying_Signal__c        = a.buying_signal;
  if (a.urgency)                            record.Urgency__c              = a.urgency;
  if (a.notes)                              record.Notes__c                = a.notes;
  if (a.conversation_summary)               record.Conversation_Summary__c = a.conversation_summary;
  if (a.original_message)                   record.Original_Message__c     = a.original_message;
  if (a.next_step)                          record.Next_Step__c            = a.next_step;
  if (a.next_step_type)                     record.Next_Step_Type__c       = a.next_step_type;
  if (a.follow_up_date)                     record.Follow_Up_Date__c       = a.follow_up_date;
  if (a.follow_up_channel)                  record.Follow_Up_Channel__c    = a.follow_up_channel;
  if (a.confidence_score !== undefined)     record.Confidence_Score__c     = a.confidence_score;
  if (a.logged_by_user_id)                  record.OwnerId                 = a.logged_by_user_id;

  const engagementId = await salesforceService.createRecord('Event_Engagement__c', record);

  // ── Create follow-up Task ──────────────────────────────────────────────────
  let taskId: string | null = null;
  if (a.create_task !== false && a.follow_up_date) {
    try {
      const taskFields: Record<string, unknown> = {
        Subject:      `Event Follow-Up: ${contact.Name}${accountName ? ` — ${accountName}` : ''}`,
        WhoId:        a.contact_id,
        ActivityDate: a.follow_up_date,
        Status:       'Not Started',
        Priority:     engLevel === 'Hot' ? 'High' : 'Normal',
        Description:
          `Event engagement logged via Telegram.\n` +
          `Services: ${a.services_discussed?.join(', ') ?? ''}\n` +
          `Next step: ${a.next_step ?? ''}\n` +
          `Notes: ${a.notes ?? ''}`,
      };
      if (contact.AccountId)   taskFields.WhatId  = contact.AccountId;
      if (a.logged_by_user_id) taskFields.OwnerId = a.logged_by_user_id;

      taskId = await salesforceService.createRecord('Task', taskFields);
      await salesforceService.updateRecord('Event_Engagement__c', engagementId, { Task_Created__c: true });
    } catch (err) {
      process.stderr.write(`[EventEngagement] Task creation failed: ${err}\n`);
    }
  }

  const levelEmoji  = engLevel === 'Hot' ? '🔥' : engLevel === 'Warm' ? '🟡' : engLevel === 'Existing Client' ? '⭐' : '❄️';
  const servicesStr = a.services_discussed?.join(' + ') ?? 'General Interest';
  const taskLine    = taskId ? ` Follow-up task created for ${a.follow_up_date}.` : '';

  return JSON.stringify({
    success:             true,
    engagement_id:       engagementId,
    task_id:             taskId,
    contact_name:        contact.Name,
    account_name:        accountName,
    account_id:          contact.AccountId ?? null,
    engagement_level:    engLevel,
    services_discussed:  a.services_discussed ?? [],
    follow_up_date:      a.follow_up_date ?? null,
    ae_segment:          segment,
    account_intel:       intel,
    confirmation_message:
      `✅ Logged ${contact.Name}${accountName ? ` (${accountName})` : ''} as ${levelEmoji} <b>${engLevel}</b> for <b>${servicesStr}</b>.${taskLine}`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleSearchEventContacts(args: unknown): Promise<string> {
  const a = args as SearchContactsArgs;
  if (!a.name && !a.company && !a.city) {
    return JSON.stringify({ found: 0, contacts: [], message: 'Provide name, company, or city.' });
  }

  const conditions: string[] = [];

  if (a.name) {
    const clean = a.name.replace(/^(dr\.?|mr\.?|ms\.?|mrs\.?|dds\.?|dmd\.?)\s*/i, '').trim();
    const parts = clean.split(/\s+/).filter(p => p.length > 1);
    if (parts.length >= 2) {
      const first = parts[0]; const last = parts[parts.length - 1];
      conditions.push(`(LastName LIKE '%${last}%' OR (FirstName LIKE '%${first}%' AND LastName LIKE '%${last}%'))`);
    } else {
      conditions.push(`(LastName LIKE '%${parts[0]}%' OR FirstName LIKE '%${parts[0]}%')`);
    }
  }
  if (a.company) conditions.push(`Account.Name LIKE '%${a.company}%'`);
  if (a.city)    conditions.push(`(MailingCity LIKE '%${a.city}%' OR Account.BillingCity LIKE '%${a.city}%')`);
  if (a.state)   conditions.push(`(MailingState LIKE '%${a.state}%' OR Account.BillingState LIKE '%${a.state}%')`);

  const limit = Math.min(a.limit ?? 10, 20);
  const soql =
    `SELECT Id, FirstName, LastName, Name, Title, AccountId, Account.Name,
            Account.Status__c, Account.Total_Monthly_Recurring_Amount__c,
            Account.Phase__c, Account.TCI_Status__c, Account.TCI_Enrolled__c,
            Account.Health_Tier__c, Account.Owner.Name,
            Email, Phone, MailingCity, MailingState,
            Account.BillingCity, Account.BillingState
     FROM Contact
     WHERE ${conditions.join(' AND ')} AND IsDeleted = false
     ORDER BY LastName, FirstName LIMIT ${limit}`;

  const ACTIVE_STATUSES = ['Active', 'Renewal', 'Non Renewing', 'Reinstated', 'Delinquent', 'Paused', 'Pending'];

  const rows = await salesforceService.rawQuery<{
    Id: string; Name: string; Title: string; AccountId: string;
    Account: {
      Name: string; Status__c: string; Total_Monthly_Recurring_Amount__c: number;
      Phase__c: string; TCI_Status__c: string; TCI_Enrolled__c: boolean;
      Health_Tier__c: string; Owner: { Name: string };
      BillingCity: string; BillingState: string;
    };
    Email: string; Phone: string; MailingCity: string; MailingState: string;
  }>(soql);

  if (!rows.length) {
    return JSON.stringify({ found: 0, contacts: [], message: `No contacts found.` });
  }

  const contacts: ContactMatch[] = rows.map(r => ({
    id:              r.Id,
    name:            r.Name,
    title:           r.Title ?? '',
    account:         r.Account?.Name ?? '',
    accountId:       r.AccountId ?? '',
    city:            r.MailingCity ?? r.Account?.BillingCity ?? '',
    state:           r.MailingState ?? r.Account?.BillingState ?? '',
    email:           r.Email ?? '',
    phone:           r.Phone ?? '',
    mrr:             r.Account?.Total_Monthly_Recurring_Amount__c ?? 0,
    accountStatus:   r.Account?.Status__c ?? '',
    services:        r.Account?.Phase__c ?? '',
    tciStatus:       r.Account?.TCI_Status__c ?? '',
    tciEnrolled:     r.Account?.TCI_Enrolled__c ?? false,
    healthTier:      r.Account?.Health_Tier__c ?? '',
    accountOwner:    r.Account?.Owner?.Name ?? '',
    isExistingClient: ACTIVE_STATUSES.includes(r.Account?.Status__c ?? ''),
  }));

  return JSON.stringify({ found: contacts.length, contacts });
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleGetActiveEvents(args: unknown): Promise<string> {
  const a = args as GetActiveEventsArgs;
  const daysAhead = a.days_ahead ?? 180;
  const today     = new Date();
  const fromDate  = new Date(today); fromDate.setDate(fromDate.getDate() - 30);
  const toDate    = new Date(today); toDate.setDate(toDate.getDate() + daysAhead);

  const nameFilter = a.query ? `AND Name LIKE '%${a.query}%'` : '';
  const soql =
    `SELECT Id, Name, CreatedDate FROM TCI_Events__c
     WHERE CreatedDate >= ${fromDate.toISOString().split('T')[0]}T00:00:00Z
       AND CreatedDate <= ${toDate.toISOString().split('T')[0]}T23:59:59Z
       ${nameFilter}
     ORDER BY CreatedDate DESC LIMIT 25`;

  try {
    const rows = await salesforceService.rawQuery<{ Id: string; Name: string; CreatedDate: string }>(soql);
    if (!rows.length) return JSON.stringify({ found: 0, events: [], message: `No events found.` });
    return JSON.stringify({ found: rows.length, events: rows.map(r => ({ id: r.Id, name: r.Name, created_date: r.CreatedDate?.split('T')[0] ?? '' })) });
  } catch (err) {
    return JSON.stringify({ found: 0, events: [], error: err instanceof Error ? err.message : String(err) });
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleGetEventEngagementSummary(args: unknown): Promise<string> {
  const a = args as GetEventSummaryArgs;
  if (!a.event_id) return '❌ event_id is required.';

  const userFilter = a.user_id ? `AND OwnerId = '${a.user_id}'` : '';
  const limit      = a.limit ?? 50;

  const [engagements, event] = await Promise.all([
    salesforceService.rawQuery<{
      Id: string; Contact__r: { Name: string; Account: { Name: string } };
      Engagement_Level__c: string; Services_Discussed__c: string;
      Follow_Up_Date__c: string; Follow_Up_Status__c: string;
      Task_Created__c: boolean; Opportunity_Created__c: boolean;
      Revenue_Influence__c: number; CreatedDate: string; Owner: { Name: string };
    }>(
      `SELECT Id, Contact__r.Name, Contact__r.Account.Name,
              Engagement_Level__c, Services_Discussed__c,
              Follow_Up_Date__c, Follow_Up_Status__c,
              Task_Created__c, Opportunity_Created__c,
              Revenue_Influence__c, CreatedDate, Owner.Name
       FROM Event_Engagement__c
       WHERE TCI_Events__c = '${a.event_id}' ${userFilter}
       ORDER BY CreatedDate DESC LIMIT ${limit}`
    ),
    salesforceService.rawQuery<{ Id: string; Name: string }>(
      `SELECT Id, Name FROM TCI_Events__c WHERE Id = '${a.event_id}' LIMIT 1`
    ),
  ]);

  const eventName = event[0]?.Name ?? a.event_id;
  if (!engagements.length) return `📋 No engagements logged for <b>${eventName}</b> yet.`;

  const tally: Record<string, number> = {};
  const serviceMap: Record<string, number> = {};
  const repMap: Record<string, number> = {};
  let hotCount = 0; let taskCount = 0; let oppCount = 0; let totalRevenue = 0;

  for (const e of engagements) {
    const level = e.Engagement_Level__c ?? 'Unknown';
    tally[level] = (tally[level] ?? 0) + 1;
    if (level === 'Hot') hotCount++;
    if (e.Task_Created__c) taskCount++;
    if (e.Opportunity_Created__c) oppCount++;
    if (e.Revenue_Influence__c) totalRevenue += e.Revenue_Influence__c;
    const rep = e.Owner?.Name ?? 'Unknown';
    repMap[rep] = (repMap[rep] ?? 0) + 1;
    for (const s of (e.Services_Discussed__c ?? '').split(';').map(x => x.trim()).filter(Boolean)) {
      serviceMap[s] = (serviceMap[s] ?? 0) + 1;
    }
  }

  const levelBreakdown = Object.entries(tally).sort(([,a],[,b]) => b - a)
    .map(([lv, ct]) => {
      const em = lv === 'Hot' ? '🔥' : lv === 'Warm' ? '🟡' : lv === 'Existing Client' ? '⭐' : '❄️';
      return `${em} ${lv}: ${ct}`;
    }).join(' | ');

  const topServices = Object.entries(serviceMap).sort(([,a],[,b]) => b-a).slice(0,6)
    .map(([s,ct]) => `${s} (${ct})`).join(', ');

  const topReps = Object.entries(repMap).sort(([,a],[,b]) => b-a).slice(0,5)
    .map(([r,ct]) => `${r}: ${ct}`).join(' | ');

  const detailLines = engagements.slice(0, 15).map(e => {
    const contact  = e.Contact__r?.Name ?? '?';
    const account  = e.Contact__r?.Account?.Name ?? '';
    const level    = e.Engagement_Level__c ?? '';
    const em       = level === 'Hot' ? '🔥' : level === 'Warm' ? '🟡' : level === 'Existing Client' ? '⭐' : '❄️';
    const services = (e.Services_Discussed__c ?? '').replace(/;/g, ', ');
    const rep      = e.Owner?.Name ?? '';
    const dt       = e.CreatedDate?.split('T')[0] ?? '';
    return `${em} ${contact}${account ? ` — ${account}` : ''} | ${services || 'General'} | ${rep} | ${dt}`;
  });

  const lines = [
    `📊 <b>Event Intelligence — ${eventName}</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `<b>Total Logged:</b> ${engagements.length} | 🔥 Hot: ${hotCount} | Tasks: ${taskCount} | Opps: ${oppCount}`,
    totalRevenue > 0 ? `<b>Revenue Influence:</b> $${totalRevenue.toLocaleString()}` : '',
    ``,
    `<b>By Level:</b> ${levelBreakdown}`,
    topServices ? `<b>Top Interests:</b> ${topServices}` : '',
    topReps ? `<b>Rep Activity:</b> ${topReps}` : '',
    ``,
    `<b>Recent Logs:</b>`,
    ...detailLines,
    engagements.length > 15 ? `\n<i>...and ${engagements.length - 15} more</i>` : '',
  ].filter(l => l !== '');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleCreateEventOpportunity(args: unknown): Promise<string> {
  const a = args as CreateOpportunityArgs;
  if (!a.contact_id || !a.account_id || !a.event_engagement_id) {
    return '❌ contact_id, account_id, and event_engagement_id are required.';
  }

  // Build opportunity name
  const accountRows = await salesforceService.rawQuery<{ Name: string }>(
    `SELECT Name FROM Account WHERE Id = '${a.account_id}' LIMIT 1`
  );
  const accountName = accountRows[0]?.Name ?? 'Unknown Account';
  const serviceStr  = a.services.slice(0, 2).join(' + ');
  const oppName     = a.opportunity_name ?? `${accountName} — ${serviceStr} (${a.event_name})`;

  // Default close date: 90 days out
  const closeDate = a.close_date ?? (() => {
    const d = new Date(); d.setDate(d.getDate() + 90);
    return d.toISOString().split('T')[0];
  })();

  const oppFields: Record<string, unknown> = {
    Name:        oppName,
    AccountId:   a.account_id,
    ContactId:   a.contact_id,
    StageName:   'Discovery',
    CloseDate:   closeDate,
    Description: `Created from event engagement at ${a.event_name}. Services of interest: ${a.services.join(', ')}.`,
    LeadSource:  'Event',
  };
  if (a.rep_user_id) oppFields.OwnerId = a.rep_user_id;

  const oppId = await salesforceService.createRecord('Opportunity', oppFields);

  // Link back to engagement record
  await salesforceService.updateRecord('Event_Engagement__c', a.event_engagement_id, {
    Opportunity__c:          oppId,
    Opportunity_Created__c:  true,
  });

  return JSON.stringify({
    success:          true,
    opportunity_id:   oppId,
    opportunity_name: oppName,
    close_date:       closeDate,
    message:          `✅ Opportunity created: <b>${oppName}</b> | Stage: Discovery | Close: ${closeDate}`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleGetEventRepPerformance(args: unknown): Promise<string> {
  const a = args as GetRepPerformanceArgs;
  if (!a.event_id) return '❌ event_id is required.';

  const [engagements, event] = await Promise.all([
    salesforceService.rawQuery<{
      Engagement_Level__c: string; Task_Created__c: boolean;
      Opportunity_Created__c: boolean; Revenue_Influence__c: number;
      Follow_Up_Status__c: string; Owner: { Id: string; Name: string };
    }>(
      `SELECT Engagement_Level__c, Task_Created__c, Opportunity_Created__c,
              Revenue_Influence__c, Follow_Up_Status__c, Owner.Id, Owner.Name
       FROM Event_Engagement__c
       WHERE TCI_Events__c = '${a.event_id}'
       ORDER BY Owner.Name`
    ),
    salesforceService.rawQuery<{ Name: string }>(
      `SELECT Name FROM TCI_Events__c WHERE Id = '${a.event_id}' LIMIT 1`
    ),
  ]);

  const eventName = event[0]?.Name ?? a.event_id;
  if (!engagements.length) return `No engagement data yet for <b>${eventName}</b>.`;

  // Aggregate by rep
  const repStats: Record<string, {
    name: string; total: number; hot: number; warm: number; cold: number;
    tasks: number; opps: number; revenue: number; followedUp: number;
  }> = {};

  for (const e of engagements) {
    const repId   = e.Owner?.Id ?? 'unknown';
    const repName = e.Owner?.Name ?? 'Unknown';
    if (!repStats[repId]) {
      repStats[repId] = { name: repName, total: 0, hot: 0, warm: 0, cold: 0, tasks: 0, opps: 0, revenue: 0, followedUp: 0 };
    }
    const s = repStats[repId];
    s.total++;
    if (e.Engagement_Level__c === 'Hot')  s.hot++;
    if (e.Engagement_Level__c === 'Warm') s.warm++;
    if (e.Engagement_Level__c === 'Cold') s.cold++;
    if (e.Task_Created__c)                s.tasks++;
    if (e.Opportunity_Created__c)         s.opps++;
    if (e.Revenue_Influence__c)           s.revenue += e.Revenue_Influence__c;
    if (e.Follow_Up_Status__c === 'Complete') s.followedUp++;
  }

  // Sort by hot leads, then total
  const sorted = Object.values(repStats).sort((a, b) => b.hot - a.hot || b.total - a.total);

  const lines: string[] = [
    `🏆 <b>Rep Performance — ${eventName}</b>`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `<b>Total logged:</b> ${engagements.length} engagements by ${sorted.length} reps`,
    ``,
  ];

  sorted.slice(0, a.limit ?? 20).forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const revenueStr = r.revenue > 0 ? ` | $${r.revenue.toLocaleString()} pipeline` : '';
    lines.push(
      `${medal} <b>${r.name}</b> — ${r.total} logged | 🔥 ${r.hot} hot | Tasks: ${r.tasks} | Opps: ${r.opps}${revenueStr}`
    );
  });

  // Highlight gaps
  const noFollowUp = sorted.filter(r => r.hot > 0 && r.tasks === 0);
  if (noFollowUp.length) {
    lines.push(`\n⚠️ <b>Hot leads with no task:</b> ${noFollowUp.map(r => r.name).join(', ')}`);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleRecallEventConversation(args: unknown): Promise<string> {
  const a = args as RecallConversationArgs;
  if (!a.contact_name && !a.contact_id) return '❌ Provide contact_name or contact_id.';

  // Resolve contact_id from name if needed
  let contactId = a.contact_id;
  let contactName = '';

  if (!contactId && a.contact_name) {
    const clean = a.contact_name.replace(/^(dr\.?|mr\.?|ms\.?|mrs\.?)\s*/i, '').trim();
    const parts = clean.split(/\s+/).filter(p => p.length > 1);
    const nameCondition = parts.length >= 2
      ? `(LastName LIKE '%${parts[parts.length-1]}%' AND FirstName LIKE '%${parts[0]}%')`
      : `(LastName LIKE '%${parts[0]}%' OR FirstName LIKE '%${parts[0]}%')`;

    const found = await salesforceService.rawQuery<{ Id: string; Name: string }>(
      `SELECT Id, Name FROM Contact WHERE ${nameCondition} AND IsDeleted = false LIMIT 3`
    );
    if (!found.length) return `No contact found matching "${a.contact_name}".`;
    contactId   = found[0].Id;
    contactName = found[0].Name;
  }

  const eventFilter = a.event_id ? `AND TCI_Events__c = '${a.event_id}'` : '';

  const engagements = await salesforceService.rawQuery<{
    Id: string;
    TCI_Events__r: { Name: string };
    Engagement_Level__c: string;
    Services_Discussed__c: string;
    Conversation_Summary__c: string;
    Original_Message__c: string;
    Notes__c: string;
    Next_Step__c: string;
    Follow_Up_Date__c: string;
    Follow_Up_Status__c: string;
    Opportunity_Created__c: boolean;
    CreatedDate: string;
    Owner: { Name: string };
  }>(
    `SELECT Id, TCI_Events__r.Name, Engagement_Level__c, Services_Discussed__c,
            Conversation_Summary__c, Original_Message__c, Notes__c,
            Next_Step__c, Follow_Up_Date__c, Follow_Up_Status__c,
            Opportunity_Created__c, CreatedDate, Owner.Name
     FROM Event_Engagement__c
     WHERE Contact__c = '${contactId}' ${eventFilter}
     ORDER BY CreatedDate DESC LIMIT 5`
  );

  if (!engagements.length) {
    return `No event engagement records found for ${contactName || contactId}${a.event_id ? ' at this event' : ''}.`;
  }

  const lines: string[] = [`🧠 <b>Memory — ${contactName || 'Contact'}</b>`, ``];

  for (const e of engagements) {
    const eventNm  = e.TCI_Events__r?.Name ?? 'Unknown Event';
    const level    = e.Engagement_Level__c ?? '';
    const em       = level === 'Hot' ? '🔥' : level === 'Warm' ? '🟡' : '❄️';
    const services = (e.Services_Discussed__c ?? '').replace(/;/g, ', ');
    const dt       = e.CreatedDate?.split('T')[0] ?? '';
    const loggedBy = e.Owner?.Name ?? '';

    lines.push(`<b>${eventNm}</b> — ${em} ${level} | ${dt} | Logged by ${loggedBy}`);
    if (e.Conversation_Summary__c) lines.push(`📝 ${e.Conversation_Summary__c}`);
    if (services)                  lines.push(`🎯 Services: ${services}`);
    if (e.Notes__c)                lines.push(`💬 Notes: ${e.Notes__c}`);
    if (e.Next_Step__c)            lines.push(`👉 Next step: ${e.Next_Step__c}`);
    if (e.Follow_Up_Date__c)       lines.push(`📅 Follow-up: ${e.Follow_Up_Date__c} (${e.Follow_Up_Status__c ?? 'Not Started'})`);
    if (e.Opportunity_Created__c)  lines.push(`💰 Opportunity created`);
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ─── Handler Registry ─────────────────────────────────────────────────────────

export const eventEngagementHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_log_event_engagement:          handleLogEventEngagement,
  sf_search_event_contacts:         handleSearchEventContacts,
  sf_get_active_events:             handleGetActiveEvents,
  sf_get_event_engagement_summary:  handleGetEventEngagementSummary,
  sf_create_event_opportunity:      handleCreateEventOpportunity,
  sf_get_event_rep_performance:     handleGetEventRepPerformance,
  sf_recall_event_conversation:     handleRecallEventConversation,
};
