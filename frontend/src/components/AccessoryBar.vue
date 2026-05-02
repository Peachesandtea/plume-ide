<template>
  <div class="accessory-bar" :class="{ visible: keyboardVisible }">
    <div class="accessory-scroll">
      <button
        v-for="key in KEYS"
        :key="key.label"
        class="acc-key"
        :class="{ wide: key.wide }"
        @touchstart.prevent="onKey(key)"
        @mousedown.prevent="onKey(key)"
      >
        <span class="acc-key-label">{{ key.label }}</span>
      </button>

      <div class="acc-divider" />

      <!-- Undo / Redo -->
      <button class="acc-key icon-key" @touchstart.prevent="onAction('undo')" @mousedown.prevent="onAction('undo')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 10H13C17.4183 10 21 13.5817 21 18V20M3 10L7 6M3 10L7 14"/>
        </svg>
      </button>
      <button class="acc-key icon-key" @touchstart.prevent="onAction('redo')" @mousedown.prevent="onAction('redo')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10H11C6.58172 10 3 13.5817 3 18V20M21 10L17 6M21 10L17 14"/>
        </svg>
      </button>

      <!-- Cursor movement -->
      <button class="acc-key icon-key" @touchstart.prevent="onAction('cursorLeft')" @mousedown.prevent="onAction('cursorLeft')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M15 18L9 12L15 6"/>
        </svg>
      </button>
      <button class="acc-key icon-key" @touchstart.prevent="onAction('cursorRight')" @mousedown.prevent="onAction('cursorRight')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M9 18L15 12L9 6"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({
  editorRef: { type: Object, default: null },
});

const keyboardVisible = ref(false);

const KEYS = [
  { label: 'Tab', insert: '\t', wide: true },
  { label: '{',  insert: '{' },
  { label: '}',  insert: '}' },
  { label: '[',  insert: '[' },
  { label: ']',  insert: ']' },
  { label: '(',  insert: '(' },
  { label: ')',  insert: ')' },
  { label: '<',  insert: '<' },
  { label: '>',  insert: '>' },
  { label: '/',  insert: '/' },
  { label: '\\', insert: '\\' },
  { label: "'",  insert: "'" },
  { label: '"',  insert: '"' },
  { label: ';',  insert: ';' },
  { label: ':',  insert: ':' },
  { label: '=',  insert: '=' },
  { label: '!',  insert: '!' },
  { label: '&',  insert: '&' },
  { label: '|',  insert: '|' },
  { label: '_',  insert: '_' },
  { label: '-',  insert: '-' },
  { label: '+',  insert: '+' },
  { label: '*',  insert: '*' },
  { label: '@',  insert: '@' },
  { label: '#',  insert: '#' },
  { label: '$',  insert: '$' },
  { label: '%',  insert: '%' },
  { label: '^',  insert: '^' },
  { label: '~',  insert: '~' },
  { label: '`',  insert: '`' },
  { label: '.',  insert: '.' },
  { label: ',',  insert: ',' },
];

function getView() {
  return props.editorRef?.getView?.();
}

function onKey(key) {
  const view = getView();
  if (!view) return;
  view.dispatch(view.state.replaceSelection(key.insert));
  view.focus();
}

function onAction(action) {
  const view = getView();
  if (!view) return;

  const { undo, redo, cursorCharLeft, cursorCharRight } = window.__cmCommands || {};

  switch (action) {
    case 'undo':
      import('@codemirror/commands').then(({ undo }) => undo(view));
      break;
    case 'redo':
      import('@codemirror/commands').then(({ redo }) => redo(view));
      break;
    case 'cursorLeft':
      import('@codemirror/commands').then(({ cursorCharLeft }) => cursorCharLeft(view));
      break;
    case 'cursorRight':
      import('@codemirror/commands').then(({ cursorCharRight }) => cursorCharRight(view));
      break;
  }
  view.focus();
}

// Detect virtual keyboard on mobile
function onResize() {
  if (window.visualViewport) {
    const ratio = window.visualViewport.height / window.innerHeight;
    keyboardVisible.value = ratio < 0.75;
  }
}

onMounted(() => {
  window.visualViewport?.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', onResize);
});
</script>

<style scoped>
.accessory-bar {
  height: 0;
  overflow: hidden;
  background: var(--bg-raised);
  border-top: 1px solid var(--border-subtle);
  transition: height 0.2s var(--ease-snap);
  flex-shrink: 0;
}

/* Always visible for dev — on real mobile, toggle via .visible */
.accessory-bar,
.accessory-bar.visible {
  height: var(--accessory-h);
}

@media (hover: hover) and (pointer: fine) {
  /* Desktop: hide by default, show on focus */
  .accessory-bar {
    height: var(--accessory-h);
    opacity: 0.7;
  }
}

.accessory-scroll {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  overflow-x: auto;
  height: 100%;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.accessory-scroll::-webkit-scrollbar { display: none; }

.acc-key {
  flex-shrink: 0;
  height: 32px;
  min-width: 32px;
  padding: 0 8px;
  background: var(--bg-overlay);
  border: 1px solid var(--border-mid);
  border-bottom: 2px solid var(--border-bright);
  border-radius: 6px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s, transform 0.05s;
  user-select: none;
  -webkit-user-select: none;
}

.acc-key:active,
.acc-key.pressed {
  background: var(--accent-dim);
  border-color: var(--accent);
  transform: scale(0.92);
}

.acc-key.wide { min-width: 48px; }
.acc-key.icon-key { color: var(--text-secondary); }
.acc-key-label { line-height: 1; }

.acc-divider {
  width: 1px;
  height: 20px;
  background: var(--border-mid);
  margin: 0 4px;
  flex-shrink: 0;
}
</style>
