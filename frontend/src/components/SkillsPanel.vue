<template>
  <Teleport to="body">
    <div class="skills-panel" :class="{ open: modelValue }">
      <!-- Header -->
      <div class="skills-header">
        <button class="skills-back" @click="$emit('update:modelValue', false)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span class="skills-title">Skills</span>
        <a href="https://skillsprotocol.com" target="_blank" class="skills-spec-link">spec ↗</a>
        <button class="skills-new-btn" @click="showCreate = true">+ New</button>
      </div>

      <!-- Runtime info bar -->
      <div class="skills-runtime-bar">
        <span class="runtime-dot" />
        <span class="runtime-label">Skills Runtime</span>
        <code class="runtime-url">http://127.0.0.1:{{ skillsPort }}/rpc</code>
        <span class="runtime-spec">JSON-RPC 2.0</span>
      </div>

      <div class="skills-body">
        <!-- Search / filter -->
        <div class="skills-search-wrap">
          <input class="skills-search" v-model="searchQuery" placeholder="Filter skills…" />
          <select class="skills-kind-filter" v-model="kindFilter">
            <option value="">All</option>
            <option value="action">Action</option>
            <option value="instruction">Instruction</option>
          </select>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="skills-loading">
          <div class="spinner-sm" />
        </div>

        <!-- Empty -->
        <div v-else-if="filteredSkills.length === 0" class="skills-empty">
          <p>No skills yet.</p>
          <button class="skills-create-btn" @click="showCreate = true">Create your first skill</button>
        </div>

        <!-- Skills list -->
        <div v-else class="skills-list">
          <div
            v-for="skill in filteredSkills"
            :key="skill.name"
            class="skill-card"
            :class="{ selected: selected?.name === skill.name }"
            @click="selectSkill(skill)"
          >
            <div class="skill-card-header">
              <span class="skill-kind-badge" :class="skill.kind">{{ skill.kind }}</span>
              <span class="skill-name truncate">{{ skill.name }}</span>
              <span class="skill-version">v{{ skill.version }}</span>
            </div>
            <p class="skill-desc">{{ skill.description }}</p>
          </div>
        </div>
      </div>

      <!-- Skill detail panel -->
      <Transition name="slide-up">
        <div v-if="selected" class="skill-detail">
          <div class="detail-header">
            <button class="detail-close" @click="selected = null">✕</button>
            <span class="detail-name">{{ selected.name }}</span>
            <div class="detail-actions">
              <button
                v-if="selected.kind === 'action'"
                class="detail-run-btn"
                @click="runSkill"
                :disabled="running"
              >
                {{ running ? '⏳' : '▶ Run' }}
              </button>
              <button class="detail-delete-btn" @click="deleteSkill">🗑</button>
            </div>
          </div>

          <div class="detail-tabs">
            <button :class="{ active: detailTab === 'docs' }" @click="detailTab = 'docs'">SKILL.md</button>
            <button :class="{ active: detailTab === 'manifest' }" @click="detailTab = 'manifest'">skill.toml</button>
            <button v-if="selected.kind === 'action'" :class="{ active: detailTab === 'run' }" @click="detailTab = 'run'">Run</button>
            <button v-if="lastRun" :class="{ active: detailTab === 'result' }" @click="detailTab = 'result'">Result</button>
          </div>

          <div class="detail-body">
            <!-- SKILL.md -->
            <div v-if="detailTab === 'docs'" class="detail-markdown">
              <pre class="skill-md-content">{{ skillMd }}</pre>
            </div>

            <!-- skill.toml -->
            <div v-if="detailTab === 'manifest'" class="detail-toml">
              <pre class="skill-toml-content">{{ skillToml }}</pre>
            </div>

            <!-- Run args -->
            <div v-if="detailTab === 'run'" class="detail-run">
              <p class="run-hint">Pass JSON arguments to <code>execute_skill</code>:</p>
              <textarea
                class="run-args-input"
                v-model="runArgs"
                placeholder='{"key": "value"}'
                rows="4"
                spellcheck="false"
              />
              <button class="detail-run-btn full" @click="runSkill" :disabled="running">
                {{ running ? 'Running…' : '▶ Execute Skill' }}
              </button>
            </div>

            <!-- Last run result -->
            <div v-if="detailTab === 'result' && lastRun" class="detail-result">
              <div class="result-status" :class="lastRun.status">
                {{ lastRun.status === 'completed' ? '✓' : '✕' }} {{ lastRun.status }}
                <span class="result-id">{{ lastRun.run_id }}</span>
              </div>
              <p class="result-summary">{{ lastRun.summary }}</p>
              <pre v-if="lastRun.output" class="result-output">{{ JSON.stringify(lastRun.output, null, 2) }}</pre>
              <pre v-if="lastRun.logs_preview" class="result-logs">{{ lastRun.logs_preview }}</pre>
              <pre v-if="lastRun.error" class="result-error">{{ lastRun.error.message }}</pre>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Create skill modal -->
      <div v-if="showCreate" class="create-overlay" @click.self="showCreate = false">
        <div class="create-modal">
          <p class="create-title">New Skill</p>

          <label class="create-label">Name <span class="create-hint">(dot notation, e.g. my.skill)</span></label>
          <input class="create-input mono" v-model="newName" placeholder="my.skill.name" @keyup.enter="createSkill" />

          <label class="create-label">Kind</label>
          <div class="kind-toggle">
            <button :class="{ active: newKind === 'action' }" @click="newKind = 'action'">⚡ Action</button>
            <button :class="{ active: newKind === 'instruction' }" @click="newKind = 'instruction'">📖 Instruction</button>
          </div>

          <label class="create-label" v-if="newKind === 'action'">Language</label>
          <select v-if="newKind === 'action'" class="create-select" v-model="newLanguage">
            <option value="javascript">JavaScript</option>
            <option value="python">Python</option>
          </select>

          <label class="create-label">Description</label>
          <input class="create-input" v-model="newDesc" placeholder="What does this skill do?" />

          <p v-if="createError" class="create-error">{{ createError }}</p>

          <div class="create-actions">
            <button class="btn-secondary" @click="showCreate = false">Cancel</button>
            <button class="btn-primary" @click="createSkill" :disabled="!newName.trim() || creating">
              {{ creating ? 'Creating…' : 'Create' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useSocketStore } from '@/stores/socket.js';
import { useEditorStore } from '@/stores/editor.js';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

const socket = useSocketStore();
const editorStore = useEditorStore();

const skills = ref([]);
const loading = ref(false);
const selected = ref(null);
const skillMd = ref('');
const skillToml = ref('');
const detailTab = ref('docs');
const runArgs = ref('{}');
const running = ref(false);
const lastRun = ref(null);
const searchQuery = ref('');
const kindFilter = ref('');
const showCreate = ref(false);
const newName = ref('');
const newKind = ref('action');
const newLanguage = ref('javascript');
const newDesc = ref('');
const createError = ref('');
const creating = ref(false);
const skillsPort = ref(3003);

const filteredSkills = computed(() => {
  let list = skills.value;
  if (kindFilter.value) list = list.filter(s => s.kind === kindFilter.value);
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter(s => s.name.includes(q) || s.description?.toLowerCase().includes(q));
  }
  return list;
});

watch(() => props.modelValue, (v) => { if (v) loadSkills(); });

async function loadSkills() {
  loading.value = true;
  try {
    const res = await socket.skills.list();
    skills.value = res?.skills || res || [];
  } catch { skills.value = []; }
  finally { loading.value = false; }
}

async function selectSkill(skill) {
  selected.value = skill;
  detailTab.value = 'docs';
  lastRun.value = null;
  skillMd.value = '';
  skillToml.value = '';
  try {
    const mdRes = await socket.skills.readFile(skill.name, 'SKILL.md');
    skillMd.value = mdRes.content || '';
  } catch { skillMd.value = '(SKILL.md not found)'; }
  try {
    const tomlRes = await socket.skills.readFile(skill.name, 'skill.toml');
    skillToml.value = tomlRes.content || '';
  } catch { skillToml.value = '(skill.toml not found)'; }
}

async function runSkill() {
  if (!selected.value || running.value) return;
  running.value = true;
  lastRun.value = null;
  try {
    let args = {};
    try { args = JSON.parse(runArgs.value || '{}'); } catch { args = {}; }
    const res = await socket.skills.execute(selected.value.name, args);
    lastRun.value = res;
    detailTab.value = 'result';
  } catch (err) {
    lastRun.value = { status: 'failed', run_id: '-', summary: err.message, error: { message: err.message } };
    detailTab.value = 'result';
  } finally {
    running.value = false;
  }
}

async function deleteSkill() {
  if (!selected.value) return;
  if (!confirm(`Delete skill "${selected.value.name}"?`)) return;
  await socket.skills.delete(selected.value.name);
  selected.value = null;
  await loadSkills();
}

async function createSkill() {
  createError.value = '';
  if (!newName.value.trim()) return;
  creating.value = true;
  try {
    const result = await socket.skills.create(
      newName.value.trim(), newKind.value, newDesc.value, newLanguage.value
    );
    showCreate.value = false;
    newName.value = ''; newDesc.value = '';
    await loadSkills();
    // Open the newly created skill in the editor
    if (result.dir) {
      editorStore.openFile(`${result.dir}/SKILL.md`);
    }
  } catch (err) {
    createError.value = err.message;
  } finally {
    creating.value = false;
  }
}

onMounted(() => { if (props.modelValue) loadSkills(); });
</script>

<style>
.skills-panel {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--bg-base);
  z-index: 10003;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.skills-panel.open { transform: translateX(0); }

.skills-header {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.skills-back {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 7px;
  color: var(--text-secondary); cursor: pointer; transition: background 0.15s;
}
.skills-back:hover { background: var(--bg-hover); }
.skills-title { font-size: 16px; font-weight: 600; color: var(--text-bright); flex: 1; }
.skills-spec-link { font-size: 11px; color: var(--accent); text-decoration: none; }
.skills-new-btn {
  padding: 5px 12px; background: var(--accent); border: none;
  border-radius: 7px; color: white; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: opacity 0.15s;
}
.skills-new-btn:hover { opacity: 0.85; }

.skills-runtime-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 11px; flex-shrink: 0;
}
.runtime-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--green); box-shadow: 0 0 4px var(--green); flex-shrink: 0;
}
.runtime-label { color: var(--text-muted); }
.runtime-url { font-family: var(--font-mono); color: var(--accent-bright); flex: 1; }
.runtime-spec {
  background: var(--accent-dim); color: var(--accent-bright);
  padding: 1px 6px; border-radius: 4px; font-size: 10px;
}

.skills-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
.skills-search-wrap { display: flex; gap: 6px; padding: 10px 14px; flex-shrink: 0; }
.skills-search {
  flex: 1; background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 7px; padding: 7px 10px; color: var(--text-primary);
  font-family: var(--font-ui); font-size: 13px; outline: none;
}
.skills-search:focus { border-color: var(--accent); }
.skills-kind-filter {
  background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 7px; padding: 7px 8px; color: var(--text-primary);
  font-size: 12px; outline: none; flex-shrink: 0;
}

.skills-loading { display: flex; justify-content: center; padding: 24px; }
.spinner-sm {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid var(--border-mid); border-top-color: var(--accent);
  animation: spin 0.6s linear infinite;
}
.skills-empty { padding: 32px; text-align: center; color: var(--text-dim); display: flex; flex-direction: column; gap: 12px; align-items: center; }
.skills-create-btn {
  padding: 7px 16px; background: var(--accent-dim); border: 1px solid var(--accent);
  border-radius: 7px; color: var(--accent-bright); cursor: pointer; font-size: 13px;
}

.skills-list { padding: 0 14px 80px; display: flex; flex-direction: column; gap: 6px; }
.skill-card {
  background: var(--bg-raised); border: 1px solid var(--border-subtle);
  border-radius: 10px; padding: 10px 12px; cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}
.skill-card:hover { background: var(--bg-hover); border-color: var(--border-mid); }
.skill-card.selected { border-color: var(--accent); background: var(--accent-dim); }
.skill-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.skill-kind-badge {
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  padding: 2px 5px; border-radius: 4px;
}
.skill-kind-badge.action { background: rgba(124,106,247,0.2); color: var(--accent-bright); }
.skill-kind-badge.instruction { background: rgba(96,165,250,0.15); color: var(--blue); }
.skill-name { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-primary); flex: 1; }
.skill-version { font-size: 10px; color: var(--text-dim); font-family: var(--font-mono); }
.skill-desc { font-size: 12px; color: var(--text-muted); line-height: 1.4; margin: 0; }

/* Detail panel */
.skill-detail {
  position: fixed; left: 0; right: 0; bottom: 0;
  height: 70vh; background: var(--bg-surface);
  border-top: 1px solid var(--border-mid);
  border-radius: 14px 14px 0 0;
  box-shadow: 0 -8px 40px rgba(0,0,0,0.5);
  z-index: 10004;
  display: flex; flex-direction: column;
}
.slide-up-enter-active, .slide-up-leave-active { transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94); }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); }

.detail-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px 6px; flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
}
.detail-close {
  background: none; border: none; color: var(--text-dim); cursor: pointer;
  font-size: 14px; padding: 2px 6px;
}
.detail-name { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--text-bright); flex: 1; }
.detail-actions { display: flex; gap: 6px; }
.detail-run-btn {
  padding: 5px 12px; background: var(--accent); border: none;
  border-radius: 6px; color: white; font-size: 12px; cursor: pointer;
  transition: opacity 0.15s;
}
.detail-run-btn.full { width: 100%; margin-top: 8px; padding: 9px; }
.detail-run-btn:disabled { opacity: 0.5; }
.detail-delete-btn { background: none; border: none; cursor: pointer; font-size: 14px; }
.detail-delete-btn:hover { filter: brightness(1.5); }

.detail-tabs {
  display: flex; gap: 0; padding: 0 14px;
  border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
}
.detail-tabs button {
  padding: 7px 12px; background: none; border: none;
  border-bottom: 2px solid transparent; color: var(--text-muted);
  font-size: 12px; cursor: pointer; transition: color 0.15s;
}
.detail-tabs button.active { color: var(--accent-bright); border-bottom-color: var(--accent); }

.detail-body { flex: 1; overflow-y: auto; padding: 10px 14px; }
.skill-md-content, .skill-toml-content {
  font-family: var(--font-mono); font-size: 12px; color: var(--text-primary);
  white-space: pre-wrap; word-break: break-word; margin: 0; line-height: 1.6;
}
.run-hint { font-size: 12px; color: var(--text-muted); margin: 0 0 8px; }
.run-hint code { font-family: var(--font-mono); color: var(--accent-bright); }
.run-args-input {
  width: 100%; background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 8px; padding: 8px 10px; color: var(--text-primary);
  font-family: var(--font-mono); font-size: 12px; outline: none; resize: none;
}
.result-status {
  font-size: 12px; font-weight: 600; padding: 5px 0; margin-bottom: 6px;
  display: flex; align-items: center; gap: 8px;
}
.result-status.completed { color: var(--green); }
.result-status.failed { color: var(--red); }
.result-id { font-family: var(--font-mono); font-size: 10px; color: var(--text-dim); font-weight: 400; }
.result-summary { font-size: 12px; color: var(--text-secondary); margin: 0 0 8px; }
.result-output, .result-logs, .result-error {
  font-family: var(--font-mono); font-size: 11px; padding: 8px;
  border-radius: 6px; white-space: pre-wrap; word-break: break-all;
  margin: 4px 0; max-height: 200px; overflow-y: auto;
}
.result-output { background: var(--bg-raised); color: var(--text-primary); }
.result-logs { background: var(--bg-void); color: var(--text-muted); }
.result-error { background: var(--red-dim); color: var(--red); }

/* Create modal */
.create-overlay {
  position: absolute; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 10005; backdrop-filter: blur(2px);
}
.create-modal {
  background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 14px; padding: 20px; width: 90%; max-width: 360px;
  display: flex; flex-direction: column; gap: 10px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  animation: fadeIn 0.15s ease;
}
.create-title { font-size: 15px; font-weight: 600; color: var(--text-bright); }
.create-label { font-size: 11px; color: var(--text-muted); font-weight: 500; margin-bottom: -4px; }
.create-hint { color: var(--text-dim); font-weight: 400; }
.create-input {
  background: var(--bg-surface); border: 1px solid var(--border-mid);
  border-radius: 7px; padding: 8px 10px; color: var(--text-primary);
  font-family: var(--font-ui); font-size: 13px; outline: none;
}
.create-input.mono { font-family: var(--font-mono); }
.create-input:focus { border-color: var(--accent); }
.create-select {
  background: var(--bg-surface); border: 1px solid var(--border-mid);
  border-radius: 7px; padding: 8px 10px; color: var(--text-primary); font-size: 13px; outline: none;
}
.kind-toggle { display: flex; gap: 6px; }
.kind-toggle button {
  flex: 1; padding: 7px; background: var(--bg-surface); border: 1px solid var(--border-mid);
  border-radius: 7px; color: var(--text-muted); cursor: pointer; font-size: 12px;
  transition: all 0.15s;
}
.kind-toggle button.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent-bright); }
.create-error { font-size: 12px; color: var(--red); background: var(--red-dim); padding: 6px 8px; border-radius: 6px; }
.create-actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn-primary {
  background: var(--accent); color: white; border: none;
  padding: 7px 16px; border-radius: 7px; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: opacity 0.15s;
}
.btn-primary:disabled { opacity: 0.4; }
.btn-secondary {
  background: var(--bg-overlay); color: var(--text-secondary);
  border: 1px solid var(--border-mid);
  padding: 7px 16px; border-radius: 7px; font-size: 13px; cursor: pointer;
}
</style>
