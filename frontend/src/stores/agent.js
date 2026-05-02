import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useSocketStore } from './socket.js';

export const useAgentStore = defineStore('agent', () => {
  const socket = useSocketStore();

  // ─── Agent state ──────────────────────────────────────────────────────────
  const running = ref(false);
  const currentTask = ref('');
  const currentTaskId = ref(null);
  const thoughts = ref([]);       // thought stream entries
  const error = ref('');
  const done = ref(false);
  const summary = ref('');
  const iterations = ref(0);

  // ─── Context pins ─────────────────────────────────────────────────────────
  const pinnedFiles = ref([]);    // [path, ...]

  // ─── Skills registry ──────────────────────────────────────────────────────
  const skills = ref([]);         // loaded from server

  const isRunning = computed(() => running.value);
  const thoughtCount = computed(() => thoughts.value.length);

  // ─── Run agent ────────────────────────────────────────────────────────────
  async function runTask(task, filePaths = []) {
    if (running.value) return;
    const taskId = `task_${Date.now()}`;
    currentTaskId.value = taskId;
    currentTask.value = task;
    running.value = true;
    done.value = false;
    error.value = '';
    summary.value = '';
    iterations.value = 0;
    thoughts.value = [];

    try {
      await socket.agent.run(taskId, task, filePaths);
    } catch (err) {
      error.value = err.message;
      running.value = false;
    }
  }

  function cancelTask() {
    if (!currentTaskId.value) return;
    socket.agent.cancel(currentTaskId.value);
    running.value = false;
    addThought({ type: 'agent:cancelled' });
  }

  // ─── Handle push events ───────────────────────────────────────────────────
  function handleAgentEvent(taskId, event) {
    if (taskId !== currentTaskId.value) return;

    // Always add to thought stream
    addThought(event);

    switch (event.type) {
      case 'agent:start':
        running.value = true;
        break;
      case 'agent:done':
        running.value = false;
        done.value = true;
        summary.value = event.summary || '';
        iterations.value = event.iterations || 0;
        break;
      case 'agent:error':
        running.value = false;
        error.value = event.error;
        break;
    }
  }

  function addThought(event) {
    thoughts.value.push({ ...event, ts: Date.now() });
    // Cap at 500 entries
    if (thoughts.value.length > 500) thoughts.value.shift();
  }

  // ─── Pins ─────────────────────────────────────────────────────────────────
  async function loadPins() {
    try {
      const { paths } = await socket.pins.get();
      pinnedFiles.value = paths || [];
    } catch {}
  }

  async function togglePin(path) {
    const idx = pinnedFiles.value.indexOf(path);
    if (idx >= 0) pinnedFiles.value.splice(idx, 1);
    else pinnedFiles.value.push(path);
    await socket.pins.set(pinnedFiles.value);
  }

  function isPinned(path) {
    return pinnedFiles.value.includes(path);
  }

  // ─── Skills ───────────────────────────────────────────────────────────────
  async function loadSkills() {
    try {
      const res = await socket.skills.list();
      skills.value = res?.skills || [];
    } catch {}
  }

  async function saveSkill(skill) {
    await socket.skills.create(skill.name, skill.kind, skill.description, skill.language);
    await loadSkills();
  }

  async function deleteSkill(name) {
    await socket.skills.delete(name);
    skills.value = skills.value.filter(s => s.name !== name);
  }

  return {
    running, currentTask, currentTaskId, thoughts, error, done, summary, iterations,
    pinnedFiles, skills,
    isRunning, thoughtCount,
    runTask, cancelTask, handleAgentEvent,
    loadPins, togglePin, isPinned,
    loadSkills, saveSkill, deleteSkill,
  };
});
