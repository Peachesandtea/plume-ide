<template>
  <div v-if="parts.length" class="breadcrumbs">
    <template v-for="(part, i) in parts" :key="i">
      <span class="crumb" :class="{ last: i === parts.length - 1 }">{{ part }}</span>
      <span v-if="i < parts.length - 1" class="sep">/</span>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '@/stores/editor.js';

const editorStore = useEditorStore();
const parts = computed(() => {
  const path = editorStore.activeTab?.path;
  if (!path) return [];
  return path.split('/').filter(Boolean);
});
</script>

<style scoped>
.breadcrumbs {
  display: flex;
  align-items: center;
  padding: 0 12px;
  height: 28px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}
.breadcrumbs::-webkit-scrollbar { display: none; }

.crumb {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  font-family: var(--font-mono);
}
.crumb.last { color: var(--text-primary); font-weight: 500; }
.sep { color: var(--text-dim); margin: 0 4px; font-size: 11px; }
</style>
