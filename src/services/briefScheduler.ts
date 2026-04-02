// ─────────────────────────────────────────────────────────────────────────────
// Morning Brief Scheduler
//
// Checks every minute which users should receive their morning brief
// based on their configured time and timezone. Sends proactively via
// Telegram — Prophet texts first, not the user.
// ─────────────────────────────────────────────────────────────────────────────

import { getRegisteredUsers, sendMorningBrief } from './telegram.js';
import type { ProphetUser } from './telegram.js';

const sentToday = new Set<number>(); // Track who got their brief today

function getCurrentTimeInTimezone(tz: string): { hours: number; minutes: number; dayOfWeek: number } {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  };

  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);
  const hours = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  const dayStr = parts.find(p => p.type === 'weekday')?.value ?? 'Mon';

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[dayStr] ?? 1;

  return { hours, minutes, dayOfWeek };
}

function shouldSendBrief(user: ProphetUser): boolean {
  if (!user.morningBriefEnabled) return false;
  if (sentToday.has(user.telegramChatId)) return false;

  const { hours, minutes, dayOfWeek } = getCurrentTimeInTimezone(user.timezone);

  // Skip weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  // Parse user's preferred time
  const [targetHour, targetMinute] = user.morningBriefTime.split(':').map(Number);

  // Send if we're within the target minute (check runs every 60s)
  return hours === targetHour && minutes === targetMinute;
}

function resetDailyTracker(): void {
  // Reset at midnight — check if it's a new day
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    sentToday.clear();
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startBriefScheduler(): void {
  if (schedulerInterval) return;

  process.stderr.write('[Prophet Scheduler] Morning brief scheduler started (checking every 60s)\n');

  schedulerInterval = setInterval(async () => {
    resetDailyTracker();

    const users = getRegisteredUsers();

    for (const user of users) {
      if (shouldSendBrief(user)) {
        process.stderr.write(`[Prophet Scheduler] Sending morning brief to ${user.name}\n`);
        sentToday.add(user.telegramChatId);

        // Fire and forget — don't block the loop
        sendMorningBrief(user).catch(err => {
          process.stderr.write(`[Prophet Scheduler] Brief failed for ${user.name}: ${err}\n`);
          sentToday.delete(user.telegramChatId); // Allow retry
        });
      }
    }
  }, 60_000); // Every 60 seconds
}

export function stopBriefScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
