<template>
  <Teleport to="body">
    <div class="grep-panel" :class="{ open: modelValue }">
      <div class="grep-header">
        <div class="grep-input-wrap">
          <svg class="grep-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref="inputEl"
            class="grep-input"
            v-model="query"
            placeholder="Search in files…"
            @input="onInput"
            @keyup.escape="$emit('update:modelValue', false)"
          />
          <button v-if="query" class="grep-clear" @click="query = ''; results = []">✕</button>
        </div>
        <label class="grep-opt">
          <input type="checkbox" v-model="caseSensitive" @change="doSearch" />
          Aa
        </label>
        <button class="grep-close" @click="$emit('update:modelValue', false)">✕</button>
      </div>

      <div class="grep-status" v-if="query">
        <span v-if="searching" class="grep-searching">
          <span class="dot-spin">●</span> Searching…
        </span>
        <span v-else-if="results.length === 0">No results for "{{ query }}"</span>
        <span v-else>{{ totalMatches }} matches in {{ results.length }} files</span>
      </div>

      <div class="grep-results" v-if="results.length">
        <div v-for="file in results" :key="file.file" class="grep-file">
          <div class="grep-file-header" @click="toggleFile(file.file)">
            <span class="grep-chevron" :class="{ open: !collapsed.has(file.file) }">›</span>
            <span class="grep-file-icon">{{ getIcon(file.file) }}</span>
            <span class="grep-file-name">{{ file.file.split('/').pop() }}</span>
            <span class="grep-file-path truncate">{{ file.file }}</span>
            <span class="grep-match-count">{{ file.matches.length }}</span>
          </div>
          <div v-if="!collapsed.has(file.file)" class="grep-matches">
            <div
              v-for="match in file.matches"
              :key="`${file.file}:${match.line}`"
              class="grep-match"
              @click="openMatch(file.file, match.line)"
            >
              <span class="grep-line-num">{{ match.line }}</span>
              <span class="grep-line-text" v-html="highlight(match.text, query)" />
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="!searching && !query" class="grep-empty">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <p>Search across all project files</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useSocketStore } from '@/stores/socket.js';
import { useEditorStore } from '@/stores/editor.js';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

const socket = useSocketStore();
const editorStore = useEditorStore();

const query = ref('');
const results = ref([]);
const searching = ref(false);
const caseSensitive = ref(false);
const collapsed = ref(new Set());
const inputEl = ref(null);

let searchTimer;

const totalMatches = computed(() => results.value.reduce((n, f) => n + f.matches.length, 0));

watch(() => props.modelValue, async (v) => {
  if (v) { await nextTick(); inputEl.value?.focus(); }
});

function onInput() {
  clearTimeout(searchTimer);
  if (!query.value.trim()) { results.value = []; return; }
  searchTimer = setTimeout(doSearch, 400);
}

async function doSearch() {
  if (!query.value.trim()) return;
  searching.value = true;
  results.value = [];
  collapsed.value = new Set();
  try {
    const res = await socket.fs.grep(query.value.trim(), '', caseSensitive.value);
    results.value = res.results || [];
  } catch (e) {
    console.error('grep error', e);
  } finally {
    searching.value = false;
  }
}

function toggleFile(file) {
  const s = new Set(collapsed.value);
  if (s.has(file)) s.delete(file);
  else s.add(file);
  collapsed.value = s;
}

function openMatch(file, line) {
  editorStore.openFileAtLine(file, line);
  emit('update:modelValue', false);
}

function highlight(text, q) {
  if (!q) return escHtml(text);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, caseSensitive.value ? 'g' : 'gi');
  return escHtml(text).replace(re, (m) => `<mark class="grep-hl">${escHtml(m)}</mark>`);
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const EXT_ICONS = { js:'🟨',ts:'🔷',jsx:'⚛️',tsx:'⚛️',vue:'💚',py:'🐍',html:'🌐',css:'🎨',md:'📝',json:'📦',go:'🐹',sh:'⚙️' };
function getIcon(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  return EXT_ICONS[ext] || '📄';
}
</script>

<style>
.grep-panel {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--bg-base);
  z-index: 9997;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.grep-panel.open { transform: translateX(0); }

.grep-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  flex-shrink: 0;
}
.grep-input-wrap {
  flex: 1; position: relative; display: flex; align-items: center;
}
.grep-search-icon { position: absolute; left: 8px; color: var(--text-dim); pointer-events: none; }
.grep-input {
  width: 100%; background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 8px; padding: 8px 28px; color: var(--text-primary);
  font-family: var(--font-ui); font-size: 14px; outline: none;
}
.grep-input:focus { border-color: var(--accent); }
.grep-clear {
  position: absolute; right: 8px; background: none; border: none;
  color: var(--text-dim); cursor: pointer; font-size: 12px;
}
.grep-opt {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; color: var(--text-muted); cursor: pointer;
  flex-shrink: 0; user-select: none;
}
.grep-opt input { accent-color: var(--accent); }
.grep-close {
  background: none; border: none; color: var(--text-dim);
  font-size: 16px; cursor: pointer; flex-shrink: 0; padding: 4px;
}

.grep-status {
  padding: 6px 14px;
  font-size: 11px; color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.grep-searching { display: flex; align-items: center; gap: 6px; }
.dot-spin { animation: pulse-glow 1s infinite; display: inline-block; }

.grep-results { flex: 1; overflow-y: auto; }

.grep-file { border-bottom: 1px solid var(--border-subtle); }
.grep-file-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; cursor: pointer; transition: background 0.1s;
  position: sticky; top: 0; background: var(--bg-surface); z-index: 1;
}
.grep-file-header:hover { background: var(--bg-raised); }
.grep-chevron {
  font-size: 16px; color: var(--text-dim); width: 14px; flex-shrink: 0;
  transition: transform 0.15s; display: inline-block;
}
.grep-chevron.open { transform: rotate(90deg); }
.grep-file-icon { font-size: 12px; flex-shrink: 0; }
.grep-file-name { font-size: 13px; font-weight: 600; color: var(--text-primary); flex-shrink: 0; }
.grep-file-path { font-size: 11px; color: var(--text-dim); font-family: var(--font-mono); flex: 1; }
.grep-match-count {
  font-size: 10px; background: var(--accent-dim); color: var(--accent);
  padding: 1px 6px; border-radius: 8px; flex-shrink: 0;
}

.grep-matches { padding: 0 0 6px; }
.grep-match {
  display: flex; align-items: baseline; gap: 10px;
  padding: 4px 14px 4px 34px; cursor: pointer; transition: background 0.1s;
}
.grep-match:hover { background: var(--bg-raised); }
.grep-line-num {
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-dim); flex-shrink: 0; min-width: 28px; text-align: right;
}
.grep-line-text {
  font-family: var(--font-mono); font-size: 12px;
  color: var(--text-secondary); white-space: pre; overflow: hidden;
  text-overflow: ellipsis;
}
.grep-hl { background: rgba(251, 191, 36, 0.3); color: var(--yellow); border-radius: 2px; }

.grep-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 10px; color: var(--text-dim); font-size: 13px;
}
</style>
