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

interface UnifiedVideoCall {
  Id: string;
  Subject?: string;
  ActivityDateTime?: string;
  CallDurationInSeconds?: number;
  IsInsightAvailable?: boolean;
  Snippet?: string;
  DetailId?: string;
}

interface UnifiedVideoCallParticipant {
  Id: string;
  ActivityId: string;
  PersonId?: string;
  ChannelAddress?: string;
  ParticipantType?: string;
  TalkRatio?: number;
  ListenRatio?: number;
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
          type: 'number',
          description: 'How many days back to search for calls (default: 90)',
        },
        max_calls: {
          type: 'number',
          description: 'Maximum number of Zoom meeting summaries to return (default: 5)',
        },
        include_transcript: {
          type: 'boolean',
          description: 'Include raw CITranscriptEvent transcript content (default: false)',
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
  lookback_days:       z.number().int().min(1).max(365).default(90),
  max_calls:           z.number().int().min(1).max(10).default(5),
  include_transcript:  z.boolean().default(false),
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

  // ── PHASE 1: Zoom Meeting AI Summaries ──────────────────────────────────
  const zoomMeetingTasks = await salesforceService.rawQuery<ZoomMeetingTask>(
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

  // ── PHASE 1: Zoom Phone Call AI Summaries ────────────────────────────────
  const zoomCallLogTasks = await salesforceService.rawQuery<ZoomCallLogTask>(
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

  // ── PHASE 2: Conversation Insights Transcripts ──────────────────────────
  let transcripts: CITranscriptEvent[] = [];
  let unifiedCalls: UnifiedVideoCall[] = [];
  let participants: UnifiedVideoCallParticipant[] = [];

  if (include_transcript) {
    // Query CITranscriptEvent by recent StartDateTime scoped to this account's
    // lookback window. Direct AccountId filter on CITranscriptEvent is not yet
    // verified — Phase 2 enhancement once the DetailId traversal is confirmed.
    transcripts = await salesforceService.rawQuery<CITranscriptEvent>(
      `SELECT EventUuid, CallId, TranscriptEntries,
              IsTranscriptTruncated, StartDateTime, TranscribedLanguage
       FROM CITranscriptEvent
       WHERE StartDateTime >= ${sinceDate}T00:00:00Z
       ORDER BY StartDateTime DESC
       LIMIT ${max_calls}`
    );

    if (transcripts.length > 0) {
      const callIds = transcripts.map((t) => `'${t.CallId}'`).join(',');

      unifiedCalls = await salesforceService.rawQuery<UnifiedVideoCall>(
        `SELECT Id, Subject, ActivityDateTime, CallDurationInSeconds,
                IsInsightAvailable, Snippet, DetailId
         FROM UnifiedVideoCall
         WHERE Id IN (${callIds})`
      );

      if (unifiedCalls.length > 0) {
        const ucIds = unifiedCalls.map((c) => `'${c.Id}'`).join(',');
        participants = await salesforceService.rawQuery<UnifiedVideoCallParticipant>(
          `SELECT Id, ActivityId, PersonId, ChannelAddress,
                  ParticipantType, TalkRatio, ListenRatio
           FROM UnifiedVideoCallParticipant
           WHERE ActivityId IN (${ucIds})`
        );
      }

      // Token management — check transcript lengths
      for (const t of transcripts) {
        if (t.IsTranscriptTruncated) {
          warnings.push(
            `Transcript for call ${t.CallId} was truncated in Salesforce — ` +
            `the call exceeded the 250,000 character storage limit. ` +
            `Full call content may not be represented.`
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
    }
  }

  // ── Build structured output ────────────────────────────────────────────
  const recentCalls = zoomMeetingTasks.map((t) => {
    const zm = t.ZVC__Zoom_Meeting__r;
    return {
      task_id:              t.Id,
      topic:                zm?.ZVC__Meeting_Topic__c ?? t.Subject ?? 'Meeting',
      date:                 t.ActivityDate ?? 'Unknown',
      duration_minutes:     zm?.ZVC__Duration_mins__c ?? null,
      participant_count:    zm?.ZVC__Participant_Count__c ?? null,
      external_participants: zm?.ZVC__External_Participants__c ?? null,
      spoke_with_doctor:    t.Spoke_with_Doctor__c ?? false,
      zoom_status:          zm?.ZVC__Zoom_Status__c ?? null,
      ai_summary:           zm?.ZVC__Meeting_AI_Summary__c ?? null,
      has_ai_summary:       !!(zm?.ZVC__Meeting_AI_Summary__c),
      task_notes:           t.Description ?? null,
      source:               'Zoom AI Companion',
    };
  });

  const zoomPhoneCalls = zoomCallLogTasks
    .filter((t) => t.ZVC__Zoom_Call_Log__r)
    .map((t) => {
      const zc = t.ZVC__Zoom_Call_Log__r!;
      return {
        task_id:       t.Id,
        date:          t.ActivityDate ?? 'Unknown',
        call_type:     zc.ZVC__Call_Type__c ?? 'Unknown',
        call_result:   zc.ZVC__Call_Result__c ?? 'Unknown',
        answer_time:   zc.ZVC__Answer_Start_Time__c ?? null,
        duration:      zc.ZVC__Call_Duration__c ?? 'Unknown',
        party:         zc.ZVC__Third_Party_Name__c ?? 'Unknown',
        ai_summary:    zc.ZVC__AIC_Call_Summary__c ?? null,
        has_ai_summary: !!(zc.ZVC__AIC_Call_Summary__c),
        source:        'Zoom AI Companion',
      };
    });

  const transcriptData = include_transcript
    ? transcripts.map((t) => {
        const uc = unifiedCalls.find((c) => c.Id === t.CallId);
        const callParticipants = participants.filter((p) => p.ActivityId === t.CallId);
        return {
          call_id:                      t.CallId,
          transcript_uuid:              t.EventUuid,
          start_date_time:              t.StartDateTime,
          language:                     t.TranscribedLanguage ?? 'en',
          is_truncated_in_salesforce:   t.IsTranscriptTruncated ?? false,
          subject:                      uc?.Subject ?? 'Call',
          duration:                     uc ? formatDuration(uc.CallDurationInSeconds) : 'Unknown',
          insight_available:            uc?.IsInsightAvailable ?? false,
          snippet:                      uc?.Snippet ?? null,
          participants: callParticipants.map((p) => ({
            channel:      p.ChannelAddress,
            type:         p.ParticipantType,
            talk_ratio:   p.TalkRatio,
            listen_ratio: p.ListenRatio,
          })),
          transcript: t.TranscriptEntries ?? null,
        };
      })
    : [];

  const totalCallsInWindow = recentCalls.length + zoomPhoneCalls.length;
  const lastCallDate = recentCalls[0]?.date ?? zoomPhoneCalls[0]?.date ?? null;
  const hasSummaries =
    recentCalls.some((c) => c.has_ai_summary) ||
    zoomPhoneCalls.some((c) => c.has_ai_summary);

  const sourceSystems: string[] = [];
  if (recentCalls.length > 0 || zoomPhoneCalls.length > 0) sourceSystems.push('Zoom for Salesforce');
  if (include_transcript && transcripts.length > 0) sourceSystems.push('Salesforce Conversation Insights');

  if (totalCallsInWindow === 0) {
    warnings.push(`No Zoom meetings or calls found for this account in the last ${lookback_days} days.`);
  }
  if (!hasSummaries && totalCallsInWindow > 0) {
    warnings.push(
      'Calls found but no Zoom AI Companion summaries are available. ' +
      'Zoom AI Companion may not be enabled or configured for your account.'
    );
  }

  const result = {
    status:           'success',
    requested_entity: { account_id: id },
    summary: {
      last_call_date:        lastCallDate,
      total_calls_in_window: totalCallsInWindow,
      zoom_meetings:         recentCalls.length,
      zoom_phone_calls:      zoomPhoneCalls.length,
      has_ai_summaries:      hasSummaries,
      lookback_days,
      source:                sourceSystems.join(', ') || 'None',
    },
    recent_calls:     recentCalls,
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
  lines.push(`- **Zoom meetings:** ${recentCalls.length}`);
  lines.push(`- **Zoom phone calls:** ${zoomPhoneCalls.length}`);
  lines.push(`- **Last call date:** ${formatDate(lastCallDate)}`);
  lines.push(`- **AI summaries available:** ${hasSummaries ? 'Yes' : 'No'}`);
  lines.push(`- **Sources:** ${sourceSystems.join(', ') || 'None'}`);
  lines.push('');

  // ── Zoom Meeting Summaries ───────────────────────────────────────────────
  if (recentCalls.length > 0) {
    lines.push('## 🎥 Zoom Meeting Summaries');
    recentCalls.forEach((c, i) => {
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

  // ── Zoom Phone Call Summaries ────────────────────────────────────────────
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
        lines.push('*No Zoom AI summary available for this call.*');
      }
      lines.push('');
    });
  }

  // ── Transcripts (Phase 2) ────────────────────────────────────────────────
  if (include_transcript && transcriptData.length > 0) {
    lines.push('## 📄 Call Transcripts');
    lines.push(
      '> *Transcripts are AI-processed verbatim records. ' +
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
      if (t.snippet) lines.push(`**Snippet:** ${t.snippet}`);
      if (t.participants.length > 0) {
        lines.push('**Participants:**');
        for (const p of t.participants) {
          const talk = p.talk_ratio != null ? ` (${Math.round(p.talk_ratio * 100)}% talking)` : '';
          lines.push(`- ${p.type ?? 'Participant'}: ${p.channel ?? 'Unknown'}${talk}`);
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
      '*No CITranscriptEvent records found for this account in the lookback window. ' +
      'Transcripts are available only when Salesforce Conversation Insights has ' +
      'processed the call recording.*'
    );
    lines.push('');
  }

  if (totalCallsInWindow === 0) {
    lines.push(`*No Zoom meetings or calls found for this account in the last ${lookback_days} days.*`);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export const callIntelligenceHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_call_intelligence: handleCallIntelligence,
};
