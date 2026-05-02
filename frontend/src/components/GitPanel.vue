<template>
  <Teleport to="body">
    <div class="git-panel" :class="{ open: modelValue }">
      <!-- Drag handle / header tap to close -->
      <div class="git-handle" @click="$emit('update:modelValue', false)">
        <div class="handle-bar" />
      </div>

      <div class="git-header">
        <div class="git-title-row">
          <span class="git-icon">⎇</span>
          <span class="git-branch" @click="showBranches = !showBranches">
            {{ gitStore.branch || 'no branch' }}
            <span v-if="gitStore.ahead" class="badge up">↑{{ gitStore.ahead }}</span>
            <span v-if="gitStore.behind" class="badge down">↓{{ gitStore.behind }}</span>
            <span class="branch-chevron" :class="{ open: showBranches }">›</span>
          </span>
        </div>
        <div class="git-actions">
          <button class="git-btn" @click="doPull" :disabled="busy" title="Pull">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
            Pull
          </button>
          <button class="git-btn" @click="doPush" :disabled="busy || !gitStore.isRepo" title="Push">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
            Push
          </button>
          <button class="git-btn icon-only" @click="gitStore.refresh()" :disabled="busy" title="Refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" :class="{ spinning: gitStore.loading }"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
      </div>

      <!-- Operation output banner -->
      <div v-if="opOutput" class="op-output" :class="opError ? 'error' : 'success'">
        <span>{{ opOutput }}</span>
        <button @click="opOutput = ''" class="op-dismiss">✕</button>
      </div>

      <!-- Branch switcher -->
      <div v-if="showBranches" class="branch-panel">
        <div class="branch-search-wrap">
          <input class="branch-search" v-model="branchFilter" placeholder="Filter or create branch…" @keyup.enter="createOrCheckout" />
        </div>
        <div class="branch-list">
          <div
            v-for="b in filteredBranches"
            :key="b.name"
            class="branch-item"
            :class="{ active: b.name === gitStore.branch }"
            @click="switchBranch(b.name)"
          >
            <span class="branch-type">{{ b.remote ? '⬡' : '◈' }}</span>
            <span class="branch-name truncate">{{ b.name }}</span>
            <span v-if="b.name === gitStore.branch" class="branch-current">current</span>
          </div>
          <div v-if="filteredBranches.length === 0 && branchFilter" class="branch-create" @click="createNewBranch">
            <span>+ Create "{{ branchFilter }}"</span>
          </div>
          <div v-if="branchesData.local.length === 0" class="branch-empty">No branches found</div>
        </div>
      </div>

      <div class="git-body" v-else>
        <!-- Not a git repo -->
        <div v-if="!gitStore.isRepo" class="git-empty">
          <p>Not a git repository</p>
          <button class="git-btn primary" @click="initRepo">git init</button>
        </div>

        <template v-else>
          <!-- Staged section -->
          <div class="git-section">
            <div class="section-header" @click="stagingOpen = !stagingOpen">
              <span class="section-chevron" :class="{ open: stagingOpen }">›</span>
              <span class="section-title">Staged Changes</span>
              <span class="section-count">{{ gitStore.stagedFiles.length }}</span>
              <button v-if="gitStore.stagedFiles.length" class="section-action" @click.stop="unstageAll" title="Unstage all">−</button>
            </div>
            <div v-if="stagingOpen" class="file-list">
              <div v-if="gitStore.stagedFiles.length === 0" class="file-empty">Nothing staged</div>
              <div
                v-for="f in gitStore.stagedFiles"
                :key="f.path"
                class="file-row"
                @click="openFile(f.path)"
              >
                <span class="file-status" :class="statusClass(f.xy[0])">{{ f.xy[0] }}</span>
                <span class="file-name truncate">{{ f.path.split('/').pop() }}</span>
                <span class="file-path truncate">{{ f.path }}</span>
                <button class="file-action" @click.stop="unstage(f.path)" title="Unstage">−</button>
              </div>
            </div>
          </div>

          <!-- Unstaged/working section -->
          <div class="git-section">
            <div class="section-header" @click="changesOpen = !changesOpen">
              <span class="section-chevron" :class="{ open: changesOpen }">›</span>
              <span class="section-title">Changes</span>
              <span class="section-count">{{ gitStore.unstagedFiles.length }}</span>
              <button v-if="gitStore.unstagedFiles.length" class="section-action" @click.stop="stageAll" title="Stage all">+</button>
            </div>
            <div v-if="changesOpen" class="file-list">
              <div v-if="gitStore.unstagedFiles.length === 0" class="file-empty">Working tree clean</div>
              <div
                v-for="f in gitStore.unstagedFiles"
                :key="f.path"
                class="file-row"
                @click="openFile(f.path)"
              >
                <span class="file-status" :class="statusClass(f.xy[1] !== ' ' ? f.xy[1] : f.xy[0])">
                  {{ f.xy[1] !== ' ' ? f.xy[1] : f.xy[0] }}
                </span>
                <span class="file-name truncate">{{ f.path.split('/').pop() }}</span>
                <span class="file-path truncate">{{ f.path }}</span>
                <button class="file-action plus" @click.stop="stage(f.path)" title="Stage">+</button>
              </div>
            </div>
          </div>

          <!-- Commit section -->
          <div class="commit-section">
            <textarea
              class="commit-msg"
              v-model="commitMsg"
              placeholder="Commit message…"
              rows="2"
              @keydown.ctrl.enter="doCommit"
              @keydown.meta.enter="doCommit"
            />
            <div class="commit-actions">
              <button class="git-btn primary" @click="doCommit" :disabled="!commitMsg.trim() || !gitStore.stagedFiles.length || busy">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>
                Commit{{ gitStore.stagedFiles.length ? ` (${gitStore.stagedFiles.length})` : '' }}
              </button>
            </div>
          </div>

          <!-- Recent commits -->
          <div class="git-section">
            <div class="section-header" @click="logOpen = !logOpen">
              <span class="section-chevron" :class="{ open: logOpen }">›</span>
              <span class="section-title">Recent Commits</span>
            </div>
            <div v-if="logOpen" class="commit-log">
              <div v-if="commits.length === 0" class="file-empty">No commits yet</div>
              <div v-for="c in commits" :key="c.hash" class="commit-row">
                <span class="commit-hash">{{ c.hash?.slice(0, 7) }}</span>
                <span class="commit-subject truncate">{{ c.subject }}</span>
                <span class="commit-meta">{{ c.date }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useSocketStore } from '@/stores/socket.js';
import { useGitStore } from '@/stores/git.js';
import { useEditorStore } from '@/stores/editor.js';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

const socket = useSocketStore();
const gitStore = useGitStore();
const editorStore = useEditorStore();

const commitMsg = ref('');
const busy = ref(false);
const opOutput = ref('');
const opError = ref(false);
const showBranches = ref(false);
const branchFilter = ref('');
const branchesData = ref({ current: '', local: [], remote: [] });
const commits = ref([]);
const stagingOpen = ref(true);
const changesOpen = ref(true);
const logOpen = ref(false);

// Load data when panel opens
watch(() => props.modelValue, async (open) => {
  if (!open) return;
  await gitStore.refresh();
  loadLog();
  if (gitStore.isRepo) loadBranches();
});

watch(showBranches, (v) => { if (v) loadBranches(); });

async function loadBranches() {
  try { branchesData.value = await socket.git.branches(); } catch {}
}
async function loadLog() {
  try { const r = await socket.git.log(20); commits.value = r.commits || []; } catch {}
}

const filteredBranches = computed(() => {
  const q = branchFilter.value.toLowerCase();
  const all = [
    ...branchesData.value.local.map(n => ({ name: n, remote: false })),
    ...branchesData.value.remote.map(n => ({ name: n, remote: true })),
  ];
  return q ? all.filter(b => b.name.toLowerCase().includes(q)) : all;
});

function statusClass(char) {
  if (!char || char === ' ') return '';
  if (char === 'M') return 'modified';
  if (char === 'A') return 'added';
  if (char === 'D') return 'deleted';
  if (char === 'R') return 'renamed';
  if (char === '?') return 'untracked';
  return 'modified';
}

async function withBusy(label, fn) {
  busy.value = true; opOutput.value = ''; opError.value = false;
  try {
    const res = await fn();
    if (res?.output) opOutput.value = res.output;
    await gitStore.refresh();
    loadLog();
  } catch (err) {
    opOutput.value = err.message;
    opError.value = true;
  } finally {
    busy.value = false;
  }
}

function openFile(path) { editorStore.openFile(path); }
async function stage(path) { await withBusy('stage', () => socket.git.stage(path)); }
async function unstage(path) { await withBusy('unstage', () => socket.git.unstage(path)); }
async function stageAll() { await withBusy('stageAll', () => socket.git.stageAll()); }
async function unstageAll() {
  await withBusy('unstageAll', async () => {
    for (const f of gitStore.stagedFiles) await socket.git.unstage(f.path);
    return { output: 'All changes unstaged' };
  });
}
async function doCommit() {
  if (!commitMsg.value.trim() || !gitStore.stagedFiles.length) return;
  await withBusy('commit', async () => {
    const res = await socket.git.commit(commitMsg.value);
    commitMsg.value = '';
    return res;
  });
}
async function doPush() { await withBusy('push', () => socket.git.push()); }
async function doPull() { await withBusy('pull', () => socket.git.pull()); }

async function switchBranch(name) {
  if (name === gitStore.branch) { showBranches.value = false; return; }
  await withBusy('checkout', () => socket.git.checkout(name));
  showBranches.value = false;
  branchFilter.value = '';
}
async function createNewBranch() {
  if (!branchFilter.value.trim()) return;
  await withBusy('newBranch', () => socket.git.newBranch(branchFilter.value.trim()));
  showBranches.value = false;
  branchFilter.value = '';
  await loadBranches();
}
function createOrCheckout() {
  const match = filteredBranches.value.find(b => b.name === branchFilter.value);
  if (match) switchBranch(match.name);
  else createNewBranch();
}
async function initRepo() {
  await withBusy('init', () => socket.shell.exec('git init'));
}
</script>

<style>
.git-panel {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  height: 70vh;
  max-height: 600px;
  background: var(--bg-surface);
  border-top: 1px solid var(--border-mid);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -8px 40px rgba(0,0,0,0.5);
  z-index: 9998;
  display: flex;
  flex-direction: column;
  /* Use visibility+translate instead of transform-only hide.
     transform alone creates a stacking context that breaks mobile keyboard focus. */
  visibility: hidden;
  opacity: 0;
  transform: translateY(20px);
  transition: visibility 0s linear 0.3s, opacity 0.3s cubic-bezier(0.25,0.46,0.45,0.94), transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94);
  pointer-events: none;
}
.git-panel.open {
  visibility: visible;
  opacity: 1;
  transform: translateY(0);
  transition-delay: 0s;
  pointer-events: all;
}

.git-handle {
  padding: 10px;
  display: flex;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}
.handle-bar {
  width: 36px; height: 4px;
  background: var(--border-bright);
  border-radius: 2px;
}

.git-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 10px;
  gap: 10px;
  flex-shrink: 0;
}
.git-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.git-icon { font-size: 16px; flex-shrink: 0; }
.git-branch {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 8px;
  font-weight: 600;
}
.badge.up { background: var(--green-dim); color: var(--green); }
.badge.down { background: var(--yellow-dim); color: var(--yellow); }
.branch-chevron {
  color: var(--text-dim);
  font-size: 16px;
  transition: transform 0.15s;
  display: inline-block;
}
.branch-chevron.open { transform: rotate(90deg); }

.git-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.git-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 10px;
  background: var(--bg-raised);
  border: 1px solid var(--border-mid);
  border-radius: 7px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.git-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
.git-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.git-btn.primary { background: var(--accent-dim); border-color: var(--accent); color: var(--accent-bright); }
.git-btn.primary:hover:not(:disabled) { background: var(--accent); color: white; }
.git-btn.icon-only { padding: 5px 8px; }
.spinning { animation: spin 0.7s linear infinite; }

.op-output {
  margin: 0 14px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-family: var(--font-mono);
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-shrink: 0;
}
.op-output.success { background: var(--green-dim); color: var(--green); border: 1px solid var(--green); }
.op-output.error { background: var(--red-dim); color: var(--red); border: 1px solid var(--red); }
.op-output span { flex: 1; white-space: pre-wrap; word-break: break-all; }
.op-dismiss { background: none; border: none; cursor: pointer; color: inherit; font-size: 12px; flex-shrink: 0; }

/* Branch panel */
.branch-panel {
  flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden;
}
.branch-search-wrap { padding: 0 14px 8px; flex-shrink: 0; }
.branch-search {
  width: 100%; background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 7px; padding: 7px 10px; color: var(--text-primary);
  font-family: var(--font-mono); font-size: 12px; outline: none;
}
.branch-search:focus { border-color: var(--accent); }
.branch-list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
.branch-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 8px;
  border-radius: 6px; cursor: pointer; transition: background 0.1s;
}
.branch-item:hover { background: var(--bg-raised); }
.branch-item.active { background: var(--accent-dim); }
.branch-type { font-size: 12px; color: var(--text-dim); flex-shrink: 0; }
.branch-name { font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); flex: 1; }
.branch-current { font-size: 10px; color: var(--accent); background: var(--accent-dim); padding: 1px 6px; border-radius: 8px; flex-shrink: 0; }
.branch-create { padding: 10px 8px; color: var(--accent); font-size: 13px; cursor: pointer; }
.branch-empty { padding: 12px 8px; color: var(--text-dim); font-size: 12px; text-align: center; }

/* Git body */
.git-body { flex: 1; overflow-y: auto; min-height: 0; padding-bottom: 8px; }
.git-empty { padding: 24px; text-align: center; color: var(--text-muted); display: flex; flex-direction: column; gap: 12px; align-items: center; font-size: 13px; }

.git-section { border-bottom: 1px solid var(--border-subtle); }
.section-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; cursor: pointer; user-select: none;
  transition: background 0.1s;
}
.section-header:hover { background: var(--bg-raised); }
.section-chevron {
  color: var(--text-dim); font-size: 16px; width: 14px;
  transition: transform 0.15s; display: inline-block;
}
.section-chevron.open { transform: rotate(90deg); }
.section-title { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; flex: 1; }
.section-count {
  min-width: 18px; height: 18px; padding: 0 5px;
  background: var(--bg-overlay); border-radius: 9px;
  font-size: 10px; color: var(--text-secondary); display: flex; align-items: center; justify-content: center;
}
.section-action {
  width: 22px; height: 22px; border-radius: 5px; border: 1px solid var(--border-mid);
  background: var(--bg-overlay); color: var(--text-secondary); cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600;
  transition: background 0.1s;
}
.section-action:hover { background: var(--accent-dim); color: var(--accent); }

.file-list { padding: 2px 0 6px; }
.file-empty { padding: 6px 14px; font-size: 12px; color: var(--text-dim); }
.file-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 14px; cursor: pointer; transition: background 0.1s;
}
.file-row:hover { background: var(--bg-raised); }
.file-status {
  width: 14px; font-size: 11px; font-weight: 700; font-family: var(--font-mono);
  flex-shrink: 0; text-align: center;
}
.file-status.modified { color: var(--git-modified); }
.file-status.added { color: var(--git-added); }
.file-status.deleted { color: var(--git-deleted); }
.file-status.renamed { color: var(--blue); }
.file-status.untracked { color: var(--git-untracked); }
.file-name { font-size: 12px; color: var(--text-primary); flex-shrink: 0; max-width: 120px; }
.file-path { font-size: 10px; color: var(--text-dim); font-family: var(--font-mono); flex: 1; }
.file-action {
  width: 20px; height: 20px; border-radius: 4px; border: 1px solid var(--border-mid);
  background: var(--bg-overlay); color: var(--red); cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700;
  flex-shrink: 0; opacity: 0; transition: opacity 0.1s, background 0.1s;
}
.file-action.plus { color: var(--green); }
.file-row:hover .file-action { opacity: 1; }
.file-action:hover { background: var(--bg-hover); }

/* Commit */
.commit-section { padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 8px; }
.commit-msg {
  width: 100%; background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 8px; padding: 8px 10px; color: var(--text-primary);
  font-family: var(--font-ui); font-size: 13px; outline: none; resize: none;
  transition: border-color 0.15s;
}
.commit-msg:focus { border-color: var(--accent); }
.commit-actions { display: flex; justify-content: flex-end; }

/* Commit log */
.commit-log { padding: 0 0 4px; }
.commit-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px; transition: background 0.1s;
}
.commit-row:hover { background: var(--bg-raised); }
.commit-hash { font-family: var(--font-mono); font-size: 11px; color: var(--accent); flex-shrink: 0; }
.commit-subject { font-size: 12px; color: var(--text-primary); flex: 1; }
.commit-meta { font-size: 10px; color: var(--text-dim); flex-shrink: 0; }
</style>
