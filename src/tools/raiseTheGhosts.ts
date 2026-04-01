// ─────────────────────────────────────────────────────────────────────────────
// Raise the Ghosts — Revive Dead Deals
//
// Finds open deals / prospects that went silent, analyzes the last touchpoint,
// determines WHY they likely went cold, and delivers everything Claude needs
// to draft personalized re-engagement emails with relevant articles.
//
// Architecture: Single tool that gathers all Salesforce intelligence, then
// returns structured ghost profiles with draft email instructions. Claude Chat
// then uses web search to find articles and Gmail MCP to create drafts.
//
// "Hey, I just read this and was thinking about you."
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const WILLIAM_ID = '005PU000001eUQDYA2';
const SF_BASE = 'https://progressivedental.lightning.force.com';

// ── Notification Exclusion List ──────────────────────────────────────────────
// These users are excluded from ghost results and will never receive revival
// notifications. They are admins, leadership, service accounts, or queues —
// not active Sales Reps who should be following up on dead deals.
// Matched case-insensitively against Account/Lead/Opp Owner Name.
const EXCLUDED_OWNERS = new Set([
  'william summers',
  'eric chmiel',
  'aaron jenkins',
  'alexa cunha',
  'a rehman',
  'david shimkus',
  'devin wilder',
  'hunter miller',
  'jase morgan',
  'jason knellinger',
  'john parisi',
  'kate bitters',
  'kate kennedy',
  'nate newell',
  'olivia roach',
  'simon mata',
  'tej patel',
  'richard calahan',
  // Service accounts / queues / integrations
  '360 sms',
  'service account',
  'tci leads',
  'inovi',
]);

// ─── Tool Definition ─────────────────────────────────────────────────────────

export const raiseTheGhostsTools: Tool[] = [
  {
    name: 'sf_raise_the_ghosts',
    description:
      'Raise the Ghosts — find open deals and prospects that went silent, analyze the last ' +
      'conversation, figure out why they went cold, and provide everything needed to draft ' +
      'personalized re-engagement emails. Pulls from VideoCall transcripts, Zoom AI summaries, ' +
      'Task notes, Call_Intelligence__c records, and email activity. Returns ghost profiles ' +
      'with suggested article topics and draft email frameworks. ' +
      'After running, use web search to find articles matching each ghost\'s pain points, ' +
      'then use Gmail MCP to create draft emails and Google Calendar MCP to schedule monthly review. ' +
      'Use when asked to: "revive dead deals", "raise the ghosts", "find ghosted prospects", ' +
      '"re-engage cold leads", "what deals went cold", or any stale pipeline recovery.',
    inputSchema: {
      type: 'object',
      properties: {
        minDaysSilent: {
          type: 'number',
          description: 'Minimum days since last activity to qualify as a ghost (default: 30)',
        },
        maxDaysSilent: {
          type: 'number',
          description: 'Maximum days back to search — older than this are truly dead (default: 365)',
        },
        ownerId: {
          type: 'string',
          description: 'Filter to a specific Sales Rep by Salesforce User ID. Omit for all reps.',
        },
        limit: {
          type: 'number',
          description: 'Max ghosts to return (default: 25)',
        },
        includeProspectAccounts: {
          type: 'boolean',
          description: 'Include TCI Event / prospect accounts (Status__c = null) that had calls but no follow-up (default: true)',
        },
        includeLeads: {
          type: 'boolean',
          description: 'Include Leads with prior activity that went cold (default: true)',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schema ────────────────────────────────────────────────────────────

const RaiseTheGhostsArgs = z.object({
  minDaysSilent:          z.number().optional(),
  maxDaysSilent:          z.number().optional(),
  ownerId:                z.string().optional(),
  limit:                  z.number().optional(),
  includeProspectAccounts: z.boolean().optional(),
  includeLeads:           z.boolean().optional(),
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface GhostProfile {
  type: 'opportunity' | 'prospect_account' | 'lead';
  // Core identity
  recordId: string;
  accountId?: string;
  accountName: string;
  opportunityName?: string;
  opportunityStage?: string;
  opportunityAmount?: number;
  // Salesforce lookup IDs for Pipeline_Revival__c
  contactId?: string;
  videoCallId?: string;
  callIntelligenceId?: string;
  // Owner / Rep
  ownerId: string;
  ownerName: string;
  ownerEmail?: string;
  // Contact
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactTitle?: string;
  isDoctorContact?: boolean;
  // Timing
  daysSilent: number;
  lastActivityDate?: string;
  lastCallDate?: string;
  // Last touchpoint intelligence
  lastCallTopic?: string;
  lastCallDuration?: number;
  lastCallParticipants?: string;
  lastCallSummary?: string;       // From Zoom AI or Call_Intelligence__c
  lastCallKeyTopics?: string;     // From Call_Intelligence__c
  lastCallCommitments?: string;   // From Call_Intelligence__c
  lastCallRiskSignals?: string;   // From Call_Intelligence__c
  lastTaskSubject?: string;
  lastTaskDescription?: string;   // Full call notes
  lastEmailSubject?: string;
  lastEmailDate?: string;
  // Analysis
  painPoints: string[];
  likelyReasonCold: string;
  reEngagementAngle: string;
  articleSearchQuery: string;
  competitorArticleQuery: string;
  sfLink: string;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

async function handleRaiseTheGhosts(rawArgs: unknown): Promise<string> {
  const args = RaiseTheGhostsArgs.parse(rawArgs ?? {});

  const minDays = args.minDaysSilent ?? 30;
  const maxDays = args.maxDaysSilent ?? 365;
  const limit = args.limit ?? 25;
  const includeProspects = args.includeProspectAccounts !== false;
  const includeLeads = args.includeLeads !== false;
  const ownerFilter = args.ownerId ? `AND OwnerId = '${args.ownerId}'` : '';

  const ghosts: GhostProfile[] = [];

  // ── Query 1: Open Opportunities that went cold ──────────────────────────
  // Find open Opps where the ACCOUNT's last activity is stale
  const oppQuery = `
    SELECT Id, Name, StageName, Amount, AccountId,
           Account.Name, Account.OwnerId, Account.Owner.Name, Account.Owner.Email,
           Account.LastActivityDate, Account.Phone, Account.Website,
           CloseDate, CreatedDate, Description, Probability
    FROM Opportunity
    WHERE IsClosed = false
      AND Account.LastActivityDate < LAST_N_DAYS:${minDays}
      AND Account.LastActivityDate > LAST_N_DAYS:${maxDays}
      AND Account.OwnerId != '${WILLIAM_ID}'
      ${ownerFilter.replace('OwnerId', 'Account.OwnerId')}
    ORDER BY Account.LastActivityDate ASC
    LIMIT ${limit}
  `;

  // ── Query 2: Prospect accounts (Status__c = null) with VideoCall activity but gone cold ──
  const prospectQuery = includeProspects ? `
    SELECT Id, Name, OwnerId, Owner.Name, Owner.Email, Phone, Website,
           LastActivityDate, BillingCity, BillingState
    FROM Account
    WHERE Status__c = null
      AND LastActivityDate < LAST_N_DAYS:${minDays}
      AND LastActivityDate > LAST_N_DAYS:${maxDays}
      AND OwnerId != '${WILLIAM_ID}'
      ${ownerFilter}
      AND Id IN (SELECT RelatedRecordId FROM VideoCall WHERE RelatedRecordId != null)
    ORDER BY LastActivityDate ASC
    LIMIT ${limit}
  ` : null;

  // ── Query 3: Cold Leads with prior engagement ──────────────────────────
  const leadQuery = includeLeads ? `
    SELECT Id, Name, Company, Email, Phone, Title, OwnerId, Owner.Name, Owner.Email,
           LastActivityDate, Status, LeadSource, CreatedDate
    FROM Lead
    WHERE IsConverted = false
      AND LastActivityDate < LAST_N_DAYS:${minDays}
      AND LastActivityDate > LAST_N_DAYS:${maxDays}
      AND OwnerId != '${WILLIAM_ID}'
      AND Status != 'Disqualified'
      ${ownerFilter}
    ORDER BY LastActivityDate ASC
    LIMIT ${limit}
  ` : null;

  // Execute all queries in parallel
  const [oppResults, prospectResults, leadResults] = await Promise.all([
    salesforceService.rawQuery<{
      Id: string; Name: string; StageName: string; Amount?: number;
      AccountId: string; Account: { Name: string; OwnerId: string; Owner: { Name: string; Email?: string };
        LastActivityDate?: string; Phone?: string; Website?: string };
      CloseDate: string; CreatedDate: string; Description?: string; Probability?: number;
    }>(oppQuery),
    prospectQuery ? salesforceService.rawQuery<{
      Id: string; Name: string; OwnerId: string; Owner: { Name: string; Email?: string };
      Phone?: string; Website?: string; LastActivityDate?: string;
      BillingCity?: string; BillingState?: string;
    }>(prospectQuery) : Promise.resolve([]),
    leadQuery ? salesforceService.rawQuery<{
      Id: string; Name: string; Company?: string; Email?: string; Phone?: string;
      Title?: string; OwnerId: string; Owner: { Name: string; Email?: string };
      LastActivityDate?: string; Status?: string; LeadSource?: string; CreatedDate: string;
    }>(leadQuery) : Promise.resolve([]),
  ]);

  // Collect all account IDs for bulk enrichment
  const accountIds = new Set<string>();
  for (const opp of oppResults) accountIds.add(opp.AccountId);
  for (const acct of prospectResults) accountIds.add(acct.Id);

  // Lead IDs for task lookup (WhoId)
  const leadIds = leadResults.map(l => l.Id);

  // ── Bulk enrichment: Contacts, VideoCalls, Tasks, Call Intelligence ────
  const accountIdList = [...accountIds];
  const allRecordIds = [...accountIdList, ...leadIds];

  // Build SOQL IN clauses (chunked if needed)
  const acctInClause = accountIdList.map(id => `'${id}'`).join(',');
  const allInClause = allRecordIds.map(id => `'${id}'`).join(',');
  const leadInClause = leadIds.map(id => `'${id}'`).join(',');

  const enrichmentQueries = accountIdList.length > 0 || leadIds.length > 0 ? await Promise.all([
    // Contacts for accounts
    accountIdList.length > 0 ? salesforceService.rawQuery<{
      Id: string; AccountId: string; Name: string; Email?: string; Phone?: string;
      MobilePhone?: string; Title?: string; Doctor__c?: boolean; Primary_Contact__c?: boolean;
    }>(`SELECT Id, AccountId, Name, Email, Phone, MobilePhone, Title, Doctor__c, Primary_Contact__c
        FROM Contact WHERE AccountId IN (${acctInClause}) ORDER BY Doctor__c DESC, Primary_Contact__c DESC`)
    : Promise.resolve([]),

    // VideoCalls for accounts
    accountIdList.length > 0 ? salesforceService.rawQuery<{
      Id: string; RelatedRecordId: string; Name: string; StartDateTime: string;
      DurationInSeconds?: number; Vendor?: string;
      CallParticipants?: string;
    }>(`SELECT Id, RelatedRecordId, Name, StartDateTime, DurationInSeconds, Vendor
        FROM VideoCall WHERE RelatedRecordId IN (${acctInClause})
        ORDER BY StartDateTime DESC LIMIT 200`)
    : Promise.resolve([]),

    // Call Intelligence records
    accountIdList.length > 0 ? salesforceService.rawQuery<{
      Id: string; Account__c: string; Call_Date__c?: string; Key_Topics__c?: string;
      Commitments_Made__c?: string; Risk_Signals__c?: string; AI_Summary__c?: string;
      Sentiment_Label__c?: string; Satisfaction_Signal__c?: string;
    }>(`SELECT Id, Account__c, Call_Date__c, Key_Topics__c, Commitments_Made__c,
              Risk_Signals__c, AI_Summary__c, Sentiment_Label__c, Satisfaction_Signal__c
        FROM Call_Intelligence__c WHERE Account__c IN (${acctInClause})
        ORDER BY Call_Date__c DESC LIMIT 200`)
    : Promise.resolve([]),

    // Recent Tasks for accounts AND leads (last touchpoint + emails)
    allRecordIds.length > 0 ? salesforceService.rawQuery<{
      Id: string; WhatId?: string; WhoId?: string; Subject: string; Description?: string;
      Type?: string; ActivityDate?: string; CreatedDate: string; Status: string;
    }>(`SELECT Id, WhatId, WhoId, Subject, Description, Type, ActivityDate, CreatedDate, Status
        FROM Task
        WHERE (${accountIdList.length > 0 ? `WhatId IN (${acctInClause})` : '1=0'}
               ${leadIds.length > 0 ? `OR WhoId IN (${leadInClause})` : ''})
        ORDER BY CreatedDate DESC LIMIT 500`)
    : Promise.resolve([]),

    // Zoom AI Summaries (via Tasks linked to Zoom Meetings)
    accountIdList.length > 0 ? salesforceService.rawQuery<{
      WhatId: string; Subject: string; CreatedDate: string;
      ZVC__Zoom_Meeting__c?: string;
      ZVC__Zoom_Meeting__r?: { ZVC__Meeting_AI_Summary__c?: string };
    }>(`SELECT WhatId, Subject, CreatedDate,
              ZVC__Zoom_Meeting__c, ZVC__Zoom_Meeting__r.ZVC__Meeting_AI_Summary__c
        FROM Task
        WHERE WhatId IN (${acctInClause})
          AND ZVC__Zoom_Meeting__c != null
        ORDER BY CreatedDate DESC LIMIT 100`)
    : Promise.resolve([]),

  ]) : [[], [], [], [], []];

  const [contacts, videoCalls, callIntel, tasks, zoomTasks] = enrichmentQueries;

  // ── Index enrichment data by account/lead ID ──────────────────────────
  const contactsByAcct = new Map<string, typeof contacts>();
  for (const c of contacts) {
    const arr = contactsByAcct.get(c.AccountId) || [];
    arr.push(c);
    contactsByAcct.set(c.AccountId, arr);
  }

  const videoCallsByAcct = new Map<string, typeof videoCalls>();
  for (const vc of videoCalls) {
    if (!vc.RelatedRecordId) continue;
    const arr = videoCallsByAcct.get(vc.RelatedRecordId) || [];
    arr.push(vc);
    videoCallsByAcct.set(vc.RelatedRecordId, arr);
  }

  const callIntelByAcct = new Map<string, typeof callIntel>();
  for (const ci of callIntel) {
    if (!ci.Account__c) continue;
    const arr = callIntelByAcct.get(ci.Account__c) || [];
    arr.push(ci);
    callIntelByAcct.set(ci.Account__c, arr);
  }

  const tasksByRecord = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const key = t.WhatId || t.WhoId || '';
    const arr = tasksByRecord.get(key) || [];
    arr.push(t);
    tasksByRecord.set(key, arr);
  }

  const zoomByAcct = new Map<string, typeof zoomTasks>();
  for (const zt of zoomTasks) {
    if (!zt.WhatId) continue;
    const arr = zoomByAcct.get(zt.WhatId) || [];
    arr.push(zt);
    zoomByAcct.set(zt.WhatId, arr);
  }

  // ── Helper: Build ghost profile from enrichment data ──────────────────
  function buildGhostProfile(
    type: GhostProfile['type'],
    recordId: string,
    accountId: string,
    accountName: string,
    ownerId: string,
    ownerName: string,
    ownerEmail: string | undefined,
    lastActivityDate: string | undefined,
    extra: Partial<GhostProfile> = {},
  ): GhostProfile {
    const now = Date.now();
    const lastActivity = lastActivityDate ? new Date(lastActivityDate).getTime() : 0;
    const daysSilent = lastActivity ? Math.round((now - lastActivity) / 86400000) : 999;

    // Best contact
    const acctContacts = contactsByAcct.get(accountId) || [];
    const doctor = acctContacts.find(c => c.Doctor__c);
    const primary = acctContacts.find(c => c.Primary_Contact__c);
    const bestContact = doctor || primary || acctContacts[0];

    // Last video call
    const vcList = videoCallsByAcct.get(accountId) || [];
    const lastVC = vcList[0]; // Already sorted DESC

    // Last Call Intelligence
    const ciList = callIntelByAcct.get(accountId) || [];
    const lastCI = ciList[0];

    // Last Zoom AI Summary
    const zmList = zoomByAcct.get(accountId) || [];
    const lastZoom = zmList[0];
    const zoomSummary = lastZoom?.ZVC__Zoom_Meeting__r?.ZVC__Meeting_AI_Summary__c;

    // Last tasks (all types + emails)
    const tList = tasksByRecord.get(accountId) || tasksByRecord.get(recordId) || [];
    const lastTask = tList[0];
    const lastEmail = tList.find(t => t.Type === 'Email');

    // ── Analyze pain points from all available intelligence ──────────
    const painPoints: string[] = [];
    const intelligenceSources: string[] = [];

    // From VideoCall title (often very descriptive at PDM)
    if (lastVC?.Name) {
      intelligenceSources.push(`VideoCall: "${lastVC.Name}"`);
      // Extract topic keywords from call title
      const topic = lastVC.Name.replace(/^Dr\.\s*\w+\s+and\s+\w+\.\.\s*/i, '').replace(/\.\./g, ' ').trim();
      if (topic) painPoints.push(topic);
    }

    // From Call Intelligence AI analysis
    if (lastCI?.Key_Topics__c) {
      intelligenceSources.push('Call_Intelligence__c');
      painPoints.push(...lastCI.Key_Topics__c.split(/[,;|]/).map(s => s.trim()).filter(Boolean));
    }

    // From Zoom AI Summary
    if (zoomSummary) {
      intelligenceSources.push('Zoom AI Summary');
    }

    // From Task notes
    if (lastTask?.Description) {
      intelligenceSources.push(`Task: "${lastTask.Subject}"`);
    }

    // ── Determine likely reason for going cold ──────────────────────
    let likelyReason = 'Unknown — no conversation intelligence available to analyze.';
    const callSummary = lastCI?.AI_Summary__c || zoomSummary || lastTask?.Description || '';

    if (callSummary) {
      // Look for common cold signals in the conversation
      const lowerSummary = callSummary.toLowerCase();
      if (lowerSummary.includes('budget') || lowerSummary.includes('cost') || lowerSummary.includes('price') || lowerSummary.includes('expensive'))
        likelyReason = 'Budget/pricing concerns surfaced in the last conversation. They may be shopping or need ROI justification.';
      else if (lowerSummary.includes('think about') || lowerSummary.includes('get back to') || lowerSummary.includes('need to discuss') || lowerSummary.includes('talk to partner'))
        likelyReason = 'They said they needed time to think / discuss with a partner. Classic stall — they never came back.';
      else if (lowerSummary.includes('competitor') || lowerSummary.includes('other agency') || lowerSummary.includes('already working with'))
        likelyReason = 'Competitor or existing agency mentioned. They may be evaluating multiple options or locked in elsewhere.';
      else if (lowerSummary.includes('busy') || lowerSummary.includes('overwhelm') || lowerSummary.includes('not right now') || lowerSummary.includes('timing'))
        likelyReason = 'Timing / bandwidth — they were interested but got pulled away by operations. The pain still exists.';
      else
        likelyReason = 'Conversation ended positively but no next step was locked. They likely got busy and forgot.';
    } else if (lastVC?.Name) {
      likelyReason = `Had a ${lastVC.DurationInSeconds ? Math.round(lastVC.DurationInSeconds / 60) : '?'}-minute call about "${lastVC.Name.substring(0, 80)}" but no follow-up was recorded. They likely got busy or were waiting for a next step that never came.`;
    } else if (daysSilent > 90) {
      likelyReason = 'Long silence (90+ days). May have gone with a competitor, lost interest, or had a change in practice priorities.';
    }

    // ── Build re-engagement angle ───────────────────────────────────
    const topPain = painPoints[0] || 'dental implant marketing';
    const reEngagementAngle = painPoints.length > 0
      ? `Reference the ${topPain} conversation directly. Find an article about ${topPain} and frame it as "I just read this and thought of you."`
      : 'Find a general dental implant marketing / patient acquisition article relevant to their practice type.';

    // ── Article search queries ──────────────────────────────────────
    const articleQuery = painPoints.length > 0
      ? `"${topPain}" dental practice marketing strategy ${new Date().getFullYear()}`
      : `dental implant patient acquisition strategy ${new Date().getFullYear()}`;

    const competitorQuery = painPoints.length > 0
      ? `dental practice "${topPain}" competitor success story case study`
      : 'dental implant marketing competitor case study results';

    return {
      type,
      recordId,
      accountId,
      accountName,
      opportunityName: extra.opportunityName,
      opportunityStage: extra.opportunityStage,
      opportunityAmount: extra.opportunityAmount,
      contactId: bestContact?.Id,
      videoCallId: lastVC?.Id,
      callIntelligenceId: lastCI?.Id,
      ownerId,
      ownerName,
      ownerEmail,
      contactName: extra.contactName || bestContact?.Name,
      contactEmail: extra.contactEmail || bestContact?.Email,
      contactPhone: extra.contactPhone || bestContact?.Phone || bestContact?.MobilePhone,
      contactTitle: extra.contactTitle || bestContact?.Title,
      isDoctorContact: extra.isDoctorContact ?? bestContact?.Doctor__c,
      daysSilent,
      lastActivityDate,
      lastCallDate: lastVC?.StartDateTime || lastCI?.Call_Date__c,
      lastCallTopic: lastVC?.Name,
      lastCallDuration: lastVC?.DurationInSeconds ? Math.round(lastVC.DurationInSeconds / 60) : undefined,
      lastCallParticipants: undefined,
      lastCallSummary: lastCI?.AI_Summary__c || zoomSummary || undefined,
      lastCallKeyTopics: lastCI?.Key_Topics__c || undefined,
      lastCallCommitments: lastCI?.Commitments_Made__c || undefined,
      lastCallRiskSignals: lastCI?.Risk_Signals__c || undefined,
      lastTaskSubject: lastTask?.Subject,
      lastTaskDescription: lastTask?.Description?.substring(0, 2000) || undefined,
      lastEmailSubject: lastEmail?.Subject,
      lastEmailDate: lastEmail?.CreatedDate,
      painPoints,
      likelyReasonCold: likelyReason,
      reEngagementAngle,
      articleSearchQuery: articleQuery,
      competitorArticleQuery: competitorQuery,
      sfLink: `${SF_BASE}/lightning/r/${type === 'lead' ? 'Lead' : 'Account'}/${type === 'lead' ? recordId : accountId}/view`,
    };
  }

  // ── Build ghost profiles from Opportunities ───────────────────────────
  const seenAccounts = new Set<string>();
  for (const opp of oppResults) {
    if (seenAccounts.has(opp.AccountId)) continue;
    seenAccounts.add(opp.AccountId);

    ghosts.push(buildGhostProfile(
      'opportunity',
      opp.Id,
      opp.AccountId,
      opp.Account.Name,
      opp.Account.OwnerId,
      opp.Account.Owner.Name,
      opp.Account.Owner.Email,
      opp.Account.LastActivityDate,
      {
        opportunityName: opp.Name,
        opportunityStage: opp.StageName,
        opportunityAmount: opp.Amount,
      },
    ));
  }

  // ── Build ghost profiles from prospect accounts ───────────────────────
  for (const acct of prospectResults) {
    if (seenAccounts.has(acct.Id)) continue;
    seenAccounts.add(acct.Id);

    ghosts.push(buildGhostProfile(
      'prospect_account',
      acct.Id,
      acct.Id,
      acct.Name,
      acct.OwnerId,
      acct.Owner.Name,
      acct.Owner.Email,
      acct.LastActivityDate,
    ));
  }

  // ── Build ghost profiles from Leads ───────────────────────────────────
  for (const lead of leadResults) {
    ghosts.push(buildGhostProfile(
      'lead',
      lead.Id,
      lead.Id,
      lead.Company || lead.Name,
      lead.OwnerId,
      lead.Owner.Name,
      lead.Owner.Email,
      lead.LastActivityDate,
      {
        contactName: lead.Name,
        contactEmail: lead.Email || undefined,
        contactPhone: lead.Phone || undefined,
        contactTitle: lead.Title || undefined,
      },
    ));
  }

  // ── Filter out excluded owners ──────────────────────────────────────────
  // These are admins, leadership, service accounts, and queues — not Sales Reps.
  // William Summers is already excluded at SOQL level; this catches the rest.
  const filteredGhosts = ghosts.filter(g => !EXCLUDED_OWNERS.has(g.ownerName.toLowerCase()));

  // Sort by days silent descending (most stale first)
  filteredGhosts.sort((a, b) => b.daysSilent - a.daysSilent);

  // Cap to limit
  const finalGhosts = filteredGhosts.slice(0, limit);

  // ── Write Pipeline_Revival__c records to Salesforce ───────────────────
  const scanBatch = new Date().toISOString().split('T')[0]; // e.g. "2026-04-01"
  const revivalRecords: Array<{ ghost: GhostProfile; revivalId: string }> = [];
  const revivalErrors: string[] = [];

  const ghostTypeMap: Record<string, string> = {
    opportunity: 'Open Deal',
    prospect_account: 'TCI Prospect',
    lead: 'Cold Lead',
  };

  const coldReasonMap: Record<string, string> = {
    'Budget/pricing': 'Budget/Pricing',
    'time to think': 'Stall - Need to Think',
    'Competitor': 'Competitor/Other Agency',
    'Timing': 'Timing/Bandwidth',
    'no next step': 'No Next Step Locked',
  };

  function mapColdReason(detail: string): string {
    const lower = detail.toLowerCase();
    if (lower.includes('budget') || lower.includes('pricing') || lower.includes('cost')) return 'Budget/Pricing';
    if (lower.includes('think') || lower.includes('discuss') || lower.includes('partner') || lower.includes('stall')) return 'Stall - Need to Think';
    if (lower.includes('competitor') || lower.includes('other agency') || lower.includes('evaluating')) return 'Competitor/Other Agency';
    if (lower.includes('timing') || lower.includes('busy') || lower.includes('bandwidth')) return 'Timing/Bandwidth';
    if (lower.includes('no follow-up') || lower.includes('next step') || lower.includes('forgot')) return 'No Next Step Locked';
    return 'Unknown';
  }

  function mapTouchpointType(ghost: GhostProfile): string {
    if (ghost.lastCallTopic) return 'Video Call';
    if (ghost.lastEmailSubject) return 'Email';
    if (ghost.lastTaskSubject) return 'Task';
    return 'Task';
  }

  // Create records in parallel (batches of 10 to avoid API limits)
  for (let i = 0; i < finalGhosts.length; i += 10) {
    const batch = finalGhosts.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map(ghost => {
        // Build touchpoint summary from all available intelligence
        const summaryParts: string[] = [];
        if (ghost.lastCallTopic) summaryParts.push(`Call: ${ghost.lastCallTopic}`);
        if (ghost.lastCallSummary) summaryParts.push(`AI Summary: ${ghost.lastCallSummary.substring(0, 2000)}`);
        if (ghost.lastCallKeyTopics) summaryParts.push(`Topics: ${ghost.lastCallKeyTopics}`);
        if (ghost.lastCallCommitments) summaryParts.push(`Commitments: ${ghost.lastCallCommitments}`);
        if (ghost.lastTaskDescription && !ghost.lastCallSummary) summaryParts.push(`Notes: ${ghost.lastTaskDescription.substring(0, 1500)}`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fields: Record<string, any> = {
          Name: `${ghost.accountName} — ${ghost.daysSilent}d silent`.substring(0, 80),
          Ghost_Type__c: ghostTypeMap[ghost.type] || 'Cold Lead',
          Sales_Rep__c: ghost.ownerId,
          Days_Silent__c: ghost.daysSilent,
          Date_Identified__c: new Date().toISOString(),
          Last_Touchpoint_Date__c: ghost.lastCallDate || ghost.lastActivityDate || null,
          Last_Touchpoint_Type__c: mapTouchpointType(ghost),
          Last_Touchpoint_Summary__c: summaryParts.join('\n\n').substring(0, 5000) || null,
          Pain_Points__c: ghost.painPoints.join('\n').substring(0, 2000) || null,
          Cold_Reason__c: mapColdReason(ghost.likelyReasonCold),
          Cold_Reason_Detail__c: ghost.likelyReasonCold.substring(0, 2000),
          Re_Engagement_Strategy__c: ghost.reEngagementAngle.substring(0, 3000),
          Status__c: 'Identified',
          Scan_Batch__c: scanBatch,
        };

        // Lookups (only set if we have IDs)
        if (ghost.type !== 'lead' && ghost.accountId) fields.Account__c = ghost.accountId;
        if (ghost.type === 'lead') fields.Lead__c = ghost.recordId;
        if (ghost.type === 'opportunity') fields.Opportunity__c = ghost.recordId;
        if (ghost.contactId) fields.Contact__c = ghost.contactId;
        if (ghost.videoCallId) fields.Video_Call__c = ghost.videoCallId;
        if (ghost.callIntelligenceId) fields.Call_Intelligence__c = ghost.callIntelligenceId;

        return salesforceService.createRecord('Pipeline_Revival__c', fields)
          .then(id => ({ ghost, id }));
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        revivalRecords.push({ ghost: result.value.ghost, revivalId: result.value.id });
      } else {
        revivalErrors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }
  }

  // ── Build output ──────────────────────────────────────────────────────
  if (finalGhosts.length === 0) {
    return `# 👻 Raise the Ghosts — No Ghosts Found

No open deals, prospect accounts, or leads have gone silent for ${minDays}+ days (within the last ${maxDays} days).

**This is good news** — either the team is following up consistently or there aren't many open deals right now.

Try adjusting:
- \`minDaysSilent\`: Lower to 14 or 21 to catch deals going cold sooner
- \`maxDaysSilent\`: Increase to 730 to resurface older prospects
- Remove \`ownerId\` filter to search across all reps`;
  }

  const lines: string[] = [
    '# 👻 Raise the Ghosts — Dead Deals Ready to Revive',
    `*${finalGhosts.length} ghosts found | Silent ${minDays}-${maxDays} days | Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}*`,
    '',
  ];

  // Stats
  const oppGhosts = finalGhosts.filter(g => g.type === 'opportunity');
  const prospectGhosts = finalGhosts.filter(g => g.type === 'prospect_account');
  const leadGhosts = finalGhosts.filter(g => g.type === 'lead');
  const withCallIntel = finalGhosts.filter(g => g.lastCallSummary || g.lastCallTopic);
  const repGroups = new Map<string, GhostProfile[]>();
  for (const g of finalGhosts) {
    const arr = repGroups.get(g.ownerName) || [];
    arr.push(g);
    repGroups.set(g.ownerName, arr);
  }

  lines.push('## 📊 Ghost Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|---|---|');
  lines.push(`| **Total Ghosts** | ${finalGhosts.length} |`);
  if (oppGhosts.length > 0) lines.push(`| Open Opportunities | ${oppGhosts.length} |`);
  if (prospectGhosts.length > 0) lines.push(`| TCI/Prospect Accounts | ${prospectGhosts.length} |`);
  if (leadGhosts.length > 0) lines.push(`| Cold Leads | ${leadGhosts.length} |`);
  lines.push(`| With Call Intelligence | ${withCallIntel.length} |`);
  lines.push(`| Avg Days Silent | ${Math.round(finalGhosts.reduce((s, g) => s + g.daysSilent, 0) / finalGhosts.length)} |`);
  for (const [rep, repGhosts] of repGroups) {
    lines.push(`| ${rep}'s Ghosts | ${repGhosts.length} |`);
  }
  lines.push('');

  // ── Individual Ghost Profiles ─────────────────────────────────────────
  let ghostNum = 0;
  for (const ghost of finalGhosts) {
    ghostNum++;
    const typeEmoji = ghost.type === 'opportunity' ? '💰' : ghost.type === 'prospect_account' ? '🎟️' : '📋';
    const typeLabel = ghost.type === 'opportunity' ? 'Open Deal' : ghost.type === 'prospect_account' ? 'TCI/Prospect' : 'Cold Lead';

    lines.push(`---`);
    lines.push(`### 👻 Ghost #${ghostNum}: ${ghost.accountName}${ghost.contactName ? ` — ${ghost.contactName}` : ''}`);
    lines.push(`${typeEmoji} **${typeLabel}** | 🔇 **${ghost.daysSilent} days silent** | Rep: **${ghost.ownerName}**`);
    if (ghost.opportunityName) {
      lines.push(`💰 Deal: ${ghost.opportunityName} | Stage: ${ghost.opportunityStage || '?'}${ghost.opportunityAmount ? ` | $${ghost.opportunityAmount.toLocaleString()}` : ''}`);
    }
    lines.push(`🔗 ${ghost.sfLink}`);
    const revival = revivalRecords.find(r => r.ghost === ghost);
    if (revival) {
      lines.push(`📋 Pipeline Revival: ${SF_BASE}/lightning/r/Pipeline_Revival__c/${revival.revivalId}/view`);
    }
    lines.push('');

    // Contact info
    lines.push('**Contact:**');
    if (ghost.contactName) lines.push(`- ${ghost.isDoctorContact ? '🩺 Dr.' : '👤'} ${ghost.contactName}${ghost.contactTitle ? ` (${ghost.contactTitle})` : ''}`);
    if (ghost.contactEmail) lines.push(`- 📧 ${ghost.contactEmail}`);
    if (ghost.contactPhone) lines.push(`- 📱 ${ghost.contactPhone}`);
    if (!ghost.contactEmail && !ghost.contactPhone) lines.push('- ⚠️ No contact info on file — check Salesforce or Google the practice');
    lines.push('');

    // Last touchpoint
    lines.push('**Last Touchpoint:**');
    if (ghost.lastCallTopic) {
      lines.push(`- 🎥 Video Call: "${ghost.lastCallTopic}"`);
      if (ghost.lastCallDate) lines.push(`  - Date: ${new Date(ghost.lastCallDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
      if (ghost.lastCallDuration) lines.push(`  - Duration: ${ghost.lastCallDuration} min`);
    }
    if (ghost.lastCallSummary) {
      lines.push('- 🧠 **AI Call Summary:**');
      // Truncate for output but keep enough to draft from
      const summary = ghost.lastCallSummary.substring(0, 1500);
      lines.push(`  ${summary}`);
    }
    if (ghost.lastCallKeyTopics) {
      lines.push(`- 📌 **Key Topics:** ${ghost.lastCallKeyTopics}`);
    }
    if (ghost.lastCallCommitments) {
      lines.push(`- 🤝 **Commitments Made:** ${ghost.lastCallCommitments}`);
    }
    if (ghost.lastCallRiskSignals) {
      lines.push(`- ⚠️ **Risk Signals:** ${ghost.lastCallRiskSignals}`);
    }
    if (ghost.lastTaskSubject && ghost.lastTaskSubject !== ghost.lastCallTopic) {
      lines.push(`- 📝 Last Task: "${ghost.lastTaskSubject}"`);
    }
    if (ghost.lastTaskDescription && !ghost.lastCallSummary) {
      lines.push('- 📝 **Task Notes:**');
      lines.push(`  ${ghost.lastTaskDescription.substring(0, 1000)}`);
    }
    if (ghost.lastEmailSubject) {
      lines.push(`- ✉️ Last Email: "${ghost.lastEmailSubject}" (${ghost.lastEmailDate ? new Date(ghost.lastEmailDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?'})`);
    }
    if (!ghost.lastCallTopic && !ghost.lastTaskSubject && !ghost.lastEmailSubject) {
      lines.push('- ❓ No recorded touchpoint found — check Salesforce activity history manually');
    }
    lines.push('');

    // Analysis
    lines.push('**🧊 Why They Likely Went Cold:**');
    lines.push(`${ghost.likelyReasonCold}`);
    lines.push('');

    lines.push('**💡 Re-Engagement Strategy:**');
    lines.push(`${ghost.reEngagementAngle}`);
    lines.push('');

    // Pain points for article search
    if (ghost.painPoints.length > 0) {
      lines.push('**🎯 Pain Points Identified:**');
      for (const p of ghost.painPoints) {
        lines.push(`- ${p}`);
      }
      lines.push('');
    }

    // Article search instructions
    lines.push('**📰 Article Search (do this now):**');
    lines.push(`1. Web search: \`${ghost.articleSearchQuery}\``);
    lines.push(`2. Competitor angle: \`${ghost.competitorArticleQuery}\``);
    lines.push('   Find an article from a practice similar to theirs (or their competitor) succeeding with the exact thing they discussed.');
    lines.push('');

    // Draft email framework
    const firstName = ghost.contactName?.split(' ')[0] || 'Doctor';
    const repFirst = ghost.ownerName.split(' ')[0] || 'The rep';
    lines.push('**✉️ Draft Email Framework:**');
    lines.push(`- **From:** ${ghost.ownerName}${ghost.ownerEmail ? ` (${ghost.ownerEmail})` : ''}`);
    lines.push(`- **To:** ${ghost.contactEmail || '[FIND EMAIL]'}`);
    lines.push(`- **Subject:** ${ghost.painPoints[0] ? `Quick thought on ${ghost.painPoints[0].substring(0, 50).toLowerCase()}` : `Thought of you — quick read`}`);
    lines.push(`- **Tone:** Friendly, casual, founder-style. NOT salesy. Like a colleague sharing something useful.`);
    lines.push(`- **Framework:**`);
    lines.push('```');
    lines.push(`Hey ${firstName},`);
    lines.push('');
    if (ghost.lastCallTopic) {
      lines.push(`I was thinking about our conversation about ${ghost.painPoints[0]?.toLowerCase() || 'your practice goals'} — just came across this article and immediately thought of you:`);
    } else {
      lines.push('Just came across this article and immediately thought of you:');
    }
    lines.push('');
    lines.push('[PASTE ARTICLE LINK HERE]');
    lines.push('');
    lines.push(`[2-3 sentences about WHY this article is relevant to THEIR specific situation — reference something from the conversation]`);
    lines.push('');
    lines.push(`No agenda here — just thought it was a good read. Hope things are going well at ${ghost.accountName}.`);
    lines.push('');
    lines.push(repFirst);
    lines.push('```');
    lines.push('');
  }

  // ── Pipeline Revival Records Summary ────────────────────────────────
  lines.push('---');
  lines.push('## 📋 Pipeline Revival Records');
  lines.push('');
  if (revivalRecords.length > 0) {
    lines.push(`**${revivalRecords.length} Pipeline_Revival__c records created** (Scan Batch: ${scanBatch})`);
    lines.push('');
    for (const { ghost, revivalId } of revivalRecords) {
      lines.push(`- **${ghost.accountName}** → ${SF_BASE}/lightning/r/Pipeline_Revival__c/${revivalId}/view`);
    }
    lines.push('');
    lines.push('Each record is set to **Status: Identified**. Update status as you progress:');
    lines.push('`Identified` → `Email Drafted` → `Email Sent` → `Reply Received` → `Meeting Booked` → `Re-Engaged`');
    lines.push('');
  }
  if (revivalErrors.length > 0) {
    lines.push(`> ⚠️ ${revivalErrors.length} records failed to create: ${revivalErrors[0]}`);
    lines.push('');
  }

  // ── Action Instructions for Claude ────────────────────────────────────
  lines.push('---');
  lines.push('## ⚡ Next Steps — What To Do Now');
  lines.push('');
  lines.push('For EACH ghost above:');
  lines.push('');
  lines.push('**Step 1: Find the Article**');
  lines.push('Use the article search queries above to find a genuinely useful article. Prioritize:');
  lines.push('- Articles from industry publications (Dental Economics, Dental Products Report, etc.)');
  lines.push('- Case studies showing a similar practice succeeding with the exact service discussed');
  lines.push('- Competitor success stories (most powerful — creates urgency without being salesy)');
  lines.push('- Recent articles (2025-2026) — nothing stale');
  lines.push('');
  lines.push('**Step 2: Draft the Personalized Email**');
  lines.push('Using the framework above, write a complete email for each ghost. Rules:');
  lines.push('- Reference something SPECIFIC from the previous conversation (not generic)');
  lines.push('- Include the article link and explain why it matters to THEM');
  lines.push('- Friendly founder tone — "Hey, saw this and thought of you"');
  lines.push('- NO pitch, NO CTA, NO "let\'s schedule a call" — just value');
  lines.push('- Short — 4-6 sentences max');
  lines.push('');
  lines.push('**Step 3: Create Gmail Drafts**');
  lines.push('Use `gmail_create_draft` for each email so the rep can review and send:');
  lines.push('- **to:** [contact email]');
  lines.push('- **subject:** [from framework above]');
  lines.push('- **body:** [your drafted email with article]');
  lines.push('');
  lines.push('**Step 4: Update Pipeline Revival Records**');
  lines.push('After drafting each email, update the Pipeline_Revival__c record:');
  lines.push('- `Status__c` → `Email Drafted`');
  lines.push('- `Email_Subject__c` → the subject line');
  lines.push('- `Email_Draft__c` → the full email body');
  lines.push('- `Article_URL__c` → the article link');
  lines.push('- `Article_Title__c` → the article title');
  lines.push('');
  lines.push('**Step 5: Schedule Monthly Review**');
  lines.push('Use `gcal_create_event` to create a recurring monthly calendar event:');
  lines.push('- **title:** "Revived Dead Leads — Prophet Review"');
  lines.push('- **date:** 1st of next month, 10:00-11:00 AM');
  lines.push('- **recurrence:** Monthly on the 1st');
  lines.push('- **description:** "Monthly review of ghosted deals revived by Prophet. Run sf_raise_the_ghosts before this meeting to prep."');
  lines.push('- **attendees:** The Sales Rep(s) who own these ghosts');
  lines.push('');

  return lines.join('\n');
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const raiseTheGhostsHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_raise_the_ghosts: handleRaiseTheGhosts,
};
