/**
 * Event Engagement Tools — Prophet by PDM
 *
 * Powers real-time event engagement logging via Telegram + Claude.
 * Attendees are always existing Contacts in Salesforce (ticket buyers).
 * Claude interprets natural language → structured Event_Engagement__c records.
 *
 * Objects: Event_Engagement__c, TCI_Events__c, Contact, Task
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { salesforceService } from '../services/salesforce.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContactMatch {
  id: string;
  name: string;
  title: string;
  account: string;
  accountId: string;
  city: string;
  state: string;
  email: string;
  phone: string;
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
}

interface SearchContactsArgs {
  name?: string;
  company?: string;
  city?: string;
  state?: string;
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

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const eventEngagementTools: Tool[] = [
  {
    name: 'sf_log_event_engagement',
    description:
      'Create an Event_Engagement__c record in Salesforce for a real-time event conversation. ' +
      'Used by the Telegram event logging flow after a Contact has been confirmed. ' +
      'Also creates a follow-up Task if follow_up_date is provided. ' +
      'Enforces deduplication — will not create a second record for the same Contact+Event.',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id:          { type: 'string', description: 'Confirmed Salesforce Contact Id' },
        event_id:            { type: 'string', description: 'TCI_Events__c record Id (active event)' },
        engagement_level:    { type: 'string', enum: ['Hot', 'Warm', 'Cold', 'Existing Client'], description: 'Rep-assessed engagement level' },
        services_discussed:  { type: 'array', items: { type: 'string' }, description: 'PDM services mentioned (PPC, SEO, Social Media, Video Production, etc.)' },
        primary_interest:    { type: 'string', description: 'Single most important service interest' },
        pain_points:         { type: 'array', items: { type: 'string' }, description: 'Pain points the prospect described' },
        buying_signal:       { type: 'string', description: 'Specific buying signal detected' },
        urgency:             { type: 'string', description: 'Timeframe or urgency expressed' },
        notes:               { type: 'string', description: 'Additional context from the conversation' },
        conversation_summary:{ type: 'string', description: 'Claude-generated summary of the conversation' },
        original_message:    { type: 'string', description: 'Original raw message from the rep' },
        next_step:           { type: 'string', description: 'Agreed next action (e.g. "Schedule discovery call")' },
        next_step_type:      { type: 'string', description: 'Category of next step (Call, Email, Demo, etc.)' },
        follow_up_date:      { type: 'string', description: 'Follow-up date in YYYY-MM-DD format' },
        follow_up_channel:   { type: 'string', description: 'How to follow up: Phone, Email, Text, LinkedIn' },
        confidence_score:    { type: 'number', description: 'Rep or AI confidence score 0–99' },
        interaction_type:    { type: 'string', description: 'How the conversation happened (One-on-One, Booth Visit, Breakout, etc.)' },
        source:              { type: 'string', description: 'Logging source (default: Telegram)' },
        create_task:         { type: 'boolean', description: 'Whether to create a follow-up Task (default: true when follow_up_date provided)' },
        logged_by_user_id:   { type: 'string', description: 'Salesforce User Id of the rep who logged this' },
      },
      required: ['contact_id', 'event_id'],
    },
  },

  {
    name: 'sf_search_event_contacts',
    description:
      'Search for Contacts in Salesforce by name, company, city, or state. ' +
      'Used during event logging to find the right attendee before creating an engagement record. ' +
      'Returns up to 10 matches with name, title, account, and location.',
    inputSchema: {
      type: 'object',
      properties: {
        name:    { type: 'string', description: 'Full or partial name of the contact (e.g. "Dr. Smith" or "Smith")' },
        company: { type: 'string', description: 'Practice or company name (partial match)' },
        city:    { type: 'string', description: 'City to narrow search' },
        state:   { type: 'string', description: 'State (2-letter code or full name)' },
        limit:   { type: 'number', description: 'Max results to return (default 10, max 20)' },
      },
    },
  },

  {
    name: 'sf_get_active_events',
    description:
      'List upcoming or recently concluded PDM events (TCI Bootcamps, FAGC, corporate events) ' +
      'that can be set as the active event for Telegram-based logging. ' +
      'Returns event Id, name, and date — required to start event mode.',
    inputSchema: {
      type: 'object',
      properties: {
        query:      { type: 'string', description: 'Optional: filter by event name (e.g. "FAGC" or "Vegas")' },
        days_ahead: { type: 'number', description: 'How many days ahead to look (default 180)' },
      },
    },
  },

  {
    name: 'sf_get_event_engagement_summary',
    description:
      'Summary of all engagement records logged for a specific event. ' +
      'Shows total logged, breakdown by engagement level, services of interest, ' +
      'and follow-up pipeline value. Optionally filtered to a specific rep.',
    inputSchema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'TCI_Events__c record Id' },
        user_id:  { type: 'string', description: 'Optional: filter to a specific Salesforce User Id' },
        limit:    { type: 'number', description: 'Max engagement records to return in detail list (default 50)' },
      },
      required: ['event_id'],
    },
  },
];

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleLogEventEngagement(args: unknown): Promise<string> {
  const a = args as LogArgs;

  if (!a.contact_id || !a.event_id) {
    return '❌ contact_id and event_id are required to log an event engagement.';
  }

  // ── Deduplication check ────────────────────────────────────────────────────
  const dupKey = `${a.contact_id}_${a.event_id}`;
  const existing = await salesforceService.rawQuery<{ Id: string; Name: string; Engagement_Level__c: string }>(
    `SELECT Id, Name, Engagement_Level__c FROM Event_Engagement__c
     WHERE Duplicate_Check_Key__c = '${dupKey}' LIMIT 1`
  );

  if (existing.length > 0) {
    return JSON.stringify({
      success: false,
      duplicate: true,
      existing_id: existing[0].Id,
      existing_name: existing[0].Name,
      message:
        `⚠️ An engagement record already exists for this contact at this event ` +
        `(${existing[0].Name}, level: ${existing[0].Engagement_Level__c}). ` +
        `Use updateRecord to add information rather than creating a duplicate.`,
    });
  }

  // ── Fetch contact details for confirmation message ─────────────────────────
  const contacts = await salesforceService.rawQuery<{
    Id: string; Name: string; Title: string;
    AccountId: string; Account: { Name: string };
    MailingCity: string; MailingState: string;
  }>(
    `SELECT Id, Name, Title, AccountId, Account.Name, MailingCity, MailingState
     FROM Contact WHERE Id = '${a.contact_id}' LIMIT 1`
  );

  const contact = contacts[0];
  if (!contact) {
    return JSON.stringify({ success: false, message: `Contact ${a.contact_id} not found.` });
  }

  const contactName   = contact.Name;
  const accountName   = contact.Account?.Name ?? '';
  const city          = contact.MailingCity ?? '';
  const engLevel      = a.engagement_level ?? 'Warm';

  // ── Build record ───────────────────────────────────────────────────────────
  const record: Record<string, unknown> = {
    Contact__c:           a.contact_id,
    TCI_Events__c:        a.event_id,
    Duplicate_Check_Key__c: dupKey,
    Engagement_Level__c:  engLevel,
    Source__c:            a.source ?? 'Telegram',
    Interaction_Type__c:  a.interaction_type ?? 'One-on-One',
    Follow_Up_Status__c:  'Not Started',
  };

  if (contact.AccountId)                   record.Account__c             = contact.AccountId;
  if (a.services_discussed?.length)        record.Services_Discussed__c  = a.services_discussed.join(';');
  if (a.pain_points?.length)               record.Pain_Point__c          = a.pain_points.join(';');
  if (a.primary_interest)                  record.Primary_Interest__c    = a.primary_interest;
  if (a.buying_signal)                     record.Buying_Signal__c       = a.buying_signal;
  if (a.urgency)                           record.Urgency__c             = a.urgency;
  if (a.notes)                             record.Notes__c               = a.notes;
  if (a.conversation_summary)              record.Conversation_Summary__c = a.conversation_summary;
  if (a.original_message)                  record.Original_Message__c    = a.original_message;
  if (a.next_step)                         record.Next_Step__c           = a.next_step;
  if (a.next_step_type)                    record.Next_Step_Type__c      = a.next_step_type;
  if (a.follow_up_date)                    record.Follow_Up_Date__c      = a.follow_up_date;
  if (a.follow_up_channel)                 record.Follow_Up_Channel__c   = a.follow_up_channel;
  if (a.confidence_score !== undefined)    record.Confidence_Score__c    = a.confidence_score;
  if (a.logged_by_user_id)                 record.OwnerId                = a.logged_by_user_id;

  const engagementId = await salesforceService.createRecord('Event_Engagement__c', record);

  // ── Create follow-up Task ──────────────────────────────────────────────────
  let taskId: string | null = null;
  const shouldCreateTask = (a.create_task !== false) && !!a.follow_up_date;

  if (shouldCreateTask) {
    const priority = engLevel === 'Hot' ? 'High' : 'Normal';
    const serviceStr = a.services_discussed?.join(', ') ?? '';
    const taskFields: Record<string, unknown> = {
      Subject:      `Event Follow-Up: ${contactName}${accountName ? ` — ${accountName}` : ''}`,
      WhoId:        a.contact_id,
      ActivityDate: a.follow_up_date,
      Status:       'Not Started',
      Priority:     priority,
      Description:
        `Event engagement logged via Telegram.\n` +
        `Services discussed: ${serviceStr}\n` +
        `Next step: ${a.next_step ?? ''}\n` +
        `Notes: ${a.notes ?? ''}`,
    };
    if (contact.AccountId)  taskFields.WhatId  = contact.AccountId;
    if (a.logged_by_user_id) taskFields.OwnerId = a.logged_by_user_id;

    try {
      taskId = await salesforceService.createRecord('Task', taskFields);
      await salesforceService.updateRecord('Event_Engagement__c', engagementId, { Task_Created__c: true });
    } catch (err) {
      // Task creation failure shouldn't block the engagement record
      process.stderr.write(`[EventEngagement] Task creation failed: ${err}\n`);
    }
  }

  // ── Build confirmation ─────────────────────────────────────────────────────
  const levelEmoji   = engLevel === 'Hot' ? '🔥' : engLevel === 'Warm' ? '🟡' : engLevel === 'Existing Client' ? '⭐' : '❄️';
  const servicesStr  = a.services_discussed?.join(' + ') ?? 'General Interest';
  const locationStr  = city ? `, ${city}` : '';
  const accountStr   = accountName ? ` (${accountName}${locationStr})` : (city ? ` (${city})` : '');
  const taskLine     = taskId ? ` Follow-up task created for ${a.follow_up_date}.` : '';

  const confirmationMessage =
    `✅ Logged ${contactName}${accountStr} as ${levelEmoji} <b>${engLevel}</b> for <b>${servicesStr}</b>.` +
    `${taskLine}`;

  return JSON.stringify({
    success: true,
    engagement_id: engagementId,
    task_id: taskId,
    contact_name: contactName,
    account_name: accountName,
    engagement_level: engLevel,
    services_discussed: a.services_discussed ?? [],
    follow_up_date: a.follow_up_date ?? null,
    confirmation_message: confirmationMessage,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleSearchEventContacts(args: unknown): Promise<string> {
  const a = args as SearchContactsArgs;

  if (!a.name && !a.company && !a.city) {
    return JSON.stringify({ found: 0, contacts: [], message: 'Provide at least a name, company, or city to search.' });
  }

  const conditions: string[] = [];

  if (a.name) {
    // Strip honorifics and split into parts for flexible matching
    const cleanName = a.name.replace(/^(dr\.?|mr\.?|ms\.?|mrs\.?|dds\.?|dmd\.?)\s*/i, '').trim();
    const parts = cleanName.split(/\s+/).filter(p => p.length > 1);

    if (parts.length >= 2) {
      const first = parts[0];
      const last  = parts[parts.length - 1];
      conditions.push(
        `(LastName LIKE '%${last}%' OR ` +
        `(FirstName LIKE '%${first}%' AND LastName LIKE '%${last}%'))`
      );
    } else {
      conditions.push(`(LastName LIKE '%${parts[0]}%' OR FirstName LIKE '%${parts[0]}%')`);
    }
  }

  if (a.company) {
    conditions.push(`Account.Name LIKE '%${a.company}%'`);
  }

  if (a.city) {
    conditions.push(
      `(MailingCity LIKE '%${a.city}%' OR Account.BillingCity LIKE '%${a.city}%')`
    );
  }

  if (a.state) {
    const st = a.state.trim();
    conditions.push(
      `(MailingState LIKE '%${st}%' OR Account.BillingState LIKE '%${st}%')`
    );
  }

  const limit = Math.min(a.limit ?? 10, 20);
  const soql =
    `SELECT Id, FirstName, LastName, Name, Title, AccountId, Account.Name,
            Email, Phone, MailingCity, MailingState,
            Account.BillingCity, Account.BillingState
     FROM Contact
     WHERE ${conditions.join(' AND ')}
       AND IsDeleted = false
     ORDER BY LastName, FirstName
     LIMIT ${limit}`;

  const rows = await salesforceService.rawQuery<{
    Id: string; FirstName: string; LastName: string; Name: string;
    Title: string; AccountId: string; Account: { Name: string; BillingCity: string; BillingState: string };
    Email: string; Phone: string; MailingCity: string; MailingState: string;
  }>(soql);

  if (!rows.length) {
    return JSON.stringify({
      found: 0,
      contacts: [],
      message: `No contacts found matching "${a.name ?? a.company ?? a.city}".`,
    });
  }

  const contacts: ContactMatch[] = rows.map(r => ({
    id:        r.Id,
    name:      r.Name,
    title:     r.Title ?? '',
    account:   r.Account?.Name ?? '',
    accountId: r.AccountId ?? '',
    city:      r.MailingCity ?? r.Account?.BillingCity ?? '',
    state:     r.MailingState ?? r.Account?.BillingState ?? '',
    email:     r.Email ?? '',
    phone:     r.Phone ?? '',
  }));

  return JSON.stringify({ found: contacts.length, contacts });
}

// ─────────────────────────────────────────────────────────────────────────────

async function handleGetActiveEvents(args: unknown): Promise<string> {
  const a = args as GetActiveEventsArgs;
  const daysAhead = a.days_ahead ?? 180;

  // Look back 30 days + forward N days to catch events in progress or recently concluded
  const today    = new Date();
  const fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 30);
  const toDate   = new Date(today); toDate.setDate(toDate.getDate() + daysAhead);

  const fromIso = fromDate.toISOString().split('T')[0];
  const toIso   = toDate.toISOString().split('T')[0];

  let nameFilter = '';
  if (a.query) {
    nameFilter = `AND Name LIKE '%${a.query}%'`;
  }

  // Query TCI_Events__c — use only confirmed-safe fields (Id, Name, CreatedDate)
  // Additional date/location fields may not exist; wrap in a broad query and handle gracefully
  const soql =
    `SELECT Id, Name, CreatedDate
     FROM TCI_Events__c
     WHERE CreatedDate >= ${fromIso}T00:00:00Z
       AND CreatedDate <= ${toIso}T23:59:59Z
       ${nameFilter}
     ORDER BY CreatedDate DESC
     LIMIT 25`;

  try {
    const rows = await salesforceService.rawQuery<{ Id: string; Name: string; CreatedDate: string }>(soql);

    if (!rows.length) {
      return JSON.stringify({
        found: 0,
        events: [],
        message:
          a.query
            ? `No events found matching "${a.query}". Try a broader search or check the event name.`
            : `No events found in the next ${daysAhead} days. Try increasing days_ahead.`,
      });
    }

    const events = rows.map(r => ({
      id:           r.Id,
      name:         r.Name,
      created_date: r.CreatedDate?.split('T')[0] ?? '',
    }));

    return JSON.stringify({ found: events.length, events });
  } catch (err) {
    return JSON.stringify({
      found: 0,
      events: [],
      error: err instanceof Error ? err.message : String(err),
      message: 'Could not query TCI_Events__c. Verify field names or try the Salesforce CLI.',
    });
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
      Revenue_Influence__c: number; Notes__c: string;
      CreatedDate: string; Owner: { Name: string };
    }>(
      `SELECT Id,
              Contact__r.Name, Contact__r.Account.Name,
              Engagement_Level__c, Services_Discussed__c,
              Follow_Up_Date__c, Follow_Up_Status__c,
              Task_Created__c, Opportunity_Created__c,
              Revenue_Influence__c, Notes__c,
              CreatedDate, Owner.Name
       FROM Event_Engagement__c
       WHERE TCI_Events__c = '${a.event_id}'
         ${userFilter}
       ORDER BY CreatedDate DESC
       LIMIT ${limit}`
    ),
    salesforceService.rawQuery<{ Id: string; Name: string }>(
      `SELECT Id, Name FROM TCI_Events__c WHERE Id = '${a.event_id}' LIMIT 1`
    ),
  ]);

  const eventName = event[0]?.Name ?? a.event_id;

  if (!engagements.length) {
    return `📋 No engagement records found for **${eventName}** yet.${a.user_id ? ' (filtered to your records)' : ''}`;
  }

  // Tally by level
  const tally: Record<string, number> = {};
  const serviceMap: Record<string, number> = {};
  let hotCount = 0; let taskCount = 0; let oppCount = 0; let totalRevenue = 0;

  for (const e of engagements) {
    const level = e.Engagement_Level__c ?? 'Unknown';
    tally[level] = (tally[level] ?? 0) + 1;
    if (level === 'Hot') hotCount++;
    if (e.Task_Created__c) taskCount++;
    if (e.Opportunity_Created__c) oppCount++;
    if (e.Revenue_Influence__c) totalRevenue += e.Revenue_Influence__c;

    const services = (e.Services_Discussed__c ?? '').split(';').map(s => s.trim()).filter(Boolean);
    for (const s of services) {
      serviceMap[s] = (serviceMap[s] ?? 0) + 1;
    }
  }

  // Top services by interest count
  const topServices = Object.entries(serviceMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([s, count]) => `${s} (${count})`)
    .join(', ');

  const levelBreakdown = Object.entries(tally)
    .sort(([, a], [, b]) => b - a)
    .map(([level, count]) => {
      const emoji = level === 'Hot' ? '🔥' : level === 'Warm' ? '🟡' : level === 'Existing Client' ? '⭐' : '❄️';
      return `${emoji} ${level}: ${count}`;
    })
    .join(' | ');

  // Detail list (first 15)
  const detailLines = engagements.slice(0, 15).map(e => {
    const contact  = e.Contact__r?.Name ?? 'Unknown';
    const account  = e.Contact__r?.Account?.Name ?? '';
    const level    = e.Engagement_Level__c ?? '';
    const emoji    = level === 'Hot' ? '🔥' : level === 'Warm' ? '🟡' : level === 'Existing Client' ? '⭐' : '❄️';
    const services = (e.Services_Discussed__c ?? '').replace(/;/g, ', ');
    const rep      = e.Owner?.Name ?? '';
    const date     = e.CreatedDate?.split('T')[0] ?? '';
    return `${emoji} ${contact}${account ? ` — ${account}` : ''} | ${services || 'No services noted'} | ${rep} | ${date}`;
  });

  const lines: string[] = [
    `📊 **Event Engagement Summary — ${eventName}**`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `Total Logged: **${engagements.length}** | Hot: **${hotCount}** | Tasks Created: **${taskCount}** | Opps Opened: **${oppCount}**`,
    totalRevenue > 0 ? `Revenue Influence: **$${totalRevenue.toLocaleString()}**` : '',
    ``,
    `**By Level:** ${levelBreakdown}`,
    topServices ? `**Top Services:** ${topServices}` : '',
    ``,
    `**Recent Engagements:**`,
    ...detailLines,
    engagements.length > 15 ? `\n_...and ${engagements.length - 15} more_` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

// ─── Handler Registry ─────────────────────────────────────────────────────────

export const eventEngagementHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_log_event_engagement:       handleLogEventEngagement,
  sf_search_event_contacts:      handleSearchEventContacts,
  sf_get_active_events:          handleGetActiveEvents,
  sf_get_event_engagement_summary: handleGetEventEngagementSummary,
};
