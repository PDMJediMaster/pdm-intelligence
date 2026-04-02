// ─────────────────────────────────────────────────────────────────────────────
// Prophet Scheduling Tools
//
// sf_create_event — Create Salesforce Event (meeting, call, alignment)
// sf_create_task  — Create future Salesforce Task (follow-up, reminder, to-do)
//
// Built for Telegram: AM texts "Schedule a meeting with Dr. Garcia at Smile
// Texas, next Thursday 2pm, Zoom call" and Prophet creates the Event with
// Account link, Contact link, location, Zoom URL, and description.
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Tool Definitions ─────────────────────────────────────────────────────

export const schedulingTools: Tool[] = [
  {
    name: 'sf_create_event',
    description:
      'Create a Salesforce Event (meeting, call, alignment call, etc.) linked to an Account ' +
      'and optionally a Contact. Supports Zoom links, location, and all-day events. ' +
      'Use when an AM wants to schedule a meeting, alignment call, or any calendar event ' +
      'from Telegram or any other channel. The event appears on the AM\'s Salesforce calendar.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID. If not provided, accountName is used for fuzzy search.',
        },
        accountName: {
          type: 'string',
          description: 'Account name (fuzzy search). Use when accountId is not known.',
        },
        contactId: {
          type: 'string',
          description: 'Optional Salesforce Contact ID to link as the primary "Who" on the event.',
        },
        contactName: {
          type: 'string',
          description: 'Optional contact name to search for on the account (e.g., "Dr. Garcia").',
        },
        subject: {
          type: 'string',
          description: 'Event subject/title (e.g., "Alignment Call — Smile Texas").',
        },
        description: {
          type: 'string',
          description: 'Event description or notes.',
        },
        startDateTime: {
          type: 'string',
          description: 'Start date/time in ISO 8601 format (e.g., "2026-04-10T14:00:00"). For all-day events, use date only: "2026-04-10".',
        },
        endDateTime: {
          type: 'string',
          description: 'End date/time in ISO 8601 (e.g., "2026-04-10T15:00:00"). Defaults to 1 hour after start.',
        },
        isAllDayEvent: {
          type: 'boolean',
          description: 'True for all-day events (no specific time).',
        },
        location: {
          type: 'string',
          description: 'Physical location or address for the meeting.',
        },
        zoomLink: {
          type: 'string',
          description: 'Zoom meeting URL. If provided, appended to description and set as location if no physical location given.',
        },
        isZoomMeeting: {
          type: 'boolean',
          description: 'If true and no zoomLink provided, adds "Zoom Video Call" to location. Useful when the AM says "Zoom call" but doesn\'t have a link yet.',
        },
        ownerId: {
          type: 'string',
          description: 'Salesforce User ID of the event owner. Defaults to the authenticated user.',
        },
        reminderMinutes: {
          type: 'number',
          description: 'Reminder in minutes before the event (default: 15).',
        },
      },
      required: ['subject', 'startDateTime'],
    },
  },
  {
    name: 'sf_create_task',
    description:
      'Create a future Salesforce Task (follow-up, reminder, to-do) linked to an Account ' +
      'and optionally a Contact. Unlike sf_log_account_note (which logs completed activities), ' +
      'this creates open tasks due in the future. Use when an AM says "Remind me to call ' +
      'Seville Dental next Tuesday" or "Follow up with Dr. Smith about the proposal".',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID. If not provided, accountName is used for fuzzy search.',
        },
        accountName: {
          type: 'string',
          description: 'Account name (fuzzy search).',
        },
        contactId: {
          type: 'string',
          description: 'Optional Salesforce Contact ID.',
        },
        contactName: {
          type: 'string',
          description: 'Optional contact name to search for on the account.',
        },
        subject: {
          type: 'string',
          description: 'Task subject (e.g., "Follow up on renewal proposal").',
        },
        description: {
          type: 'string',
          description: 'Task description or notes.',
        },
        dueDate: {
          type: 'string',
          description: 'Due date in YYYY-MM-DD format (e.g., "2026-04-10").',
        },
        priority: {
          type: 'string',
          enum: ['High', 'Normal', 'Low'],
          description: 'Task priority (default: Normal).',
        },
        type: {
          type: 'string',
          enum: ['Call', 'Email', 'Meeting', 'Other'],
          description: 'Task type (default: Other).',
        },
        ownerId: {
          type: 'string',
          description: 'Salesforce User ID of the task owner. Defaults to the authenticated user.',
        },
      },
      required: ['subject'],
    },
  },
];

// ─── Input Schemas ────────────────────────────────────────────────────────

const CreateEventArgs = z.object({
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  contactId: z.string().optional(),
  contactName: z.string().optional(),
  subject: z.string().min(1),
  description: z.string().optional(),
  startDateTime: z.string().min(1),
  endDateTime: z.string().optional(),
  isAllDayEvent: z.boolean().optional().default(false),
  location: z.string().optional(),
  zoomLink: z.string().optional(),
  isZoomMeeting: z.boolean().optional().default(false),
  ownerId: z.string().optional(),
  reminderMinutes: z.number().optional().default(15),
});

const CreateTaskArgs = z.object({
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  contactId: z.string().optional(),
  contactName: z.string().optional(),
  subject: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(['High', 'Normal', 'Low']).optional().default('Normal'),
  type: z.enum(['Call', 'Email', 'Meeting', 'Other']).optional().default('Other'),
  ownerId: z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Resolve account ID from name if needed */
async function resolveAccountId(accountId?: string, accountName?: string): Promise<string | undefined> {
  if (accountId) return accountId;
  if (!accountName) return undefined;

  const matches = await salesforceService.searchAccountsByName(accountName);
  if (matches.length === 0) throw new Error(`No account found matching "${accountName}".`);
  if (matches.length > 1) {
    const list = matches.slice(0, 5).map((m) => `• ${m.Name} (${m.Id})`).join('\n');
    throw new Error(`Multiple accounts match "${accountName}". Please be more specific:\n${list}`);
  }
  return matches[0].Id;
}

/** Search for a contact on an account by name */
async function resolveContactId(
  accountId: string,
  contactId?: string,
  contactName?: string
): Promise<string | undefined> {
  if (contactId) return contactId;
  if (!contactName) return undefined;

  const contacts = await salesforceService.rawQuery<{ Id: string; Name: string }>(
    `SELECT Id, Name FROM Contact WHERE AccountId = '${accountId}' AND Name LIKE '%${contactName.replace(/'/g, "\\'")}%' LIMIT 5`
  );

  if (contacts.length === 0) return undefined; // Don't fail — just skip contact link
  if (contacts.length === 1) return contacts[0].Id;

  // Multiple matches — pick best match (shortest name that contains the search term)
  const sorted = contacts.sort((a, b) => a.Name.length - b.Name.length);
  return sorted[0].Id;
}

// ─── Handlers ─────────────────────────────────────────────────────────────

async function handleCreateEvent(rawArgs: unknown): Promise<string> {
  const args = CreateEventArgs.parse(rawArgs);

  // Resolve account
  const accountId = await resolveAccountId(args.accountId, args.accountName);

  // Resolve contact
  let contactId = args.contactId;
  if (!contactId && args.contactName && accountId) {
    contactId = await resolveContactId(accountId, undefined, args.contactName);
  }

  // Build description with Zoom link
  let description = args.description ?? '';
  if (args.zoomLink) {
    description = description
      ? `${description}\n\n🔗 Zoom Meeting: ${args.zoomLink}`
      : `🔗 Zoom Meeting: ${args.zoomLink}`;
  }

  // Build location
  let location = args.location ?? '';
  if (args.zoomLink && !location) {
    location = args.zoomLink;
  } else if (args.isZoomMeeting && !location) {
    location = 'Zoom Video Call';
  }

  // Parse start/end times
  const startStr = args.startDateTime;
  let endStr = args.endDateTime;

  if (!endStr && !args.isAllDayEvent) {
    // Default to 1 hour after start
    const start = new Date(startStr);
    start.setHours(start.getHours() + 1);
    endStr = start.toISOString();
  }

  // Build the Event record
  const eventFields: Record<string, unknown> = {
    Subject: args.subject,
    Description: description || undefined,
    Location: location || undefined,
    IsAllDayEvent: args.isAllDayEvent,
    IsReminderSet: true,
    ReminderDateTime: new Date(new Date(startStr).getTime() - args.reminderMinutes * 60_000).toISOString(),
  };

  if (args.isAllDayEvent) {
    // All-day events use ActivityDate (date only)
    eventFields.ActivityDate = startStr.split('T')[0];
  } else {
    eventFields.StartDateTime = startStr.includes('T') ? startStr : `${startStr}T00:00:00`;
    eventFields.EndDateTime = endStr;
  }

  if (accountId) eventFields.WhatId = accountId;
  if (contactId) eventFields.WhoId = contactId;
  if (args.ownerId) eventFields.OwnerId = args.ownerId;

  const eventId = await salesforceService.createRecord('Event', eventFields);

  // Build confirmation message
  const lines: string[] = [
    '# ✅ Event Created',
    '',
  ];

  // Fetch account name for display
  let accountDisplay = accountId ?? 'No account linked';
  if (accountId) {
    try {
      const acct = await salesforceService.rawQuery<{ Name: string }>(
        `SELECT Name FROM Account WHERE Id = '${accountId}'`
      );
      if (acct.length > 0) accountDisplay = acct[0].Name;
    } catch { /* use ID */ }
  }

  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| **Subject** | ${args.subject} |`);
  lines.push(`| **Account** | ${accountDisplay} |`);
  if (contactId) lines.push(`| **Contact** | ${args.contactName ?? contactId} |`);
  if (args.isAllDayEvent) {
    lines.push(`| **Date** | ${startStr.split('T')[0]} (all day) |`);
  } else {
    const startDate = new Date(startStr);
    const endDate = endStr ? new Date(endStr) : null;
    lines.push(`| **Start** | ${startDate.toLocaleString()} |`);
    if (endDate) lines.push(`| **End** | ${endDate.toLocaleString()} |`);
  }
  if (location) lines.push(`| **Location** | ${location} |`);
  if (args.zoomLink) lines.push(`| **Zoom** | ${args.zoomLink} |`);
  lines.push(`| **Event ID** | \`${eventId}\` |`);
  lines.push('');
  lines.push(`[View in Salesforce](https://progressivedental.lightning.force.com/lightning/r/Event/${eventId}/view)`);

  return lines.join('\n');
}

async function handleCreateTask(rawArgs: unknown): Promise<string> {
  const args = CreateTaskArgs.parse(rawArgs);

  // Resolve account
  const accountId = await resolveAccountId(args.accountId, args.accountName);

  // Resolve contact
  let contactId = args.contactId;
  if (!contactId && args.contactName && accountId) {
    contactId = await resolveContactId(accountId, undefined, args.contactName);
  }

  // Build the Task record
  const taskFields: Record<string, unknown> = {
    Subject: args.subject,
    Description: args.description ?? undefined,
    Status: 'Not Started',
    Priority: args.priority,
    TaskSubtype: 'Task',
  };

  if (args.type) taskFields.Type = args.type;
  if (args.dueDate) taskFields.ActivityDate = args.dueDate;
  if (accountId) taskFields.WhatId = accountId;
  if (contactId) taskFields.WhoId = contactId;
  if (args.ownerId) taskFields.OwnerId = args.ownerId;

  const taskId = await salesforceService.createRecord('Task', taskFields);

  // Build confirmation
  const lines: string[] = [
    '# ✅ Task Created',
    '',
  ];

  let accountDisplay = accountId ?? 'No account linked';
  if (accountId) {
    try {
      const acct = await salesforceService.rawQuery<{ Name: string }>(
        `SELECT Name FROM Account WHERE Id = '${accountId}'`
      );
      if (acct.length > 0) accountDisplay = acct[0].Name;
    } catch { /* use ID */ }
  }

  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| **Subject** | ${args.subject} |`);
  lines.push(`| **Account** | ${accountDisplay} |`);
  if (contactId) lines.push(`| **Contact** | ${args.contactName ?? contactId} |`);
  if (args.dueDate) lines.push(`| **Due Date** | ${args.dueDate} |`);
  lines.push(`| **Priority** | ${args.priority} |`);
  lines.push(`| **Status** | Not Started |`);
  lines.push(`| **Task ID** | \`${taskId}\` |`);
  lines.push('');
  lines.push(`[View in Salesforce](https://progressivedental.lightning.force.com/lightning/r/Task/${taskId}/view)`);

  return lines.join('\n');
}

// ─── Router ───────────────────────────────────────────────────────────────

export const schedulingHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_create_event: handleCreateEvent,
  sf_create_task:  handleCreateTask,
};
