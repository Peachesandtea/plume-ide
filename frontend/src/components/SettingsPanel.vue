<template>
  <Teleport to="body">
    <div class="settings-panel" :class="{ open: modelValue }">
      <!-- Header -->
      <div class="settings-header">
        <button class="settings-back" @click="$emit('update:modelValue', false)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <span class="settings-title">Settings</span>
        <span class="settings-version">Forge IDE</span>
      </div>

      <div class="settings-body">

        <!-- ── Editor ───────────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="section-label">Editor</div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Font Size</span>
              <span class="setting-desc">Editor font size in pixels</span>
            </div>
            <div class="setting-control">
              <button class="stepper-btn" @click="settings.fontSize = Math.max(10, settings.fontSize - 1)">−</button>
              <span class="stepper-val">{{ settings.fontSize }}</span>
              <button class="stepper-btn" @click="settings.fontSize = Math.min(24, settings.fontSize + 1)">+</button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Tab Size</span>
              <span class="setting-desc">Spaces per indent level</span>
            </div>
            <div class="setting-control">
              <button class="stepper-btn" @click="settings.tabSize = Math.max(1, settings.tabSize - 1)">−</button>
              <span class="stepper-val">{{ settings.tabSize }}</span>
              <button class="stepper-btn" @click="settings.tabSize = Math.min(8, settings.tabSize + 1)">+</button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Word Wrap</span>
              <span class="setting-desc">Wrap long lines in the editor</span>
            </div>
            <Toggle v-model="settings.wordWrap" />
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Auto-save Delay</span>
              <span class="setting-desc">Milliseconds after last keystroke</span>
            </div>
            <select class="setting-select" v-model="settings.autoSaveDelay">
              <option :value="500">500ms</option>
              <option :value="1000">1s</option>
              <option :value="2000">2s</option>
              <option :value="5000">5s</option>
            </select>
          </div>
        </div>

        <!-- ── Terminal ─────────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="section-label">Terminal</div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Font Size</span>
              <span class="setting-desc">Terminal font size in pixels</span>
            </div>
            <div class="setting-control">
              <button class="stepper-btn" @click="settings.termFontSize = Math.max(10, settings.termFontSize - 1)">−</button>
              <span class="stepper-val">{{ settings.termFontSize }}</span>
              <button class="stepper-btn" @click="settings.termFontSize = Math.min(24, settings.termFontSize + 1)">+</button>
            </div>
          </div>
        </div>

        <!-- ── AI ───────────────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="section-label">AI</div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Model</span>
              <span class="setting-desc">Anthropic model used for all AI skills</span>
            </div>
            <select class="setting-select model-select" v-model="settings.aiModel">
              <optgroup label="Claude 4.6">
                <option value="claude-opus-4-6">Opus 4.6 — most capable</option>
                <option value="claude-sonnet-4-6">Sonnet 4.6 — fast &amp; smart</option>
              </optgroup>
              <optgroup label="Claude 4.5">
                <option value="claude-opus-4-5">Opus 4.5</option>
                <option value="claude-sonnet-4-5">Sonnet 4.5</option>
                <option value="claude-haiku-4-5-20251001">Haiku 4.5 — fastest</option>
              </optgroup>
            </select>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Active model</span>
              <span class="setting-desc">Model currently in use on the server</span>
            </div>
            <span class="model-badge">{{ socketStore.activeModel || settings.aiModel }}</span>
          </div>

          <div class="setting-row col">
            <div class="setting-info">
              <span class="setting-name">Anthropic API Key</span>
              <span class="setting-desc">Set via <code>ANTHROPIC_API_KEY</code> env var on the server, or paste here to send at connect-time.</span>
            </div>
            <div class="api-key-wrap">
              <input
                class="setting-input"
                :type="showKey ? 'text' : 'password'"
                v-model="settings.anthropicKey"
                placeholder="sk-ant-…"
                spellcheck="false"
                autocomplete="off"
              />
              <button class="eye-btn" @click="showKey = !showKey">{{ showKey ? '🙈' : '👁' }}</button>
            </div>
            <p class="setting-note">
              <span :class="socketStore.hasAI ? 'status-ok' : 'status-off'">
                {{ socketStore.hasAI ? '✓ AI active on server' : '✗ AI not active on server' }}
              </span>
            </p>
          </div>
        </div>

        <!-- ── MCP Servers ───────────────────────────────────────────── -->
        <div class="settings-section">
          <MCPPanel />
        </div>

        <!-- ── Server Logging ────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="section-label">Server Logging</div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Enable Logging</span>
              <span class="setting-desc">Stream server activity (writes, git ops, AI) to the log below</span>
            </div>
            <Toggle v-model="settings.serverLogging" />
          </div>

          <!-- Log viewer -->
          <div class="log-viewer">
            <div class="log-toolbar">
              <span class="log-count">{{ settings.serverLogs.length }} entries</span>
              <button class="log-clear" @click="settings.clearLogs()">Clear</button>
            </div>
            <div class="log-list" ref="logListEl">
              <div v-if="settings.serverLogs.length === 0" class="log-empty">
                {{ settings.serverLogging ? 'No activity yet' : 'Logging is disabled' }}
              </div>
              <div
                v-for="entry in settings.serverLogs"
                :key="entry.ts"
                class="log-entry"
                :class="`level-${entry.level}`"
              >
                <span class="log-ts">{{ formatTs(entry.ts) }}</span>
                <span class="log-level">{{ entry.level }}</span>
                <span class="log-msg">{{ entry.msg }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Connection ────────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="section-label">Connection</div>

          <div class="setting-row col">
            <div class="setting-info">
              <span class="setting-name">Project Root</span>
              <span class="setting-desc">Current working directory on the server</span>
            </div>
            <div class="setting-value-row">
              <code class="setting-path">{{ socketStore.projectRoot || 'Not connected' }}</code>
              <button class="setting-link" @click="$emit('open-root')">Change</button>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Server Status</span>
              <span class="setting-desc">WebSocket connection state</span>
            </div>
            <span class="status-chip" :class="socketStore.status">{{ socketStore.status }}</span>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-name">Platform</span>
              <span class="setting-desc">Server operating system</span>
            </div>
            <span class="setting-tag">{{ socketStore.platform || '—' }}</span>
          </div>
        </div>

        <!-- ── About ─────────────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="section-label">About</div>
          <div class="about-card">
            <div class="about-logo">⚡</div>
            <div class="about-info">
              <p class="about-name">Forge IDE</p>
              <p class="about-sub">Phase 3 · Mobile-first AI IDE</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue';
import { useSettingsStore } from '@/stores/settings.js';
import { useSocketStore } from '@/stores/socket.js';
import MCPPanel from './MCPPanel.vue';

defineProps({ modelValue: Boolean });
defineEmits(['update:modelValue', 'open-root']);

const settings = useSettingsStore();
const socketStore = useSocketStore();
const showKey = ref(false);
const logListEl = ref(null);

function formatTs(ts) {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

// Simple inline Toggle component
const Toggle = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: `
    <button
      class="toggle"
      :class="{ on: modelValue }"
      @click="$emit('update:modelValue', !modelValue)"
      role="switch"
      :aria-checked="modelValue"
    >
      <span class="toggle-thumb" />
    </button>
  `,
};
</script>

<style>
.settings-panel {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--bg-base);
  z-index: 10002;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.settings-panel.open { transform: translateX(0); }

.settings-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.settings-back {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 7px;
  color: var(--text-secondary); cursor: pointer;
  transition: background 0.15s;
}
.settings-back:hover { background: var(--bg-hover); color: var(--text-primary); }
.settings-title {
  font-size: 16px; font-weight: 600;
  color: var(--text-bright); flex: 1;
}
.settings-version {
  font-size: 11px; color: var(--text-dim);
  font-family: var(--font-mono);
}

.settings-body {
  flex: 1; overflow-y: auto;
  padding-bottom: 40px;
}

/* Sections */
.settings-section {
  border-bottom: 1px solid var(--border-subtle);
  padding: 8px 0;
}
.section-label {
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--text-dim);
  padding: 10px 16px 4px;
}

/* Rows */
.setting-row {
  display: flex; align-items: center;
  padding: 12px 16px; gap: 12px;
  transition: background 0.1s;
}
.setting-row.col { flex-direction: column; align-items: stretch; gap: 8px; }
.setting-row:hover { background: rgba(255,255,255,0.02); }
.setting-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.setting-name { font-size: 13px; color: var(--text-primary); }
.setting-desc { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
.setting-desc code { font-family: var(--font-mono); color: var(--accent); }

/* Controls */
.setting-control {
  display: flex; align-items: center; gap: 8px; flex-shrink: 0;
}
.stepper-btn {
  width: 28px; height: 28px;
  background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 6px; color: var(--text-primary); font-size: 16px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 0.1s;
}
.stepper-btn:hover { background: var(--bg-hover); }
.stepper-val {
  font-family: var(--font-mono); font-size: 13px;
  color: var(--text-primary); min-width: 24px; text-align: center;
}

.setting-select {
  background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 6px; padding: 5px 8px;
  color: var(--text-primary); font-size: 12px;
  outline: none; cursor: pointer;
}

/* Toggle */
.toggle {
  width: 42px; height: 24px; border-radius: 12px;
  background: var(--bg-overlay); border: 1px solid var(--border-mid);
  cursor: pointer; position: relative;
  transition: background 0.2s, border-color 0.2s;
  flex-shrink: 0;
}
.toggle.on { background: var(--accent); border-color: var(--accent); }
.toggle-thumb {
  position: absolute;
  top: 2px; left: 2px;
  width: 18px; height: 18px;
  background: white; border-radius: 50%;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
}
.toggle.on .toggle-thumb { transform: translateX(18px); }

/* API Key */
.api-key-wrap { position: relative; display: flex; }
.setting-input {
  flex: 1; background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 8px; padding: 8px 36px 8px 10px;
  color: var(--text-primary); font-family: var(--font-mono); font-size: 12px;
  outline: none; transition: border-color 0.15s;
}
.setting-input:focus { border-color: var(--accent); }
.eye-btn {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; font-size: 14px;
}
.setting-note { font-size: 11px; }
.status-ok { color: var(--green); }
.status-off { color: var(--text-dim); }

/* Log viewer */
.log-viewer {
  margin: 4px 16px 8px;
  background: var(--bg-void);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  overflow: hidden;
}
.log-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 10px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
}
.log-count { font-size: 11px; color: var(--text-dim); }
.log-clear {
  background: none; border: none;
  font-size: 11px; color: var(--text-muted); cursor: pointer;
  padding: 2px 6px; border-radius: 4px;
  transition: background 0.1s;
}
.log-clear:hover { background: var(--red-dim); color: var(--red); }
.log-list {
  max-height: 220px; overflow-y: auto;
  font-family: var(--font-mono); font-size: 11px;
}
.log-empty { padding: 12px; text-align: center; color: var(--text-dim); }
.log-entry {
  display: flex; gap: 8px; align-items: baseline;
  padding: 3px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.02);
  transition: background 0.1s;
}
.log-entry:hover { background: var(--bg-surface); }
.log-ts { color: var(--text-dim); flex-shrink: 0; }
.log-level {
  flex-shrink: 0; width: 44px;
  font-weight: 600; font-size: 10px; text-transform: uppercase;
}
.log-msg { color: var(--text-secondary); flex: 1; white-space: pre-wrap; word-break: break-all; }
.level-change .log-level { color: var(--accent); }
.level-info   .log-level { color: var(--blue); }
.level-warn   .log-level { color: var(--yellow); }
.level-error  .log-level { color: var(--red); }

/* Misc */
.model-badge {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--accent-dim);
  color: var(--accent-bright);
  border: 1px solid var(--accent-dim);
  padding: 3px 8px;
  border-radius: 6px;
  flex-shrink: 0;
  white-space: nowrap;
}
.model-select {
  max-width: 200px;
}
.setting-value-row {
  display: flex; align-items: center; gap: 10px;
}
.setting-path {
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-muted); flex: 1;
  background: var(--bg-raised); padding: 4px 8px;
  border-radius: 5px; word-break: break-all;
}
.setting-link {
  background: none; border: none;
  color: var(--accent); font-size: 12px; cursor: pointer;
  text-decoration: underline; flex-shrink: 0;
}
.setting-tag {
  font-family: var(--font-mono); font-size: 11px;
  background: var(--bg-overlay); color: var(--text-secondary);
  padding: 3px 8px; border-radius: 5px; flex-shrink: 0;
}
.status-chip {
  font-size: 10px; font-weight: 600; padding: 2px 8px;
  border-radius: 8px; text-transform: uppercase; flex-shrink: 0;
}
.status-chip.connected { background: var(--green-dim); color: var(--green); }
.status-chip.disconnected { background: var(--bg-overlay); color: var(--text-dim); }
.status-chip.error { background: var(--red-dim); color: var(--red); }

/* About */
.about-card {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 16px;
}
.about-logo { font-size: 32px; }
.about-name { font-size: 14px; font-weight: 600; color: var(--text-bright); }
.about-sub { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
</style>
