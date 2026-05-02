import { WebSocketServer, WebSocket } from 'ws';
import { mkdir, writeFile } from 'fs/promises';  // only for absolute-path scaffold/snapshot dirs
import { existsSync } from 'fs';
import { join, relative, basename } from 'path';
import { randomBytes } from 'crypto';
import chokidar from 'chokidar';
import { createRequire } from 'module';

// ─── Shared utilities (single source of truth) ───────────────────────────────
import {
  setProjectRoot, getProjectRoot, safePath,
  rawRead, rawWrite, rawList, rawCreate, rawDelete, rawRename,
  rawSearch, rawGrep,
  rawGitStatus, rawGitDiff, rawGitLog,
  rawGitStage, rawGitStageAll, rawGitUnstage,
  rawGitCommit, rawGitPush, rawGitPull,
  rawGitBranches, rawGitCheckout, rawGitNewBranch,
  rawShell, execAsync,
} from './fs-utils.js';

import { runAgent } from './agent.js';
import { fetchContext7Snippet, clearContext7Cache, getContext7CacheStats } from './context7.js';
import { startMcpServer, buildMcpServer } from './mcp-server.js';
import {
  connectMcpServer, connectInProcess, disconnectMcpServer, listMcpConnections,
  callMcpTool, getAllMcpTools, readMcpResource, setBroadcast,
  WELL_KNOWN_SERVERS,
} from './mcp-client.js';
import {
  startSkillsRuntime,
  listAllSkills, skillsDispatch,
} from './skills-runtime.js';

const require = createRequire(import.meta.url);

const PORT  = process.env.PORT  || 3001;
const HOST  = '127.0.0.1';
const SECRET_TOKEN      = process.env.FORGE_TOKEN      || generateToken();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
let   currentModel      = process.env.AI_MODEL         || 'claude-opus-4-5';

// ─── Logging ──────────────────────────────────────────────────────────────────
let loggingEnabled = true;

function log(level, msg, data = null) {
  const entry = { ts: Date.now(), level, msg, data };
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️ ' : level === 'info' ? 'ℹ️ ' : '📝';
  if (data) console.log(`${prefix} [forge] ${msg}`, data);
  else      console.log(`${prefix} [forge] ${msg}`);
  if (loggingEnabled) broadcast({ type: 'server:log', entry });
}

function logChange(action, details) {
  if (!loggingEnabled) return;
  const msg = `${action}: ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  log('change', msg, typeof details === 'object' ? details : null);
}

function generateToken() {
  const token = randomBytes(32).toString('hex');
  console.log(`\n🔑 FORGE AUTH TOKEN: ${token}\n`);
  return token;
}

// ─── Authenticated clients ────────────────────────────────────────────────────
const authenticatedClients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of authenticatedClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function serverInfo() {
  return {
    type: 'server:info',
    projectRoot: getProjectRoot(),
    platform: process.platform,
    hasAI: !!ANTHROPIC_API_KEY,
    aiModel: currentModel,
    mcpPort: Number(process.env.MCP_PORT || 3002),
    skillsPort: Number(process.env.SKILLS_PORT || 3003),
  };
}

// ─── File Watcher ─────────────────────────────────────────────────────────────
let watcher = null;
function startWatcher(root) {
  if (watcher) watcher.close();
  watcher = chokidar.watch(root, {
    ignored: /(^|[/\\])(\.git|node_modules|\.DS_Store|\.forge)/,
    persistent: true, ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  });
  const debounced = new Map();
  function notify(event, absPath) {
    const rel = relative(root, absPath);
    const key = `${event}:${rel}`;
    if (debounced.has(key)) clearTimeout(debounced.get(key));
    debounced.set(key, setTimeout(() => {
      debounced.delete(key);
      broadcast({ type: 'fs:changed', event, path: rel });
    }, 150));
  }
  watcher
    .on('add',       p => notify('add', p))
    .on('change',    p => notify('change', p))
    .on('unlink',    p => notify('unlink', p))
    .on('addDir',    p => notify('addDir', p))
    .on('unlinkDir', p => notify('unlinkDir', p));
  console.log(`👁  Watching: ${root}`);
}

// ─── PTY Sessions ─────────────────────────────────────────────────────────────
const ptySessions = new Map();

function createPtySession(sessionId, ws) {
  try {
    const nodePty = require('node-pty');
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : 'bash');
    const pty = nodePty.spawn(shell, [], {
      name: 'xterm-256color', cols: 80, rows: 24,
      cwd: getProjectRoot(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    pty.onData(data => {
      const session = ptySessions.get(sessionId);
      if (!session) return;
      for (const client of session.clients) send(client, { type: 'pty:data', sessionId, data });
    });
    pty.onExit(({ exitCode }) => {
      const session = ptySessions.get(sessionId);
      if (!session) return;
      for (const client of session.clients) send(client, { type: 'pty:exit', sessionId, exitCode });
      ptySessions.delete(sessionId);
    });
    ptySessions.set(sessionId, { pty, clients: new Set([ws]) });
    return { ok: true, sessionId };
  } catch (err) {
    return { ok: false, error: err.message, fallback: true };
  }
}

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ host: HOST, port: PORT });
console.log(`🔥 Forge IDE backend running on ws://${HOST}:${PORT}`);
console.log(`📁 Project root: ${getProjectRoot()}\n`);
startWatcher(getProjectRoot());
setBroadcast(broadcast);

startMcpServer(log).catch(err => console.warn(`⚠️  MCP server failed: ${err.message}`));
startSkillsRuntime(log).catch(err => console.warn(`⚠️  Skills runtime failed: ${err.message}`));

// Connect forge-ide in-process over stdio so the agent calls MCP tools
// with zero HTTP overhead and a single canonical implementation.
connectInProcess('forge-ide', buildMcpServer).then(result => {
  if (result.status === 'connected') {
    console.log(`🔗 forge-ide MCP: in-process stdio (${result.tools.length} tools)`);
  } else {
    console.warn(`⚠️  forge-ide in-process MCP failed: ${result.error}`);
  }
}).catch(err => console.warn(`⚠️  forge-ide MCP setup error: ${err.message}`));

wss.on('connection', (ws, req) => {
  const clientId = randomBytes(8).toString('hex');
  console.log(`[${clientId}] Connected`);
  send(ws, { type: 'auth:challenge', clientId });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return sendError(ws, null, 'Invalid JSON'); }

    if (msg.type === 'auth:token') {
      if (msg.token === SECRET_TOKEN) {
        authenticatedClients.add(ws);
        send(ws, { type: 'auth:ok', clientId });
        send(ws, serverInfo());
        console.log(`[${clientId}] Authenticated`);
      } else {
        send(ws, { type: 'auth:fail', error: 'Invalid token' });
        ws.close();
      }
      return;
    }
    if (!authenticatedClients.has(ws)) return sendError(ws, msg.id, 'Unauthorized');
    await handleMessage(ws, msg, clientId);
  });

  ws.on('close', () => {
    authenticatedClients.delete(ws);
    for (const [, session] of ptySessions) session.clients.delete(ws);
  });
  ws.on('error', e => console.error(`[${clientId}] Error:`, e.message));
});

// ─── Message Router ───────────────────────────────────────────────────────────
async function handleMessage(ws, msg, clientId) {
  const { id, type, payload } = msg;
  try {
    switch (type) {
      // FS
      case 'fs:read':         return send(ws, { id, result: await fsRead(payload) });
      case 'fs:write':        return send(ws, { id, result: await fsWrite(payload) });
      case 'fs:list':         return send(ws, { id, result: await fsList(payload) });
      case 'fs:create':       return send(ws, { id, result: await fsCreate(payload) });
      case 'fs:delete':       return send(ws, { id, result: await fsDelete(payload) });
      case 'fs:rename':       return send(ws, { id, result: await fsRename(payload) });
      case 'fs:search':       return send(ws, { id, result: await fsSearch(payload) });
      case 'fs:grep':         return send(ws, { id, result: await fsGrep(payload) });
      case 'fs:setRoot':      return send(ws, { id, result: await fsSetRoot(payload) });
      // Git
      case 'git:status':      return send(ws, { id, result: await gitStatus() });
      case 'git:diff':        return send(ws, { id, result: await gitDiff(payload) });
      case 'git:log':         return send(ws, { id, result: await gitLog(payload) });
      case 'git:stage':       return send(ws, { id, result: await gitStage(payload) });
      case 'git:unstage':     return send(ws, { id, result: await gitUnstage(payload) });
      case 'git:stageAll':    return send(ws, { id, result: await gitStageAll() });
      case 'git:commit':      return send(ws, { id, result: await gitCommit(payload) });
      case 'git:push':        return send(ws, { id, result: await gitPush(payload) });
      case 'git:pull':        return send(ws, { id, result: await gitPull() });
      case 'git:branches':    return send(ws, { id, result: await gitBranches() });
      case 'git:checkout':    return send(ws, { id, result: await gitCheckout(payload) });
      case 'git:newBranch':   return send(ws, { id, result: await gitNewBranch(payload) });
      // PTY
      case 'pty:create':      return send(ws, { id, result: createPtySession(payload.sessionId || randomBytes(4).toString('hex'), ws) });
      case 'pty:write':       ptySessions.get(payload.sessionId)?.pty?.write(payload.data); return;
      case 'pty:resize':      ptySessions.get(payload.sessionId)?.pty?.resize(payload.cols, payload.rows); return;
      case 'pty:kill':        ptySessions.get(payload.sessionId)?.pty?.kill(); ptySessions.delete(payload.sessionId); return;
      case 'pty:join':        ptySessions.get(payload.sessionId)?.clients?.add(ws); return;
      // Snapshots
      case 'snapshot:create': return send(ws, { id, result: await snapshotCreate(payload) });
      case 'snapshot:list':   return send(ws, { id, result: await snapshotList(payload) });
      case 'snapshot:restore':return send(ws, { id, result: await snapshotRestore(payload) });
      case 'snapshot:delete': return send(ws, { id, result: await snapshotDelete(payload) });
      // AI
      case 'ai:run':          return aiRun(payload, ws, id);
      // Agent
      case 'agent:run':       return agentRun(payload, ws, id);
      case 'agent:cancel':    activeAgents.delete(payload.taskId); return;
      // Skills Protocol
      case 'skills:rpc':      return send(ws, { id, result: await skillsDispatch(payload.method, payload.params) });
      case 'skills:list':     return send(ws, { id, result: await listAllSkills() });
      case 'skills:create':   return send(ws, { id, result: await createSkillScaffold(payload) });
      case 'skills:delete':   return send(ws, { id, result: await deleteSkillDir(payload) });
      // Context pins
      case 'pins:set':        return send(ws, { id, result: setPins(payload.paths) });
      case 'pins:get':        return send(ws, { id, result: { paths: pinnedPaths } });
      // MCP client
      case 'mcp:connect':     return send(ws, { id, result: await connectMcpServer(payload) });
      case 'mcp:disconnect':  return send(ws, { id, result: await disconnectMcpServer(payload.id) });
      case 'mcp:list':        return send(ws, { id, result: listMcpConnections() });
      case 'mcp:tools':       return send(ws, { id, result: getAllMcpTools() });
      case 'mcp:call':        return send(ws, { id, result: await callMcpTool(payload.serverId, payload.tool, payload.args) });
      case 'mcp:resource':    return send(ws, { id, result: await readMcpResource(payload.serverId, payload.uri) });
      case 'mcp:presets':     return send(ws, { id, result: WELL_KNOWN_SERVERS });
      // Context7 cache
      case 'context7:stats':  return send(ws, { id, result: getContext7CacheStats() });
      case 'context7:clear':  clearContext7Cache(); return send(ws, { id, result: { cleared: true } });
      // Settings
      case 'settings:setLog': {
        loggingEnabled = !!payload.enabled;
        console.log(`📝 [forge] Logging ${loggingEnabled ? 'enabled' : 'disabled'}`);
        return send(ws, { id, result: { loggingEnabled } });
      }
      case 'settings:setModel': {
        const VALID = ['claude-opus-4-6','claude-sonnet-4-6','claude-opus-4-5','claude-sonnet-4-5','claude-haiku-4-5-20251001'];
        if (!VALID.includes(payload.model)) return sendError(ws, id, `Unknown model: ${payload.model}`);
        currentModel = payload.model;
        logChange('settings:setModel', { model: currentModel });
        return send(ws, { id, result: { model: currentModel } });
      }
      // Shell
      case 'shell:exec':      return send(ws, { id, result: await shellExec(payload) });
      default: sendError(ws, id, `Unknown: ${type}`);
    }
  } catch (err) {
    console.error(`[${clientId}] ${type}:`, err.message);
    sendError(ws, id, err.message);
  }
}

// ─── FS handlers (thin wrappers over fs-utils) ────────────────────────────────
async function fsRead({ path }) {
  const content = await rawRead(path);
  return { path, content };
}
async function fsWrite({ path, content }) {
  await rawWrite(path, content);
  logChange('fs:write', { path, bytes: content.length });
  return { path, saved: true, timestamp: Date.now() };
}
async function fsList({ path = '' } = {}) {
  return { path, entries: await rawList(path) };
}
async function fsCreate({ path, type = 'file' }) {
  await rawCreate(path, type);
  logChange('fs:create', { path, type });
  return { path, type, created: true };
}
async function fsDelete({ path }) {
  await rawDelete(path);
  logChange('fs:delete', { path });
  return { path, deleted: true };
}
async function fsRename({ oldPath, newPath }) {
  await rawRename(oldPath, newPath);
  logChange('fs:rename', { oldPath, newPath });
  return { oldPath, newPath, renamed: true };
}
async function fsSearch({ query, path = '' }) {
  return { query, matches: await rawSearch(query, path) };
}
async function fsGrep({ query, path = '', caseSensitive = false }) {
  return { query, results: await rawGrep(query, path, caseSensitive) };
}
async function fsSetRoot({ path }) {
  const { stat } = await import('fs/promises');
  const s = await stat(path);
  if (!s.isDirectory()) throw new Error('Not a directory');
  setProjectRoot(path);
  startWatcher(path);
  logChange('fs:setRoot', { path });
  broadcast(serverInfo());
  return { projectRoot: path };
}

// ─── Git handlers (thin wrappers over fs-utils) ───────────────────────────────
async function gitStatus() {
  try   { return { ...await rawGitStatus(), error: null }; }
  catch { return { branch: null, files: [], ahead: 0, behind: 0, error: 'Not a git repo' }; }
}
async function gitDiff({ path, staged = false }) {
  try   { return { path, diff: await rawGitDiff(path, staged), staged }; }
  catch (err) { return { path, diff: '', error: err.message }; }
}
async function gitLog({ limit = 30 } = {}) {
  try   { return { commits: await rawGitLog(limit) }; }
  catch { return { commits: [] }; }
}
async function gitStage({ path }) {
  await rawGitStage(path);
  logChange('git:stage', { path });
  return { path, staged: true };
}
async function gitStageAll() {
  await rawGitStageAll();
  logChange('git:stageAll', 'all');
  return { staged: true };
}
async function gitUnstage({ path }) {
  await rawGitUnstage(path);
  logChange('git:unstage', { path });
  return { path, unstaged: true };
}
async function gitCommit({ message }) {
  const output = await rawGitCommit(message);
  logChange('git:commit', { message });
  return { committed: true, output };
}
async function gitPush({ remote = 'origin', branch = '' } = {}) {
  const output = await rawGitPush(remote, branch);
  logChange('git:push', { remote, branch });
  return { pushed: true, output };
}
async function gitPull() {
  const output = await rawGitPull();
  logChange('git:pull', 'pull --rebase');
  return { pulled: true, output };
}
async function gitBranches() {
  try   { return await rawGitBranches(); }
  catch { return { current: '', local: [], remote: [] }; }
}
async function gitCheckout({ branch }) {
  const output = await rawGitCheckout(branch);
  logChange('git:checkout', { branch });
  return { branch, output };
}
async function gitNewBranch({ name, base = '' }) {
  await rawGitNewBranch(name, base);
  logChange('git:newBranch', { name });
  return { name, created: true };
}

// ─── Shell ────────────────────────────────────────────────────────────────────
async function shellExec({ command, cwd = '' }) {
  const { stdout, stderr } = await rawShell(command, cwd);
  return { command, stdout, stderr };
}

// ─── Snapshots ────────────────────────────────────────────────────────────────
function snapshotDir() { return join(getProjectRoot(), '.forge', 'snapshots'); }

async function snapshotCreate({ path, reason = 'manual' }) {
  const content = await rawRead(path);
  const dir = join(snapshotDir(), path);
  await mkdir(dir, { recursive: true });
  const ts = Date.now();
  await rawWrite(
    relative(getProjectRoot(), join(dir, `${ts}.snap`)).replace(/\\/g, '/'),
    JSON.stringify({ path, content, ts, reason })
  );
  logChange('snapshot:create', { path, reason });
  return { path, ts };
}
async function snapshotList({ path }) {
  const dir = join(snapshotDir(), path);
  if (!existsSync(dir)) return { path, snapshots: [] };
  const { readdir: rd } = await import('fs/promises');
  const files = await rd(dir);
  const snaps = await Promise.all(
    files.filter(f => f.endsWith('.snap')).sort().reverse().slice(0, 20).map(async (f) => {
      const raw = await rawRead(relative(getProjectRoot(), join(dir, f)));
      const { ts, reason } = JSON.parse(raw);
      return { ts, reason, file: f };
    })
  );
  return { path, snapshots: snaps };
}
async function snapshotRestore({ path, ts }) {
  const dir = join(snapshotDir(), path);
  const raw = await rawRead(relative(getProjectRoot(), join(dir, `${ts}.snap`)));
  const { content } = JSON.parse(raw);
  await snapshotCreate({ path, reason: 'pre-restore' });
  await rawWrite(path, content);
  logChange('snapshot:restore', { path, ts });
  return { path, restored: true, ts };
}
async function snapshotDelete({ path, ts }) {
  const dir = join(snapshotDir(), path);
  await rawDelete(relative(getProjectRoot(), join(dir, `${ts}.snap`)));
  return { path, ts, deleted: true };
}

// ─── AI ───────────────────────────────────────────────────────────────────────
async function aiRun({ skill, filePath, selection, context = [] }, ws, reqId) {
  if (!ANTHROPIC_API_KEY) { sendError(ws, reqId, 'ANTHROPIC_API_KEY not set'); return; }

  let fileContent = '';
  try { fileContent = await rawRead(filePath); } catch {}

  const skillPrompts = {
    explain:  'Explain what this code does clearly and concisely. Focus on the purpose, logic flow, and any non-obvious parts.',
    fix:      'Find and fix any bugs, errors, or issues in this code. Return ONLY the corrected code with no explanation, wrapped in a code block.',
    refactor: 'Refactor this code to improve readability, maintainability, and performance. Return ONLY the refactored code with no explanation, wrapped in a code block.',
    docs:     'Add comprehensive JSDoc/docstring comments to this code. Return ONLY the commented code with no explanation, wrapped in a code block.',
    tests:    'Write unit tests for this code. Return ONLY the test code with no explanation, wrapped in a code block.',
    optimize: 'Optimize this code for performance. Return ONLY the optimized code with no explanation, wrapped in a code block.',
  };

  const targetCode = selection || fileContent;
  const basePrompt = skillPrompts[skill] || skill;
  const fileName   = filePath ? basename(filePath) : 'code';

  const context7Snippet = await fetchContext7Snippet(targetCode, fileName, callMcpTool);
  const systemPrompt = context7Snippet ? `${basePrompt}${context7Snippet}` : basePrompt;

  const messages = [
    ...context,
    { role: 'user', content: `File: ${fileName}\n\n\`\`\`\n${targetCode}\n\`\`\`` },
  ];

  send(ws, { type: 'ai:start', reqId, skill, filePath });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: currentModel, max_tokens: 4096, system: systemPrompt, messages, stream: true }),
    });
    if (!response.ok) throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);

    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            fullText += evt.delta.text;
            send(ws, { type: 'ai:delta', reqId, delta: evt.delta.text });
          }
        } catch {}
      }
    }
    const codeMatch = fullText.match(/```(?:\w+)?\n([\s\S]*?)```/);
    send(ws, { type: 'ai:done', reqId, text: fullText, code: codeMatch?.[1]?.trim() ?? null, filePath, skill });
  } catch (err) {
    send(ws, { type: 'ai:error', reqId, error: err.message });
  }
}

// ─── Agent ────────────────────────────────────────────────────────────────────
const activeAgents = new Map();

async function agentRun({ taskId, task, filePaths = [] }, ws, reqId) {
  if (!ANTHROPIC_API_KEY) { sendError(ws, reqId, 'ANTHROPIC_API_KEY not set'); return; }
  send(ws, { id: reqId, result: { taskId, started: true } });

  const emit = (event) => {
    send(ws, { type: 'agent:event', taskId, event });
    logChange('agent', `${event.type}${event.tool ? `:${event.tool}` : ''}`);
  };

  activeAgents.set(taskId, true);
  try {
    await runAgent({
      task, filePaths,
      pinnedContext: pinnedPaths,
      projectRoot: getProjectRoot(),
      apiKey: ANTHROPIC_API_KEY,
      model: currentModel,
      // forge-ide is called directly via callMcpTool('forge-ide', ...) inside the agent.
      // Only pass truly external servers here so the model sees them as optional extras.
      mcpTools: getAllMcpTools().filter(t => t.serverId !== 'forge-ide'),
      callMcpTool,
    }, emit);
  } catch (err) {
    emit({ type: 'agent:error', error: err.message });
  } finally {
    activeAgents.delete(taskId);
  }
}

// ─── Context Pins ─────────────────────────────────────────────────────────────
let pinnedPaths = [];
function setPins(paths) {
  pinnedPaths = Array.isArray(paths) ? paths : [];
  logChange('pins:set', { paths: pinnedPaths });
  return { paths: pinnedPaths };
}

// ─── Skills ───────────────────────────────────────────────────────────────────
async function createSkillScaffold({ name, kind = 'instruction', description = '', language = 'javascript' }) {
  if (!name || !/^[a-z0-9]+(\.[a-z0-9]+)*$/.test(name)) {
    throw new Error('Skill name must be lowercase dot-notation (e.g. my.skill.name)');
  }
  const base = join(getProjectRoot(), '.forge', 'skills', name);
  await mkdir(join(base, 'code'), { recursive: true });
  await mkdir(join(base, 'resources'), { recursive: true });

  const runtimeSection = kind === 'action'
    ? `\n[runtime]\nlanguage   = "${language}"\nentrypoint = "code/main.${language === 'python' ? 'py' : 'js'}"\nexport     = "main"\n`
    : '';

  await writeFile(join(base, 'skill.toml'),
`name        = "${name}"
version     = "0.1.0"
description = "${description || `A Forge skill: ${name}`}"
kind        = "${kind}"
${runtimeSection}
[inputs]
`, 'utf-8');

  await writeFile(join(base, 'SKILL.md'),
`---
name: ${name}
short_description: ${description || name}
tags: []
---

# ${name}

${description || 'Describe what this skill does.'}
`, 'utf-8');

  if (kind === 'action') {
    const stub = language === 'python'
      ? `def main(args):\n    return {'status': 'completed', 'args': args}\n`
      : `function main(args) {\n  return { status: 'completed', args };\n}\nmodule.exports = { main };\n`;
    await writeFile(join(base, 'code', language === 'python' ? 'main.py' : 'main.js'), stub, 'utf-8');
  }

  logChange('skills:create', { name, kind });
  return { name, kind, dir: relative(getProjectRoot(), base), created: true };
}

async function deleteSkillDir({ name }) {
  const dir = join(getProjectRoot(), '.forge', 'skills', name);
  const { rmdir } = await import('fs/promises');
  await rmdir(dir, { recursive: true });
  logChange('skills:delete', { name });
  return { name, deleted: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function sendError(ws, id, error) { send(ws, { id, error }); }
