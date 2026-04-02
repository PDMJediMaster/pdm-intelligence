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
  [PDM_PRODUCTS.VIDEO_PHOTOGRAPHY]: ['video', 'photo', 'photography', 'videography', 'media production', 'momentum'],
  [PDM_PRODUCTS.PPC]:               ['ppc', 'pay per click', 'adwords', 'google ads', 'paid search', 'paid ads', 'google ad'],
  [PDM_PRODUCTS.SOCIAL_MEDIA]:      ['social', 'facebook', 'instagram', 'social media'],
  [PDM_PRODUCTS.SEO]:               ['seo', 'search engine optimization', 'organic search'],
  [PDM_PRODUCTS.TCI_MENTORSHIP]:    ['tci mentorship', 'mentorship', 'tci program', 'tci coaching', 'tci monthly', 'closing institute monthly tuition', 'closing institute team coaching'],
  [PDM_PRODUCTS.TCI_EVENTS]:        ['tci event', 'tci summit', 'tci live', 'event ticket', 'growth conference', 'bootcamp', 'fabc', 'fagc'],
  [PDM_PRODUCTS.TRADITIONAL_MEDIA]: ['traditional', 'print', 'radio', 'tv', 'television', 'direct mail', 'billboard', 'mailer'],
};

// Product2.Family → PDM Product mapping (from Salesforce Product catalog)
export const FAMILY_TO_PRODUCT: Record<string, PDMProduct> = {
  'Web':              PDM_PRODUCTS.WEB_DEVELOPMENT,
  'Video':            PDM_PRODUCTS.VIDEO_PHOTOGRAPHY,
  'Marketing':        PDM_PRODUCTS.PPC, // Marketing family needs keyword sub-match (PPC vs SEO vs Social)
  'Graphics':         PDM_PRODUCTS.WEB_DEVELOPMENT, // Graphic design = Phase 1 foundation
  'Traditional Media': PDM_PRODUCTS.TRADITIONAL_MEDIA,
  'TCI':              PDM_PRODUCTS.TCI_MENTORSHIP,
  'TCI Tickets':      PDM_PRODUCTS.TCI_EVENTS,
};

// ─── Product Classification for Upsell Engine ────────────────────────────
// Each PDM product has a lifecycle type that determines how it's scored in upsell analysis.

export type ProductLifecycle = 'permanent' | 'refreshable' | 'recurring' | 'recurring_cancellable' | 'event';

export interface ProductClassification {
  lifecycle: ProductLifecycle;
  /** Products that can be re-sold after this many months become "Nurture" */
  nurtureAfterMonths?: number;
  /** Products that can be re-sold after this many months become "Upsell" */
  upsellAfterMonths?: number;
  /** Human-readable lifecycle description */
  description: string;
}

export const PRODUCT_CLASSIFICATION: Record<PDMProduct, ProductClassification> = {
  [PDM_PRODUCTS.WEB_DEVELOPMENT]: {
    lifecycle: 'permanent',
    nurtureAfterMonths: 36, // 3 years — start planting the seed
    upsellAfterMonths: 48,  // 4 years — website is likely outdated
    description: 'One-time build. Refresh after 3-4+ years.',
  },
  [PDM_PRODUCTS.VIDEO_PHOTOGRAPHY]: {
    lifecycle: 'refreshable',
    nurtureAfterMonths: 18, // 18 months — content getting stale
    upsellAfterMonths: 30,  // 2.5 years — definitely needs fresh content
    description: 'Content ages. New staff, new patients, new procedures — refresh every 18-30 months.',
  },
  [PDM_PRODUCTS.PPC]: {
    lifecycle: 'recurring',
    description: 'Monthly recurring. Either active or a gap.',
  },
  [PDM_PRODUCTS.SOCIAL_MEDIA]: {
    lifecycle: 'recurring',
    description: 'Monthly recurring. Either active or a gap.',
  },
  [PDM_PRODUCTS.SEO]: {
    lifecycle: 'recurring',
    description: 'Monthly recurring. Either active or a gap.',
  },
  [PDM_PRODUCTS.TCI_MENTORSHIP]: {
    lifecycle: 'recurring_cancellable',
    nurtureAfterMonths: 12, // 12 months after cancel — start nurturing
    upsellAfterMonths: 18,  // 18 months after cancel — ready to re-engage
    description: 'Recurring training program. Cancelled members may re-enroll after enough time.',
  },
  [PDM_PRODUCTS.TCI_EVENTS]: {
    lifecycle: 'event',
    description: 'Conference ticket sales — 3 events/year (Vegas March, Dallas July, FAGC November). Always a product.',
  },
  [PDM_PRODUCTS.TRADITIONAL_MEDIA]: {
    lifecycle: 'recurring',
    description: 'Monthly recurring. Either active or a gap.',
  },
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
