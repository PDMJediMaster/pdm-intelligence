// ─── Salesforce SObjects ───────────────────────────────────────────────────

export interface SalesforceAccount {
  Id: string;
  Name: string;
  Phone?: string;
  Website?: string;
  BillingCity?: string;
  BillingState?: string;
  OwnerId: string;
  Owner?: { Name: string; Email?: string };
  // Core status
  Status__c?: string;           // Marketing status: Active, Renewal, Non Renewing, etc.
  TCI_Status__c?: string;       // TCI membership: Member, Non-Member, Alumni
  TCI_Enrolled__c?: boolean;
  // Specialist lookups
  TCI_Trainer__c?: string;
  TCI_Trainer__r?: { Name: string };
  PPC_Specialist__c?: string;
  PPC_Specialist__r?: { Name: string };
  Social_Specialist__c?: string;
  Social_Specialist__r?: { Name: string };
  SEO_Rep__c?: string;
  SEO_Rep__r?: { Name: string };
  // Account Manager
  Account_Manager_Lookup__c?: string;
  Account_Manager_Lookup__r?: { Name: string; Email?: string };
  Account_Manager_Email__c?: string;
  // Financial
  Management_Fee__c?: number;
  Total_Monthly_Recurring_Amount__c?: number;
  Budget__c?: number;
  SEO_Budget__c?: number;
  Social_Budget__c?: number;
  // Contract
  Contract_End_Date__c?: string;       // Formula pointing to Contract_Renewal_Date__c — keep
  Contract_Renewal_Date__c?: string;   // Authoritative renewal date
  // Engagement & health signals
  LastActivityDate?: string;
  Next_Alignment_Call__c?: string;
  AM_Spoke_to_Doctor__c?: string;      // Date of last doctor contact
  Engagement_Status__c?: string;
  // Churn signals
  Cancellation_or_Pause_Request_Date__c?: string;
  Flagged_Status__c?: boolean;
  Delinquent__c?: boolean;
  Upsell_Opportunity__c?: string;
  // Account intelligence
  Account_Intel__c?: string;           // Rich Text Area(2000) — AM notes
  Tier__c?: string;
  Specialty__c?: string;               // Multi-select picklist
  Phase__c?: string;                   // Multi-select picklist
  NumberOfEmployees?: number;
}

export interface SalesforceContact {
  Id: string;
  AccountId: string;
  FirstName?: string;
  LastName: string;
  Name: string;
  Title?: string;
  Email?: string;
  Phone?: string;
  MobilePhone?: string;
  // PDM custom fields
  Doctor__c?: boolean;
  Primary_Contact__c?: boolean;
  Contact_Type__c?: string;  // Doctor / Office Manager / etc.
  Status__c?: string;        // Active / Inactive
}

export interface SalesforceOpportunity {
  Id: string;
  AccountId: string;
  Account?: { Name: string; Owner?: { Name: string } };
  Name: string;
  StageName: string;
  CloseDate: string;
  Amount?: number;
  Type?: string;
  Probability?: number;
  IsClosed: boolean;
  IsWon: boolean;
  CreatedDate: string;
  Description?: string;
}

export interface SalesforceOpportunityLineItem {
  Id: string;
  OpportunityId: string;
  Name?: string;
  Product2Id?: string;
  Product2?: { Name: string; Family?: string };
  Quantity?: number;
  TotalPrice?: number;
  UnitPrice?: number;
}

export interface SalesforceCase {
  Id: string;
  AccountId: string;
  Account?: { Name: string };
  CaseNumber: string;
  Subject: string;
  Description?: string;
  Status: string;
  Priority: string;
  Origin?: string;
  Type?: string;
  Owner?: { Name: string };
  CreatedDate: string;
  ClosedDate?: string;
  LastModifiedDate: string;
  IsEscalated?: boolean;
}

export interface SalesforceTask {
  Id: string;
  WhatId?: string;
  WhoId?: string;
  OwnerId: string;
  Owner?: { Name: string };
  Subject: string;
  Description?: string;
  Status: string;
  Priority?: string;
  ActivityDate?: string;
  Type?: string;
  CreatedDate: string;
  CallType?: string;
  CallDurationInSeconds?: number;
  Spoke_with_Doctor__c?: boolean;
}

export interface SalesforceAsset {
  Id: string;
  AccountId: string;
  Name: string;
  Status: string;                      // Installed, Purchased, Shipped, etc.
  Product2Id?: string;
  Product2?: { Name: string; Family?: string };
  InstallDate?: string;
  UsageEndDate?: string;
  Quantity?: number;
  Price?: number;
  Description?: string;
}

export interface SalesforceBusinessObjective {
  Id: string;
  Account__c: string;
  Name: string;
  Objective__c?: string;
  Status__c?: string;
  Target_Date__c?: string;
  Notes__c?: string;
  CreatedDate: string;
}

export interface SalesforceRefundRequest {
  Id: string;
  Account__c: string;
  Name: string;
  Status__c?: string;
  Refund_Amount__c?: number;
  Reason__c?: string;
  CreatedDate: string;
}

export interface SalesforceChangeOrder {
  Id: string;
  Account__c: string;
  Name: string;
  Type__c?: string;        // Cancellation, Pause, Upgrade, Downgrade, etc.
  Status__c?: string;
  Effective_Date__c?: string;
  Cancellation_Date__c?: string;
  Reason__c?: string;
  CreatedDate: string;
}

// ─── Domain Models ─────────────────────────────────────────────────────────

export interface HealthScore {
  overall: number;       // 0–100 composite
  engagement: number;    // 0–100 raw engagement score
  cases: number;         // 0–100 raw case health score
  renewal: number;       // 0–100 raw renewal score
  rating: 'Excellent' | 'Good' | 'Fair' | 'At Risk' | 'Critical';
  breakdown: {
    engagementDetails: string;
    casesDetails: string;
    renewalDetails: string;
  };
}

export interface AccountHealthReport {
  account: SalesforceAccount;
  healthScore: HealthScore;
  recentCases: SalesforceCase[];
  openCases: SalesforceCase[];
  recentActivity: SalesforceTask[];
  activeProducts: string[];
  contacts: SalesforceContact[];
  renewalOpportunity?: SalesforceOpportunity;
  generatedAt: string;
}

export interface PreCallBrief {
  account: SalesforceAccount;
  contacts: SalesforceContact[];
  activeProducts: string[];
  recentCases: SalesforceCase[];
  recentActivity: SalesforceTask[];
  healthScore: HealthScore;
  renewalInfo?: {
    opportunityName: string;
    closeDate: string;
    amount?: number;
    daysUntilClose: number;
  };
  suggestedTalkingPoints: string[];
}

export interface WeeklySynopsisItem {
  accountId: string;
  accountName: string;
  ownerName: string;
  data: unknown;
}

export interface RenewalPipelineItem {
  accountId: string;
  accountName: string;
  ownerName: string;
  opportunityId: string;
  opportunityName: string;
  closeDate: string;
  daysUntilClose: number;
  amount?: number;
  stage: string;
}

export interface UpsellOpportunity {
  accountId: string;
  accountName: string;
  ownerName: string;
  currentProducts: string[];
  missingProducts: string[];
  reason: string;
}

export interface ChurnRiskAccount {
  accountId: string;
  accountName: string;
  ownerName: string;
  healthScore: number;
  rating: string;
  riskFactors: string[];
}
