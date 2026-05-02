/**
 * Forge IDE — MCP Client Manager
 *
 * Manages connections to external MCP servers (Context7, filesystem tools, etc.)
 * Connected servers' tools are automatically made available to the AI/agent loop.
 *
 * Supports:
 *   - Streamable HTTP  (modern, ws://  or  http://)
 *   - SSE transport    (legacy, for older servers)
 *   - stdio            (for local servers spawned as processes)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PassThrough } from 'stream';

// ─── In-process connection (agent → forge-ide MCP server) ────────────────────
// Connects a client directly to the forge-ide MCP server using in-memory
// streams — no subprocess, no HTTP, no port. Pure MCP protocol over pipes.
export async function connectInProcess(id, buildServerFn) {
  if (connections.has(id)) await disconnectMcpServer(id);

  const entry = { config: { id, transport: 'stdio-inprocess' }, client: null, tools: [], resources: [], status: 'connecting', error: null };
  connections.set(id, entry);

  try {
    // Import server-side StdioServerTransport
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const server = buildServerFn();
    await server.connect(serverTransport);

    const client = new Client({ name: 'forge-ide-agent', version: '1.0.0' });
await client.connect(clientTransport);
    console.log("fetching tools");
    const toolsResult    = await client.listTools().catch(() => ({ tools: [] }));
    const resourcesResult = await client.listResources().catch(() => ({ resources: [] }));

    entry.client    = client;
    entry.tools     = toolsResult.tools || [];
    entry.resources = resourcesResult.resources || [];
    entry.status    = 'connected';

    console.log(`[MCP] ${id}: in-process stdio — ${entry.tools.length} tools`);
    push('mcp:status', { id, status: 'connected', tools: entry.tools, resources: entry.resources });

    client.onclose = () => {
      const e = connections.get(id);
      if (e) { e.status = 'disconnected'; push('mcp:status', { id, status: 'disconnected' }); }
    };

  } catch (err) {
    entry.status = 'error';
    entry.error  = err.message;
    console.error(`[MCP] in-process connection failed for ${id}:`, err.message);
    push('mcp:status', { id, status: 'error', error: err.message });
  }

  return { id, status: entry.status, error: entry.error, tools: entry.tools };
}

// ─── Registry ─────────────────────────────────────────────────────────────────
// connections: Map<id, { config, client, tools, status, error }>
const connections = new Map();

let _broadcast = null;  // injected by main server to push events to WS clients
export function setBroadcast(fn) { _broadcast = fn; }

function push(type, data) {
  _broadcast?.({ type, ...data });
}

// ─── Connect to an MCP server ─────────────────────────────────────────────────
export async function connectMcpServer(config) {
  const { id, url, transport: transportType = 'auto', command, args = [], env = {} } = config;

  if (connections.has(id)) {
    await disconnectMcpServer(id);
  }

  const entry = { config, client: null, tools: [], resources: [], status: 'connecting', error: null };
  connections.set(id, entry);
  push('mcp:status', { id, status: 'connecting' });

  try {
    const client = new Client({ name: 'forge-ide', version: '1.0.0' });
    let transport;

    if (transportType === 'stdio' || command) {
      // Spawn a local process
      transport = new StdioClientTransport({ command, args, env: { ...process.env, ...env } });
    } else {
      // Streamable HTTP (spec 2025-03-26)
      const baseUrl = new URL(url);
      transport = new StreamableHTTPClientTransport(baseUrl);
      await client.connect(transport);
      console.log(`[MCP] Connected to ${id} via Streamable HTTP`);
    }

    // Discover capabilities
    const toolsResult = await client.listTools().catch(() => ({ tools: [] }));
    const resourcesResult = await client.listResources().catch(() => ({ resources: [] }));

    entry.client = client;
    entry.tools = toolsResult.tools || [];
    entry.resources = resourcesResult.resources || [];
    entry.status = 'connected';

    console.log(`[MCP] ${id}: ${entry.tools.length} tools, ${entry.resources.length} resources`);
    push('mcp:status', { id, status: 'connected', tools: entry.tools, resources: entry.resources });

    // Handle unexpected disconnects
    client.onclose = () => {
      const e = connections.get(id);
      if (e) { e.status = 'disconnected'; push('mcp:status', { id, status: 'disconnected' }); }
    };

  } catch (err) {
    entry.status = 'error';
    entry.error = err.message;
    console.error(`[MCP] Failed to connect ${id}:`, err.message);
    push('mcp:status', { id, status: 'error', error: err.message });
  }

  return { id, status: entry.status, error: entry.error, tools: entry.tools };
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
export async function disconnectMcpServer(id) {
  const entry = connections.get(id);
  if (!entry) return;
  try { await entry.client?.close(); } catch {}
  connections.delete(id);
  push('mcp:status', { id, status: 'disconnected' });
}

// ─── List all connections ─────────────────────────────────────────────────────
export function listMcpConnections() {
  return [...connections.entries()].map(([id, e]) => ({
    id,
    url: e.config.url || e.config.command,
    transport: e.config.transport || 'auto',
    status: e.status,
    error: e.error,
    toolCount: e.tools.length,
    resourceCount: e.resources.length,
    tools: e.tools.map(t => ({ name: t.name, description: t.description })),
    resources: e.resources.map(r => ({ uri: r.uri, name: r.name })),
  }));
}

// ─── Call a tool on a connected server ───────────────────────────────────────
export async function callMcpTool(serverId, toolName, args = {}) {
  const entry = connections.get(serverId);
  if (!entry || entry.status !== 'connected') {
    throw new Error(`MCP server ${serverId} not connected`);
  }
  const result = await entry.client.callTool({ name: toolName, arguments: args });
  return result;
}

// ─── Get all tools across all connected servers ───────────────────────────────
export function getAllMcpTools() {
  const all = [];
  for (const [id, entry] of connections) {
    if (entry.status !== 'connected') continue;
    for (const tool of entry.tools) {
      all.push({ serverId: id, serverUrl: entry.config.url || entry.config.command, ...tool });
    }
  }
  return all;
}

// ─── Read a resource from a server ───────────────────────────────────────────
export async function readMcpResource(serverId, uri) {
  const entry = connections.get(serverId);
  if (!entry || entry.status !== 'connected') throw new Error(`Server ${serverId} not connected`);
  return entry.client.readResource({ uri });
}

// ─── Well-known server presets ────────────────────────────────────────────────
export const WELL_KNOWN_SERVERS = [
  {
    id: 'context7',
    name: 'Context7 Docs',
    description: 'Up-to-date library documentation for AI prompts',
    url: 'https://mcp.context7.com/mcp',
    transport: 'http',
  },
  {
    id: 'filesystem',
    name: 'MCP Filesystem',
    description: 'Official MCP filesystem server (read/write local files)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    transport: 'stdio',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via Brave API',
    url: 'https://mcp.bravesearch.com/mcp',
    transport: 'http',
  },
];
