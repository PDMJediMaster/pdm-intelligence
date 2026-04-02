// ─────────────────────────────────────────────────────────────────────────────
// Report & Dashboard Builder — Prophet by PDM
//
// sf_clone_dashboard
//   Clone a Salesforce dashboard + all its underlying reports with
//   find-and-replace substitutions. Works for event dashboards, campaign
//   dashboards, rep dashboards — anything.
//
// sf_create_report
//   Generate and deploy a new Salesforce report from structured parameters.
//   Columns, filters, groupings, date ranges, format — all configurable.
//
// Both tools use the jsforce Metadata API (retrieve/deploy via zip).
// Both are accessible via MCP, REST API, and Telegram.
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import JSZip from 'jszip';
import { salesforceService } from '../services/salesforce.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const METADATA_API_VERSION = '62.0';
const DEPLOY_POLL_INTERVAL = 2000;
const DEPLOY_POLL_TIMEOUT = 120_000;

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const reportBuilderTools: Tool[] = [
  {
    name: 'sf_clone_dashboard',
    description:
      'Clone a Salesforce dashboard and ALL its underlying reports with find-and-replace substitutions. ' +
      'Perfect for creating event dashboards (e.g., clone Vegas dashboard for Dallas), ' +
      'campaign dashboards, quarterly clones, or any dashboard that follows a repeatable pattern. ' +
      'Provide the source dashboard ID or name, substitution pairs (find/replace for lead sources, ' +
      'dates, names, etc.), and optionally a target folder. ' +
      'Use when asked to "clone dashboard", "copy dashboard", "duplicate dashboard", ' +
      '"create dashboard like", "new event dashboard", or "replicate report set".',
    inputSchema: {
      type: 'object',
      properties: {
        source_dashboard_id: {
          type: 'string',
          description: 'Salesforce ID of the source dashboard to clone (15 or 18 char)',
        },
        source_dashboard_name: {
          type: 'string',
          description: 'Name/title of the source dashboard (fuzzy search). Use this OR source_dashboard_id.',
        },
        new_title: {
          type: 'string',
          description: 'Title for the cloned dashboard (e.g., "FABC 2026 - Dallas")',
        },
        new_description: {
          type: 'string',
          description: 'Description for the cloned dashboard',
        },
        target_folder: {
          type: 'string',
          description: 'Developer name of the target dashboard/report folder. Defaults to same folder as source.',
        },
        name_prefix: {
          type: 'string',
          description: 'Prefix added to cloned report developer names to ensure uniqueness (e.g., "Dallas_")',
        },
        substitutions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'Text to find in report filters, names, descriptions' },
              replace: { type: 'string', description: 'Text to replace it with' },
            },
            required: ['find', 'replace'],
          },
          description: 'Find-and-replace pairs applied across all report filters, names, descriptions, and dashboard labels',
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, shows what would be deployed without actually deploying (default: false)',
        },
      },
      required: ['substitutions'],
    },
  },
  {
    name: 'sf_create_report',
    description:
      'Generate and deploy a new Salesforce report from structured parameters. ' +
      'Specify columns, filters, groupings, date range, and format. ' +
      'Supports Tabular, Summary, and Matrix formats. ' +
      'Use when asked to "create a report", "build a report", "make a report showing", ' +
      '"generate a report for", or "I need a report that shows".',
    inputSchema: {
      type: 'object',
      properties: {
        report_name: {
          type: 'string',
          description: 'Human-readable report name (max 40 characters)',
        },
        report_type: {
          type: 'string',
          description: 'Salesforce report type API name (e.g., "AccountList", "OpportunityProduct@Opportunity.SalesOrder__c")',
        },
        folder: {
          type: 'string',
          description: 'Developer name of the target report folder (e.g., "AA_Events", "Public_Reports")',
        },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Field API names to include as columns (e.g., ["ACCOUNT_NAME", "AMOUNT", "STAGE_NAME"])',
        },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Field API name' },
              operator: { type: 'string', description: 'equals, notEqual, greaterThan, lessThan, contains, greaterOrEqual, lessOrEqual' },
              value: { type: 'string', description: 'Filter value' },
            },
            required: ['field', 'operator', 'value'],
          },
          description: 'Report filter criteria',
        },
        group_by: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to group rows by (creates Summary format)',
        },
        date_filter: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'Date field API name (e.g., "CLOSE_DATE", "CREATED_DATE")' },
            range: { type: 'string', description: 'Date range (e.g., "THIS_QUARTER", "LAST_N_DAYS:90", "INTERVAL_CUSTOM")' },
          },
        },
        format: {
          type: 'string',
          enum: ['Tabular', 'Summary', 'Matrix'],
          description: 'Report format (default: Tabular, auto-set to Summary if group_by provided)',
        },
        scope: {
          type: 'string',
          description: 'Report scope: "organization" (all records) or "user" (my records). Default: organization.',
        },
        show_details: {
          type: 'boolean',
          description: 'Show detail rows (default: true)',
        },
        description: {
          type: 'string',
          description: 'Report description',
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, returns generated XML without deploying (default: false)',
        },
      },
      required: ['report_name', 'report_type', 'folder', 'columns'],
    },
  },
];

// ─── Args Schemas ─────────────────────────────────────────────────────────────

const SubstitutionPair = z.object({
  find: z.string(),
  replace: z.string(),
});

const CloneDashboardArgs = z.object({
  source_dashboard_id: z.string().optional(),
  source_dashboard_name: z.string().optional(),
  new_title: z.string().optional(),
  new_description: z.string().optional(),
  target_folder: z.string().optional(),
  name_prefix: z.string().optional(),
  substitutions: z.array(SubstitutionPair),
  dry_run: z.boolean().default(false),
});

const CreateReportArgs = z.object({
  report_name: z.string().max(40),
  report_type: z.string(),
  folder: z.string(),
  columns: z.array(z.string()),
  filters: z.array(z.object({
    field: z.string(),
    operator: z.string(),
    value: z.string(),
  })).optional(),
  group_by: z.array(z.string()).optional(),
  date_filter: z.object({
    field: z.string(),
    range: z.string(),
  }).optional(),
  format: z.enum(['Tabular', 'Summary', 'Matrix']).optional(),
  scope: z.string().default('organization'),
  show_details: z.boolean().default(true),
  description: z.string().optional(),
  dry_run: z.boolean().default(false),
});

// ─── Metadata API Helpers ─────────────────────────────────────────────────────

/** Build a package.xml string for the given metadata members */
function buildPackageXml(reports: string[], dashboards: string[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
  ];

  if (reports.length > 0) {
    lines.push('  <types>');
    for (const r of reports) lines.push(`    <members>${r}</members>`);
    lines.push('    <name>Report</name>');
    lines.push('  </types>');
  }

  if (dashboards.length > 0) {
    lines.push('  <types>');
    for (const d of dashboards) lines.push(`    <members>${d}</members>`);
    lines.push('    <name>Dashboard</name>');
    lines.push('  </types>');
  }

  lines.push(`  <version>${METADATA_API_VERSION}</version>`);
  lines.push('</Package>');
  return lines.join('\n');
}

/** Retrieve metadata components as a zip buffer */
async function retrieveMetadata(packageXml: string): Promise<Buffer> {
  const conn = await salesforceService.getConn();
  conn.metadata.pollTimeout = DEPLOY_POLL_TIMEOUT;
  conn.metadata.pollInterval = DEPLOY_POLL_INTERVAL;

  return new Promise((resolve, reject) => {
    conn.metadata.retrieve({ unpackaged: parsePackageXml(packageXml) })
      .complete((err: Error | null, result: any) => {
        if (err) return reject(err);
        if (!result.zipFile) return reject(new Error('No zip file returned from retrieve'));
        resolve(Buffer.from(result.zipFile, 'base64'));
      });
  });
}

/** Parse package.xml string into the structure jsforce expects */
function parsePackageXml(xml: string): { types: Array<{ name: string; members: string[] }>; version: string } {
  const types: Array<{ name: string; members: string[] }> = [];
  const typeBlocks = xml.match(/<types>([\s\S]*?)<\/types>/g) ?? [];

  for (const block of typeBlocks) {
    const nameMatch = block.match(/<name>(\w+)<\/name>/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const members: string[] = [];
    const memberMatches = block.matchAll(/<members>([^<]+)<\/members>/g);
    for (const m of memberMatches) members.push(m[1]);
    types.push({ name, members });
  }

  return { types, version: METADATA_API_VERSION };
}

/** Deploy a zip buffer to the org */
async function deployMetadata(zipBuffer: Buffer): Promise<{ success: boolean; id: string; errors: string[] }> {
  const conn = await salesforceService.getConn();
  conn.metadata.pollTimeout = DEPLOY_POLL_TIMEOUT;
  conn.metadata.pollInterval = DEPLOY_POLL_INTERVAL;

  return new Promise((resolve, reject) => {
    conn.metadata.deploy(zipBuffer, { singlePackage: true, rollbackOnError: true })
      .complete((err: Error | null, result: any) => {
        if (err) return reject(err);

        const errors: string[] = [];
        if (result.details?.componentFailures) {
          const failures = Array.isArray(result.details.componentFailures)
            ? result.details.componentFailures
            : [result.details.componentFailures];
          for (const f of failures) {
            if (f.problem) errors.push(`${f.fullName}: ${f.problem}`);
          }
        }

        resolve({
          success: result.success,
          id: result.id,
          errors,
        });
      });
  });
}

/** Extract all text content between XML tags — simple regex XML parse */
function extractXmlValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : null;
}

/** Extract all report references from dashboard XML */
function extractReportRefs(dashboardXml: string): string[] {
  const refs: string[] = [];
  const matches = dashboardXml.matchAll(/<report>([^<]+)<\/report>/g);
  for (const m of matches) {
    if (!refs.includes(m[1])) refs.push(m[1]);
  }
  return refs;
}

/** Apply substitutions to an XML string */
function applySubstitutions(xml: string, subs: Array<{ find: string; replace: string }>): string {
  let result = xml;
  for (const sub of subs) {
    // Global replace — handles filter values, names, descriptions, labels
    result = result.split(sub.find).join(sub.replace);
  }
  return result;
}

/** Generate a safe developer name from a human-readable name */
function toDevName(name: string, prefix?: string): string {
  const base = name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 60);
  return prefix ? `${prefix}${base}` : base;
}

// ─── Clone Dashboard Handler ──────────────────────────────────────────────────

async function handleCloneDashboard(rawArgs: unknown): Promise<string> {
  const args = CloneDashboardArgs.parse(rawArgs ?? {});
  const { substitutions, dry_run } = args;

  if (!args.source_dashboard_id && !args.source_dashboard_name) {
    return 'Error: Provide either source_dashboard_id or source_dashboard_name.';
  }

  // ── Step 1: Resolve source dashboard ──────────────────────────────────────
  let dashboardDevName: string;
  let dashboardFolder: string;
  let dashboardTitle: string;

  if (args.source_dashboard_id) {
    const rows = await salesforceService.rawQuery<{
      Id: string; Title: string; DeveloperName: string; FolderName: string; FolderId: string;
    }>(`SELECT Id, Title, DeveloperName, FolderName, FolderId FROM Dashboard WHERE Id = '${args.source_dashboard_id}'`);
    if (rows.length === 0) return `Error: No dashboard found with ID "${args.source_dashboard_id}".`;
    dashboardDevName = rows[0].DeveloperName;
    dashboardTitle = rows[0].Title;

    // Get folder developer name
    const folders = await salesforceService.rawQuery<{ Id: string; DeveloperName: string }>(
      `SELECT Id, DeveloperName FROM Folder WHERE Id = '${rows[0].FolderId}'`
    );
    dashboardFolder = folders.length > 0 ? folders[0].DeveloperName : 'unfiled$public';
  } else {
    const safe = args.source_dashboard_name!.replace(/'/g, "\\'");
    const rows = await salesforceService.rawQuery<{
      Id: string; Title: string; DeveloperName: string; FolderName: string; FolderId: string;
    }>(`SELECT Id, Title, DeveloperName, FolderName, FolderId FROM Dashboard WHERE Title LIKE '%${safe}%' LIMIT 5`);
    if (rows.length === 0) return `Error: No dashboard found matching "${args.source_dashboard_name}".`;
    if (rows.length > 1) {
      return `Multiple dashboards match "${args.source_dashboard_name}":\n${rows.map(r => `• ${r.Title} (${r.Id})`).join('\n')}\nPlease use source_dashboard_id to specify.`;
    }
    dashboardDevName = rows[0].DeveloperName;
    dashboardTitle = rows[0].Title;

    const folders = await salesforceService.rawQuery<{ Id: string; DeveloperName: string }>(
      `SELECT Id, DeveloperName FROM Folder WHERE Id = '${rows[0].FolderId}'`
    );
    dashboardFolder = folders.length > 0 ? folders[0].DeveloperName : 'unfiled$public';
  }

  const targetDashFolder = args.target_folder ?? dashboardFolder;
  const sourceFullName = `${dashboardFolder}/${dashboardDevName}`;

  // ── Step 2: Retrieve the dashboard metadata ───────────────────────────────
  const dashPkgXml = buildPackageXml([], [sourceFullName]);
  const dashZipBuf = await retrieveMetadata(dashPkgXml);
  const dashZip = await JSZip.loadAsync(dashZipBuf);

  // Find the dashboard file in the zip
  let dashboardXml = '';
  const dashPath = `unpackaged/dashboards/${dashboardFolder}/${dashboardDevName}.dashboard`;
  const dashFile = dashZip.file(dashPath);
  if (dashFile) {
    dashboardXml = await dashFile.async('text');
  } else {
    // Try alternate paths
    for (const [path, file] of Object.entries(dashZip.files)) {
      if (path.endsWith('.dashboard') && !file.dir) {
        dashboardXml = await file.async('text');
        break;
      }
    }
  }

  if (!dashboardXml) return `Error: Could not read dashboard XML from retrieved metadata.`;

  // ── Step 3: Identify all report dependencies ──────────────────────────────
  const reportRefs = extractReportRefs(dashboardXml);
  if (reportRefs.length === 0) return `Error: Dashboard "${dashboardTitle}" has no report references.`;

  // ── Step 4: Retrieve all reports ──────────────────────────────────────────
  const reportPkgXml = buildPackageXml(reportRefs, []);
  const reportZipBuf = await retrieveMetadata(reportPkgXml);
  const reportZip = await JSZip.loadAsync(reportZipBuf);

  // Extract all report XMLs
  const reportXmls = new Map<string, string>(); // fullName -> XML
  for (const [path, file] of Object.entries(reportZip.files)) {
    if (path.endsWith('.report') && !file.dir) {
      const xml = await (file as JSZip.JSZipObject).async('text');
      // Extract fullName from path: unpackaged/reports/FolderName/DevName.report → FolderName/DevName
      const match = path.match(/unpackaged\/reports\/(.+)\.report$/);
      if (match) reportXmls.set(match[1], xml);
    }
  }

  // ── Step 5: Transform — apply substitutions + rename ──────────────────────
  const namePrefix = args.name_prefix ?? toDevName(
    substitutions.find(s => s.replace.length > 2)?.replace ?? 'Clone', ''
  ).substring(0, 15) + '_';

  // Build report name mapping: old fullName → new fullName
  const reportMapping = new Map<string, string>(); // old → new
  const newReportXmls = new Map<string, string>();  // new fullName → transformed XML

  for (const [oldFullName, xml] of reportXmls) {
    const parts = oldFullName.split('/');
    const folder = parts.slice(0, -1).join('/');
    const oldDevName = parts[parts.length - 1];
    const newDevName = `${namePrefix}${oldDevName}`.substring(0, 80);
    const targetReportFolder = args.target_folder ?? folder;
    const newFullName = `${targetReportFolder}/${newDevName}`;

    reportMapping.set(oldFullName, newFullName);

    // Apply substitutions to report XML
    let transformed = applySubstitutions(xml, substitutions);

    // Also update the <name> tag if substitutions change it
    transformed = applySubstitutions(transformed, substitutions);

    // Ensure report name is ≤40 chars
    const nameMatch = transformed.match(/<name>([^<]+)<\/name>/);
    if (nameMatch && nameMatch[1].length > 40) {
      const shortened = nameMatch[1].substring(0, 40);
      transformed = transformed.replace(`<name>${nameMatch[1]}</name>`, `<name>${shortened}</name>`);
    }

    newReportXmls.set(newFullName, transformed);
  }

  // Transform dashboard XML
  let newDashXml = applySubstitutions(dashboardXml, substitutions);

  // Update report references in dashboard
  for (const [oldRef, newRef] of reportMapping) {
    newDashXml = newDashXml.split(oldRef).join(newRef);
  }

  // Update dashboard title and description
  if (args.new_title) {
    newDashXml = newDashXml.replace(
      /<title>[^<]*<\/title>/,
      `<title>${args.new_title}</title>`
    );
  }
  if (args.new_description) {
    newDashXml = newDashXml.replace(
      /<description>[^<]*<\/description>/,
      `<description>${args.new_description}</description>`
    );
  }

  const newDashDevName = `${namePrefix}Dashboard`.substring(0, 80);
  const newDashFullName = `${targetDashFolder}/${newDashDevName}`;

  // ── Step 6: Dry run output ────────────────────────────────────────────────
  if (dry_run) {
    const lines: string[] = [];
    lines.push(`# 🔄 Dashboard Clone — Dry Run`);
    lines.push('');
    lines.push(`**Source:** ${dashboardTitle} (${sourceFullName})`);
    lines.push(`**Target Dashboard:** ${newDashFullName}`);
    lines.push(`**Target Title:** ${args.new_title ?? 'Same as source (with substitutions applied)'}`);
    lines.push('');
    lines.push(`## Substitutions Applied`);
    for (const s of substitutions) {
      lines.push(`- \`${s.find}\` → \`${s.replace}\``);
    }
    lines.push('');
    lines.push(`## Reports to Clone (${newReportXmls.size})`);
    for (const [oldName, newName] of reportMapping) {
      lines.push(`- ${oldName} → **${newName}**`);
    }
    lines.push('');
    lines.push(`*Run again with dry_run: false to deploy.*`);
    return lines.join('\n');
  }

  // ── Step 7: Build deployment zip ──────────────────────────────────────────
  const deployZip = new JSZip();

  // Add reports
  const reportFullNames: string[] = [];
  for (const [fullName, xml] of newReportXmls) {
    deployZip.file(`reports/${fullName}.report`, xml);
    reportFullNames.push(fullName);
  }

  // Add dashboard
  deployZip.file(`dashboards/${newDashFullName}.dashboard`, newDashXml);

  // Add package.xml
  deployZip.file('package.xml', buildPackageXml(reportFullNames, [newDashFullName]));

  const zipBuffer = await deployZip.generateAsync({ type: 'nodebuffer' });

  // ── Step 8: Deploy ────────────────────────────────────────────────────────
  const result = await deployMetadata(zipBuffer);

  if (!result.success) {
    const errorLines = result.errors.map(e => `• ${e}`).join('\n');
    return `# ❌ Deploy Failed\n\n${errorLines}\n\nDeploy ID: ${result.id}`;
  }

  // ── Step 9: Get the new dashboard URL ─────────────────────────────────────
  const newDashRows = await salesforceService.rawQuery<{ Id: string }>(
    `SELECT Id FROM Dashboard WHERE DeveloperName = '${newDashDevName}' LIMIT 1`
  );
  const dashUrl = newDashRows.length > 0
    ? `https://progressivedental.lightning.force.com/lightning/r/Dashboard/${newDashRows[0].Id}/view`
    : '(URL not available — check Dashboards tab)';

  const lines: string[] = [];
  lines.push(`# ✅ Dashboard Cloned Successfully`);
  lines.push('');
  lines.push(`**Source:** ${dashboardTitle}`);
  lines.push(`**New Dashboard:** ${args.new_title ?? dashboardTitle}`);
  lines.push(`**Reports Cloned:** ${newReportXmls.size}`);
  lines.push(`**Deploy ID:** ${result.id}`);
  lines.push('');
  lines.push(`## Substitutions Applied`);
  for (const s of substitutions) {
    lines.push(`- \`${s.find}\` → \`${s.replace}\``);
  }
  lines.push('');
  lines.push(`## Reports Created`);
  for (const [, newName] of reportMapping) {
    lines.push(`- ${newName}`);
  }
  lines.push('');
  lines.push(`**🔗 Dashboard URL:** ${dashUrl}`);
  return lines.join('\n');
}

// ─── Create Report Handler ────────────────────────────────────────────────────

async function handleCreateReport(rawArgs: unknown): Promise<string> {
  const args = CreateReportArgs.parse(rawArgs ?? {});
  const { dry_run } = args;

  // Determine format
  let format = args.format ?? 'Tabular';
  if (args.group_by && args.group_by.length > 0 && format === 'Tabular') {
    format = 'Summary';
  }

  // ── Build Report XML ────────────────────────────────────────────────────
  const xmlLines: string[] = [];
  xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>');
  xmlLines.push('<Report xmlns="http://soap.sforce.com/2006/04/metadata">');

  // Columns
  for (const col of args.columns) {
    xmlLines.push('    <columns>');
    xmlLines.push(`        <field>${col}</field>`);
    xmlLines.push('    </columns>');
  }

  // Description
  if (args.description) {
    xmlLines.push(`    <description>${escapeXml(args.description)}</description>`);
  }

  // Filters
  if (args.filters && args.filters.length > 0) {
    xmlLines.push('    <filter>');
    for (const f of args.filters) {
      xmlLines.push('        <criteriaItems>');
      xmlLines.push(`            <column>${f.field}</column>`);
      xmlLines.push('            <columnToColumn>false</columnToColumn>');
      xmlLines.push('            <isUnlocked>true</isUnlocked>');
      xmlLines.push(`            <operator>${f.operator}</operator>`);
      xmlLines.push(`            <value>${escapeXml(f.value)}</value>`);
      xmlLines.push('        </criteriaItems>');
    }
    xmlLines.push('    </filter>');
  }

  // Format
  xmlLines.push(`    <format>${format}</format>`);

  // Groupings (for Summary/Matrix)
  if (args.group_by) {
    for (const field of args.group_by) {
      xmlLines.push('    <groupingsDown>');
      xmlLines.push('        <dateGranularity>Day</dateGranularity>');
      xmlLines.push(`        <field>${field}</field>`);
      xmlLines.push('        <sortOrder>Asc</sortOrder>');
      xmlLines.push('    </groupingsDown>');
    }
  }

  // Name
  xmlLines.push(`    <name>${escapeXml(args.report_name)}</name>`);

  // Standard params
  xmlLines.push('    <params>');
  xmlLines.push('        <name>terr</name>');
  xmlLines.push('        <value>all</value>');
  xmlLines.push('    </params>');
  xmlLines.push('    <params>');
  xmlLines.push('        <name>open</name>');
  xmlLines.push('        <value>all</value>');
  xmlLines.push('    </params>');
  xmlLines.push('    <params>');
  xmlLines.push('        <name>probability</name>');
  xmlLines.push('        <value>&gt;0</value>');
  xmlLines.push('    </params>');
  xmlLines.push('    <params>');
  xmlLines.push('        <name>co</name>');
  xmlLines.push('        <value>1</value>');
  xmlLines.push('    </params>');

  // Report type
  xmlLines.push(`    <reportType>${args.report_type}</reportType>`);

  // Scope
  xmlLines.push(`    <scope>${args.scope}</scope>`);

  // Show details
  xmlLines.push(`    <showDetails>${args.show_details}</showDetails>`);
  xmlLines.push('    <showGrandTotal>true</showGrandTotal>');
  xmlLines.push('    <showSubTotals>true</showSubTotals>');

  // Date filter
  if (args.date_filter) {
    xmlLines.push('    <timeFrameFilter>');
    xmlLines.push(`        <dateColumn>${args.date_filter.field}</dateColumn>`);
    xmlLines.push(`        <interval>${args.date_filter.range}</interval>`);
    xmlLines.push('    </timeFrameFilter>');
  } else {
    xmlLines.push('    <timeFrameFilter>');
    xmlLines.push('        <dateColumn>CREATED_DATE</dateColumn>');
    xmlLines.push('        <interval>INTERVAL_CUSTOM</interval>');
    xmlLines.push('    </timeFrameFilter>');
  }

  xmlLines.push('</Report>');

  const reportXml = xmlLines.join('\n');
  const devName = toDevName(args.report_name);
  const fullName = `${args.folder}/${devName}`;

  // ── Dry run output ────────────────────────────────────────────────────────
  if (dry_run) {
    const lines: string[] = [];
    lines.push(`# 📋 Create Report — Dry Run`);
    lines.push('');
    lines.push(`**Name:** ${args.report_name}`);
    lines.push(`**Developer Name:** ${devName}`);
    lines.push(`**Folder:** ${args.folder}`);
    lines.push(`**Report Type:** ${args.report_type}`);
    lines.push(`**Format:** ${format}`);
    lines.push(`**Columns:** ${args.columns.length}`);
    lines.push(`**Filters:** ${args.filters?.length ?? 0}`);
    lines.push(`**Groupings:** ${args.group_by?.length ?? 0}`);
    lines.push('');
    lines.push(`### Generated XML`);
    lines.push('```xml');
    lines.push(reportXml);
    lines.push('```');
    lines.push('');
    lines.push(`*Run again with dry_run: false to deploy.*`);
    return lines.join('\n');
  }

  // ── Build zip + deploy ────────────────────────────────────────────────────
  const deployZip = new JSZip();
  deployZip.file(`reports/${fullName}.report`, reportXml);
  deployZip.file('package.xml', buildPackageXml([fullName], []));

  const zipBuffer = await deployZip.generateAsync({ type: 'nodebuffer' });
  const result = await deployMetadata(zipBuffer);

  if (!result.success) {
    const errorLines = result.errors.map(e => `• ${e}`).join('\n');
    return `# ❌ Deploy Failed\n\n${errorLines}\n\nDeploy ID: ${result.id}`;
  }

  // Get report URL
  const reportRows = await salesforceService.rawQuery<{ Id: string }>(
    `SELECT Id FROM Report WHERE DeveloperName = '${devName}' LIMIT 1`
  );
  const reportUrl = reportRows.length > 0
    ? `https://progressivedental.lightning.force.com/lightning/r/Report/${reportRows[0].Id}/view`
    : '(Check Reports tab)';

  const lines: string[] = [];
  lines.push(`# ✅ Report Created Successfully`);
  lines.push('');
  lines.push(`**Name:** ${args.report_name}`);
  lines.push(`**Folder:** ${args.folder}`);
  lines.push(`**Format:** ${format}`);
  lines.push(`**Columns:** ${args.columns.length}`);
  lines.push(`**Filters:** ${args.filters?.length ?? 0}`);
  lines.push(`**Deploy ID:** ${result.id}`);
  lines.push('');
  lines.push(`**🔗 Report URL:** ${reportUrl}`);
  return lines.join('\n');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const reportBuilderHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_clone_dashboard: handleCloneDashboard,
  sf_create_report: handleCreateReport,
};
