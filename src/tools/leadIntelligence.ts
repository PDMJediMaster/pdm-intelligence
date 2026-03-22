// ─────────────────────────────────────────────────────────────────────────────
// Lead Intelligence Tool — Prophet by PDM
//
// sf_get_lead_intelligence
//   Full pre-call brief for Sales Reps on any inbound or outbound Lead.
//   Pulls Pardot engagement data, Prophet research scores, activity history,
//   competitor snapshots, and linked Gamma decks — everything a rep needs
//   before a discovery call, in one command.
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Salesforce Types ─────────────────────────────────────────────────────────

interface SFLead {
  Id: string;
  Name: string;
  FirstName?: string;
  LastName?: string;
  Company?: string;
  Title?: string;
  Phone?: string;
  MobilePhone?: string;
  Email?: string;
  Website?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  Status?: string;
  LeadSource?: string;
  Rating?: string;
  NumberOfEmployees?: number;
  AnnualRevenue?: number;
  Description?: string;
  OwnerId?: string;
  Owner?: { Name: string };
  Sales_Rep__c?: string;
  Sales_Rep__r?: { Name: string };
  Business_Development_Rep__c?: string;
  Business_Development_Rep__r?: { Name: string };
  CreatedDate?: string;
  LastActivityDate?: string;
  IsConverted?: boolean;
  ConvertedDate?: string;
  // Prophet research fields
  Marketing_Maturity_Score__c?: number;
  Likelihood_to_Buy_Score__c?: number;
  Priority_Level__c?: string;
  Primary_Gap_Type__c?: string;
  Research_Summary__c?: string;
  // Pardot / Account Engagement fields
  pi__score__c?: number;
  pi__grade__c?: string;
  pi__utm_source__c?: string;
  pi__utm_medium__c?: string;
  pi__utm_campaign__c?: string;
  pi__utm_content__c?: string;
  pi__utm_term__c?: string;
  pi__first_activity__c?: string;
  pi__last_activity__c?: string;
  pi__first_touch_url__c?: string;
  pi__last_touch_url__c?: string;
  pi__email_optout__c?: boolean;
}

interface SFTask {
  Id: string;
  Subject?: string;
  Description?: string;
  ActivityDate?: string;
  CreatedDate?: string;
  Status?: string;
  Type?: string;
  Owner?: { Name: string };
}

interface SFCompetitorSnapshot {
  Id: string;
  Competitor_Name__c?: string;
  Competitor_Website__c?: string;
  Google_Review_Count__c?: number;
  Google_Star_Rating__c?: number;
  Running_Google_Ads__c?: boolean;
  Maps_Pack_Position__c?: number;
  Competitive_Pressure_Score__c?: number;
  Primary_Services_Marketed__c?: string;
  Snapshot_Date__c?: string;
  Is_Primary_Competitor__c?: boolean;
}

interface SFGamma {
  Id: string;
  Name?: string;
  Gamma_Link__c?: string;
  CreatedDate?: string;
}

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const leadIntelligenceTools: Tool[] = [
  {
    name: 'sf_get_lead_intelligence',
    description:
      'Full pre-call intelligence brief for a Sales Rep on any Lead. ' +
      'Pulls Pardot engagement score and grade, UTM source and campaign attribution, ' +
      'Prophet research scores (Marketing Maturity, Likelihood to Buy, Priority Level), ' +
      'recent activity history, linked competitor snapshots, and any generated Gamma prospect decks. ' +
      'Use before any discovery call, follow-up, or when a rep asks "what do we know about this lead?" ' +
      'Accepts lead name (fuzzy search on Name or Company) or Salesforce Lead ID.',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: {
          type: 'string',
          description: 'Salesforce Lead ID — use if known to skip name search',
        },
        leadName: {
          type: 'string',
          description: 'Lead name or company name — fuzzy searched against both Name and Company fields',
        },
        includeNotes: {
          type: 'boolean',
          description: 'Include full task descriptions/call notes (default: true)',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schema ─────────────────────────────────────────────────────────────

const LeadIntelligenceArgs = z.object({
  leadId:       z.string().optional(),
  leadName:     z.string().optional(),
  includeNotes: z.boolean().default(true),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined): string {
  if (!d) return 'Unknown';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysSince(d: string | null | undefined): string {
  if (!d) return 'Never';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

function pardotGradeEmoji(grade: string | undefined): string {
  if (!grade) return '';
  const g = grade.toUpperCase();
  if (g.startsWith('A')) return '🟢';
  if (g.startsWith('B')) return '🟡';
  if (g.startsWith('C')) return '🟠';
  return '🔴';
}

function ltbBar(score: number): string {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${score}/100`;
}

function priorityEmoji(level: string | undefined): string {
  if (!level) return '';
  if (level === 'Top Priority') return '🔴';
  if (level === 'High')         return '🟠';
  if (level === 'Moderate')     return '🟡';
  return '🟢';
}

function pressureEmoji(score: number | undefined): string {
  if (!score) return '⚪';
  if (score >= 75) return '🔴';
  if (score >= 50) return '🟠';
  if (score >= 25) return '🟡';
  return '🟢';
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleLeadIntelligence(rawArgs: unknown): Promise<string> {
  const { leadId, leadName, includeNotes } = LeadIntelligenceArgs.parse(rawArgs ?? {});

  if (!leadId && !leadName) {
    return '❌ Provide either a leadId or leadName to look up a lead.';
  }

  // ── Step 1: Resolve Lead ──────────────────────────────────────────────────

  let resolvedLeadId = leadId;
  let sfLead: SFLead | null = null;

  const leadFields = [
    'Id', 'FirstName', 'LastName', 'Name', 'Company', 'Title',
    'Phone', 'MobilePhone', 'Email', 'Website',
    'City', 'State', 'PostalCode',
    'Status', 'LeadSource', 'Rating',
    'NumberOfEmployees', 'AnnualRevenue', 'Description',
    'OwnerId', 'Owner.Name',
    'Sales_Rep__c', 'Sales_Rep__r.Name',
    'Business_Development_Rep__c', 'Business_Development_Rep__r.Name',
    'CreatedDate', 'LastActivityDate', 'IsConverted', 'ConvertedDate',
    // Foresight fields
    'Marketing_Maturity_Score__c', 'Likelihood_to_Buy_Score__c',
    'Priority_Level__c', 'Primary_Gap_Type__c', 'Research_Summary__c',
    // Pardot fields
    'pi__score__c', 'pi__grade__c',
    'pi__utm_source__c', 'pi__utm_medium__c',
    'pi__utm_campaign__c', 'pi__utm_content__c', 'pi__utm_term__c',
    'pi__first_activity__c', 'pi__last_activity__c',
    'pi__first_touch_url__c', 'pi__last_touch_url__c',
    'pi__email_optout__c',
  ].join(', ');

  if (resolvedLeadId) {
    const r = await salesforceService.rawQuery<SFLead>(
      `SELECT ${leadFields} FROM Lead WHERE Id = '${resolvedLeadId}' LIMIT 1`
    );
    if (r.length > 0) sfLead = r[0];
  } else if (leadName) {
    const escaped = leadName.replace(/'/g, "\\'");
    const r = await salesforceService.rawQuery<SFLead>(
      `SELECT ${leadFields}
       FROM Lead
       WHERE (Name LIKE '%${escaped}%' OR Company LIKE '%${escaped}%')
         AND IsConverted = false
       ORDER BY LastActivityDate DESC NULLS LAST
       LIMIT 5`
    );
    if (r.length > 0) { sfLead = r[0]; resolvedLeadId = sfLead.Id; }
  }

  if (!sfLead || !resolvedLeadId) {
    return `❌ No Lead found matching "${leadId ?? leadName}". Check the name or ID and try again.`;
  }

  // ── Step 2: Parallel queries ──────────────────────────────────────────────

  const [tasks, competitorSnapshots, gammaDecks] = await Promise.all([
    // Recent activity — calls, emails, notes
    salesforceService.rawQuery<SFTask>(
      `SELECT Id, Subject, Description, ActivityDate, CreatedDate, Status, Type, Owner.Name
       FROM Task
       WHERE WhoId = '${resolvedLeadId}'
       ORDER BY CreatedDate DESC
       LIMIT 10`
    ).catch(() => [] as SFTask[]),

    // Competitor snapshots from research
    salesforceService.rawQuery<SFCompetitorSnapshot>(
      `SELECT Id, Competitor_Name__c, Competitor_Website__c,
              Google_Review_Count__c, Google_Star_Rating__c,
              Running_Google_Ads__c, Maps_Pack_Position__c,
              Competitive_Pressure_Score__c, Primary_Services_Marketed__c,
              Snapshot_Date__c, Is_Primary_Competitor__c
       FROM Competitor_Snapshot__c
       WHERE Lead__c = '${resolvedLeadId}'
       ORDER BY Is_Primary_Competitor__c DESC, Competitive_Pressure_Score__c DESC
       LIMIT 5`
    ).catch(() => [] as SFCompetitorSnapshot[]),

    // Gamma prospect decks
    salesforceService.rawQuery<SFGamma>(
      `SELECT Id, Name, Gamma_Link__c, CreatedDate
       FROM Gamma__c
       WHERE Lead__c = '${resolvedLeadId}'
       ORDER BY CreatedDate DESC
       LIMIT 3`
    ).catch(() => [] as SFGamma[]),
  ]);

  // ── Step 3: Build Output ──────────────────────────────────────────────────

  const lines: string[] = [];
  const practiceDisplay = sfLead.Company ?? sfLead.Name;
  const location = [sfLead.City, sfLead.State].filter(Boolean).join(', ');
  const ownerName = (sfLead.Owner as { Name?: string } | undefined)?.Name ?? 'Unassigned';
  const repName = (sfLead.Sales_Rep__r as { Name?: string } | undefined)?.Name;
  const bdrName = (sfLead.Business_Development_Rep__r as { Name?: string } | undefined)?.Name;

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`# 🎯 Lead Intelligence: ${practiceDisplay}`);
  if (location) lines.push(`**${location}**${sfLead.Website ? ` | ${sfLead.Website}` : ''}`);
  lines.push(`Lead: ${sfLead.Name}${sfLead.Title ? ` — ${sfLead.Title}` : ''}`);
  lines.push(`Owner: ${ownerName}${repName ? ` | Sales Rep: ${repName}` : ''}${bdrName ? ` | BDR: ${bdrName}` : ''}`);
  lines.push(`Status: **${sfLead.Status ?? 'Unknown'}** | Source: ${sfLead.LeadSource ?? 'Unknown'} | Created: ${fmt(sfLead.CreatedDate)}`);
  lines.push('');

  // ── Contact Info ──────────────────────────────────────────────────────────
  lines.push(`## 📞 Contact`);
  if (sfLead.Phone)       lines.push(`- **Phone:** ${sfLead.Phone}`);
  if (sfLead.MobilePhone) lines.push(`- **Mobile:** ${sfLead.MobilePhone}`);
  if (sfLead.Email)       lines.push(`- **Email:** ${sfLead.Email}${sfLead.pi__email_optout__c ? ' ⚠️ Opted out of email' : ''}`);
  if (sfLead.Website)     lines.push(`- **Website:** ${sfLead.Website}`);
  lines.push('');

  // ── Pardot Engagement ─────────────────────────────────────────────────────
  const hasPardot = sfLead.pi__score__c != null || sfLead.pi__grade__c || sfLead.pi__utm_source__c;
  lines.push(`## 📊 Pardot Engagement`);
  if (hasPardot) {
    if (sfLead.pi__score__c != null) lines.push(`- **Engagement Score:** ${sfLead.pi__score__c}/100`);
    if (sfLead.pi__grade__c)         lines.push(`- **Grade:** ${pardotGradeEmoji(sfLead.pi__grade__c)} ${sfLead.pi__grade__c}`);
    if (sfLead.pi__utm_source__c)    lines.push(`- **UTM Source:** ${sfLead.pi__utm_source__c}`);
    if (sfLead.pi__utm_medium__c)    lines.push(`- **UTM Medium:** ${sfLead.pi__utm_medium__c}`);
    if (sfLead.pi__utm_campaign__c)  lines.push(`- **Campaign:** ${sfLead.pi__utm_campaign__c}`);
    if (sfLead.pi__utm_content__c)   lines.push(`- **Content:** ${sfLead.pi__utm_content__c}`);
    if (sfLead.pi__utm_term__c)      lines.push(`- **Search Term:** ${sfLead.pi__utm_term__c}`);
    if (sfLead.pi__first_touch_url__c) lines.push(`- **First Touch:** ${sfLead.pi__first_touch_url__c}`);
    if (sfLead.pi__last_touch_url__c)  lines.push(`- **Last Touch:** ${sfLead.pi__last_touch_url__c}`);
    if (sfLead.pi__first_activity__c)  lines.push(`- **First Activity:** ${fmt(sfLead.pi__first_activity__c)}`);
    if (sfLead.pi__last_activity__c)   lines.push(`- **Last Pardot Activity:** ${fmt(sfLead.pi__last_activity__c)} (${daysSince(sfLead.pi__last_activity__c)})`);
  } else {
    lines.push(`- No Pardot engagement data on file. This lead may not be tracked in Account Engagement, or it arrived outside a Pardot campaign.`);
    if (sfLead.LeadSource) lines.push(`- **Source attribution:** ${sfLead.LeadSource}`);
  }
  lines.push('');

  // ── Prophet Research ────────────────────────────────────────────────────
  const hasResearch = sfLead.Marketing_Maturity_Score__c != null || sfLead.Likelihood_to_Buy_Score__c != null;
  lines.push(`## 🔍 Prophet Research`);
  if (hasResearch) {
    if (sfLead.Marketing_Maturity_Score__c != null)
      lines.push(`- **Marketing Maturity:** ${sfLead.Marketing_Maturity_Score__c}/100`);
    if (sfLead.Likelihood_to_Buy_Score__c != null)
      lines.push(`- **Likelihood to Buy:** ${ltbBar(sfLead.Likelihood_to_Buy_Score__c)}`);
    if (sfLead.Priority_Level__c)
      lines.push(`- **Priority:** ${priorityEmoji(sfLead.Priority_Level__c)} ${sfLead.Priority_Level__c}`);
    if (sfLead.Primary_Gap_Type__c)
      lines.push(`- **Primary Gap:** ${sfLead.Primary_Gap_Type__c}`);
    if (sfLead.Research_Summary__c) {
      lines.push(`- **Research Summary:**`);
      lines.push(`  > ${sfLead.Research_Summary__c}`);
    }
  } else {
    lines.push(`- No Prophet research on file.`);
    lines.push(`- 💡 Run \`sf_research_prospect\` to generate market analysis, scores, and a Gamma prospect deck.`);
  }
  lines.push('');

  // ── Gamma Decks ───────────────────────────────────────────────────────────
  if (gammaDecks.length > 0) {
    lines.push(`## 🎨 Prospect Deck${gammaDecks.length > 1 ? 's' : ''}`);
    for (const deck of gammaDecks) {
      lines.push(`- **${deck.Name ?? 'Prospect Deck'}** — Generated ${fmt(deck.CreatedDate)}`);
      if (deck.Gamma_Link__c) lines.push(`  🔗 ${deck.Gamma_Link__c}`);
    }
    lines.push('');
  }

  // ── Competitor Landscape ──────────────────────────────────────────────────
  if (competitorSnapshots.length > 0) {
    lines.push(`## ⚔️ Competitive Landscape`);
    for (const snap of competitorSnapshots) {
      const isPrimary = snap.Is_Primary_Competitor__c ? ' 🔴 Primary Threat' : '';
      lines.push(`- **${snap.Competitor_Name__c ?? 'Unknown'}**${isPrimary}`);
      if (snap.Google_Review_Count__c != null)
        lines.push(`  Reviews: ${snap.Google_Review_Count__c}${snap.Google_Star_Rating__c != null ? ` (${snap.Google_Star_Rating__c}⭐)` : ''}`);
      if (snap.Running_Google_Ads__c) lines.push(`  Running Google Ads: ✅ YES`);
      if (snap.Maps_Pack_Position__c != null && snap.Maps_Pack_Position__c >= 1)
        lines.push(`  Maps Pack: Position #${snap.Maps_Pack_Position__c}`);
      if (snap.Competitive_Pressure_Score__c != null)
        lines.push(`  Pressure: ${pressureEmoji(snap.Competitive_Pressure_Score__c)} ${snap.Competitive_Pressure_Score__c}/100`);
      if (snap.Primary_Services_Marketed__c) lines.push(`  Services: ${snap.Primary_Services_Marketed__c}`);
    }
    lines.push('');
  }

  // ── Activity History ──────────────────────────────────────────────────────
  lines.push(`## 📋 Recent Activity`);
  lines.push(`Last Activity: **${daysSince(sfLead.LastActivityDate)}** (${fmt(sfLead.LastActivityDate)})`);
  lines.push('');

  if (tasks.length > 0) {
    for (const task of tasks) {
      const taskOwner = (task.Owner as { Name?: string } | undefined)?.Name ?? '';
      lines.push(`**${task.Subject ?? 'Activity'}** — ${fmt(task.ActivityDate ?? task.CreatedDate)}${taskOwner ? ` | ${taskOwner}` : ''}`);
      if (includeNotes && task.Description) {
        const preview = task.Description.length > 400
          ? task.Description.slice(0, 400) + '…'
          : task.Description;
        lines.push(`> ${preview.replace(/\n/g, '\n> ')}`);
      }
      lines.push('');
    }
  } else {
    lines.push(`No activity logged yet.`);
    lines.push('');
  }

  // ── Call Prep Summary ─────────────────────────────────────────────────────
  lines.push(`---`);
  lines.push(`## ⚡ Call Prep — Key Points`);
  lines.push('');

  // Source context
  if (sfLead.pi__utm_source__c || sfLead.LeadSource) {
    const source = sfLead.pi__utm_source__c ?? sfLead.LeadSource;
    const campaign = sfLead.pi__utm_campaign__c;
    lines.push(`📥 **How they found PDM:** ${source}${campaign ? ` — Campaign: ${campaign}` : ''}`);
  }

  // Engagement signal
  if (sfLead.pi__score__c != null) {
    const engagementNote = sfLead.pi__score__c >= 70
      ? 'High engagement — they\'ve been active on PDM content. They know who we are.'
      : sfLead.pi__score__c >= 40
        ? 'Moderate engagement — some awareness, warming up.'
        : 'Low engagement — may need education. Lead with the market data.';
    lines.push(`📊 **Engagement signal:** Score ${sfLead.pi__score__c} — ${engagementNote}`);
  }

  // Research signal
  if (sfLead.Likelihood_to_Buy_Score__c != null) {
    const ltbNote = sfLead.Likelihood_to_Buy_Score__c >= 70
      ? 'High intent — this practice has real marketing gaps and the profile to invest.'
      : sfLead.Likelihood_to_Buy_Score__c >= 50
        ? 'Moderate intent — good fit, but may need convincing.'
        : 'Lower intent — focus on education and gap awareness before pitching.';
    lines.push(`🎯 **Market readiness:** LTB ${sfLead.Likelihood_to_Buy_Score__c}/100 — ${ltbNote}`);
  }

  // Gap opener
  if (sfLead.Primary_Gap_Type__c) {
    const gapOpeners: Record<string, string> = {
      SEO:        'Open with: "I searched for dental implants in [city] — your competitors are ranking, and you\'re not showing up."',
      Reputation: 'Open with: "I looked at your Google reviews vs. [top competitor] — there\'s a gap worth talking about."',
      Video:      'Open with: "Your top competitors are using video to build trust online. You\'re not visible in that space yet."',
      Authority:  'Open with: "Patients spending $25K on implants research the doctor online first. Your online presence doesn\'t reflect your expertise."',
      Maps:       'Open with: "I searched for a dentist in [neighborhood] — your competitors are in the Maps pack and you\'re not there."',
    };
    const opener = gapOpeners[sfLead.Primary_Gap_Type__c];
    if (opener) lines.push(`💬 **Recommended opener:** ${opener}`);
  }

  // Competitor angle
  const primaryComp = competitorSnapshots.find(s => s.Is_Primary_Competitor__c);
  if (primaryComp) {
    lines.push(`⚔️ **Competitor angle:** ${primaryComp.Competitor_Name__c}${primaryComp.Google_Review_Count__c != null ? ` has ${primaryComp.Google_Review_Count__c} reviews` : ''} and${primaryComp.Running_Google_Ads__c ? ' is running Google Ads' : ' is actively marketing'}. Use this as urgency.`);
  }

  // Deck ready
  if (gammaDecks.length > 0) {
    lines.push(`🎨 **Deck ready:** Share ${gammaDecks[0].Gamma_Link__c ?? 'the Gamma deck'} before or during the call.`);
  } else if (sfLead.Marketing_Maturity_Score__c != null) {
    lines.push(`🎨 **No deck yet** — research exists but no Gamma deck was generated. Run \`sf_research_prospect\` again to trigger deck creation.`);
  } else {
    lines.push(`🎨 **No research yet** — run \`sf_research_prospect\` to generate market analysis + prospect deck before the call.`);
  }

  lines.push('');
  lines.push(`Lead ID: \`${resolvedLeadId}\``);

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const leadIntelligenceHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_get_lead_intelligence: handleLeadIntelligence,
};
