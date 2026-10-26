#!/usr/bin/env bun
// Stdio MCP server: lets any MCP client draft and manage Entole limit orders for one user.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EntoleClient, entoleBaseUrl } from "./client.ts";
import { registerTools } from "./tools.ts";

const token = process.env.ENTOLE_TOKEN?.trim() ?? "";
if (!token.startsWith("ent_")) {
  // stdout carries the protocol, so the reason goes to stderr where clients log it.
  console.error("ENTOLE_TOKEN is not set. Create a token at <Entole URL>/connect.");
  process.exit(1);
}

let baseUrl: string;
try {
  baseUrl = entoleBaseUrl(process.env.ENTOLE_URL);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const server = new McpServer({ name: "entole", version: "0.1.0" });
registerTools(server, new EntoleClient(baseUrl, token));
await server.connect(new StdioServerTransport());
