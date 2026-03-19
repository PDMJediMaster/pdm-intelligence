import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { config } from 'dotenv';

import { accountManagementTools, accountManagementHandlers } from './tools/accountManagement.js';
import { healthReportTools, healthReportHandlers } from './tools/healthReports.js';
import { pipelineTools, pipelineHandlers } from './tools/pipeline.js';
import { callIntelligenceTools, callIntelligenceHandlers } from './tools/callIntelligence.js';
import { prospectResearchTools, prospectResearchHandlers } from './tools/prospectResearch.js';
import { repSynopsisTools, repSynopsisHandlers } from './tools/repSynopsis.js';
import { competitiveAlertTools, competitiveAlertHandlers } from './tools/competitiveAlerts.js';

config();

// ─── Registry ─────────────────────────────────────────────────────────────

const ALL_TOOLS = [
  ...accountManagementTools,
  ...healthReportTools,
  ...pipelineTools,
  ...callIntelligenceTools,
  ...prospectResearchTools,
  ...repSynopsisTools,
  ...competitiveAlertTools,
];

const ALL_HANDLERS: Record<string, (args: unknown) => Promise<string>> = {
  ...accountManagementHandlers,
  ...healthReportHandlers,
  ...pipelineHandlers,
  ...callIntelligenceHandlers,
  ...prospectResearchHandlers,
  ...repSynopsisHandlers,
  ...competitiveAlertHandlers,
};

// ─── MCP Server Factory ───────────────────────────────────────────────────
// Creates a configured Server instance. Called once for stdio, once per
// HTTP request for stateless HTTP transport.

function createMcpServer(): Server {
  const server = new Server(
    { name: 'foresight', version: '1.0.0' },
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

// ─── HTTP Transport ───────────────────────────────────────────────────────

async function startHttp(): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3000', 10);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Health check — Railway uses this to confirm the service is up
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'foresight', tools: ALL_TOOLS.length }));
      return;
    }

    if (req.url === '/mcp') {
      // Parse body
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks).toString();
      const body = rawBody.length > 0 ? JSON.parse(rawBody) : undefined;

      // Stateless: new transport + server per request
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const mcpServer = createMcpServer();
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. MCP endpoint: POST /mcp');
  });

  httpServer.listen(port, () => {
    process.stderr.write(
      `PDM Account Intelligence Hub running (HTTP) on port ${port}\n` +
      `Tools registered: ${ALL_TOOLS.length}\n` +
      `MCP endpoint: POST /mcp\n` +
      `Health check: GET /health\n`
    );
  });
}

// ─── Start ────────────────────────────────────────────────────────────────

const transport = process.env.TRANSPORT === 'http' ? 'http' : 'stdio';

if (transport === 'http') {
  startHttp().catch((err: unknown) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else {
  startStdio().catch((err: unknown) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
