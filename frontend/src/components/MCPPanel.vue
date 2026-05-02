<template>
  <div class="mcp-panel">
    <!-- Header -->
    <div class="mcp-header">
      <div class="mcp-title-row">
        <span class="mcp-icon">🔌</span>
        <span class="mcp-title">MCP Servers</span>
        <a href="https://modelcontextprotocol.io" target="_blank" class="mcp-spec-link">spec ↗</a>
      </div>
      <div class="mcp-subtitle">
        Connect to external MCP servers to give the agent additional tools and data.
        Forge also runs its own MCP server on <code>http://127.0.0.1:{{ mcpPort }}/mcp</code>.
      </div>
    </div>

    <!-- Self-hosted server info -->
    <div class="mcp-self-server">
      <div class="mcp-self-row">
        <span class="self-dot connected" />
        <span class="self-label">Forge IDE MCP Server</span>
        <span class="self-port">:{{ mcpPort }}</span>
        <span class="self-badge">running</span>
      </div>
      <div class="self-endpoints">
        <span class="endpoint">POST /mcp</span>
        <span class="endpoint-sep">·</span>
        <span class="endpoint">GET /health</span>
      </div>
      <div class="self-tools">
        {{ FORGE_TOOLS.length }} tools: {{ FORGE_TOOLS.join(', ') }}
      </div>
    </div>

    <!-- Context7 cache status -->
    <div v-if="isConnected('context7')" class="c7-cache-bar">
      <span class="c7-label">⚡ Context7 cache</span>
      <span class="c7-count">{{ cacheStats.entries || 0 }} entries</span>
      <button class="c7-clear" @click="clearCache">Clear</button>
    </div>

    <!-- Presets -->
    <div class="mcp-section-label">Quick Connect</div>
    <div class="preset-grid">
      <button
        v-for="preset in presets"
        :key="preset.id"
        class="preset-card"
        :class="{ connected: isConnected(preset.id) }"
        @click="togglePreset(preset)"
      >
        <span class="preset-status">{{ isConnected(preset.id) ? '✓' : '+' }}</span>
        <span class="preset-name">{{ preset.name }}</span>
        <span class="preset-desc">{{ preset.description }}</span>
      </button>
    </div>

    <!-- Custom server form -->
    <div class="mcp-section-label">Custom Server</div>
    <div class="custom-form">
      <input class="mcp-input" v-model="customId" placeholder="Server ID (e.g. my-server)" />
      <input class="mcp-input" v-model="customUrl" placeholder="URL or command (e.g. https://… or npx my-mcp)" />
      <select class="mcp-select" v-model="customTransport">
        <option value="auto">Auto-detect</option>
        <option value="http">Streamable HTTP</option>
        <option value="stdio">stdio (local process)</option>
      </select>
      <button class="mcp-btn primary" @click="connectCustom" :disabled="!customId || !customUrl || connecting">
        {{ connecting ? 'Connecting…' : 'Connect' }}
      </button>
    </div>

    <!-- Connected servers list -->
    <div class="mcp-section-label">
      Connected ({{ connections.length }})
      <button class="refresh-btn" @click="loadConnections" title="Refresh">↺</button>
    </div>

    <div v-if="connections.length === 0" class="mcp-empty">
      No servers connected. Use quick connect or add a custom server above.
    </div>

    <div v-for="conn in connections" :key="conn.id" class="mcp-conn">
      <div class="conn-header" @click="toggleExpand(conn.id)">
        <span class="conn-dot" :class="conn.status" />
        <span class="conn-id">{{ conn.id }}</span>
        <span class="conn-url truncate">{{ conn.url }}</span>
        <span class="conn-tools">{{ conn.toolCount }} tools</span>
        <button class="conn-disconnect" @click.stop="disconnect(conn.id)" title="Disconnect">✕</button>
      </div>

      <!-- Error -->
      <div v-if="conn.error" class="conn-error">{{ conn.error }}</div>

      <!-- Expanded tools list -->
      <div v-if="expanded.has(conn.id) && conn.tools?.length" class="conn-tools-list">
        <div v-for="tool in conn.tools" :key="tool.name" class="tool-row">
          <span class="tool-name">{{ tool.name }}</span>
          <span class="tool-desc">{{ tool.description }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useSocketStore } from '@/stores/socket.js';

const socket = useSocketStore();

const connections = ref([]);
const presets = ref([]);
const expanded = ref(new Set());
const connecting = ref(false);
const customId = ref('');
const customUrl = ref('');
const customTransport = ref('auto');

const mcpPort = computed(() => socket.mcpPort || 3002);

const FORGE_TOOLS = [
  'read_file', 'write_file', 'create_file', 'delete_file', 'rename_file',
  'list_dir', 'search_files', 'grep', 'git_status', 'git_diff', 'git_commit', 'shell_exec',
];

const cacheStats = ref({ entries: 0, libs: [] });

onMounted(async () => {
  await loadConnections();
  await loadPresets();
  await loadCacheStats();
  window.addEventListener('forge:mcp-status', onMcpStatus);
});

async function loadCacheStats() {
  try { cacheStats.value = await socket.request('context7:stats') || { entries: 0, libs: [] }; } catch {}
}

async function clearCache() {
  try { await socket.request('context7:clear'); cacheStats.value = { entries: 0, libs: [] }; } catch {}
}

onBeforeUnmount(() => {
  window.removeEventListener('forge:mcp-status', onMcpStatus);
});

function onMcpStatus() {
  loadConnections();
}

async function loadConnections() {
  try { connections.value = await socket.mcp.list(); } catch {}
}

async function loadPresets() {
  try { presets.value = await socket.mcp.presets(); } catch {}
}

function isConnected(id) {
  return connections.value.some(c => c.id === id && c.status === 'connected');
}

async function togglePreset(preset) {
  if (isConnected(preset.id)) {
    await disconnect(preset.id);
  } else {
    connecting.value = true;
    try {
      await socket.mcp.connect(preset);
      await loadConnections();
    } catch {}
    connecting.value = false;
  }
}

async function connectCustom() {
  if (!customId.value || !customUrl.value) return;
  connecting.value = true;
  const config = {
    id: customId.value.trim(),
    transport: customTransport.value,
  };
  if (customTransport.value === 'stdio') {
    const [cmd, ...args] = customUrl.value.trim().split(' ');
    config.command = cmd;
    config.args = args;
  } else {
    config.url = customUrl.value.trim();
  }
  try {
    await socket.mcp.connect(config);
    await loadConnections();
    customId.value = '';
    customUrl.value = '';
  } catch {}
  connecting.value = false;
}

async function disconnect(id) {
  await socket.mcp.disconnect(id);
  connections.value = connections.value.filter(c => c.id !== id);
}

function toggleExpand(id) {
  const s = new Set(expanded.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  expanded.value = s;
}
</script>

<style scoped>
.mcp-panel { display: flex; flex-direction: column; gap: 0; }

.mcp-header { padding: 12px 16px 8px; }
.mcp-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.mcp-icon { font-size: 16px; }
.mcp-title { font-size: 14px; font-weight: 600; color: var(--text-bright); flex: 1; }
.mcp-spec-link { font-size: 11px; color: var(--accent); text-decoration: none; }
.mcp-spec-link:hover { text-decoration: underline; }
.mcp-subtitle { font-size: 11px; color: var(--text-muted); line-height: 1.5; }
.mcp-subtitle code { font-family: var(--font-mono); color: var(--accent-bright); }

/* Self server */
.mcp-self-server {
  margin: 0 16px 8px;
  background: var(--bg-raised);
  border: 1px solid var(--border-mid);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex; flex-direction: column; gap: 3px;
}
.mcp-self-row { display: flex; align-items: center; gap: 6px; }
.self-dot { width: 7px; height: 7px; border-radius: 50%; }
.self-dot.connected { background: var(--green); box-shadow: 0 0 4px var(--green); }
.self-label { font-size: 12px; font-weight: 600; color: var(--text-primary); flex: 1; }
.self-port { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); }
.self-badge {
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  background: var(--green-dim); color: var(--green);
  padding: 1px 5px; border-radius: 4px;
}
.self-endpoints { font-size: 10px; color: var(--text-dim); font-family: var(--font-mono); }
.endpoint { color: var(--accent-bright); }
.endpoint-sep { color: var(--text-dim); margin: 0 3px; }
.self-tools { font-size: 10px; color: var(--text-dim); font-family: var(--font-mono); word-break: break-all; line-height: 1.4; }

.mcp-section-label {
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--text-dim);
  padding: 10px 16px 4px;
  display: flex; align-items: center; gap: 6px;
}
.refresh-btn {
  background: none; border: none; color: var(--text-dim); cursor: pointer;
  font-size: 13px; padding: 0 2px; border-radius: 3px;
}
.refresh-btn:hover { color: var(--text-primary); }

/* Presets */
.preset-grid { display: flex; flex-direction: column; gap: 4px; padding: 0 16px 4px; }
.preset-card {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: var(--bg-raised); border: 1px solid var(--border-subtle);
  border-radius: 8px; cursor: pointer; text-align: left;
  transition: background 0.1s, border-color 0.1s;
}
.preset-card:hover { background: var(--bg-hover); border-color: var(--border-mid); }
.preset-card.connected { border-color: var(--green); background: var(--green-dim); }
.preset-status { font-size: 12px; font-weight: 700; width: 16px; flex-shrink: 0; color: var(--text-muted); }
.preset-card.connected .preset-status { color: var(--green); }
.preset-name { font-size: 12px; font-weight: 600; color: var(--text-primary); flex-shrink: 0; }
.preset-desc { font-size: 11px; color: var(--text-muted); flex: 1; }

/* Custom form */
.custom-form { padding: 0 16px 4px; display: flex; flex-direction: column; gap: 6px; }
.mcp-input {
  background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 7px; padding: 7px 10px;
  color: var(--text-primary); font-family: var(--font-mono); font-size: 12px;
  outline: none; transition: border-color 0.15s;
}
.mcp-input:focus { border-color: var(--accent); }
.mcp-select {
  background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 7px; padding: 7px 10px;
  color: var(--text-primary); font-size: 12px; outline: none;
}
.mcp-btn {
  padding: 7px 14px; border-radius: 7px; border: none;
  font-size: 12px; font-weight: 500; cursor: pointer;
  transition: opacity 0.15s;
}
.mcp-btn.primary { background: var(--accent); color: white; }
.mcp-btn.primary:hover:not(:disabled) { opacity: 0.85; }
.mcp-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.mcp-empty { padding: 12px 16px; font-size: 12px; color: var(--text-dim); text-align: center; }

.c7-cache-bar {
  display: flex; align-items: center; gap: 8px;
  margin: 0 16px 6px;
  padding: 5px 10px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  font-size: 11px;
}
.c7-label { color: var(--accent-bright); flex: 1; }
.c7-count { color: var(--text-muted); }
.c7-clear {
  background: none; border: none; color: var(--text-dim);
  cursor: pointer; font-size: 11px; padding: 1px 5px;
  border-radius: 3px;
}
.c7-clear:hover { background: var(--red-dim); color: var(--red); }

/* Connections */
.mcp-conn { border-top: 1px solid var(--border-subtle); }
.conn-header {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 16px; cursor: pointer;
  transition: background 0.1s;
}
.conn-header:hover { background: var(--bg-raised); }
.conn-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--text-dim); }
.conn-dot.connected { background: var(--green); }
.conn-dot.connecting { background: var(--yellow); animation: pulse-glow 1s infinite; }
.conn-dot.error { background: var(--red); }
.conn-id { font-size: 12px; font-weight: 600; color: var(--text-primary); flex-shrink: 0; }
.conn-url { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); flex: 1; }
.conn-tools { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }
.conn-disconnect {
  background: none; border: none; color: var(--text-dim); cursor: pointer;
  font-size: 11px; padding: 2px 5px; border-radius: 3px;
}
.conn-disconnect:hover { background: var(--red-dim); color: var(--red); }
.conn-error { padding: 4px 16px 6px; font-size: 11px; color: var(--red); font-family: var(--font-mono); }
.conn-tools-list { padding: 0 16px 8px; display: flex; flex-direction: column; gap: 2px; }
.tool-row { display: flex; align-items: baseline; gap: 8px; padding: 2px 0; }
.tool-name { font-family: var(--font-mono); font-size: 11px; color: var(--accent-bright); flex-shrink: 0; }
.tool-desc { font-size: 11px; color: var(--text-muted); }
</style>
