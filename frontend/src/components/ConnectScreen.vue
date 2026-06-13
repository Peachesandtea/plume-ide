<template>
  <div class="connect-screen">
    <div class="connect-card">
      <div class="connect-logo">⚡</div>
      <h1 class="connect-title">Forge IDE</h1>
      <p class="connect-sub">Connect to your local backend server</p>

      <!-- ── Launch Backend (Android + Termux only) ── -->
      <div v-if="termuxAvailable" class="launch-section">
        <div class="launch-heading">
          <span class="launch-dot" />
          Launch Backend
        </div>

        <div class="field-group">
          <label class="field-label">Backend Path</label>
          <input
            class="field-input"
            v-model="settings.backendPath"
            placeholder="/data/data/com.termux/files/home/backend"
            spellcheck="false"
            autocorrect="off"
            autocapitalize="none"
          />
        </div>

        <button
          class="launch-btn"
          :class="launchState"
          @click="launchBackend"
          :disabled="launching || !settings.backendPath.trim()"
        >
          <span v-if="launchState === 'idle'">▶ Start with Node</span>
          <span v-else-if="launchState === 'ok'">✓ Launched in Termux</span>
          <span v-else-if="launchState === 'err'">✕ Launch failed</span>
          <span v-else class="btn-spinner" />
        </button>

        <p v-if="launchError" class="connect-error">{{ launchError }}</p>
        <p v-if="launchState === 'ok'" class="connect-hint launch-hint">
          Switch to Termux to see the server output and copy the token below.
        </p>

        <div class="section-divider">then connect</div>
      </div>

      <!-- ── Connection fields ── -->
      <div class="field-group">
        <label class="field-label">Server URL</label>
        <input
          class="field-input"
          v-model="url"
          placeholder="ws://127.0.0.1:3001"
          :disabled="connecting"
        />
      </div>

      <p v-if="error" class="connect-error">{{ error }}</p>

      <button
        class="connect-btn"
        :class="{ loading: connecting }"
        @click="doConnect"
        :disabled="connecting"
      >
        <span v-if="!connecting">Connect</span>
        <span v-else class="btn-spinner" />
      </button>

      <p class="connect-hint">
        <template v-if="termuxAvailable">
          Launch the backend above, then connect.
        </template>
        <template v-else>
          Start the backend server, then connect.
        </template>
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useSocketStore } from '@/stores/socket.js';
import { useSettingsStore } from '@/stores/settings.js';
import { TermuxBridge } from '@/plugins/TermuxBridge.js';

const socket = useSocketStore();
const settings = useSettingsStore();

const url = ref('ws://127.0.0.1:3001');
const connecting = ref(false);
const error = ref('');

const termuxAvailable = ref(false);
const launching = ref(false);
const launchState = ref('idle'); // idle | loading | ok | err
const launchError = ref('');

onMounted(async () => {
  console.log('[TermuxBridge] platform:', Capacitor.getPlatform());
  console.log('[TermuxBridge] isNative:', Capacitor.isNativePlatform());
  console.log('[TermuxBridge] plugin object:', TermuxBridge);

  try {
    const result = await TermuxBridge.isTermuxInstalled();
    console.log('[TermuxBridge] isTermuxInstalled() =>', result);
    termuxAvailable.value = result.installed;
  } catch (e) {
    console.error('[TermuxBridge] isTermuxInstalled() threw:', e);
    termuxAvailable.value = false;
  }
});

async function launchBackend() {
  const path = settings.backendPath.trim();
  if (!path) return;

  launching.value = true;
  launchState.value = 'loading';
  launchError.value = '';

  try {
    await TermuxBridge.runTermuxCommand({
      command: `cd ${JSON.stringify(path)} && node src/index.js`,
      background: false,
    });
    launchState.value = 'ok';
  } catch (e) {
    launchState.value = 'err';
    launchError.value = e?.message ?? 'Failed to launch backend';
  } finally {
    launching.value = false;
  }
}

async function doConnect() {
  error.value = '';
  connecting.value = true;

  socket.connect(url.value);

  const timeout = setTimeout(() => {
    connecting.value = false;
    error.value = 'Connection timed out. Is the server running?';
    socket.disconnect();
  }, 8000);

  const unwatch = setInterval(() => {
    if (socket.status === 'connected') {
      clearInterval(unwatch);
      clearTimeout(timeout);
      connecting.value = false;
    } else if (socket.status === 'error') {
      clearInterval(unwatch);
      clearTimeout(timeout);
      connecting.value = false;
      error.value = socket.error || 'Connection failed';
    }
  }, 100);
}
</script>

<style scoped>
.connect-screen {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-void);
  padding: 24px;
  position: relative;
  overflow: hidden;
}

/* Subtle background grid */
.connect-screen::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--border-subtle) 1px, transparent 1px),
    linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
  background-size: 32px 32px;
  opacity: 0.4;
}

.connect-card {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-mid);
  border-radius: 16px;
  padding: 32px 28px;
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--border-subtle);
  animation: fadeIn 0.4s var(--ease-snap);
}

.connect-logo { font-size: 40px; text-align: center; }
.connect-title {
  font-family: var(--font-mono);
  font-size: 24px;
  font-weight: 600;
  text-align: center;
  color: var(--text-bright);
  letter-spacing: -0.02em;
}
.connect-sub {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  margin-top: -8px;
}

.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 11px; font-weight: 500; color: var(--text-muted); letter-spacing: 0.05em; text-transform: uppercase; }
.field-input {
  background: var(--bg-raised);
  border: 1px solid var(--border-mid);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  outline: none;
  width: 100%;
  transition: border-color 0.15s;
}
.field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
.field-input:disabled { opacity: 0.5; }


.connect-error {
  background: var(--red-dim);
  border: 1px solid var(--red);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--red);
}

.connect-btn {
  height: 44px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.connect-btn:hover:not(:disabled) { opacity: 0.9; }
.connect-btn:active:not(:disabled) { transform: scale(0.98); }
.connect-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-spinner {
  width: 18px; height: 18px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.connect-hint {
  font-size: 11px;
  color: var(--text-dim);
  text-align: center;
  line-height: 1.5;
}

/* ── Launch Backend section ── */
.launch-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 14px;
}

.launch-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.launch-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 6px var(--green);
  flex-shrink: 0;
}

.launch-btn {
  height: 40px;
  background: var(--bg-hover);
  border: 1px solid var(--border-mid);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  font-family: var(--font-mono);
}
.launch-btn:hover:not(:disabled) {
  background: var(--bg-overlay);
  border-color: var(--accent);
  color: var(--accent);
}
.launch-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.launch-btn.ok {
  border-color: var(--green);
  color: var(--green);
  background: var(--bg-raised);
}
.launch-btn.err {
  border-color: var(--red);
  color: var(--red);
  background: var(--bg-raised);
}

.launch-hint { margin-top: -4px; }

.section-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--text-dim);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-top: 2px;
}
.section-divider::before,
.section-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}
</style>
