<template>
  <div class="editor-wrap" ref="wrapEl">
    <!-- Empty state: no tab open -->
    <div v-if="!tab" class="empty-state">
      <div class="empty-logo">⚡</div>
      <p class="empty-title">Forge IDE</p>
      <p class="empty-sub">Open a file from the sidebar to begin</p>
    </div>

    <!-- Loading state -->
    <div v-else-if="tab.loading" class="empty-state">
      <div class="spinner"></div>
      <p class="empty-sub">Loading {{ tab.name }}…</p>
    </div>

    <!-- Editor: v-if (NOT v-show) so CM mounts into a visible, sized element -->
    <div v-else ref="editorEl" class="cm-host" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, shallowRef, nextTick } from 'vue';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter } from '@codemirror/language';
import { autocompletion, completionKeymap, closeBrackets } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { getLanguageExtension } from '@/composables/useLanguage.js';
import { useEditorStore } from '@/stores/editor.js';

const props = defineProps({
  tab: { type: Object, default: null },
});

const editorStore = useEditorStore();
const wrapEl = ref(null);
const editorEl = ref(null);
const view = shallowRef(null);
const langCompartment = new Compartment();

// ─── Build extensions ─────────────────────────────────────────────────────
function buildExtensions(filename) {
  return [
    oneDark,
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    foldGutter(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    autocompletion(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      indentWithTab,
      // Ctrl/Cmd+S to save
      {
        key: 'Mod-s',
        run: () => {
          if (props.tab) editorStore.saveFile(props.tab.path);
          return true;
        }
      },
    ]),
    langCompartment.of(getLanguageExtension(filename)),
    // Smart indent: on Enter, match previous line indent
    EditorView.updateListener.of((update) => {
      if (update.docChanged && props.tab) {
        const content = update.state.doc.toString();
        editorStore.updateContent(props.tab.path, content);
      }
    }),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.65' },
    }),
  ];
}

// ─── Init / destroy ───────────────────────────────────────────────────────
async function initEditor(content, filename) {
  // Wait for Vue to render the v-else branch so editorEl exists in the DOM
  await nextTick();
  if (!editorEl.value) return;

  if (view.value) {
    view.value.destroy();
    view.value = null;
  }
  const state = EditorState.create({
    doc: content || '',
    extensions: buildExtensions(filename),
  });
  view.value = new EditorView({ state, parent: editorEl.value });
}

// ─── Watch tab changes ────────────────────────────────────────────────────
// Deep watch: fires when tab object itself swaps OR when .loading flips
watch(
  () => props.tab,
  async (newTab, oldTab) => {
    if (!newTab) { view.value?.destroy(); view.value = null; return; }
    if (newTab.loading) return; // wait for loading watcher below

    const pathChanged = !oldTab || newTab.path !== oldTab.path;
    if (pathChanged) {
      await initEditor(newTab.content, newTab.name);
      return;
    }

    // Same file — sync external content changes (e.g. server reload)
    if (view.value) {
      const current = view.value.state.doc.toString();
      if (current !== newTab.content) {
        view.value.dispatch({
          changes: { from: 0, to: current.length, insert: newTab.content || '' }
        });
      }
      view.value.dispatch({
        effects: langCompartment.reconfigure(getLanguageExtension(newTab.name))
      });
    }
  },
  { immediate: false }
);

// Fires when loading flips false → content is now available
watch(
  () => props.tab?.loading,
  async (loading, wasLoading) => {
    if (loading === false && wasLoading === true && props.tab) {
      await initEditor(props.tab.content, props.tab.name);
    }
  }
);

onMounted(async () => {
  if (props.tab && !props.tab.loading) {
    await initEditor(props.tab.content, props.tab.name);
  }
});

onBeforeUnmount(() => {
  view.value?.destroy();
});

// Jump to line when opened from grep results
watch(() => editorStore.activeTabLine, (target) => {
  if (!target || target.path !== props.tab?.path) return;
  if (!view.value) return;
  const line = Math.max(1, target.line);
  const doc = view.value.state.doc;
  if (line > doc.lines) return;
  const pos = doc.line(line).from;
  view.value.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  // Clear so re-clicking same line still works
  editorStore.activeTabLine = null;
});

// Expose focus method for parent
defineExpose({
  focus: () => view.value?.focus(),
  getView: () => view.value,
});
</script>

<style scoped>
.editor-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
}

.cm-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
  animation: fadeIn 0.4s var(--ease-snap);
}

.empty-logo {
  font-size: 48px;
  filter: grayscale(0.3);
  opacity: 0.4;
}

.empty-title {
  font-family: var(--font-mono);
  font-size: 18px;
  color: var(--text-secondary);
  letter-spacing: 0.05em;
}

.empty-sub {
  font-size: 13px;
  color: var(--text-dim);
}

.spinner {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border-mid);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
</style>
