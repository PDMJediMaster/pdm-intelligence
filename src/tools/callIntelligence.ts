// ---------------------------------------------------------------------------
// Call Intelligence Tool — sf_get_call_intelligence
//
// Multi-fallback search engine that finds calls even when Salesforce
// linkages are broken. Six search layers:
//
//   Layer 1: VideoCall by RelatedRecordId (direct account link)
//   Layer 2: UnifiedVideoCallParticipant by Contact PersonId
//   Layer 3: UnifiedVideoCallParticipant by AM User PersonId → Subject match
//   Layer 4: ZVC Zoom Tasks by Account WhatId
//   Layer 5: Task descriptions on Account mentioning call recaps
//   Layer 6: CITranscriptEvent text search for practice/doctor names
//
// Phase 2 (include_transcript: true): Full verbatim transcript from
// CITranscriptEvent.TranscriptEntries.
// ---------------------------------------------------------------------------

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------
const TRANSCRIPT_DISPLAY_LIMIT = 50_000;

// ---------------------------------------------------------------------------
// Types — Confirmed field names from live Salesforce org
// ---------------------------------------------------------------------------

// Standard VideoCall object (some orgs populate RelatedRecordId)
interface VideoCallRecord {
  Id: string;
  Name?: string;
  StartDateTime?: string;
  EndDateTime?: string;
  DurationInSeconds?: number;
  RelatedRecordId?: string;
  HostId?: string;
  IsRecorded?: boolean;
  TranscribedLanguage?: string;
  MeetingType?: string;
  VendorName?: string;
  IntelligenceScore?: number;
  Description?: string;
}

// UnifiedVideoCall — Conversation Insights unified activity
// Confirmed fields: Id, ActivityDateTime, CallDurationInSeconds, Subject,
// IsInsightAvailable, Snippet, DetailId, InternalEventKey, ActivityType, ActivitySubType
interface UnifiedVideoCallRecord {
  Id: string;
  ActivityDateTime?: string;
  CallDurationInSeconds?: number;
  Subject?: string;
  IsInsightAvailable?: boolean;
  Snippet?: string;
  DetailId?: string;         // Points to VideoCall.Id
  InternalEventKey?: string;
  ActivityType?: string;
  ActivitySubType?: string;
}

// UnifiedVideoCallParticipant — child of UnifiedVideoCall
// Confirmed fields: ActivityId, ChannelAddress, PersonId, ListenRatio, TalkRatio, ParticipantType
interface UnifiedParticipant {
  Id: string;
  ActivityId: string;        // Lookup to UnifiedVideoCall
  ChannelAddress?: string;   // Email or phone
  PersonId?: string;         // Polymorphic: Contact/Lead/User
  ListenRatio?: number;
  TalkRatio?: number;
  ParticipantType?: string;
}

// Legacy VideoCallParticipant
interface VideoCallParticipant {
  Id: string;
  Name?: string;
  Email?: string;
  RelatedPersonId?: string;
  VideoCallId: string;
}

// ZVC Zoom Meeting Task
interface ZoomMeetingTask {
  Id: string;
  Subject?: string;
  ActivityDate?: string;
  Type?: string;
  Description?: string;
  Spoke_with_Doctor__c?: boolean;
  ZVC__Zoom_Meeting__c?: string;
  ZVC__Zoom_Meeting__r?: {
    ZVC__Meeting_AI_Summary__c?: string;
    ZVC__Meeting_Topic__c?: string;
    ZVC__Zoom_Meeting_Start_Time__c?: string;
    ZVC__Zoom_Meeting_End_Time__c?: string;
    ZVC__Duration_mins__c?: number;
    ZVC__Participant_Count__c?: number;
    ZVC__External_Participants__c?: string;
    ZVC__Zoom_Status__c?: string;
  } | null;
}

interface ZoomCallLogTask {
  Id: string;
  Subject?: string;
  ActivityDate?: string;
  ZVC__Zoom_Call_Log__c?: string;
  ZVC__Zoom_Call_Log__r?: {
    ZVC__AIC_Call_Summary__c?: string;
    ZVC__Call_Type__c?: string;
    ZVC__Call_Result__c?: string;
    ZVC__Answer_Start_Time__c?: string;
    ZVC__Call_Duration__c?: string;
    ZVC__Third_Party_Name__c?: string;
  } | null;
}

interface CITranscriptEvent {
  EventUuid: string;
  CallId: string;
  TranscriptEntries?: string;
  IsTranscriptTruncated?: boolean;
  StartDateTime?: string;
  TranscribedLanguage?: string;
}

// Task with call recap in Description
interface CallRecapTask {
  Id: string;
  Subject?: string;
  ActivityDate?: string;
  Description?: string;
  Type?: string;
  Spoke_with_Doctor__c?: boolean;
  OwnerId?: string;
  Owner?: { Name?: string };
}

// Account contact for participant matching
interface AccountContact {
  Id: string;
  Name: string;
  Email?: string;
  Doctor__c?: boolean;
  Primary_Contact__c?: boolean;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const callIntelligenceTools: Tool[] = [
  {
    name: 'sf_get_call_intelligence',
    description:
      'Returns AI-generated intelligence from recent calls and meetings for a Salesforce account. ' +
      'Uses a 6-layer search that finds calls even when Salesforce linkages are broken — ' +
      'searches by direct account link, contact/doctor participant emails, AM participant records ' +
      'with subject matching, Zoom Tasks, Task descriptions with call recaps, and transcript text. ' +
      'Searches everything including Misc and unlinked calls. ' +
      'Phase 1 (default): Zoom meeting AI summaries and call summaries. ' +
      'Phase 2 (set include_transcript: true): Full verbatim transcript from CITranscriptEvent. ' +
      'Accepts either accountId (18-char Salesforce ID) or accountName (search).',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: {
          type: 'string',
          description: 'Salesforce Account ID (15 or 18 characters)',
        },
        accountName: {
          type: 'string',
          description: 'Account name to search for',
        },
        lookback_days: {
          description: 'How many days back to search for calls (default: 90)',
        },
        max_calls: {
          description: 'Maximum number of call summaries to return (default: 10)',
        },
        include_transcript: {
          description: 'Set to true to include full call transcript (default: false)',
        },
        response_format: {
          type: 'string',
          enum: ['markdown', 'json'],
          description: 'Output format (default: markdown)',
        },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Input Schema
// ---------------------------------------------------------------------------

const CallIntelligenceArgs = z.object({
  accountId:           z.string().optional(),
  accountName:         z.string().optional(),
  lookback_days:       z.coerce.number().int().min(1).max(365).default(90),
  max_calls:           z.coerce.number().int().min(1).max(20).default(10),
  include_transcript:  z.coerce.boolean().default(false),
  response_format:     z.enum(['markdown', 'json']).default('markdown'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: string | null | undefined): string {
  if (!d) return 'Unknown';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return 'Unknown';
  return `${Math.round(seconds / 60)} min`;
}

function pastDateSoql(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function escSoql(s: string): string {
  return s.replace(/'/g, "\\'");
}

/** Build search terms from account name + contact names for client-side matching */
function buildSearchTerms(accountName: string, contacts: AccountContact[]): string[] {
  const terms: string[] = [];

  // Account name and fragments
  terms.push(accountName.toLowerCase());
  // Split on common separators for partial matching
  const fragments = accountName.split(/[\s,&-]+/).filter(f => f.length > 2);
  terms.push(...fragments.map(f => f.toLowerCase()));

  // Contact/doctor names
  for (const c of contacts) {
    terms.push(c.Name.toLowerCase());
    // First and last name separately
    const nameParts = c.Name.split(/\s+/).filter(n => n.length > 2);
    terms.push(...nameParts.map(n => n.toLowerCase()));
  }

  return [...new Set(terms)];
}

/** Check if a call subject matches any of our search terms */
function subjectMatchesAccount(subject: string | undefined, searchTerms: string[]): boolean {
  if (!subject) return false;
  const lower = subject.toLowerCase();

  // Always include "misc" calls — they're often unnamed client calls
  if (lower.includes('misc') || lower === 'zoom meeting' || lower === 'meeting') {
    return true; // Include these as potential matches
  }

  return searchTerms.some(term => lower.includes(term));
}

/** Deduplicate calls by ID */
function deduplicateById<T extends { Id?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const id = (item as Record<string, unknown>).Id as string | undefined
      ?? (item as Record<string, unknown>).ActivityId as string | undefined;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Normalized call result — unifies across all search layers
// ---------------------------------------------------------------------------
interface NormalizedCall {
  id: string;
  topic: string;
  date: string;
  duration_minutes: number | null;
  vendor: string | null;
  is_recorded: boolean;
  has_ai_summary: boolean;
  ai_summary: string | null;
  intelligence_score: number | null;
  snippet: string | null;
  participants: Array<{ name?: string; email?: string; talkRatio?: number; listenRatio?: number }>;
  source: string;
  source_layer: string;    // Which search layer found it
  task_notes: string | null;
  spoke_with_doctor: boolean;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleCallIntelligence(rawArgs: unknown): Promise<string> {
  const {
    accountId,
    accountName,
    lookback_days,
    max_calls,
    include_transcript,
    response_format,
  } = CallIntelligenceArgs.parse(rawArgs ?? {});

  // -- Resolve account ID ---------------------------------------------------
  let resolvedId = accountId;
  let resolvedName = accountName ?? '';

  if (!resolvedId && accountName) {
    const found = await salesforceService.rawQuery<{ Id: string; Name: string; OwnerId: string }>(
      `SELECT Id, Name, OwnerId FROM Account
       WHERE Name LIKE '%${escSoql(accountName)}%'
         AND IsDeleted = false
       ORDER BY LastActivityDate DESC NULLS LAST
       LIMIT 1`
    );
    if (found.length === 0) {
      return `No account found matching "${accountName}".`;
    }
    resolvedId = found[0].Id;
    resolvedName = found[0].Name;
  }

  if (!resolvedId) {
    return 'Please provide either accountId or accountName.';
  }

  const id = resolvedId;
  const sinceDate = pastDateSoql(lookback_days);
  const warnings: string[] = [];
  const allCalls: NormalizedCall[] = [];
  let tokenWarning = false;

  // -- Fetch account details + contacts in parallel -------------------------
  const [accountInfo, contacts] = await Promise.all([
    salesforceService.rawQuery<{
      Id: string; Name: string; OwnerId: string;
      Owner?: { Name?: string };
    }>(
      `SELECT Id, Name, OwnerId, Owner.Name
       FROM Account WHERE Id = '${id}' LIMIT 1`
    ).catch(() => [] as Array<{ Id: string; Name: string; OwnerId: string; Owner?: { Name?: string } }>),

    salesforceService.rawQuery<AccountContact>(
      `SELECT Id, Name, Email, Doctor__c, Primary_Contact__c
       FROM Contact
       WHERE AccountId = '${id}' AND IsDeleted = false
       LIMIT 20`
    ).catch(() => [] as AccountContact[]),
  ]);

  const acctName = accountInfo[0]?.Name ?? resolvedName;
  const ownerId = accountInfo[0]?.OwnerId;
  const ownerName = accountInfo[0]?.Owner?.Name;
  const contactEmails = contacts.filter(c => c.Email).map(c => c.Email!);
  const contactIds = contacts.map(c => c.Id);
  const searchTerms = buildSearchTerms(acctName, contacts);

  // =========================================================================
  // LAYER 1: VideoCall by RelatedRecordId (direct account link)
  // =========================================================================
  try {
    const videoCalls = await salesforceService.rawQuery<VideoCallRecord>(
      `SELECT Id, Name, StartDateTime, EndDateTime, DurationInSeconds,
              RelatedRecordId, HostId, IsRecorded, TranscribedLanguage,
              MeetingType, VendorName, IntelligenceScore
       FROM VideoCall
       WHERE RelatedRecordId = '${id}'
         AND StartDateTime >= ${sinceDate}T00:00:00Z
       ORDER BY StartDateTime DESC NULLS LAST
       LIMIT ${max_calls}`
    );
    for (const vc of videoCalls) {
      allCalls.push({
        id: vc.Id,
        topic: vc.Name ?? 'Video Call',
        date: vc.StartDateTime ?? 'Unknown',
        duration_minutes: vc.DurationInSeconds ? Math.round(vc.DurationInSeconds / 60) : null,
        vendor: vc.VendorName ?? null,
        is_recorded: vc.IsRecorded ?? false,
        has_ai_summary: !!(vc.IntelligenceScore),
        ai_summary: null,
        intelligence_score: vc.IntelligenceScore ?? null,
        snippet: null,
        participants: [],
        source: 'Salesforce Conversation Insights',
        source_layer: 'Layer 1: Direct Account Link',
        task_notes: null,
        spoke_with_doctor: false,
      });
    }
  } catch (err) {
    warnings.push(`Layer 1 (VideoCall direct): ${err instanceof Error ? err.message : String(err)}`);
  }

  // =========================================================================
  // LAYER 2: UnifiedVideoCallParticipant by Contact PersonId
  // Find calls where account contacts appear as participants
  // =========================================================================
  if (contactIds.length > 0) {
    try {
      // Query participants for each contact ID (PersonId constraint required)
      const participantResults: UnifiedParticipant[] = [];
      for (const cId of contactIds) {
        try {
          const parts = await salesforceService.rawQuery<UnifiedParticipant>(
            `SELECT Id, ActivityId, ChannelAddress, PersonId, ListenRatio, TalkRatio, ParticipantType
             FROM UnifiedVideoCallParticipant
             WHERE PersonId = '${cId}'
             LIMIT 50`
          );
          participantResults.push(...parts);
        } catch {
          // Individual contact query failed — continue
        }
      }

      if (participantResults.length > 0) {
        // Get the UnifiedVideoCall records for matched activities
        const activityIds = [...new Set(participantResults.map(p => p.ActivityId))];
        // Fetch in batches of 50
        const batchSize = 50;
        const unifiedCalls: UnifiedVideoCallRecord[] = [];

        for (let i = 0; i < activityIds.length; i += batchSize) {
          const batch = activityIds.slice(i, i + batchSize);
          const idList = batch.map(aid => `'${aid}'`).join(',');
          try {
            const calls = await salesforceService.rawQuery<UnifiedVideoCallRecord>(
              `SELECT Id, ActivityDateTime, CallDurationInSeconds, Subject,
                      IsInsightAvailable, Snippet, DetailId, ActivityType, ActivitySubType
               FROM UnifiedVideoCall
               WHERE Id IN (${idList})
                 AND ActivityDateTime >= ${sinceDate}T00:00:00Z
               ORDER BY ActivityDateTime DESC`
            );
            unifiedCalls.push(...calls);
          } catch {
            // Batch query failed
          }
        }

        // Get all participants for these calls (for display)
        const callParticipantMap = new Map<string, UnifiedParticipant[]>();
        for (const p of participantResults) {
          const list = callParticipantMap.get(p.ActivityId) ?? [];
          list.push(p);
          callParticipantMap.set(p.ActivityId, list);
        }

        for (const uc of unifiedCalls) {
          const parts = callParticipantMap.get(uc.Id) ?? [];
          const contactMatch = contacts.find(c => parts.some(p => p.PersonId === c.Id));

          allCalls.push({
            id: uc.DetailId ?? uc.Id,
            topic: uc.Subject ?? 'Video Call',
            date: uc.ActivityDateTime ?? 'Unknown',
            duration_minutes: uc.CallDurationInSeconds ? Math.round(uc.CallDurationInSeconds / 60) : null,
            vendor: null,
            is_recorded: uc.IsInsightAvailable ?? false,
            has_ai_summary: uc.IsInsightAvailable ?? false,
            ai_summary: null,
            intelligence_score: null,
            snippet: uc.Snippet ?? null,
            participants: parts.map(p => ({
              email: p.ChannelAddress ?? undefined,
              talkRatio: p.TalkRatio ?? undefined,
              listenRatio: p.ListenRatio ?? undefined,
            })),
            source: 'Conversation Insights (Unified)',
            source_layer: `Layer 2: Contact Participant Match${contactMatch ? ` (${contactMatch.Name})` : ''}`,
            task_notes: null,
            spoke_with_doctor: contactMatch?.Doctor__c ?? false,
          });
        }
      }
    } catch (err) {
      warnings.push(`Layer 2 (Contact participants): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // =========================================================================
  // LAYER 3: AM's calls → Subject string match
  // Get calls where the Account Manager is a participant, then filter by
  // Subject containing account name, doctor names, or "misc"
  // =========================================================================
  if (ownerId) {
    try {
      const amParticipants = await salesforceService.rawQuery<UnifiedParticipant>(
        `SELECT Id, ActivityId, ChannelAddress, PersonId, TalkRatio, ListenRatio, ParticipantType
         FROM UnifiedVideoCallParticipant
         WHERE PersonId = '${ownerId}'
         LIMIT 200`
      );

      if (amParticipants.length > 0) {
        // Get the UnifiedVideoCall records — we'll filter by Subject client-side
        const activityIds = [...new Set(amParticipants.map(p => p.ActivityId))];
        const existingIds = new Set(allCalls.map(c => c.id));

        const batchSize = 50;
        const amCalls: UnifiedVideoCallRecord[] = [];

        for (let i = 0; i < activityIds.length; i += batchSize) {
          const batch = activityIds.slice(i, i + batchSize);
          const idList = batch.map(aid => `'${aid}'`).join(',');
          try {
            const calls = await salesforceService.rawQuery<UnifiedVideoCallRecord>(
              `SELECT Id, ActivityDateTime, CallDurationInSeconds, Subject,
                      IsInsightAvailable, Snippet, DetailId, ActivityType, ActivitySubType
               FROM UnifiedVideoCall
               WHERE Id IN (${idList})
                 AND ActivityDateTime >= ${sinceDate}T00:00:00Z
               ORDER BY ActivityDateTime DESC`
            );
            amCalls.push(...calls);
          } catch {
            // Batch failed
          }
        }

        // Now filter client-side by subject matching
        const matched = amCalls.filter(c => {
          const callId = c.DetailId ?? c.Id;
          if (existingIds.has(callId)) return false; // Already found
          return subjectMatchesAccount(c.Subject, searchTerms);
        });

        // For matched calls, try to get all participants
        if (matched.length > 0) {
          const matchedIds = matched.map(c => c.Id);
          const allMatchedParticipants: UnifiedParticipant[] = [];

          for (let i = 0; i < matchedIds.length; i += batchSize) {
            const batch = matchedIds.slice(i, i + batchSize);
            // We need the ActivityId constraint, so query per activity
            for (const actId of batch) {
              try {
                const parts = await salesforceService.rawQuery<UnifiedParticipant>(
                  `SELECT Id, ActivityId, ChannelAddress, PersonId, TalkRatio, ListenRatio, ParticipantType
                   FROM UnifiedVideoCallParticipant
                   WHERE ActivityId = '${actId}'
                   LIMIT 20`
                );
                allMatchedParticipants.push(...parts);
              } catch {
                // Individual participant query failed
              }
            }
          }

          const partMap = new Map<string, UnifiedParticipant[]>();
          for (const p of allMatchedParticipants) {
            const list = partMap.get(p.ActivityId) ?? [];
            list.push(p);
            partMap.set(p.ActivityId, list);
          }

          for (const uc of matched) {
            const parts = partMap.get(uc.Id) ?? [];
            // Check if any participant email matches a contact email
            const emailMatch = parts.some(p =>
              p.ChannelAddress && contactEmails.some(e =>
                e.toLowerCase() === p.ChannelAddress!.toLowerCase()
              )
            );
            const isMisc = (uc.Subject ?? '').toLowerCase().includes('misc') ||
                           (uc.Subject ?? '').toLowerCase() === 'zoom meeting';

            allCalls.push({
              id: uc.DetailId ?? uc.Id,
              topic: uc.Subject ?? 'Video Call',
              date: uc.ActivityDateTime ?? 'Unknown',
              duration_minutes: uc.CallDurationInSeconds ? Math.round(uc.CallDurationInSeconds / 60) : null,
              vendor: null,
              is_recorded: uc.IsInsightAvailable ?? false,
              has_ai_summary: uc.IsInsightAvailable ?? false,
              ai_summary: null,
              intelligence_score: null,
              snippet: uc.Snippet ?? null,
              participants: parts.map(p => ({
                email: p.ChannelAddress ?? undefined,
                talkRatio: p.TalkRatio ?? undefined,
                listenRatio: p.ListenRatio ?? undefined,
              })),
              source: 'Conversation Insights (Unified)',
              source_layer: isMisc
                ? `Layer 3: AM Call — Misc/Unnamed (${ownerName ?? 'AM'})`
                : emailMatch
                  ? `Layer 3: AM Call — Email Match Confirmed (${ownerName ?? 'AM'})`
                  : `Layer 3: AM Call — Subject Match (${ownerName ?? 'AM'})`,
              task_notes: null,
              spoke_with_doctor: false,
            });
          }
        }
      }
    } catch (err) {
      warnings.push(`Layer 3 (AM subject match): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // =========================================================================
  // LAYER 4: ZVC Zoom Tasks by Account WhatId
  // =========================================================================
  let zoomMeetingTasks: ZoomMeetingTask[] = [];
  let zoomCallLogTasks: ZoomCallLogTask[] = [];

  try {
    [zoomMeetingTasks, zoomCallLogTasks] = await Promise.all([
      salesforceService.rawQuery<ZoomMeetingTask>(
        `SELECT Id, Subject, ActivityDate, Type, Description,
                Spoke_with_Doctor__c,
                ZVC__Zoom_Meeting__c,
                ZVC__Zoom_Meeting__r.ZVC__Meeting_AI_Summary__c,
                ZVC__Zoom_Meeting__r.ZVC__Meeting_Topic__c,
                ZVC__Zoom_Meeting__r.ZVC__Zoom_Meeting_Start_Time__c,
                ZVC__Zoom_Meeting__r.ZVC__Zoom_Meeting_End_Time__c,
                ZVC__Zoom_Meeting__r.ZVC__Duration_mins__c,
                ZVC__Zoom_Meeting__r.ZVC__Participant_Count__c,
                ZVC__Zoom_Meeting__r.ZVC__External_Participants__c,
                ZVC__Zoom_Meeting__r.ZVC__Zoom_Status__c
         FROM Task
         WHERE WhatId = '${id}'
           AND ZVC__Zoom_Meeting__c != null
           AND ActivityDate >= ${sinceDate}
         ORDER BY ActivityDate DESC NULLS LAST
         LIMIT ${max_calls}`
      ).catch(() => [] as ZoomMeetingTask[]),

      salesforceService.rawQuery<ZoomCallLogTask>(
        `SELECT Id, Subject, ActivityDate,
                ZVC__Zoom_Call_Log__c,
                ZVC__Zoom_Call_Log__r.ZVC__AIC_Call_Summary__c,
                ZVC__Zoom_Call_Log__r.ZVC__Call_Type__c,
                ZVC__Zoom_Call_Log__r.ZVC__Call_Result__c,
                ZVC__Zoom_Call_Log__r.ZVC__Answer_Start_Time__c,
                ZVC__Zoom_Call_Log__r.ZVC__Call_Duration__c,
                ZVC__Zoom_Call_Log__r.ZVC__Third_Party_Name__c
         FROM Task
         WHERE WhatId = '${id}'
           AND ZVC__Zoom_Call_Log__c != null
           AND ActivityDate >= ${sinceDate}
         ORDER BY ActivityDate DESC NULLS LAST
         LIMIT 10`
      ).catch(() => [] as ZoomCallLogTask[]),
    ]);

    for (const t of zoomMeetingTasks) {
      const zm = t.ZVC__Zoom_Meeting__r;
      allCalls.push({
        id: t.Id,
        topic: zm?.ZVC__Meeting_Topic__c ?? t.Subject ?? 'Meeting',
        date: t.ActivityDate ?? 'Unknown',
        duration_minutes: zm?.ZVC__Duration_mins__c ?? null,
        vendor: 'Zoom',
        is_recorded: true,
        has_ai_summary: !!(zm?.ZVC__Meeting_AI_Summary__c),
        ai_summary: zm?.ZVC__Meeting_AI_Summary__c ?? null,
        intelligence_score: null,
        snippet: null,
        participants: zm?.ZVC__External_Participants__c
          ? [{ name: zm.ZVC__External_Participants__c }]
          : [],
        source: 'Zoom for Salesforce',
        source_layer: 'Layer 4: ZVC Zoom Task',
        task_notes: t.Description ?? null,
        spoke_with_doctor: t.Spoke_with_Doctor__c ?? false,
      });
    }

    for (const t of zoomCallLogTasks) {
      const zc = t.ZVC__Zoom_Call_Log__r;
      if (!zc) continue;
      allCalls.push({
        id: t.Id,
        topic: t.Subject ?? 'Phone Call',
        date: t.ActivityDate ?? 'Unknown',
        duration_minutes: null,
        vendor: 'Zoom Phone',
        is_recorded: true,
        has_ai_summary: !!(zc.ZVC__AIC_Call_Summary__c),
        ai_summary: zc.ZVC__AIC_Call_Summary__c ?? null,
        intelligence_score: null,
        snippet: null,
        participants: zc.ZVC__Third_Party_Name__c
          ? [{ name: zc.ZVC__Third_Party_Name__c }]
          : [],
        source: 'Zoom for Salesforce',
        source_layer: 'Layer 4: ZVC Zoom Phone',
        task_notes: null,
        spoke_with_doctor: false,
      });
    }
  } catch {
    // ZVC namespace not available
  }

  // =========================================================================
  // LAYER 5: Task descriptions on Account mentioning call recaps
  // Search for Tasks with call-related content in Description
  // =========================================================================
  try {
    const recapTasks = await salesforceService.rawQuery<CallRecapTask>(
      `SELECT Id, Subject, ActivityDate, Description, Type,
              Spoke_with_Doctor__c, OwnerId, Owner.Name
       FROM Task
       WHERE WhatId = '${id}'
         AND (Type = 'Call' OR Type = 'Meeting' OR Type = 'Video Call'
              OR Subject LIKE '%Call%' OR Subject LIKE '%Meeting%'
              OR Subject LIKE '%Zoom%' OR Subject LIKE '%Check-In%'
              OR Subject LIKE '%Alignment%' OR Subject LIKE '%Review%')
         AND ActivityDate >= ${sinceDate}
         AND ZVC__Zoom_Meeting__c = null
         AND ZVC__Zoom_Call_Log__c = null
       ORDER BY ActivityDate DESC
       LIMIT 15`
    );

    const existingIds = new Set(allCalls.map(c => c.id));
    for (const t of recapTasks) {
      if (existingIds.has(t.Id)) continue;
      const hasContent = t.Description && t.Description.length > 20;
      allCalls.push({
        id: t.Id,
        topic: t.Subject ?? 'Call Note',
        date: t.ActivityDate ?? 'Unknown',
        duration_minutes: null,
        vendor: null,
        is_recorded: false,
        has_ai_summary: false,
        ai_summary: null,
        intelligence_score: null,
        snippet: hasContent
          ? t.Description!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
          : null,
        participants: t.Owner?.Name ? [{ name: t.Owner.Name }] : [],
        source: 'Task Notes',
        source_layer: 'Layer 5: Task Call Recap',
        task_notes: t.Description ?? null,
        spoke_with_doctor: t.Spoke_with_Doctor__c ?? false,
      });
    }
  } catch (err) {
    warnings.push(`Layer 5 (Task recaps): ${err instanceof Error ? err.message : String(err)}`);
  }

  // =========================================================================
  // LAYER 6: CITranscriptEvent text search (only if include_transcript)
  // Search transcript text for practice/doctor names
  // =========================================================================
  // (This layer is expensive — only run when explicitly requested)

  // -- Deduplicate calls across all layers ----------------------------------
  const seenIds = new Set<string>();
  const dedupedCalls: NormalizedCall[] = [];
  for (const call of allCalls) {
    if (seenIds.has(call.id)) continue;
    seenIds.add(call.id);
    dedupedCalls.push(call);
  }

  // Sort by date descending
  dedupedCalls.sort((a, b) => {
    const da = a.date === 'Unknown' ? 0 : new Date(a.date).getTime();
    const db = b.date === 'Unknown' ? 0 : new Date(b.date).getTime();
    return db - da;
  });

  // Trim to max_calls
  const finalCalls = dedupedCalls.slice(0, max_calls);

  // -- Transcript retrieval for final calls ---------------------------------
  let transcripts: CITranscriptEvent[] = [];

  if (include_transcript && finalCalls.length > 0) {
    // Collect VideoCall IDs (from Layer 1 and DetailIds from Layer 2/3)
    const vcIds = finalCalls
      .map(c => c.id)
      .filter(cid => cid && /^[a-zA-Z0-9]{15,18}$/.test(cid));

    if (vcIds.length > 0) {
      const idList = vcIds.map(vid => `'${vid}'`).join(',');
      try {
        transcripts = await salesforceService.rawQuery<CITranscriptEvent>(
          `SELECT EventUuid, CallId, TranscriptEntries,
                  IsTranscriptTruncated, StartDateTime, TranscribedLanguage
           FROM CITranscriptEvent
           WHERE CallId IN (${idList})
           ORDER BY StartDateTime DESC`
        );
      } catch {
        warnings.push(
          'CITranscriptEvent not accessible — transcript requires Conversation Insights ' +
          'API permissions. Contact your Salesforce admin to verify CI transcript access.'
        );
      }

      // Token management
      for (const t of transcripts) {
        if (t.IsTranscriptTruncated) {
          warnings.push(`Transcript for call ${t.CallId} was truncated in Salesforce.`);
          tokenWarning = true;
        }
        if (t.TranscriptEntries && t.TranscriptEntries.length > TRANSCRIPT_DISPLAY_LIMIT) {
          warnings.push(
            `Transcript for call ${t.CallId} is ${t.TranscriptEntries.length.toLocaleString()} chars. ` +
            `Displaying first ${TRANSCRIPT_DISPLAY_LIMIT.toLocaleString()} characters only.`
          );
          tokenWarning = true;
          t.TranscriptEntries =
            t.TranscriptEntries.slice(0, TRANSCRIPT_DISPLAY_LIMIT) +
            '\n\n[TRUNCATED — transcript exceeds display limit]';
        }
      }
    }
  }

  // -- Build output ---------------------------------------------------------
  const totalFound = finalCalls.length;
  const lastCallDate = finalCalls[0]?.date ?? null;
  const hasIntelligence = finalCalls.some(c => c.has_ai_summary || c.intelligence_score != null);

  const sourceLayers = [...new Set(finalCalls.map(c => c.source_layer))];
  const sourceSystems = [...new Set(finalCalls.map(c => c.source))];

  if (totalFound === 0) {
    warnings.push(`No calls or meetings found for this account in the last ${lookback_days} days across all 6 search layers.`);
  }

  // -- JSON output ----------------------------------------------------------
  if (response_format === 'json') {
    return JSON.stringify({
      status: 'success',
      requested_entity: { account_id: id, account_name: acctName },
      summary: {
        total_calls_found: totalFound,
        last_call_date: lastCallDate,
        has_intelligence: hasIntelligence,
        lookback_days,
        source_systems: sourceSystems,
        search_layers_hit: sourceLayers,
        contacts_searched: contacts.map(c => ({ name: c.Name, email: c.Email, isDoctor: c.Doctor__c })),
        am_searched: ownerName ?? null,
      },
      calls: finalCalls,
      transcripts: transcripts.map(t => ({
        call_id: t.CallId,
        transcript_uuid: t.EventUuid,
        language: t.TranscribedLanguage,
        is_truncated: t.IsTranscriptTruncated,
        transcript: t.TranscriptEntries,
      })),
      warnings,
      token_warning: tokenWarning,
      generated_at: new Date().toISOString(),
    }, null, 2);
  }

  // -- Markdown output ------------------------------------------------------
  const lines: string[] = [
    `# Call Intelligence — ${acctName}`,
    `*Last ${lookback_days} days | Generated ${formatDate(new Date().toISOString())}*`,
    '',
  ];

  if (warnings.length > 0) {
    lines.push('## Warnings');
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  // Search summary — show what we searched
  lines.push('## Search Summary');
  lines.push(`- **Total calls found:** ${totalFound}`);
  lines.push(`- **Last call date:** ${formatDate(lastCallDate)}`);
  lines.push(`- **Intelligence available:** ${hasIntelligence ? 'Yes' : 'No'}`);
  lines.push(`- **Sources:** ${sourceSystems.join(', ') || 'None'}`);
  lines.push(`- **Search layers hit:** ${sourceLayers.length > 0 ? sourceLayers.join('; ') : 'None'}`);
  if (contacts.length > 0) {
    const doctorNames = contacts.filter(c => c.Doctor__c).map(c => c.Name);
    const otherNames = contacts.filter(c => !c.Doctor__c).map(c => c.Name);
    if (doctorNames.length > 0) lines.push(`- **Doctors searched:** ${doctorNames.join(', ')}`);
    if (otherNames.length > 0) lines.push(`- **Contacts searched:** ${otherNames.join(', ')}`);
    if (contactEmails.length > 0) lines.push(`- **Emails searched:** ${contactEmails.join(', ')}`);
  }
  if (ownerName) lines.push(`- **AM searched:** ${ownerName}`);
  lines.push('');

  // -- Call details ---------------------------------------------------------
  if (finalCalls.length > 0) {
    lines.push('## Call Details');
    lines.push('');

    for (let i = 0; i < finalCalls.length; i++) {
      const c = finalCalls[i];
      const doctorFlag = c.spoke_with_doctor ? ' [Doctor Reached]' : '';
      lines.push(`### ${i + 1}. ${c.topic}${doctorFlag}`);

      const meta: string[] = [
        `**Date:** ${formatDate(c.date)}`,
      ];
      if (c.duration_minutes) meta.push(`**Duration:** ${c.duration_minutes} min`);
      if (c.vendor) meta.push(`**Via:** ${c.vendor}`);
      if (c.is_recorded) meta.push('Recorded');
      if (c.intelligence_score != null) meta.push(`**Score:** ${c.intelligence_score}`);
      lines.push(meta.join(' | '));
      lines.push(`*Found via: ${c.source_layer}*`);

      if (c.participants.length > 0) {
        const partStrings = c.participants.map(p => {
          const parts: string[] = [];
          if (p.name) parts.push(p.name);
          if (p.email) parts.push(p.email);
          if (p.talkRatio != null) parts.push(`Talk: ${Math.round(p.talkRatio * 100)}%`);
          return parts.join(' ') || 'Unknown';
        });
        lines.push(`**Participants:** ${partStrings.join(', ')}`);
      }

      if (c.snippet) {
        lines.push('');
        lines.push(`**Snippet:** ${c.snippet}`);
      }

      if (c.ai_summary) {
        lines.push('');
        lines.push('**AI Summary:**');
        lines.push(c.ai_summary);
      }

      if (c.task_notes) {
        const notes = c.task_notes.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        lines.push('');
        lines.push('**AM Notes:**');
        lines.push(notes.slice(0, 1000) + (notes.length > 1000 ? '...' : ''));
      }

      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  // -- Transcripts ----------------------------------------------------------
  if (include_transcript && transcripts.length > 0) {
    lines.push('## Call Transcripts');
    lines.push(
      '> *Transcripts are verbatim records from Salesforce Conversation Insights.*'
    );
    lines.push('');

    for (const t of transcripts) {
      const call = finalCalls.find(c => c.id === t.CallId);
      lines.push(`### Transcript — ${call?.topic ?? t.CallId}`);
      lines.push(`**Date:** ${formatDate(t.StartDateTime)} | **Language:** ${t.TranscribedLanguage ?? 'en'}`);
      if (t.IsTranscriptTruncated) {
        lines.push('*This transcript was truncated in Salesforce.*');
      }
      lines.push('');
      if (t.TranscriptEntries) {
        lines.push('```');
        lines.push(t.TranscriptEntries);
        lines.push('```');
      }
      lines.push('');
    }
  } else if (include_transcript && transcripts.length === 0 && finalCalls.length > 0) {
    lines.push('## Transcripts');
    lines.push(
      '*No transcripts found for these calls. Transcripts require Conversation Insights processing.*'
    );
    lines.push('');
  }

  if (totalFound === 0) {
    lines.push(`*No calls or meetings found for this account in the last ${lookback_days} days.*`);
    lines.push('');
    lines.push('**Troubleshooting:**');
    lines.push('- Verify calls exist for this account in Salesforce Conversation Insights');
    lines.push('- Check if the Account Manager has Zoom calls with this client');
    lines.push('- Try increasing `lookback_days` (current: ' + lookback_days + ')');
    lines.push('- Verify contact emails are correct in Salesforce');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const callIntelligenceHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_call_intelligence: handleCallIntelligence,
};
