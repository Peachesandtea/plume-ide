<template>
  <div class="pins-section" v-if="agentStore.pinnedFiles.length > 0 || alwaysShow">
    <div class="pins-header" @click="open = !open">
      <span class="pins-chevron" :class="{ open }">›</span>
      <span class="pins-title">📌 Pinned Context</span>
      <span class="pins-count">{{ agentStore.pinnedFiles.length }}</span>
    </div>

    <div v-if="open" class="pins-list">
      <div v-if="agentStore.pinnedFiles.length === 0" class="pins-empty">
        No files pinned. Right-tap a file and choose "Pin to context".
      </div>
      <div
        v-for="path in agentStore.pinnedFiles"
        :key="path"
        class="pin-row"
      >
        <span class="pin-icon">{{ getIcon(path) }}</span>
        <span class="pin-name truncate">{{ path.split('/').pop() }}</span>
        <span class="pin-path truncate">{{ path }}</span>
        <button class="pin-remove" @click="agentStore.togglePin(path)" title="Unpin">✕</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useAgentStore } from '@/stores/agent.js';

defineProps({ alwaysShow: { type: Boolean, default: false } });

const agentStore = useAgentStore();
const open = ref(true);

const EXT_ICONS = { js:'🟨',ts:'🔷',jsx:'⚛️',tsx:'⚛️',vue:'💚',py:'🐍',html:'🌐',css:'🎨',md:'📝',json:'📦',go:'🐹' };
function getIcon(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  return EXT_ICONS[ext] || '📄';
}
</script>

<style scoped>
.pins-section {
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.pins-header {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 12px; cursor: pointer;
  user-select: none; transition: background 0.1s;
}
.pins-header:hover { background: var(--bg-raised); }
.pins-chevron {
  font-size: 14px; color: var(--text-dim); width: 12px;
  transition: transform 0.15s; display: inline-block;
}
.pins-chevron.open { transform: rotate(90deg); }
.pins-title { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; flex: 1; }
.pins-count {
  font-size: 10px; background: var(--accent-dim); color: var(--accent-bright);
  padding: 1px 5px; border-radius: 8px;
}

.pins-list { padding: 2px 0 6px; }
.pins-empty { padding: 6px 12px; font-size: 11px; color: var(--text-dim); line-height: 1.4; }
.pin-row {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 12px; transition: background 0.1s;
}
.pin-row:hover { background: var(--bg-raised); }
.pin-icon { font-size: 11px; flex-shrink: 0; }
.pin-name { font-size: 12px; color: var(--text-primary); flex-shrink: 0; max-width: 90px; }
.pin-path { font-size: 10px; color: var(--text-dim); font-family: var(--font-mono); flex: 1; }
.pin-remove {
  background: none; border: none; color: var(--text-dim);
  cursor: pointer; font-size: 10px; padding: 2px 4px;
  border-radius: 3px; opacity: 0; transition: opacity 0.1s;
}
.pin-row:hover .pin-remove { opacity: 1; }
.pin-remove:hover { background: var(--red-dim); color: var(--red); }
</style>
