import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

export const useSocketStore = defineStore('socket', () => {
  const ws = shallowRef(null);
  const status = ref('disconnected'); // disconnected | connecting | authenticating | connected | error
  const error = ref(null);
  const projectRoot = ref('');
  const platform = ref('');
  const pendingRequests = new Map();
  let msgIdCounter = 0;

  function connect(url, token) {
    if (ws.value?.readyState === WebSocket.OPEN) return;

    status.value = 'connecting';
    error.value = null;

    const socket = new WebSocket(url);
    ws.value = socket;

    socket.onopen = () => {
      status.value = 'authenticating';
      console.log('[WS] Connected, awaiting auth challenge...');
    };

    socket.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      // Auth flow
      if (msg.type === 'auth:challenge') {
        socket.send(JSON.stringify({ type: 'auth:token', token }));
        return;
      }
      if (msg.type === 'auth:ok') {
        status.value = 'connected';
        console.log('[WS] ✅ Authenticated');
        return;
      }
      if (msg.type === 'auth:fail') {
        status.value = 'error';
        error.value = 'Authentication failed — check your token';
        socket.close();
        return;
      }
      // Server info push (sent after auth:ok and after setRoot)
      if (msg.type === 'server:info') {
        projectRoot.value = msg.projectRoot || '';
        platform.value = msg.platform || '';
        hasAI.value = !!msg.hasAI;
        if (msg.aiModel) activeModel.value = msg.aiModel;
        if (msg.mcpPort) mcpPort.value = msg.mcpPort;
        console.log('[WS] Project root:', projectRoot.value);
        return;
      }

      // Route to pending request resolver
      if (msg.id && pendingRequests.has(msg.id)) {
        const { resolve, reject } = pendingRequests.get(msg.id);
        pendingRequests.delete(msg.id);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
        return;
      }

      // Push events (no id)
      window.dispatchEvent(new CustomEvent('forge:push', { detail: msg }));
    };

    socket.onclose = () => {
      status.value = 'disconnected';
      projectRoot.value = '';
      activeModel.value = '';
      // Reject all pending
      for (const [, { reject }] of pendingRequests) {
        reject(new Error('WebSocket closed'));
      }
      pendingRequests.clear();
      console.log('[WS] Disconnected');
    };

    socket.onerror = (e) => {
      status.value = 'error';
      error.value = 'Connection error';
      console.error('[WS] Error', e);
    };
  }

  function disconnect() {
    ws.value?.close();
  }

  // Send a request and await its response
  function request(type, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
        return reject(new Error('Not connected'));
      }
      if (status.value !== 'connected') {
        return reject(new Error('Not authenticated'));
      }
      const id = `req_${++msgIdCounter}`;
      pendingRequests.set(id, { resolve, reject });
      // Timeout after 30s
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error('Request timed out'));
        }
      }, 30000);
      ws.value.send(JSON.stringify({ id, type, payload }));
    });
  }

  // ─── FS API ───────────────────────────────────────────────────────────────
  const fs = {
    read: (path) => request('fs:read', { path }),
    write: (path, content) => request('fs:write', { path, content }),
    list: (path = '') => request('fs:list', { path }),
    create: (path, type = 'file') => request('fs:create', { path, type }),
    delete: (path) => request('fs:delete', { path }),
    rename: (oldPath, newPath) => request('fs:rename', { oldPath, newPath }),
    search: (query, path = '') => request('fs:search', { query, path }),
    grep: (query, path = '', caseSensitive = false) => request('fs:grep', { query, path, caseSensitive }),
    setRoot: (path) => request('fs:setRoot', { path }),
  };

  // ─── Git API ──────────────────────────────────────────────────────────────
  const git = {
    status: () => request('git:status'),
    diff: (path, staged = false) => request('git:diff', { path, staged }),
    log: (limit = 30) => request('git:log', { limit }),
    stage: (path) => request('git:stage', { path }),
    unstage: (path) => request('git:unstage', { path }),
    stageAll: () => request('git:stageAll'),
    commit: (message) => request('git:commit', { message }),
    push: (remote = 'origin', branch = '') => request('git:push', { remote, branch }),
    pull: () => request('git:pull'),
    branches: () => request('git:branches'),
    checkout: (branch) => request('git:checkout', { branch }),
    newBranch: (name, base = '') => request('git:newBranch', { name, base }),
  };

  // ─── Shell API ────────────────────────────────────────────────────────────
  const shell = {
    exec: (command, cwd = '') => request('shell:exec', { command, cwd }),
  };

  // ─── PTY API ──────────────────────────────────────────────────────────────
  const pty = {
    create: (sessionId) => request('pty:create', { sessionId }),
    write: (sessionId, data) => ws.value?.send(JSON.stringify({ type: 'pty:write', payload: { sessionId, data } })),
    resize: (sessionId, cols, rows) => ws.value?.send(JSON.stringify({ type: 'pty:resize', payload: { sessionId, cols, rows } })),
    kill: (sessionId) => ws.value?.send(JSON.stringify({ type: 'pty:kill', payload: { sessionId } })),
  };

  // ─── Snapshot API ─────────────────────────────────────────────────────────
  const snapshot = {
    create: (path, reason = 'manual') => request('snapshot:create', { path, reason }),
    list: (path) => request('snapshot:list', { path }),
    restore: (path, ts) => request('snapshot:restore', { path, ts }),
    delete: (path, ts) => request('snapshot:delete', { path, ts }),
  };

  // ─── AI API ───────────────────────────────────────────────────────────────
  // ai.run() sends a fire-and-forget message; responses come as push events
  const ai = {
    run: (skill, filePath, selection = null, context = []) => {
      if (!ws.value || ws.value.readyState !== WebSocket.OPEN) throw new Error('Not connected');
      const reqId = `ai_${++msgIdCounter}`;
      ws.value.send(JSON.stringify({ type: 'ai:run', payload: { skill, filePath, selection, context, reqId } }));
      return reqId;
    },
  };

  const hasAI = ref(false);
  const activeModel = ref('');
  const mcpPort = ref(3002);

  // Extend server:info handler to capture hasAI
  const _origConnect = connect;

  // ─── Agent API ────────────────────────────────────────────────────────────
  const agent = {
    run: (taskId, task, filePaths = []) => request('agent:run', { taskId, task, filePaths }),
    cancel: (taskId) => ws.value?.send(JSON.stringify({ type: 'agent:cancel', payload: { taskId } })),
  };

  // ─── Skills API (Skills Protocol compliant) ───────────────────────────────
  const skills = {
    // Direct JSON-RPC passthrough — use for list_skills, describe_skill, etc.
    rpc: (method, params = {}) => request('skills:rpc', { method, params }),
    // Convenience wrappers
    list: (namespace) => request('skills:rpc', { method: 'list_skills', params: { namespace, detail: 'summary' } }),
    describe: (name) => request('skills:rpc', { method: 'describe_skill', params: { name, detail: 'full' } }),
    readFile: (name, path) => request('skills:rpc', { method: 'read_skill_file', params: { name, path } }),
    execute: (name, args, inputBlobs) => request('skills:rpc', { method: 'execute_skill', params: { name, args, input_blobs: inputBlobs } }),
    runCode: (language, code, args, entrypoint) => request('skills:rpc', { method: 'run_code', params: { language, code, args, entrypoint } }),
    createBlob: (content, kind) => request('skills:rpc', { method: 'create_blob', params: { content, kind } }),
    readBlob: (blobId) => request('skills:rpc', { method: 'read_blob', params: { blob_id: blobId } }),
    // Scaffold a new skill directory
    create: (name, kind, description, language) => request('skills:create', { name, kind, description, language }),
    delete: (name) => request('skills:delete', { name }),
  };

  // ─── Pins API ─────────────────────────────────────────────────────────────
  const pins = {
    get: () => request('pins:get'),
    set: (paths) => request('pins:set', { paths }),
  };

  // ─── MCP API ──────────────────────────────────────────────────────────────
  const mcp = {
    connect: (config) => request('mcp:connect', config),
    disconnect: (id) => request('mcp:disconnect', { id }),
    list: () => request('mcp:list'),
    tools: () => request('mcp:tools'),
    call: (serverId, tool, args = {}) => request('mcp:call', { serverId, tool, args }),
    resource: (serverId, uri) => request('mcp:resource', { serverId, uri }),
    presets: () => request('mcp:presets'),
  };

  return { status, error, projectRoot, platform, hasAI, activeModel, mcpPort, connect, disconnect, request, fs, git, shell, pty, snapshot, ai, agent, skills, pins, mcp };
});
