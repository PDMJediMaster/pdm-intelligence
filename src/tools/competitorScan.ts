// ─────────────────────────────────────────────────────────────────────────────
// Competitor Intelligence Tools — DIM (Detect, Investigate, Monitor)
//
// Two-tool architecture — mirrors sf_research_prospect pattern:
//
//   Tool 1: sf_scan_competitor
//     - Looks up existing Competitor_Snapshot__c records
//     - Returns prior snapshot data for delta comparison context
//     - Returns structured web research instructions for Claude to execute
//     - Claude Desktop runs the competitive scan natively
//
//   Tool 2: sf_save_competitor_snapshot
//     - Accepts competitive data extracted by Claude from the scan
//     - Creates or updates Competitor_Snapshot__c records
//     - Rotates current values → Previous_ fields before writing new data
//     - Calculates Review_Delta__c and sets Alert_Triggered__c when thresholds exceeded
//     - Links to Account and/or Lead as specified
//
// Powers the 4-Conversation Framework:
//   Buy (prospect) → Resume (save play) → Upsell (quarterly) → Renew (proof)
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompetitorSnapshot {
  Id: string;
  Name: string;
  Competitor_Name__c?: string;
  Competitor_Website__c?: string;
  Snapshot_Date__c?: string;
  Previous_Snapshot_Date__c?: string;
  Google_Review_Count__c?: number;
  Google_Star_Rating__c?: number;
  Previous_Review_Count__c?: number;
  Review_Delta__c?: number;
  Maps_Pack_Position__c?: number;
  Running_Google_Ads__c?: boolean;
  Running_Facebook_Ads__c?: boolean;
  Primary_Services_Marketed__c?: string;
  Competitive_Pressure_Score__c?: number;
  Is_Primary_Competitor__c?: boolean;
  Alert_Triggered__c?: boolean;
  Research_Notes__c?: string;
  Account__c?: string;
  Account__r?: { Name: string; Owner?: { Name: string } };
  Lead__c?: string;
  Lead__r?: { Name: string; Company?: string; Owner?: { Name: string } };
}

interface LinkedRecord {
  Id: string;
  Name: string;
  BillingCity?: string;
  BillingState?: string;
  City?: string;
  State?: string;
  Website?: string;
  Status__c?: string;
  Owner?: { Name: string };
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const competitorScanTools: Tool[] = [
  {
    name: 'sf_scan_competitor',
    description:
      'Step 1 of competitor intelligence. Looks up existing Competitor_Snapshot__c records, ' +
      'returns prior data for comparison context, and returns structured web research instructions ' +
      'for Claude to execute. After calling this tool, immediately run the competitive scan as ' +
      'instructed in the output, then call sf_save_competitor_snapshot to write results back to Salesforce. ' +
      'Use when asked to: "scan [competitor]", "check what [competitor] is doing", ' +
      '"who is competing with [account] in [city]", "run a competitive check", ' +
      '"what has [competitor] done since [account] paused", or before any save play / renewal call.',
    inputSchema: {
      type: 'object',
      properties: {
        competitorName: {
          type: 'string',
          description: 'Name of the competitor dental practice to scan',
        },
        competitorWebsite: {
          type: 'string',
          description: 'Competitor website URL — accelerates research significantly if known',
        },
        city: {
          type: 'string',
          description: 'City where the competitor is located',
        },
        state: {
          type: 'string',
          description: 'State (2-letter code preferred, e.g. "TX", "FL")',
        },
        accountId: {
          type: 'string',
          description: 'PDM client Account ID — links this competitor to a specific client',
        },
        leadId: {
          type: 'string',
          description: 'Salesforce Lead ID — links this competitor to a prospect',
        },
        snapshotId: {
          type: 'string',
          description: 'Existing Competitor_Snapshot__c ID to update — skips lookup if already known',
        },
        isPrimary: {
          type: 'boolean',
          description: 'Is this the dominant/primary competitor? Default: true',
        },
        context: {
          type: 'string',
          enum: ['prospect', 'save_play', 'quarterly_review', 'renewal'],
          description:
            'Conversation context — shapes the output framing. ' +
            'prospect: closing a new deal. save_play: account paused/cancelling. ' +
            'quarterly_review: active client check-in. renewal: renewal conversation.',
        },
      },
      required: ['competitorName'],
    },
  },
  {
    name: 'sf_save_competitor_snapshot',
    description:
      'Step 2 of competitor intelligence. Saves competitive scan results to Salesforce. ' +
      'When updating an existing snapshot, automatically rotates current values to Previous_ fields ' +
      'and calculates the review delta. Triggers alerts when review velocity, new ads, or Maps pack ' +
      'changes exceed thresholds. Call immediately after completing the competitive scan from sf_scan_competitor.',
    inputSchema: {
      type: 'object',
      properties: {
        competitorName:           { type: 'string', description: 'Competitor practice name (required)' },
        competitorWebsite:        { type: 'string', description: 'Competitor website URL' },
        accountId:                { type: 'string', description: 'PDM client Account ID to link this competitor to' },
        leadId:                   { type: 'string', description: 'Salesforce Lead ID to link this competitor to' },
        snapshotId:               { type: 'string', description: 'Existing Competitor_Snapshot__c ID to update' },
        isPrimary:                { type: 'boolean', description: 'Is this the primary/dominant competitor?' },
        googleReviewCount:        { type: 'number', description: 'Current Google review count' },
        googleStarRating:         { type: 'number', description: 'Current Google star rating (e.g. 4.7)' },
        estimatedMonthlyReviews:  { type: 'number', description: 'Estimated new reviews per month (review velocity)' },
        mapsPackPosition:         { type: 'number', description: 'Google Maps pack position (1-3 = in pack, 0 = not in pack, null = unknown)' },
        runningGoogleAds:         { type: 'boolean', description: 'Running Google Ads?' },
        runningFacebookAds:       { type: 'boolean', description: 'Running Facebook/Meta ads?' },
        hasYouTubeChannel:        { type: 'boolean', description: 'Has an active YouTube channel?' },
        youtubeVideoCount:        { type: 'number', description: 'Number of videos on their YouTube channel' },
        socialPlatforms:          { type: 'string', description: 'Active social platforms (comma-separated, e.g. "Facebook, Instagram, TikTok")' },
        hasImplantSpecificPages:  { type: 'boolean', description: 'Website has implant-specific landing pages (All-on-4, full-arch, etc.)?' },
        primaryServicesMarketed:  { type: 'string', description: 'Primary services marketed (comma-separated)' },
        competitivePressureScore: { type: 'number', description: 'Competitive pressure score 0-100 (your assessment of overall competitive threat level)' },
        researchNotes:            { type: 'string', description: 'Key findings and intelligence notes — max 2000 characters' },
      },
      required: ['competitorName'],
    },
  },
];

// ─── Input Schemas ────────────────────────────────────────────────────────────

const ScanCompetitorArgs = z.object({
  competitorName:    z.string(),
  competitorWebsite: z.string().optional(),
  city:              z.string().optional(),
  state:             z.string().optional(),
  accountId:         z.string().optional(),
  leadId:            z.string().optional(),
  snapshotId:        z.string().optional(),
  isPrimary:         z.boolean().default(true),
  context:           z.enum(['prospect', 'save_play', 'quarterly_review', 'renewal']).default('prospect'),
});

const SaveCompetitorSnapshotArgs = z.object({
  competitorName:           z.string(),
  competitorWebsite:        z.string().optional(),
  accountId:                z.string().optional(),
  leadId:                   z.string().optional(),
  snapshotId:               z.string().optional(),
  isPrimary:                z.boolean().default(true),
  googleReviewCount:        z.number().optional(),
  googleStarRating:         z.number().optional(),
  estimatedMonthlyReviews:  z.number().optional(),
  mapsPackPosition:         z.number().optional(),
  runningGoogleAds:         z.boolean().optional(),
  runningFacebookAds:       z.boolean().optional(),
  hasYouTubeChannel:        z.boolean().optional(),
  youtubeVideoCount:        z.number().optional(),
  socialPlatforms:          z.string().optional(),
  hasImplantSpecificPages:  z.boolean().optional(),
  primaryServicesMarketed:  z.string().optional(),
  competitivePressureScore: z.number().min(0).max(100).optional(),
  researchNotes:            z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null | undefined): string {
  if (!d) return 'Unknown';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysSince(d: string | null | undefined): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
}

function pressureLabel(score: number | undefined): string {
  if (score == null) return 'Unknown';
  if (score >= 75) return '🔴 High Threat';
  if (score >= 50) return '🟠 Elevated';
  if (score >= 25) return '🟡 Moderate';
  return '🟢 Low';
}

function contextFraming(ctx: string): string {
  const frames: Record<string, string> = {
    prospect:         'CLOSE THE DEAL — frame every gap as a specific PDM product that closes it.',
    save_play:        'SAVE PLAY — frame around what moved in the market WHILE THE CLIENT WAS PAUSED. Urgency is the hook.',
    quarterly_review: 'UPSELL — frame around what the competitor gained this quarter that the client doesn\'t have yet.',
    renewal:          'RENEWAL PROOF — frame around what the client has surpassed AND what new gaps have opened that Phase 2/3 closes.',
  };
  return frames[ctx] ?? frames['prospect'];
}

// ─── Handler 1: sf_scan_competitor ───────────────────────────────────────────

async function handleScanCompetitor(rawArgs: unknown): Promise<string> {
  const {
    competitorName,
    competitorWebsite,
    city,
    state,
    accountId,
    leadId,
    snapshotId: rawSnapshotId,
    isPrimary,
    context,
  } = ScanCompetitorArgs.parse(rawArgs ?? {});

  const lines: string[] = [];
  const escapedName = competitorName.replace(/'/g, "\\'");

  // ── 1. Fetch existing snapshot(s) ─────────────────────────────────────────

  let existingSnapshots: CompetitorSnapshot[] = [];

  if (rawSnapshotId) {
    existingSnapshots = await salesforceService.rawQuery<CompetitorSnapshot>(
      `SELECT Id, Name, Competitor_Name__c, Competitor_Website__c,
              Snapshot_Date__c, Previous_Snapshot_Date__c,
              Google_Review_Count__c, Google_Star_Rating__c,
              Previous_Review_Count__c, Review_Delta__c,
              Maps_Pack_Position__c, Running_Google_Ads__c, Running_Facebook_Ads__c,
              Primary_Services_Marketed__c, Competitive_Pressure_Score__c,
              Is_Primary_Competitor__c, Alert_Triggered__c, Research_Notes__c,
              Account__c, Account__r.Name, Lead__c, Lead__r.Name, Lead__r.Company
       FROM Competitor_Snapshot__c
       WHERE Id = '${rawSnapshotId}'
       LIMIT 1`
    );
  } else {
    // Fuzzy lookup by name, optionally filtered to this account/lead
    const conditions: string[] = [`Competitor_Name__c LIKE '%${escapedName}%'`];
    if (accountId) conditions.push(`Account__c = '${accountId}'`);
    if (leadId)    conditions.push(`Lead__c = '${leadId}'`);

    existingSnapshots = await salesforceService.rawQuery<CompetitorSnapshot>(
      `SELECT Id, Name, Competitor_Name__c, Competitor_Website__c,
              Snapshot_Date__c, Previous_Snapshot_Date__c,
              Google_Review_Count__c, Google_Star_Rating__c,
              Previous_Review_Count__c, Review_Delta__c,
              Maps_Pack_Position__c, Running_Google_Ads__c, Running_Facebook_Ads__c,
              Primary_Services_Marketed__c, Competitive_Pressure_Score__c,
              Is_Primary_Competitor__c, Alert_Triggered__c, Research_Notes__c,
              Account__c, Account__r.Name, Lead__c, Lead__r.Name, Lead__r.Company
       FROM Competitor_Snapshot__c
       WHERE ${conditions.join(' AND ')}
       ORDER BY Snapshot_Date__c DESC NULLS LAST
       LIMIT 5`
    );
  }

  const priorSnapshot = existingSnapshots[0] ?? null;
  const isUpdate      = priorSnapshot != null;
  const snapshotId    = priorSnapshot?.Id;

  // ── 2. Fetch linked Account or Lead for city/state context ────────────────

  let linkedRecord: LinkedRecord | null = null;

  if (accountId && !city) {
    const accts = await salesforceService.rawQuery<LinkedRecord>(
      `SELECT Id, Name, BillingCity, BillingState, Website, Status__c, Owner.Name
       FROM Account WHERE Id = '${accountId}' LIMIT 1`
    );
    linkedRecord = accts[0] ?? null;
  } else if (leadId && !city) {
    const leads = await salesforceService.rawQuery<LinkedRecord>(
      `SELECT Id, Name, City, State, Website, Owner.Name
       FROM Lead WHERE Id = '${leadId}' LIMIT 1`
    );
    linkedRecord = leads[0] ?? null;
  }

  const resolvedCity  = city  ?? linkedRecord?.BillingCity  ?? linkedRecord?.City  ?? '';
  const resolvedState = state ?? linkedRecord?.BillingState ?? linkedRecord?.State ?? '';
  const locationStr   = [resolvedCity, resolvedState].filter(Boolean).join(', ');

  // ── 3. Build header ───────────────────────────────────────────────────────

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  lines.push(`# ⚔️ Competitor Intelligence Scan`);
  lines.push(`**Competitor:** ${competitorName}${competitorWebsite ? ` — ${competitorWebsite}` : ''}`);
  if (locationStr) lines.push(`**Market:** ${locationStr}`);
  if (linkedRecord) {
    const label = accountId ? 'Client' : 'Prospect';
    lines.push(`**Linked ${label}:** ${linkedRecord.Name}${accountId ? ` (${(linkedRecord as { Status__c?: string }).Status__c ?? 'Status unknown'})` : ''}`);
  }
  lines.push(`**Context:** ${context.replace('_', ' ').toUpperCase()}`);
  lines.push(`**Date:** ${today}`);
  lines.push('');

  // ── 4. Prior snapshot context (if updating) ───────────────────────────────

  if (isUpdate && priorSnapshot) {
    const daysAgo   = daysSince(priorSnapshot.Snapshot_Date__c);
    const daysLabel = daysAgo != null ? `${daysAgo} days ago` : 'Unknown';

    lines.push(`## 📊 Prior Snapshot — ${formatDate(priorSnapshot.Snapshot_Date__c)} (${daysLabel})`);
    lines.push('');
    lines.push(`| Signal | Last Known Value |`);
    lines.push(`|---|---|`);
    if (priorSnapshot.Google_Review_Count__c != null)
      lines.push(`| Google Reviews | **${priorSnapshot.Google_Review_Count__c}** ${priorSnapshot.Google_Star_Rating__c ? `(${priorSnapshot.Google_Star_Rating__c}⭐)` : ''} |`);
    if (priorSnapshot.Maps_Pack_Position__c != null)
      lines.push(`| Maps Pack Position | **${priorSnapshot.Maps_Pack_Position__c === 0 ? 'Not in pack' : `#${priorSnapshot.Maps_Pack_Position__c}`}** |`);
    if (priorSnapshot.Running_Google_Ads__c != null)
      lines.push(`| Google Ads | **${priorSnapshot.Running_Google_Ads__c ? '✅ Running' : '❌ Not running'}** |`);
    if (priorSnapshot.Running_Facebook_Ads__c != null)
      lines.push(`| Facebook Ads | **${priorSnapshot.Running_Facebook_Ads__c ? '✅ Running' : '❌ Not running'}** |`);
    if (priorSnapshot.Competitive_Pressure_Score__c != null)
      lines.push(`| Pressure Score | **${priorSnapshot.Competitive_Pressure_Score__c}/100** — ${pressureLabel(priorSnapshot.Competitive_Pressure_Score__c)} |`);
    if (priorSnapshot.Primary_Services_Marketed__c)
      lines.push(`| Services Marketed | ${priorSnapshot.Primary_Services_Marketed__c} |`);
    lines.push('');

    if (priorSnapshot.Research_Notes__c) {
      lines.push(`**Prior Notes:** ${priorSnapshot.Research_Notes__c}`);
      lines.push('');
    }

    lines.push(`> **This is an UPDATE scan.** Look specifically for what has CHANGED since ${formatDate(priorSnapshot.Snapshot_Date__c)}.`);
    lines.push(`> Review delta, new ad campaigns, Maps pack shifts, and new platforms are the priority signals.`);
    lines.push('');
  } else {
    lines.push(`> **This is an INITIAL scan.** No prior snapshot exists. Establish the baseline.`);
    lines.push('');
  }

  // ── 5. Research instructions ──────────────────────────────────────────────

  const websiteSearch = competitorWebsite ?? `${competitorName} ${locationStr} dental`;

  lines.push(`---`);
  lines.push('');
  lines.push(`## 🔍 Competitive Scan Instructions`);
  lines.push('');
  lines.push(`Run each section below. Record all findings — positive and negative. If data is unavailable, note it explicitly rather than omitting it.`);
  lines.push('');

  lines.push(`### 1. Google Reviews & Reputation`);
  lines.push(`Search: **"${competitorName}" ${locationStr} dental reviews**`);
  lines.push(`Also check their Google Business Profile directly.`);
  lines.push(`- Current review count (exact number)`);
  lines.push(`- Current star rating`);
  lines.push(`- Estimated monthly velocity: look at dates on recent reviews — how many in the last 30, 60, 90 days?`);
  lines.push(`- Sentiment themes: what do patients say most? What complaints appear?`);
  lines.push(`- Are they responding to reviews? Response rate estimate?`);
  if (isUpdate && priorSnapshot?.Google_Review_Count__c) {
    lines.push(`- **DELTA FOCUS:** Last count was **${priorSnapshot.Google_Review_Count__c}**. Report exact gain since ${formatDate(priorSnapshot.Snapshot_Date__c)}.`);
  }
  lines.push('');

  lines.push(`### 2. Google Maps Pack`);
  lines.push(`Search: **dental implants ${locationStr}** — check Maps pack (top 3 local results)`);
  lines.push(`Also search: **full arch implants ${locationStr}**, **All-on-4 ${locationStr}**, **teeth implants ${locationStr}**`);
  lines.push(`- Are they in the Maps pack? For which searches?`);
  lines.push(`- What position (1, 2, or 3)?`);
  lines.push(`- How many photos on their Google Business Profile?`);
  lines.push(`- Do they have Google Q&A populated?`);
  if (isUpdate && priorSnapshot?.Maps_Pack_Position__c != null) {
    const pos = priorSnapshot.Maps_Pack_Position__c;
    lines.push(`- **DELTA FOCUS:** Last Maps position was **${pos === 0 ? 'not in pack' : `#${pos}`}**. Report any change.`);
  }
  lines.push('');

  lines.push(`### 3. Google Ads Detection`);
  lines.push(`Search: **dental implants ${locationStr}**, **All-on-4 ${locationStr}**, **full arch implants ${locationStr}**`);
  lines.push(`Also search their brand name: **${competitorName}**`);
  lines.push(`- Are they running Google Ads (sponsored results at top)?`);
  lines.push(`- What keywords are they bidding on?`);
  lines.push(`- Ad copy tone: price-focused, outcome-focused, financing-focused?`);
  lines.push(`- Are they running retargeting / display ads?`);
  if (isUpdate && priorSnapshot?.Running_Google_Ads__c != null) {
    lines.push(`- **DELTA FOCUS:** Last status was **${priorSnapshot.Running_Google_Ads__c ? 'running ads' : 'NOT running ads'}**. Report any change.`);
  }
  lines.push('');

  lines.push(`### 4. Facebook / Meta Ads`);
  lines.push(`Check Meta Ad Library: https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${encodeURIComponent(competitorName)}`);
  lines.push(`- Are they running Facebook or Instagram ads?`);
  lines.push(`- How many active ads? How long have they been running?`);
  lines.push(`- What formats: video, carousel, image? Lead form ads?`);
  lines.push(`- Offer/CTA: free consultation, financing, before/after?`);
  if (isUpdate && priorSnapshot?.Running_Facebook_Ads__c != null) {
    lines.push(`- **DELTA FOCUS:** Last status was **${priorSnapshot.Running_Facebook_Ads__c ? 'running Facebook ads' : 'NOT running Facebook ads'}**. Report any change.`);
  }
  lines.push('');

  lines.push(`### 5. YouTube & Video Presence`);
  lines.push(`Search YouTube: **${competitorName}** and **${websiteSearch}**`);
  lines.push(`Also check their website for embedded video.`);
  lines.push(`- Do they have a YouTube channel? How many subscribers, videos?`);
  lines.push(`- Video types: procedure walkthroughs, patient testimonials, doctor authority, before/after?`);
  lines.push(`- Is the doctor visible on camera as the authority figure?`);
  lines.push(`- Video on website homepage or implant pages?`);
  lines.push('');

  lines.push(`### 6. Social Media Presence`);
  lines.push(`Check Facebook, Instagram, TikTok for: **${competitorName}**`);
  lines.push(`- Which platforms are they active on?`);
  lines.push(`- Posting frequency (posts per week estimate)?`);
  lines.push(`- Content quality: stock images, custom photography, before/after cases?`);
  lines.push(`- Follower count (rough estimate)?`);
  lines.push(`- Are they running social ads? (check boosted posts)`);
  lines.push('');

  lines.push(`### 7. Website Audit`);
  lines.push(`Visit: ${competitorWebsite ?? `[Search for ${competitorName} website]`}`);
  lines.push(`- Do they have implant-specific landing pages? (All-on-4, full-arch, dental implants, candidacy)`);
  lines.push(`- Before/after gallery present?`);
  lines.push(`- Doctor authority signals: certifications, training, publications, video?`);
  lines.push(`- Financing CTA visible? (CareCredit, Sunbit, in-house financing)`);
  lines.push(`- Mobile optimization quality?`);
  lines.push(`- Overall trust impression (1-10): clean/modern vs. dated?`);
  lines.push(`- Do they have a blog or content hub? When was it last updated?`);
  lines.push('');

  lines.push(`### 8. SEO Signals`);
  lines.push(`Search: **dental implants ${locationStr}** in incognito mode`);
  lines.push(`- What organic position do they rank at?`);
  lines.push(`- Do they rank for multiple implant-related terms?`);
  lines.push(`- Do they have local landing pages for surrounding ZIP codes or cities?`);
  lines.push('');

  // ── 6. Assessment & scoring instructions ─────────────────────────────────

  lines.push(`---`);
  lines.push('');
  lines.push(`## 📊 Scoring After Research`);
  lines.push('');
  lines.push(`**Competitive Pressure Score (0–100):** Your overall assessment of how much competitive threat this practice represents:`);
  lines.push(`- 75–100: Dominant. Running ads, in Maps pack, 300+ reviews, active social, YouTube channel, modern website`);
  lines.push(`- 50–74: Elevated. Strong in 2–3 channels, actively investing in marketing`);
  lines.push(`- 25–49: Moderate. Present but not aggressive, weak in multiple channels`);
  lines.push(`- 0–24: Low. Minimal online presence, easy to outpace`);
  lines.push('');

  // ── 7. Context-specific framing ───────────────────────────────────────────

  lines.push(`---`);
  lines.push('');
  lines.push(`## 💬 Output Framing — ${context.replace('_', ' ').toUpperCase()}`);
  lines.push('');
  lines.push(`**${contextFraming(context)}**`);
  lines.push('');

  if (context === 'save_play') {
    lines.push(`For the save play hook, structure your output as:`);
    lines.push(`*"While [client] has been paused, [competitor] has [specific action]. Your [metric] has [changed/stayed]. Here's the three-move play to re-establish dominance — and it starts with [specific PDM product]."*`);
    lines.push('');
  } else if (context === 'renewal') {
    lines.push(`For the renewal frame, identify:`);
    lines.push(`1. What competitive ground has been GAINED since the client started (where they've surpassed competitors)`);
    lines.push(`2. What NEW competitive threats have opened in the last 12 months`);
    lines.push(`3. What Phase 2/3 gaps remain to close`);
    lines.push('');
  } else if (context === 'quarterly_review') {
    lines.push(`For the upsell hook, identify what the competitor has done THIS QUARTER that the client doesn't have yet.`);
    lines.push(`Map each finding to a specific PDM product with a dollar value.`);
    lines.push('');
  }

  // ── 8. Save instructions ──────────────────────────────────────────────────

  lines.push(`---`);
  lines.push('');
  lines.push(`## 📥 After Research — Save to Salesforce`);
  lines.push('');
  lines.push(`When research is complete, call **sf_save_competitor_snapshot** with:`);
  lines.push(`- \`competitorName\`: "${competitorName}"`);
  if (competitorWebsite) lines.push(`- \`competitorWebsite\`: "${competitorWebsite}"`);
  if (accountId) lines.push(`- \`accountId\`: "${accountId}"`);
  if (leadId)    lines.push(`- \`leadId\`: "${leadId}"`);
  if (snapshotId) lines.push(`- \`snapshotId\`: "${snapshotId}"  ← UPDATE existing record`);
  lines.push(`- \`isPrimary\`: ${isPrimary}`);
  lines.push(`- \`googleReviewCount\`: <current count>`);
  lines.push(`- \`googleStarRating\`: <current rating>`);
  lines.push(`- \`estimatedMonthlyReviews\`: <estimated new reviews per month>`);
  lines.push(`- \`mapsPackPosition\`: <1-3 if in pack, 0 if not>`);
  lines.push(`- \`runningGoogleAds\`: <true | false>`);
  lines.push(`- \`runningFacebookAds\`: <true | false>`);
  lines.push(`- \`hasYouTubeChannel\`: <true | false>`);
  lines.push(`- \`youtubeVideoCount\`: <count if channel exists>`);
  lines.push(`- \`socialPlatforms\`: <"Facebook, Instagram" etc.>`);
  lines.push(`- \`hasImplantSpecificPages\`: <true | false>`);
  lines.push(`- \`primaryServicesMarketed\`: <comma-separated services>`);
  lines.push(`- \`competitivePressureScore\`: <your 0-100 assessment>`);
  lines.push(`- \`researchNotes\`: <key findings paragraph>`);
  lines.push('');

  return lines.join('\n');
}

// ─── Handler 2: sf_save_competitor_snapshot ───────────────────────────────────

async function handleSaveCompetitorSnapshot(rawArgs: unknown): Promise<string> {
  const {
    competitorName,
    competitorWebsite,
    accountId,
    leadId,
    snapshotId: rawSnapshotId,
    isPrimary,
    googleReviewCount,
    googleStarRating,
    estimatedMonthlyReviews,
    mapsPackPosition,
    runningGoogleAds,
    runningFacebookAds,
    hasYouTubeChannel,
    youtubeVideoCount,
    socialPlatforms,
    hasImplantSpecificPages,
    primaryServicesMarketed,
    competitivePressureScore,
    researchNotes,
  } = SaveCompetitorSnapshotArgs.parse(rawArgs ?? {});

  const lines: string[] = [];
  const today = new Date().toISOString().split('T')[0];

  // ── 1. Find existing snapshot ─────────────────────────────────────────────

  let existingSnapshot: CompetitorSnapshot | null = null;

  if (rawSnapshotId) {
    const results = await salesforceService.rawQuery<CompetitorSnapshot>(
      `SELECT Id, Google_Review_Count__c, Google_Star_Rating__c,
              Maps_Pack_Position__c, Running_Google_Ads__c, Running_Facebook_Ads__c,
              Competitive_Pressure_Score__c, Snapshot_Date__c, Competitor_Name__c
       FROM Competitor_Snapshot__c
       WHERE Id = '${rawSnapshotId}' LIMIT 1`
    );
    existingSnapshot = results[0] ?? null;
  } else if (accountId || leadId) {
    const escapedName = competitorName.replace(/'/g, "\\'");
    const conditions  = [`Competitor_Name__c LIKE '%${escapedName}%'`];
    if (accountId) conditions.push(`Account__c = '${accountId}'`);
    if (leadId)    conditions.push(`Lead__c = '${leadId}'`);

    const results = await salesforceService.rawQuery<CompetitorSnapshot>(
      `SELECT Id, Google_Review_Count__c, Google_Star_Rating__c,
              Maps_Pack_Position__c, Running_Google_Ads__c, Running_Facebook_Ads__c,
              Competitive_Pressure_Score__c, Snapshot_Date__c, Competitor_Name__c
       FROM Competitor_Snapshot__c
       WHERE ${conditions.join(' AND ')}
       ORDER BY Snapshot_Date__c DESC NULLS LAST
       LIMIT 1`
    );
    existingSnapshot = results[0] ?? null;
  }

  const isUpdate = existingSnapshot != null;

  // ── 2. Calculate deltas ───────────────────────────────────────────────────

  const prevReviewCount = existingSnapshot?.Google_Review_Count__c ?? null;
  const reviewDelta     = (googleReviewCount != null && prevReviewCount != null)
    ? googleReviewCount - prevReviewCount
    : null;

  // Determine what changed (for alert generation)
  const adFlippedOn   = runningGoogleAds === true  && existingSnapshot?.Running_Google_Ads__c === false;
  const fbFlippedOn   = runningFacebookAds === true && existingSnapshot?.Running_Facebook_Ads__c === false;
  const enteredPack   = mapsPackPosition != null && mapsPackPosition >= 1 && mapsPackPosition <= 3
    && (existingSnapshot?.Maps_Pack_Position__c == null || existingSnapshot.Maps_Pack_Position__c === 0);
  const highVelocity  = reviewDelta != null && reviewDelta >= 10;
  const shouldAlert   = adFlippedOn || fbFlippedOn || enteredPack || highVelocity
    || (competitivePressureScore != null && competitivePressureScore >= 75);

  // ── 3. Build Salesforce fields ────────────────────────────────────────────

  const snapshotFields: Record<string, unknown> = {
    Competitor_Name__c:    competitorName,
    Snapshot_Date__c:      today,
    Is_Primary_Competitor__c: isPrimary,
    Alert_Triggered__c:    shouldAlert,
  };

  if (competitorWebsite)      snapshotFields['Competitor_Website__c']        = competitorWebsite;
  if (accountId)              snapshotFields['Account__c']                   = accountId;
  if (leadId)                 snapshotFields['Lead__c']                      = leadId;
  if (googleReviewCount != null) snapshotFields['Google_Review_Count__c']   = googleReviewCount;
  if (googleStarRating  != null) snapshotFields['Google_Star_Rating__c']    = googleStarRating;
  if (mapsPackPosition  != null) snapshotFields['Maps_Pack_Position__c']    = mapsPackPosition;
  if (runningGoogleAds  != null) snapshotFields['Running_Google_Ads__c']    = runningGoogleAds;
  if (runningFacebookAds != null) snapshotFields['Running_Facebook_Ads__c'] = runningFacebookAds;
  if (primaryServicesMarketed)   snapshotFields['Primary_Services_Marketed__c'] = primaryServicesMarketed;
  if (competitivePressureScore != null)
    snapshotFields['Competitive_Pressure_Score__c'] = Math.round(competitivePressureScore);

  // Build enriched research notes including Plus It signals
  const notesParts: string[] = [];
  if (researchNotes)          notesParts.push(researchNotes);
  if (hasYouTubeChannel != null) notesParts.push(`YouTube: ${hasYouTubeChannel ? `YES (${youtubeVideoCount ?? '?'} videos)` : 'NO'}`);
  if (socialPlatforms)        notesParts.push(`Social: ${socialPlatforms}`);
  if (hasImplantSpecificPages != null) notesParts.push(`Implant pages: ${hasImplantSpecificPages ? 'YES' : 'NO'}`);
  if (estimatedMonthlyReviews != null) notesParts.push(`Review velocity: ~${estimatedMonthlyReviews}/mo`);
  if (notesParts.length > 0)  snapshotFields['Research_Notes__c'] = notesParts.join(' | ').slice(0, 2000);

  // For updates: rotate current values to Previous_ fields
  if (isUpdate && existingSnapshot) {
    if (existingSnapshot.Google_Review_Count__c != null)
      snapshotFields['Previous_Review_Count__c']   = existingSnapshot.Google_Review_Count__c;
    if (existingSnapshot.Snapshot_Date__c)
      snapshotFields['Previous_Snapshot_Date__c']  = existingSnapshot.Snapshot_Date__c;
    if (reviewDelta != null)
      snapshotFields['Review_Delta__c']             = reviewDelta;
  }

  // ── 4. Write to Salesforce ────────────────────────────────────────────────

  let savedId = existingSnapshot?.Id;
  let writeError: string | null = null;

  try {
    if (isUpdate && savedId) {
      await salesforceService.updateRecord('Competitor_Snapshot__c', savedId, snapshotFields);
    } else {
      savedId = await salesforceService.createRecord('Competitor_Snapshot__c', snapshotFields);
    }
  } catch (err) {
    writeError = err instanceof Error ? err.message : String(err);
  }

  // ── 5. Build output ───────────────────────────────────────────────────────

  const today_display = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  lines.push(`# ⚔️ Competitor Snapshot ${isUpdate ? 'Updated' : 'Created'}`);
  lines.push(`**${competitorName}** — ${today_display}`);
  lines.push('');

  if (writeError) {
    lines.push(`❌ **Salesforce write failed:** ${writeError}`);
    lines.push('');
    lines.push(`*Data was not saved. Fix the error and re-run sf_save_competitor_snapshot.*`);
    return lines.join('\n');
  }

  lines.push(`✅ ${isUpdate ? `Snapshot \`${savedId}\` updated` : `New snapshot created: \`${savedId}\``}`);
  lines.push('');

  // Summary table
  lines.push(`## 📊 Snapshot Summary`);
  lines.push('');
  lines.push(`| Signal | Value |`);
  lines.push(`|---|---|`);
  if (googleReviewCount != null) {
    const deltaStr = reviewDelta != null
      ? reviewDelta > 0 ? ` *(+${reviewDelta} since last snapshot)*` : reviewDelta < 0 ? ` *(${reviewDelta} since last snapshot)*` : ` *(no change)*`
      : '';
    lines.push(`| Google Reviews | **${googleReviewCount}** ${googleStarRating ? `(${googleStarRating}⭐)` : ''}${deltaStr} |`);
  }
  if (estimatedMonthlyReviews != null) {
    const annualProjection = Math.round(estimatedMonthlyReviews * 12);
    lines.push(`| Review Velocity | **~${estimatedMonthlyReviews}/month** → **+${annualProjection} in 12 months** if nothing changes |`);
  }
  if (mapsPackPosition != null)
    lines.push(`| Maps Pack | **${mapsPackPosition === 0 ? 'Not in pack' : `#${mapsPackPosition} in pack`}** |`);
  if (runningGoogleAds != null)
    lines.push(`| Google Ads | **${runningGoogleAds ? '✅ Running' : '❌ Not running'}** |`);
  if (runningFacebookAds != null)
    lines.push(`| Facebook Ads | **${runningFacebookAds ? '✅ Running' : '❌ Not running'}** |`);
  if (hasYouTubeChannel != null)
    lines.push(`| YouTube | **${hasYouTubeChannel ? `✅ Active${youtubeVideoCount ? ` (${youtubeVideoCount} videos)` : ''}` : '❌ None'}** |`);
  if (socialPlatforms)
    lines.push(`| Social Platforms | ${socialPlatforms} |`);
  if (hasImplantSpecificPages != null)
    lines.push(`| Implant-Specific Pages | **${hasImplantSpecificPages ? '✅ Yes' : '❌ No'}** |`);
  if (competitivePressureScore != null)
    lines.push(`| Pressure Score | **${competitivePressureScore}/100** — ${pressureLabel(competitivePressureScore)} |`);
  lines.push('');

  // Alert signals
  if (shouldAlert) {
    lines.push(`## 🚨 Alert Signals Detected`);
    lines.push('');
    if (adFlippedOn)   lines.push(`- 💰 **Google Ads launched** — competitor was NOT running ads at last snapshot. This is new.`);
    if (fbFlippedOn)   lines.push(`- 📱 **Facebook Ads launched** — competitor was NOT running Facebook ads at last snapshot.`);
    if (enteredPack)   lines.push(`- 📍 **Entered Google Maps Pack** — competitor was not in the pack at last snapshot.`);
    if (highVelocity && reviewDelta != null)
      lines.push(`- 📈 **Review surge: +${reviewDelta} reviews** since last snapshot — high velocity signal.`);
    if (competitivePressureScore != null && competitivePressureScore >= 75)
      lines.push(`- ⚠️ **High pressure score: ${competitivePressureScore}/100** — this competitor is aggressively marketing.`);
    lines.push('');
    lines.push(`*Alert_Triggered__c = true on this snapshot. n8n Workflow 2 will pick this up and create an AM Task on next run.*`);
    lines.push('');
  }

  // What If You Do Nothing — review projection
  if (estimatedMonthlyReviews != null && estimatedMonthlyReviews > 0) {
    const yr1Reviews = googleReviewCount != null
      ? googleReviewCount + Math.round(estimatedMonthlyReviews * 12)
      : Math.round(estimatedMonthlyReviews * 12);
    lines.push(`## ⏰ What If You Do Nothing`);
    lines.push('');
    lines.push(`At **~${estimatedMonthlyReviews} new reviews/month**, this competitor will have gained:`);
    lines.push(`- **+${Math.round(estimatedMonthlyReviews * 3)}** reviews in 90 days`);
    lines.push(`- **+${Math.round(estimatedMonthlyReviews * 6)}** reviews in 6 months`);
    lines.push(`- **+${Math.round(estimatedMonthlyReviews * 12)}** reviews in 12 months`);
    if (googleReviewCount != null) {
      lines.push(`- Total: **${yr1Reviews} reviews** by this time next year`);
    }
    lines.push('');
    lines.push(`This projection is a concrete urgency argument grounded in math, not opinion.`);
    lines.push('');
  }

  // Prior snapshot comparison
  if (isUpdate && (reviewDelta != null || adFlippedOn || fbFlippedOn || enteredPack)) {
    lines.push(`## 📈 Changes Since Last Snapshot (${formatDate(existingSnapshot?.Snapshot_Date__c)})`);
    lines.push('');
    if (reviewDelta != null && reviewDelta !== 0) {
      lines.push(`- Reviews: ${reviewDelta > 0 ? `+${reviewDelta}` : reviewDelta} (was ${prevReviewCount})`);
    }
    if (adFlippedOn)   lines.push(`- Google Ads: ❌ Not running → ✅ NOW RUNNING`);
    if (fbFlippedOn)   lines.push(`- Facebook Ads: ❌ Not running → ✅ NOW RUNNING`);
    if (enteredPack)   lines.push(`- Maps Pack: Not in pack → ✅ NOW IN PACK (position #${mapsPackPosition})`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const competitorScanHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_scan_competitor:           handleScanCompetitor,
  sf_save_competitor_snapshot:  handleSaveCompetitorSnapshot,
};
