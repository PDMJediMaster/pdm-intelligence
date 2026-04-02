// ─────────────────────────────────────────────────────────────────────────────
// Prophet AI Agent
//
// The reasoning layer between Telegram and Prophet tools. When the command
// router can't match a message, the AI agent takes over — using Claude to
// understand intent, pick the right tools, chain them together, and
// synthesize a response.
//
// This is what makes Prophet a personal assistant, not a command-line bot.
// "Look at my calendar today — what can you do for me?" requires reasoning.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import type { ProphetUser } from './telegram.js';

// ─── Tool Definitions for Claude ─────────────────────────────────────────────
// These are the tools Claude can call. Each maps to a real MCP handler.

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'sf_get_weekly_synopsis',
    description: 'Get the weekly synopsis for an account manager — all scheduled calls this week with health scores, MRR, churn signals, and talking points.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ownerId: { type: 'string', description: 'Salesforce User ID of the account manager' },
      },
      required: ['ownerId'],
    },
  },
  {
    name: 'sf_get_pre_call_brief',
    description: 'Get a comprehensive pre-call brief for a single account — health score, contacts, recent activity, open tickets, opportunities, business objectives, and AI talking points.',
    input_schema: {
      type: 'object' as const,
      properties: {
        accountName: { type: 'string', description: 'Name of the account (fuzzy match supported)' },
        accountId: { type: 'string', description: 'Salesforce Account ID (if known)' },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_account_health_report',
    description: 'Get a detailed health score breakdown for a single account — engagement score, case health, renewal score, risk factors, and recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        accountName: { type: 'string', description: 'Name of the account (fuzzy match supported)' },
        accountId: { type: 'string', description: 'Salesforce Account ID (if known)' },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_churn_risk_accounts',
    description: 'Get a ranked list of accounts most at risk of churning — sorted by health score, includes MRR, risk factors, and owner. Accounts with open refund or cancellation requests appear first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner_id: { type: 'string', description: 'Filter to a specific AM\'s accounts (Salesforce User ID)' },
        limit: { type: 'number', description: 'Max accounts to return (default 25)' },
        threshold: { type: 'number', description: 'Health score threshold (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_renewal_pipeline',
    description: 'Get upcoming contract renewals with health enrichment — days until renewal, MRR, health tier, risk signals.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner_id: { type: 'string', description: 'Filter to a specific AM\'s accounts' },
        days_ahead: { type: 'number', description: 'Look ahead window in days (default 90)' },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_upsell_opportunities',
    description: 'Find accounts with upsell potential — gap analysis showing which services clients don\'t have that they could add.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner_id: { type: 'string', description: 'Filter to a specific AM\'s accounts' },
        limit: { type: 'number', description: 'Max results (default 25)' },
        min_health_score: { type: 'number', description: 'Minimum health score to qualify for upsell' },
      },
      required: [],
    },
  },
  {
    name: 'sf_log_account_note',
    description: 'Log a completed Call, Email, Meeting, or Note as a Task in Salesforce linked to an Account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        accountName: { type: 'string', description: 'Name of the account' },
        accountId: { type: 'string', description: 'Salesforce Account ID' },
        subject: { type: 'string', description: 'Task subject line' },
        description: { type: 'string', description: 'Full note/description text' },
        type: { type: 'string', enum: ['Call', 'Email', 'Meeting', 'Note'], description: 'Activity type' },
        ownerId: { type: 'string', description: 'Salesforce User ID of the owner' },
      },
      required: ['description'],
    },
  },
  {
    name: 'sf_get_competitive_alerts',
    description: 'Get competitive intelligence alerts for an account — what competitors are doing, market changes, threats.',
    input_schema: {
      type: 'object' as const,
      properties: {
        accountName: { type: 'string', description: 'Name of the account' },
        accountId: { type: 'string', description: 'Salesforce Account ID' },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_am_coaching_brief',
    description: 'Get an AM coaching brief — performance metrics, account health distribution, areas for improvement, wins to celebrate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amUserId: { type: 'string', description: 'Salesforce User ID of the AM to coach' },
      },
      required: ['amUserId'],
    },
  },
  {
    name: 'sf_get_rep_pipeline_synopsis',
    description: 'Get a sales rep pipeline synopsis — active deals, stage velocity, stagnant opportunities, recommended actions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repUserId: { type: 'string', description: 'Salesforce User ID of the sales rep' },
      },
      required: ['repUserId'],
    },
  },
  {
    name: 'sf_raise_the_ghosts',
    description: 'Find dead deals and cold leads that can be revived — analyzes why they went cold and suggests re-engagement strategies.',
    input_schema: {
      type: 'object' as const,
      properties: {
        owner_id: { type: 'string', description: 'Filter to a specific rep\'s leads' },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_call_intelligence',
    description: 'Get AI call summaries from Zoom meetings and phone calls for an account — sentiment, key topics, commitments, risk signals.',
    input_schema: {
      type: 'object' as const,
      properties: {
        accountName: { type: 'string', description: 'Name of the account' },
        accountId: { type: 'string', description: 'Salesforce Account ID' },
        lookback_days: { type: 'number', description: 'Days to look back (default 90)' },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_lead_intelligence',
    description: 'Get full lead intelligence — Pardot scores, UTM data, campaign history, conversion data, and recommended approach.',
    input_schema: {
      type: 'object' as const,
      properties: {
        leadName: { type: 'string', description: 'Name of the lead' },
        leadId: { type: 'string', description: 'Salesforce Lead ID' },
      },
      required: [],
    },
  },
  {
    name: 'sf_get_renewal_proof_package',
    description: 'Assemble a renewal proof package for an account — baseline vs. current maturity, competitive position change, sentiment trend, value delivered.',
    input_schema: {
      type: 'object' as const,
      properties: {
        accountName: { type: 'string', description: 'Name of the account' },
        accountId: { type: 'string', description: 'Salesforce Account ID' },
      },
      required: [],
    },
  },
  {
    name: 'sf_clone_dashboard',
    description: 'Clone a Salesforce dashboard and all its underlying reports with find-and-replace substitutions. Perfect for event dashboards, campaign clones, quarterly duplicates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source_dashboard_id: { type: 'string', description: 'Salesforce ID of the source dashboard to clone' },
        source_dashboard_name: { type: 'string', description: 'Name of the source dashboard (fuzzy search)' },
        new_dashboard_name: { type: 'string', description: 'Name for the new dashboard' },
        substitutions: {
          type: 'array',
          description: 'Find-and-replace pairs applied to all report filters, names, and descriptions',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
            },
            required: ['find', 'replace'],
          },
        },
        target_folder: { type: 'string', description: 'Salesforce folder name for the new reports/dashboard' },
        name_suffix: { type: 'string', description: 'Suffix to append to cloned report names (e.g. "_DLS")' },
        dry_run: { type: 'boolean', description: 'If true, show what would be created without deploying' },
      },
      required: [],
    },
  },
  {
    name: 'sf_create_report',
    description: 'Create and deploy a new Salesforce report from structured parameters — columns, filters, groupings, format, date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        report_name: { type: 'string', description: 'Display name for the report (max 40 chars)' },
        report_type: { type: 'string', description: 'Salesforce report type API name' },
        folder_name: { type: 'string', description: 'Report folder name' },
        columns: { type: 'array', items: { type: 'object' }, description: 'Column definitions' },
        filters: { type: 'array', items: { type: 'object' }, description: 'Filter criteria' },
        groupings: { type: 'array', items: { type: 'object' }, description: 'Row groupings' },
        format: { type: 'string', enum: ['Tabular', 'Summary', 'Matrix'], description: 'Report format' },
        description: { type: 'string', description: 'Report description' },
        dry_run: { type: 'boolean', description: 'If true, show XML without deploying' },
      },
      required: ['report_name', 'report_type'],
    },
  },
];

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(user: ProphetUser): string {
  return `You are Prophet, the personal AI assistant for ${user.name} at Progressive Dental Marketing (PDM).

## Who You Are
You are a dedicated member of ${user.name}'s team. You protect their time, think about their priorities, anticipate their needs, and take action. You know every account in their book of business, every competitor in every market, and every signal that matters in Salesforce.

## Who ${user.name} Is
- Role: ${user.role.toUpperCase()} at Progressive Dental Marketing
- Salesforce User ID: ${user.salesforceUserId}
- PDM is a dental implant marketing agency serving dental practices across the US

## Your Personality
- Proactive: Don't just answer — suggest what they should do next
- Concise: This is Telegram on a phone. Short paragraphs, bullet points, bold headers
- Confident: You have the data. Speak with authority
- Protective: Guard their time. Flag what matters, deprioritize what doesn't
- Human: Use their first name. Be warm but professional. You're a teammate, not a robot

## What You Can Do
You have access to Prophet tools that query live Salesforce data. Use them to:
- Pull account health reports, pre-call briefs, churn risk lists
- Check renewal pipelines and upsell opportunities
- Log notes and activities to Salesforce
- Get competitive intelligence on accounts
- Research prospects and analyze markets
- Review call intelligence and sentiment
- Generate coaching briefs and pipeline synopses

## How to Respond
1. Think about what ${user.name} actually needs, not just what they literally asked
2. Call the right tools to get the data
3. Synthesize the results into a concise, actionable response
4. Always end with a suggested next action or offer to do more
5. Format for mobile: short lines, emojis for visual scanning, bold for key numbers

## Important Rules
- When calling tools that accept owner_id/ownerId, use: ${user.salesforceUserId}
- Always think about context: if they mention a client call, they probably want a brief
- If they ask about "my accounts" or "my week" — scope to their Salesforce user ID
- If they say they just left a meeting — offer to log the note
- If they mention a prospect — offer to research them
- Keep responses under 2000 characters when possible — this is a phone screen
- Never fabricate data. If a tool returns no results, say so honestly
- Today's date is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
}

// ─── Agent Execution ─────────────────────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  user: ProphetUser,
  toolHandlers: Record<string, (args: unknown) => Promise<string>>
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return 'AI agent unavailable — ANTHROPIC_API_KEY not configured. Use a direct command like "My week" or "How is [account] doing?"';
  }

  const anthropic = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: buildSystemPrompt(user),
    tools: AGENT_TOOLS,
    messages,
  });

  // Tool use loop — Claude may call multiple tools in sequence
  const MAX_ITERATIONS = 8;
  let iteration = 0;

  while (response.stop_reason === 'tool_use' && iteration < MAX_ITERATIONS) {
    iteration++;

    // Collect all tool use blocks
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    // Execute each tool call
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const handler = toolHandlers[toolUse.name];

      if (!handler) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Tool "${toolUse.name}" is not available.`,
          is_error: true,
        });
        continue;
      }

      try {
        process.stderr.write(`[Prophet Agent] Calling ${toolUse.name} (iteration ${iteration})\n`);
        const result = await handler(toolUse.input);

        // Truncate very long results to stay within context limits
        const truncated = result.length > 15000
          ? result.slice(0, 15000) + '\n\n... [truncated for brevity — key data above]'
          : result;

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: truncated,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Error: ${errMsg}`,
          is_error: true,
        });
      }
    }

    // Continue the conversation with tool results
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: buildSystemPrompt(user),
      tools: AGENT_TOOLS,
      messages,
    });
  }

  // Extract the final text response
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );

  if (textBlocks.length === 0) {
    return 'I processed your request but couldn\'t generate a response. Try asking in a different way, or use a direct command like "My week".';
  }

  return textBlocks.map(b => b.text).join('\n\n');
}
