import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { initTelegram, getTelegramWebhookHandler, setTelegramWebhook, startTelegramPolling } from './services/telegram.js';
import { startBriefScheduler } from './services/briefScheduler.js';

import { accountManagementTools, accountManagementHandlers } from './tools/accountManagement.js';
import { healthReportTools, healthReportHandlers } from './tools/healthReports.js';
import { pipelineTools, pipelineHandlers } from './tools/pipeline.js';
import { callIntelligenceTools, callIntelligenceHandlers } from './tools/callIntelligence.js';
import { prospectResearchTools, prospectResearchHandlers } from './tools/prospectResearch.js';
import { repSynopsisTools, repSynopsisHandlers } from './tools/repSynopsis.js';
import { competitiveAlertTools, competitiveAlertHandlers } from './tools/competitiveAlerts.js';
import { leadIntelligenceTools, leadIntelligenceHandlers } from './tools/leadIntelligence.js';
import { renewalProofTools, renewalProofHandlers } from './tools/renewalProof.js';
import { healthScannerTools, healthScannerHandlers } from './tools/healthScanner.js';
import { amCoachingTools, amCoachingHandlers } from './tools/amCoaching.js';
import { competitorScanTools, competitorScanHandlers } from './tools/competitorScan.js';
import { agencyIntelTools, agencyIntelHandlers } from './tools/agencyIntel.js';
import { raiseTheGhostsTools, raiseTheGhostsHandlers } from './tools/raiseTheGhosts.js';
import { opportunityLifecycleTools, opportunityLifecycleHandlers } from './tools/opportunityLifecycle.js';
import { reportBuilderTools, reportBuilderHandlers } from './tools/reportBuilder.js';
import { schedulingTools, schedulingHandlers } from './tools/scheduling.js';
import { autoLeadScanTools, autoLeadScanHandlers } from './tools/autoLeadScan.js';
import { eventEngagementTools, eventEngagementHandlers } from './tools/eventEngagement.js';
import { leadEnrichmentTools, leadEnrichmentHandlers } from './tools/leadEnrichment.js';
import { salesFunnelTools, salesFunnelHandlers } from './tools/salesFunnel.js';
import { marketingDashboardTools, marketingDashboardHandlers } from './tools/marketingDashboard.js';

// Load .env with override — ensures all keys are set even if salesforce.ts loaded first
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env'), override: true });
config({ path: join(process.cwd(), '.env'), override: true });
// Debug: confirm critical keys
process.stderr.write(`[Prophet] ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'loaded' : 'MISSING'}\n`);
process.stderr.write(`[Prophet] SF_USERNAME: ${process.env.SF_USERNAME ? 'loaded' : 'MISSING'}\n`);
process.stderr.write(`[Prophet] TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? 'loaded' : 'MISSING'}\n`);

// ─── Registry ─────────────────────────────────────────────────────────────

const ALL_TOOLS = [
  ...accountManagementTools,
  ...healthReportTools,
  ...pipelineTools,
  ...callIntelligenceTools,
  ...prospectResearchTools,
  ...repSynopsisTools,
  ...competitiveAlertTools,
  ...leadIntelligenceTools,
  ...renewalProofTools,
  ...healthScannerTools,
  ...amCoachingTools,
  ...competitorScanTools,
  ...agencyIntelTools,
  ...raiseTheGhostsTools,
  ...opportunityLifecycleTools,
  ...reportBuilderTools,
  ...schedulingTools,
  ...autoLeadScanTools,
  ...eventEngagementTools,
  ...leadEnrichmentTools,
  ...salesFunnelTools,
  ...marketingDashboardTools,
];

const ALL_HANDLERS: Record<string, (args: unknown) => Promise<string>> = {
  ...accountManagementHandlers,
  ...healthReportHandlers,
  ...pipelineHandlers,
  ...callIntelligenceHandlers,
  ...prospectResearchHandlers,
  ...repSynopsisHandlers,
  ...competitiveAlertHandlers,
  ...leadIntelligenceHandlers,
  ...renewalProofHandlers,
  ...healthScannerHandlers,
  ...amCoachingHandlers,
  ...competitorScanHandlers,
  ...agencyIntelHandlers,
  ...raiseTheGhostsHandlers,
  ...opportunityLifecycleHandlers,
  ...reportBuilderHandlers,
  ...schedulingHandlers,
  ...autoLeadScanHandlers,
  ...eventEngagementHandlers,
  ...leadEnrichmentHandlers,
  ...salesFunnelHandlers,
  ...marketingDashboardHandlers,
};

// ─── MCP Server Factory ───────────────────────────────────────────────────
// Creates a configured Server instance. Called once for stdio, once per
// HTTP request for stateless HTTP transport.

function createMcpServer(): Server {
  const server = new Server(
    { name: 'prophet', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: ALL_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = ALL_HANDLERS[name];
    if (!handler) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: "${name}"` }],
        isError: true,
      };
    }

    try {
      const text = await handler(args ?? {});
      return { content: [{ type: 'text' as const, text }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

// ─── Stdio Transport ──────────────────────────────────────────────────────

async function startStdio(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('PDM Account Intelligence Hub running (stdio)\n');
}

// ─── REST API Handler ─────────────────────────────────────────────────────
// Parallel REST endpoints for Agentforce External Services and direct HTTP
// callers. Same tool handlers, REST interface.

async function handleRestApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Extract tool name from URL: /api/weekly-synopsis → sf_get_weekly_synopsis
  const urlPath = req.url?.split('?')[0] ?? '';
  const apiPath = urlPath.replace('/api/', '');

  // Map kebab-case URL to tool name: weekly-synopsis → sf_get_weekly_synopsis
  const toolName = 'sf_' + apiPath.replace(/-/g, '_');
  // Also try exact match and common aliases
  const handler = ALL_HANDLERS[toolName]
    ?? ALL_HANDLERS[apiPath]
    ?? ALL_HANDLERS[apiPath.replace(/-/g, '_')];

  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found',
      message: `No tool found for "${apiPath}". Available: ${Object.keys(ALL_HANDLERS).join(', ')}`,
    }));
    return;
  }

  // Parse JSON body
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const rawBody = Buffer.concat(chunks).toString();
  const args = rawBody.length > 0 ? JSON.parse(rawBody) : {};

  try {
    const result = await handler(args);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ success: true, data: result }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: message }));
  }
}

// ─── HTTP Transport ───────────────────────────────────────────────────────

async function startHttp(): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const telegramWebhook = getTelegramWebhookHandler();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';

    // ── Health check ────────────────────────────────────────────────────
    if (url === '/health') {
      const telegramStatus = telegramWebhook ? 'connected' : 'disabled';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: 'prophet',
        version: '2.0.0',
        tools: ALL_TOOLS.length,
        telegram: telegramStatus,
        endpoints: {
          mcp: 'POST /mcp',
          api: 'POST /api/{tool-name}',
          telegram: telegramWebhook ? 'POST /telegram/webhook' : 'disabled',
          health: 'GET /health',
        },
      }));
      return;
    }

    // ── CORS preflight ──────────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }

    // ── Telegram webhook ────────────────────────────────────────────────
    if (url.startsWith('/telegram/webhook') && telegramWebhook) {
      try {
        await telegramWebhook(req, res);
      } catch (err) {
        process.stderr.write(`[Telegram Webhook] Error: ${err instanceof Error ? err.message : String(err)}\n`);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal error');
        }
      }
      return;
    }

    // ── REST API routes ─────────────────────────────────────────────────
    if (url.startsWith('/api/') && req.method === 'POST') {
      try {
        await handleRestApi(req, res);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: message }));
      }
      return;
    }

    // ── API tool listing ────────────────────────────────────────────────
    if (url === '/api' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        tools: ALL_TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          endpoint: `/api/${t.name.replace(/^sf_/, '').replace(/_/g, '-')}`,
        })),
      }));
      return;
    }

    // ── MCP endpoint ────────────────────────────────────────────────────
    if (url === '/mcp') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks).toString();
      const body = rawBody.length > 0 ? JSON.parse(rawBody) : undefined;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    // ── 404 ─────────────────────────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found',
      endpoints: {
        health: 'GET /health',
        mcp: 'POST /mcp',
        api_list: 'GET /api',
        api_call: 'POST /api/{tool-name}',
        telegram: 'POST /telegram/webhook',
      },
    }));
  });

  httpServer.listen(port, async () => {
    const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;

    process.stderr.write(
      `\n` +
      `═══════════════════════════════════════════════════════\n` +
      `  Prophet v2.0 — PDM Account Intelligence Hub\n` +
      `═══════════════════════════════════════════════════════\n` +
      `  HTTP server:     port ${port}\n` +
      `  Tools:           ${ALL_TOOLS.length} registered\n` +
      `  MCP endpoint:    POST /mcp\n` +
      `  REST API:        POST /api/{tool-name}\n` +
      `  API listing:     GET /api\n` +
      `  Health check:    GET /health\n` +
      `  Telegram:        ${process.env.TELEGRAM_BOT_TOKEN ? 'ENABLED' : 'disabled (no token)'}\n` +
      `═══════════════════════════════════════════════════════\n\n`
    );

    // Telegram: use webhook if PUBLIC_URL is set, otherwise fall back to long-polling
    if (process.env.TELEGRAM_BOT_TOKEN) {
      if (process.env.PUBLIC_URL) {
        await setTelegramWebhook(publicUrl);
        process.stderr.write(`[Prophet] Telegram using webhook mode\n`);
      } else {
        await startTelegramPolling();
        process.stderr.write(`[Prophet] Telegram using long-polling mode (no PUBLIC_URL)\n`);
      }
    }

    // Start morning brief scheduler
    startBriefScheduler();
  });
}

// ─── Start ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transportMode = process.env.TRANSPORT === 'http' ? 'http' : 'stdio';

  if (transportMode === 'http') {
    // Initialize Telegram bot only in HTTP mode (Railway)
    // In stdio/MCP mode, Telegram polling conflicts with Railway's instance
    if (process.env.TELEGRAM_BOT_TOKEN) {
      await initTelegram(ALL_HANDLERS);
    }
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
