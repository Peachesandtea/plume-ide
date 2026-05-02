<template>
  <Teleport to="body">
    <div v-if="modelValue" class="palette-backdrop" @click="close" />
    <div class="palette-wrap" :class="{ open: modelValue }">
      <div class="palette-box">
        <!-- Input -->
        <div class="palette-input-row">
          <span class="palette-at">⚡</span>
          <input
            ref="inputEl"
            class="palette-input"
            v-model="query"
            placeholder="Type a skill: fix, explain, refactor, docs, tests, optimize…"
            @keydown="onKeydown"
            @input="onInput"
          />
          <kbd class="palette-esc" @click="close">esc</kbd>
        </div>

        <!-- Context info -->
        <div class="palette-context" v-if="activeFile">
          <span class="palette-file">📄 {{ activeFileName }}</span>
          <span v-if="hasSelection" class="palette-sel">✂ selection</span>
          <span v-if="!socketStore.hasAI" class="palette-no-ai">⚠ Set ANTHROPIC_API_KEY on server</span>
        </div>

        <!-- Skill list -->
        <div class="palette-skills">
          <button
            v-for="(skill, i) in filteredSkills"
            :key="skill.id"
            class="palette-skill"
            :class="{ selected: i === selectedIdx }"
            @click="runSkill(skill.id)"
            @mouseenter="selectedIdx = i"
          >
            <span class="skill-icon">{{ skill.icon }}</span>
            <div class="skill-info">
              <span class="skill-name">@{{ skill.id }}</span>
              <span class="skill-desc">{{ skill.desc }}</span>
            </div>
            <kbd class="skill-shortcut" v-if="i === 0">↵</kbd>
          </button>
          <div v-if="filteredSkills.length === 0" class="palette-empty">No matching skills</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useSocketStore } from '@/stores/socket.js';
import { useEditorStore } from '@/stores/editor.js';
import { useAIStore } from '@/stores/ai.js';

const props = defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);

const socketStore = useSocketStore();
const editorStore = useEditorStore();
const aiStore = useAIStore();

const query = ref('');
const selectedIdx = ref(0);
const inputEl = ref(null);

const SKILLS = [
  { id: 'fix',      icon: '🔧', desc: 'Find and fix bugs in the current file' },
  { id: 'explain',  icon: '💬', desc: 'Explain what this code does' },
  { id: 'refactor', icon: '♻️',  desc: 'Refactor for readability and maintainability' },
  { id: 'docs',     icon: '📖', desc: 'Add documentation and comments' },
  { id: 'tests',    icon: '🧪', desc: 'Generate unit tests' },
  { id: 'optimize', icon: '⚡', desc: 'Optimize for performance' },
];

const activeFile = computed(() => editorStore.activeTab?.path || null);
const activeFileName = computed(() => activeFile.value?.split('/').pop() || '');
const hasSelection = ref(false);

const filteredSkills = computed(() => {
  const q = query.value.replace(/^@/, '').toLowerCase().trim();
  if (!q) return SKILLS;
  return SKILLS.filter(s => s.id.includes(q) || s.desc.toLowerCase().includes(q));
});

watch(() => props.modelValue, async (v) => {
  if (v) {
    query.value = '';
    selectedIdx.value = 0;
    await nextTick();
    inputEl.value?.focus();
  }
});

function onInput() {
  selectedIdx.value = 0;
}

function onKeydown(e) {
  if (e.key === 'Escape') { close(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx.value = Math.min(selectedIdx.value + 1, filteredSkills.value.length - 1); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx.value = Math.max(selectedIdx.value - 1, 0); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    const skill = filteredSkills.value[selectedIdx.value];
    if (skill) runSkill(skill.id);
  }
}

function runSkill(skillId) {
  if (!activeFile.value) return;
  aiStore.runSkill(skillId, activeFile.value);
  close();
}

function close() {
  emit('update:modelValue', false);
}
</script>

<style>
.palette-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 10000;
  backdrop-filter: blur(2px);
}
.palette-wrap {
  position: fixed;
  top: 20%;
  left: 50%;
  transform: translateX(-50%) translateY(-10px);
  width: 92%;
  max-width: 520px;
  z-index: 10001;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s, transform 0.15s;
}
.palette-wrap.open {
  opacity: 1;
  pointer-events: all;
  transform: translateX(-50%) translateY(0);
}

.palette-box {
  background: var(--bg-raised);
  border: 1px solid var(--border-mid);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px var(--border-subtle);
}

.palette-input-row {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--border-subtle);
}
.palette-at { font-size: 18px; flex-shrink: 0; }
.palette-input {
  flex: 1; background: none; border: none; outline: none;
  color: var(--text-bright); font-size: 15px;
  font-family: var(--font-ui);
}
.palette-input::placeholder { color: var(--text-dim); }
.palette-esc {
  background: var(--bg-overlay); border: 1px solid var(--border-mid);
  border-radius: 5px; padding: 2px 6px; font-size: 11px;
  color: var(--text-dim); cursor: pointer; flex-shrink: 0;
}

.palette-context {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 11px;
}
.palette-file { color: var(--text-muted); font-family: var(--font-mono); }
.palette-sel { color: var(--accent); background: var(--accent-dim); padding: 1px 6px; border-radius: 8px; }
.palette-no-ai { color: var(--yellow); margin-left: auto; }

.palette-skills { padding: 6px; max-height: 300px; overflow-y: auto; }
.palette-skill {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 10px 10px;
  background: none; border: none; border-radius: 8px;
  cursor: pointer; text-align: left;
  transition: background 0.1s;
}
.palette-skill.selected { background: var(--bg-hover); }
.palette-skill:hover { background: var(--bg-hover); }
.skill-icon { font-size: 18px; flex-shrink: 0; width: 24px; text-align: center; }
.skill-info { flex: 1; display: flex; flex-direction: column; gap: 1px; }
.skill-name { font-size: 13px; font-weight: 600; color: var(--text-bright); font-family: var(--font-mono); }
.skill-desc { font-size: 11px; color: var(--text-muted); }
.skill-shortcut {
  background: var(--bg-overlay); border: 1px solid var(--border-mid);
  border-radius: 4px; padding: 1px 5px; font-size: 11px;
  color: var(--text-dim); flex-shrink: 0;
}
.palette-empty { padding: 16px; text-align: center; color: var(--text-dim); font-size: 13px; }
</style>
