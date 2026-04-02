// ─────────────────────────────────────────────────────────────────────────────
// Prophet Telegram Bot Service
//
// Personal AI assistant for PDM team members. Each user texts Prophet from
// their phone and gets proactive intelligence, pre-call briefs, account
// health reports, and can log notes — all via Telegram.
//
// Architecture:
//   Telegram → grammY webhook → Prophet command router → MCP tool handlers → Salesforce
//   n8n / cron → Morning Brief Engine → Telegram proactive push
// ─────────────────────────────────────────────────────────────────────────────

import { Bot, Context, InlineKeyboard, webhookCallback } from 'grammy';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { salesforceService } from './salesforce.js';
import { morningBriefEngine } from './morningBrief.js';
import { runAgent } from './aiAgent.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProphetUser {
  telegramChatId: number;
  salesforceUserId: string;
  name: string;
  role: 'am' | 'rep' | 'manager' | 'admin';
  timezone: string;           // e.g. 'America/New_York'
  morningBriefTime: string;   // e.g. '06:30' in their timezone
  morningBriefEnabled: boolean;
  registeredAt: string;       // ISO date
}

interface PendingAction {
  userId: number;
  actions: Array<{
    id: number;
    label: string;
    handler: () => Promise<string>;
  }>;
  expiresAt: number;
}

// ─── User Registry ───────────────────────────────────────────────────────────
// Maps Telegram chat IDs to Salesforce users. In production this moves to
// Redis or Postgres. For now, file-based + in-memory with env seed.

const USER_REGISTRY_PATH = new URL('../../data/telegram-users.json', import.meta.url);

let registeredUsers: Map<number, ProphetUser> = new Map();
let pendingActions: Map<number, PendingAction> = new Map();

async function loadUserRegistry(): Promise<void> {
  try {
    const fs = await import('node:fs/promises');
    const data = await fs.readFile(USER_REGISTRY_PATH, 'utf-8');
    const users: ProphetUser[] = JSON.parse(data);
    registeredUsers = new Map(users.map(u => [u.telegramChatId, u]));
    process.stderr.write(`[Prophet Telegram] Loaded ${registeredUsers.size} registered users\n`);
  } catch {
    // First run — no file yet
    registeredUsers = new Map();
    process.stderr.write(`[Prophet Telegram] No user registry found — starting fresh\n`);
  }
}

async function saveUserRegistry(): Promise<void> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.dirname(USER_REGISTRY_PATH.pathname);
  await fs.mkdir(dir, { recursive: true });
  const users = Array.from(registeredUsers.values());
  await fs.writeFile(USER_REGISTRY_PATH, JSON.stringify(users, null, 2));
}

// ─── Tool Router ─────────────────────────────────────────────────────────────
// Routes natural language commands to the right MCP tool handler.
// This is the brain that turns "How is Coastal Dental doing?" into
// a sf_get_account_health_report call.

interface ToolRoute {
  patterns: RegExp[];
  tool: string;
  extractArgs: (match: RegExpMatchArray, text: string, user: ProphetUser) => Record<string, unknown>;
  description: string;
}

const TOOL_ROUTES: ToolRoute[] = [
  {
    patterns: [
      /^(?:how is|how's|health|status|check on)\s+(.+?)(?:\s+doing)?$/i,
      /^health\s+(?:report|score|check)\s+(?:for\s+)?(.+)$/i,
    ],
    tool: 'sf_get_account_health_report',
    extractArgs: (match) => ({ accountName: match[1].trim() }),
    description: 'Account health report',
  },
  {
    patterns: [
      /^(?:brief|prep|pre-?call|prepare)\s+(?:me\s+)?(?:for\s+)?(.+)$/i,
      /^(?:what do (?:we|i) know about)\s+(.+)$/i,
      /^(?:tell me about)\s+(.+)$/i,
    ],
    tool: 'sf_get_pre_call_brief',
    extractArgs: (match) => ({ accountName: match[1].trim() }),
    description: 'Pre-call brief',
  },
  {
    patterns: [
      /^(?:my week|weekly|this week|synopsis|what'?s (?:on )?(?:my|this) week)/i,
      /^(?:what do i have|what'?s up|my schedule|my accounts)/i,
    ],
    tool: 'sf_get_weekly_synopsis',
    extractArgs: (_match, _text, user) => ({ ownerId: user.salesforceUserId }),
    description: 'Weekly synopsis',
  },
  {
    patterns: [
      /^(?:churn|at risk|risk|who'?s at risk|who needs attention)/i,
      /^(?:which accounts? (?:are |need ))/i,
    ],
    tool: 'sf_get_churn_risk_accounts',
    extractArgs: (_match, _text, user) => ({ owner_id: user.salesforceUserId }),
    description: 'Churn risk accounts',
  },
  {
    patterns: [
      /^(?:renewals?|upcoming renewals?|who'?s renewing)/i,
      /^(?:renewal pipeline)/i,
    ],
    tool: 'sf_get_renewal_pipeline',
    extractArgs: (_match, _text, user) => ({ owner_id: user.salesforceUserId }),
    description: 'Renewal pipeline',
  },
  {
    patterns: [
      /^(?:upsell|growth|who can (?:we )?upsell|opportunities)/i,
    ],
    tool: 'sf_get_upsell_opportunities',
    extractArgs: (_match, _text, user) => ({ owner_id: user.salesforceUserId }),
    description: 'Upsell opportunities',
  },
  {
    patterns: [
      /^(?:research|prospect|look up|investigate|scan)\s+(.+)$/i,
    ],
    tool: 'sf_research_prospect',
    extractArgs: (match) => {
      const input = match[1].trim();
      // Check if it looks like a URL
      if (input.includes('.com') || input.includes('.net') || input.includes('http')) {
        return { websiteUrl: input };
      }
      // Try to parse "Practice Name in City, State"
      const locationMatch = input.match(/^(.+?)\s+in\s+(.+?)(?:,\s*(\w{2}))?\s*$/i);
      if (locationMatch) {
        return {
          practiceName: locationMatch[1],
          city: locationMatch[2],
          state: locationMatch[3] ?? undefined,
        };
      }
      return { practiceName: input };
    },
    description: 'Prospect research',
  },
  {
    patterns: [
      /^(?:log|note|record|add note)\s+(?:for\s+)?(.+?)(?:\s*[-:]\s*)(.+)$/i,
      /^(?:just (?:left|met|called|spoke (?:with|to)))\s+(.+?)(?:\.\s*)(.+)?$/i,
    ],
    tool: 'sf_log_account_note',
    extractArgs: (match, _text, user) => ({
      accountName: match[1]?.trim(),
      subject: `Call Note — ${new Date().toLocaleDateString()}`,
      description: match[2]?.trim() ?? 'Note logged via Prophet Telegram',
      type: 'Call',
      ownerId: user.salesforceUserId,
    }),
    description: 'Log account note',
  },
  {
    patterns: [
      /^(?:coach|coaching|how am i doing|my performance|am brief)/i,
    ],
    tool: 'sf_get_am_coaching_brief',
    extractArgs: (_match, _text, user) => ({ amUserId: user.salesforceUserId }),
    description: 'AM coaching brief',
  },
  {
    patterns: [
      /^(?:pipeline|my deals|my pipeline|rep (?:pipeline|synopsis|brief))/i,
    ],
    tool: 'sf_get_rep_pipeline_synopsis',
    extractArgs: (_match, _text, user) => ({ repUserId: user.salesforceUserId }),
    description: 'Rep pipeline synopsis',
  },
  {
    patterns: [
      /^(?:competitive?|competitor|who'?s competing|alerts?)/i,
      /^(?:what are .+ competitors? doing)/i,
    ],
    tool: 'sf_get_competitive_alerts',
    extractArgs: (_match, text) => {
      // Try to extract account name
      const nameMatch = text.match(/(?:for|on|about)\s+(.+)$/i);
      return nameMatch ? { accountName: nameMatch[1].trim() } : {};
    },
    description: 'Competitive alerts',
  },
  {
    patterns: [
      /^(?:ghosts?|dead deals?|revive|cold leads?|raise the ghosts?)/i,
    ],
    tool: 'sf_raise_the_ghosts',
    extractArgs: (_match, _text, user) => ({ owner_id: user.salesforceUserId }),
    description: 'Raise the ghosts',
  },
  {
    patterns: [
      /^(?:clone|copy|duplicate|replicate)\s+(?:dashboard|dash)\s+(.+?)(?:\s+(?:for|to|as)\s+(.+))?$/i,
      /^(?:new|create)\s+(?:event\s+)?dashboard\s+(?:like|from|based on)\s+(.+?)(?:\s+(?:for|to|as)\s+(.+))?$/i,
    ],
    tool: 'sf_clone_dashboard',
    extractArgs: (match) => {
      const source = match[1]?.trim();
      const target = match[2]?.trim();
      const args: Record<string, unknown> = {};
      // If source looks like a Salesforce ID
      if (source && /^[a-zA-Z0-9]{15,18}$/.test(source)) {
        args.source_dashboard_id = source;
      } else if (source) {
        args.source_dashboard_name = source;
      }
      if (target) {
        args.new_dashboard_name = target;
      }
      return args;
    },
    description: 'Clone dashboard',
  },
  {
    patterns: [
      /^(?:create|build|make|generate)\s+report\s+(.+)$/i,
      /^(?:new)\s+report\s+(.+)$/i,
    ],
    tool: 'sf_create_report',
    extractArgs: (match) => ({
      report_name: match[1]?.trim(),
    }),
    description: 'Create report',
  },
];

function routeMessage(text: string, user: ProphetUser): { tool: string; args: Record<string, unknown>; description: string } | null {
  for (const route of TOOL_ROUTES) {
    for (const pattern of route.patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          tool: route.tool,
          args: route.extractArgs(match, text, user),
          description: route.description,
        };
      }
    }
  }
  return null;
}

// ─── Response Formatter ──────────────────────────────────────────────────────
// Converts MCP markdown output to Telegram-friendly format.
// Telegram supports a subset of HTML and Markdown V2.

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatForTelegram(markdown: string): string {
  // First: escape ALL HTML entities so Telegram doesn't choke on $10,000 etc.
  let text = escapeHtml(markdown);

  // Convert markdown headers to bold (now safe — no raw < > in content)
  text = text.replace(/^###\s+(.+)$/gm, '\n<b>$1</b>');
  text = text.replace(/^##\s+(.+)$/gm, '\n<b>$1</b>');
  text = text.replace(/^#\s+(.+)$/gm, '\n<b>$1</b>');

  // Convert **bold** to <b>bold</b>
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Convert *italic* to <i>italic</i>
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');

  // Convert `code` to <code>code</code>
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Convert markdown links [text](url) to HTML — unescape the URL parts first
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    return `<a href="${url.replace(/&amp;/g, '&')}">${label}</a>`;
  });

  // Convert --- to a visual separator
  text = text.replace(/^-{3,}$/gm, '━━━━━━━━━━━━━━━━━━━━');

  // Convert markdown tables to aligned text (basic)
  text = text.replace(/\|/g, ' │ ');

  // Clean up excessive newlines
  text = text.replace(/\n{4,}/g, '\n\n\n');

  return text.trim();
}

// Split long messages into chunks for Telegram's 4096 char limit
function splitMessage(text: string): string[] {
  const MAX_LEN = 4000;
  if (text.length <= MAX_LEN) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (double newline, then single newline, then space)
    let splitAt = remaining.lastIndexOf('\n\n', MAX_LEN);
    if (splitAt < MAX_LEN * 0.5) splitAt = remaining.lastIndexOf('\n', MAX_LEN);
    if (splitAt < MAX_LEN * 0.5) splitAt = remaining.lastIndexOf(' ', MAX_LEN);
    if (splitAt < MAX_LEN * 0.5) splitAt = MAX_LEN;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

// ─── Voice Transcription ─────────────────────────────────────────────────────

async function transcribeVoice(fileUrl: string): Promise<string> {
  const OpenAI = (await import('openai')).default;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return '[Voice transcription unavailable — OPENAI_API_KEY not configured]';
  }

  const openai = new OpenAI({ apiKey: openaiKey });

  // Download the voice file from Telegram
  const response = await fetch(fileUrl);
  const buffer = Buffer.from(await response.arrayBuffer());

  // Create a File object for OpenAI
  const file = new File([buffer], 'voice.ogg', { type: 'audio/ogg' });

  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: 'en',
  });

  return transcription.text;
}

// ─── Image Analysis ──────────────────────────────────────────────────────────

async function analyzeImage(fileUrl: string, caption?: string): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return '[Image analysis unavailable — ANTHROPIC_API_KEY not configured]';
  }

  const anthropic = new Anthropic({ apiKey });

  // Download image from Telegram
  const response = await fetch(fileUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const base64 = buffer.toString('base64');

  // Determine media type
  const contentType = response.headers.get('content-type') ?? 'image/jpeg';
  const mediaType = contentType.includes('png') ? 'image/png' as const
    : contentType.includes('gif') ? 'image/gif' as const
    : contentType.includes('webp') ? 'image/webp' as const
    : 'image/jpeg' as const;

  const result = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        {
          type: 'text',
          text: caption
            ? `The user sent this image with the caption: "${caption}". They are a dental marketing account manager at Progressive Dental Marketing. Analyze this image and extract any actionable information. If it contains notes, goals, whiteboard content, or client information, structure it clearly.`
            : `The user sent this image without a caption. They are a dental marketing account manager at Progressive Dental Marketing. Describe what you see and extract any actionable information. If it contains notes, goals, whiteboard content, or client information, structure it clearly.`,
        },
      ],
    }],
  });

  const textBlock = result.content.find(b => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '[Could not analyze image]';
}

// ─── Bot Instance ────────────────────────────────────────────────────────────

let bot: Bot | null = null;
let toolHandlers: Record<string, (args: unknown) => Promise<string>> = {};

function getBot(): Bot {
  if (!bot) throw new Error('Telegram bot not initialized. Call initTelegram() first.');
  return bot;
}

// ─── Main Initialization ─────────────────────────────────────────────────────

export async function initTelegram(
  handlers: Record<string, (args: unknown) => Promise<string>>
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    process.stderr.write('[Prophet Telegram] No TELEGRAM_BOT_TOKEN — Telegram bot disabled\n');
    return;
  }

  toolHandlers = handlers;
  await loadUserRegistry();

  bot = new Bot(token);

  // ── /start — User Registration ──────────────────────────────────────────

  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;

    if (registeredUsers.has(chatId)) {
      const user = registeredUsers.get(chatId)!;
      await ctx.reply(
        `Welcome back, <b>${user.name}</b>. I'm here whenever you need me.\n\n` +
        `Try: <i>"How is [account name] doing?"</i> or <i>"Brief me for [account]"</i>\n\n` +
        `Type /help to see everything I can do.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    // New user — prompt for registration
    await ctx.reply(
      `<b>Welcome to Prophet</b> by Progressive Dental Marketing.\n\n` +
      `I'm your personal AI assistant. I can:\n` +
      `- Brief you before client calls\n` +
      `- Check account health instantly\n` +
      `- Alert you to churn risks\n` +
      `- Research prospects on demand\n` +
      `- Log notes from your car via voice\n` +
      `- Send you a morning intelligence brief\n\n` +
      `To get started, I need to link your Telegram to your Salesforce account.\n\n` +
      `Please reply with your <b>PDM email address</b> (the one you use in Salesforce):`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /help — Command Reference ───────────────────────────────────────────

  bot.command('help', async (ctx) => {
    await ctx.reply(
      `<b>Prophet Commands</b>\n\n` +
      `<b>Account Intelligence:</b>\n` +
      `- "How is [account] doing?" — Health report\n` +
      `- "Brief me for [account]" — Pre-call brief\n` +
      `- "Tell me about [account]" — Pre-call brief\n\n` +
      `<b>My Book of Business:</b>\n` +
      `- "My week" — Weekly synopsis with all calls\n` +
      `- "Who's at risk?" — Churn risk accounts\n` +
      `- "Renewals" — Upcoming renewal pipeline\n` +
      `- "Upsell" — Growth opportunities\n` +
      `- "My pipeline" — Rep deal pipeline\n\n` +
      `<b>Competitive Intelligence:</b>\n` +
      `- "Competitors for [account]" — Competitive alerts\n` +
      `- "Research [practice name]" — Full prospect research\n` +
      `- "Ghosts" — Revive dead deals\n\n` +
      `<b>Logging & Notes:</b>\n` +
      `- "Log [account] - [your note]" — Save a call note\n` +
      `- "Just left [account]. [details]" — Quick post-call note\n` +
      `- Send a voice message — I'll transcribe and route it\n` +
      `- Send a photo — I'll extract any notes or info\n\n` +
      `<b>Coaching & Growth:</b>\n` +
      `- "Coaching" — AM performance brief\n\n` +
      `<b>Settings:</b>\n` +
      `/morning on — Enable 6:30 AM daily brief\n` +
      `/morning off — Disable daily brief\n` +
      `/morning [HH:MM] — Change brief time\n` +
      `/settings — View your settings`,
      { parse_mode: 'HTML' }
    );
  });

  // ── /morning — Morning Brief Settings ───────────────────────────────────

  bot.command('morning', async (ctx) => {
    const chatId = ctx.chat.id;
    const user = registeredUsers.get(chatId);
    if (!user) {
      await ctx.reply('Please /start first to register your account.');
      return;
    }

    const arg = ctx.match?.trim().toLowerCase();

    if (arg === 'on') {
      user.morningBriefEnabled = true;
      await saveUserRegistry();
      await ctx.reply(`Morning brief enabled. I'll text you at ${user.morningBriefTime} every weekday.`);
    } else if (arg === 'off') {
      user.morningBriefEnabled = false;
      await saveUserRegistry();
      await ctx.reply('Morning brief disabled. You can re-enable anytime with /morning on');
    } else if (/^\d{1,2}:\d{2}$/.test(arg ?? '')) {
      user.morningBriefTime = arg!;
      user.morningBriefEnabled = true;
      await saveUserRegistry();
      await ctx.reply(`Morning brief set for ${arg} every weekday.`);
    } else {
      await ctx.reply(
        `<b>Morning Brief Settings</b>\n\n` +
        `Current time: <b>${user.morningBriefTime}</b>\n` +
        `Status: <b>${user.morningBriefEnabled ? 'Enabled' : 'Disabled'}</b>\n\n` +
        `/morning on — Enable\n` +
        `/morning off — Disable\n` +
        `/morning 07:00 — Change time`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // ── /settings — View Current Settings ───────────────────────────────────

  bot.command('settings', async (ctx) => {
    const user = registeredUsers.get(ctx.chat.id);
    if (!user) {
      await ctx.reply('Please /start first to register your account.');
      return;
    }

    await ctx.reply(
      `<b>Your Prophet Settings</b>\n\n` +
      `<b>Name:</b> ${user.name}\n` +
      `<b>Role:</b> ${user.role.toUpperCase()}\n` +
      `<b>Salesforce ID:</b> <code>${user.salesforceUserId}</code>\n` +
      `<b>Timezone:</b> ${user.timezone}\n` +
      `<b>Morning Brief:</b> ${user.morningBriefEnabled ? `Enabled at ${user.morningBriefTime}` : 'Disabled'}\n` +
      `<b>Registered:</b> ${user.registeredAt}`,
      { parse_mode: 'HTML' }
    );
  });

  // ── Voice Messages ──────────────────────────────────────────────────────

  bot.on('message:voice', async (ctx) => {
    const user = registeredUsers.get(ctx.chat.id);
    if (!user) {
      await ctx.reply('Please /start first to register your account.');
      return;
    }

    await ctx.reply('Listening...');

    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const transcription = await transcribeVoice(fileUrl);

      await ctx.reply(`<b>I heard:</b> "${transcription}"\n\nProcessing...`, { parse_mode: 'HTML' });

      // Route the transcribed text through the normal command router
      await handleTextMessage(ctx, user, transcription);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Sorry, I couldn't process that voice message: ${msg}`);
    }
  });

  // ── Photo Messages ──────────────────────────────────────────────────────

  bot.on('message:photo', async (ctx) => {
    const user = registeredUsers.get(ctx.chat.id);
    if (!user) {
      await ctx.reply('Please /start first to register your account.');
      return;
    }

    await ctx.reply('Analyzing image...');

    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1]; // Highest resolution
      const file = await ctx.api.getFile(largest.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      const analysis = await analyzeImage(fileUrl, ctx.message.caption ?? undefined);

      const chunks = splitMessage(formatForTelegram(analysis));
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'HTML' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`Sorry, I couldn't analyze that image: ${msg}`);
    }
  });

  // ── Text Messages — Main Router ─────────────────────────────────────────

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text.trim();

    // Check if this is a registration reply (email address)
    if (!registeredUsers.has(chatId) && text.includes('@')) {
      await handleRegistration(ctx, text);
      return;
    }

    // Check if this is a numbered action reply (e.g., "1", "2", "3", "all")
    const pending = pendingActions.get(chatId);
    if (pending && pending.expiresAt > Date.now()) {
      if (text.toLowerCase() === 'all') {
        await ctx.reply('On it — executing all actions...');
        for (const action of pending.actions) {
          try {
            const result = await action.handler();
            await ctx.reply(`<b>${action.label}</b> — Done.\n${formatForTelegram(result).slice(0, 500)}`, { parse_mode: 'HTML' });
          } catch (err) {
            await ctx.reply(`<b>${action.label}</b> — Failed: ${err instanceof Error ? err.message : String(err)}`, { parse_mode: 'HTML' });
          }
        }
        pendingActions.delete(chatId);
        return;
      }

      const actionNum = parseInt(text, 10);
      const action = pending.actions.find(a => a.id === actionNum);
      if (action) {
        await ctx.reply(`Working on: <b>${action.label}</b>...`, { parse_mode: 'HTML' });
        try {
          const result = await action.handler();
          const chunks = splitMessage(formatForTelegram(result));
          for (const chunk of chunks) {
            await ctx.reply(chunk, { parse_mode: 'HTML' });
          }
        } catch (err) {
          await ctx.reply(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        pendingActions.delete(chatId);
        return;
      }
    }

    const user = registeredUsers.get(chatId);
    if (!user) {
      await ctx.reply(
        'I don\'t recognize this account. Please type /start to register with Prophet.'
      );
      return;
    }

    await handleTextMessage(ctx, user, text);
  });

  // ── Callback Queries (Inline Buttons) ───────────────────────────────────

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const user = registeredUsers.get(ctx.chat?.id ?? 0);

    if (!user) {
      await ctx.answerCallbackQuery({ text: 'Please /start first.' });
      return;
    }

    // Parse callback data format: "tool:toolName:argJson"
    if (data.startsWith('tool:')) {
      const parts = data.split(':', 3);
      const toolName = parts[1];
      const argJson = parts[2] ? JSON.parse(parts[2]) : {};

      await ctx.answerCallbackQuery({ text: 'Working on it...' });

      try {
        const handler = toolHandlers[toolName];
        if (!handler) {
          await ctx.editMessageText(`Unknown tool: ${toolName}`);
          return;
        }

        const result = await handler(argJson);
        const chunks = splitMessage(formatForTelegram(result));
        for (const chunk of chunks) {
          await ctx.reply(chunk, { parse_mode: 'HTML' });
        }
      } catch (err) {
        await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    await ctx.answerCallbackQuery();
  });

  // ── Error Handler ───────────────────────────────────────────────────────

  bot.catch((err) => {
    process.stderr.write(`[Prophet Telegram] Bot error: ${err.message}\n`);
  });

  process.stderr.write(`[Prophet Telegram] Bot initialized with ${TOOL_ROUTES.length} command routes\n`);
}

// ─── Handle Text Message Routing ─────────────────────────────────────────────

async function handleTextMessage(ctx: Context, user: ProphetUser, text: string): Promise<void> {
  const route = routeMessage(text, user);

  if (!route) {
    // No regex match — hand off to the AI agent for reasoning
    await ctx.replyWithChatAction('typing');

    try {
      process.stderr.write(`[Prophet Agent] Processing: "${text.slice(0, 80)}..." for ${user.name}\n`);
      const agentResponse = await runAgent(text, user, toolHandlers);
      const formatted = formatForTelegram(agentResponse);
      const chunks = splitMessage(formatted);

      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'HTML' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[Prophet Agent] Error: ${msg}\n`);

      // Fallback to quick actions if agent fails
      const keyboard = new InlineKeyboard()
        .text('📋 My Week', 'tool:sf_get_weekly_synopsis:{}')
        .text('🚨 Churn Risk', 'tool:sf_get_churn_risk_accounts:{}')
        .row()
        .text('🔄 Renewals', 'tool:sf_get_renewal_pipeline:{}')
        .text('📈 Upsells', 'tool:sf_get_upsell_opportunities:{}');

      await ctx.reply(
        `I ran into an issue processing that. Try a direct command:\n\n` +
        `- <i>"How is [account name] doing?"</i>\n` +
        `- <i>"Brief me for [account]"</i>\n` +
        `- <i>"My week"</i>\n`,
        { parse_mode: 'HTML', reply_markup: keyboard }
      );
    }
    return;
  }

  // Send typing indicator
  await ctx.replyWithChatAction('typing');

  try {
    const handler = toolHandlers[route.tool];
    if (!handler) {
      await ctx.reply(`Tool "${route.tool}" is not available on this server.`);
      return;
    }

    // Merge user context into args where needed
    const args = { ...route.args };
    if (!args.owner_id && !args.ownerId && !args.amUserId && !args.repUserId) {
      // Don't auto-inject for account-specific queries
      if (!args.accountName && !args.accountId && !args.practiceName) {
        args.owner_id = user.salesforceUserId;
      }
    }

    const result = await handler(args);
    const formatted = formatForTelegram(result);
    const chunks = splitMessage(formatted);

    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: 'HTML' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Something went wrong running <b>${route.description}</b>:\n\n<code>${msg}</code>`, { parse_mode: 'HTML' });
  }
}

// ─── User Registration Flow ──────────────────────────────────────────────────

async function handleRegistration(ctx: Context, email: string): Promise<void> {
  const chatId = ctx.chat!.id;

  try {
    // Look up the user in Salesforce by email
    const users = await salesforceService.rawQuery<{
      Id: string;
      Name: string;
      Email: string;
      UserRole?: { Name: string };
    }>(`SELECT Id, Name, Email, UserRole.Name FROM User WHERE Email = '${email.replace(/'/g, "\\'")}' AND IsActive = true LIMIT 1`);

    if (users.length === 0) {
      await ctx.reply(
        `I couldn't find an active Salesforce user with email <b>${email}</b>.\n\n` +
        `Please check and try again, or contact William for help.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const sfUser = users[0];
    const roleName = sfUser.UserRole?.Name ?? '';

    // Determine role
    let role: ProphetUser['role'] = 'am';
    if (roleName.includes('Director') || roleName.includes('Admin') || roleName.includes('CEO')) {
      role = 'admin';
    } else if (roleName.includes('Team Lead') || roleName.includes('Manager')) {
      role = 'manager';
    } else if (roleName.includes('Sales') || roleName.includes('Rep') || roleName.includes('BDR')) {
      role = 'rep';
    }

    const newUser: ProphetUser = {
      telegramChatId: chatId,
      salesforceUserId: sfUser.Id,
      name: sfUser.Name,
      role,
      timezone: 'America/New_York', // Default — can be changed
      morningBriefTime: '06:30',
      morningBriefEnabled: true,
      registeredAt: new Date().toISOString().slice(0, 10),
    };

    registeredUsers.set(chatId, newUser);
    await saveUserRegistry();

    const keyboard = new InlineKeyboard()
      .text('📋 My Week', 'tool:sf_get_weekly_synopsis:{}')
      .text('🚨 Churn Risk', 'tool:sf_get_churn_risk_accounts:{}')
      .row()
      .text('🔄 Renewals', 'tool:sf_get_renewal_pipeline:{}')
      .text('📈 Upsells', 'tool:sf_get_upsell_opportunities:{}')
      .row()
      .text('🏋️ Coaching', 'tool:sf_get_am_coaching_brief:{}')
      .text('👻 Dead Deals', 'tool:sf_raise_the_ghosts:{}');

    await ctx.reply(
      `<b>You're connected, ${sfUser.Name}!</b>\n\n` +
      `Salesforce ID: <code>${sfUser.Id}</code>\n` +
      `Role: <b>${role.toUpperCase()}</b>\n` +
      `Morning Brief: <b>Enabled at 6:30 AM</b>\n\n` +
      `I'm your personal AI assistant. I know every account in your book of business, ` +
      `every competitor in every market, and every signal that matters.\n\n` +
      `<b>Try me now:</b>`,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`Registration error: ${msg}\n\nPlease try again or contact William.`);
  }
}

// ─── Webhook Handler (for Railway HTTP server) ───────────────────────────────

let cachedWebhookHandler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null;

export function getTelegramWebhookHandler(): ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null {
  if (!bot) return null;
  // Only create webhook handler if PUBLIC_URL is set (meaning we want webhook mode)
  // Do NOT create it if we're going to use long-polling — grammY blocks .start() after webhookCallback
  if (!process.env.PUBLIC_URL) return null;
  if (!cachedWebhookHandler) {
    cachedWebhookHandler = webhookCallback(bot, 'http') as unknown as (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  }
  return cachedWebhookHandler;
}

// ─── Proactive Messaging API ─────────────────────────────────────────────────
// Used by morning brief engine, n8n webhooks, and alert systems.

export async function sendProactiveMessage(
  chatId: number,
  message: string,
  keyboard?: InlineKeyboard
): Promise<void> {
  const b = getBot();
  const chunks = splitMessage(formatForTelegram(message));

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await b.api.sendMessage(chatId, chunks[i], {
      parse_mode: 'HTML',
      ...(isLast && keyboard ? { reply_markup: keyboard } : {}),
    });
  }
}

export async function sendMorningBrief(user: ProphetUser): Promise<void> {
  try {
    const brief = await morningBriefEngine.generateBrief(user, toolHandlers);
    const keyboard = new InlineKeyboard();

    // Add action buttons if the brief includes suggestions
    if (brief.suggestedActions.length > 0) {
      const actions: PendingAction['actions'] = [];

      brief.suggestedActions.forEach((action, i) => {
        keyboard.text(`${i + 1}`, `action:${i + 1}`);
        actions.push({
          id: i + 1,
          label: action.label,
          handler: action.handler,
        });
      });

      keyboard.row().text('Do All', 'action:all');

      // Store pending actions for numbered replies
      pendingActions.set(user.telegramChatId, {
        userId: user.telegramChatId,
        actions,
        expiresAt: Date.now() + 30 * 60 * 1000, // 30 min expiry
      });
    }

    await sendProactiveMessage(user.telegramChatId, brief.message, keyboard);
  } catch (err) {
    process.stderr.write(`[Prophet Telegram] Morning brief failed for ${user.name}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ─── Get All Registered Users ────────────────────────────────────────────────

export function getRegisteredUsers(): ProphetUser[] {
  return Array.from(registeredUsers.values());
}

// ─── Start Webhook (called after HTTP server is up) ──────────────────────────

export async function setTelegramWebhook(publicUrl: string): Promise<void> {
  if (!bot) return;

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? 'prophet-pdm-webhook';
  const webhookUrl = `${publicUrl}/telegram/webhook`;

  await bot.api.setWebhook(webhookUrl, {
    secret_token: webhookSecret,
    allowed_updates: ['message', 'callback_query'],
  });

  process.stderr.write(`[Prophet Telegram] Webhook set: ${webhookUrl}\n`);
}

// ─── Start Long Polling (for local development) ──────────────────────────────

export async function startTelegramPolling(): Promise<void> {
  if (!bot) return;

  // Delete any existing webhook first
  await bot.api.deleteWebhook();

  bot.start({
    onStart: () => {
      process.stderr.write(`[Prophet Telegram] Bot running in long-polling mode\n`);
    },
  });
}
