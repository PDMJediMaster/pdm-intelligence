// ─── PDM Product Catalog ───────────────────────────────────────────────────

export const PDM_PRODUCTS = {
  WEB_DEVELOPMENT:  'Web Development',
  VIDEO_PHOTOGRAPHY: 'Video & Photography',
  PPC:              'PPC',
  SOCIAL_MEDIA:     'Social Media',
  SEO:              'SEO',
  TCI_MENTORSHIP:   'TCI Mentorship',
  TCI_EVENTS:       'TCI Events',
  TRADITIONAL_MEDIA: 'Traditional Media',
} as const;

export type PDMProduct = (typeof PDM_PRODUCTS)[keyof typeof PDM_PRODUCTS];
export const PDM_PRODUCT_LIST: PDMProduct[] = Object.values(PDM_PRODUCTS);

// Products we can reliably detect from Salesforce data (budget fields + TCI flags).
// Phase 1 one-time services (Web Development, Video, Traditional Media) and
// TCI Events are excluded — no budget field tracks whether an account has them.
export const DETECTABLE_PRODUCTS: PDMProduct[] = [
  PDM_PRODUCTS.PPC,
  PDM_PRODUCTS.SEO,
  PDM_PRODUCTS.SOCIAL_MEDIA,
  PDM_PRODUCTS.TCI_MENTORSHIP,
];

export const PDM_PRODUCT_PRICING: Record<PDMProduct, { monthly?: number; notes: string }> = {
  [PDM_PRODUCTS.WEB_DEVELOPMENT]:   { notes: 'Custom pricing' },
  [PDM_PRODUCTS.VIDEO_PHOTOGRAPHY]: { notes: 'Custom pricing' },
  [PDM_PRODUCTS.PPC]:               { notes: 'Management fee + ad spend' },
  [PDM_PRODUCTS.SOCIAL_MEDIA]:      { notes: 'Custom pricing' },
  [PDM_PRODUCTS.SEO]:               { notes: 'Custom pricing' },
  [PDM_PRODUCTS.TCI_MENTORSHIP]:    { monthly: 3500, notes: '$3,500/month' },
  [PDM_PRODUCTS.TCI_EVENTS]:        { notes: 'Event-based pricing' },
  [PDM_PRODUCTS.TRADITIONAL_MEDIA]: { notes: 'Custom pricing' },
};

// Keywords used to match product names from Salesforce Opportunity / Product records
export const PRODUCT_KEYWORDS: Record<PDMProduct, string[]> = {
  [PDM_PRODUCTS.WEB_DEVELOPMENT]:   ['web', 'website', 'development', 'design', 'hosting'],
  [PDM_PRODUCTS.VIDEO_PHOTOGRAPHY]: ['video', 'photo', 'photography', 'videography', 'media production'],
  [PDM_PRODUCTS.PPC]:               ['ppc', 'pay per click', 'adwords', 'google ads', 'paid search', 'paid ads', 'google ad'],
  [PDM_PRODUCTS.SOCIAL_MEDIA]:      ['social', 'facebook', 'instagram', 'social media'],
  [PDM_PRODUCTS.SEO]:               ['seo', 'search engine optimization', 'organic search'],
  [PDM_PRODUCTS.TCI_MENTORSHIP]:    ['tci mentorship', 'mentorship', 'tci program', 'tci coaching', 'tci monthly'],
  [PDM_PRODUCTS.TCI_EVENTS]:        ['tci event', 'tci summit', 'tci live', 'event ticket'],
  [PDM_PRODUCTS.TRADITIONAL_MEDIA]: ['traditional', 'print', 'radio', 'tv', 'television', 'direct mail', 'billboard', 'mailer'],
};

// ─── Health Score Configuration ────────────────────────────────────────────

export const HEALTH_SCORE_WEIGHTS = {
  ENGAGEMENT: 0.40,
  CASES:      0.30,
  RENEWAL:    0.30,
} as const;

export const HEALTH_SCORE_THRESHOLDS = {
  EXCELLENT: 80,
  GOOD:      65,
  FAIR:      50,
  AT_RISK:   35,
  // < 35 = Critical
} as const;

// ─── Engagement Scoring (out of 100) ──────────────────────────────────────
// Calls:    15 pts each, max 4 calls  (60 pts)
// Emails:    5 pts each, max 4 emails (20 pts)
// Meetings: 20 pts each, max 1 meeting (20 pts)
export const ENGAGEMENT_SCORING = {
  CALL_POINTS:    15,
  CALL_MAX:       60,
  EMAIL_POINTS:    5,
  EMAIL_MAX:      20,
  MEETING_POINTS: 20,
  MEETING_MAX:    20,
  LOOKBACK_DAYS:  30,
} as const;

// ─── Case Scoring Deductions ───────────────────────────────────────────────
export const CASE_SCORING = {
  HIGH_PRIORITY_DEDUCTION:    30,
  MEDIUM_PRIORITY_DEDUCTION:  15,
  LOW_PRIORITY_DEDUCTION:      5,
  STALE_CASE_DAYS:            14,
  STALE_CASE_DEDUCTION:       10,
} as const;

// ─── Org / Query Defaults ──────────────────────────────────────────────────

export const RENEWAL_WARNING_DAYS   = 90;
export const CHURN_RISK_THRESHOLD   = 50;
export const DEFAULT_RENEWAL_DAYS   = 90;
export const DEFAULT_CHURN_LIMIT    = 25;
export const MAX_ACCOUNT_QUERY      = 2000;

// ─── Salesforce Custom Field API Names ────────────────────────────────────

export const SF_FIELDS = {
  ACCOUNT_STATUS:    'Status__c',
  TCI_STATUS:        'TCI_Status__c',
  TCI_TRAINER:       'TCI_Trainer__c',
  PPC_SPECIALIST:    'PPC_Specialist__c',
  SOCIAL_SPECIALIST: 'Social_Specialist__c',
  SEO_REP:           'SEO_Rep__c',
  MANAGEMENT_FEE:    'Management_Fee__c',
  CONTRACT_END:      'Contract_End_Date__c',
} as const;

// ─── Role Names (matches AccountBoardViewController) ─────────────────────

export const SF_ROLES = {
  DIRECTOR:      'Director of Account Management',
  TEAM_LEAD:     'Account Manager Team Lead',
  ACCOUNT_MGR:   'Account Manager',
} as const;
