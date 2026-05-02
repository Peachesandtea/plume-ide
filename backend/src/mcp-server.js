/**
 * Forge IDE — MCP Server
 *
 * Spec: 2025-03-26  (Streamable HTTP only)
 * Endpoint: POST http://127.0.0.1:3002/mcp
 *
 * All file/git/shell operations are delegated to fs-utils.js.
 * This file only owns MCP envelope shaping and HTTP transport.
 */

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fg from 'fast-glob';

import {
  getProjectRoot,
  rawRead, rawWrite, rawList, rawCreate, rawDelete, rawRename,
  rawSearch, rawGrep,
  rawGitStatus, rawGitDiff, rawGitCommit, rawGitStageAll,
  rawShell, execAsync,
} from './fs-utils.js';

const MCP_PORT = process.env.MCP_PORT || 3002;
const MCP_HOST = '127.0.0.1';

// ─── Build the MCP server ─────────────────────────────────────────────────────
// Pure tool/resource/prompt registration — transport is injected by caller.
// Called per-request (HTTP) or once (stdio) so it always reads getProjectRoot().
export function buildMcpServer() {
  const server = new McpServer({ name: 'forge-ide', version: '1.0.0' });

  // ── TOOLS ─────────────────────────────────────────────────────────────────

  server.registerTool('read_file', {
    title: 'Read File',
    description: 'Read the content of a file in the current project.',
    inputSchema: { path: z.string().describe('Relative path from project root') },
  }, async ({ path }) => {
    const text = await rawRead(path);
    return { content: [{ type: 'text', text }] };
  });

  server.registerTool('write_file', {
    title: 'Write File',
    description: 'Write or overwrite a file in the current project.',
    inputSchema: {
      path: z.string().describe('Relative path from project root'),
      content: z.string().describe('Full file content to write'),
    },
  }, async ({ path, content }) => {
    await rawWrite(path, content);
    return { content: [{ type: 'text', text: `Written ${path} (${content.length} bytes)` }] };
  });

  server.registerTool('create_file', {
    title: 'Create File or Directory',
    description: 'Create an empty file or directory.',
    inputSchema: {
      path: z.string().describe('Relative path from project root'),
      type: z.enum(['file', 'dir']).default('file'),
    },
  }, async ({ path, type }) => {
    await rawCreate(path, type);
    return { content: [{ type: 'text', text: `Created ${type}: ${path}` }] };
  });

  server.registerTool('delete_file', {
    title: 'Delete File or Directory',
    description: 'Delete a file or directory from the project.',
    inputSchema: { path: z.string().describe('Relative path from project root') },
  }, async ({ path }) => {
    await rawDelete(path);
    return { content: [{ type: 'text', text: `Deleted ${path}` }] };
  });

  server.registerTool('rename_file', {
    title: 'Rename or Move File',
    description: 'Rename or move a file or directory.',
    inputSchema: {
      old_path: z.string().describe('Current relative path'),
      new_path: z.string().describe('New relative path'),
    },
  }, async ({ old_path, new_path }) => {
    await rawRename(old_path, new_path);
    return { content: [{ type: 'text', text: `Renamed ${old_path} → ${new_path}` }] };
  });

  server.registerTool('list_dir', {
    title: 'List Directory',
    description: 'List files and directories in a project directory.',
    inputSchema: { path: z.string().default('').describe('Relative path from project root') },
  }, async ({ path }) => {
    const entries = await rawList(path);
    const lines = entries.map(e => `${e.type === 'dir' ? 'd' : 'f'} ${e.path}`);
    return { content: [{ type: 'text', text: lines.join('\n') || '(empty)' }] };
  });

  server.registerTool('search_files', {
    title: 'Search Files by Name',
    description: 'Find files whose names match a search query.',
    inputSchema: { query: z.string().describe('Filename query') },
  }, async ({ query }) => {
    const matches = await rawSearch(query);
    return { content: [{ type: 'text', text: matches.join('\n') || 'No matches found' }] };
  });

  server.registerTool('grep', {
    title: 'Search File Contents',
    description: 'Search for a text pattern across all project files.',
    inputSchema: {
      query: z.string().describe('Text pattern to search for'),
      case_sensitive: z.boolean().default(false),
    },
  }, async ({ query, case_sensitive }) => {
    const results = await rawGrep(query, '', case_sensitive);
    if (!results.length) return { content: [{ type: 'text', text: 'No matches found' }] };
    const text = results.map(r =>
      `${r.file}:\n${r.matches.map(m => `  ${m.line}: ${m.text}`).join('\n')}`
    ).join('\n\n');
    return { content: [{ type: 'text', text: text.slice(0, 8000) }] };
  });

  server.registerTool('git_status', {
    title: 'Git Status',
    description: 'Show the current git status of the project.',
    inputSchema: {},
  }, async () => {
    try {
      const { branch, files } = await rawGitStatus();
      const lines = files.map(f => `${f.xy} ${f.path}`).join('\n');
      return { content: [{ type: 'text', text: `Branch: ${branch}\n\n${lines || '(clean)'}` }] };
    } catch {
      return { content: [{ type: 'text', text: 'Not a git repository' }] };
    }
  });

  server.registerTool('git_commit', {
    title: 'Git Commit',
    description: 'Stage all changes and create a commit.',
    inputSchema: { message: z.string().describe('Commit message') },
  }, async ({ message }) => {
    await rawGitStageAll();
    const output = await rawGitCommit(message);
    return { content: [{ type: 'text', text: output }] };
  });

  server.registerTool('git_diff', {
    title: 'Git Diff',
    description: 'Show the diff for a file or the whole working tree.',
    inputSchema: {
      path: z.string().default('').describe('File path, or empty for all changes'),
      staged: z.boolean().default(false).describe('Show staged diff'),
    },
  }, async ({ path, staged }) => {
    try {
      const diff = await rawGitDiff(path, staged);
      return { content: [{ type: 'text', text: diff || '(no changes)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
    }
  });

  server.registerTool('shell_exec', {
    title: 'Execute Shell Command',
    description: 'Run a shell command in the project directory.',
    inputSchema: {
      command: z.string().describe('Shell command to execute'),
      cwd: z.string().default('').describe('Working directory relative to project root'),
    },
  }, async ({ command, cwd }) => {
    try {
      const { stdout, stderr } = await rawShell(command, cwd);
      return { content: [{ type: 'text', text: stdout || stderr || '(no output)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  // ── RESOURCES ──────────────────────────────────────────────────────────────

  server.registerResource('project-root', 'forge://project/root', {
    title: 'Project Root',
    description: 'The absolute path of the current project root directory.',
    mimeType: 'text/plain',
  }, async () => ({
    contents: [{ uri: 'forge://project/root', text: getProjectRoot(), mimeType: 'text/plain' }],
  }));

  server.registerResource('project-tree', 'forge://project/tree', {
    title: 'Project File Tree',
    description: 'All files in the project, excluding node_modules and .git.',
    mimeType: 'text/plain',
  }, async () => {
    const files = await fg('**/*', {
      cwd: getProjectRoot(), onlyFiles: false,
      ignore: ['**/node_modules/**', '**/.git/**', '**/.forge/**'],
    });
    return { contents: [{ uri: 'forge://project/tree', text: files.sort().join('\n'), mimeType: 'text/plain' }] };
  });

  // ── PROMPTS ────────────────────────────────────────────────────────────────

  server.registerPrompt('explain_file', {
    title: 'Explain File',
    description: 'Generate a prompt to explain what a file does.',
    argsSchema: { path: z.string() },
  }, async ({ path }) => {
    let content = '';
    try { content = await rawRead(path); } catch {}
    return { messages: [{ role: 'user', content: { type: 'text',
      text: `Explain what this file does:\n\nFile: ${path}\n\`\`\`\n${content.slice(0, 6000)}\n\`\`\`` } }] };
  });

  server.registerPrompt('fix_file', {
    title: 'Fix File',
    description: 'Generate a prompt to find and fix bugs in a file.',
    argsSchema: { path: z.string() },
  }, async ({ path }) => {
    let content = '';
    try { content = await rawRead(path); } catch {}
    return { messages: [{ role: 'user', content: { type: 'text',
      text: `Find and fix bugs in this file:\n\nFile: ${path}\n\`\`\`\n${content.slice(0, 6000)}\n\`\`\`` } }] };
  });

  return server;
}

// ─── Stdio transport (for in-process agent connection) ───────────────────────
// Returns a connected MCP client that speaks to forge-ide's tools over
// an in-memory stdio pipe — no HTTP, no subprocess, no port.
export async function createStdioServerTransport() {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return transport;
}

// ─── HTTP server (for external clients: Claude Desktop, Cursor, etc.) ────────
export async function startMcpServer(log) {
  const app = express();
  app.use(express.json());

  app.all('/mcp', async (req, res) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => `forge-${Date.now()}`,
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/health', (_, res) => res.json({
    status: 'ok', name: 'forge-ide', version: '1.0.0',
    spec: '2025-03-26',
    projectRoot: getProjectRoot(),
    endpoint: `http://${MCP_HOST}:${MCP_PORT}/mcp`,
  }));

  await new Promise((resolve, reject) => {
    const srv = app.listen(MCP_PORT, MCP_HOST, () => {
      log?.('info', `MCP server: http://${MCP_HOST}:${MCP_PORT}/mcp`);
      console.log(`🔌 MCP server: http://${MCP_HOST}:${MCP_PORT}/mcp`);
      resolve(srv);
    });
    srv.on('error', reject);
  });
}
