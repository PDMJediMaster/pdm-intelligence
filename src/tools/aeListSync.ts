// ─────────────────────────────────────────────────────────────────────────────
// sf_sync_ae_lists
//
// Syncs Account Engagement (Pardot) segmentation lists and their members
// into two Salesforce custom objects:
//
//   AE_List__c            — one record per Pardot segmentation list
//   AE_List_Membership__c — one record per prospect-in-list membership,
//                           linked to either Lead__c or Contact__c
//
// This enables CRM reports like "which Leads are in list X?" and feeds
// SMS Magic campaigns directly from Salesforce.
//
// Auth: Pardot API v5 — Salesforce Connected App OAuth2 (username-password flow)
//       Requires SF_CLIENT_ID + SF_CLIENT_SECRET env vars with pardot_api scope.
// External IDs:
//   AE_List__c            → AE_List_ID__c
//   AE_List_Membership__c → Membership_Key__c  (format: "{listId}-{prospectId}")
// ─────────────────────────────────────────────────────────────────────────────

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { salesforceService } from '../services/salesforce.js';
import { pardotV5Get, PARDOT_V5_BASE } from '../services/pardotAuth.js';

// ─── Tool Definition ──────────────────────────────────────────────────────────

export const aeListSyncTools: Tool[] = [
  {
    name: 'sf_sync_ae_lists',
    description:
      'Syncs Account Engagement (Pardot) segmentation lists and prospect memberships into ' +
      'Salesforce CRM objects (AE_List__c and AE_List_Membership__c). ' +
      'Enables CRM reports of which Leads and Contacts are in specific AE lists — ' +
      'required for SMS Magic campaign targeting. ' +
      'Use when asked to "sync AE lists", "update list memberships", "sync Pardot lists to Salesforce", ' +
      '"refresh segmentation data", or before building SMS campaigns from AE lists. ' +
      'Modes: full (all lists + all members), lists_only (just the list records), ' +
      'or memberships_only for a specific list by name or ID.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['full', 'lists_only', 'memberships_only'],
          description:
            'full = sync list records + all memberships (may take several minutes). ' +
            'lists_only = only upsert AE_List__c records (fast, ~seconds). ' +
            'memberships_only = sync memberships for a specific list (requires list_id or list_name).',
        },
        list_id: {
          type: 'number',
          description: 'Pardot list ID to sync memberships for (use with memberships_only mode).',
        },
        list_name: {
          type: 'string',
          description: 'Partial name match to find a list (e.g. "All Leads"). Resolved to ID automatically.',
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, fetch and count records but do not write to Salesforce.',
        },
      },
      required: [],
    },
  },
];

// ─── Input Schema ─────────────────────────────────────────────────────────────

const AeListSyncArgs = z.object({
  mode:      z.enum(['full', 'lists_only', 'memberships_only']).default('full'),
  list_id:   z.number().optional(),
  list_name: z.string().optional(),
  dry_run:   z.boolean().default(false),
});

// ─── Pardot v5 Types ─────────────────────────────────────────────────────────

interface PardotList {
  id:        number;
  name:      string;
  isDeleted: boolean;
  isDynamic: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PardotListMembership {
  id:         number;
  listId:     number;
  prospectId: number;
  optedOut:   boolean;
  createdAt:  string;
  updatedAt:  string;
}

interface PardotProspect {
  id:            number;
  email:         string;
  salesforceId?: string;
}

interface PardotPage<T> {
  values:       T[];
  nextPageUrl:  string | null;
}

// ─── SF Upsert Record Types ───────────────────────────────────────────────────

interface AEListRecord {
  AE_List_ID__c: string;
  Name:          string;
  Active__c:     boolean;
  Dynamic__c:    boolean;
  Last_Sync__c:  string;
}

interface AEMembershipRecord {
  Membership_Key__c:    string;
  AE_Prospect_ID__c:    string;
  'AE_List__r':         { AE_List_ID__c: string };
  Active_Membership__c: boolean;
  Date_Added__c:        string | null;
  Prospect_Email__c:    string | null;
  Lead__c?:             string;
  Contact__c?:          string;
}

// ─── Pardot v5 Fetch Helpers ─────────────────────────────────────────────────

async function fetchAllPages<T>(firstUrl: string): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = firstUrl;
  while (url) {
    const page: PardotPage<T> = await pardotV5Get<PardotPage<T>>(
      url.replace(`${PARDOT_V5_BASE}/`, ''),
    );
    all.push(...(page.values ?? []));
    url = page.nextPageUrl;
  }
  return all;
}

async function fetchAllLists(): Promise<PardotList[]> {
  return fetchAllPages<PardotList>(
    `${PARDOT_V5_BASE}/lists?fields=id,name,isDeleted,isDynamic,createdAt,updatedAt&pageSize=200`,
  );
}

async function fetchListMemberships(listId: number): Promise<PardotListMembership[]> {
  return fetchAllPages<PardotListMembership>(
    `${PARDOT_V5_BASE}/list-memberships?fields=id,listId,prospectId,optedOut,createdAt,updatedAt&listId=${listId}&pageSize=200`,
  );
}

async function fetchProspectDetails(
  prospectIds: number[],
): Promise<Map<number, PardotProspect>> {
  const map   = new Map<number, PardotProspect>();
  const CHUNK = 50;
  for (let i = 0; i < prospectIds.length; i += CHUNK) {
    const chunk = prospectIds.slice(i, i + CHUNK);
    const idParams = chunk.map(id => `id[]=${id}`).join('&');
    try {
      const page = await pardotV5Get<PardotPage<PardotProspect>>(
        `prospects?fields=id,email,salesforceId&${idParams}&pageSize=${CHUNK}`,
      );
      for (const p of page.values ?? []) map.set(p.id, p);
    } catch {
      // skip chunk — membership records will lack email/sfId
    }
  }
  return map;
}

// ─── jsforce Upsert Helpers ───────────────────────────────────────────────────

interface UpsertResult {
  created: boolean;
  id:      string;
  success: boolean;
  errors?: Array<{ message: string; statusCode: string }>;
}

async function upsertListRecords(
  conn: Awaited<ReturnType<typeof salesforceService.getConn>>,
  records: AEListRecord[],
): Promise<{ inserted: number; updated: number; errors: number }> {
  if (!records.length) return { inserted: 0, updated: 0, errors: 0 };
  const raw = await conn.sobject('AE_List__c')
    .upsert(records as unknown as object[], 'AE_List_ID__c', {});
  return countResults((Array.isArray(raw) ? raw : [raw]) as unknown as UpsertResult[]);
}

async function upsertMembershipRecords(
  conn: Awaited<ReturnType<typeof salesforceService.getConn>>,
  records: AEMembershipRecord[],
): Promise<{ inserted: number; updated: number; errors: number }> {
  if (!records.length) return { inserted: 0, updated: 0, errors: 0 };

  const totals = { inserted: 0, updated: 0, errors: 0 };
  const BATCH  = 200;

  for (let i = 0; i < records.length; i += BATCH) {
    const raw2   = await conn.sobject('AE_List_Membership__c')
      .upsert(records.slice(i, i + BATCH) as unknown as object[], 'Membership_Key__c', {});
    const counts = countResults((Array.isArray(raw2) ? raw2 : [raw2]) as unknown as UpsertResult[]);
    totals.inserted += counts.inserted;
    totals.updated  += counts.updated;
    totals.errors   += counts.errors;
  }

  return totals;
}

function countResults(results: UpsertResult[]): { inserted: number; updated: number; errors: number } {
  let inserted = 0, updated = 0, errors = 0;
  for (const r of results) {
    if (!r.success) errors++;
    else if (r.created) inserted++;
    else updated++;
  }
  return { inserted, updated, errors };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handleAeListSync(rawArgs: unknown): Promise<string> {
  const { mode, list_id, list_name, dry_run } = AeListSyncArgs.parse(rawArgs ?? {});

  if (!process.env.SF_CLIENT_ID || !process.env.SF_CLIENT_SECRET) {
    return (
      '❌ Pardot OAuth not configured.\n\n' +
      'Add to your .env and Railway environment:\n' +
      '  SF_CLIENT_ID     — Connected App Consumer Key\n' +
      '  SF_CLIENT_SECRET — Connected App Consumer Secret\n\n' +
      'Setup: Salesforce Setup → App Manager → New Connected App\n' +
      'Scopes required: api, pardot_api, refresh_token'
    );
  }

  const lines: string[] = [];
  const now     = new Date().toISOString();
  const startMs = Date.now();

  lines.push(`# 🔄 AE List Sync`);
  lines.push(`**Mode:** ${mode}${dry_run ? ' *(dry run — no writes)*' : ''}`);
  lines.push('');

  // ── Resolve list filter ────────────────────────────────────────────────────

  let targetListId: number | undefined = list_id;

  if (list_name && !targetListId) {
    const allLists = await fetchAllLists();
    const match = allLists.find(l =>
      l.name.toLowerCase().includes(list_name.toLowerCase())
    );
    if (!match) {
      const similar = allLists
        .filter(l => l.name.toLowerCase().includes(list_name.toLowerCase().slice(0, 4)))
        .slice(0, 5)
        .map(l => `  - ${l.name} (ID: ${l.id})`);
      return (
        `❌ No list found matching "${list_name}".\n\n` +
        (similar.length ? `Did you mean:\n${similar.join('\n')}` : 'No similar lists found.')
      );
    }
    targetListId = match.id;
    lines.push(`**List resolved:** ${match.name} (ID: ${match.id})`);
    lines.push('');
  }

  if (mode === 'memberships_only' && !targetListId) {
    return '❌ `memberships_only` mode requires `list_id` or `list_name`.';
  }

  // ── Step 1: Fetch and upsert lists ────────────────────────────────────────

  let allLists: PardotList[] = [];

  if (mode !== 'memberships_only') {
    lines.push(`## Step 1: Syncing Lists`);

    allLists = await fetchAllLists();
    const activeLists = allLists.filter(l => !l.isDeleted);

    lines.push(`Found **${allLists.length}** total lists (${activeLists.length} active, ${allLists.length - activeLists.length} deleted)`);

    const listRecords: AEListRecord[] = allLists.map(l => ({
      AE_List_ID__c: String(l.id),
      Name:          l.name.substring(0, 80),
      Active__c:     !l.isDeleted,
      Dynamic__c:    l.isDynamic,
      Last_Sync__c:  now,
    }));

    if (!dry_run) {
      const conn = await salesforceService.getConn();
      const r = await upsertListRecords(conn, listRecords);
      lines.push(`Upserted: **${r.inserted}** new · **${r.updated}** updated · **${r.errors}** errors`);
    } else {
      lines.push(`*(dry run) Would upsert ${listRecords.length} list records*`);
    }
    lines.push('');
  }

  if (mode === 'lists_only') {
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    lines.push(`---`);
    lines.push(`*Completed in ${elapsed}s | Prophet by PDM*`);
    return lines.join('\n');
  }

  // ── Step 2: Fetch and upsert memberships ──────────────────────────────────

  lines.push(`## Step 2: Syncing Memberships`);

  const listsToProcess: Array<{ id: number; name: string }> = targetListId
    ? (allLists.length
        ? allLists.filter(l => l.id === targetListId)
        : [{ id: targetListId, name: String(targetListId) }])
    : allLists.filter(l => !l.isDeleted);

  if (!listsToProcess.length) {
    lines.push(`No lists to process.`);
    return lines.join('\n');
  }

  lines.push(`Processing **${listsToProcess.length}** list${listsToProcess.length === 1 ? '' : 's'}…`);
  lines.push('');

  const membershipTotals = { inserted: 0, updated: 0, errors: 0, total: 0 };
  const listSummary: string[] = [];

  for (const list of listsToProcess) {
    const memberships = await fetchListMemberships(list.id);

    if (!memberships.length) {
      listSummary.push(`- ${list.name} (${list.id}): 0 members`);
      continue;
    }

    const prospectIds = [...new Set(memberships.map(m => m.prospectId))];
    const prospects   = await fetchProspectDetails(prospectIds);

    const records: AEMembershipRecord[] = memberships.map(m => {
      const p      = prospects.get(m.prospectId);
      const sfId   = p?.salesforceId ?? '';
      const record: AEMembershipRecord = {
        Membership_Key__c:    `${m.listId}-${m.prospectId}`,
        AE_Prospect_ID__c:    String(m.prospectId),
        'AE_List__r':         { AE_List_ID__c: String(m.listId) },
        Active_Membership__c: !m.optedOut,
        Date_Added__c:        m.createdAt ? m.createdAt.split('T')[0] : null,
        Prospect_Email__c:    p?.email ?? null,
      };
      if (sfId.startsWith('003'))      record.Contact__c = sfId;
      else if (sfId.startsWith('00Q')) record.Lead__c    = sfId;
      return record;
    });

    if (!dry_run) {
      const conn = await salesforceService.getConn();
      const r = await upsertMembershipRecords(conn, records);
      membershipTotals.inserted += r.inserted;
      membershipTotals.updated  += r.updated;
      membershipTotals.errors   += r.errors;
      membershipTotals.total    += records.length;
      listSummary.push(
        `- **${list.name}** (${list.id}): ${records.length} members → ` +
        `${r.inserted} new, ${r.updated} updated${r.errors > 0 ? `, ⚠️ ${r.errors} errors` : ''}`
      );
    } else {
      membershipTotals.total += records.length;
      const withSfId = records.filter(r => r.Lead__c || r.Contact__c).length;
      listSummary.push(
        `- ${list.name} (${list.id}): ${records.length} members ` +
        `(${withSfId} matched to Lead/Contact)`
      );
    }
  }

  lines.push(...listSummary);
  lines.push('');

  if (!dry_run) {
    lines.push(`### Membership Totals`);
    lines.push(`| | Count |`);
    lines.push(`|---|---|`);
    lines.push(`| Total processed | ${membershipTotals.total.toLocaleString()} |`);
    lines.push(`| New records | ${membershipTotals.inserted.toLocaleString()} |`);
    lines.push(`| Updated records | ${membershipTotals.updated.toLocaleString()} |`);
    lines.push(`| Errors | ${membershipTotals.errors} |`);
  } else {
    lines.push(`*(dry run) Would upsert ${membershipTotals.total.toLocaleString()} membership records*`);
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  lines.push('');
  lines.push(`---`);
  lines.push(`*Completed in ${elapsed}s | Prophet by PDM*`);

  return lines.join('\n');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const aeListSyncHandlers: Record<string, (args: unknown) => Promise<string>> = {
  sf_sync_ae_lists: handleAeListSync,
};
