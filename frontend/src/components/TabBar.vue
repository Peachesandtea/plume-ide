<template>
  <div class="tab-bar" ref="barEl">
    <div class="tabs-scroll" ref="scrollEl">
      <button
        v-for="tab in tabs"
        :key="tab.path"
        class="tab"
        :class="{ active: tab.path === activeTabPath }"
        @click="activeTabPath = tab.path"
      >
        <!-- File icon based on extension -->
        <span class="tab-icon">{{ getIcon(tab.name) }}</span>
        <span class="tab-name truncate">{{ tab.name }}</span>
        <!-- Dirty indicator / close -->
        <span
          class="tab-close"
          @click.stop="editorStore.closeTab(tab.path)"
          :title="tab.dirty ? 'Unsaved changes' : 'Close'"
        >
          <span v-if="tab.dirty" class="dirty-dot" />
          <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </span>
      </button>

      <!-- New tab button -->
      <button class="tab-new" @click="$emit('new-file')" title="New file">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1V13M1 7H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useEditorStore } from '@/stores/editor.js';

const editorStore = useEditorStore();
const { tabs, activeTabPath } = storeToRefs(editorStore);

const barEl = ref(null);
const scrollEl = ref(null);

defineEmits(['new-file']);

// Scroll active tab into view
watch(activeTabPath, async () => {
  await nextTick();
  const el = scrollEl.value?.querySelector('.tab.active');
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
});

const EXT_ICONS = {
  js: '🟨', ts: '🔷', jsx: '⚛️', tsx: '⚛️',
  py: '🐍', html: '🌐', css: '🎨', scss: '🎨',
  md: '📝', json: '📦', go: '🐹', sh: '⚙️',
  txt: '📄', yml: '⚙️', yaml: '⚙️',
};

function getIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  return EXT_ICONS[ext] || '📄';
}
</script>

<style scoped>
.tab-bar {
  height: var(--tab-bar-h);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  overflow: hidden;
}

.tabs-scroll {
  display: flex;
  align-items: stretch;
  height: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.tabs-scroll::-webkit-scrollbar { display: none; }

.tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px 0 10px;
  min-width: 80px;
  max-width: 160px;
  flex-shrink: 0;
  background: transparent;
  border: none;
  border-right: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: 12px;
  cursor: pointer;
  position: relative;
  transition: background 0.15s, color 0.15s;
  text-align: left;
}

.tab::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: transparent;
  transition: background 0.15s;
}

.tab.active {
  background: var(--bg-base);
  color: var(--text-bright);
  border-bottom-color: transparent;
}

.tab.active::after {
  background: var(--accent);
}

.tab:not(.active):hover {
  background: var(--bg-raised);
  color: var(--text-secondary);
}

.tab-icon { font-size: 11px; flex-shrink: 0; }

.tab-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-close {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  color: var(--text-dim);
  opacity: 0;
  transition: opacity 0.15s, background 0.1s;
}

.tab:hover .tab-close { opacity: 1; }
.tab.active .tab-close { opacity: 0.6; }
.tab-close:hover { background: var(--bg-hover); color: var(--text-primary); opacity: 1 !important; }

.dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  display: block;
  box-shadow: 0 0 4px var(--accent-glow);
}

.tab-new {
  flex-shrink: 0;
  width: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  transition: color 0.15s;
}
.tab-new:hover { color: var(--accent); }
</style>
