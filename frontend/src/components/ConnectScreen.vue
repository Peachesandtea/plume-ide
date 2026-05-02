<template>
  <div class="connect-screen">
    <div class="connect-card">
      <div class="connect-logo">⚡</div>
      <h1 class="connect-title">Forge IDE</h1>
      <p class="connect-sub">Connect to your local backend server</p>

      <div class="field-group">
        <label class="field-label">Server URL</label>
        <input
          class="field-input"
          v-model="url"
          placeholder="ws://127.0.0.1:3001"
          :disabled="connecting"
        />
      </div>

      <div class="field-group">
        <label class="field-label">Auth Token</label>
        <div class="token-wrap">
          <input
            class="field-input"
            :type="showToken ? 'text' : 'password'"
            v-model="token"
            placeholder="Paste token from server console"
            :disabled="connecting"
            @keyup.enter="connect"
          />
          <button class="eye-btn" @click="showToken = !showToken">
            {{ showToken ? '🙈' : '👁' }}
          </button>
        </div>
      </div>

      <p v-if="error" class="connect-error">{{ error }}</p>

      <button
        class="connect-btn"
        :class="{ loading: connecting }"
        @click="connect"
        :disabled="connecting || !token"
      >
        <span v-if="!connecting">Connect</span>
        <span v-else class="btn-spinner" />
      </button>

      <p class="connect-hint">
        Start the backend server and copy the token printed to its console.
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useSocketStore } from '@/stores/socket.js';

const socket = useSocketStore();

const url = ref('ws://127.0.0.1:3001');
const token = ref('');
const showToken = ref(false);
const connecting = ref(false);
const error = ref('');

async function connect() {
  if (!token.value.trim()) return;
  error.value = '';
  connecting.value = true;

  socket.connect(url.value, token.value.trim());

  // Poll for result
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

.token-wrap { position: relative; }
.token-wrap .field-input { padding-right: 40px; }
.eye-btn {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; font-size: 16px; line-height: 1;
}

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
</style>
