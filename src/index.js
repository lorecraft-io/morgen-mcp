#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from repo root
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = process.env.DOTENV_CONFIG_PATH || resolve(__dirname, "../.env");
config({ path: ENV_PATH });

// Startup validation
if (!process.env.MORGEN_API_KEY) {
  console.error(
    "Missing required environment variable: MORGEN_API_KEY\n" +
    "Run \"npx morgen-mcp setup\" or see .env.example for details."
  );
  process.exit(1);
}

// Import tool definitions and handlers from sibling modules
import { EVENT_TOOLS, eventHandlers } from "./tools-events.js";
import { TASK_TOOLS, taskHandlers } from "./tools-tasks.js";

const TOOLS = [...EVENT_TOOLS, ...TASK_TOOLS];
const HANDLERS = { ...eventHandlers, ...taskHandlers };

// Server setup
const server = new Server(
  { name: "morgen", version: "0.1.3" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  try {
    const handler = HANDLERS[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: "Unknown tool" }],
        isError: true,
      };
    }

    const result = await handler(args || {});

    console.error(JSON.stringify({
      event: "tool_call",
      tool: name,
      status: "success",
      durationMs: Date.now() - startTime,
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    // Sanitize error: strip URLs so API endpoints/keys don't leak, and
    // fall back to a generic message for unexpected (non-Error) throws.
    const safeMessage = (error instanceof Error && error.message)
      ? error.message.replace(/https?:\/\/[^\s)]+/g, "[redacted-url]")
      : "An unexpected error occurred";

    console.error(JSON.stringify({
      event: "tool_call",
      tool: name,
      status: "error",
      durationMs: Date.now() - startTime,
      error: safeMessage,
    }));

    return {
      content: [{ type: "text", text: `Error: ${safeMessage}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(
    "[morgen-mcp] Fatal startup error:",
    err instanceof Error ? err.message : "Unknown error"
  );
  process.exit(1);
});
