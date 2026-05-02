<template>
  <Teleport to="body">
    <div class="terminal-panel" :class="{ open: modelValue }" :style="{ height: panelHeight + 'px' }">

      <!-- Resize handle -->
      <div class="term-resize-handle" @pointerdown="startResize" />

      <!-- Tab bar -->
      <div class="term-tabbar">
        <div class="term-tabs">
          <button
            v-for="s in sessions"
            :key="s.id"
            class="term-tab"
            :class="{ active: s.id === activeSessionId }"
            @click="switchSession(s.id)"
          >
            <span class="term-tab-icon">⬛</span>
            <span>{{ s.title }}</span>
            <button class="term-tab-close" @click.stop="killSession(s.id)">✕</button>
          </button>
          <button class="term-tab-new" @click="newSession" title="New terminal">+</button>
        </div>
        <div class="term-actions">
          <button class="term-action-btn" @click="clearTerminal" title="Clear">⌫</button>
          <button class="term-action-btn" @click="$emit('update:modelValue', false)" title="Hide">⌄</button>
        </div>
      </div>

      <!-- Terminal containers — one per session, only active is visible -->
      <div class="term-body">
        <div
          v-for="s in sessions"
          :key="s.id"
          :ref="el => setTermRef(s.id, el)"
          class="term-instance"
          :class="{ visible: s.id === activeSessionId }"
        />
        <div v-if="sessions.length === 0" class="term-empty">
          <button class="term-start-btn" @click="newSession">
            <span>⬛</span> Open Terminal
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useSocketStore } from '@/stores/socket.js';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

const socket = useSocketStore();

const sessions = ref([]);        // [{ id, title, term, fitAddon }]
const activeSessionId = ref(null);
const termRefs = new Map();      // sessionId -> DOM el
const panelHeight = ref(280);

let Terminal, FitAddon, WebLinksAddon;

// ─── Load xterm lazily ────────────────────────────────────────────────────────
async function loadXterm() {
  if (Terminal) return;
  const [xtermMod, fitMod, linksMod] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/addon-web-links'),
  ]);
  Terminal = xtermMod.Terminal;
  FitAddon = fitMod.FitAddon;
  WebLinksAddon = linksMod.WebLinksAddon;
  // Load xterm CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css';
  document.head.appendChild(link);
}

// ─── Session management ───────────────────────────────────────────────────────
async function newSession() {
  await loadXterm();
  const id = `term_${Date.now()}`;
  const title = `Shell ${sessions.value.length + 1}`;
  sessions.value.push({ id, title, term: null, fitAddon: null });
  activeSessionId.value = id;

  // Create PTY on backend
  const result = await socket.pty.create(id);
  if (result.fallback) {
    // node-pty not available — show a message
    await nextTick();
    const el = termRefs.get(id);
    if (el) mountTerminal(id, el, true);
    return;
  }

  await nextTick();
  const el = termRefs.get(id);
  if (el) mountTerminal(id, el, false);
}

function mountTerminal(id, el, fallback = false) {
  const term = new Terminal({
    theme: {
      background: '#0a0b0d',
      foreground: '#c8cde8',
      cursor: '#9d8fff',
      cursorAccent: '#0a0b0d',
      black: '#1d2030', red: '#f87171', green: '#4ade80', yellow: '#fbbf24',
      blue: '#60a5fa', magenta: '#c084fc', cyan: '#34d399', white: '#c8cde8',
      brightBlack: '#454a6b', brightRed: '#fca5a5', brightGreen: '#86efac',
      brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
      brightCyan: '#6ee7b7', brightWhite: '#f5f7ff',
    },
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 13,
    lineHeight: 1.4,
    cursorBlink: true,
    scrollback: 5000,
    allowTransparency: true,
  });

  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.open(el);

  if (fallback) {
    term.writeln('\r\n\x1b[33m⚠ node-pty not available.\x1b[0m');
    term.writeln('\x1b[2mRun: npm install in the backend directory\x1b[0m');
    term.writeln('\x1b[2mThen restart the backend server.\x1b[0m\r\n');
  }

  setTimeout(() => fitAddon.fit(), 50);

  // User input → backend PTY
  term.onData(data => socket.pty.write(id, data));

  // Update session
  const idx = sessions.value.findIndex(s => s.id === id);
  if (idx !== -1) {
    sessions.value[idx].term = term;
    sessions.value[idx].fitAddon = fitAddon;
  }
}

function setTermRef(id, el) {
  if (el) termRefs.set(id, el);
  else termRefs.delete(id);
}

function switchSession(id) {
  activeSessionId.value = id;
  nextTick(() => {
    const s = sessions.value.find(s => s.id === id);
    if (s?.fitAddon) { s.fitAddon.fit(); s.term?.focus(); }
  });
}

async function killSession(id) {
  socket.pty.kill(id);
  const idx = sessions.value.findIndex(s => s.id === id);
  if (idx !== -1) {
    sessions.value[idx].term?.dispose();
    sessions.value.splice(idx, 1);
  }
  if (activeSessionId.value === id) {
    activeSessionId.value = sessions.value[sessions.value.length - 1]?.id || null;
  }
}

function clearTerminal() {
  const s = sessions.value.find(s => s.id === activeSessionId.value);
  s?.term?.clear();
}

// ─── Incoming PTY data ────────────────────────────────────────────────────────
function onForgePush(e) {
  const msg = e.detail;
  if (msg.type === 'pty:data') {
    const s = sessions.value.find(s => s.id === msg.sessionId);
    s?.term?.write(msg.data);
  }
  if (msg.type === 'pty:exit') {
    const s = sessions.value.find(s => s.id === msg.sessionId);
    if (s?.term) s.term.writeln(`\r\n\x1b[2m[Process exited with code ${msg.exitCode}]\x1b[0m`);
  }
}
onMounted(() => window.addEventListener('forge:push', onForgePush));
onBeforeUnmount(() => window.removeEventListener('forge:push', onForgePush));

// Auto-open a session when panel first opens
watch(() => props.modelValue, async (open) => {
  if (open && sessions.value.length === 0) {
    await newSession();
  }
  if (open) {
    await nextTick();
    const s = sessions.value.find(s => s.id === activeSessionId.value);
    s?.fitAddon?.fit();
    s?.term?.focus();
  }
});

// ─── Resize handle ────────────────────────────────────────────────────────────
let resizeStartY = 0, resizeStartH = 0;
function startResize(e) {
  resizeStartY = e.clientY;
  resizeStartH = panelHeight.value;
  window.addEventListener('pointermove', onResizeMove);
  window.addEventListener('pointerup', onResizeUp);
}
function onResizeMove(e) {
  const delta = resizeStartY - e.clientY;
  panelHeight.value = Math.max(160, Math.min(window.innerHeight * 0.85, resizeStartH + delta));
  const s = sessions.value.find(s => s.id === activeSessionId.value);
  s?.fitAddon?.fit();
}
function onResizeUp() {
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', onResizeUp);
  const s = sessions.value.find(s => s.id === activeSessionId.value);
  s?.fitAddon?.fit();
}

// Re-fit on window resize
const onWindowResize = () => {
  const s = sessions.value.find(s => s.id === activeSessionId.value);
  s?.fitAddon?.fit();
  if (s) socket.pty.resize(s.id, s.term?.cols || 80, s.term?.rows || 24);
};
onMounted(() => window.addEventListener('resize', onWindowResize));
onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize));
</script>

<style>
.terminal-panel {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  background: #0a0b0d;
  border-top: 1px solid #2d3155;
  border-radius: 12px 12px 0 0;
  z-index: 9996;
  display: flex;
  flex-direction: column;
  visibility: hidden;
  opacity: 0;
  transform: translateY(20px);
  transition: visibility 0s linear 0.3s, opacity 0.3s cubic-bezier(0.25,0.46,0.45,0.94), transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94);
  pointer-events: none;
  box-shadow: 0 -8px 40px rgba(0,0,0,0.6);
}
.terminal-panel.open {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
  transition-delay: 0s;
  pointer-events: all;
}

.term-resize-handle {
  height: 6px;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.term-resize-handle::after {
  content: '';
  width: 36px; height: 3px;
  background: #2d3155;
  border-radius: 2px;
}

.term-tabbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #0f1117;
  border-bottom: 1px solid #1f2235;
  flex-shrink: 0;
  height: 34px;
  padding: 0 6px 0 0;
}
.term-tabs {
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  scrollbar-width: none;
  flex: 1;
  height: 100%;
}
.term-tabs::-webkit-scrollbar { display: none; }

.term-tab {
  display: flex; align-items: center; gap: 5px;
  padding: 0 10px;
  min-width: 90px;
  background: transparent;
  border: none; border-right: 1px solid #1f2235;
  color: #6b7299;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  white-space: nowrap;
  font-family: 'Geist', sans-serif;
}
.term-tab.active { background: #0a0b0d; color: #c8cde8; }
.term-tab:not(.active):hover { background: #161820; }
.term-tab-icon { font-size: 10px; }
.term-tab-close {
  background: none; border: none; color: #454a6b; cursor: pointer;
  font-size: 10px; padding: 1px 3px; border-radius: 3px; line-height: 1;
  margin-left: 2px;
}
.term-tab-close:hover { background: #2d3155; color: #f87171; }

.term-tab-new {
  width: 30px; height: 100%;
  background: transparent; border: none; border-right: 1px solid #1f2235;
  color: #454a6b; cursor: pointer; font-size: 18px; line-height: 1;
  transition: color 0.1s;
}
.term-tab-new:hover { color: #9d8fff; }

.term-actions { display: flex; align-items: center; gap: 2px; }
.term-action-btn {
  width: 28px; height: 28px;
  background: transparent; border: none; border-radius: 5px;
  color: #454a6b; cursor: pointer; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.1s, color 0.1s;
}
.term-action-btn:hover { background: #1d2030; color: #c8cde8; }

.term-body {
  flex: 1; min-height: 0; position: relative; overflow: hidden;
  padding: 4px 4px 0;
}
.term-instance {
  position: absolute; inset: 4px 4px 0;
  display: none;
}
.term-instance.visible { display: block; }

/* Override xterm default background */
.term-instance .xterm { height: 100%; }
.term-instance .xterm-viewport { background: transparent !important; }

.term-empty {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
}
.term-start-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 24px; background: #1d2030;
  border: 1px solid #2d3155; border-radius: 10px;
  color: #9199c0; font-size: 14px; cursor: pointer;
  font-family: 'Geist', sans-serif;
  transition: background 0.15s;
}
.term-start-btn:hover { background: #252840; color: #c8cde8; }
</style>
