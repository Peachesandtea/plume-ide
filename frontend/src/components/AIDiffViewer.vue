<template>
  <Teleport to="body">
    <div class="diff-panel" :class="{ open: modelValue }">
      <!-- Handle -->
      <div class="diff-handle" @click="$emit('update:modelValue', false)">
        <div class="handle-bar" />
      </div>

      <!-- Header -->
      <div class="diff-header">
        <div class="diff-title-row">
          <span class="diff-skill-icon">{{ skillIcon }}</span>
          <span class="diff-title">{{ skillLabel }}</span>
          <span v-if="aiStore.running" class="diff-streaming">
            <span class="stream-dot" />streaming
          </span>
          <span v-else-if="aiStore.error" class="diff-error-badge">Error</span>
        </div>

        <div class="diff-actions" v-if="!aiStore.running">
          <button v-if="aiStore.hasDiff" class="diff-btn accept-all" @click="aiStore.acceptAll()">
            ✓ Accept All
          </button>
          <button v-if="aiStore.hasDiff" class="diff-btn reject-all" @click="aiStore.rejectAll()">
            ✕ Reject All
          </button>
          <button v-if="!aiStore.hasDiff && !aiStore.error" class="diff-btn close-btn" @click="$emit('update:modelValue', false)">
            Done
          </button>
        </div>
      </div>

      <!-- Error state -->
      <div v-if="aiStore.error" class="diff-error">
        <p>{{ aiStore.error }}</p>
        <button class="diff-btn close-btn" @click="$emit('update:modelValue', false)">Close</button>
      </div>

      <!-- Streaming: show raw text while running and no diff yet -->
      <div v-else-if="aiStore.running || (!aiStore.hasDiff && aiStore.streamedText)" class="diff-stream-body">
        <pre class="diff-stream-text">{{ aiStore.streamedText }}<span v-if="aiStore.running" class="cursor-blink">▋</span></pre>
      </div>

      <!-- Diff hunks -->
      <div v-else-if="aiStore.hasDiff" class="diff-body">
        <div class="diff-file-label">
          <span class="diff-file-icon">📄</span>
          <span class="diff-file-name">{{ aiStore.activeFile }}</span>
          <span class="diff-hunk-count">{{ aiStore.diffHunks.length }} change{{ aiStore.diffHunks.length !== 1 ? 's' : '' }}</span>
        </div>

        <div v-for="hunk in aiStore.diffHunks" :key="hunk.id" class="diff-hunk">
          <div class="hunk-header">
            <span class="hunk-pos">@@ -{{ hunk.oldStart }} +{{ hunk.newStart }} @@</span>
            <div class="hunk-actions">
              <button class="hunk-btn accept" @click="aiStore.acceptHunk(hunk.id)" title="Accept this change">✓</button>
              <button class="hunk-btn reject" @click="aiStore.rejectHunk(hunk.id)" title="Reject this change">✕</button>
            </div>
          </div>
          <div class="hunk-lines">
            <div
              v-for="(line, li) in hunk.lines"
              :key="li"
              class="diff-line"
              :class="line.type"
            >
              <span class="line-gutter">{{ line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ' }}</span>
              <span class="line-num">{{ line.oldLine || line.newLine || '' }}</span>
              <span class="line-content">{{ line.content }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Follow-up input — shown after any completed response, keyboard-friendly -->
      <div
        v-if="!aiStore.running && !aiStore.error && aiStore.streamedText"
        class="followup-bar"
      >
        <textarea
          ref="followUpEl"
          class="followup-input"
          v-model="followUpText"
          :placeholder="aiStore.isConversational ? 'Ask a follow-up question…' : 'Ask about these changes…'"
          rows="1"
          @keydown.enter.exact.prevent="submitFollowUp"
          @input="autoResize"
        />
        <button
          class="followup-send"
          @click="submitFollowUp"
          :disabled="!followUpText.trim()"
          title="Send (Enter)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>

      <!-- Snapshot restore bar -->
      <div class="diff-snapshot-bar" v-if="lastSnapshot">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10H13C17.4183 10 21 13.5817 21 18V20M3 10L7 6M3 10L7 14"/></svg>
        <span>Snapshot saved before this change</span>
        <button class="snapshot-restore-btn" @click="restoreSnapshot">Restore</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue';
import { useAIStore } from '@/stores/ai.js';
import { useSocketStore } from '@/stores/socket.js';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

const aiStore = useAIStore();
const socket = useSocketStore();

const lastSnapshot = ref(null);
const followUpText = ref('');
const followUpEl = ref(null);

const SKILL_META = {
  fix:      { icon: '🔧', label: 'Fix' },
  explain:  { icon: '💬', label: 'Explain' },
  refactor: { icon: '♻️',  label: 'Refactor' },
  docs:     { icon: '📖', label: 'Add Docs' },
  tests:    { icon: '🧪', label: 'Generate Tests' },
  optimize: { icon: '⚡', label: 'Optimize' },
};

const skillIcon  = computed(() => SKILL_META[aiStore.currentSkill]?.icon || '✨');
const skillLabel = computed(() => SKILL_META[aiStore.currentSkill]?.label || aiStore.currentSkill);

// Auto-open when AI starts, save a snapshot
watch(() => aiStore.running, async (running, wasRunning) => {
  if (running && !wasRunning) {
    emit('update:modelValue', true);
    lastSnapshot.value = null;
    followUpText.value = '';
    if (aiStore.activeFile) {
      try {
        const snap = await socket.snapshot.create(aiStore.activeFile, `pre-${aiStore.currentSkill}`);
        lastSnapshot.value = snap;
      } catch {}
    }
  }
});

// When response finishes on a conversational skill, focus the textarea
watch(() => aiStore.running, async (running) => {
  if (!running && aiStore.isConversational) {
    await nextTick();
    // Small delay so the textarea renders before we try to focus
    setTimeout(() => followUpEl.value?.focus(), 100);
  }
});

function submitFollowUp() {
  const text = followUpText.value.trim();
  if (!text) return;
  followUpText.value = '';
  if (followUpEl.value) {
    followUpEl.value.style.height = 'auto';
  }
  aiStore.sendFollowUp(text);
}

function autoResize(e) {
  const el = e.target;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

async function restoreSnapshot() {
  if (!lastSnapshot.value || !aiStore.activeFile) return;
  try {
    await socket.snapshot.restore(aiStore.activeFile, lastSnapshot.value.ts);
    window.dispatchEvent(new CustomEvent('forge:reload-file', { detail: { path: aiStore.activeFile } }));
    aiStore.rejectAll();
    lastSnapshot.value = null;
    emit('update:modelValue', false);
  } catch (err) {
    console.error('Restore failed:', err);
  }
}
</script>

<style>
.diff-panel {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  /* dvh shrinks with keyboard, vh doesn't — use both for compatibility */
  max-height: 75vh;
  max-height: 75dvh;
  background: var(--bg-surface);
  border-top: 1px solid var(--border-mid);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -8px 40px rgba(0,0,0,0.5);
  z-index: 9995;
  display: flex;
  flex-direction: column;
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94);
}
.diff-panel.open {
  transform: translateY(0);
}

.diff-handle {
  padding: 10px; display: flex; justify-content: center;
  cursor: pointer; flex-shrink: 0;
}
.handle-bar { width: 36px; height: 4px; background: var(--border-bright); border-radius: 2px; }

.diff-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 14px 10px; gap: 10px; flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
}
.diff-title-row { display: flex; align-items: center; gap: 8px; flex: 1; }
.diff-skill-icon { font-size: 18px; }
.diff-title { font-size: 14px; font-weight: 600; color: var(--text-bright); }
.diff-streaming {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; color: var(--accent); margin-left: 4px;
}
.stream-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent);
  animation: pulse-glow 1s infinite;
}
.diff-error-badge {
  font-size: 11px; color: var(--red);
  background: var(--red-dim); padding: 1px 7px; border-radius: 8px;
}

.diff-actions { display: flex; gap: 6px; flex-shrink: 0; }
.diff-btn {
  padding: 5px 12px; border-radius: 7px; border: 1px solid var(--border-mid);
  font-size: 12px; font-weight: 500; cursor: pointer;
  transition: background 0.15s;
}
.diff-btn.accept-all { background: var(--green-dim); color: var(--green); border-color: var(--green); }
.diff-btn.accept-all:hover { background: var(--green); color: var(--bg-void); }
.diff-btn.reject-all { background: var(--red-dim); color: var(--red); border-color: var(--red); }
.diff-btn.reject-all:hover { background: var(--red); color: white; }
.diff-btn.close-btn { background: var(--bg-overlay); color: var(--text-secondary); }
.diff-btn.close-btn:hover { background: var(--bg-hover); }

.diff-error {
  padding: 20px; color: var(--red); font-size: 13px;
  display: flex; flex-direction: column; gap: 12px; align-items: flex-start;
}

/* Streaming text */
.diff-stream-body { flex: 1; overflow-y: auto; padding: 12px 14px; }
.diff-stream-text {
  font-family: var(--font-mono); font-size: 12px; line-height: 1.6;
  color: var(--text-primary); white-space: pre-wrap; word-break: break-word;
  margin: 0;
}
.cursor-blink {
  display: inline-block;
  animation: blink 1s step-end infinite;
  color: var(--accent);
}
@keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }

/* Diff body */
.diff-body { flex: 1; overflow-y: auto; }
.diff-file-label {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 12px; color: var(--text-secondary);
  position: sticky; top: 0; z-index: 1;
}
.diff-file-name { font-family: var(--font-mono); flex: 1; }
.diff-hunk-count { color: var(--text-dim); font-size: 11px; }

.diff-hunk { border-bottom: 1px solid var(--border-subtle); }
.hunk-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 14px;
  background: var(--bg-raised);
}
.hunk-pos { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
.hunk-actions { display: flex; gap: 4px; }
.hunk-btn {
  width: 24px; height: 24px; border-radius: 5px; border: none;
  font-size: 13px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.1s;
}
.hunk-btn.accept { background: var(--green-dim); color: var(--green); }
.hunk-btn.accept:hover { background: var(--green); color: var(--bg-void); }
.hunk-btn.reject { background: var(--red-dim); color: var(--red); }
.hunk-btn.reject:hover { background: var(--red); color: white; }

.hunk-lines { font-family: var(--font-mono); font-size: 12px; }
.diff-line {
  display: flex; align-items: baseline; gap: 6px;
  padding: 1px 14px 1px 8px;
  line-height: 1.6;
}
.diff-line.add { background: rgba(74, 222, 128, 0.08); }
.diff-line.remove { background: rgba(248, 113, 113, 0.08); }
.line-gutter { width: 12px; text-align: center; flex-shrink: 0; font-weight: 700; }
.diff-line.add .line-gutter { color: var(--green); }
.diff-line.remove .line-gutter { color: var(--red); }
.line-num { width: 30px; text-align: right; color: var(--text-dim); flex-shrink: 0; }
.line-content { color: var(--text-primary); white-space: pre; overflow: hidden; text-overflow: ellipsis; flex: 1; }

/* Snapshot bar */
.diff-snapshot-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  background: var(--bg-raised);
  border-top: 1px solid var(--border-subtle);
  font-size: 11px; color: var(--text-muted);
  flex-shrink: 0;
}
.diff-snapshot-bar svg { flex-shrink: 0; }
.diff-snapshot-bar span { flex: 1; }
.snapshot-restore-btn {
  padding: 3px 10px; background: var(--bg-overlay);
  border: 1px solid var(--border-mid); border-radius: 5px;
  color: var(--text-secondary); font-size: 11px; cursor: pointer;
  transition: background 0.15s;
}
.snapshot-restore-btn:hover { background: var(--yellow-dim); color: var(--yellow); border-color: var(--yellow); }

/* Follow-up input bar */
.followup-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-raised);
  border-top: 1px solid var(--border-mid);
  flex-shrink: 0;
}
.followup-input {
  flex: 1;
  background: var(--bg-surface);
  border: 1px solid var(--border-mid);
  border-radius: 10px;
  padding: 9px 12px;
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.4;
  outline: none;
  resize: none;
  min-height: 38px;
  max-height: 120px;
  overflow-y: auto;
  transition: border-color 0.15s;
  /* Critical for mobile keyboards: must be a real input/textarea */
  -webkit-appearance: none;
  appearance: none;
}
.followup-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.followup-input::placeholder { color: var(--text-dim); }
.followup-send {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  background: var(--accent);
  border: none;
  border-radius: 10px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, transform 0.1s;
}
.followup-send:hover:not(:disabled) { opacity: 0.85; }
.followup-send:active:not(:disabled) { transform: scale(0.92); }
.followup-send:disabled { opacity: 0.3; cursor: not-allowed; }
</style>
