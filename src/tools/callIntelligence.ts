// ─────────────────────────────────────────────────────────────────────────────
// Call Intelligence Tool
// - sf_get_call_intelligence
//
// Phase 1: Zoom AI Summary path (Task → ZVC__Zoom_Meeting__r and
//          Task → ZVC__Zoom_Call_Log__r). No transcript token management needed.
//
// Phase 2: Salesforce Conversation Insights path (UnifiedVideoCall →
//          CITranscriptEvent). Requires Account relationship verification first.
//          Enabled via include_transcript: true.
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─────────────────────────────────────────────────────────────────────────────
// Governance: max transcript characters to pass to output before warning.
// Full TranscriptEntries can be up to 250,000 chars. We surface a warning
// above this threshold and truncate for display.
// ─────────────────────────────────────────────────────────────────────────────
const TRANSCRIPT_DISPLAY_LIMIT = 50_000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

// Salesforce Conversation Insights — VideoCall object
// Confirmed VideoCall field names from Salesforce org describe
interface VideoCallRecord {
  Id: string;
  Name?: string;               // Text(255) — call title
  StartDateTime?: string;      // Date/Time — call started
  EndDateTime?: string;        // Date/Time — call ended
  DurationInSeconds?: number;  // Number(8,0) — call duration
  RelatedRecordId?: string;    // Lookup(Account,...) — the account link
  HostId?: string;             // Lookup(User) — host/owner
  IsRecorded?: boolean;
  TranscribedLanguage?: string;
  MeetingType?: string;
  VendorName?: string;
  IntelligenceScore?: number;
  Description?: string;
}

// VideoCallParticipant — child of VideoCall
interface VideoCallParticipant {
  Id: string;
  Name?: string;
  Email?: string;
  RelatedPersonId?: string;
  VideoCallId: string;
}

// ZVC Zoom Meeting Task (secondary path — kept for orgs using Zoom for Salesforce integration)
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


// ─────────────────────────────────────────────────────────────────────────────
// Tool Definition
// ─────────────────────────────────────────────────────────────────────────────

export const callIntelligenceTools: Tool[] = [
  {
    name: 'sf_get_call_intelligence',
    description:
      'Returns AI-generated intelligence from recent calls and meetings for a Salesforce account. ' +
      'Phase 1 (default): Zoom meeting AI summaries and Zoom Phone call AI summaries, ' +
      'including meeting topic, date, duration, participant count, and external participants. ' +
      'Phase 2 (set include_transcript: true): Full verbatim transcript from ' +
      'CITranscriptEvent.TranscriptEntries — transcripts over 50,000 characters will be ' +
      'flagged and truncated. Accepts either accountId (18-char Salesforce ID) or accountName (search).',
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
          description: 'Maximum number of call summaries to return (default: 5)',
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

// ─────────────────────────────────────────────────────────────────────────────
// Input Schema
// ─────────────────────────────────────────────────────────────────────────────

const CallIntelligenceArgs = z.object({
  accountId:           z.string().optional(),
  accountName:         z.string().optional(),
  lookback_days:       z.coerce.number().int().min(1).max(365).default(90),
  max_calls:           z.coerce.number().int().min(1).max(10).default(5),
  include_transcript:  z.coerce.boolean().default(false),
  response_format:     z.enum(['markdown', 'json']).default('markdown'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleCallIntelligence(rawArgs: unknown): Promise<string> {
  const {
    accountId,
    accountName,
    lookback_days,
    max_calls,
    include_transcript,
    response_format,
  } = CallIntelligenceArgs.parse(rawArgs ?? {});

  // ── Resolve account ID ──────────────────────────────────────────────────
  let resolvedId = accountId;

  if (!resolvedId && accountName) {
    const found = await salesforceService.rawQuery<{ Id: string; Name: string }>(
      `SELECT Id, Name FROM Account
       WHERE Name LIKE '%${accountName.replace(/'/g, "\\'")}%'
         AND IsDeleted = false
       ORDER BY LastActivityDate DESC NULLS LAST
       LIMIT 1`
    );
    if (found.length === 0) {
      return `No account found matching "${accountName}".`;
    }
    resolvedId = found[0].Id;
  }

  if (!resolvedId) {
    return 'Please provide either accountId or accountName.';
  }

  const id = resolvedId;
  const sinceDate = pastDateSoql(lookback_days);
  const warnings: string[] = [];
  let tokenWarning = false;

  // ── PRIMARY: Salesforce Conversation Insights — VideoCall ────────────────
  // PDM uses Salesforce Conversation Insights. VideoCall records are linked
  // to Account via WhatId. This is the authoritative call data source.
  let videoCalls: VideoCallRecord[] = [];
  let videoCallError = false;
  try {
    // Try VideoCall first (standard Salesforce Conversation Insights object)
    // Confirmed field names from Salesforce org describe:
    // StartDateTime, DurationInSeconds, RelatedRecordId (account link), HostId
    videoCalls = await salesforceService.rawQuery<VideoCallRecord>(
      `SELECT Id, Name, StartDateTime, EndDateTime, DurationInSeconds,
              RelatedRecordId, HostId, IsRecorded, TranscribedLanguage,
              MeetingType, VendorName, IntelligenceScore
       FROM VideoCall
       WHERE RelatedRecordId = '${id}'
         AND StartDateTime >= ${sinceDate}T00:00:00Z
       ORDER BY StartDateTime DESC NULLS LAST
       LIMIT ${max_calls}`
    );
  } catch (outerErr) {
    videoCallError = true;
    warnings.push(`VideoCall query error: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}`);
  }

  // ── SECONDARY: ZVC Zoom Meeting Tasks (fallback for Zoom for Salesforce) ─
  let zoomMeetingTasks: ZoomMeetingTask[] = [];
  let zoomCallLogTasks: ZoomCallLogTask[] = [];
  // Only query ZVC if VideoCall returned nothing — avoids duplicate data
  if (videoCalls.length === 0) {
    try {
      zoomMeetingTasks = await salesforceService.rawQuery<ZoomMeetingTask>(
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
      );

      zoomCallLogTasks = await salesforceService.rawQuery<ZoomCallLogTask>(
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
      );
    } catch {
      // ZVC namespace not available — Zoom for Salesforce not installed
    }
  }

  // ── TRANSCRIPT: CITranscriptEvent linked to VideoCall IDs ───────────────
  let transcripts: CITranscriptEvent[] = [];
  let vcParticipants: VideoCallParticipant[] = [];

  if (include_transcript && videoCalls.length > 0) {
    const vcIds = videoCalls.map((c) => `'${c.Id}'`).join(',');
    try {
      transcripts = await salesforceService.rawQuery<CITranscriptEvent>(
        `SELECT EventUuid, CallId, TranscriptEntries,
                IsTranscriptTruncated, StartDateTime, TranscribedLanguage
         FROM CITranscriptEvent
         WHERE CallId IN (${vcIds})
         ORDER BY StartDateTime DESC`
      );
    } catch {
      warnings.push(
        'CITranscriptEvent not accessible — transcript requires Conversation Insights ' +
        'API permissions. Contact your Salesforce admin to verify CI transcript access.'
      );
    }

    // VideoCallParticipant — confirmed field: VideoCallId (master-detail), Name, Email
    try {
      vcParticipants = await salesforceService.rawQuery<VideoCallParticipant>(
        `SELECT Id, Name, Email, RelatedPersonId, VideoCallId
         FROM VideoCallParticipant
         WHERE VideoCallId IN (${vcIds})`
      );
    } catch {
      // Participants are supplemental — non-fatal
    }

    // Token management
    for (const t of transcripts) {
      if (t.IsTranscriptTruncated) {
        warnings.push(
          `Transcript for call ${t.CallId} was truncated in Salesforce — ` +
          `the call exceeded the 250,000 character storage limit.`
        );
        tokenWarning = true;
      }
      if (t.TranscriptEntries && t.TranscriptEntries.length > TRANSCRIPT_DISPLAY_LIMIT) {
        warnings.push(
          `Transcript for call ${t.CallId} is ${t.TranscriptEntries.length.toLocaleString()} ` +
          `characters. Displaying first ${TRANSCRIPT_DISPLAY_LIMIT.toLocaleString()} characters only.`
        );
        tokenWarning = true;
        t.TranscriptEntries =
          t.TranscriptEntries.slice(0, TRANSCRIPT_DISPLAY_LIMIT) +
          '\n\n[TRUNCATED — transcript exceeds display limit]';
      }
    }
  } else if (include_transcript && zoomMeetingTasks.length > 0) {
    warnings.push(
      'Transcripts are only available via Salesforce Conversation Insights (VideoCall records). ' +
      'This account has Zoom Task data only — no CI transcript available.'
    );
  }

  // ── Build structured output ────────────────────────────────────────────

  // VideoCall records → normalized call objects
  const ciCalls = videoCalls.map((vc) => {
    const callParticipants = vcParticipants.filter((p) => p.VideoCallId === vc.Id);
    return {
      call_id:           vc.Id,
      topic:             vc.Name ?? 'Video Call',
      date:              vc.StartDateTime ?? 'Unknown',
      duration_minutes:  vc.DurationInSeconds ? Math.round(vc.DurationInSeconds / 60) : null,
      language:          vc.TranscribedLanguage ?? null,
      meeting_type:      vc.MeetingType ?? null,
      vendor:            vc.VendorName ?? null,
      intelligence_score: vc.IntelligenceScore ?? null,
      is_recorded:       vc.IsRecorded ?? false,
      has_ai_summary:    !!(vc.IntelligenceScore),
      participants:      callParticipants.map((p) => ({ name: p.Name, email: p.Email })),
      source:            'Salesforce Conversation Insights',
    };
  });

  // ZVC fallback
  const zoomMeetings = zoomMeetingTasks.map((t) => {
    const zm = t.ZVC__Zoom_Meeting__r;
    return {
      task_id:               t.Id,
      topic:                 zm?.ZVC__Meeting_Topic__c ?? t.Subject ?? 'Meeting',
      date:                  t.ActivityDate ?? 'Unknown',
      duration_minutes:      zm?.ZVC__Duration_mins__c ?? null,
      participant_count:     zm?.ZVC__Participant_Count__c ?? null,
      external_participants: zm?.ZVC__External_Participants__c ?? null,
      spoke_with_doctor:     t.Spoke_with_Doctor__c ?? false,
      ai_summary:            zm?.ZVC__Meeting_AI_Summary__c ?? null,
      has_ai_summary:        !!(zm?.ZVC__Meeting_AI_Summary__c),
      task_notes:            t.Description ?? null,
      source:                'Zoom for Salesforce',
    };
  });

  const zoomPhoneCalls = zoomCallLogTasks
    .filter((t) => t.ZVC__Zoom_Call_Log__r)
    .map((t) => {
      const zc = t.ZVC__Zoom_Call_Log__r!;
      return {
        task_id:        t.Id,
        date:           t.ActivityDate ?? 'Unknown',
        call_type:      zc.ZVC__Call_Type__c ?? 'Unknown',
        call_result:    zc.ZVC__Call_Result__c ?? 'Unknown',
        duration:       zc.ZVC__Call_Duration__c ?? 'Unknown',
        party:          zc.ZVC__Third_Party_Name__c ?? 'Unknown',
        ai_summary:     zc.ZVC__AIC_Call_Summary__c ?? null,
        has_ai_summary: !!(zc.ZVC__AIC_Call_Summary__c),
        source:         'Zoom for Salesforce',
      };
    });

  const transcriptData = transcripts.map((t) => {
    const vc = videoCalls.find((c) => c.Id === t.CallId);
    const callParticipants = vcParticipants.filter((p) => p.VideoCallId === t.CallId);
    return {
      call_id:                    t.CallId,
      transcript_uuid:            t.EventUuid,
      start_date_time:            t.StartDateTime,
      language:                   t.TranscribedLanguage ?? vc?.TranscribedLanguage ?? 'en',
      is_truncated_in_salesforce: t.IsTranscriptTruncated ?? false,
      subject:                    vc?.Name ?? 'Call',
      duration:                   vc ? formatDuration(vc.DurationInSeconds) : 'Unknown',
      participants: callParticipants.map((p) => ({
        name:  p.Name,
        email: p.Email,
      })),
      transcript: t.TranscriptEntries ?? null,
    };
  });

  const totalCallsInWindow = ciCalls.length + zoomMeetings.length + zoomPhoneCalls.length;
  const lastCallDate = ciCalls[0]?.date ?? zoomMeetings[0]?.date ?? zoomPhoneCalls[0]?.date ?? null;
  const hasIntelligence =
    ciCalls.some((c) => c.intelligence_score != null) ||
    zoomMeetings.some((c) => c.has_ai_summary) ||
    zoomPhoneCalls.some((c) => c.has_ai_summary);

  const sourceSystems: string[] = [];
  if (ciCalls.length > 0) sourceSystems.push('Salesforce Conversation Insights');
  if (zoomMeetings.length > 0 || zoomPhoneCalls.length > 0) sourceSystems.push('Zoom for Salesforce');

  if (totalCallsInWindow === 0 && !videoCallError) {
    warnings.push(`No calls or meetings found for this account in the last ${lookback_days} days.`);
  }

  const result = {
    status:           'success',
    requested_entity: { account_id: id },
    summary: {
      last_call_date:        lastCallDate,
      total_calls_in_window: totalCallsInWindow,
      ci_video_calls:        ciCalls.length,
      zoom_meetings:         zoomMeetings.length,
      zoom_phone_calls:      zoomPhoneCalls.length,
      has_intelligence:      hasIntelligence,
      lookback_days,
      source:                sourceSystems.join(', ') || 'None',
    },
    ci_calls:         ciCalls,
    zoom_meetings:    zoomMeetings,
    zoom_phone_calls: zoomPhoneCalls,
    transcripts:      transcriptData,
    warnings,
    token_warning:    tokenWarning,
    has_transcript:   include_transcript && transcriptData.length > 0,
    source_systems:   sourceSystems,
    generated_at:     new Date().toISOString(),
  };

  if (response_format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  // ── Markdown output ──────────────────────────────────────────────────────
  const lines: string[] = [
    `# 📞 Call Intelligence — ${accountName ?? id}`,
    `*Last ${lookback_days} days | Generated ${formatDate(new Date().toISOString())}*`,
    '',
  ];

  if (warnings.length > 0) {
    lines.push('## ⚠️ Warnings');
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  lines.push('## Summary');
  lines.push(`- **Total calls found:** ${totalCallsInWindow}`);
  lines.push(`- **Video calls (CI):** ${ciCalls.length}`);
  lines.push(`- **Zoom meetings:** ${zoomMeetings.length}`);
  lines.push(`- **Zoom phone calls:** ${zoomPhoneCalls.length}`);
  lines.push(`- **Last call date:** ${formatDate(lastCallDate)}`);
  lines.push(`- **Intelligence available:** ${hasIntelligence ? 'Yes' : 'No'}`);
  lines.push(`- **Sources:** ${sourceSystems.join(', ') || 'None'}`);
  lines.push('');

  // ── Salesforce Conversation Insights — VideoCall records ─────────────────
  if (ciCalls.length > 0) {
    lines.push('## 🎥 Video Call Summaries');
    ciCalls.forEach((c, i) => {
      lines.push(`### Call ${i + 1} — ${c.topic}`);
      const meta = [
        `**Date:** ${formatDate(c.date)}`,
        `**Duration:** ${c.duration_minutes ? `${c.duration_minutes} min` : 'Unknown'}`,
        c.vendor ? `**Via:** ${c.vendor}` : null,
        c.language ? `**Language:** ${c.language}` : null,
        c.intelligence_score != null ? `**Intelligence Score:** ${c.intelligence_score}` : null,
        c.is_recorded ? '🔴 Recorded' : null,
      ].filter(Boolean).join(' | ');
      lines.push(meta);
      if (c.participants.length > 0) {
        lines.push(`**Participants:** ${c.participants.map((p) => p.name ?? p.email ?? 'Unknown').join(', ')}`);
      }
      lines.push('');
      if (include_transcript) {
        lines.push('*Run with `include_transcript: true` to pull full transcript for this call.*');
      }
      lines.push('');
    });
  }

  // ── Zoom Meeting Summaries (fallback) ────────────────────────────────────
  if (zoomMeetings.length > 0) {
    lines.push('## 🎥 Zoom Meeting Summaries');
    zoomMeetings.forEach((c, i) => {
      const doctorFlag = c.spoke_with_doctor ? ' 🩺' : '';
      lines.push(`### Meeting ${i + 1} — ${c.topic}${doctorFlag}`);
      lines.push(
        `**Date:** ${formatDate(c.date)} | ` +
        `**Duration:** ${c.duration_minutes ? `${c.duration_minutes} min` : 'Unknown'} | ` +
        `**Participants:** ${c.participant_count ?? 'Unknown'}`
      );
      if (c.external_participants) {
        lines.push(`**External Participants:** ${c.external_participants}`);
      }
      lines.push('');
      if (c.ai_summary) {
        lines.push('**🤖 Zoom AI Summary:**');
        lines.push(c.ai_summary);
      } else {
        lines.push('*No Zoom AI summary available for this meeting.*');
      }
      if (c.task_notes) {
        lines.push('');
        lines.push('**📝 AM Notes:**');
        const notes = c.task_notes.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        lines.push(notes.slice(0, 500) + (notes.length > 500 ? '...' : ''));
      }
      lines.push('');
    });
  }

  // ── Zoom Phone Call Summaries (fallback) ─────────────────────────────────
  if (zoomPhoneCalls.length > 0) {
    lines.push('## 📱 Zoom Phone Call Summaries');
    zoomPhoneCalls.forEach((c, i) => {
      lines.push(`### Call ${i + 1} — ${formatDate(c.date)}`);
      lines.push(
        `**Type:** ${c.call_type} | ` +
        `**Result:** ${c.call_result} | ` +
        `**Duration:** ${c.duration} | ` +
        `**Party:** ${c.party}`
      );
      lines.push('');
      if (c.ai_summary) {
        lines.push('**🤖 Zoom AI Summary:**');
        lines.push(c.ai_summary);
      } else {
        lines.push('*No AI summary available for this call.*');
      }
      lines.push('');
    });
  }

  // ── Transcripts ──────────────────────────────────────────────────────────
  if (include_transcript && transcriptData.length > 0) {
    lines.push('## 📄 Call Transcripts');
    lines.push(
      '> *Transcripts are verbatim records from Salesforce Conversation Insights. ' +
      'Action items and commitments should be verified before acting.*'
    );
    lines.push('');
    transcriptData.forEach((t, i) => {
      lines.push(`### Transcript ${i + 1} — ${t.subject}`);
      lines.push(
        `**Date:** ${formatDate(t.start_date_time)} | ` +
        `**Duration:** ${t.duration} | ` +
        `**Language:** ${t.language}`
      );
      if (t.is_truncated_in_salesforce) {
        lines.push('⚠️ *This transcript was truncated in Salesforce — call exceeded storage limit.*');
      }
      if (t.participants.length > 0) {
        lines.push('**Participants:**');
        for (const p of t.participants) {
          lines.push(`- ${p.name ?? p.email ?? 'Unknown'}`);
        }
      }
      lines.push('');
      if (t.transcript) {
        lines.push('**Full Transcript:**');
        lines.push('```');
        lines.push(t.transcript);
        lines.push('```');
      }
      lines.push('');
    });
  } else if (include_transcript && transcriptData.length === 0) {
    lines.push('## 📄 Transcripts');
    lines.push(
      '*No transcripts found. Transcripts are available once Salesforce Conversation Insights ' +
      'has processed the call recording. If calls appear above, try again in a few minutes ' +
      'or contact your Salesforce admin to verify CI transcript processing is enabled.*'
    );
    lines.push('');
  }

  if (totalCallsInWindow === 0) {
    lines.push(`*No calls or meetings found for this account in the last ${lookback_days} days.*`);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export const callIntelligenceHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_call_intelligence: handleCallIntelligence,
};
