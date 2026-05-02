<template>
  <Teleport to="body">
    <div class="thought-panel" :class="{ open: modelValue, minimized }">

      <!-- Header / drag handle -->
      <div class="thought-header" @click="toggleMinimize">
        <div class="thought-header-left">
          <span class="thought-icon" :class="{ pulse: agentStore.running }">🤖</span>
          <span class="thought-title">Agent</span>
          <span v-if="agentStore.running" class="thought-status running">
            <span class="status-dot-anim" />
            running · iter {{ agentStore.iterations }}
          </span>
          <span v-else-if="agentStore.done" class="thought-status done">✓ done</span>
          <span v-else-if="agentStore.error" class="thought-status error">⚠ error</span>
        </div>
        <div class="thought-header-right" @click.stop>
          <button v-if="agentStore.running" class="thought-btn cancel" @click="agentStore.cancelTask()">
            ⏹ Stop
          </button>
          <button class="thought-btn" @click="minimized = !minimized" :title="minimized ? 'Expand' : 'Minimize'">
            {{ minimized ? '▲' : '▼' }}
          </button>
          <button class="thought-btn" @click="$emit('update:modelValue', false)">✕</button>
        </div>
      </div>

      <!-- Body: thought stream -->
      <div v-if="!minimized" class="thought-body" ref="streamEl">
        <div v-if="agentStore.thoughts.length === 0" class="thought-empty">
          <p>No activity yet. Run a task to see the agent's reasoning.</p>
        </div>

        <template v-for="(thought, i) in agentStore.thoughts" :key="i">
          <!-- Thinking indicator -->
          <div v-if="thought.type === 'agent:thinking'" class="thought-entry thinking">
            <span class="entry-icon">💭</span>
            <span class="entry-text">Thinking… (iteration {{ thought.iteration }})</span>
          </div>

          <!-- Delta text: collapse into readable chunks -->
          <div v-else-if="thought.type === 'agent:delta'" class="thought-delta">
            <span class="delta-text">{{ thought.delta }}</span>
          </div>

          <!-- Shell -->
          <div v-else-if="thought.type === 'agent:shell'" class="thought-entry shell">
            <div class="entry-header">
              <span class="entry-icon">⬛</span>
              <code class="shell-cmd">$ {{ thought.command }}</code>
            </div>
            <pre class="shell-output" v-if="thought.output">{{ thought.output.slice(0, 500) }}</pre>
          </div>

          <!-- File write -->
          <div v-else-if="thought.type === 'agent:write'" class="thought-entry write">
            <span class="entry-icon">✏️</span>
            <span class="entry-text">Wrote <code>{{ thought.path }}</code></span>
          </div>

          <!-- File read -->
          <div v-else-if="thought.type === 'agent:read'" class="thought-entry read">
            <span class="entry-icon">📖</span>
            <span class="entry-text">Read <code>{{ thought.path }}</code></span>
          </div>

          <!-- Generic forge tool action -->
          <div v-else-if="thought.type === 'agent:action'" class="thought-entry read">
            <span class="entry-icon">{{ forgeToolIcon(thought.name || thought.event?.name) }}</span>
            <span class="entry-text">
              <code>{{ thought.name || thought.event?.name }}</code>
              <span v-if="thought.input?.args?.path"> → {{ thought.input.args.path }}</span>
              <span v-else-if="thought.input?.args?.query"> "{{ thought.input.args.query }}"</span>
            </span>
          </div>

          <!-- Tool error -->
          <div v-else-if="thought.type === 'agent:tool_error'" class="thought-entry tool-error">
            <span class="entry-icon">⚠️</span>
            <span class="entry-text">{{ thought.tool }} failed: {{ thought.error }}</span>
          </div>

          <!-- Done -->
          <div v-else-if="thought.type === 'agent:done'" class="thought-entry done-entry">
            <div class="done-header">
              <span class="entry-icon">✅</span>
              <span class="entry-text">Completed in {{ thought.iterations }} iteration{{ thought.iterations !== 1 ? 's' : '' }}</span>
            </div>
            <div class="done-summary" v-if="thought.summary">{{ thought.summary }}</div>
          </div>

          <!-- Error -->
          <div v-else-if="thought.type === 'agent:error'" class="thought-entry error-entry">
            <span class="entry-icon">❌</span>
            <span class="entry-text">{{ thought.error }}</span>
          </div>

          <!-- Start -->
          <div v-else-if="thought.type === 'agent:start'" class="thought-entry start-entry">
            <span class="entry-icon">🚀</span>
            <span class="entry-text">Task: {{ thought.task }}</span>
          </div>
        </template>

        <!-- Streaming cursor while running -->
        <div v-if="agentStore.running" class="thought-cursor">
          <span class="cursor-blink">▋</span>
        </div>
      </div>

      <!-- Task input bar -->
      <div v-if="!minimized" class="thought-input-bar">
        <textarea
          ref="inputEl"
          class="thought-input"
          v-model="taskInput"
          placeholder="Describe a task for the agent… e.g. 'Add error handling to all async functions'"
          rows="2"
          @keydown.ctrl.enter.prevent="submitTask"
          @keydown.meta.enter.prevent="submitTask"
          @input="autoResize"
          :disabled="agentStore.running"
        />
        <div class="thought-input-actions">
          <div class="pin-row" v-if="agentStore.pinnedFiles.length">
            <span class="pin-label">📌 {{ agentStore.pinnedFiles.length }} pinned</span>
          </div>
          <button
            class="thought-send"
            @click="submitTask"
            :disabled="!taskInput.trim() || agentStore.running"
          >
            <svg v-if="!agentStore.running" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            <span v-else class="btn-spinner-sm" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import { useAgentStore } from '@/stores/agent.js';
import { useEditorStore } from '@/stores/editor.js';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

const agentStore = useAgentStore();
const editorStore = useEditorStore();

const minimized = ref(false);
const taskInput = ref('');
const streamEl = ref(null);
const inputEl = ref(null);

// Auto-scroll thought stream
watch(() => agentStore.thoughts.length, async () => {
  await nextTick();
  if (streamEl.value) {
    streamEl.value.scrollTop = streamEl.value.scrollHeight;
  }
});

// Auto-open when agent starts
watch(() => agentStore.running, (r) => {
  if (r) {
    emit('update:modelValue', true);
    minimized.value = false;
  }
});

function submitTask() {
  const task = taskInput.value.trim();
  if (!task || agentStore.running) return;

  // Include active file and pinned files
  const filePaths = [
    ...agentStore.pinnedFiles,
    ...(editorStore.activeTab ? [editorStore.activeTab.path] : []),
  ].filter(Boolean);

  agentStore.runTask(task, [...new Set(filePaths)]);
  taskInput.value = '';
  if (inputEl.value) inputEl.value.style.height = 'auto';
}

function toggleMinimize() {
  minimized.value = !minimized.value;
}

function autoResize(e) {
  const el = e.target;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

function forgeToolIcon(name) {
  const icons = {
    read_file: '📖', write_file: '✏️', list_dir: '📁',
    search_files: '🔎', grep: '🔍', git_status: '⎇',
    git_diff: '±', git_commit: '💾', shell_exec: '⬛',
    create_file: '📄', delete_file: '🗑', rename_file: '✏️',
  };
  return icons[name] || '⚙️';
}
</script>

<style>
.thought-panel {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  max-height: 70vh;
  background: var(--bg-surface);
  border-top: 1px solid var(--border-mid);
  border-radius: 14px 14px 0 0;
  box-shadow: 0 -8px 40px rgba(0,0,0,0.5);
  z-index: 9994;
  display: flex;
  flex-direction: column;
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),
              max-height 0.25s ease;
}
.thought-panel.open { transform: translateY(0); }
.thought-panel.minimized { max-height: 48px; }

/* Header */
.thought-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px;
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
}
.thought-header-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.thought-icon { font-size: 16px; transition: transform 0.3s; }
.thought-icon.pulse { animation: agent-pulse 1.5s ease infinite; }
@keyframes agent-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}
.thought-title { font-size: 13px; font-weight: 600; color: var(--text-bright); }
.thought-status {
  font-size: 11px; padding: 1px 7px; border-radius: 8px;
  display: flex; align-items: center; gap: 4px;
}
.thought-status.running { background: var(--accent-dim); color: var(--accent-bright); }
.thought-status.done { background: var(--green-dim); color: var(--green); }
.thought-status.error { background: var(--red-dim); color: var(--red); }
.status-dot-anim {
  width: 6px; height: 6px; border-radius: 50%; background: currentColor;
  animation: pulse-glow 1s infinite;
}

.thought-header-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.thought-btn {
  padding: 4px 8px; background: var(--bg-overlay); border: 1px solid var(--border-mid);
  border-radius: 5px; color: var(--text-muted); font-size: 11px; cursor: pointer;
  transition: background 0.1s;
}
.thought-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.thought-btn.cancel { color: var(--red); border-color: var(--red-dim); background: var(--red-dim); }

/* Body */
.thought-body {
  flex: 1; overflow-y: auto; padding: 8px 12px;
  display: flex; flex-direction: column; gap: 4px;
  font-family: var(--font-mono); font-size: 12px;
}
.thought-empty { padding: 20px 0; text-align: center; color: var(--text-dim); font-family: var(--font-ui); font-size: 13px; }

/* Thought entries */
.thought-entry {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 5px 8px; border-radius: 6px;
  animation: fadeIn 0.2s ease;
}
.thought-entry.thinking { color: var(--text-dim); font-style: italic; }
.thought-entry.shell { background: var(--bg-void); flex-direction: column; gap: 4px; }
.thought-entry.write { background: rgba(74,222,128,0.06); color: var(--green); }
.thought-entry.read { background: rgba(96,165,250,0.06); color: var(--blue); }
.thought-entry.tool-error { background: var(--red-dim); color: var(--red); }
.thought-entry.done-entry { background: rgba(74,222,128,0.08); flex-direction: column; gap: 6px; }
.thought-entry.error-entry { background: var(--red-dim); color: var(--red); }
.thought-entry.start-entry { background: var(--accent-dim); color: var(--accent-bright); }

.entry-icon { font-size: 13px; flex-shrink: 0; }
.entry-text { flex: 1; color: var(--text-secondary); word-break: break-word; }
.entry-text code { color: var(--accent-bright); }

.entry-header { display: flex; align-items: center; gap: 6px; }
.shell-cmd { color: var(--text-primary); font-size: 11px; flex: 1; }
.shell-output {
  font-size: 10px; color: var(--text-muted);
  background: var(--bg-surface); border-radius: 4px;
  padding: 4px 6px; margin: 0; white-space: pre-wrap; word-break: break-all;
  max-height: 80px; overflow-y: auto;
}

.thought-delta {
  color: var(--text-secondary); line-height: 1.5;
  padding: 0 8px; white-space: pre-wrap; word-break: break-word;
}
.delta-text { display: inline; }

.done-header { display: flex; align-items: center; gap: 8px; }
.done-summary {
  font-family: var(--font-ui); font-size: 12px; color: var(--text-primary);
  line-height: 1.5; padding-left: 4px; white-space: pre-wrap;
}

.thought-cursor { padding: 0 8px; }
.cursor-blink { color: var(--accent); animation: blink 1s step-end infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

/* Input bar */
.thought-input-bar {
  border-top: 1px solid var(--border-subtle);
  padding: 8px 10px;
  display: flex; flex-direction: column; gap: 6px;
  flex-shrink: 0;
}
.thought-input {
  width: 100%; background: var(--bg-raised); border: 1px solid var(--border-mid);
  border-radius: 10px; padding: 8px 12px;
  color: var(--text-primary); font-family: var(--font-ui); font-size: 13px;
  line-height: 1.4; outline: none; resize: none;
  min-height: 36px; max-height: 100px;
  transition: border-color 0.15s;
  -webkit-appearance: none;
}
.thought-input:focus { border-color: var(--accent); }
.thought-input:disabled { opacity: 0.5; }
.thought-input::placeholder { color: var(--text-dim); }

.thought-input-actions {
  display: flex; align-items: center; justify-content: space-between;
}
.pin-row { font-size: 11px; color: var(--accent-bright); }
.thought-send {
  width: 34px; height: 34px; border-radius: 9px;
  background: var(--accent); border: none;
  color: white; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: opacity 0.15s, transform 0.1s;
  margin-left: auto;
}
.thought-send:disabled { opacity: 0.3; cursor: not-allowed; }
.thought-send:active:not(:disabled) { transform: scale(0.92); }
.btn-spinner-sm {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white;
  animation: spin 0.7s linear infinite;
}
</style>
