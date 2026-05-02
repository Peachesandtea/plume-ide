import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useSocketStore } from './socket.js';
import { useEditorStore } from './editor.js';

export const useAIStore = defineStore('ai', () => {
  const socket = useSocketStore();
  const editor = useEditorStore();

  // ─── State ────────────────────────────────────────────────────────────────
  const running = ref(false);
  const currentSkill = ref('');
  const streamedText = ref('');
  const proposedCode = ref(null);
  const activeFile = ref(null);
  const activeReqId = ref(null);
  const error = ref('');
  const diffHunks = ref([]);

  // Conversation history for follow-ups: [{ role, content }]
  const messages = ref([]);
  // Whether the current response is conversational (no code block expected)
  const isConversational = computed(() =>
    ['explain'].includes(currentSkill.value)
  );

  // ─── Run a skill (initial) ────────────────────────────────────────────────
  function runSkill(skill, filePath, selection = null) {
    if (running.value) return;
    running.value = true;
    currentSkill.value = skill;
    streamedText.value = '';
    proposedCode.value = null;
    activeFile.value = filePath;
    error.value = '';
    diffHunks.value = [];
    messages.value = [];   // fresh conversation

    try {
      activeReqId.value = socket.ai.run(skill, filePath, selection, []);
    } catch (err) {
      error.value = err.message;
      running.value = false;
    }
  }

  // ─── Send a follow-up message in the same conversation ───────────────────
  function sendFollowUp(userText) {
    if (running.value || !userText.trim()) return;

    // Append the last assistant reply to history, then the new user message
    if (streamedText.value) {
      messages.value.push({ role: 'assistant', content: streamedText.value });
    }
    messages.value.push({ role: 'user', content: userText });

    running.value = true;
    streamedText.value = '';
    error.value = '';

    try {
      // Send 'explain' again but with accumulated context so it continues the chat
      activeReqId.value = socket.ai.run(
        currentSkill.value,
        activeFile.value,
        null,
        messages.value.slice(0, -1)  // history up to but not including the new user msg
      );
    } catch (err) {
      error.value = err.message;
      running.value = false;
    }
  }

  // ─── Handle push events from backend ─────────────────────────────────────
  function handlePush(msg) {
    if (msg.reqId && msg.reqId !== activeReqId.value) return;

    if (msg.type === 'ai:start') {
      running.value = true;
      streamedText.value = '';
    }

    if (msg.type === 'ai:delta') {
      streamedText.value += msg.delta;
    }

    if (msg.type === 'ai:done') {
      running.value = false;
      streamedText.value = msg.text || '';
      if (msg.code) {
        proposedCode.value = msg.code;
        buildDiff(msg.filePath, msg.code);
      }
    }

    if (msg.type === 'ai:error') {
      running.value = false;
      error.value = msg.error;
    }
  }

  // ─── Diff computation ─────────────────────────────────────────────────────
  function buildDiff(filePath, newCode) {
    const tab = editor.tabs.find(t => t.path === filePath);
    if (!tab) return;
    diffHunks.value = computeDiff(tab.content, newCode);
  }

  function computeDiff(original, modified) {
    const oldLines = original.split('\n');
    const newLines = modified.split('\n');
    const hunks = [];
    let i = 0, j = 0;
    let currentHunk = null;

    while (i < oldLines.length || j < newLines.length) {
      const oldLine = oldLines[i];
      const newLine = newLines[j];

      if (i >= oldLines.length) {
        if (!currentHunk) currentHunk = { oldStart: i, newStart: j, lines: [], id: hunks.length };
        currentHunk.lines.push({ type: 'add', content: newLine, newLine: j + 1 });
        j++;
      } else if (j >= newLines.length) {
        if (!currentHunk) currentHunk = { oldStart: i, newStart: j, lines: [], id: hunks.length };
        currentHunk.lines.push({ type: 'remove', content: oldLine, oldLine: i + 1 });
        i++;
      } else if (oldLine === newLine) {
        if (currentHunk) { hunks.push(currentHunk); currentHunk = null; }
        i++; j++;
      } else {
        if (!currentHunk) currentHunk = { oldStart: i + 1, newStart: j + 1, lines: [], id: hunks.length };
        currentHunk.lines.push({ type: 'remove', content: oldLine, oldLine: i + 1 });
        currentHunk.lines.push({ type: 'add', content: newLine, newLine: j + 1 });
        i++; j++;
      }
    }
    if (currentHunk) hunks.push(currentHunk);
    return hunks;
  }

  // ─── Accept / Reject ──────────────────────────────────────────────────────
  function acceptAll() {
    if (!proposedCode.value || !activeFile.value) return;
    editor.updateContent(activeFile.value, proposedCode.value);
    proposedCode.value = null;
    diffHunks.value = [];
  }

  function rejectAll() {
    proposedCode.value = null;
    diffHunks.value = [];
    streamedText.value = '';
  }

  function acceptHunk(hunkId) {
    const tab = editor.tabs.find(t => t.path === activeFile.value);
    if (!tab) return;
    const hunk = diffHunks.value.find(h => h.id === hunkId);
    if (!hunk) return;

    const lines = tab.content.split('\n');
    const removals = hunk.lines.filter(l => l.type === 'remove').map(l => l.oldLine - 1);
    const additions = hunk.lines.filter(l => l.type === 'add').map(l => l.content);
    const sorted = [...removals].sort((a, b) => b - a);
    for (const idx of sorted) lines.splice(idx, 1);
    const insertAt = Math.min(hunk.oldStart - 1, lines.length);
    lines.splice(insertAt, 0, ...additions);

    editor.updateContent(activeFile.value, lines.join('\n'));
    diffHunks.value = diffHunks.value.filter(h => h.id !== hunkId);
    if (diffHunks.value.length === 0) proposedCode.value = null;
  }

  function rejectHunk(hunkId) {
    diffHunks.value = diffHunks.value.filter(h => h.id !== hunkId);
    if (diffHunks.value.length === 0) proposedCode.value = null;
  }

  const hasDiff = computed(() => diffHunks.value.length > 0);

  return {
    running, currentSkill, streamedText, proposedCode,
    activeFile, error, diffHunks, hasDiff,
    messages, isConversational,
    runSkill, sendFollowUp, handlePush,
    acceptAll, rejectAll, acceptHunk, rejectHunk,
  };
});
