<template>
  <div class="tree-node">
    <div
      class="node-row"
      :class="{ active: isActive, focused: isFocused }"
      :style="{ paddingLeft: `${8 + depth * 14}px` }"
      @click="onClick"
      @contextmenu.prevent="showCtx = true"
    >
      <!-- Chevron -->
      <span class="chevron" :class="{ open: expanded, invisible: entry.type !== 'dir' }">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3 2L7 5L3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>

      <!-- Icon -->
      <span class="node-icon">{{ getIcon(entry) }}</span>

      <!-- Name -->
      <span v-if="!renaming" class="node-name truncate">{{ entry.name }}</span>
      <input
        v-else
        class="rename-input"
        v-model="renameVal"
        @keyup.enter="submitRename"
        @keyup.esc="renaming = false"
        @blur="renaming = false"
        ref="renameInput"
        @click.stop
      />
      <!-- Git status badge -->
      <span v-if="gitBadge" class="git-badge" :class="gitBadgeClass">{{ gitBadge }}</span>
      <!-- Pinned indicator -->
      <span v-if="agentStore.isPinned(entry.path)" class="pin-dot" title="Pinned to AI context">📌</span>
    </div>

    <!-- Children -->
    <div v-if="entry.type === 'dir' && expanded" class="node-children">
      <TreeNode
        v-for="child in children"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        @open="$emit('open', $event)"
        @refresh="$emit('refresh')"
      />
      <div v-if="childrenLoading" class="child-loading">
        <span style="color: var(--text-dim); font-size: 11px; padding-left: 4px;">Loading…</span>
      </div>
    </div>

    <!-- Context menu -->
    <div v-if="showCtx" class="ctx-overlay" @click="showCtx = false">
      <div class="ctx-menu" :style="ctxStyle" @click.stop>
        <button class="ctx-item" @click="startRename">Rename</button>
        <button class="ctx-item" @click="pinEntry">
          {{ agentStore.isPinned(entry.path) ? '📌 Unpin from context' : '📌 Pin to context' }}
        </button>
        <button class="ctx-item danger" @click="deleteEntry">Delete</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, defineAsyncComponent } from 'vue';
import { useSocketStore } from '@/stores/socket.js';
import { useEditorStore } from '@/stores/editor.js';
import { useGitStore } from '@/stores/git.js';
import { useAgentStore } from '@/stores/agent.js';

const TreeNode = defineAsyncComponent(() => import('./TreeNode.vue'));
defineOptions({ name: 'TreeNode' });

const props = defineProps({
  entry: { type: Object, required: true },
  depth: { type: Number, default: 0 },
});

const emit = defineEmits(['open', 'refresh']);

const socket = useSocketStore();
const editorStore = useEditorStore();
const gitStore = useGitStore();
const agentStore = useAgentStore();

const expanded = ref(false);
const children = ref([]);
const childrenLoading = ref(false);
const renaming = ref(false);
const renameVal = ref('');
const renameInput = ref(null);
const showCtx = ref(false);
const ctxStyle = ref({});

const isActive = computed(() => editorStore.activeTabPath === props.entry.path);
const isFocused = computed(() => editorStore.tabs.some(t => t.path === props.entry.path));

const gitStatus = computed(() => gitStore.statusMap.get(props.entry.path));
const gitBadge = computed(() => {
  const s = gitStatus.value;
  if (!s) return null;
  const char = s.xy[0] !== ' ' ? s.xy[0] : s.xy[1];
  if (char === ' ' || char === '?') return s.xy[0] === '?' ? '?' : null;
  return char;
});
const gitBadgeClass = computed(() => {
  const b = gitBadge.value;
  if (!b) return '';
  if (b === 'M') return 'badge-modified';
  if (b === 'A') return 'badge-added';
  if (b === 'D') return 'badge-deleted';
  if (b === '?') return 'badge-untracked';
  return 'badge-modified';
});

async function onClick() {
  if (props.entry.type === 'dir') {
    expanded.value = !expanded.value;
    if (expanded.value && children.value.length === 0) {
      await loadChildren();
    }
  } else {
    emit('open', props.entry.path);
  }
}

async function loadChildren() {
  childrenLoading.value = true;
  try {
    const { entries } = await socket.fs.list(props.entry.path);
    children.value = entries;
  } finally {
    childrenLoading.value = false;
  }
}

async function startRename() {
  showCtx.value = false;
  renameVal.value = props.entry.name;
  renaming.value = true;
  await nextTick();
  renameInput.value?.focus();
  renameInput.value?.select();
}

async function submitRename() {
  if (!renameVal.value.trim() || renameVal.value === props.entry.name) {
    renaming.value = false;
    return;
  }
  const parent = props.entry.path.split('/').slice(0, -1).join('/');
  const newPath = parent ? `${parent}/${renameVal.value}` : renameVal.value;
  await socket.fs.rename(props.entry.path, newPath);
  renaming.value = false;
  emit('refresh');
}

async function pinEntry() {
  showCtx.value = false;
  if (props.entry.type === 'file') {
    await agentStore.togglePin(props.entry.path);
  }
}

async function deleteEntry() {
  showCtx.value = false;
  if (!confirm(`Delete "${props.entry.name}"?`)) return;
  await socket.fs.delete(props.entry.path);
  emit('refresh');
}

const DIR_ICONS = { node_modules: '📦', src: '📂', public: '🌐', dist: '📦', '.git': '🔀' };
const EXT_ICONS = {
  js: '🟨', ts: '🔷', jsx: '⚛️', tsx: '⚛️', vue: '💚',
  py: '🐍', html: '🌐', css: '🎨', scss: '🎨', less: '🎨',
  md: '📝', json: '📦', go: '🐹', sh: '⚙️', yaml: '⚙️', yml: '⚙️',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🎨',
  txt: '📄', env: '🔐', gitignore: '🔀',
};

function getIcon(entry) {
  if (entry.type === 'dir') {
    return DIR_ICONS[entry.name] || (expanded.value ? '📂' : '📁');
  }
  const ext = entry.name.split('.').pop()?.toLowerCase();
  return EXT_ICONS[ext] || '📄';
}
</script>

<style scoped>
.tree-node { user-select: none; }

.node-row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  cursor: pointer;
  border-radius: 4px;
  margin: 0 4px;
  transition: background 0.1s;
  position: relative;
}
.node-row:hover { background: var(--bg-raised); }
.node-row.active { background: var(--accent-dim); }
.node-row.active .node-name { color: var(--accent-bright); }

.chevron {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  transition: transform 0.15s var(--ease-snap);
  flex-shrink: 0;
}
.chevron.open { transform: rotate(90deg); }
.chevron.invisible { opacity: 0; }

.node-icon { font-size: 12px; flex-shrink: 0; }

.node-name {
  flex: 1;
  font-size: 13px;
  color: var(--text-secondary);
  min-width: 0;
}

.rename-input {
  flex: 1;
  background: var(--bg-overlay);
  border: 1px solid var(--accent);
  border-radius: 3px;
  padding: 1px 4px;
  color: var(--text-primary);
  font-size: 13px;
  font-family: var(--font-ui);
  outline: none;
  min-width: 0;
}

.node-children { }
.child-loading { padding: 4px 0; display: flex; align-items: center; }

.git-badge {
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}
.badge-modified { color: var(--git-modified); }
.badge-added { color: var(--git-added); }
.badge-deleted { color: var(--git-deleted); }
.badge-untracked { color: var(--git-untracked); }
.pin-dot { font-size: 9px; flex-shrink: 0; opacity: 0.7; }

/* Context menu */
.ctx-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
}
.ctx-menu {
  position: fixed;
  background: var(--bg-raised);
  border: 1px solid var(--border-mid);
  border-radius: 8px;
  padding: 4px;
  min-width: 140px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  animation: fadeIn 0.1s var(--ease-snap);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 201;
}
.ctx-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  border-radius: 5px;
  text-align: left;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.1s;
}
.ctx-item:hover { background: var(--bg-hover); }
.ctx-item.danger { color: var(--red); }
.ctx-item.danger:hover { background: var(--red-dim); }
</style>
