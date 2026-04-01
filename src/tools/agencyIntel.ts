// ─────────────────────────────────────────────────────────────────────────────
// Agency Competitive Intelligence — Layers 1-3
//
// Scans competing dental marketing agencies (not practices) to:
//   Layer 1: Monitor agency capabilities, services, pricing, social proof
//   Layer 2: Reverse-engineer their client portfolios from public sources
//   Layer 3: Identify underserved clients and generate "Why Switch to PDM" pitches
//
// Two-tool architecture — mirrors sf_scan_competitor pattern:
//
//   Tool 1: sf_scan_agency_competitor
//     - Returns structured research instructions for scanning a competing agency
//     - Covers website audit, services, client portfolio detection, social proof
//     - Cross-references discovered clients against Salesforce Leads/Accounts
//
//   Tool 2: sf_save_agency_snapshot
//     - Saves agency intel to Salesforce (Competitor_Snapshot__c with agency flag)
//     - Records discovered clients as Leads (if they don't already exist)
//     - Generates "Why Switch to PDM" briefs for underserved clients
//     - Generates Excel prospecting spreadsheet on Desktop
//
// This is PDM protecting itself from agency-level competitors while simultaneously
// generating qualified prospect lists from competitors' client portfolios.
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import ExcelJS from 'exceljs';
import path from 'node:path';
import os from 'node:os';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExistingRecord {
  Id: string;
  Name: string;
  Website?: string;
  Status__c?: string;
  Owner?: { Name: string };
  OwnerId?: string;
  Total_Monthly_Recurring_Amount__c?: number;
  Health_Score__c?: number;
  Company?: string; // Lead field
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const agencyIntelTools: Tool[] = [
  {
    name: 'sf_scan_agency_competitor',
    description:
      'Scans a competing dental marketing AGENCY (not a dental practice). ' +
      'Returns structured research instructions to audit the agency\'s capabilities, ' +
      'services, pricing signals, client portfolio, social proof, and content strategy. ' +
      'After research, call sf_save_agency_snapshot to persist findings. ' +
      'Use when asked to: "scan [agency]", "research [agency] as a competitor", ' +
      '"what is [agency] doing", "find [agency]\'s clients", ' +
      '"compare PDM to [agency]", or any agency-level competitive analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        agencyName: {
          type: 'string',
          description: 'Name of the competing agency (e.g. "Crimson Media", "DocSites", "Gargle")',
        },
        agencyWebsite: {
          type: 'string',
          description: 'Agency website URL — dramatically accelerates research',
        },
        knownClients: {
          type: 'string',
          description: 'Comma-separated list of known client practice names (if any)',
        },
      },
      required: ['agencyName'],
    },
  },
  {
    name: 'sf_save_agency_snapshot',
    description:
      'Saves agency competitive intelligence to Salesforce. Stores the agency as a ' +
      'Competitor_Snapshot__c record (with Is_Agency_Competitor__c = true). ' +
      'Cross-references discovered client practices against existing Salesforce Leads/Accounts. ' +
      'Generates Excel prospecting spreadsheet on Desktop with full client intel. ' +
      'Generates "Why Switch to PDM" analysis for underserved clients. ' +
      'Call after completing the research instructions from sf_scan_agency_competitor.',
    inputSchema: {
      type: 'object',
      properties: {
        agencyName:              { type: 'string', description: 'Agency name (required)' },
        agencyWebsite:           { type: 'string', description: 'Agency website URL' },
        snapshotId:              { type: 'string', description: 'Existing snapshot ID to update' },
        // Agency profile
        servicesOffered:         { type: 'string', description: 'Services the agency offers (comma-separated)' },
        pricingSignals:          { type: 'string', description: 'Any pricing info discovered (ranges, packages, etc.)' },
        teamSize:                { type: 'string', description: 'Estimated team size or known team details' },
        yearFounded:             { type: 'number', description: 'Year the agency was founded' },
        // Digital presence
        googleReviewCount:       { type: 'number', description: 'Agency Google review count' },
        googleStarRating:        { type: 'number', description: 'Agency Google star rating' },
        socialPlatforms:         { type: 'string', description: 'Active social platforms (comma-separated)' },
        contentStrategy:         { type: 'string', description: 'Summary of their content/blog strategy' },
        hasVideoContent:         { type: 'boolean', description: 'Agency produces video content (YouTube, reels, etc.)' },
        hasCaseStudies:          { type: 'boolean', description: 'Published case studies on website' },
        // Client portfolio — EXPANDED schema for prospecting spreadsheet
        discoveredClients: {
          type: 'string',
          description:
            'JSON array of discovered client objects. Include ALL fields you can find: ' +
            '[{"name":"Practice Name", "website":"https://...", "city":"City", "state":"ST", "zip":"12345", ' +
            '"doctor":"Dr. Name", "phone":"555-123-4567", "email":"info@practice.com", ' +
            '"pocName":"Contact Name", "pocRole":"Office Manager", ' +
            '"source":"portfolio/testimonial/footer/case-study", ' +
            '"servicesFromAgency":"SEO, PPC, Web Design", ' +
            '"serviceGaps":"No video, no social, weak SEO for implant terms", ' +
            '"estimatedMaturity":45, "bestPoachLever":"No implant-specific content", ' +
            '"outreachAngle":"Their site has zero implant pages — PDM builds full-arch authority", ' +
            '"notes":"Any additional intel"}]',
        },
        estimatedClientCount:    { type: 'number', description: 'Estimated total number of clients' },
        // Competitive assessment
        competitivePressureScore: { type: 'number', description: 'Agency threat score 0-100' },
        keyStrengths:            { type: 'string', description: 'Agency key strengths vs PDM (comma-separated)' },
        keyWeaknesses:           { type: 'string', description: 'Agency key weaknesses vs PDM (comma-separated)' },
        pdmAdvantages:           { type: 'string', description: 'Where PDM is clearly superior (comma-separated)' },
        // Plus It — PDM competitive comparison
        pdmServiceComparison: {
          type: 'string',
          description:
            'JSON object comparing agency services to PDM service-by-service. Format: ' +
            '{"SEO":{"agency":"Template pages, no implant focus","pdm":"Custom implant/full-arch pages, local landing pages, Maps optimization","pdmEdge":"Implant-specific expertise"}, ' +
            '"PPC":{"agency":"...","pdm":"...","pdmEdge":"..."}, ...}',
        },
        competitorVsPdmAnalysis: {
          type: 'string',
          description:
            'JSON array for the Competitor vs PDM Analysis tab. Format: ' +
            '[{"category":"Business Model","competitor":"Volume-based, low-cost membership tiers","pdm":"Premium full-service implant marketing","advantage":"PDM","insight":"PDM delivers ROI, not just activity"}, ' +
            '{"category":"Implant Expertise","competitor":"General dental marketing","pdm":"Full-arch/All-on-4 specialists","advantage":"PDM","insight":"..."}, ...]' +
            'Categories should cover: Business Model, Implant Expertise, Client Results, Technology/AI, Training, Events, Video, SEO Depth, PPC Strategy, Social Quality, Reputation, Reporting/Analytics, Client Retention, Scalability',
        },
        researchNotes:           { type: 'string', description: 'Key findings and intelligence notes — max 2000 chars' },
        scanAnalysis:            { type: 'string', description: 'Full scan analysis text to store in Scan_Analysis__c on the snapshot. If omitted, the tool auto-generates it from the output.' },
        // Proactive actions
        createLeads:             { type: 'boolean', description: 'Auto-create Leads in Salesforce for new prospects not already in SF. Default: true. LeadSource = "Competitor Agency: [agencyName]"' },
        notifyUserIds:           { type: 'string', description: 'Comma-separated Salesforce User IDs to notify via Task when new leads are created or existing records are flagged. Default: William Summers (005PU000001eUQDYA2)' },
        bypassMinimum:           { type: 'boolean', description: 'Set true ONLY if you completed all 8 discovery methods and the agency genuinely has fewer than 20 discoverable clients. You must explain in researchNotes what methods you tried and why yields were low.' },
      },
      required: ['agencyName'],
    },
  },
];

// ─── Input Schemas ────────────────────────────────────────────────────────────

const ScanAgencyArgs = z.object({
  agencyName:    z.string(),
  agencyWebsite: z.string().optional(),
  knownClients:  z.string().optional(),
});

interface DiscoveredClient {
  name: string;
  website?: string;
  city?: string;
  state?: string;
  zip?: string;
  doctor?: string;
  phone?: string;
  email?: string;
  pocName?: string;
  pocRole?: string;
  source?: string;
  servicesFromAgency?: string;
  serviceGaps?: string;
  estimatedMaturity?: number;
  bestPoachLever?: string;
  outreachAngle?: string;
  notes?: string;
}

const SaveAgencySnapshotArgs = z.object({
  agencyName:               z.string(),
  agencyWebsite:            z.string().optional(),
  snapshotId:               z.string().optional(),
  servicesOffered:          z.string().optional(),
  pricingSignals:           z.string().optional(),
  teamSize:                 z.string().optional(),
  yearFounded:              z.number().optional(),
  googleReviewCount:        z.number().optional(),
  googleStarRating:         z.number().optional(),
  socialPlatforms:          z.string().optional(),
  contentStrategy:          z.string().optional(),
  hasVideoContent:          z.boolean().optional(),
  hasCaseStudies:           z.boolean().optional(),
  discoveredClients:        z.string().optional(),
  estimatedClientCount:     z.number().optional(),
  competitivePressureScore: z.number().min(0).max(100).optional(),
  keyStrengths:             z.string().optional(),
  keyWeaknesses:            z.string().optional(),
  pdmAdvantages:            z.string().optional(),
  pdmServiceComparison:     z.string().optional(),
  competitorVsPdmAnalysis:  z.string().optional(),
  researchNotes:            z.string().optional(),
  scanAnalysis:             z.string().optional(),
  createLeads:              z.boolean().optional(),
  notifyUserIds:            z.string().optional(),
  bypassMinimum:            z.boolean().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SF_BASE_URL = 'https://progressivedental.my.salesforce.com';

function formatDate(d: string | null | undefined): string {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Excel Generation ────────────────────────────────────────────────────────

interface ExcelClientRow {
  practiceName: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  doctor: string;
  pocName: string;
  pocRole: string;
  phone: string;
  email: string;
  likelyVendor: string;
  funnelType: string;        // "New Prospect" | "Existing Account" | "Existing Lead" | "Active PDM Client"
  priorityScore: number;     // 1-10
  bestOutreachAngle: string;
  servicesFromAgency: string;
  serviceGaps: string;
  bestPoachLever: string;
  pdmSolution: string;
  estimatedMaturity: string;
  sfLink: string;
  notes: string;
}

interface CompetitorVsPdmRow {
  category: string;
  competitor: string;
  pdm: string;
  advantage: string;
  insight: string;
}

async function generateClientExcel(
  agencyName: string,
  allClients: ExcelClientRow[],
  serviceComparison: Record<string, { agency: string; pdm: string; pdmEdge: string }> | null,
  agencyWeaknesses: string,
  pdmAdvantages: string,
  competitorVsPdmAnalysis: CompetitorVsPdmRow[] | null,
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Prophet by PDM';
  workbook.created = new Date();

  // ── Sheet 1: Prospect List ──────────────────────────────────────────
  const sheet = workbook.addWorksheet('Prospect List');

  sheet.columns = [
    { header: 'Practice Name',         key: 'practiceName',       width: 32 },
    { header: 'City',                  key: 'city',               width: 18 },
    { header: 'State',                 key: 'state',              width: 7  },
    { header: 'Zip',                   key: 'zip',                width: 10 },
    { header: 'Website',               key: 'website',            width: 35 },
    { header: 'Doctor',                key: 'doctor',             width: 22 },
    { header: 'Point of Contact',      key: 'pocName',            width: 22 },
    { header: 'Likely POC Role',       key: 'pocRole',            width: 18 },
    { header: 'Phone',                 key: 'phone',              width: 16 },
    { header: 'Email',                 key: 'email',              width: 28 },
    { header: 'Likely Vendor',         key: 'likelyVendor',       width: 18 },
    { header: 'Funnel Type',           key: 'funnelType',         width: 18 },
    { header: 'Priority Score (1-10)', key: 'priorityScore',      width: 18 },
    { header: 'Best Outreach Angle',   key: 'bestOutreachAngle',  width: 45 },
    { header: 'Services From Agency',  key: 'servicesFromAgency', width: 30 },
    { header: 'Service Gaps',          key: 'serviceGaps',        width: 40 },
    { header: 'Best Poach Lever',      key: 'bestPoachLever',     width: 35 },
    { header: 'PDM Solution',          key: 'pdmSolution',        width: 40 },
    { header: 'Est. Marketing Maturity', key: 'estimatedMaturity', width: 20 },
    { header: 'Salesforce Link',       key: 'sfLink',             width: 50 },
    { header: 'Notes',                 key: 'notes',              width: 45 },
  ];

  // Style header
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F72' } };
  headerRow.alignment = { horizontal: 'center', wrapText: true };
  headerRow.height = 30;

  // Add data rows with color coding by priority
  for (const client of allClients) {
    const row = sheet.addRow(client);
    row.alignment = { wrapText: true, vertical: 'top' };

    // Color by priority score
    let fillColor: string | undefined;
    if (client.priorityScore >= 8) fillColor = 'FFFCE4EC';       // red — hot
    else if (client.priorityScore >= 6) fillColor = 'FFFFF8E1';  // amber — warm
    else if (client.priorityScore >= 4) fillColor = 'FFE8F5E9';  // green — moderate
    else fillColor = 'FFF5F5F5';                                  // grey — low/monitor

    if (client.funnelType === 'Active PDM Client') fillColor = 'FFEDE7F6'; // purple

    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor! } };
    });

    // Make website and SF link cells blue + underline
    const websiteCell = row.getCell('website');
    if (client.website) {
      websiteCell.font = { color: { argb: 'FF0563C1' }, underline: true };
    }
    const sfCell = row.getCell('sfLink');
    if (client.sfLink) {
      sfCell.font = { color: { argb: 'FF0563C1' }, underline: true };
    }
  }

  // Auto-filter
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: allClients.length + 1, column: 21 },
  };

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // ── Sheet 2: PDM vs Agency Comparison ────────────────────────────────
  if (serviceComparison && Object.keys(serviceComparison).length > 0) {
    const compSheet = workbook.addWorksheet('Service Comparison');

    compSheet.columns = [
      { header: 'Service Area',                  key: 'service',  width: 22 },
      { header: `${agencyName} Delivers`,        key: 'agency',   width: 45 },
      { header: 'PDM Delivers',                  key: 'pdm',      width: 45 },
      { header: 'PDM Edge / Why We Win',         key: 'pdmEdge',  width: 45 },
    ];

    const compHeader = compSheet.getRow(1);
    compHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    compHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F72' } };
    compHeader.alignment = { horizontal: 'center', wrapText: true };

    for (const [service, data] of Object.entries(serviceComparison)) {
      const row = compSheet.addRow({
        service,
        agency: data.agency,
        pdm: data.pdm,
        pdmEdge: data.pdmEdge,
      });
      row.alignment = { wrapText: true, vertical: 'top' };
    }

    // Add summary rows
    compSheet.addRow({});
    if (agencyWeaknesses) {
      compSheet.addRow({ service: 'THEIR WEAKNESSES', agency: agencyWeaknesses });
    }
    if (pdmAdvantages) {
      compSheet.addRow({ service: 'PDM ADVANTAGES', pdm: pdmAdvantages });
    }
  }

  // ── Sheet 3: Summary ─────────────────────────────────────────────────
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 40 },
    { header: 'Value',  key: 'value',  width: 25 },
  ];
  const summaryHeader = summarySheet.getRow(1);
  summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F72' } };

  const newProspects = allClients.filter(c => c.funnelType === 'New Prospect');
  const existingAccts = allClients.filter(c => c.funnelType === 'Existing Account');
  const existingLeads = allClients.filter(c => c.funnelType === 'Existing Lead');
  const activePDM = allClients.filter(c => c.funnelType === 'Active PDM Client');
  const hotTargets = allClients.filter(c => c.priorityScore >= 8);
  const warmTargets = allClients.filter(c => c.priorityScore >= 6 && c.priorityScore < 8);

  summarySheet.addRow({ metric: 'Agency Scanned', value: agencyName });
  summarySheet.addRow({ metric: 'Report Date', value: new Date().toLocaleDateString() });
  summarySheet.addRow({ metric: 'Generated By', value: 'Prophet by PDM' });
  summarySheet.addRow({});
  summarySheet.addRow({ metric: 'Total Discovered Clients', value: allClients.length });
  summarySheet.addRow({ metric: '🔴 Hot Targets (Priority 8-10)', value: hotTargets.length });
  summarySheet.addRow({ metric: '🟡 Warm Targets (Priority 6-7)', value: warmTargets.length });
  summarySheet.addRow({ metric: 'New Prospects (not in Salesforce)', value: newProspects.length });
  summarySheet.addRow({ metric: 'Existing Accounts in SF', value: existingAccts.length });
  summarySheet.addRow({ metric: 'Existing Leads in SF', value: existingLeads.length });
  summarySheet.addRow({ metric: 'Active PDM Clients (monitor)', value: activePDM.length });

  // ── Sheet 4: Competitor vs Progressive Dental Marketing Analysis ───
  if (competitorVsPdmAnalysis && competitorVsPdmAnalysis.length > 0) {
    const vsSheet = workbook.addWorksheet('Competitive Analysis');

    vsSheet.columns = [
      { header: 'Category',                              key: 'category',   width: 28 },
      { header: `${agencyName} (Competitor)`,             key: 'competitor', width: 45 },
      { header: 'Progressive Dental Marketing (PDM)',     key: 'pdm',        width: 45 },
      { header: 'Advantage',                              key: 'advantage',  width: 14 },
      { header: 'Key Insight',                            key: 'insight',    width: 50 },
    ];

    const vsHeader = vsSheet.getRow(1);
    vsHeader.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    vsHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4F72' } };
    vsHeader.alignment = { horizontal: 'center', wrapText: true };
    vsHeader.height = 30;

    for (const item of competitorVsPdmAnalysis) {
      const row = vsSheet.addRow({
        category: item.category,
        competitor: item.competitor,
        pdm: item.pdm,
        advantage: item.advantage,
        insight: item.insight,
      });
      row.alignment = { wrapText: true, vertical: 'top' };

      // Color the advantage cell
      const advCell = row.getCell('advantage');
      const adv = (item.advantage || '').toLowerCase();
      if (adv.includes('pdm')) {
        advCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } }; // green = PDM wins
        advCell.font = { bold: true, color: { argb: 'FF2E7D32' } };
      } else if (adv.includes('tie') || adv.includes('even')) {
        advCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } }; // amber = tie
        advCell.font = { bold: true, color: { argb: 'FFF57F17' } };
      } else {
        advCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EC' } }; // red = agency wins
        advCell.font = { bold: true, color: { argb: 'FFC62828' } };
      }
    }

    // Score summary at bottom
    const pdmWins = competitorVsPdmAnalysis.filter(r => (r.advantage || '').toLowerCase().includes('pdm')).length;
    const agencyWins = competitorVsPdmAnalysis.filter(r => !(r.advantage || '').toLowerCase().includes('pdm') && !(r.advantage || '').toLowerCase().includes('tie')).length;
    const ties = competitorVsPdmAnalysis.length - pdmWins - agencyWins;

    vsSheet.addRow({});
    const scoreRow = vsSheet.addRow({
      category: 'SCORECARD',
      competitor: `${agencyName} wins: ${agencyWins}`,
      pdm: `PDM wins: ${pdmWins}`,
      advantage: ties > 0 ? `Ties: ${ties}` : '',
      insight: pdmWins > agencyWins
        ? `PDM dominates ${pdmWins}-${agencyWins}. Clear upgrade path for ${agencyName} clients.`
        : `Competitive. Target ${agencyName}'s weakest areas for poach campaigns.`,
    });
    scoreRow.font = { bold: true, size: 12 };
  }

  // Write file
  const safeName = agencyName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
  const dateStr = new Date().toISOString().split('T')[0];
  const fileName = `${safeName}_Poach_List_${dateStr}.xlsx`;
  const filePath = path.join(os.homedir(), 'Desktop', fileName);

  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

// ─── Handler: sf_scan_agency_competitor ───────────────────────────────────────

async function handleScanAgency(rawArgs: unknown): Promise<string> {
  const args = ScanAgencyArgs.parse(rawArgs ?? {});
  const { agencyName, agencyWebsite, knownClients } = args;

  // Check for existing agency snapshot in Salesforce
  let existingSnapshot: { Id: string; Name: string; Snapshot_Date__c?: string; Research_Notes__c?: string } | null = null;
  try {
    const escaped = agencyName.replace(/'/g, "\\'");
    const results = await salesforceService.rawQuery<{
      Id: string; Name: string; Snapshot_Date__c?: string; Research_Notes__c?: string;
      Google_Review_Count__c?: number; Competitive_Pressure_Score__c?: number;
    }>(
      `SELECT Id, Name, Snapshot_Date__c, Research_Notes__c, Google_Review_Count__c, Competitive_Pressure_Score__c
       FROM Competitor_Snapshot__c
       WHERE Name LIKE '%${escaped}%'
       ORDER BY Snapshot_Date__c DESC NULLS LAST
       LIMIT 1`
    );
    if (results.length > 0) existingSnapshot = results[0];
  } catch { /* first scan */ }

  // Check if any known clients already exist in Salesforce
  let knownClientMatches = '';
  if (knownClients) {
    const clientNames = knownClients.split(',').map(c => c.trim()).filter(Boolean);
    const likeConditions = clientNames.map(n => `Name LIKE '%${n.replace(/'/g, "\\'")}%'`).join(' OR ');

    try {
      const [accts, leads] = await Promise.all([
        salesforceService.rawQuery<ExistingRecord>(
          `SELECT Id, Name, Website, Status__c, Owner.Name, Total_Monthly_Recurring_Amount__c
           FROM Account WHERE ${likeConditions} LIMIT 20`
        ).catch(() => [] as ExistingRecord[]),
        salesforceService.rawQuery<ExistingRecord>(
          `SELECT Id, Name, Company, Website, Owner.Name
           FROM Lead WHERE ${likeConditions} OR ${clientNames.map(n => `Company LIKE '%${n.replace(/'/g, "\\'")}%'`).join(' OR ')}
           LIMIT 20`
        ).catch(() => [] as ExistingRecord[]),
      ]);

      if (accts.length > 0 || leads.length > 0) {
        const lines: string[] = ['## 🔍 Known Clients Already in Salesforce', ''];
        for (const a of accts) {
          const mrr = a.Total_Monthly_Recurring_Amount__c ? `$${Math.round(a.Total_Monthly_Recurring_Amount__c).toLocaleString()}/mo` : '';
          lines.push(`- **${a.Name}** — Account (${a.Status__c || 'Unknown status'}) | Owner: ${a.Owner?.Name || 'Unknown'} ${mrr}`);
        }
        for (const l of leads) {
          lines.push(`- **${l.Name}** (${l.Company || ''}) — Lead | Owner: ${l.Owner?.Name || 'Unknown'}`);
        }
        lines.push('');
        knownClientMatches = lines.join('\n');
      }
    } catch { /* ignore */ }
  }

  // Build the research instructions
  const websiteNote = agencyWebsite ? `Visit: ${agencyWebsite}` : `Search for: "${agencyName}" dental marketing agency website`;
  const date = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const output = `# 🏢 Agency Competitive Intelligence Scan
**Agency:** ${agencyName}${agencyWebsite ? ` — ${agencyWebsite}` : ''}
**Date:** ${date}
**Type:** AGENCY-LEVEL COMPETITOR (not a dental practice)

> **⚠️ MANDATORY OUTPUT: This scan MUST produce:**
> 1. **AS MANY client practices as possible** (use ALL 8 discovery methods in Layer 2 — 100+ is common for large agencies)
> 2. **Full contact data for every client** (website, phone, email, doctor, city/state/zip — scrub their website)
> 3. **Service gap analysis and poach lever for every client**
> 4. **A call to sf_save_agency_snapshot with the full discoveredClients JSON array** — this generates the Excel spreadsheet on Desktop
> 5. **Do NOT summarize or skip steps.** Even if you scanned this agency before, run the FULL scan again.

${existingSnapshot ? `> **Prior snapshot exists** (ID: ${existingSnapshot.Id}) — Last scanned: ${formatDate(existingSnapshot.Snapshot_Date__c)}\n> Use snapshotId: \`${existingSnapshot.Id}\` when saving to UPDATE the record.\n> **⚠️ IMPORTANT: A prior snapshot does NOT mean you skip the scan. You MUST still run the FULL Layer 1 + Layer 2 + Layer 3 scan below. Find 100+ clients. Scrub every website. Generate the full spreadsheet. The prior snapshot only means you update the existing SF record instead of creating a new one.**\n` : '> **INITIAL SCAN.** No prior snapshot exists. Establish the baseline.\n'}
${knownClientMatches}---

## 🔍 Layer 1: Agency Profile & Capabilities

### 1. Agency Website Audit
${websiteNote}
- What services do they offer? (SEO, PPC, Social, Web Design, Video, Reputation, etc.)
- Do they specialize in dental/dental implants or are they a general agency?
- Pricing signals: published packages, "starting at" numbers, "request a quote"?
- Case studies: how many? What results do they showcase?
- Team page: how many people? What roles? Any notable hires?
- Technology/platform: do they use proprietary tech or off-the-shelf tools?
- Year founded / company history?
- Geographic focus: national or regional?

### 2. Agency Reputation
Search: **"${agencyName}" reviews**, **"${agencyName}" dental marketing reviews**
Check: Google Business Profile, Clutch, DesignRush, Yelp, BBB, Glassdoor
- Google review count and star rating (for the agency, not their clients)
- Review themes: what do clients praise? What do they complain about?
- Employee reviews (Glassdoor/Indeed): satisfaction, turnover signals, culture
- Awards or certifications listed?

### 3. Agency Digital Presence
Check: Facebook, Instagram, LinkedIn, YouTube, TikTok for ${agencyName}
- Which platforms are they active on?
- Posting frequency and content quality?
- LinkedIn company page: follower count, employee count, recent posts?
- YouTube: do they publish educational content, client testimonials, case studies?
- Do they run their own ads? (Meta Ad Library: search "${agencyName}")

### 4. Content & Thought Leadership
Check their blog/resources section
- How often do they publish content?
- Topics covered: dental-specific or generic marketing?
- Do they produce original research, whitepapers, webinars?
- Podcast or video series?
- SEO: do they rank for "dental marketing agency" type keywords?

---

## 🔍 Layer 2: Client Portfolio Detection

**⚠️ TARGET: AS MANY CLIENTS AS POSSIBLE. 100+ is common for large agencies. Do NOT stop at 3-5 clients from a case study page. Use EVERY method below. The goal is to build an exhaustive poach list.**

**⚠️ CRITICAL WORKFLOW: PATTERN-FIRST DISCOVERY**
The #1 reason scans fail is starting and stopping at the agency homepage. The homepage might only name 5-6 clients. The real client list is 10x-100x larger. Here's how you find them:

**⚠️ IMPORTANT: Most agencies have MULTIPLE client tiers. You must search for ALL of them:**
- **Tier 1: Full-service website clients** — agency BUILT the website. These share template patterns, CMS fingerprints, footer credits, CDN domains, CSS class names. Searchable via technical fingerprints.
- **Tier 2: Marketing-only clients** — agency runs PPC/SEO/leads but the client keeps their OWN website (Squarespace, Wix, WordPress, whatever). NO website fingerprint to find. You must discover these through case studies, award mentions, blog posts, social media tags, review mining, and image/video mining.
- **Tier 3: Funnel/landing page clients** — agency builds separate ad landing pages (quiz funnels, lead capture pages) but the main practice website is untouched. Search for the funnel pattern on separate domains or subdomains.

**If you only search for Tier 1, you'll miss 50-70% of the client base. All three tiers must be hunted.**

1. **FIRST** — Visit the agency website and find 3-5 CONFIRMED client websites (testimonials, case studies, portfolio, award pages)
2. **THEN** — Visit each confirmed client's website. Study the patterns:
   - What does the website template look like? (layout, color scheme, navigation structure)
   - What CMS/platform? (WordPress, Duda, Squarespace, Webflow, custom?)
   - What funnel type? (quiz funnel, appointment form, free consultation CTA, specific CTA language)
   - Check the HTML source for: agency footer credits, Google Analytics IDs, Tag Manager IDs, meta generator tags, unique CSS class names, JavaScript framework signatures, CDN domains, hosting patterns
   - What domain registrar / hosting / CDN patterns do they share?
   - Do they share a white-labeled CRM portal? (check for client login links)
3. **THEN** — Search Google for OTHER dental websites matching those patterns. This is where you go from 5 clients to 50-100+.
   - Search for EACH technical fingerprint you found (CSS classes, CDN domains, footer credits, CMS identifiers)
   - Search for the funnel CTA language on other dental sites
   - Search for the agency name + client-type keywords
4. **THEN** — For every match found, verify it's actually a client (check for template match + funnel type + any agency fingerprint)
5. **FINALLY** — Scrub each verified client's website for full contact data

**A previous DIM scan found 147 clients using this workflow.** DIM has three client tiers: Duda-platform websites (searchable via "DM_DIRECT" in source), WordPress+Elementor sites (searchable via "Designed by Dental Implant Machine" footer), and marketing-only clients (found via awards, case studies, reviews). You must look for ALL tiers.

**Known agency platform fingerprints — CONFIRMED from live scans of real client sites:**

**IMPORTANT: If ${agencyName} matches one of these agencies, USE THESE EXACT SIGNATURES to find clients. If it's a NEW agency, build your own table using the same methodology.**

| Agency | Detection Method | Search Signature | Expected Yield |
|---|---|---|---|
| **Dental Implant Machine** | Duda DFP platform | \`"DM_DIRECT"\` or \`"multiscreensite.com"\` or \`"dmRespRow"\` in source | Tier 1 website clients |
| **Dental Implant Machine** | WordPress footer | \`"Designed by Dental Implant Machine"\` in footer | Tier 2 WP clients |
| **Dental Implant Machine** | Quiz funnel CTA | \`"60-second quiz"\` or \`"Take this 60-Second Quiz"\` dental | Funnel clients |
| **Dental Implant Machine** | CRM portal | \`"app.theimplantmachine.com"\` references | GoHighLevel clients |
| **Lasso MD** | Footer backlink | \`href="https://lassomd.com"\` in page source (hidden link) | HIGH — present on every Lasso site |
| **Lasso MD** | PatientLoop software | \`"cdn.patientloop.com"\` in page source | HIGH — Lasso's proprietary growth tool |
| **Lasso MD** | Webflow + GSAP stack | Webflow site + \`"cdn.prod.website-files.com"\` + GSAP/Swiper.js | Confirm with footer link |
| **Lasso MD** | CSS classes | \`"testimonials_slider"\`, \`"faq_toggle"\`, \`"reveal-circle"\` | Template-specific |
| **Implant Engine** | Shared funnel domain | \`site:localdentalimplants.dentist\` — each practice has a page here | VERY HIGH — 15+ clients on one domain |
| **Implant Engine** | Funnel subdomain | \`[practice].implant-info.com\` pattern | GoHighLevel funnels |
| **Implant Engine** | GHL CSS classes | \`"hl_page-preview"\`, \`"hl_main_popup"\`, \`"filesafe.space"\` | GHL-built funnels |
| **Implant Engine** | LeadConnector chat | \`"leadConnector"\` or \`"openGHLChat"\` in page source | Treatment Setters integration |
| **Implant Engine** | Parent company | \`"Delmain"\` or \`"delmain.co"\` references | Corporate connection |
| **DentalROI** | Azure CDN | \`"droi.azureedge.net"\` in page source | VERY HIGH — agency-wide shared CDN |
| **DentalROI** | Azure Blob Storage | \`"[name].blob.core.windows.net"\` on dental sites | Custom ASP.NET platform |
| **DentalROI** | Footer credit | \`"Dental Marketing by"\` + DentalROI logo linking to \`dentalroi.com\` | Direct attribution |
| **DentalROI** | ASP.NET URL pattern | URL routes like \`/Blog/Post/\`, \`/Form/Fill/\` (not WordPress slugs) | Platform signature |
| **Driven Dental** | NO website fingerprint | Driven Dental is media buying + VPA only — they do NOT build websites | Must use non-web methods |
| **Driven Dental** | GoHighLevel subdomains | \`link.[practicename].com\` pattern for campaign landing pages | GHL white-label |
| **Driven Dental** | Testimonials page | \`drivendentalmarketing.com/reviews\` lists clients by name/location | Direct client list |
| **Driven Dental** | VPA branding | \`"Virtual Patient Advocate"\` or \`"Virtual Patient Acquisition"\` | Unique program name |
| **Implant Prospects** | Footer credit | \`"Powered by Implant Prospect"\` in footer | Present on some sites |
| **Implant Prospects** | Parent company | \`"Carvalho Capital"\` or \`"Thiago Carvalho"\` dental | PE acquisition model |
| **Any agency** | Footer credit | \`"designed by [agency]"\` or \`"powered by [agency]"\` or \`"website by [agency]"\` | Universal check |
| **Any agency** | Shared analytics | Search for the GTM-XXXXXXX or G-XXXXXXX ID found on confirmed client sites | Shared = agency-managed |
| **Any agency** | CMS signature | Check for shared meta generator tags, CSS framework class prefixes, CDN domains | Build your own table |

**Three competitor models to identify (from the "BEAT COMPETITION" framework):**
1. **Funnel + Call Center model** (DIM, Implant Engine): Quiz funnels, outsourced call centers, financial pre-qualification. Vulnerable to: ad dependency, no SEO/brand, template fatigue, patients remember the offer not the practice.
2. **Territory Lock model** (Dental Lead Machine): "One practice per market" exclusivity. Vulnerable to: scarcity pressure tactics, inflexibility, trust issues.
3. **Authority Marketing model** (Driven Dental): Premium patients, educated buyers. Closest to PDM's model — most dangerous long-term competitor.

**For ${agencyName} specifically:** After visiting 3+ confirmed client sites, BUILD YOUR OWN fingerprint table like the ones above. Then search for EACH fingerprint across the web.

### 5. Client Portfolio Discovery — EXHAUSTIVE SEARCH

**METHOD 1: Agency Website — Confirmed Clients (expect 5-20 clients)**
- Navigate EVERY page: ${agencyWebsite ? agencyWebsite : 'Agency website'}/portfolio, /our-work, /case-studies, /clients, /results, /success-stories, /testimonials, /about
- Testimonials — extract EVERY practice name, doctor name, location
- Case study pages — extract practice name, location, services provided
- Footer logos or "trusted by" sections — identify each logo (Google reverse image search if needed)
- Blog posts mentioning specific client results, launches, or milestones
- Press releases mentioning clients
- Pricing page — sometimes shows client logos
- **CRITICAL: Visit every confirmed client's website — you need their site patterns for METHOD 2**

**METHOD 2: Template Detection + Web Footprint Hunting (expect 20-100+ clients — THIS IS THE GOLDMINE)**

**Step A — Identify the agency's digital fingerprint (visit 3+ confirmed client sites):**

For EACH confirmed client site, view the page source and document:

| What to Look For | Where to Find It | Why It Matters |
|---|---|---|
| CMS / Platform | Meta generator tag, page source (wp-content = WordPress, dmAPI = Duda, etc.) | Agencies use one platform across clients |
| Footer credit | Bottom of page — "designed by", "powered by", "website by" | Direct agency attribution |
| CSS class prefixes | Page source — look for unusual class naming patterns (e.g., \`dmRespRow\`, \`fl-\`, \`coh-ce-\`) | Shared framework = shared builder |
| CDN domains | Image/script URLs — shared CDN (e.g., \`multiscreensite.com\`, \`cdn-website.com\`) | Agency-managed hosting |
| JavaScript objects | Page source — custom JS objects (e.g., \`dmAPI\`, \`$.DM\`) | Proprietary platform signatures |
| GTM / Analytics IDs | Search source for \`GTM-\`, \`G-\`, \`UA-\`, \`AW-\` | Shared = agency-managed analytics |
| Funnel / quiz type | CTAs like "60-Second Quiz", "Am I a Candidate?", specific form tools | Agency's conversion playbook |
| Scheduling widget | CareStack, Modento, Flexbook, LocalMed, etc. | Agencies often standardize on one |
| Financing partners | CareCredit, Sunbit, Proceed, Cherry — check how many and which ones | Agency packages often include specific partners |
| Call tracking | CallRail, CallTrackingMetrics — check source for tracking pixels | Agency-managed call tracking |
| Client portal links | Login links pointing to agency's white-label CRM (GoHighLevel, HubSpot, etc.) | Reveals the agency's tech stack |
| reCAPTCHA site key | Search source for \`recaptcha\` — shared keys = shared account | Subtle but reliable fingerprint |
| Service worker | \`/runtime-service-worker.js\` or similar | Platform-specific signature |

**Do this for EACH of the 3+ confirmed sites. Then compare: what's SHARED across 2+ sites? That's the fingerprint.**

**Step B — Search the web for sites matching EACH fingerprint:**

Run ALL of these searches (not just one or two):
- **Footer credit:** \`"website by ${agencyName}"\` / \`"powered by ${agencyName}"\` / \`"designed by ${agencyName}"\`
- **Agency link-backs:** \`"${agencyWebsite ? new URL(agencyWebsite).hostname : agencyName}" dental\`
- **Footer in source:** \`site:*.com "${agencyName}" footer\`
- **Shared analytics:** If you found a shared GTM or GA ID, search for that exact ID
- **Platform signatures:** If you found shared CSS classes, CDN domains, or JS objects, search for those exact strings + "dental" or "dentist" or "implant"
- **Funnel CTA language:** If clients share a quiz or CTA pattern (e.g., "60-second quiz" or "take our quiz"), search: \`"[exact CTA text]" dental implant\`
- **CRM portal domain:** If you found a client portal URL (e.g., app.theimplantmachine.com), search for that domain
- **White-label platform ID:** If you found platform identifiers (e.g., "DM_DIRECT" for Duda), search for that string + dental
- **Similar template in other cities:** Search for dental implant sites in cities where the agency has NO known clients but using matching template patterns
- **Every match = a likely client. Visit each to confirm the fingerprint + extract contact data.**

**Step C — Snowball expansion:**
- Each new confirmed client site may reveal ADDITIONAL fingerprints you missed on the first 3
- Check if confirmed clients link to each other, share reviews, or appear in the same directories
- Search Google for the practice names you've confirmed + "${agencyName}" to find more connections
- If you discover the agency uses a white-labeled platform (GoHighLevel, Duda, etc.), search for other dental sites on that same white-label instance

**METHOD 3: Social Media Mining (expect 10-30 clients)**
- Facebook: scroll through ${agencyName}'s posts — they tag client practices in launch posts, milestone posts, before/after showcases
- Instagram: same — check tagged accounts, location tags, @ mentions
- LinkedIn: client win announcements, employee posts mentioning clients, "proud to work with" posts
- YouTube: client testimonial videos — practice names in titles, descriptions, and video content
- TikTok: agency content often features client examples

**METHOD 4: Review Text Mining — MANDATORY (expect 10-40 clients)**
**⚠️ DO NOT SKIP THIS METHOD. DO NOT ASK "want me to try this?" — JUST DO IT.**
- Go to the agency's Google Business Profile reviews page
- Read through the review text — reviewers frequently NAME their practice, their doctor, or mention their website
- Agency RESPONSES to reviews often mention the client by name
- Search: **"${agencyName}" review "my practice" OR "my office" OR "our website" OR "Dr."**
- Mine Clutch/DesignRush reviews — these are detailed and almost always name the client + project
- BBB complaints/responses mention clients
- Glassdoor/Indeed employee reviews sometimes name client accounts they worked on
- Yelp reviews of the agency
- **This method alone found 3+ additional confirmed clients with full contact info in the o360 scan. It works. Run it every time.**

**METHOD 5: Search Engine Discovery (expect 10-40 clients)**
- Search: **"${agencyName}" dental practice** — find mentions, partnerships, press
- Search: **"${agencyName}" testimonial OR review OR "works with"**
- Search: **"${agencyName}" "dental implant" OR "dentist" OR "oral surgeon"**
- Search: **"${agencyName}" client OR partner OR "proud to serve"**
- Google News: **"${agencyName}" dental** — press releases, awards, features
- Search: **"${agencyName}" podcast OR webinar OR interview** — agency leaders often name-drop clients in media appearances

**METHOD 6: Ad Intelligence (expect 5-20 clients)**
- Meta Ad Library: search "${agencyName}" — their clients' ads often credit the agency
- Also search the Ad Library for EACH confirmed client practice — if they're running ads, check if the landing page uses the agency template
- Search Google for dental implant ads in major markets — check if landing pages have agency footprints
- If the agency runs Facebook ads for clients, the Ad Library shows the page name = client
- Google Ads Transparency Center: search agency name or client names

**METHOD 7: Homepage Image / Award Page / Video Mining — MANDATORY**
⚠️ DO NOT SKIP. Competitors showcase clients visually — doctor photos, award winners, video thumbnails. This is a HIGH-YIELD discovery method.
- **Homepage hero section**: Look for doctor photos with names, "featured clients", "success stories", rotating testimonial carousels
- **Award / results walls**: Many agencies display "Two Comma Club" winners, "$1M+" producers, case study features — each with a doctor's name and sometimes practice name. Read EVERY name visible.
- **Video sections / YouTube embeds**: Video thumbnails often show "Dr. [Name] — [Practice Name]" or "[Practice] Journey". Read every thumbnail caption and video title.
- **Testimonial pages**: Doctor headshots with quotes always include names. Read ALL of them.
- **"Our Clients" / "Results" / "Case Studies" pages**: Navigate to every page that could list client names or logos
- **YouTube channel**: Visit the agency's YouTube — video titles contain client names (e.g., "Dr. Aman Bhullar — The GlenDental | Office Journey"). Go through ALL videos, not just the first page.
- For EACH doctor name extracted: Google search "[Dr. Name] dentist" to find their practice, website, city, state, phone, email
- **Accuracy rule**: Only record names you can clearly read. If a photo is blurry or a name is partially obscured, note it as uncertain. Quality over quantity.

**METHOD 8: Pattern Matching + Three-Tier Sweep (expect 10-50+ clients)**

By now you should have identified the agency's client tiers. Most agencies have multiple:
- **Tier 1 (Website clients):** Agency built the site — detectable via template, CMS, footer, CDN
- **Tier 2 (Marketing-only clients):** Agency runs ads/SEO but client keeps own website — NO web fingerprint, only discoverable via case studies, awards, reviews, social, images
- **Tier 3 (Funnel/landing page clients):** Agency builds separate quiz or landing pages — search for the funnel pattern on alternate domains

**For each tier, do a final sweep:**

**Tier 1 sweep:** Take your confirmed fingerprint signatures and run 5-10 more Google searches combining them with different dental keywords: "dental implant", "full arch", "All-on-4", "dentures", "cosmetic dentist". Expand to new geographies.

**Tier 2 sweep:** You've already checked case studies (Method 1), images/awards (Method 7), reviews (Method 4), and social (Method 3). Now cross-reference:
- Take every doctor name from award walls / testimonials / videos and Google them — even if their practice website shows NO agency fingerprint, they may be marketing-only clients
- Search: "${agencyName}" + each doctor's last name
- Check the agency's YouTube channel for ALL video titles — each video likely features a different client

**Tier 3 sweep:** Search for the funnel pattern on standalone domains:
- If the agency uses quiz funnels, search for the exact quiz CTA language + "dental implant" in different cities
- Check if confirmed clients have separate landing page domains (e.g., city-specific implant microsites)
- Search Meta Ad Library for ads by confirmed clients — the landing page URL may be a separate funnel domain

**Then pattern-match for net-new prospects:**
After completing all tiers, you know what a typical ${agencyName} client looks like:
- What specialties? (implants, full-arch, cosmetic, general)
- What markets? (city sizes, regions)
- What funnel type? (quiz, consultation, specific CTA language)
- What website template features?
Now search for dental practices in similar markets that match the SAME profile:
- Similar website template or funnel structure
- Similar service mix and positioning
- Located in markets where ${agencyName} has other clients (agencies cluster geographically)
- Running similar ad strategies (Meta Ad Library, Google Ads)
- Mark these as **"Pattern Match — Likely Client"** or **"Pattern Match — Potential Prospect"** in the Funnel Type column
- These are high-value poach targets even if you can't confirm the agency relationship — they FIT the profile

### 📋 MANDATORY: Website Scrub for EVERY Discovered Client

**⚠️ DO NOT SUBMIT EMPTY FIELDS. For EACH discovered client, you MUST visit their website and Google listing to extract:**

| Field | Where to Find It | Fallback |
|---|---|---|
| **Practice Name** | Website header, Google listing | Required — skip client if unknown |
| **Website** | The URL you're looking at | Required |
| **City, State, ZIP** | Google listing, website contact/footer, address on About page | Google search "[practice name] dentist" |
| **Doctor Name** | About page, team page, Google listing "Dr. ___" | Google "[practice name] dentist doctor" |
| **Point of Contact** | Team page (Office Manager, Practice Manager), LinkedIn search | Default: "Office Manager" |
| **POC Role** | Team page title, LinkedIn | Default: "Office Manager" |
| **Phone Number** | Website header, contact page, Google listing | Google "[practice name] phone number" |
| **Email Address** | Contact page, footer, Google listing | Construct: info@[domain] or contact@[domain] |
| **Services From Agency** | Footer credit, design patterns, ad activity, case study notes | "Website" minimum if footer credit found |
| **Service Gaps** | Missing: video? implant pages? social? Maps? reviews? blog? | Audit their site vs PDM standards |
| **Est. Marketing Maturity** | Quick audit: site quality + SEO + reviews + social + ads | Score 0-100 honestly |
| **Best Poach Lever** | The single biggest gap ${agencyName} is NOT closing | Required |
| **Best Outreach Angle** | One-line pitch that would make this doctor listen | Required |
| **Notes** | Anything notable — how discovered, agency relationship context | Source of discovery |

**If you cannot find a phone/email after checking the website and Google listing, construct a likely email (info@domain.com or contact@domain.com) and note it as "constructed." NEVER leave phone AND email both blank — at minimum provide one.**

---

## 🔍 Layer 3: "Why Switch to PDM" Analysis

### 6. Identify ${agencyName}'s Competitor Model
First, classify which model ${agencyName} uses — this determines the kill shots:

**Model A: Funnel + Call Center** (like DIM, Implant Engine)
- Quiz funnels, outsourced call centers, financial pre-qualification
- Weaknesses: Ad dependency (pipeline dies when ads stop), no brand equity (patients remember the offer not the practice), template fatigue (clients compete against identical funnels), lead quality degrades over time, no SEO moat
- PDM kill shot: "They help you BUY patients. We help you OWN your market."
- Pain points to hit: "Are leads getting more expensive?" / "What happens if ad costs double?" / "If you stopped ads tomorrow, would your pipeline survive?"

**Model B: Territory Lock** (like Dental Lead Machine)
- "One practice per market" exclusivity pitch
- Weaknesses: Scarcity pressure tactics, inflexibility, trust erosion, can't scale beyond locked territory
- PDM kill shot: "Locking a territory doesn't build dominance — owning organic search does."

**Model C: Authority Marketing** (like Driven Dental)
- Premium patient focus, educated buyers, brand-first
- Weaknesses: Often narrow service stack (PPC + VPA only), no events/training ecosystem, no AI intelligence layer
- PDM kill shot: "They build authority in ads. We build authority in everything — SEO, video, events, training, reputation."

**Model D: Full-Service Agency** (like Lasso MD, DentalROI)
- SEO + PPC + websites + social + content
- Weaknesses: Often lack implant specialization, no case acceptance training, no conference ecosystem, template-based sites
- PDM kill shot: "They're a marketing agency. We're an implant growth system — marketing + training + events + AI intelligence."

### 7. Service-by-Service Comparison: ${agencyName} vs PDM
For EACH service area, compare what ${agencyName} delivers vs. what PDM delivers:

| Service | ${agencyName} Delivers | PDM Delivers | PDM Edge |
|---|---|---|---|
| **Website Design** | ? | Custom implant-focused sites, before/after galleries, financing CTAs, doctor authority pages | ? |
| **SEO** | ? | Implant/full-arch/All-on-4 specific pages, local landing pages per ZIP, Maps optimization | ? |
| **PPC / Google Ads** | ? | Implant-specific campaigns, negative keyword management, landing page optimization | ? |
| **Social Media** | ? | Doctor reels, before/after content, patient testimonials, platform-specific strategy | ? |
| **Video Production** | ? | Patient testimonials, procedure walkthroughs, doctor authority content, YouTube strategy | ? |
| **Reputation Management** | ? | Review generation systems, sentiment monitoring, response management | ? |
| **Branding / Creative** | ? | Professional branded creative, consistent across all channels | ? |
| **Case Acceptance Training** | ? | TCI Mentorship: staff training on consultation, financing, case acceptance | ? |
| **Events / Conferences** | ? | TCI Events: 3 major conferences/year, networking, celebrity speakers | ? |
| **Analytics / ROI** | ? | Prophet AI: health scoring, call intelligence, competitive monitoring, renewal proof packages | ? |
| **Call Center / Setters** | ? | PDM empowers the client's OWN team (TCI training) rather than creating agency dependency | ? |
| **Client Portal / CRM** | ? | Salesforce Enterprise + Prophet AI intelligence platform | ? |

### 8. Audit Discovered Clients Against PDM Standards
For each discovered client practice:
- Quick website audit: modern or dated? Mobile-friendly? Implant pages?
- Google reviews: count and rating
- Google Maps: are they in the pack for implant keywords?
- Are they running Google Ads for implant terms?
- Social media activity level
- **Marketing Maturity Score estimate (0-100)** — how good is the work this agency delivered?

### 9. Where Is ${agencyName} Falling Short?
Identify the pattern across all discovered clients:
- What services does ${agencyName} consistently underdeliver on?
- What's the typical quality level of their SEO work? PPC? Social?
- Are their clients' websites cookie-cutter templates or custom?
- Do their clients have video content? Implant-specific pages?
- Are their clients showing up in Maps for implant keywords?
- What's the average estimated maturity of their client book?

### 10. Sales Ammunition — Competitor-Specific Talking Points
Generate these for the sales team to use immediately:

**Opening line (for outbound to ${agencyName} clients):**
"Hey Dr. ___ — I was looking at your implant marketing and noticed [specific observation from their site]. A lot of practices using similar systems are starting to see [relevant pain point]. Curious if you're experiencing the same?"

**Pain amplification questions (pick 3 most relevant):**
- "Are your implant leads getting more expensive over time?"
- "What percentage of your cases come from ads vs. organic?"
- "If you stopped ads tomorrow, would your pipeline survive?"
- "Are you seeing patients shopping price instead of committing?"
- "Do you feel like you're competing against identical marketing in your market?"
- "What's your show rate on implant consultations?"
- "When patients Google you, what do they find beyond the ads?"

**Positioning statement:**
"Most implant marketing programs are great at generating leads — but they don't build sustainable market ownership. That's where practices plateau. We help practices move from buying implant cases to actually owning their market."

**The PDM unfair advantages to emphasize (vs ${agencyName}):**
1. **TCI Events** — 3 major conferences/year. No competitor has this. Period.
2. **TCI Mentorship** — Staff training that stays when the agency leaves. Competitor call centers create dependency.
3. **Prophet AI** — Call intelligence, health scoring, competitive monitoring, renewal proof. No competitor has an AI platform.
4. **Full-service stack** — Phase 1 (website, video, creative) + Phase 2 (SEO, PPC, social) + TCI. Competitors typically offer 2-3 of these.
5. **Owned assets** — PDM builds SEO, reputation, content that the client OWNS. Funnel agencies build assets on agency-controlled domains that disappear when the client leaves.

---

## 📊 Scoring After Research

**Agency Threat Score (0–100):**
- 75–100: Major threat. Large client base, strong results, good reputation, expanding
- 50–74: Moderate threat. Decent operation but clear gaps PDM can exploit
- 25–49: Minor threat. Small operation, limited capabilities, or poor results
- 0–24: Negligible. Minimal presence, unlikely to win competitive deals

**Per-Client Priority Score (1–10):**
- 9–10: Dream prospect. Low maturity, high potential, clear gaps, doctor reachable
- 7–8: Strong prospect. Multiple service gaps, decent market
- 5–6: Worth pursuing. Some gaps but may be harder to close
- 3–4: Long shot. Decent marketing already or small market
- 1–2: Monitor only. Active PDM client or agency doing adequate job

---

## 📥 After Research — Save to Salesforce

**What happens when you save:**
1. Agency snapshot is stored in Salesforce (Competitor_Snapshot__c)
2. All discovered clients are cross-referenced against SF Accounts/Leads
3. **Leads are AUTO-CREATED** in Salesforce for every new prospect not already in SF (LeadSource = "Competitor Agency: [name]")
4. **Strategic alert Tasks are AUTO-CREATED** in Salesforce:
   - 🚨 Active PDM client found with competitor → **Churn Risk Task** for account owner
   - 🔄 Cancelled/Inactive client found → **Save Play Task** for account owner
   - 📋 Existing Lead found → **Prioritize Task** for lead owner
   - 🆕 New Leads created → **Notification Task** for designated users
5. **An Excel prospecting spreadsheet is generated on Desktop** with all clients, contact info, service gaps, poach levers, and PDM comparison (4 tabs)
6. **An auto-research queue is generated** — call sf_research_prospect on each discovered client to score the opportunity

Call **sf_save_agency_snapshot** with:
- \`agencyName\`: "${agencyName}"
${agencyWebsite ? `- \`agencyWebsite\`: "${agencyWebsite}"` : '- `agencyWebsite`: <discovered URL>'}
${existingSnapshot ? `- \`snapshotId\`: "${existingSnapshot.Id}"` : ''}
- \`servicesOffered\`: <comma-separated list>
- \`pricingSignals\`: <any pricing info found>
- \`teamSize\`: <estimated size>
- \`yearFounded\`: <year if found>
- \`googleReviewCount\`: <agency review count>
- \`googleStarRating\`: <agency rating>
- \`socialPlatforms\`: <"LinkedIn, Facebook, Instagram" etc.>
- \`contentStrategy\`: <summary of their content approach>
- \`hasVideoContent\`: <true/false>
- \`hasCaseStudies\`: <true/false>
- \`discoveredClients\`: <JSON array — MUST include ALL fields: name, website, city, state, zip, doctor, phone, email, pocName, pocRole, source, servicesFromAgency, serviceGaps, estimatedMaturity, bestPoachLever, outreachAngle, notes>
- \`estimatedClientCount\`: <estimated total>
- \`competitivePressureScore\`: <0-100>
- \`keyStrengths\`: <where they're strong>
- \`keyWeaknesses\`: <where they're weak>
- \`pdmAdvantages\`: <where PDM wins>
- \`pdmServiceComparison\`: <JSON object — service-by-service comparison, format: {"SEO":{"agency":"...","pdm":"...","pdmEdge":"..."}, ...}>
- \`competitorVsPdmAnalysis\`: <JSON array for the "Competitor vs PDM Analysis" tab. Format: [{"category":"Business Model","competitor":"...","pdm":"...","advantage":"PDM or Agency or Tie","insight":"..."}, ...]. Cover: Business Model, Implant Expertise, Client Results Proof, Technology/AI Platform, Training Programs, Events/Conferences, Video Production, SEO Depth, PPC Strategy, Social Media Quality, Reputation Management, Reporting/Analytics, Client Retention Model, Scalability>
- \`researchNotes\`: <key findings summary>`;

  return output;
}

// ─── Handler: sf_save_agency_snapshot ─────────────────────────────────────────

async function handleSaveAgencySnapshot(rawArgs: unknown): Promise<string> {
  const args = SaveAgencySnapshotArgs.parse(rawArgs ?? {});

  // Parse discovered clients
  let discoveredClients: DiscoveredClient[] = [];
  if (args.discoveredClients) {
    try {
      discoveredClients = JSON.parse(args.discoveredClients);
    } catch {
      return 'Error: discoveredClients must be a valid JSON array. Format: [{"name":"...", "website":"...", "city":"...", "state":"...", "zip":"...", "doctor":"...", "phone":"...", "email":"...", "pocName":"...", "pocRole":"...", "source":"...", "servicesFromAgency":"...", "serviceGaps":"...", "estimatedMaturity":50, "bestPoachLever":"...", "outreachAngle":"...", "notes":"..."}]';
    }
  }

  // ── QUALITY GATE: Dynamic threshold based on estimated client count ─────────
  // The old static minimum of 20 caused Claude Chat to stop at exactly 20.
  // Now the gate is dynamic: if you claim 150 clients exist, finding 20 is 13% — rejected.
  // Minimum is 30% of estimatedClientCount (floor of 20, cap of 100).
  const FLOOR_MIN = 20;
  const THOROUGHNESS_TARGET = 0.30; // 30% of estimated = minimum to accept
  const estimated = args.estimatedClientCount || 0;
  const dynamicMin = estimated > 0
    ? Math.max(FLOOR_MIN, Math.min(100, Math.ceil(estimated * THOROUGHNESS_TARGET)))
    : FLOOR_MIN;
  const thoroughnessPercent = estimated > 0
    ? Math.round((discoveredClients.length / estimated) * 100)
    : null;

  if (discoveredClients.length > 0 && discoveredClients.length < dynamicMin && !args.bypassMinimum) {
    const thoroughnessMsg = thoroughnessPercent !== null
      ? `\n\n📊 **Scan Thoroughness: ${thoroughnessPercent}%** — You found ${discoveredClients.length} of an estimated ${estimated} clients. That is not enough.`
      : '';

    return `❌ SAVE REJECTED — Only ${discoveredClients.length} clients submitted. Minimum for this agency is ${dynamicMin}${estimated > 0 ? ` (30% of ~${estimated} estimated clients)` : ''}.${thoroughnessMsg}

Your scan is incomplete. You likely only checked the agency homepage and found the obvious names. That is Step 1 of 8 methods.

**GO BACK AND COMPLETE THESE STEPS:**

1. **METHOD 2 — Template Detection (the goldmine):** You should have 3+ confirmed client websites by now. Visit each one and study their patterns:
   - View HTML source — look for shared Google Analytics IDs, Tag Manager containers, CSS class names, meta tags, JavaScript frameworks
   - Identify the funnel type (quiz funnel, consultation form, specific CTA language)
   - Identify the website template (layout, navigation, design patterns)
   - Then SEARCH GOOGLE for other dental sites matching those patterns
   - Search for the shared analytics ID, template signature, or funnel language
   - This method alone found 108 clients for DIM in a previous scan

2. **METHOD 7 — Image/Award/Video Mining:** Go back to the homepage and READ every doctor photo, award wall, testimonial carousel, and video thumbnail. Extract every name. Google each one.

3. **METHOD 8 — Pattern Matching:** Now that you know what a typical ${args.agencyName} client looks like (specialty, market size, funnel type, website template), search for dental practices matching that profile in similar markets.

4. **METHODS 3-6:** Social media posts tagging clients, Google review text mining, search engine discovery, Meta Ad Library.

5. **Google Cache / Site Index:** If the agency uses shared domains (e.g. localdentalimplants.dentist), search Google with \`site:domain.tld\` to find all indexed pages — even if the domain itself is not directly browsable. Google's index often reveals 50-100+ client pages on shared funnel domains.

**Do NOT call sf_save_agency_snapshot again until you have ${dynamicMin}+ clients with full contact data.**
If this agency genuinely has fewer than ${dynamicMin} discoverable clients, include a note explaining what methods you tried and why yields were low, then call again with bypassMinimum: true.`;
  }

  // ── DATA COMPLETENESS CHECK ──────────────────────────────────────────────────
  // Warn about rows missing critical contact fields but don't reject
  if (discoveredClients.length > 0) {
    const emptyRows = discoveredClients.filter(c =>
      (!c.phone || c.phone.trim() === '') && (!c.email || c.email.trim() === '')
    );
    const noWebsiteRows = discoveredClients.filter(c => !c.website || c.website.trim() === '');
    const warnings: string[] = [];
    if (emptyRows.length > discoveredClients.length * 0.3) {
      warnings.push(`⚠️ ${emptyRows.length}/${discoveredClients.length} clients have NO phone AND no email. Go back and scrub their websites — check contact pages, footers, Google listings. Construct info@domain.com if needed.`);
    }
    if (noWebsiteRows.length > 0) {
      warnings.push(`⚠️ ${noWebsiteRows.length} clients have no website URL. Every client needs a website.`);
    }
    if (warnings.length > 0) {
      return `❌ SAVE REJECTED — Data quality issues:\n\n${warnings.join('\n\n')}\n\nFix the empty fields and call sf_save_agency_snapshot again.`;
    }
  }

  // Parse service comparison
  let serviceComparison: Record<string, { agency: string; pdm: string; pdmEdge: string }> | null = null;
  if (args.pdmServiceComparison) {
    try {
      serviceComparison = JSON.parse(args.pdmServiceComparison);
    } catch { /* ignore parse error */ }
  }

  // Parse competitor vs PDM analysis
  let competitorVsPdm: CompetitorVsPdmRow[] | null = null;
  if (args.competitorVsPdmAnalysis) {
    try {
      competitorVsPdm = JSON.parse(args.competitorVsPdmAnalysis);
    } catch { /* ignore parse error */ }
  }

  // Build the research notes to include agency-specific intel
  const agencyIntel: string[] = [];
  if (args.servicesOffered) agencyIntel.push(`Services: ${args.servicesOffered}`);
  if (args.pricingSignals) agencyIntel.push(`Pricing: ${args.pricingSignals}`);
  if (args.teamSize) agencyIntel.push(`Team: ${args.teamSize}`);
  if (args.yearFounded) agencyIntel.push(`Founded: ${args.yearFounded}`);
  if (args.contentStrategy) agencyIntel.push(`Content: ${args.contentStrategy}`);
  if (args.keyStrengths) agencyIntel.push(`Strengths: ${args.keyStrengths}`);
  if (args.keyWeaknesses) agencyIntel.push(`Weaknesses: ${args.keyWeaknesses}`);
  if (args.pdmAdvantages) agencyIntel.push(`PDM Advantages: ${args.pdmAdvantages}`);
  if (args.estimatedClientCount) agencyIntel.push(`Est. clients: ${args.estimatedClientCount}`);
  if (discoveredClients.length > 0) agencyIntel.push(`Discovered clients: ${discoveredClients.length}`);
  if (args.researchNotes) agencyIntel.push(args.researchNotes);

  const combinedNotes = agencyIntel.join(' | ').substring(0, 2000);

  // Save or update Competitor_Snapshot__c
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshotData: Record<string, any> = {
    Name: args.agencyName.substring(0, 80),
    Competitor_Name__c: args.agencyName,
    Competitor_Website__c: args.agencyWebsite || null,
    Snapshot_Date__c: new Date().toISOString(),
    Is_Primary_Competitor__c: true,
    Research_Notes__c: combinedNotes,
  };

  if (args.googleReviewCount !== undefined) snapshotData.Google_Review_Count__c = args.googleReviewCount;
  if (args.googleStarRating !== undefined) snapshotData.Google_Star_Rating__c = args.googleStarRating;
  if (args.socialPlatforms) snapshotData.Social_Platforms__c = args.socialPlatforms;
  if (args.competitivePressureScore !== undefined) snapshotData.Competitive_Pressure_Score__c = args.competitivePressureScore;
  if (args.servicesOffered) snapshotData.Primary_Services_Marketed__c = args.servicesOffered?.substring(0, 255);

  let snapshotId = args.snapshotId;
  let isUpdate = false;

  if (snapshotId) {
    // Update existing
    try {
      // Rotate current values to previous
      const existing = await salesforceService.rawQuery<{
        Google_Review_Count__c?: number; Snapshot_Date__c?: string;
      }>(
        `SELECT Google_Review_Count__c, Snapshot_Date__c FROM Competitor_Snapshot__c WHERE Id = '${snapshotId}' LIMIT 1`
      );
      if (existing.length > 0 && existing[0].Google_Review_Count__c != null) {
        snapshotData.Previous_Review_Count__c = existing[0].Google_Review_Count__c;
        snapshotData.Previous_Snapshot_Date__c = existing[0].Snapshot_Date__c;
        if (args.googleReviewCount !== undefined) {
          snapshotData.Review_Delta__c = args.googleReviewCount - (existing[0].Google_Review_Count__c || 0);
        }
      }
      await salesforceService.updateRecord('Competitor_Snapshot__c', snapshotId, snapshotData);
      isUpdate = true;
    } catch (err) {
      return `Error updating snapshot: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    // Create new
    try {
      snapshotId = await salesforceService.createRecord('Competitor_Snapshot__c', snapshotData);
    } catch (err) {
      return `Error creating snapshot: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ── Cross-reference discovered clients against Salesforce ──────────────
  const clientMatches: string[] = [];
  const newProspects: DiscoveredClient[] = [];
  const existingClients: Array<{ client: DiscoveredClient; record: ExistingRecord; type: string }> = [];

  if (discoveredClients.length > 0) {
    for (const client of discoveredClients) {
      const escaped = client.name.replace(/'/g, "\\'");

      try {
        // Check Account
        const accts = await salesforceService.rawQuery<ExistingRecord>(
          `SELECT Id, Name, Website, Status__c, Owner.Name, Total_Monthly_Recurring_Amount__c, Health_Score__c
           FROM Account WHERE Name LIKE '%${escaped}%' LIMIT 3`
        );

        if (accts.length > 0) {
          const a = accts[0];
          const mrr = a.Total_Monthly_Recurring_Amount__c ? `$${Math.round(a.Total_Monthly_Recurring_Amount__c).toLocaleString()}/mo` : '';
          existingClients.push({ client, record: a, type: 'Account' });
          clientMatches.push(
            `✅ **${client.name}** → SF Account: ${a.Name} (${a.Status__c || '?'}) | ` +
            `Owner: ${a.Owner?.Name || '?'} ${mrr}` +
            (a.Health_Score__c ? ` | Health: ${a.Health_Score__c}/100` : '')
          );
          continue;
        }

        // Check Lead
        const leads = await salesforceService.rawQuery<ExistingRecord>(
          `SELECT Id, Name, Company, Website, Owner.Name
           FROM Lead WHERE Name LIKE '%${escaped}%' OR Company LIKE '%${escaped}%' LIMIT 3`
        );

        if (leads.length > 0) {
          existingClients.push({ client, record: leads[0], type: 'Lead' });
          clientMatches.push(
            `📋 **${client.name}** → SF Lead: ${leads[0].Name} (${leads[0].Company || ''}) | ` +
            `Owner: ${leads[0].Owner?.Name || '?'}`
          );
          continue;
        }

        // Not found — new prospect
        newProspects.push(client);
        clientMatches.push(`🆕 **${client.name}** — NOT in Salesforce → New prospect opportunity`);
      } catch {
        newProspects.push(client);
        clientMatches.push(`❓ **${client.name}** — Could not search (${client.source || 'unknown source'})`);
      }
    }
  }

  // ── Proactive: Create Leads for new prospects + Strategic Tasks ──────
  const WILLIAM_SUMMERS_ID = '005PU000001eUQDYA2';
  const shouldCreateLeads = args.createLeads !== false; // default true
  const notifyIds = args.notifyUserIds
    ? args.notifyUserIds.split(',').map(s => s.trim()).filter(Boolean)
    : [WILLIAM_SUMMERS_ID];

  const createdLeads: Array<{ client: DiscoveredClient; leadId: string }> = [];
  const sfFindings: string[] = []; // Key SF Findings section
  const taskResults: string[] = [];

  if (discoveredClients.length > 0) {
    // ── Create Leads for new prospects ──
    if (shouldCreateLeads && newProspects.length > 0) {
      for (const prospect of newProspects) {
        try {
          // Parse doctor name into first/last
          let firstName = 'Office';
          let lastName = prospect.name; // fallback to practice name
          if (prospect.doctor) {
            const docName = prospect.doctor.replace(/^Dr\.?\s*/i, '').trim();
            const parts = docName.split(/\s+/);
            if (parts.length >= 2) {
              firstName = parts[0];
              lastName = parts.slice(1).join(' ');
            } else if (parts.length === 1) {
              firstName = parts[0];
              lastName = prospect.name;
            }
          }

          const leadData: Record<string, unknown> = {
            FirstName: firstName.substring(0, 40),
            LastName: lastName.substring(0, 80),
            Company: prospect.name.substring(0, 255),
            LeadSource: `Competitor Agency: ${args.agencyName}`,
            Website: prospect.website || null,
            Phone: prospect.phone || null,
            Email: prospect.email || null,
            City: prospect.city || null,
            State: prospect.state || null,
            PostalCode: prospect.zip || null,
            Description: [
              `Discovered via ${args.agencyName} agency scan (${new Date().toLocaleDateString()})`,
              prospect.servicesFromAgency ? `Current services from ${args.agencyName}: ${prospect.servicesFromAgency}` : null,
              prospect.serviceGaps ? `Service gaps: ${prospect.serviceGaps}` : null,
              prospect.bestPoachLever ? `Best poach lever: ${prospect.bestPoachLever}` : null,
              prospect.outreachAngle ? `Outreach angle: ${prospect.outreachAngle}` : null,
              prospect.estimatedMaturity != null ? `Estimated maturity: ${prospect.estimatedMaturity}/100` : null,
              prospect.source ? `Discovery source: ${prospect.source}` : null,
            ].filter(Boolean).join('\n'),
          };

          const leadId = await salesforceService.createRecord('Lead', leadData);
          createdLeads.push({ client: prospect, leadId });

          // Update the cross-reference lists so Excel gets the SF link
          existingClients.push({
            client: prospect,
            record: { Id: leadId, Name: `${firstName} ${lastName}`, Company: prospect.name } as ExistingRecord,
            type: 'Lead',
          });
        } catch {
          // Lead creation failed — skip silently, still include in spreadsheet
        }
      }
    }

    // ── Create strategic Tasks for existing SF records ──
    for (const { client, record, type } of existingClients) {
      try {
        if (type === 'Account') {
          const status = record.Status__c || '';
          const active = ['Active', 'Renewal', 'Reinstated', 'Pending'].includes(status);
          const cancelled = ['Cancelled', 'Inactive', 'Expired'].includes(status);

          if (active) {
            // 🚨 CHURN RISK: Active PDM client found with competitor agency
            sfFindings.push(
              `🚨 **${record.Name}** — Active PDM client ($${record.Total_Monthly_Recurring_Amount__c ? Math.round(record.Total_Monthly_Recurring_Amount__c).toLocaleString() : '?'}/mo)` +
              ` found in ${args.agencyName}'s portfolio. May be splitting budget or evaluating a switch.` +
              ` Health: ${record.Health_Score__c || '?'}/100 | Owner: ${record.Owner?.Name || '?'}` +
              ` | ${SF_BASE_URL}/${record.Id}`
            );
            await salesforceService.createRecord('Task', {
              Subject: `🚨 Churn Risk: ${record.Name} found in ${args.agencyName} client portfolio`,
              Description: `Prophet agency scan detected ${record.Name} in ${args.agencyName}'s client list (source: ${client.source || 'portfolio'}).\n\nThis active client may be splitting budget or evaluating a switch. Recommend immediate outreach.\n\nService gaps identified: ${client.serviceGaps || 'Unknown'}\n\n${SF_BASE_URL}/${record.Id}`,
              WhatId: record.Id,
              OwnerId: record.OwnerId || notifyIds[0],
              Status: 'Not Started',
              Priority: 'High',
              ActivityDate: new Date().toISOString().split('T')[0],
            });
            taskResults.push(`🚨 Churn Risk Task → ${record.Owner?.Name || 'Owner'} for ${record.Name}`);
          } else if (cancelled) {
            // 🔄 SAVE PLAY: Cancelled client found — win-back opportunity
            sfFindings.push(
              `🔄 **${record.Name}** — Cancelled PDM client (Health: ${record.Health_Score__c || '?'}/100)` +
              ` found in ${args.agencyName}'s portfolio. Save play opportunity — they went to ${args.agencyName} instead.` +
              ` Owner: ${record.Owner?.Name || '?'} | ${SF_BASE_URL}/${record.Id}`
            );
            await salesforceService.createRecord('Task', {
              Subject: `🔄 Save Play: ${record.Name} is now with ${args.agencyName} — win them back`,
              Description: `Prophet agency scan found ${record.Name} in ${args.agencyName}'s client portfolio.\n\nThis is a former PDM client who switched to ${args.agencyName}. Service gaps at ${args.agencyName}: ${client.serviceGaps || 'Unknown'}.\n\nBest poach lever: ${client.bestPoachLever || 'Full marketing audit'}\nOutreach angle: ${client.outreachAngle || 'PDM implant specialization'}\n\n${SF_BASE_URL}/${record.Id}`,
              WhatId: record.Id,
              OwnerId: record.OwnerId || notifyIds[0],
              Status: 'Not Started',
              Priority: 'High',
              ActivityDate: new Date().toISOString().split('T')[0],
            });
            taskResults.push(`🔄 Save Play Task → ${record.Owner?.Name || 'Owner'} for ${record.Name}`);
          } else {
            // Other status — flag for review
            sfFindings.push(
              `📋 **${record.Name}** — SF Account (${status}) found in ${args.agencyName}'s portfolio.` +
              ` Owner: ${record.Owner?.Name || '?'} | ${SF_BASE_URL}/${record.Id}`
            );
          }
        } else if (type === 'Lead') {
          // Only notify for leads that already existed (not ones we just created)
          const wasJustCreated = createdLeads.some(cl => cl.client.name === client.name);
          if (!wasJustCreated) {
            sfFindings.push(
              `📋 **${client.name}** — Existing Lead in SF (Owner: ${record.Owner?.Name || '?'}).` +
              ` Confirmed using ${args.agencyName}. Prioritize for outreach. | ${SF_BASE_URL}/${record.Id}`
            );
            await salesforceService.createRecord('Task', {
              Subject: `📋 Prioritize Lead: ${client.name} confirmed using ${args.agencyName}`,
              Description: `Prophet agency scan confirmed ${client.name} is a ${args.agencyName} client.\n\nThis lead is already in your pipeline — now you have competitive intelligence to work with.\n\nService gaps at ${args.agencyName}: ${client.serviceGaps || 'Unknown'}\nBest outreach angle: ${client.outreachAngle || 'PDM implant specialization'}\n\n${SF_BASE_URL}/${record.Id}`,
              WhoId: record.Id,
              OwnerId: record.OwnerId || notifyIds[0],
              Status: 'Not Started',
              Priority: 'Normal',
              ActivityDate: new Date().toISOString().split('T')[0],
            });
            taskResults.push(`📋 Prioritize Task → ${record.Owner?.Name || 'Owner'} for ${client.name}`);
          }
        }
      } catch {
        // Task creation failed — continue
      }
    }

    // ── Notify designated users about new Leads created ──
    if (createdLeads.length > 0) {
      const leadSummary = createdLeads.map(cl =>
        `• ${cl.client.name}${cl.client.city ? ` (${cl.client.city}, ${cl.client.state || ''})` : ''} — ${SF_BASE_URL}/${cl.leadId}`
      ).join('\n');

      for (const userId of notifyIds) {
        try {
          await salesforceService.createRecord('Task', {
            Subject: `🆕 ${createdLeads.length} New Leads from ${args.agencyName} Agency Scan`,
            Description: `Prophet discovered ${createdLeads.length} new prospects from ${args.agencyName}'s client portfolio and auto-created them as Leads.\n\nLeadSource: Competitor Agency: ${args.agencyName}\n\n${leadSummary}\n\nNext steps:\n1. Review each Lead and assign to appropriate rep\n2. Run sf_research_prospect on high-priority targets\n3. Prioritize practices with implant focus`,
            OwnerId: userId,
            Status: 'Not Started',
            Priority: 'High',
            ActivityDate: new Date().toISOString().split('T')[0],
          });
          taskResults.push(`🆕 New Lead Notification → ${userId}`);
        } catch {
          // Notification failed — continue
        }
      }
    }
  }

  // ── Build Excel rows from discovered clients + SF cross-reference ─────
  const excelRows: ExcelClientRow[] = [];
  let excelPath = '';

  for (const client of discoveredClients) {
    const match = existingClients.find(e => e.client.name === client.name);
    const createdLead = createdLeads.find(cl => cl.client.name === client.name);

    let funnelType = 'New Prospect';
    let sfLink = '';
    let priorityScore = 8; // default high for new prospects

    if (match) {
      sfLink = `${SF_BASE_URL}/${match.record.Id}`;
      if (match.type === 'Account') {
        const active = ['Active', 'Renewal', 'Reinstated', 'Pending'].includes(match.record.Status__c || '');
        funnelType = active ? 'Active PDM Client' : 'Existing Account';
        priorityScore = active ? 1 : 5; // active = monitor, inactive = re-engage
      } else {
        funnelType = createdLead ? 'New Lead (Created)' : 'Existing Lead';
        priorityScore = createdLead ? 8 : 7;
      }
    } else if (createdLead) {
      funnelType = 'New Lead (Created)';
      sfLink = `${SF_BASE_URL}/${createdLead.leadId}`;
      priorityScore = 8;
    } else {
      funnelType = 'New Prospect';
      // Score based on maturity — lower maturity = agency underdelivering = better poach opportunity
      const maturity = client.estimatedMaturity ?? 50;
      if (maturity < 40) priorityScore = 10;
      else if (maturity < 55) priorityScore = 9;
      else if (maturity < 65) priorityScore = 8;
      else if (maturity < 75) priorityScore = 7;
      else priorityScore = 5;
    }

    // Build the PDM solution string from service gaps
    let pdmSolution = '';
    if (client.serviceGaps) {
      const gaps = client.serviceGaps.toLowerCase();
      const solutions: string[] = [];
      if (gaps.includes('video'))   solutions.push('Phase 1: Video Production');
      if (gaps.includes('web') || gaps.includes('site'))  solutions.push('Phase 1: Website Development');
      if (gaps.includes('seo') || gaps.includes('ranking') || gaps.includes('maps'))  solutions.push('Phase 2: SEO');
      if (gaps.includes('ppc') || gaps.includes('ads') || gaps.includes('google ads'))  solutions.push('Phase 2: PPC');
      if (gaps.includes('social'))  solutions.push('Phase 2: Social Media');
      if (gaps.includes('reputation') || gaps.includes('review'))  solutions.push('Phase 2: Reputation Management');
      if (gaps.includes('brand'))   solutions.push('Phase 1: Graphic Design');
      if (gaps.includes('training') || gaps.includes('case acceptance') || gaps.includes('consultation'))  solutions.push('TCI Mentorship');
      pdmSolution = solutions.length > 0 ? solutions.join(' + ') : 'Full marketing audit needed';
    }

    excelRows.push({
      practiceName: client.name,
      city: client.city || '',
      state: client.state || '',
      zip: client.zip || '',
      website: client.website || '',
      doctor: client.doctor || '',
      pocName: client.pocName || '',
      pocRole: client.pocRole || 'Office Manager (assumed)',
      phone: client.phone || '',
      email: client.email || '',
      likelyVendor: args.agencyName,
      funnelType,
      priorityScore,
      bestOutreachAngle: client.outreachAngle || '',
      servicesFromAgency: client.servicesFromAgency || '',
      serviceGaps: client.serviceGaps || '',
      bestPoachLever: client.bestPoachLever || '',
      pdmSolution,
      estimatedMaturity: client.estimatedMaturity != null ? `${client.estimatedMaturity}/100` : '',
      sfLink,
      notes: client.notes || '',
    });
  }

  // Generate Excel
  if (excelRows.length > 0) {
    try {
      excelPath = await generateClientExcel(
        args.agencyName,
        excelRows,
        serviceComparison,
        args.keyWeaknesses || '',
        args.pdmAdvantages || '',
        competitorVsPdm,
      );
    } catch (err) {
      excelPath = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ── Build markdown output ─────────────────────────────────────────────
  const lines: string[] = [
    `# 🏢 Agency Intelligence Snapshot ${isUpdate ? 'Updated' : 'Created'}`,
    `**${args.agencyName}**${args.agencyWebsite ? ` — ${args.agencyWebsite}` : ''} — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    '',
    `${isUpdate ? '🔄' : '✅'} Snapshot ${isUpdate ? 'updated' : 'created'}: \`${snapshotId}\``,
    '',
  ];

  // Agency profile summary
  lines.push('## 📊 Agency Profile');
  lines.push('');
  lines.push('| Attribute | Value |');
  lines.push('|---|---|');
  if (args.servicesOffered) lines.push(`| **Services** | ${args.servicesOffered} |`);
  if (args.pricingSignals) lines.push(`| **Pricing Signals** | ${args.pricingSignals} |`);
  if (args.teamSize) lines.push(`| **Team Size** | ${args.teamSize} |`);
  if (args.yearFounded) lines.push(`| **Founded** | ${args.yearFounded} |`);
  if (args.googleReviewCount !== undefined) lines.push(`| **Google Reviews** | ${args.googleReviewCount} (${args.googleStarRating || '?'}⭐) |`);
  if (args.socialPlatforms) lines.push(`| **Social Platforms** | ${args.socialPlatforms} |`);
  if (args.hasVideoContent !== undefined) lines.push(`| **Video Content** | ${args.hasVideoContent ? '✅ Yes' : '❌ No'} |`);
  if (args.hasCaseStudies !== undefined) lines.push(`| **Case Studies** | ${args.hasCaseStudies ? '✅ Yes' : '❌ No'} |`);
  if (args.estimatedClientCount) lines.push(`| **Est. Client Count** | ~${args.estimatedClientCount} |`);
  if (args.competitivePressureScore !== undefined) {
    const emoji = args.competitivePressureScore >= 75 ? '🔴' : args.competitivePressureScore >= 50 ? '🟠' : args.competitivePressureScore >= 25 ? '🟡' : '🟢';
    lines.push(`| **Threat Score** | ${emoji} ${args.competitivePressureScore}/100 |`);
  }
  // Scan thoroughness
  if (discoveredClients.length > 0) {
    const scanThoroughness = estimated > 0
      ? Math.round((discoveredClients.length / estimated) * 100)
      : null;
    const thoroughnessLabel = scanThoroughness !== null
      ? (scanThoroughness >= 60 ? '🟢 Deep' : scanThoroughness >= 30 ? '🟡 Moderate' : '🔴 Shallow')
      : '⚪ Unknown (no estimate provided)';
    const thoroughnessValue = scanThoroughness !== null
      ? `${thoroughnessLabel} — ${discoveredClients.length} found / ~${estimated} estimated (${scanThoroughness}%)`
      : `${thoroughnessLabel} — ${discoveredClients.length} clients found`;
    lines.push(`| **Scan Thoroughness** | ${thoroughnessValue} |`);
  }
  lines.push('');

  // PDM vs Agency service comparison
  if (serviceComparison && Object.keys(serviceComparison).length > 0) {
    lines.push(`## ⚔️ Service-by-Service: PDM vs. ${args.agencyName}`);
    lines.push('');
    lines.push(`| Service | ${args.agencyName} | PDM | PDM Edge |`);
    lines.push('|---|---|---|---|');
    for (const [service, data] of Object.entries(serviceComparison)) {
      lines.push(`| **${service}** | ${data.agency} | ${data.pdm} | ${data.pdmEdge} |`);
    }
    lines.push('');
  }

  // Competitive positioning
  if (args.keyStrengths || args.keyWeaknesses || args.pdmAdvantages) {
    lines.push('## 🎯 Competitive Positioning');
    lines.push('');
    if (args.pdmAdvantages) {
      lines.push('**Where PDM Wins:**');
      for (const adv of args.pdmAdvantages.split(',').map(s => s.trim())) {
        lines.push(`- ✅ ${adv}`);
      }
      lines.push('');
    }
    if (args.keyWeaknesses) {
      lines.push(`**Where ${args.agencyName} Falls Short:**`);
      for (const w of args.keyWeaknesses.split(',').map(s => s.trim())) {
        lines.push(`- 🎯 ${w}`);
      }
      lines.push('');
    }
    if (args.keyStrengths) {
      lines.push(`**${args.agencyName} Strengths (respect these):**`);
      for (const s of args.keyStrengths.split(',').map(s => s.trim())) {
        lines.push(`- ⚡ ${s}`);
      }
      lines.push('');
    }
  }

  // Client portfolio cross-reference
  if (discoveredClients.length > 0) {
    lines.push('## 🕵️ Client Portfolio Intelligence');
    lines.push(`*${discoveredClients.length} clients discovered | ${existingClients.length} already in Salesforce | ${newProspects.length} new prospects*`);
    lines.push('');

    for (const match of clientMatches) {
      lines.push(`- ${match}`);
    }
    lines.push('');

    // Active PDM clients using this competitor = churn risk
    const activeWithCompetitor = existingClients.filter(
      e => e.type === 'Account' && e.record.Status__c && !['Cancelled', 'Inactive', 'Expired'].includes(e.record.Status__c)
    );
    if (activeWithCompetitor.length > 0) {
      lines.push('### ⚠️ Active PDM Clients Also Linked to This Agency');
      lines.push('*These practices may be evaluating a switch or using both. Monitor closely.*');
      lines.push('');
      for (const { client, record } of activeWithCompetitor) {
        lines.push(`- **${record.Name}** — ${record.Status__c} | Health: ${record.Health_Score__c || '?'}/100 | Source: ${client.source || 'portfolio page'}`);
      }
      lines.push('');
    }

    // New prospects = poach opportunities
    if (newProspects.length > 0) {
      const leadsCreated = createdLeads.length > 0;
      lines.push(`### 🎯 Poach Opportunities${leadsCreated ? ' — Leads Auto-Created in Salesforce' : ' — NOT in Salesforce'}`);
      lines.push('');
      for (const p of newProspects) {
        const maturity = p.estimatedMaturity != null ? ` | Maturity: ${p.estimatedMaturity}/100` : '';
        const createdLead = createdLeads.find(cl => cl.client.name === p.name);
        const leadLink = createdLead ? ` | 🔗 ${SF_BASE_URL}/${createdLead.leadId}` : '';
        lines.push(`- **${p.name}**${p.city ? ` — ${p.city}, ${p.state || ''}` : ''}${p.website ? ` | ${p.website}` : ''}${maturity}${leadLink}`);
        if (p.bestPoachLever) lines.push(`  - 🔑 Poach lever: ${p.bestPoachLever}`);
        if (p.serviceGaps) lines.push(`  - 📉 Gaps: ${p.serviceGaps}`);
      }
      lines.push('');
    }
  }

  // Key SF Findings — STANDARD on every scan
  if (sfFindings.length > 0) {
    lines.push('## 🚨 Key Salesforce Findings');
    lines.push('');
    for (const finding of sfFindings) {
      lines.push(`- ${finding}`);
    }
    lines.push('');
  }

  // Proactive actions summary
  if (createdLeads.length > 0 || taskResults.length > 0) {
    lines.push('## ⚡ Proactive Actions Taken');
    lines.push('');
    if (createdLeads.length > 0) {
      lines.push(`**${createdLeads.length} Leads Auto-Created** (LeadSource: "Competitor Agency: ${args.agencyName}")`);
      lines.push('');
      for (const { client, leadId } of createdLeads) {
        lines.push(`- **${client.name}**${client.city ? ` (${client.city}, ${client.state || ''})` : ''} → ${SF_BASE_URL}/${leadId}`);
      }
      lines.push('');
    }
    if (taskResults.length > 0) {
      lines.push(`**${taskResults.length} Tasks Auto-Created in Salesforce:**`);
      lines.push('');
      for (const result of taskResults) {
        lines.push(`- ${result}`);
      }
      lines.push('');
    }
  }

  // "Why Switch to PDM" pitch template
  if (args.keyWeaknesses || newProspects.length > 0) {
    lines.push('## 💬 "Why Switch to PDM" Pitch Framework');
    lines.push('');
    lines.push(`*Use this when approaching ${args.agencyName} clients:*`);
    lines.push('');
    lines.push(`> "We\'ve noticed your current agency [${args.agencyName}] has you set up with [observed services]. `);
    lines.push(`> That\'s a start, but here\'s what we see missing: [specific gaps from their work]. `);
    if (args.keyWeaknesses) {
      const weaknesses = args.keyWeaknesses.split(',').map(s => s.trim());
      lines.push(`> Specifically, ${weaknesses[0] ? weaknesses[0].toLowerCase() : 'there are gaps'} — and that\'s costing you patients every month. `);
    }
    lines.push(`> At PDM, we specialize exclusively in dental implant marketing. `);
    lines.push(`> We don\'t just run ads — we build full-arch authority with `);
    lines.push(`> video production, SEO, PPC, social, and reputation management working together. `);
    lines.push(`> Would it help to see what your competitors are doing in your market that you\'re missing?"`);
    lines.push('');
  }

  // Excel Spreadsheet
  if (excelPath && !excelPath.startsWith('ERROR')) {
    lines.push('## 📊 Prospecting Spreadsheet Generated');
    lines.push('');
    lines.push(`**📁 File saved to Desktop:** \`${excelPath}\``);
    lines.push('');
    lines.push('**4 tabs:**');
    lines.push('1. **Prospect List** — All clients with contact info, service gaps, poach levers, priority scores, PDM solutions, and SF links');
    lines.push(`2. **Service Comparison** — PDM vs ${args.agencyName} service-by-service showing exactly where they fall short`);
    lines.push('3. **Summary** — Aggregate counts by priority and funnel type');
    lines.push(`4. **Competitive Analysis** — Head-to-head ${args.agencyName} vs PDM breakdown across every dimension with scorecard`);
    lines.push('');
    lines.push('Color coding: 🔴 Priority 8-10 (hot) | 🟡 Priority 6-7 (warm) | 🟢 Priority 4-5 (moderate) | ⚪ Low | 🟣 Active PDM Client');
    lines.push('');
  } else if (excelPath && excelPath.startsWith('ERROR')) {
    lines.push(`> ⚠️ Excel generation failed: ${excelPath}`);
    lines.push('');
  } else if (discoveredClients.length === 0) {
    lines.push('> ℹ️ No discovered clients were provided — spreadsheet not generated. Include `discoveredClients` JSON array to generate the poach list.');
    lines.push('');
  }

  // Auto-Research Queue
  const researchTargets = excelRows.filter(r => r.funnelType === 'New Prospect' || r.funnelType === 'Existing Lead');

  if (researchTargets.length > 0) {
    lines.push('## 🔬 Auto-Research Queue — Score Every Poach Opportunity');
    lines.push('');
    lines.push(`**${researchTargets.length} practices** need \`sf_research_prospect\` scoring.`);
    lines.push('');
    lines.push('**Run these research calls now** (call each sequentially):');
    lines.push('');

    let queueNum = 0;
    for (const target of researchTargets) {
      queueNum++;
      const researchArgs: string[] = [`practiceName: "${target.practiceName}"`];
      if (target.website) researchArgs.push(`website: "${target.website}"`);
      if (target.city)    researchArgs.push(`city: "${target.city}"`);
      if (target.state)   researchArgs.push(`state: "${target.state}"`);

      lines.push(`### ${queueNum}. ${target.practiceName}${target.city ? ` (${target.city}, ${target.state})` : ''}`);
      if (target.sfLink) lines.push(`   📎 SF: ${target.sfLink}`);
      lines.push(`   **Call:** \`sf_research_prospect\` → ${researchArgs.join(', ')}`);
      lines.push(`   **Then:** \`sf_save_research_scores\` with results`);
      lines.push('');
    }
  }

  // SF Quick Links
  const linkedRecords = excelRows.filter(r => r.sfLink);
  if (linkedRecords.length > 0) {
    lines.push('## 🔗 Salesforce Quick Links');
    lines.push('');
    for (const r of linkedRecords) {
      lines.push(`- **${r.practiceName}** (${r.funnelType}) → ${r.sfLink}`);
    }
    lines.push('');
  }

  // Content strategy note
  if (args.contentStrategy) {
    lines.push('## 📝 Content Strategy Notes');
    lines.push(args.contentStrategy);
    lines.push('');
  }

  // Research notes
  if (args.researchNotes) {
    lines.push('## 📋 Research Notes');
    lines.push(args.researchNotes);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Agency snapshot: Competitor_Snapshot__c \`${snapshotId}\`*`);
  if (excelPath && !excelPath.startsWith('ERROR')) {
    lines.push(`*Poach list spreadsheet: \`${excelPath}\`*`);
  }

  // ── Write Scan_Analysis__c back to snapshot ──────────────────────────
  // Auto-capture the full analysis text. If scanAnalysis was passed explicitly, use that.
  // Otherwise, use the auto-generated lines[] output. Truncate to 32768 chars (Rich Text Area limit).
  const analysisText = (args.scanAnalysis || lines.join('\n')).substring(0, 32768);
  if (snapshotId) {
    try {
      await salesforceService.updateRecord('Competitor_Snapshot__c', snapshotId, {
        Scan_Analysis__c: analysisText,
      });
    } catch (err) {
      lines.push('');
      lines.push(`> ⚠️ Failed to write Scan_Analysis__c: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return lines.join('\n');
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const agencyIntelHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_scan_agency_competitor: handleScanAgency,
  sf_save_agency_snapshot:   handleSaveAgencySnapshot,
};
