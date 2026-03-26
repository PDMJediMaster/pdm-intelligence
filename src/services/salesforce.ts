import jsforce from 'jsforce';
import { config } from 'dotenv';
import type {
  SalesforceAccount,
  SalesforceCase,
  SalesforceContact,
  SalesforceOpportunity,
  SalesforceOpportunityLineItem,
  SalesforceTask,
} from '../types.js';
import { MAX_ACCOUNT_QUERY } from '../constants.js';

config();

/** PDM roles whose owned accounts should appear in bulk operational queries */
const ACTIVE_ROLE_SOQL = `Owner.IsActive = true AND Owner.UserRole.Name IN (
  'Account Manager', 'Account Manager Team Lead', 'Sales Execs',
  'CEO', 'Practice Growth Advisor', 'System Administrator', 'TCI Mentorship'
)`;

/** Validate a Salesforce ID (15 or 18 alphanumeric chars) */
function assertSfId(id: string, label = 'ID'): string {
  if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) {
    throw new Error(`Invalid Salesforce ${label}: "${id}"`);
  }
  return id;
}

/** Escape single quotes in SOQL string literals */
function soqlEscape(value: string): string {
  return value.replace(/'/g, "\\'");
}

/** ISO date string N days from now (or past if negative) */
function isoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().split('T')[0];
}

// ─── Service ───────────────────────────────────────────────────────────────

class SalesforceService {
  private conn: jsforce.Connection | null = null;
  private connectingPromise: Promise<void> | null = null;

  private async getConnection(): Promise<jsforce.Connection> {
    if (this.conn) return this.conn;
    if (this.connectingPromise) {
      await this.connectingPromise;
      return this.conn!;
    }

    const loginUrl = process.env.SF_LOGIN_URL ?? 'https://login.salesforce.com';
    const username  = process.env.SF_USERNAME;
    const password  = process.env.SF_PASSWORD;
    const token     = process.env.SF_SECURITY_TOKEN ?? '';

    if (!username || !password) {
      throw new Error(
        'Salesforce credentials missing. Set SF_USERNAME and SF_PASSWORD in your .env file.'
      );
    }

    const conn = new jsforce.Connection({ loginUrl, version: '61.0' });

    this.connectingPromise = conn
      .login(username, password + token)
      .then(() => {
        this.conn = conn;
        this.connectingPromise = null;
      })
      .catch((err: unknown) => {
        this.connectingPromise = null;
        throw err;
      });

    await this.connectingPromise;
    return this.conn!;
  }

  /** Re-authenticate if the session expired and retry once */
  private async query<T>(soql: string): Promise<T[]> {
    const conn = await this.getConnection();
    try {
      const result = await conn.query<T>(soql);
      return result.records;
    } catch (err: unknown) {
      const isSessionExpired =
        err instanceof Error && err.message.includes('INVALID_SESSION_ID');
      if (isSessionExpired) {
        this.conn = null;
        const fresh = await this.getConnection();
        const result = await fresh.query<T>(soql);
        return result.records;
      }
      throw err;
    }
  }

  // ─── Accounts ─────────────────────────────────────────────────────────

  async getAccount(accountId: string): Promise<SalesforceAccount> {
    assertSfId(accountId, 'Account ID');
    const records = await this.query<SalesforceAccount>(`
      SELECT Id, Name, Phone, Website, BillingCity, BillingState,
             OwnerId, Owner.Name, Owner.Email,
             Status__c, TCI_Status__c,
             TCI_Trainer__r.Name, PPC_Specialist__r.Name,
             Social_Specialist__r.Name, SEO_Rep__r.Name,
             Management_Fee__c, Contract_End_Date__c,
             LastActivityDate
      FROM Account
      WHERE Id = '${accountId}'
      LIMIT 1
    `);
    if (!records.length) throw new Error(`Account not found: ${accountId}`);
    return records[0];
  }

  async searchAccountsByName(name: string): Promise<SalesforceAccount[]> {
    const safe = soqlEscape(name);
    return this.query<SalesforceAccount>(`
      SELECT Id, Name, Phone, OwnerId, Owner.Name, Status__c, TCI_Status__c, LastActivityDate
      FROM Account
      WHERE Name LIKE '%${safe}%'
        AND Status__c = 'Active'
      ORDER BY Name
      LIMIT 10
    `);
  }

  async getActiveAccounts(limit = MAX_ACCOUNT_QUERY): Promise<SalesforceAccount[]> {
    return this.query<SalesforceAccount>(`
      SELECT Id, Name, Phone, OwnerId, Owner.Name,
             Status__c, TCI_Status__c,
             LastActivityDate, Management_Fee__c, Contract_End_Date__c
      FROM Account
      WHERE Status__c = 'Active'
        AND (NOT Name LIKE '%Test%') AND (NOT Name LIKE '%test%') AND Name != 'House of Mouse'
        AND ${ACTIVE_ROLE_SOQL}
      ORDER BY Name
      LIMIT ${limit}
    `);
  }

  /** Accounts with no activity in the past N days — efficient churn signal */
  async getStaleAccounts(daysWithoutActivity: number, limit = 50): Promise<SalesforceAccount[]> {
    const cutoff = isoDate(-daysWithoutActivity);
    return this.query<SalesforceAccount>(`
      SELECT Id, Name, OwnerId, Owner.Name, Status__c, TCI_Status__c,
             LastActivityDate, Contract_End_Date__c
      FROM Account
      WHERE Status__c = 'Active'
        AND (NOT Name LIKE '%Test%') AND (NOT Name LIKE '%test%') AND Name != 'House of Mouse'
        AND ${ACTIVE_ROLE_SOQL}
        AND (LastActivityDate = null OR LastActivityDate < ${cutoff})
      ORDER BY LastActivityDate ASC NULLS FIRST
      LIMIT ${limit}
    `);
  }

  // ─── Contacts ─────────────────────────────────────────────────────────

  async getContacts(accountId: string): Promise<SalesforceContact[]> {
    assertSfId(accountId, 'Account ID');
    return this.query<SalesforceContact>(`
      SELECT Id, AccountId, FirstName, LastName, Name, Title, Email, Phone, MobilePhone
      FROM Contact
      WHERE AccountId = '${accountId}'
      ORDER BY CreatedDate ASC
      LIMIT 10
    `);
  }

  // ─── Opportunities ────────────────────────────────────────────────────

  async getOpportunities(
    accountId: string,
    options: { isClosed?: boolean; isWon?: boolean; limit?: number } = {}
  ): Promise<SalesforceOpportunity[]> {
    assertSfId(accountId, 'Account ID');
    const clauses: string[] = [`AccountId = '${accountId}'`];
    if (options.isClosed !== undefined) clauses.push(`IsClosed = ${options.isClosed}`);
    if (options.isWon    !== undefined) clauses.push(`IsWon = ${options.isWon}`);
    const limit = options.limit ?? 50;

    return this.query<SalesforceOpportunity>(`
      SELECT Id, AccountId, Name, StageName, CloseDate, Amount,
             Type, Probability, IsClosed, IsWon, CreatedDate
      FROM Opportunity
      WHERE ${clauses.join(' AND ')}
      ORDER BY CloseDate DESC
      LIMIT ${limit}
    `);
  }

  async getUpcomingRenewals(daysOut: number, ownerId?: string): Promise<{
    Id: string; Name: string; OwnerId: string; Owner?: { Name: string };
    Status__c?: string; Total_Monthly_Recurring_Amount__c?: number; Tier__c?: string;
    Contract_Renewal_Date__c: string; LastActivityDate?: string;
    Health_Score__c?: number; Health_Tier__c?: string;
    Flagged_Status__c?: boolean; Delinquent__c?: boolean;
    Cancellation_or_Pause_Request_Date__c?: string;
  }[]> {
    const today  = isoDate(0);
    const future = isoDate(daysOut);
    const ownerFilter = ownerId ? `AND OwnerId = '${ownerId}'` : '';
    return this.query(`
      SELECT Id, Name, OwnerId, Owner.Name,
             Status__c, Total_Monthly_Recurring_Amount__c, Tier__c,
             Contract_Renewal_Date__c, LastActivityDate,
             Health_Score__c, Health_Tier__c,
             Flagged_Status__c, Delinquent__c,
             Cancellation_or_Pause_Request_Date__c
      FROM Account
      WHERE Contract_Renewal_Date__c >= ${today}
        AND Contract_Renewal_Date__c <= ${future}
        AND Status__c NOT IN ('Cancelled','Inactive','Expired')
        AND Status__c != null
        AND (NOT Name LIKE '%Test%') AND (NOT Name LIKE '%test%') AND Name != 'House of Mouse'
        AND ${ACTIVE_ROLE_SOQL}
        AND OwnerId != '005PU000001eUQDYA2'
        ${ownerFilter}
      ORDER BY Contract_Renewal_Date__c ASC
      LIMIT 200
    `);
  }

  // ─── Opportunity Products ─────────────────────────────────────────────

  async getOpportunityLineItems(accountId: string): Promise<SalesforceOpportunityLineItem[]> {
    assertSfId(accountId, 'Account ID');
    return this.query<SalesforceOpportunityLineItem>(`
      SELECT Id, OpportunityId, Name, Product2Id, Product2.Name, Product2.Family,
             Quantity, TotalPrice, UnitPrice
      FROM OpportunityLineItem
      WHERE Opportunity.AccountId = '${accountId}'
        AND Opportunity.IsWon = true
      ORDER BY CreatedDate DESC
      LIMIT 50
    `);
  }

  /** Bulk fetch of all active-account products for upsell analysis */
  async getAllActiveAccountProducts(): Promise<
    { accountId: string; productName: string }[]
  > {
    // Budget fields on Account are the most reliable product signal.
    // Budget__c > 0 = PPC active, SEO_Budget__c > 0 = SEO active, etc.
    // Works for all accounts including legacy ones with no Opportunities or Sales Orders.
    // Only Status__c = 'Active' confirms services are currently running.
    // Budget fields on paused/non-renewing accounts may still be populated
    // from prior service periods — those shouldn't count as active products.
    // TCI Mentorship uses TCI_Status__c and is independent of marketing status.
    const accounts = await this.query<{
      Id: string;
      Status__c?: string;
      Budget__c?: number;
      SEO_Budget__c?: number;
      Social_Budget__c?: number;
      TCI_Status__c?: string;
      TCI_Enrolled__c?: boolean;
    }>(`
      SELECT Id, Status__c, Budget__c, SEO_Budget__c, Social_Budget__c,
             TCI_Status__c, TCI_Enrolled__c
      FROM Account
      WHERE Status__c NOT IN ('Cancelled','Inactive','Expired')
        AND Status__c != null
        AND ${ACTIVE_ROLE_SOQL}
        AND OwnerId != '005PU000001eUQDYA2'
        AND (NOT Name LIKE '%Test%') AND (NOT Name LIKE '%test%') AND Name != 'House of Mouse'
    `);

    const results: { accountId: string; productName: string }[] = [];
    for (const a of accounts) {
      const isActive = a.Status__c === 'Active';
      // Phase 2 services: only count when account is Active AND budget is set
      if (isActive && (a.Budget__c ?? 0) > 0)        results.push({ accountId: a.Id, productName: 'PPC' });
      if (isActive && (a.SEO_Budget__c ?? 0) > 0)    results.push({ accountId: a.Id, productName: 'SEO' });
      if (isActive && (a.Social_Budget__c ?? 0) > 0) results.push({ accountId: a.Id, productName: 'Social Media' });
      // TCI Mentorship: independent of marketing status
      if (a.TCI_Status__c === 'Member' || a.TCI_Enrolled__c)
        results.push({ accountId: a.Id, productName: 'TCI Mentorship' });
    }
    return results;
  }

  // ─── Cases ────────────────────────────────────────────────────────────

  async getCases(
    accountId: string,
    options: { openOnly?: boolean; since?: string; limit?: number } = {}
  ): Promise<SalesforceCase[]> {
    assertSfId(accountId, 'Account ID');
    const clauses: string[] = [`AccountId = '${accountId}'`];
    if (options.openOnly) clauses.push(`IsClosed = false`);
    if (options.since)    clauses.push(`CreatedDate >= ${options.since}T00:00:00Z`);
    const limit = options.limit ?? 20;

    return this.query<SalesforceCase>(`
      SELECT Id, AccountId, CaseNumber, Subject, Description, Status, Priority,
             Origin, Type, Owner.Name, CreatedDate, ClosedDate, LastModifiedDate, IsEscalated
      FROM Case
      WHERE ${clauses.join(' AND ')}
      ORDER BY CreatedDate DESC
      LIMIT ${limit}
    `);
  }

  /** Accounts that had new cases created since a given ISO date */
  async getCasesGroupedByAccount(since: string): Promise<
    { accountId: string; accountName: string; cases: SalesforceCase[] }[]
  > {
    const records = await this.query<SalesforceCase & { Account: { Name: string } }>(`
      SELECT Id, AccountId, Account.Name, CaseNumber, Subject, Status, Priority,
             CreatedDate, IsEscalated
      FROM Case
      WHERE CreatedDate >= ${since}T00:00:00Z
      ORDER BY CreatedDate DESC
      LIMIT 300
    `);

    const map = new Map<string, { accountId: string; accountName: string; cases: SalesforceCase[] }>();
    for (const c of records) {
      const acctName = (c as unknown as { Account?: { Name?: string } }).Account?.Name ?? 'Unknown';
      if (!map.has(c.AccountId)) {
        map.set(c.AccountId, { accountId: c.AccountId, accountName: acctName, cases: [] });
      }
      map.get(c.AccountId)!.cases.push(c);
    }
    return Array.from(map.values());
  }

  // ─── Tasks / Activities ───────────────────────────────────────────────

  async getRecentTasks(accountId: string, daysBack = 30): Promise<SalesforceTask[]> {
    assertSfId(accountId, 'Account ID');
    const since = isoDate(-daysBack);
    const fields = `Id, WhatId, WhoId, OwnerId, Owner.Name, Subject, Description,
             Status, Priority, ActivityDate, Type, CreatedDate,
             CallType, CallDurationInSeconds`;
    const dateFilter = `CreatedDate >= ${since}T00:00:00Z`;

    // Salesforce SOQL does not allow semi-joins combined with OR.
    // Run three separate queries and merge in code.
    const [acctTasks, oppTasks, contactTasks] = await Promise.all([
      this.query<SalesforceTask>(`
        SELECT ${fields} FROM Task
        WHERE WhatId = '${accountId}' AND ${dateFilter}
        ORDER BY CreatedDate DESC LIMIT 50
      `),
      this.query<SalesforceTask>(`
        SELECT ${fields} FROM Task
        WHERE WhatId IN (SELECT Id FROM Opportunity WHERE AccountId = '${accountId}')
          AND ${dateFilter}
        ORDER BY CreatedDate DESC LIMIT 30
      `).catch(() => [] as SalesforceTask[]),
      this.query<SalesforceTask>(`
        SELECT ${fields} FROM Task
        WHERE WhoId IN (SELECT Id FROM Contact WHERE AccountId = '${accountId}')
          AND WhatId = null AND ${dateFilter}
        ORDER BY CreatedDate DESC LIMIT 30
      `).catch(() => [] as SalesforceTask[]),
    ]);

    const seen = new Set<string>();
    return [...acctTasks, ...oppTasks, ...contactTasks]
      .filter((t) => { if (seen.has(t.Id)) return false; seen.add(t.Id); return true; })
      .sort((a, b) => b.CreatedDate.localeCompare(a.CreatedDate));
  }

  async createTask(params: {
    whatId: string;
    whoId?: string;
    subject: string;
    description: string;
    type: string;
    status?: string;
    activityDate?: string;
  }): Promise<string> {
    assertSfId(params.whatId, 'Account ID');
    if (params.whoId) assertSfId(params.whoId, 'Contact ID');

    const conn = await this.getConnection();
    const result = await conn.sobject('Task').create({
      WhatId:       params.whatId,
      WhoId:        params.whoId,
      Subject:      params.subject,
      Description:  params.description,
      Type:         params.type,
      Status:       params.status ?? 'Completed',
      ActivityDate: params.activityDate ?? isoDate(0),
    });

    const single = Array.isArray(result) ? result[0] : result;
    if (!single.success) {
      throw new Error(`Failed to create Task: ${JSON.stringify(single.errors)}`);
    }
    return single.id;
  }

  /** Public pass-through for ad-hoc SOQL queries in tool handlers */
  async rawQuery<T>(soql: string): Promise<T[]> {
    return this.query<T>(soql);
  }

  /** Update a single Salesforce record by ID */
  async updateRecord(objectType: string, id: string, fields: Record<string, unknown>): Promise<void> {
    assertSfId(id, `${objectType} ID`);
    const conn = await this.getConnection();
    const result = await conn.sobject(objectType).update({ Id: id, ...fields });
    const single = Array.isArray(result) ? result[0] : result;
    if (!single.success) {
      throw new Error(`Failed to update ${objectType} ${id}: ${JSON.stringify(single.errors)}`);
    }
  }

  /** Create a single Salesforce record, return the new record ID */
  async createRecord(objectType: string, fields: Record<string, unknown>): Promise<string> {
    const conn = await this.getConnection();
    const result = await conn.sobject(objectType).create(fields);
    const single = Array.isArray(result) ? result[0] : result;
    if (!single.success) {
      throw new Error(`Failed to create ${objectType}: ${JSON.stringify(single.errors)}`);
    }
    return single.id;
  }
}

export const salesforceService = new SalesforceService();
