// ─────────────────────────────────────────────────────────────────────────────
// Morning Brief Engine
//
// Generates a personalized daily intelligence brief for each Prophet user.
// Runs overnight or on-demand, delivered via Telegram at the user's
// preferred time.
//
// The brief answers: "What should I focus on today, and what can Prophet
// do for me right now?"
// ─────────────────────────────────────────────────────────────────────────────

import { salesforceService } from './salesforce.js';
import type { ProphetUser } from './telegram.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MorningBrief {
  message: string;
  suggestedActions: SuggestedAction[];
  generatedAt: string;
}

export interface SuggestedAction {
  id: number;
  label: string;
  description: string;
  handler: () => Promise<string>;
}

// ─── Calendar Integration ────────────────────────────────────────────────────

interface CalendarEvent {
  subject: string;
  startTime: string;
  accountName?: string;
  accountId?: string;
}

async function getTodaysMeetings(userId: string): Promise<CalendarEvent[]> {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  try {
    const events = await salesforceService.rawQuery<{
      Subject: string;
      StartDateTime: string;
      Account?: { Name: string; Id: string };
    }>(
      `SELECT Subject, StartDateTime, Account.Name, Account.Id ` +
      `FROM Event ` +
      `WHERE OwnerId = '${userId}' ` +
      `AND StartDateTime >= ${today}T00:00:00Z ` +
      `AND StartDateTime < ${tomorrow}T23:59:59Z ` +
      `ORDER BY StartDateTime ASC ` +
      `LIMIT 20`
    );

    return events.map(e => ({
      subject: e.Subject,
      startTime: e.StartDateTime,
      accountName: e.Account?.Name,
      accountId: e.Account?.Id,
    }));
  } catch {
    return [];
  }
}

// ─── Churn Alerts (Overnight Changes) ────────────────────────────────────────

interface ChurnAlert {
  accountName: string;
  accountId: string;
  signal: string;
  mrr: number;
}

async function getChurnAlerts(userId: string): Promise<ChurnAlert[]> {
  try {
    const accounts = await salesforceService.rawQuery<{
      Id: string;
      Name: string;
      Health_Tier__c?: string;
      Total_Monthly_Recurring_Amount__c?: number;
      Flagged_Status__c?: string;
      Cancellation_or_Pause_Request_Date__c?: string;
    }>(
      `SELECT Id, Name, Health_Tier__c, Total_Monthly_Recurring_Amount__c, ` +
      `Flagged_Status__c, Cancellation_or_Pause_Request_Date__c ` +
      `FROM Account ` +
      `WHERE OwnerId = '${userId}' ` +
      `AND Status__c IN ('Active','Renewal','Non Renewing','Reinstated','Delinquent','Paused','Pending') ` +
      `AND Status__c != null ` +
      `AND (Health_Tier__c = 'Critical' OR Health_Tier__c = 'At Risk' ` +
      `OR Flagged_Status__c != null ` +
      `OR Cancellation_or_Pause_Request_Date__c != null) ` +
      `ORDER BY Total_Monthly_Recurring_Amount__c DESC NULLS LAST ` +
      `LIMIT 10`
    );

    return accounts.map(a => {
      let signal = '';
      if (a.Cancellation_or_Pause_Request_Date__c) signal = 'Cancellation/pause request on file';
      else if (a.Flagged_Status__c) signal = `Flagged: ${a.Flagged_Status__c}`;
      else if (a.Health_Tier__c === 'Critical') signal = 'Health score: CRITICAL';
      else if (a.Health_Tier__c === 'At Risk') signal = 'Health score: AT RISK';

      return {
        accountName: a.Name,
        accountId: a.Id,
        signal,
        mrr: a.Total_Monthly_Recurring_Amount__c ?? 0,
      };
    });
  } catch {
    return [];
  }
}

// ─── Stale Accounts (No Contact in 30+ Days) ────────────────────────────────

interface StaleAccount {
  name: string;
  id: string;
  daysSinceContact: number;
  mrr: number;
}

async function getStaleAccounts(userId: string): Promise<StaleAccount[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  try {
    const accounts = await salesforceService.rawQuery<{
      Id: string;
      Name: string;
      LastActivityDate?: string;
      Total_Monthly_Recurring_Amount__c?: number;
    }>(
      `SELECT Id, Name, LastActivityDate, Total_Monthly_Recurring_Amount__c ` +
      `FROM Account ` +
      `WHERE OwnerId = '${userId}' ` +
      `AND Status__c IN ('Active','Renewal','Non Renewing','Reinstated','Delinquent','Paused','Pending') ` +
      `AND Status__c != null ` +
      `AND (LastActivityDate < ${thirtyDaysAgo} OR LastActivityDate = null) ` +
      `ORDER BY Total_Monthly_Recurring_Amount__c DESC NULLS LAST ` +
      `LIMIT 5`
    );

    return accounts.map(a => ({
      name: a.Name,
      id: a.Id,
      daysSinceContact: a.LastActivityDate
        ? Math.floor((Date.now() - new Date(a.LastActivityDate).getTime()) / 86400000)
        : 999,
      mrr: a.Total_Monthly_Recurring_Amount__c ?? 0,
    }));
  } catch {
    return [];
  }
}

// ─── Upcoming Renewals ───────────────────────────────────────────────────────

interface UpcomingRenewal {
  name: string;
  id: string;
  renewalDate: string;
  daysUntil: number;
  mrr: number;
  healthTier?: string;
}

async function getUpcomingRenewals(userId: string): Promise<UpcomingRenewal[]> {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDays = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  try {
    const accounts = await salesforceService.rawQuery<{
      Id: string;
      Name: string;
      Contract_Renewal_Date__c?: string;
      Total_Monthly_Recurring_Amount__c?: number;
      Health_Tier__c?: string;
    }>(
      `SELECT Id, Name, Contract_Renewal_Date__c, Total_Monthly_Recurring_Amount__c, Health_Tier__c ` +
      `FROM Account ` +
      `WHERE OwnerId = '${userId}' ` +
      `AND Status__c IN ('Active','Renewal','Non Renewing','Reinstated','Delinquent','Paused','Pending') ` +
      `AND Status__c != null ` +
      `AND Contract_Renewal_Date__c >= ${today} ` +
      `AND Contract_Renewal_Date__c <= ${thirtyDays} ` +
      `ORDER BY Contract_Renewal_Date__c ASC ` +
      `LIMIT 5`
    );

    return accounts.map(a => ({
      name: a.Name,
      id: a.Id,
      renewalDate: a.Contract_Renewal_Date__c ?? '',
      daysUntil: a.Contract_Renewal_Date__c
        ? Math.floor((new Date(a.Contract_Renewal_Date__c).getTime() - Date.now()) / 86400000)
        : 0,
      mrr: a.Total_Monthly_Recurring_Amount__c ?? 0,
      healthTier: a.Health_Tier__c,
    }));
  } catch {
    return [];
  }
}

// ─── Brief Generator ─────────────────────────────────────────────────────────

class MorningBriefEngine {

  async generateBrief(
    user: ProphetUser,
    toolHandlers: Record<string, (args: unknown) => Promise<string>>
  ): Promise<MorningBrief> {
    const now = new Date();
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });
    const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
    const firstName = user.name.split(' ')[0];

    // Run all data fetches in parallel
    const [meetings, churnAlerts, staleAccounts, renewals] = await Promise.all([
      getTodaysMeetings(user.salesforceUserId),
      getChurnAlerts(user.salesforceUserId),
      getStaleAccounts(user.salesforceUserId),
      getUpcomingRenewals(user.salesforceUserId),
    ]);

    const lines: string[] = [];
    const suggestedActions: SuggestedAction[] = [];
    let actionCounter = 1;

    // ── Header ──────────────────────────────────────────────────────────────

    lines.push(`${greeting}, <b>${firstName}</b>. Here's your ${dayOfWeek} brief.`);
    lines.push(`<i>${dateStr}</i>`);
    lines.push('');

    // ── Today's Meetings ────────────────────────────────────────────────────

    if (meetings.length > 0) {
      lines.push(`<b>📅 Today's Calls (${meetings.length})</b>`);
      lines.push('');

      for (const meeting of meetings) {
        const time = new Date(meeting.startTime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });

        if (meeting.accountName) {
          lines.push(`<b>${time}</b> — ${meeting.accountName}`);
          lines.push(`  └ <i>${meeting.subject}</i>`);

          // Add a suggested action for pre-call brief
          const accountName = meeting.accountName;
          suggestedActions.push({
            id: actionCounter,
            label: `Pre-call brief for ${accountName}`,
            description: `Get full brief before your ${time} call`,
            handler: async () => {
              const handler = toolHandlers['sf_get_pre_call_brief'];
              if (!handler) return 'Pre-call brief tool not available';
              return handler({ accountName });
            },
          });
          actionCounter++;
        } else {
          lines.push(`<b>${time}</b> — ${meeting.subject}`);
        }
      }
      lines.push('');
    } else {
      lines.push(`<b>📅 No meetings scheduled today.</b>`);
      lines.push('');
    }

    // ── Churn Alerts ────────────────────────────────────────────────────────

    if (churnAlerts.length > 0) {
      const totalAtRisk = churnAlerts.reduce((sum, a) => sum + a.mrr, 0);
      lines.push(`<b>🚨 Attention Needed (${churnAlerts.length} accounts — $${totalAtRisk.toLocaleString()}/mo at risk)</b>`);
      lines.push('');

      for (const alert of churnAlerts.slice(0, 5)) {
        const mrrStr = alert.mrr > 0 ? ` ($${alert.mrr.toLocaleString()}/mo)` : '';
        lines.push(`- <b>${alert.accountName}</b>${mrrStr}`);
        lines.push(`  ${alert.signal}`);
      }
      lines.push('');
    }

    // ── Upcoming Renewals ───────────────────────────────────────────────────

    if (renewals.length > 0) {
      lines.push(`<b>🔄 Renewals in 30 Days (${renewals.length})</b>`);
      lines.push('');

      for (const renewal of renewals) {
        const healthEmoji = renewal.healthTier === 'Healthy' ? '🟢'
          : renewal.healthTier === 'Watch' ? '🟡'
          : renewal.healthTier === 'At Risk' ? '🟠'
          : renewal.healthTier === 'Critical' ? '🔴'
          : '⚪';

        lines.push(`- ${healthEmoji} <b>${renewal.name}</b> — ${renewal.daysUntil} days ($${renewal.mrr.toLocaleString()}/mo)`);
      }
      lines.push('');
    }

    // ── Stale Accounts ──────────────────────────────────────────────────────

    if (staleAccounts.length > 0) {
      lines.push(`<b>⏰ Need Outreach (30+ days no contact)</b>`);
      lines.push('');

      for (const stale of staleAccounts.slice(0, 3)) {
        const mrrStr = stale.mrr > 0 ? ` ($${stale.mrr.toLocaleString()}/mo)` : '';
        lines.push(`- <b>${stale.name}</b> — ${stale.daysSinceContact} days${mrrStr}`);
      }

      // Add suggested action to reach out
      if (staleAccounts[0]) {
        const topStale = staleAccounts[0];
        suggestedActions.push({
          id: actionCounter,
          label: `Brief for ${topStale.name} (${topStale.daysSinceContact}d stale)`,
          description: `This account needs contact — get the brief`,
          handler: async () => {
            const handler = toolHandlers['sf_get_pre_call_brief'];
            if (!handler) return 'Pre-call brief tool not available';
            return handler({ accountName: topStale.name });
          },
        });
        actionCounter++;
      }
      lines.push('');
    }

    // ── Suggested Actions ───────────────────────────────────────────────────

    if (suggestedActions.length > 0) {
      lines.push(`<b>💡 ${suggestedActions.length} things I can do for you right now:</b>`);
      lines.push('');

      for (const action of suggestedActions) {
        lines.push(`<b>${action.id}.</b> ${action.label}`);
      }
      lines.push('');
      lines.push(`Reply with a number, or <b>"all"</b> to execute everything.`);
    }

    // ── Sign-off ────────────────────────────────────────────────────────────

    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push(`<i>Prophet • Your AI at Progressive Dental Marketing</i>`);

    return {
      message: lines.join('\n'),
      suggestedActions,
      generatedAt: now.toISOString(),
    };
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const morningBriefEngine = new MorningBriefEngine();
