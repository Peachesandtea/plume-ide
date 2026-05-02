<template>
  <div class="status-bar">
    <div class="status-left">
      <span class="status-dot" :class="socketStore.status" />
      <span class="status-text">{{ connectionLabel }}</span>

      <button v-if="gitStore.isRepo" class="status-git" @click="$emit('open-git')" title="Open git panel">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
          <path d="M18 9a9 9 0 0 1-9 9"/>
        </svg>
        <span>{{ gitStore.branch }}</span>
        <span v-if="gitStore.ahead" class="status-git-badge">↑{{ gitStore.ahead }}</span>
        <span v-if="gitStore.behind" class="status-git-badge behind">↓{{ gitStore.behind }}</span>
        <span v-if="gitStore.changedCount" class="status-git-badge changes">{{ gitStore.changedCount }}</span>
      </button>
    </div>

    <div class="status-right">
      <span v-if="activeTab" class="status-item">{{ langName }}</span>
      <span v-if="activeTab?.dirty" class="status-item dirty">● Unsaved</span>
      <span v-if="activeTab && !activeTab.dirty && !activeTab.loading" class="status-item saved">✓ Saved</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSocketStore } from '@/stores/socket.js';
import { useEditorStore } from '@/stores/editor.js';
import { useGitStore } from '@/stores/git.js';
import { getLanguageName } from '@/composables/useLanguage.js';

defineEmits(['open-git']);

const socketStore = useSocketStore();
const editorStore = useEditorStore();
const gitStore = useGitStore();

const activeTab = computed(() => editorStore.activeTab);
const langName = computed(() => getLanguageName(activeTab.value?.name));

const connectionLabel = computed(() => {
  switch (socketStore.status) {
    case 'connected':      return 'Connected';
    case 'connecting':     return 'Connecting…';
    case 'authenticating': return 'Authenticating…';
    case 'disconnected':   return 'Disconnected';
    case 'error':          return 'Error';
    default:               return socketStore.status;
  }
});
</script>

<style scoped>
.status-bar {
  height: 24px;
  background: var(--accent-dim);
  border-top: 1px solid var(--border-mid);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  flex-shrink: 0;
  font-size: 11px;
}
.status-left, .status-right { display: flex; align-items: center; gap: 10px; }

.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-dim); flex-shrink: 0; }
.status-dot.connected { background: var(--green); box-shadow: 0 0 4px var(--green); }
.status-dot.connecting, .status-dot.authenticating { background: var(--yellow); animation: pulse-glow 1.5s infinite; }
.status-dot.error { background: var(--red); }
.status-text { color: var(--text-secondary); }

.status-git {
  display: flex; align-items: center; gap: 4px;
  background: none; border: none; cursor: pointer;
  color: var(--text-muted); font-size: 11px; font-family: var(--font-ui);
  padding: 0 4px; border-radius: 3px; transition: background 0.15s;
}
.status-git:hover { background: rgba(255,255,255,0.06); color: var(--text-primary); }
.status-git-badge {
  padding: 0 3px; border-radius: 3px; font-weight: 600;
  background: rgba(255,255,255,0.08); color: var(--green);
}
.status-git-badge.behind { color: var(--yellow); }
.status-git-badge.changes { color: var(--accent-bright); }

.status-item { color: var(--text-muted); display: flex; align-items: center; gap: 4px; }
.status-item.dirty { color: var(--yellow); }
.status-item.saved { color: var(--green); }
</style>
