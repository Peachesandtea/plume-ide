import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useSocketStore } from './socket.js';

export const useGitStore = defineStore('git', () => {
  const socket = useSocketStore();

  const branch = ref('');
  const ahead = ref(0);
  const behind = ref(0);
  const files = ref([]);         // [{ xy, path, staged, unstaged }]
  const loading = ref(false);
  const isRepo = ref(false);
  const lastRefresh = ref(0);

  // Map of path -> xy status for tree coloring
  const statusMap = computed(() => {
    const map = new Map();
    for (const f of files.value) map.set(f.path, f);
    return map;
  });

  const stagedFiles = computed(() => files.value.filter(f => f.staged));
  const unstagedFiles = computed(() => files.value.filter(f => f.unstaged || !f.staged));
  const changedCount = computed(() => files.value.length);

  async function refresh() {
    if (socket.status !== 'connected') return;
    loading.value = true;
    try {
      const result = await socket.git.status();
      isRepo.value = !result.error;
      branch.value = result.branch || '';
      ahead.value = result.ahead || 0;
      behind.value = result.behind || 0;
      files.value = result.files || [];
      lastRefresh.value = Date.now();
    } catch {
      isRepo.value = false;
    } finally {
      loading.value = false;
    }
  }

  // Refresh after file system changes
  function onFsChange() {
    // Debounce — don't spam on rapid saves
    clearTimeout(onFsChange._t);
    onFsChange._t = setTimeout(refresh, 800);
  }

  return {
    branch, ahead, behind, files, loading, isRepo, lastRefresh,
    statusMap, stagedFiles, unstagedFiles, changedCount,
    refresh, onFsChange,
  };
});
