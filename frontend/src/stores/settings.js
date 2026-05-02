import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { useSocketStore } from './socket.js';

const STORAGE_KEY = 'forge-ide-settings';

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

export const useSettingsStore = defineStore('settings', () => {
  const saved = loadSaved();
  const socket = useSocketStore();

  // ─── Settings ─────────────────────────────────────────────────────────────
  const serverLogging   = ref(saved.serverLogging   ?? true);
  const theme           = ref(saved.theme           ?? 'dark');
  const fontSize        = ref(saved.fontSize        ?? 13);
  const tabSize         = ref(saved.tabSize         ?? 2);
  const wordWrap        = ref(saved.wordWrap        ?? false);
  const autoSaveDelay   = ref(saved.autoSaveDelay   ?? 2000);
  const showMinimap     = ref(saved.showMinimap     ?? false);
  const termFontSize    = ref(saved.termFontSize    ?? 13);
  const anthropicKey    = ref(saved.anthropicKey    ?? '');
  const aiModel         = ref(saved.aiModel         ?? 'claude-opus-4-5');

  // Server log buffer (not persisted)
  const serverLogs      = ref([]);   // [{ ts, level, msg }]
  const MAX_LOGS        = 200;

  // ─── Persist on change ────────────────────────────────────────────────────
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      serverLogging: serverLogging.value,
      theme: theme.value,
      fontSize: fontSize.value,
      tabSize: tabSize.value,
      wordWrap: wordWrap.value,
      autoSaveDelay: autoSaveDelay.value,
      showMinimap: showMinimap.value,
      termFontSize: termFontSize.value,
      anthropicKey: anthropicKey.value,
      aiModel: aiModel.value,
    }));
  }

  watch([serverLogging, theme, fontSize, tabSize, wordWrap,
         autoSaveDelay, showMinimap, termFontSize, anthropicKey, aiModel], persist);

  // ─── Sync serverLogging toggle to backend ─────────────────────────────────
  watch(serverLogging, (val) => {
    if (socket.status === 'connected') {
      socket.request('settings:setLog', { enabled: val }).catch(() => {});
    }
  });

  // ─── Sync aiModel to backend on change ────────────────────────────────────
  watch(aiModel, (val) => {
    if (socket.status === 'connected') {
      socket.request('settings:setModel', { model: val }).catch(() => {});
    }
  });

  // Send current prefs once connected
  watch(() => socket.status, (s) => {
    if (s === 'connected') {
      socket.request('settings:setLog', { enabled: serverLogging.value }).catch(() => {});
      socket.request('settings:setModel', { model: aiModel.value }).catch(() => {});
    }
  });

  // ─── Receive server logs ──────────────────────────────────────────────────
  function addLog(entry) {
    serverLogs.value.unshift(entry);   // newest first
    if (serverLogs.value.length > MAX_LOGS) serverLogs.value.length = MAX_LOGS;
  }

  function clearLogs() { serverLogs.value = []; }

  return {
    serverLogging, theme, fontSize, tabSize, wordWrap,
    autoSaveDelay, showMinimap, termFontSize, anthropicKey, aiModel,
    serverLogs, addLog, clearLogs,
  };
});
