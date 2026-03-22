// ─────────────────────────────────────────────────────────────────────────────
// Prophet Sentiment Engine
// Mines ZVC Zoom AI summaries for tone signals, scores each call,
// calculates trend, and surfaces actionable intelligence.
// ─────────────────────────────────────────────────────────────────────────────

// ── Signal Libraries ─────────────────────────────────────────────────────────

const POSITIVE_KEYWORDS = [
  'love it', 'love the', 'love working', 'great results', 'seeing results',
  'more leads', 'more patients', 'more calls', 'more consultations',
  'excited', 'impressed', 'thrilled', 'fantastic', 'excellent', 'amazing',
  'happy with', 'pleased', 'satisfied', 'grateful', 'thank you',
  'working well', 'doing well', 'improved', 'increasing', 'up significantly',
  'great job', 'great work', 'awesome', 'worth it', 'recommend',
  'referral', 'referred', 'positive', 'winning', 'dominating',
  'number one', 'ranking higher', 'better than', 'ahead of',
];

const WARNING_KEYWORDS = [
  "haven't seen", 'not seeing', 'not sure', 'not convinced', 'not certain',
  'disappointed', 'concerned', 'worried', 'expected more', 'below expectations',
  'frustrat', 'slow', 'bit slow', 'not much', 'not a lot', 'not enough',
  'questioning', 'wonder if', 'hard to tell', 'not obvious', 'unclear',
  'mixed', 'could be better', 'waiting', 'still waiting', 'takes too long',
  'not happy', 'unhappy', 'difficult', 'challenging', 'struggle',
  'another agency', 'other company', 'other option',
];

const CRITICAL_KEYWORDS = [
  'cancel', 'cancellation', 'cancelling', 'pause', 'pausing', 'put on hold',
  'stop the', 'stopping', 'terminate', 'end the contract', 'end our contract',
  'competitor', 'switching', 'switch to', 'going with', 'signed with',
  'not worth', 'waste of', 'waste of money', 'refund', 'money back',
  'very disappointed', 'extremely disappointed', 'furious', 'angry',
  'done with', 'terrible', 'worst', 'zero results', 'no results',
  'nothing is working', 'not working at all', 'complete failure',
  'lawsuit', 'attorney', 'fraud',
];

// PDM-specific competitor names (update as needed)
const COMPETITOR_NAMES = [
  'patient news', 'hibu', 'wix', 'squarespace', 'localiq', 'scorpion',
  'weave', 'birdeye', 'podium', 'dental intelligence', 'solutionreach',
  'recall max', 'carestream', 'patientpop', 'nexhealth', 'zocdoc',
  'google ads', 'meta ads', 'facebook ads',
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SentimentSignal {
  keyword: string;
  type: 'positive' | 'warning' | 'critical';
  context: string;
}

export interface CallSentiment {
  date: string;
  subject: string;
  callType: 'meeting' | 'call';
  score: number;           // 0–100
  signals: SentimentSignal[];
  snippet: string;         // first 200 chars of summary
  doctorOnCall?: boolean;
}

export interface SentimentAnalysis {
  overallScore: number;
  overallLabel: 'Positive' | 'Neutral' | 'Concerning' | 'Critical' | 'Unknown';
  overallEmoji: string;
  trend: 'Improving' | 'Stable' | 'Declining' | 'Unknown';
  trendEmoji: string;
  callBreakdown: CallSentiment[];
  topCriticalSignals: SentimentSignal[];
  topWarningSignals: SentimentSignal[];
  positiveCount: number;
  warningCount: number;
  criticalCount: number;
  competitorMentions: string[];
  hasAlert: boolean;       // true if Declining or Critical — surface in top alerts
}

// ── Core Scorer ───────────────────────────────────────────────────────────────

function scoreText(text: string): { score: number; signals: SentimentSignal[] } {
  const lower = text.toLowerCase();
  const signals: SentimentSignal[] = [];
  const matched = new Set<string>(); // prevent double-counting same keyword
  let score = 50;

  for (const kw of CRITICAL_KEYWORDS) {
    if (matched.has(kw)) continue;
    const idx = lower.indexOf(kw);
    if (idx !== -1) {
      matched.add(kw);
      const start = Math.max(0, idx - 50);
      const end   = Math.min(text.length, idx + kw.length + 50);
      signals.push({ keyword: kw, type: 'critical', context: `...${text.slice(start, end).trim()}...` });
      score -= 15;
    }
  }

  for (const kw of WARNING_KEYWORDS) {
    if (matched.has(kw)) continue;
    const idx = lower.indexOf(kw);
    if (idx !== -1) {
      matched.add(kw);
      const start = Math.max(0, idx - 50);
      const end   = Math.min(text.length, idx + kw.length + 50);
      signals.push({ keyword: kw, type: 'warning', context: `...${text.slice(start, end).trim()}...` });
      score -= 7;
    }
  }

  for (const kw of POSITIVE_KEYWORDS) {
    if (matched.has(kw)) continue;
    const idx = lower.indexOf(kw);
    if (idx !== -1) {
      matched.add(kw);
      const start = Math.max(0, idx - 50);
      const end   = Math.min(text.length, idx + kw.length + 50);
      signals.push({ keyword: kw, type: 'positive', context: `...${text.slice(start, end).trim()}...` });
      score += 6;
    }
  }

  return { score: Math.max(0, Math.min(100, score)), signals };
}

function detectCompetitors(text: string): string[] {
  const lower = text.toLowerCase();
  return COMPETITOR_NAMES.filter((name) => lower.includes(name));
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function analyzeSentiment(
  calls: Array<{
    date: string;
    subject: string;
    callType: 'meeting' | 'call';
    summary: string;
    doctorOnCall?: boolean;
  }>
): SentimentAnalysis {
  if (calls.length === 0) {
    return {
      overallScore: 50, overallLabel: 'Unknown', overallEmoji: '❓',
      trend: 'Unknown', trendEmoji: '❓',
      callBreakdown: [], topCriticalSignals: [], topWarningSignals: [],
      positiveCount: 0, warningCount: 0, criticalCount: 0,
      competitorMentions: [], hasAlert: false,
    };
  }

  // Score each call (most recent first)
  const callBreakdown: CallSentiment[] = calls.map((c) => {
    const { score, signals } = scoreText(c.summary);
    return {
      date:        c.date,
      subject:     c.subject,
      callType:    c.callType,
      score,
      signals,
      snippet:     c.summary.slice(0, 220).replace(/\s+/g, ' ').trim() +
                   (c.summary.length > 220 ? '...' : ''),
      doctorOnCall: c.doctorOnCall,
    };
  });

  // Weighted overall score — most recent calls count more
  const weights    = callBreakdown.map((_, i) => callBreakdown.length - i);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const overallScore = Math.round(
    callBreakdown.reduce((sum, call, i) => sum + call.score * weights[i], 0) / totalWeight
  );

  // Overall label
  let overallLabel: SentimentAnalysis['overallLabel'];
  let overallEmoji: string;
  if (overallScore >= 65)      { overallLabel = 'Positive';    overallEmoji = '😊'; }
  else if (overallScore >= 48) { overallLabel = 'Neutral';     overallEmoji = '😐'; }
  else if (overallScore >= 32) { overallLabel = 'Concerning';  overallEmoji = '😟'; }
  else                         { overallLabel = 'Critical';    overallEmoji = '🚨'; }

  // Trend — compare most recent to average of prior calls
  let trend: SentimentAnalysis['trend'] = 'Unknown';
  let trendEmoji = '❓';
  if (callBreakdown.length >= 2) {
    const recentScore = callBreakdown[0].score;
    const olderAvg    = callBreakdown.slice(1).reduce((s, c) => s + c.score, 0) /
                        (callBreakdown.length - 1);
    const delta = recentScore - olderAvg;
    if (delta >= 10)       { trend = 'Improving'; trendEmoji = '📈'; }
    else if (delta <= -10) { trend = 'Declining';  trendEmoji = '📉'; }
    else                   { trend = 'Stable';     trendEmoji = '➡️'; }
  }

  // Aggregate signals
  const allSignals      = callBreakdown.flatMap((c) => c.signals);
  const criticalSignals = allSignals.filter((s) => s.type === 'critical');
  const warningSignals  = allSignals.filter((s) => s.type === 'warning');
  const positiveSignals = allSignals.filter((s) => s.type === 'positive');

  // Competitor mentions across all calls
  const competitorMentions = [
    ...new Set(calls.flatMap((c) => detectCompetitors(c.summary))),
  ];

  const hasAlert = trend === 'Declining' ||
                   overallLabel === 'Critical' ||
                   overallLabel === 'Concerning' ||
                   criticalSignals.length > 0 ||
                   competitorMentions.length > 0;

  return {
    overallScore,
    overallLabel,
    overallEmoji,
    trend,
    trendEmoji,
    callBreakdown,
    topCriticalSignals: criticalSignals.slice(0, 3),
    topWarningSignals:  warningSignals.slice(0, 3),
    positiveCount: positiveSignals.length,
    warningCount:  warningSignals.length,
    criticalCount: criticalSignals.length,
    competitorMentions,
    hasAlert,
  };
}

// ── Product Mention Analysis ──────────────────────────────────────────────────

export interface ProductMention {
  product: string;
  isActive: boolean;         // client currently has this service
  callCount: number;         // number of calls where it was mentioned
  lastMentionDate: string;
  sentiment: 'positive' | 'neutral' | 'concern' | 'risk';
  snippets: string[];        // up to 2 context excerpts
}

export interface ProductMentionAnalysis {
  mentioned: ProductMention[];
  silent: string[];          // active services with zero mentions in 90 days
  upsellSignals: ProductMention[];  // not active + mentioned positively
}

export function analyzeProductMentions(
  calls: Array<{ date: string; summary: string }>,
  activeProducts: string[],
  productKeywords: Record<string, string[]>
): ProductMentionAnalysis {
  const lower = (s: string) => s.toLowerCase();
  const activeSet = new Set(activeProducts.map(lower));

  const mentioned: ProductMention[] = [];
  const silent: string[] = [];

  for (const [product, keywords] of Object.entries(productKeywords)) {
    const matchingCalls: Array<{ date: string; snippet: string; sentimentScore: number }> = [];

    for (const call of calls) {
      const text = call.summary;
      const ltext = lower(text);
      let found = false;

      for (const kw of keywords) {
        const idx = ltext.indexOf(kw.toLowerCase());
        if (idx === -1) continue;

        // Extract ±120 chars of context around the keyword
        const start   = Math.max(0, idx - 120);
        const end     = Math.min(text.length, idx + kw.length + 120);
        const snippet = `...${text.slice(start, end).trim()}...`;

        // Score the context window for sentiment
        const contextLower = ltext.slice(Math.max(0, idx - 120), Math.min(ltext.length, idx + kw.length + 120));
        let ctxScore = 0;
        for (const ck of CRITICAL_KEYWORDS)  { if (contextLower.includes(ck)) { ctxScore -= 3; break; } }
        for (const wk of WARNING_KEYWORDS)   { if (contextLower.includes(wk)) { ctxScore -= 1; break; } }
        for (const pk of POSITIVE_KEYWORDS)  { if (contextLower.includes(pk)) { ctxScore += 1; break; } }

        matchingCalls.push({ date: call.date, snippet, sentimentScore: ctxScore });
        found = true;
        break; // one match per call per product is enough
      }
      void found;
    }

    const isActive = activeSet.has(lower(product));

    if (matchingCalls.length === 0) {
      // Only flag silence for active services
      if (isActive) silent.push(product);
      continue;
    }

    // Aggregate sentiment
    const totalScore = matchingCalls.reduce((s, c) => s + c.sentimentScore, 0);
    let sentiment: ProductMention['sentiment'];
    if (totalScore <= -2)      sentiment = 'risk';
    else if (totalScore < 0)   sentiment = 'concern';
    else if (totalScore === 0) sentiment = 'neutral';
    else                       sentiment = 'positive';

    // Most recent date first
    const sorted = matchingCalls.sort((a, b) => b.date.localeCompare(a.date));

    mentioned.push({
      product,
      isActive,
      callCount: matchingCalls.length,
      lastMentionDate: sorted[0].date,
      sentiment,
      snippets: sorted.slice(0, 2).map((c) => c.snippet),
    });
  }

  // Sort: risks first, then concerns, then neutral, then positive
  const order = { risk: 0, concern: 1, neutral: 2, positive: 3 };
  mentioned.sort((a, b) => order[a.sentiment] - order[b.sentiment]);

  const upsellSignals = mentioned.filter((m) => !m.isActive && m.sentiment === 'positive');

  return { mentioned, silent, upsellSignals };
}

export function formatProductMentionsSection(
  analysis: ProductMentionAnalysis,
  activeProducts: string[]
): string[] {
  const lines: string[] = [];

  const hasMentions   = analysis.mentioned.length > 0;
  const hasSilent     = analysis.silent.length > 0;
  const hasUpsell     = analysis.upsellSignals.length > 0;

  if (!hasMentions && !hasSilent) return lines;

  lines.push('## 📋 Services Discussed in Recent Calls');

  if (hasMentions) {
    const activeMentioned   = analysis.mentioned.filter((m) => m.isActive);
    const inactiveMentioned = analysis.mentioned.filter((m) => !m.isActive);

    if (activeMentioned.length > 0) {
      lines.push('**Active Services Mentioned:**');
      for (const m of activeMentioned) {
        const icon = m.sentiment === 'risk'     ? '🔴'
                   : m.sentiment === 'concern'  ? '⚠️'
                   : m.sentiment === 'positive' ? '✅'
                   : '➡️';
        lines.push(
          `- **${m.product}** ${icon} — ${m.callCount} call${m.callCount > 1 ? 's' : ''} | ` +
          `Last: ${m.lastMentionDate}`
        );
        if (m.snippets[0]) lines.push(`  *"${m.snippets[0]}"*`);
      }
      lines.push('');
    }

    if (inactiveMentioned.length > 0 && hasUpsell) {
      lines.push('**💡 Upsell Signals — Client Mentioned Services They Don\'t Have:**');
      for (const m of inactiveMentioned) {
        lines.push(`- **${m.product}** — mentioned positively in ${m.callCount} call${m.callCount > 1 ? 's' : ''} but not a current service`);
        if (m.snippets[0]) lines.push(`  *"${m.snippets[0]}"*`);
      }
      lines.push('');
    }
  }

  if (hasSilent) {
    lines.push(
      `**🔇 Active Services Not Mentioned (90 days):** ${analysis.silent.join(', ')}`
    );
    lines.push('*These services haven\'t come up in recent calls — consider proactively reviewing results with the client.*');
    lines.push('');
  }

  void activeProducts; // used by caller for context
  return lines;
}

// ── Formatter ─────────────────────────────────────────────────────────────────

export function formatSentimentSection(analysis: SentimentAnalysis): string[] {
  const lines: string[] = [];

  if (analysis.overallLabel === 'Unknown') {
    lines.push('## 🎭 Call Sentiment Analysis');
    lines.push('No Zoom AI summaries found for this account.');
    return lines;
  }

  lines.push(
    `## 🎭 Call Sentiment Analysis — Last ${analysis.callBreakdown.length} Call(s)`
  );
  lines.push(
    `**Overall:** ${analysis.overallEmoji} ${analysis.overallLabel} (${analysis.overallScore}/100) | ` +
    `**Trend:** ${analysis.trendEmoji} ${analysis.trend} | ` +
    `✅ ${analysis.positiveCount} positive · ⚠️ ${analysis.warningCount} warning · 🚨 ${analysis.criticalCount} critical signals`
  );
  lines.push('');

  // Competitor mentions — highest priority
  if (analysis.competitorMentions.length > 0) {
    lines.push(`🚨 **Competitor Mentions Detected:** ${analysis.competitorMentions.join(', ')}`);
    lines.push('');
  }

  // Critical signals
  if (analysis.topCriticalSignals.length > 0) {
    lines.push('**🚨 Critical Signals:**');
    for (const s of analysis.topCriticalSignals) {
      lines.push(`- "${s.keyword}" — ${s.context}`);
    }
    lines.push('');
  }

  // Warning signals
  if (analysis.topWarningSignals.length > 0) {
    lines.push('**⚠️ Warning Signals:**');
    for (const s of analysis.topWarningSignals) {
      lines.push(`- "${s.keyword}" — ${s.context}`);
    }
    lines.push('');
  }

  // Call-by-call breakdown
  lines.push('**Call-by-Call:**');
  for (const call of analysis.callBreakdown) {
    const typeIcon   = call.callType === 'meeting' ? '📹' : '📞';
    const scoreIcon  = call.score >= 65 ? '🟢' : call.score >= 45 ? '🟡' : '🔴';
    const doctorBadge = call.doctorOnCall ? ' 🩺' : '';
    const critCount  = call.signals.filter((s) => s.type === 'critical').length;
    const warnCount  = call.signals.filter((s) => s.type === 'warning').length;
    const posCount   = call.signals.filter((s) => s.type === 'positive').length;
    const signalStr  = [
      critCount > 0 ? `🚨${critCount}` : '',
      warnCount > 0 ? `⚠️${warnCount}` : '',
      posCount  > 0 ? `✅${posCount}`  : '',
    ].filter(Boolean).join(' ');

    lines.push(
      `- ${call.date} ${typeIcon}${doctorBadge} **${call.score}/100** ${scoreIcon}` +
      `${signalStr ? ` ${signalStr}` : ''} — ${call.snippet}`
    );
  }

  return lines;
}
