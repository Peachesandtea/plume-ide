import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useSocketStore } from './socket.js';

export const useEditorStore = defineStore('editor', () => {
  const socket = useSocketStore();

  // ─── Tab State ────────────────────────────────────────────────────────────
  const tabs = ref([]); // [{ path, name, content, dirty, loading }]
  const activeTabPath = ref(null);

  const activeTab = computed(() => tabs.value.find(t => t.path === activeTabPath.value) || null);

  // ─── Debounced save ───────────────────────────────────────────────────────
  const saveTimers = new Map();

  function scheduleAutoSave(path) {
    if (saveTimers.has(path)) clearTimeout(saveTimers.get(path));
    saveTimers.set(path, setTimeout(() => saveFile(path), 2000));
  }

  // ─── Tab Management ───────────────────────────────────────────────────────
  async function openFile(path) {
    // Activate if already open
    const existing = tabs.value.find(t => t.path === path);
    if (existing) {
      activeTabPath.value = path;
      return;
    }

    // Add loading tab — push a reactive-safe object
    const name = path.split('/').pop();
    tabs.value.push({ path, name, content: '', dirty: false, loading: true });
    activeTabPath.value = path;

    // Always mutate through the array so Vue's proxy intercepts it
    const setTab = (fields) => {
      const idx = tabs.value.findIndex(t => t.path === path);
      if (idx !== -1) Object.assign(tabs.value[idx], fields);
    };

    try {
      const { content } = await socket.fs.read(path);
      setTab({ content, loading: false });
    } catch (err) {
      setTab({ content: `// Error loading file:\n// ${err.message}`, loading: false });
    }
  }

  function closeTab(path) {
    const idx = tabs.value.findIndex(t => t.path === path);
    if (idx === -1) return;

    // Cancel pending save
    if (saveTimers.has(path)) {
      clearTimeout(saveTimers.get(path));
      saveTimers.delete(path);
    }

    tabs.value.splice(idx, 1);

    // Activate adjacent tab
    if (activeTabPath.value === path) {
      if (tabs.value.length > 0) {
        activeTabPath.value = tabs.value[Math.max(0, idx - 1)].path;
      } else {
        activeTabPath.value = null;
      }
    }
  }

  function updateContent(path, content) {
    const idx = tabs.value.findIndex(t => t.path === path);
    if (idx === -1) return;
    tabs.value[idx].content = content;
    tabs.value[idx].dirty = true;
    scheduleAutoSave(path);
  }

  async function saveFile(path) {
    const idx = tabs.value.findIndex(t => t.path === path);
    if (idx === -1 || !tabs.value[idx].dirty) return;
    try {
      await socket.fs.write(path, tabs.value[idx].content);
      tabs.value[idx].dirty = false;
    } catch (err) {
      console.error('Save failed:', err);
    }
  }

  async function saveActive() {
    if (activeTabPath.value) await saveFile(activeTabPath.value);
  }

  function getTabByPath(path) {
    return tabs.value.find(t => t.path === path);
  }

  // Open a file and jump to a specific line number
  // The actual scroll is done by CodeEditor watching activeTabLine
  const activeTabLine = ref(null);

  async function openFileAtLine(path, line) {
    await openFile(path);
    activeTabLine.value = { path, line };
  }

  return {
    tabs,
    activeTabPath,
    activeTab,
    activeTabLine,
    openFile,
    openFileAtLine,
    closeTab,
    updateContent,
    saveFile,
    saveActive,
    getTabByPath,
  };
});
