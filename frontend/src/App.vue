<template>
  <div class="app">
    <ConnectScreen v-if="socketStore.status !== 'connected'" />

    <template v-else>
      <header class="app-header">
        <button class="burger" @click="sidebarOpen = !sidebarOpen" :class="{ active: sidebarOpen }">
          <span /><span /><span />
        </button>

        <span class="app-name">⚡ Forge</span>

        <div class="header-right">
          <button class="header-btn ai-btn" @click="paletteOpen = true" title="AI skills (@fix, @explain…)" :class="{ lit: socketStore.hasAI }">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          </button>

          <!-- Agent / Thought Stream -->
          <button
            class="header-btn agent-btn"
            @click="thoughtStreamOpen = !thoughtStreamOpen"
            title="Agent (agentic loop)"
            :class="{ active: thoughtStreamOpen, running: agentStore.running }"
          >
            🤖
            <span v-if="agentStore.running" class="agent-running-dot" />
          </button>

          <!-- Skills -->
          <button class="header-btn" @click="skillsOpen = true" title="Skills">
            ⚡
          </button>

          <button class="header-btn" @click="terminalOpen = !terminalOpen" title="Terminal" :class="{ active: terminalOpen }">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </button>

          <button class="header-btn" @click="grepOpen = !grepOpen" title="Search in files">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>

          <button class="header-btn git-btn-header" @click="gitOpen = !gitOpen" title="Git" :class="{ active: gitOpen }">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
              <line x1="6" y1="9" x2="6" y2="15"/><path d="M18 9V7a2 2 0 0 0-2-2h-4"/>
            </svg>
            <span v-if="gitStore.changedCount" class="git-dot">{{ gitStore.changedCount }}</span>
          </button>

          <button class="header-btn" @click="editorStore.saveActive()" :disabled="!editorStore.activeTab?.dirty" title="Save (Cmd+S)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/>
            </svg>
          </button>

          <button class="header-btn danger" @click="socketStore.disconnect()" title="Disconnect">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </header>

      <TabBar @new-file="sidebarOpen = true" />

      <div class="editor-area">
        <div class="editor-col">
          <Breadcrumbs />
          <CodeEditor ref="editorRef" :tab="editorStore.activeTab" />
          <AccessoryBar :editor-ref="editorRef" />
        </div>
      </div>

      <StatusBar @open-git="gitOpen = true" />

      <FileSidebar
        v-model="sidebarOpen"
        @open-settings="openSettings"
      />
      <SettingsPanel
        v-model="settingsOpen"
        @open-root="openRootFromSettings"
      />
      <GitPanel v-model="gitOpen" />
      <GrepPanel v-model="grepOpen" />
      <TerminalPanel v-model="terminalOpen" />
      <CommandPalette v-model="paletteOpen" />
      <AIDiffViewer v-model="diffOpen" />
      <ThoughtStream v-model="thoughtStreamOpen" />
      <SkillsPanel v-model="skillsOpen" />
    </template>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useSocketStore } from '@/stores/socket.js';
import { useEditorStore } from '@/stores/editor.js';
import { useGitStore } from '@/stores/git.js';
import { useAIStore } from '@/stores/ai.js';
import { useSettingsStore } from '@/stores/settings.js';
import { useAgentStore } from '@/stores/agent.js';
import ConnectScreen from '@/components/ConnectScreen.vue';
import TabBar from '@/components/TabBar.vue';
import FileSidebar from '@/components/FileSidebar.vue';
import SettingsPanel from '@/components/SettingsPanel.vue';
import GitPanel from '@/components/GitPanel.vue';
import GrepPanel from '@/components/GrepPanel.vue';
import TerminalPanel from '@/components/TerminalPanel.vue';
import CommandPalette from '@/components/CommandPalette.vue';
import AIDiffViewer from '@/components/AIDiffViewer.vue';
import ThoughtStream from '@/components/ThoughtStream.vue';
import SkillsPanel from '@/components/SkillsPanel.vue';
import CodeEditor from '@/components/CodeEditor.vue';
import AccessoryBar from '@/components/AccessoryBar.vue';
import Breadcrumbs from '@/components/Breadcrumbs.vue';
import StatusBar from '@/components/StatusBar.vue';

const socketStore = useSocketStore();
const editorStore = useEditorStore();
const gitStore = useGitStore();
const aiStore = useAIStore();
const settingsStore = useSettingsStore();
const agentStore = useAgentStore();

const sidebarOpen = ref(false);
const settingsOpen = ref(false);
const gitOpen = ref(false);
const grepOpen = ref(false);
const terminalOpen = ref(false);
const paletteOpen = ref(false);
const diffOpen = ref(false);
const thoughtStreamOpen = ref(false);
const skillsOpen = ref(false);
const editorRef = ref(null);

// Bootstrap on connect
watch(() => socketStore.status, (s) => {
  if (s === 'connected') {
    gitStore.refresh();
    agentStore.loadPins();
    agentStore.loadSkills();
  }
}, { immediate: true });

// Open settings: close sidebar first, then open settings
function openSettings() {
  sidebarOpen.value = false;
  setTimeout(() => { settingsOpen.value = true; }, 50);
}

// "Change" root button inside settings → close settings, open sidebar root dialog
function openRootFromSettings() {
  settingsOpen.value = false;
  setTimeout(() => {
    sidebarOpen.value = true;
    // Signal sidebar to open its change-root modal
    window.dispatchEvent(new CustomEvent('forge:open-root-dialog'));
  }, 300);
}

// Handle all push events from backend
function onForgePush(e) {
  const msg = e.detail;

  if (msg.type === 'fs:changed') {
    gitStore.onFsChange();
    window.dispatchEvent(new CustomEvent('forge:fs-changed', { detail: msg }));
  }

  // Server log entries → settings store
  if (msg.type === 'server:log') {
    settingsStore.addLog(msg.entry);
  }

  // Route AI events to AI store
  if (msg.type?.startsWith('ai:')) {
    aiStore.handlePush(msg);
  }

  // Route agent events to agent store
  if (msg.type === 'agent:event') {
    agentStore.handleAgentEvent(msg.taskId, msg.event);
  }

  // MCP status changes — MCPPanel listens via its own onMounted polling;
  // also dispatch a custom event so it can refresh immediately
  if (msg.type === 'mcp:status') {
    window.dispatchEvent(new CustomEvent('forge:mcp-status', { detail: msg }));
  }
}

// Global keyboard shortcuts
function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    paletteOpen.value = !paletteOpen.value;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === '`') {
    e.preventDefault();
    terminalOpen.value = !terminalOpen.value;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    editorStore.saveActive();
  }
}

// Reload file in editor after snapshot restore
function onReloadFile(e) {
  const { path } = e.detail;
  const tab = editorStore.tabs.find(t => t.path === path);
  if (tab) {
    socketStore.fs.read(path).then(({ content }) => {
      editorStore.updateContent(path, content);
    }).catch(() => {});
  }
}

onMounted(() => {
  window.addEventListener('forge:push', onForgePush);
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('forge:reload-file', onReloadFile);
});
onBeforeUnmount(() => {
  window.removeEventListener('forge:push', onForgePush);
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('forge:reload-file', onReloadFile);
});
</script>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-void);
  position: relative; /* anchor for absolute-positioned sidebar */
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.app-header {
  height: var(--header-h);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  flex-shrink: 0;
  z-index: 10;
  /* Safe area for notched phones */
  padding-top: env(safe-area-inset-top, 0);
}

.burger {
  width: 36px;
  height: 36px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px;
  transition: background 0.15s;
}
.burger:hover { background: var(--bg-hover); }
.burger span {
  display: block;
  width: 18px;
  height: 1.5px;
  background: var(--text-secondary);
  border-radius: 2px;
  transition: transform 0.2s var(--ease-snap), opacity 0.2s, width 0.2s;
  transform-origin: center;
}
.burger.active span:nth-child(1) { transform: translateY(5.5px) rotate(45deg); }
.burger.active span:nth-child(2) { opacity: 0; width: 0; }
.burger.active span:nth-child(3) { transform: translateY(-5.5px) rotate(-45deg); }

.app-name {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
  letter-spacing: 0.02em;
  flex: 1;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.header-btn {
  width: 34px;
  height: 34px;
  background: transparent;
  border: none;
  border-radius: 7px;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.header-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.header-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.header-btn.danger:hover { background: var(--red-dim); color: var(--red); }
.header-btn.active { background: var(--accent-dim); color: var(--accent-bright); }
.header-btn.ai-btn { color: var(--text-dim); }
.header-btn.ai-btn.lit { color: var(--accent); }
.header-btn.ai-btn.lit:hover { background: var(--accent-dim); color: var(--accent-bright); }

.header-btn.agent-btn {
  font-size: 15px;
  position: relative;
}
.header-btn.agent-btn.running {
  animation: agent-pulse 1.5s ease infinite;
}
@keyframes agent-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
.agent-running-dot {
  position: absolute;
  top: 4px; right: 4px;
  width: 6px; height: 6px;
  background: var(--green);
  border-radius: 50%;
  box-shadow: 0 0 4px var(--green);
}

.git-btn-header { position: relative; }
.git-dot {
  position: absolute;
  top: 3px; right: 3px;
  min-width: 14px; height: 14px;
  background: var(--accent);
  color: white;
  border-radius: 7px;
  font-size: 9px;
  font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  padding: 0 3px;
  pointer-events: none;
}

/* ── Editor area ─────────────────────────────────────────────────────────── */
.editor-area {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
}

.editor-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
