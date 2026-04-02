// ─────────────────────────────────────────────────────────────────────────────
// Prophet Scheduler — Three Proactive Jobs
//
// 1. Morning Brief — fires at each AM's configured time (default 6:30 AM)
// 2. Post-Event Nudge — fires the morning after every FABC, FAGC, or
//    Power Session, reminding AMs to log who they met with.
// 3. Orphaned Call Nudge — fires at 9 AM, nudges AMs about Zoom calls
//    not linked to any Account (health scores can't see them).
//
// The event calendar is hardcoded for 2026. Future: pull from Salesforce
// TCI_Events__c or Google Calendar.
// ─────────────────────────────────────────────────────────────────────────────

import { getRegisteredUsers, sendMorningBrief, sendEventNudge, sendOrphanedCallNudge } from './telegram.js';
import type { ProphetUser } from './telegram.js';
import { salesforceService } from './salesforce.js';

// ─── TCI Event Calendar ──────────────────────────────────────────────────────
// Each event defines the date range. The nudge fires the MORNING AFTER the
// last day of the event. Add new events here as they're scheduled.

interface TCIEvent {
  name: string;
  location: string;
  // Dates in YYYY-MM-DD format (inclusive)
  startDate: string;
  endDate: string;
  // The nudge fires on this date (morning after event ends)
  nudgeDate: string;
}

const TCI_EVENT_CALENDAR: TCIEvent[] = [
  // ─── 2026 Major Conferences ─────────────────────────────────────────────
  {
    name: 'Full-Arch Boot Camp (FABC) — Vegas',
    location: 'Las Vegas, NV',
    startDate: '2026-03-27',
    endDate: '2026-03-28',
    nudgeDate: '2026-03-29',
  },
  {
    name: 'Full-Arch Boot Camp (FABC) — Dallas',
    location: 'Loews Arlington, TX',
    startDate: '2026-07-23',
    endDate: '2026-07-24',
    nudgeDate: '2026-07-25',
  },
  {
    name: 'Full-Arch Growth Conference (FAGC) — Orlando',
    location: 'Hyatt Regency Orlando, FL',
    startDate: '2026-11-05',
    endDate: '2026-11-07',
    nudgeDate: '2026-11-08',
  },

  // ─── 2026 Monthly Power Sessions ───────────────────────────────────────
  // These are typically 1-day in-office events at PDM HQ in Clearwater.
  // Add specific dates as they're scheduled. Pattern: first Friday of month.
  {
    name: 'Power Session — January',
    location: 'PDM HQ, Clearwater, FL',
    startDate: '2026-01-09',
    endDate: '2026-01-09',
    nudgeDate: '2026-01-10',
  },
  {
    name: 'Power Session — February',
    location: 'PDM HQ, Clearwater, FL',
    startDate: '2026-02-06',
    endDate: '2026-02-06',
    nudgeDate: '2026-02-07',
  },
  {
    name: 'Power Session — April',
    location: 'PDM HQ, Clearwater, FL',
    startDate: '2026-04-10',
    endDate: '2026-04-10',
    nudgeDate: '2026-04-11',
  },
  {
    name: 'Power Session — May',
    location: 'PDM HQ, Clearwater, FL',
    startDate: '2026-05-08',
    endDate: '2026-05-08',
    nudgeDate: '2026-05-09',
  },
  {
    name: 'Power Session — June',
    location: 'PDM HQ, Clearwater, FL',
    startDate: '2026-06-05',
    endDate: '2026-06-05',
    nudgeDate: '2026-06-06',
  },
  {
    name: 'Power Session — August',
    location: 'PDM HQ, Clearwater, FL',
    startDate: '2026-08-07',
    endDate: '2026-08-07',
    nudgeDate: '2026-08-08',
  },
  {
    name: 'Power Session — September',
    location: 'PDM HQ, Clearwater, FL',
    startDate: '2026-09-04',
    endDate: '2026-09-04',
    nudgeDate: '2026-09-05',
  },
  {
    name: 'Power Session — October',
    location: 'PDM HQ, Clearwater, FL',
    startDate: '2026-10-02',
    endDate: '2026-10-02',
    nudgeDate: '2026-10-03',
  },
  {
    name: 'Power Session — December',
    location: 'PDM HQ, Clearwater, FL',
    startDate: '2026-12-04',
    endDate: '2026-12-04',
    nudgeDate: '2026-12-05',
  },
];

// ─── State Tracking ──────────────────────────────────────────────────────────

const briefSentToday = new Set<number>();
const nudgeSentToday = new Set<string>(); // "chatId:eventName" composite key
const orphanNudgeSentToday = new Set<number>(); // chatId — one orphan nudge per day per user

// William Summers exclusion
const WILLIAM_SUMMERS_USER_ID = '005PU000001eUQDYA2';

// ─── Time Utilities ──────────────────────────────────────────────────────────

function getCurrentTimeInTimezone(tz: string): { hours: number; minutes: number; dayOfWeek: number; dateStr: string } {
  const now = new Date();

  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // Returns YYYY-MM-DD

  const hours = parseInt(timeParts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const minutes = parseInt(timeParts.find(p => p.type === 'minute')?.value ?? '0', 10);
  const dayStr = timeParts.find(p => p.type === 'weekday')?.value ?? 'Mon';

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[dayStr] ?? 1;

  return { hours, minutes, dayOfWeek, dateStr: dateParts };
}

function getTodayDateET(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// ─── Morning Brief Logic ─────────────────────────────────────────────────────

function shouldSendBrief(user: ProphetUser): boolean {
  if (!user.morningBriefEnabled) return false;
  if (briefSentToday.has(user.telegramChatId)) return false;

  const { hours, minutes, dayOfWeek } = getCurrentTimeInTimezone(user.timezone);

  // Skip weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  // Parse user's preferred time
  const [targetHour, targetMinute] = user.morningBriefTime.split(':').map(Number);

  // Send if we're within the target minute
  return hours === targetHour && minutes === targetMinute;
}

// ─── Event Nudge Logic ───────────────────────────────────────────────────────

function getEventNudgesForToday(): TCIEvent[] {
  const today = getTodayDateET();
  return TCI_EVENT_CALENDAR.filter(e => e.nudgeDate === today);
}

function shouldSendEventNudge(user: ProphetUser, event: TCIEvent): boolean {
  const key = `${user.telegramChatId}:${event.name}`;
  if (nudgeSentToday.has(key)) return false;

  const { hours } = getCurrentTimeInTimezone(user.timezone);
  // Send event nudges at 8 AM in user's timezone (after morning brief at 6:30)
  return hours === 8;
}

// ─── Orphaned Video Call Nudge Logic ────────────────────────────────────────

interface OrphanedTask {
  Id: string;
  Subject?: string;
  ActivityDate?: string;
  OwnerId: string;
  WhoId?: string;
  Who?: { Name?: string };
  ZVC__Zoom_Meeting__c?: string;
  ZVC__Zoom_Meeting__r?: { ZVC__Meeting_Topic__c?: string } | null;
  ZVC__Zoom_Call_Log__c?: string;
}

function shouldSendOrphanNudge(user: ProphetUser): boolean {
  if (orphanNudgeSentToday.has(user.telegramChatId)) return false;

  const { hours, dayOfWeek } = getCurrentTimeInTimezone(user.timezone);
  // Skip weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  // Send at 9 AM — after morning brief (6:30) and event nudge (8:00)
  return hours === 9;
}

async function fetchOrphanedCallsForUser(sfUserId: string): Promise<OrphanedTask[]> {
  try {
    const lookback = new Date(Date.now() - 14 * 86_400_000).toISOString().split('T')[0];
    return await salesforceService.rawQuery<OrphanedTask>(
      `SELECT Id, Subject, ActivityDate, OwnerId,
              WhoId, Who.Name,
              ZVC__Zoom_Meeting__c,
              ZVC__Zoom_Meeting__r.ZVC__Meeting_Topic__c,
              ZVC__Zoom_Call_Log__c
       FROM Task
       WHERE (ZVC__Zoom_Meeting__c != null OR ZVC__Zoom_Call_Log__c != null)
         AND WhatId = null
         AND ActivityDate >= ${lookback}
         AND OwnerId = '${sfUserId}'
       ORDER BY ActivityDate DESC
       LIMIT 25`
    );
  } catch (err) {
    process.stderr.write(`[Prophet Scheduler] Orphan call query failed for ${sfUserId}: ${err}\n`);
    return [];
  }
}

// ─── Daily Reset ─────────────────────────────────────────────────────────────

function resetDailyTracker(): void {
  const now = new Date();
  if (now.getUTCHours() === 5 && now.getUTCMinutes() === 0) {
    // Reset at midnight ET (5 AM UTC)
    briefSentToday.clear();
    nudgeSentToday.clear();
    orphanNudgeSentToday.clear();
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startBriefScheduler(): void {
  if (schedulerInterval) return;

  process.stderr.write('[Prophet Scheduler] Morning brief + event nudge + orphaned call nudge scheduler started (checking every 60s)\n');

  schedulerInterval = setInterval(async () => {
    resetDailyTracker();

    const users = getRegisteredUsers();
    const todayEvents = getEventNudgesForToday();

    for (const user of users) {
      // Morning brief
      if (shouldSendBrief(user)) {
        process.stderr.write(`[Prophet Scheduler] Sending morning brief to ${user.name}\n`);
        briefSentToday.add(user.telegramChatId);

        sendMorningBrief(user).catch(err => {
          process.stderr.write(`[Prophet Scheduler] Brief failed for ${user.name}: ${err}\n`);
          briefSentToday.delete(user.telegramChatId);
        });
      }

      // Post-event nudges
      for (const event of todayEvents) {
        if (shouldSendEventNudge(user, event)) {
          const key = `${user.telegramChatId}:${event.name}`;
          process.stderr.write(`[Prophet Scheduler] Sending post-event nudge to ${user.name} for ${event.name}\n`);
          nudgeSentToday.add(key);

          sendEventNudge(user, event.name, event.location).catch(err => {
            process.stderr.write(`[Prophet Scheduler] Event nudge failed for ${user.name}: ${err}\n`);
            nudgeSentToday.delete(key);
          });
        }
      }

      // Orphaned Video Call nudge — 9 AM daily
      if (shouldSendOrphanNudge(user) && user.salesforceUserId !== WILLIAM_SUMMERS_USER_ID) {
        orphanNudgeSentToday.add(user.telegramChatId);

        fetchOrphanedCallsForUser(user.salesforceUserId).then(orphans => {
          if (orphans.length === 0) return;

          process.stderr.write(`[Prophet Scheduler] Sending orphaned call nudge to ${user.name} — ${orphans.length} unlinked calls\n`);

          const calls = orphans.map(t => {
            const topic = (t.ZVC__Zoom_Meeting__r as { ZVC__Meeting_Topic__c?: string } | null)?.ZVC__Meeting_Topic__c;
            return {
              subject: topic ?? t.Subject ?? 'Zoom Activity',
              contactName: (t.Who as { Name?: string } | undefined)?.Name,
              date: t.ActivityDate ?? 'Unknown',
              callType: t.ZVC__Zoom_Meeting__c ? 'Meeting' : 'Phone Call',
            };
          });

          sendOrphanedCallNudge(user, calls).catch(err => {
            process.stderr.write(`[Prophet Scheduler] Orphan nudge failed for ${user.name}: ${err}\n`);
          });
        }).catch(err => {
          process.stderr.write(`[Prophet Scheduler] Orphan fetch failed for ${user.name}: ${err}\n`);
        });
      }
    }
  }, 60_000);
}

export function stopBriefScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/** Manually trigger event nudge for testing */
export function triggerEventNudge(eventName: string, eventLocation: string): void {
  const users = getRegisteredUsers();
  for (const user of users) {
    sendEventNudge(user, eventName, eventLocation).catch(err => {
      process.stderr.write(`[Prophet Scheduler] Manual nudge failed for ${user.name}: ${err}\n`);
    });
  }
}
