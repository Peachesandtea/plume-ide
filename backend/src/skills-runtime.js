/**
 * Forge IDE — Skills Runtime
 *
 * Implements the Skills Protocol specification (skillsprotocol.com)
 * Endpoint: POST http://127.0.0.1:3003/rpc  (JSON-RPC 2.0)
 *
 * Exposes all 8 protocol tools:
 *   Discovery:  list_skills, describe_skill, read_skill_file
 *   Execution:  execute_skill, run_code
 *   Blobs:      create_blob, read_blob
 *   Bootstrap:  load_skills_protocol_guide
 *
 * Skill structure on disk (.forge/skills/<name>/):
 *   skill.toml   — machine-readable manifest (required)
 *   SKILL.md     — LLM-readable instructions (required)
 *   code/        — executable implementation (action skills)
 *   resources/   — supporting files
 */

import express from 'express';
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative } from 'path';
import { randomBytes } from 'crypto';
import vm from 'vm';
import { getProjectRoot, setProjectRoot as _setRoot, execAsync } from './fs-utils.js';

const SKILLS_PORT = process.env.SKILLS_PORT || 3003;
const SKILLS_HOST = '127.0.0.1';

// Delegate to fs-utils so all modules share one root
export function setSkillsProjectRoot(root) { _setRoot(root); }

function skillsDir() { return join(getProjectRoot(), '.forge', 'skills'); }
function blobsDir()  { return join(getProjectRoot(), '.forge', 'blobs'); }

// ─── TOML parser (minimal — only what skill.toml needs) ──────────────────────
function parseToml(text) {
  const result = {};
  let currentSection = result;
  let currentKey = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Section header [section]
    const sectionMatch = line.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      const key = sectionMatch[1];
      result[key] = result[key] || {};
      currentSection = result[key];
      continue;
    }

    // Key = value
    const kvMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const k = kvMatch[1];
      let v = kvMatch[2].trim();
      // Strip quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      // Array
      else if (v.startsWith('[') && v.endsWith(']')) {
        v = v.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      }
      currentSection[k] = v;
    }
  }
  return result;
}

// ─── Skill loading ────────────────────────────────────────────────────────────
async function loadSkillManifest(name) {
  const dir = join(skillsDir(), name);
  const tomlPath = join(dir, 'skill.toml');
  if (!existsSync(tomlPath)) throw { code: -32602, message: `Skill not found: ${name}` };
  const toml = parseToml(await readFile(tomlPath, 'utf-8'));
  return { ...toml, _dir: dir };
}

async function listAllSkills() {
  const dir = skillsDir();
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const skills = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const tomlPath = join(dir, e.name, 'skill.toml');
    if (!existsSync(tomlPath)) continue;
    try {
      const toml = parseToml(await readFile(tomlPath, 'utf-8'));
      skills.push({
        name: toml.name || e.name,
        version: toml.version || '0.1.0',
        description: toml.description || '',
        namespace: toml.namespace || toml.name?.split('.')[0] || '',
        kind: toml.kind || 'instruction',
        tags: toml.tags || [],
      });
    } catch {}
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Blob storage ─────────────────────────────────────────────────────────────
async function ensureBlobsDir() { await mkdir(blobsDir(), { recursive: true }); }

async function createBlob(content, kind = 'text/plain') {
  await ensureBlobsDir();
  const id = randomBytes(8).toString('hex');
  const blobId = `blob:${id}`;
  await writeFile(join(blobsDir(), id), JSON.stringify({ kind, content }), 'utf-8');
  return { blob_id: blobId, size_bytes: Buffer.byteLength(content, 'utf-8') };
}

async function readBlob(blobId, mode = 'sample_head', maxBytes = 2000) {
  const id = blobId.replace('blob:', '');
  const path = join(blobsDir(), id);
  if (!existsSync(path)) throw { code: -32602, message: `Blob not found: ${blobId}` };
  const { kind, content } = JSON.parse(await readFile(path, 'utf-8'));
  const preview = mode === 'full' ? content : content.slice(0, maxBytes);
  return { blob_id: blobId, kind, preview, size_bytes: Buffer.byteLength(content, 'utf-8'), truncated: content.length > maxBytes };
}

async function resolveBlobArg(val) {
  if (typeof val === 'string' && val.startsWith('blob:')) {
    const { preview } = await readBlob(val, 'full');
    return preview;
  }
  return val;
}

// ─── Skill execution ──────────────────────────────────────────────────────────
async function executeSkillAction(manifest, args, inputBlobs, timeoutMs = 30000) {
  const runtime = manifest.runtime;
  if (!runtime) throw { code: -32602, message: `Skill ${manifest.name} has no runtime` };

  const runId = `run_${randomBytes(4).toString('hex')}`;
  const startMs = Date.now();

  // Resolve blob args
  const resolvedArgs = {};
  for (const [k, v] of Object.entries(args || {})) {
    resolvedArgs[k] = await resolveBlobArg(v);
  }

  // Mount input blobs as resolved strings
  for (const blobId of (inputBlobs || [])) {
    const key = blobId.replace('blob:', '');
    if (!resolvedArgs[key]) {
      try { resolvedArgs[key] = (await readBlob(blobId, 'full')).preview; } catch {}
    }
  }

  const entrypoint = join(manifest._dir, runtime.entrypoint);
  if (!existsSync(entrypoint)) {
    throw { code: -32602, message: `Entrypoint not found: ${runtime.entrypoint}` };
  }

  const lang = runtime.language || 'python';
  let stdout = '', stderr = '', exitCode = 0;

  if (lang === 'python') {
    // Write args as JSON to a temp file, run via python
    const argsFile = join(manifest._dir, `.forge_args_${runId}.json`);
    await writeFile(argsFile, JSON.stringify(resolvedArgs), 'utf-8');
    const wrapper = `
import json, sys
sys.path.insert(0, '${manifest._dir}')
with open('${argsFile}') as f:
    args = json.load(f)
from ${runtime.entrypoint.replace('.py','').replace('code/','code.')} import ${runtime.export || 'main'}
result = ${runtime.export || 'main'}(args)
print(json.dumps(result))
`;
    try {
      const res = await execAsync(`python3 -c "${wrapper.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`, {
        cwd: manifest._dir, timeout: timeoutMs,
      });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (err) {
      stderr = err.stderr || err.message;
      exitCode = 1;
    } finally {
      try { await import('fs/promises').then(m => m.unlink(argsFile)); } catch {}
    }
  } else if (lang === 'javascript' || lang === 'js') {
    // Use Node vm sandbox
    try {
      const code = await readFile(entrypoint, 'utf-8');
      const logs = [];
      const sandbox = {
        args: resolvedArgs,
        console: { log: (...a) => logs.push(a.map(String).join(' ')), error: (...a) => logs.push(a.map(String).join(' ')) },
        require, process: { env: process.env },
        result: null,
      };
      const script = new vm.Script(`
        (function() {
          ${code}
          result = (typeof ${runtime.export || 'main'} === 'function')
            ? ${runtime.export || 'main'}(args)
            : null;
        })();
      `);
      script.runInNewContext(sandbox, { timeout: timeoutMs });
      stdout = JSON.stringify(await sandbox.result);
      stderr = logs.join('\n');
    } catch (err) {
      stderr = err.message;
      exitCode = 1;
    }
  } else if (lang === 'shell' || lang === 'bash') {
    try {
      const res = await execAsync(
        `bash "${entrypoint}" '${JSON.stringify(resolvedArgs).replace(/'/g, "'\\''")}'`,
        { cwd: manifest._dir, timeout: timeoutMs }
      );
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (err) {
      stderr = err.stderr || err.message;
      exitCode = 1;
    }
  }

  const elapsed = Date.now() - startMs;

  if (exitCode !== 0) {
    return {
      status: 'failed', run_id: runId,
      summary: `Skill failed after ${elapsed}ms`,
      output: null,
      output_blobs: [],
      logs_preview: stderr.slice(0, 2000),
      error: { message: stderr.slice(0, 500), exitCode },
    };
  }

  let output = null;
  try { output = JSON.parse(stdout.trim()); } catch { output = { raw: stdout.trim().slice(0, 4000) }; }

  // Store large output as blob
  const outputBlobs = [];
  if (stdout.length > 4096) {
    const { blob_id } = await createBlob(stdout, 'application/json');
    outputBlobs.push(blob_id);
    output = { blob: blob_id, summary: `${stdout.length} bytes stored as blob` };
  }

  return {
    status: 'completed', run_id: runId,
    summary: `Completed in ${elapsed}ms`,
    output,
    output_blobs: outputBlobs,
    logs_preview: stderr.slice(0, 2000),
  };
}

// ─── run_code: execute LLM-written code in a sandbox ─────────────────────────
async function runCode({ language, code, entrypoint = 'main', args = {}, mountSkills = [], inputBlobs = [], limits = {} }) {
  const runId = `run_${randomBytes(4).toString('hex')}`;
  const timeoutMs = limits.timeout_ms || 30000;

  // Resolve blob args
  const resolvedArgs = { ...args };
  for (const [k, v] of Object.entries(args)) resolvedArgs[k] = await resolveBlobArg(v);
  for (const blobId of inputBlobs) {
    const key = blobId.replace('blob:', '');
    if (!resolvedArgs[key]) try { resolvedArgs[key] = (await readBlob(blobId, 'full')).preview; } catch {}
  }

  if (language === 'javascript' || language === 'js') {
    try {
      const logs = [];
      const sandbox = {
        args: resolvedArgs, result: null,
        console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
        require, process: { env: process.env },
      };
      const script = new vm.Script(`
        (function(){
          ${code}
          result = (typeof ${entrypoint} === 'function') ? ${entrypoint}(args) : null;
        })();
      `);
      script.runInNewContext(sandbox, { timeout: timeoutMs });
      const output = await sandbox.result;
      return { status: 'completed', run_id: runId, summary: 'Code executed successfully', output, output_blobs: [], logs_preview: logs.join('\n').slice(0, 2000) };
    } catch (err) {
      return { status: 'failed', run_id: runId, summary: err.message, output: null, output_blobs: [], logs_preview: err.message, error: { message: err.message } };
    }
  }

  if (language === 'python') {
    const tmpFile = join(getProjectRoot(), `.forge_run_${runId}.py`);
    await writeFile(tmpFile, code, 'utf-8');
    try {
      const argsJson = JSON.stringify(resolvedArgs).replace(/"/g, '\\"');
      const { stdout, stderr } = await execAsync(
        `python3 -c "import json; import importlib.util; spec=importlib.util.spec_from_file_location('m','${tmpFile}'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print(json.dumps(m.${entrypoint}(json.loads('${argsJson}'))))"`,
        { cwd: getProjectRoot(), timeout: timeoutMs }
      );
      let output = null;
      try { output = JSON.parse(stdout.trim()); } catch { output = { raw: stdout.trim() }; }
      return { status: 'completed', run_id: runId, summary: 'Code executed', output, output_blobs: [], logs_preview: stderr.slice(0, 2000) };
    } catch (err) {
      return { status: 'failed', run_id: runId, summary: err.message, output: null, output_blobs: [], logs_preview: (err.stderr || err.message).slice(0, 2000), error: { message: err.message } };
    } finally {
      try { await import('fs/promises').then(m => m.unlink(tmpFile)); } catch {}
    }
  }

  return { status: 'failed', run_id: runId, summary: `Unsupported language: ${language}`, output: null, output_blobs: [], logs_preview: '' };
}

// ─── JSON-RPC 2.0 dispatcher ──────────────────────────────────────────────────
async function dispatch(method, params = {}) {
  switch (method) {

    case 'list_skills': {
      const all = await listAllSkills();
      const ns = params.namespace;
      const filtered = ns ? all.filter(s => s.namespace === ns || s.name.startsWith(ns + '.')) : all;
      const detail = params.detail || 'names';
      const limit = params.limit || 50;
      const skills = filtered.slice(0, limit).map(s =>
        detail === 'names' ? { name: s.name, version: s.version } : s
      );
      return { skills, next_cursor: filtered.length > limit ? String(limit) : null };
    }

    case 'describe_skill': {
      if (!params.name) throw { code: -32602, message: "Missing 'name'" };
      const manifest = await loadSkillManifest(params.name);
      const detail = params.detail || 'summary';
      if (detail === 'manifest') return { manifest };
      // Read SKILL.md for summary/full
      const skillMdPath = join(manifest._dir, 'SKILL.md');
      const skillMd = existsSync(skillMdPath) ? await readFile(skillMdPath, 'utf-8') : '';
      const summary = detail === 'full' ? skillMd : skillMd.slice(0, 500);
      return { manifest, skill_md_preview: summary };
    }

    case 'read_skill_file': {
      if (!params.name) throw { code: -32602, message: "Missing 'name'" };
      if (!params.path) throw { code: -32602, message: "Missing 'path'" };
      const manifest = await loadSkillManifest(params.name);
      // Prevent path traversal
      const resolved = join(manifest._dir, params.path);
      if (!resolved.startsWith(manifest._dir)) throw { code: -32602, message: 'Path traversal denied' };
      if (!existsSync(resolved)) throw { code: -32602, message: `File not found: ${params.path}` };
      const content = await readFile(resolved, 'utf-8');
      return { name: params.name, path: params.path, content };
    }

    case 'execute_skill': {
      if (!params.name) throw { code: -32602, message: "Missing 'name'" };
      const manifest = await loadSkillManifest(params.name);
      if (manifest.kind === 'instruction') {
        throw { code: -32602, message: `Skill '${params.name}' is an instruction skill and cannot be executed` };
      }
      return executeSkillAction(manifest, params.args || {}, params.input_blobs || [], params.timeout_ms);
    }

    case 'run_code': {
      if (!params.language) throw { code: -32602, message: "Missing 'language'" };
      if (!params.code) throw { code: -32602, message: "Missing 'code'" };
      return runCode(params);
    }

    case 'create_blob': {
      if (!params.content) throw { code: -32602, message: "Missing 'content'" };
      return createBlob(params.content, params.kind || 'text/plain');
    }

    case 'read_blob': {
      if (!params.blob_id) throw { code: -32602, message: "Missing 'blob_id'" };
      return readBlob(params.blob_id, params.mode, params.max_bytes);
    }

    case 'load_skills_protocol_guide': {
      return {
        guide: `# Skills Protocol Guide

The Skills Runtime exposes 8 tools:

**Discovery**
- list_skills({namespace?, detail?, limit?}) → {skills[], next_cursor}
- describe_skill({name, detail?}) → {manifest, skill_md_preview}
- read_skill_file({name, path}) → {content}

**Execution**
- execute_skill({name, args?, input_blobs?, timeout_ms?}) → Run
- run_code({language, code, entrypoint?, args?, limits?}) → Run

**Blobs**
- create_blob({content, kind}) → {blob_id, size_bytes}
- read_blob({blob_id, mode?, max_bytes?}) → {preview, kind, truncated}

**Run response shape:**
{ status, run_id, summary, output, output_blobs[], logs_preview }

All calls use JSON-RPC 2.0: POST /rpc with {"jsonrpc":"2.0","method":"...","params":{...},"id":"1"}
`,
        endpoint: `http://${SKILLS_HOST}:${SKILLS_PORT}/rpc`,
        version: '1.0.0',
      };
    }

    default:
      throw { code: -32601, message: `Method not found: ${method}` };
  }
}

// ─── Express HTTP server ──────────────────────────────────────────────────────
export async function startSkillsRuntime(log) {
  // Ensure skills directory exists
  await mkdir(join(getProjectRoot(), '.forge', 'skills'), { recursive: true });
  await mkdir(blobsDir(), { recursive: true });

  const app = express();
  app.use(express.json());

  // JSON-RPC 2.0 endpoint
  app.post('/rpc', async (req, res) => {
    const body = req.body;

    // Validate JSON-RPC envelope
    if (!body || body.jsonrpc !== '2.0' || !body.method) {
      return res.status(200).json({
        jsonrpc: '2.0', id: body?.id ?? null,
        error: { code: -32600, message: 'Invalid Request' },
      });
    }

    try {
      const result = await dispatch(body.method, body.params || {});
      res.json({ jsonrpc: '2.0', id: body.id, result });
    } catch (err) {
      const isRpcError = typeof err.code === 'number';
      res.json({
        jsonrpc: '2.0', id: body.id,
        error: isRpcError ? err : { code: -32603, message: String(err.message || err) },
      });
    }
  });

  // Health
  app.get('/health', (_, res) => res.json({
    status: 'ok', name: 'forge-skills-runtime', version: '1.0.0',
    spec: 'skillsprotocol.com',
    projectRoot: getProjectRoot(),
    endpoint: `http://${SKILLS_HOST}:${SKILLS_PORT}/rpc`,
  }));

  await new Promise((resolve, reject) => {
    const srv = app.listen(SKILLS_PORT, SKILLS_HOST, () => {
      log?.('info', `Skills runtime: http://${SKILLS_HOST}:${SKILLS_PORT}/rpc`);
      console.log(`⚡ Skills runtime: http://${SKILLS_HOST}:${SKILLS_PORT}/rpc`);
      resolve(srv);
    });
    srv.on('error', reject);
  });
}

// ─── Node.js API (used by index.js directly, not over HTTP) ──────────────────
export { listAllSkills, loadSkillManifest, dispatch as skillsDispatch };
