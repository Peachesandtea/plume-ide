<template>
<Teleport to="body">
    <aside class="sidebar" :class="{ open: modelValue }" aria-hidden="!modelValue">
      <div class="sidebar-backdrop" @click="$emit('update:modelValue', false)" />

      <div class="sidebar-panel" @click.stop>
        <!-- Header -->
        <div class="sidebar-header">
          <span class="sidebar-title">Explorer</span>
          <div class="sidebar-actions">
            <button class="icon-btn" @click="showNewFile = true" title="New File">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
            </button>
            <button class="icon-btn" @click="showNewFolder = true" title="New Folder">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
            </button>
            <button class="icon-btn" @click="refresh" title="Refresh">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            <!-- Settings cog -->
            <button class="icon-btn settings-cog" @click="$emit('open-settings')" title="Settings">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <button class="icon-btn close-btn" @click="$emit('update:modelValue', false)" title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Project root row -->
        <div class="root-row" @click="showChangeRoot = true" title="Change project folder">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span class="root-path truncate">{{ rootDisplayName }}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;opacity:0.4">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </div>

        <!-- Search -->
        <div class="search-wrap">
          <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            class="search-input"
            v-model="searchQuery"
            placeholder="Search files…"
            @input="onSearch"
          />
          <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''; searchResults = null">✕</button>
        </div>

        <!-- Pinned context files -->
        <ContextPins />

        <!-- File Tree / Search results -->
        <div class="tree-scroll">          <div v-if="listError" class="tree-error">
            <p>{{ listError }}</p>
            <button class="btn-primary" style="margin-top:10px;font-size:12px;padding:6px 14px" @click="showChangeRoot = true">Change Folder</button>
          </div>

          <template v-else-if="searchResults !== null">
            <div class="search-results">
              <div
                v-for="path in searchResults"
                :key="path"
                class="search-result"
                @click="openFile(path)"
              >
                <span class="result-name">{{ path.split('/').pop() }}</span>
                <span class="result-path">{{ path }}</span>
              </div>
              <div v-if="searchResults.length === 0" class="tree-empty">No files found</div>
            </div>
          </template>

          <template v-else-if="!loading && rootEntries.length === 0">
            <div class="tree-empty">
              <p>Empty folder</p>
              <button class="btn-ghost" @click="showNewFile = true">+ New file</button>
              <button class="btn-ghost" @click="showNewFolder = true">+ New folder</button>
            </div>
          </template>

          <template v-else>
            <TreeNode
              v-for="entry in rootEntries"
              :key="entry.path"
              :entry="entry"
              :depth="0"
              @open="openFile"
              @refresh="refresh"
            />
            <div v-if="loading" class="tree-loading">
              <div class="spinner-sm" />
            </div>
          </template>
        </div>

        <!-- Change root modal -->
        <div v-if="showChangeRoot" class="modal-overlay" @click.self="showChangeRoot = false">
          <div class="modal">
            <p class="modal-title">Open Folder</p>
            <p class="modal-hint">Enter an absolute path to open as your project root.</p>
            <input
              class="modal-input"
              v-model="newRootPath"
              placeholder="/home/user/my-project"
              @keyup.enter="changeRoot"
              @keyup.esc="showChangeRoot = false"
              ref="rootInput"
              autofocus
            />
            <p v-if="rootError" class="modal-error">{{ rootError }}</p>
            <div class="modal-actions">
              <button class="btn-secondary" @click="showChangeRoot = false">Cancel</button>
              <button class="btn-primary" @click="changeRoot" :disabled="changingRoot">
                <span v-if="!changingRoot">Open</span>
                <span v-else>…</span>
              </button>
            </div>
          </div>
        </div>

        <!-- New File / Folder modal -->
        <div v-if="showNewFile || showNewFolder" class="modal-overlay" @click.self="showNewFile = showNewFolder = false">
          <div class="modal">
            <p class="modal-title">{{ showNewFile ? 'New File' : 'New Folder' }}</p>
            <input
              class="modal-input"
              v-model="newName"
              :placeholder="showNewFile ? 'filename.js' : 'folder-name'"
              @keyup.enter="createNew"
              @keyup.esc="showNewFile = showNewFolder = false"
              ref="newNameInput"
              autofocus
            />
            <div class="modal-actions">
              <button class="btn-secondary" @click="showNewFile = showNewFolder = false">Cancel</button>
              <button class="btn-primary" @click="createNew">Create</button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  </Teleport>
</template>

<script setup>
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useSocketStore } from '@/stores/socket.js';
import { useEditorStore } from '@/stores/editor.js';
import TreeNode from './TreeNode.vue';
import ContextPins from './ContextPins.vue';

const props = defineProps({
  modelValue: Boolean,
});
defineEmits(['update:modelValue', 'open-settings']);

const socket = useSocketStore();
const editorStore = useEditorStore();

const rootEntries = ref([]);
const loading = ref(false);
const listError = ref('');
const searchQuery = ref('');
const searchResults = ref(null);
const showNewFile = ref(false);
const showNewFolder = ref(false);
const showChangeRoot = ref(false);
const newName = ref('');
const newRootPath = ref('');
const rootError = ref('');
const changingRoot = ref(false);
const newNameInput = ref(null);
const rootInput = ref(null);

const rootDisplayName = computed(() => {
  const r = socket.projectRoot;
  if (!r) return 'No folder open';
  const parts = r.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || r;
});

watch(() => showNewFile.value || showNewFolder.value, async (v) => {
  if (v) { newName.value = ''; await nextTick(); newNameInput.value?.focus(); }
});

watch(() => showChangeRoot.value, async (v) => {
  if (v) {
    newRootPath.value = socket.projectRoot || '';
    rootError.value = '';
    await nextTick();
    rootInput.value?.focus();
    rootInput.value?.select();
  }
});

async function refresh() {
  if (socket.status !== 'connected') return;
  loading.value = true;
  listError.value = '';
  try {
    const { entries } = await socket.fs.list('');
    rootEntries.value = entries;
  } catch (err) {
    listError.value = `Cannot read folder: ${err.message}`;
    rootEntries.value = [];
  } finally {
    loading.value = false;
  }
}

// Refresh whenever connected or projectRoot changes
// Also close all open editor tabs when the folder changes so stale files
// from the previous project are not left open.
watch(() => socket.status, (s) => { if (s === 'connected') refresh(); }, { immediate: true });
watch(() => socket.projectRoot, (newRoot, oldRoot) => {
  if (socket.status === 'connected') {
    // Only close tabs when the root actually changes (not the initial set)
    if (oldRoot && newRoot !== oldRoot) {
      editorStore.closeAllTabs();
    }
    refresh();
  }
});

// Live tree updates from backend file watcher
let fsChangeTimer;
function onFsChanged() {
  clearTimeout(fsChangeTimer);
  fsChangeTimer = setTimeout(refresh, 400);
}

// Triggered by settings panel "Change" button
function onOpenRootDialog() {
  showChangeRoot.value = true;
}

onMounted(() => {
  window.addEventListener('forge:fs-changed', onFsChanged);
  window.addEventListener('forge:open-root-dialog', onOpenRootDialog);
});
onBeforeUnmount(() => {
  window.removeEventListener('forge:fs-changed', onFsChanged);
  window.removeEventListener('forge:open-root-dialog', onOpenRootDialog);
});

let searchTimer;
function onSearch() {
  clearTimeout(searchTimer);
  if (!searchQuery.value.trim()) { searchResults.value = null; return; }
  searchTimer = setTimeout(async () => {
    try {
      const { matches } = await socket.fs.search(searchQuery.value.trim());
      searchResults.value = matches;
    } catch {
      searchResults.value = [];
    }
  }, 300);
}

function openFile(path) {
  editorStore.openFile(path);
}

async function createNew() {
  if (!newName.value.trim()) return;
  const type = showNewFolder.value ? 'dir' : 'file';
  try {
    await socket.fs.create(newName.value.trim(), type);
    showNewFile.value = false;
    showNewFolder.value = false;
    await refresh();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function changeRoot() {
  if (!newRootPath.value.trim()) return;
  rootError.value = '';
  changingRoot.value = true;
  try {
    await socket.fs.setRoot(newRootPath.value.trim());
    showChangeRoot.value = false;
    // projectRoot watcher will close all tabs and trigger refresh
  } catch (err) {
    rootError.value = err.message;
  } finally {
    changingRoot.value = false;
  }
}
</script>

<style>
/* NOT scoped — Teleport'd content lives in <body>, scoped CSS won't apply reliably.
   Class names are namespaced with `forge-` to avoid collisions. */

.sidebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  visibility: hidden;
}
.sidebar.open { visibility: visible; }

.sidebar-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  opacity: 0;
  transition: opacity 0.25s ease;
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}
.sidebar.open .sidebar-backdrop { opacity: 1; }

.sidebar-panel {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 85%;
  max-width: 320px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  transform: translateX(-100%);
  transition: transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  box-shadow: 4px 0 32px rgba(0, 0, 0, 0.5);
}
.sidebar.open .sidebar-panel { transform: translateX(0); }

/* Header */
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px 8px 12px;
  flex-shrink: 0;
  gap: 6px;
}
.sidebar-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.sidebar-actions { display: flex; gap: 2px; }
.icon-btn {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.icon-btn.close-btn { color: var(--text-muted); }
.icon-btn.close-btn:hover { background: var(--red-dim); color: var(--red); }
.icon-btn.settings-cog:hover { background: var(--accent-dim); color: var(--accent-bright); }

/* Search */
.search-wrap {
  position: relative;
  margin: 0 8px 8px;
  flex-shrink: 0;
}
.search-icon {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-dim);
}
.search-input {
  width: 100%;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 6px 8px 6px 28px;
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.search-input::placeholder { color: var(--text-dim); }
.search-input:focus { border-color: var(--accent); }
.search-clear {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 11px;
}

/* Tree */
.tree-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
}
.tree-empty { padding: 16px; color: var(--text-dim); font-size: 12px; text-align: center; }
.tree-loading { display: flex; justify-content: center; padding: 16px; }
.spinner-sm {
  width: 16px; height: 16px;
  border: 2px solid var(--border-mid);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

/* Search results */
.search-results { padding: 4px 0; }
.search-result {
  padding: 6px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: background 0.1s;
}
.search-result:hover { background: var(--bg-raised); }
.result-name { font-size: 13px; color: var(--text-primary); }
.result-path { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }

/* Modal */
.modal-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.modal {
  background: var(--bg-raised);
  border: 1px solid var(--border-mid);
  border-radius: 12px;
  padding: 20px;
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  animation: fadeIn 0.15s var(--ease-snap);
}
.modal-title { font-size: 13px; font-weight: 600; color: var(--text-bright); }
.modal-input {
  background: var(--bg-surface);
  border: 1px solid var(--border-mid);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  outline: none;
  width: 100%;
}
.modal-input:focus { border-color: var(--accent); }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn-primary {
  background: var(--accent); color: white; border: none;
  padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 500;
  cursor: pointer; transition: opacity 0.15s;
}
.btn-primary:hover { opacity: 0.85; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary {
  background: var(--bg-overlay); color: var(--text-secondary);
  border: 1px solid var(--border-mid);
  padding: 6px 14px; border-radius: 6px; font-size: 12px;
  cursor: pointer; transition: background 0.15s;
}
.btn-secondary:hover { background: var(--bg-hover); }

/* Root row */
.root-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 8px 6px;
  padding: 5px 8px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: background 0.15s, border-color 0.15s;
  min-width: 0;
}
.root-row:hover { background: var(--bg-hover); border-color: var(--border-mid); }
.root-path { font-size: 12px; font-family: var(--font-mono); flex: 1; min-width: 0; }

/* Error and empty states */
.tree-error {
  padding: 20px 16px;
  text-align: center;
  color: var(--red);
  font-size: 12px;
  line-height: 1.5;
}
.tree-empty {
  padding: 20px 16px;
  color: var(--text-dim);
  font-size: 12px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.btn-ghost {
  background: none;
  border: 1px dashed var(--border-mid);
  border-radius: 6px;
  color: var(--text-muted);
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  width: 100%;
}
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }

/* Modal extras */
.modal-hint { font-size: 11px; color: var(--text-muted); line-height: 1.4; margin-top: -4px; }
.modal-error {
  font-size: 11px;
  color: var(--red);
  background: var(--red-dim);
  border-radius: 5px;
  padding: 6px 8px;
}
</style>