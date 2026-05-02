import { rawRead } from './fs-utils.js';
import { fetchContext7Snippet } from './context7.js';

const MAX_ITERATIONS = 12;

export async function runAgent({ task, filePaths = [], pinnedContext = [], projectRoot, apiKey, model, mcpTools = [], callMcpTool }, emit) {
  if (!apiKey)      { emit({ type: 'agent:error', error: 'ANTHROPIC_API_KEY not set' }); return; }
  if (!callMcpTool) { emit({ type: 'agent:error', error: 'callMcpTool not available' }); return; }

  emit({ type: 'agent:start', task });

  // Pre-loop: load pinned/provided files for initial context (setup, not a tool call)
  const fileContexts = [];
  for (const fp of [...new Set([...pinnedContext, ...filePaths])]) {
    try { fileContexts.push({ path: fp, content: await rawRead(fp) }); } catch {}
  }

  // Fetch Context7 docs for imported symbols — parallel, zero LLM calls
  const context7Snippet = await fetchContext7Snippet(
    fileContexts.map(fc => fc.content).join('\n'),
    fileContexts[0]?.path || '',
    callMcpTool
  );

  // Build tool list dynamically from all connected MCP servers
  // forge-ide (in-process stdio) + any external servers the user has connected
  const { getAllMcpTools } = await import('./mcp-client.js');
  const allTools = getAllMcpTools();

  // Group by serverId for the system prompt
  const byServer = new Map();
  for (const t of allTools) {
    if (!byServer.has(t.serverId)) byServer.set(t.serverId, []);
    byServer.get(t.serverId).push(t);
  }

  const toolSection = [...byServer.entries()].map(([serverId, tools]) =>
    `**${serverId}**:\n${tools.map(t => `  - ${t.name}: ${t.description || ''}`).join('\n')}`
  ).join('\n\n');

  const systemPrompt = `You are Forge, an expert AI coding agent running inside a mobile IDE.

Call tools by responding with ONLY a JSON block:
\`\`\`tool
{ "tool": "mcp", "serverId": "forge-ide", "name": "read_file", "args": { "path": "src/index.js" } }
\`\`\`

Available MCP servers and tools:

${toolSection || '(no tools connected)'}

Signal completion with:
\`\`\`tool
{ "tool": "done", "summary": "What was accomplished" }
\`\`\`

Rules:
- Always read a file before modifying it
- Check shell output before continuing
- Self-correct on errors
- End every task with done${context7Snippet}`;

  const messages = [];
  let userContent = `Task: ${task}`;
  if (fileContexts.length > 0) {
    userContent += '\n\nContext files:\n';
    for (const fc of fileContexts) {
      userContent += `\n### ${fc.path}\n\`\`\`\n${fc.content.slice(0, 3000)}\n\`\`\`\n`;
    }
  }
  messages.push({ role: 'user', content: userContent });

  let iterations = 0;
  let done = false;

  while (!done && iterations < MAX_ITERATIONS) {
    iterations++;
    emit({ type: 'agent:thinking', iteration: iterations });

    let fullResponse = '';
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 2048, system: systemPrompt, messages, stream: true }),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              fullResponse += evt.delta.text;
              emit({ type: 'agent:delta', delta: evt.delta.text });
            }
          } catch {}
        }
      }
    } catch (err) {
      emit({ type: 'agent:error', error: err.message });
      return;
    }

    messages.push({ role: 'assistant', content: fullResponse });

    const toolMatch = fullResponse.match(/```tool\n([\s\S]*?)```/);
    if (!toolMatch) {
      emit({ type: 'agent:done', summary: fullResponse, iterations });
      return;
    }

    let toolCall;
    try {
      toolCall = JSON.parse(toolMatch[1].trim());
    } catch {
      emit({ type: 'agent:error', error: 'Invalid tool JSON from model' });
      return;
    }

    emit({ type: 'agent:action', tool: toolCall.tool, name: toolCall.name, input: toolCall });

    let toolResult = '';
    try {
      switch (toolCall.tool) {

        case 'mcp': {
          const result = await callMcpTool(toolCall.serverId, toolCall.name, toolCall.args || {});
          toolResult = result?.content?.map(c => c.text || '').join('\n') || JSON.stringify(result);

          // Truncate with a marker so the model knows the file was cut
          const LIMIT = 4000;
          if (toolResult.length > LIMIT) {
            const lines = toolResult.split('\n').length;
            toolResult = `${toolResult.slice(0, LIMIT)}\n\n[... truncated — ${toolResult.length} chars, ${lines} lines]`;
          }

          // Typed thought-stream events for the UI
          if (toolCall.name === 'shell_exec') {
            emit({ type: 'agent:shell', command: toolCall.args?.command, output: toolResult });
          } else if (['write_file', 'create_file'].includes(toolCall.name)) {
            emit({ type: 'agent:write', path: toolCall.args?.path, content: toolCall.args?.content });
          } else if (toolCall.name === 'read_file') {
            emit({ type: 'agent:read', path: toolCall.args?.path });
          } else {
            emit({ type: 'agent:mcp', serverId: toolCall.serverId, tool: toolCall.name, output: toolResult });
          }
          break;
        }

        case 'done': {
          done = true;
          toolResult = 'Task complete.';
          emit({ type: 'agent:done', summary: toolCall.summary || fullResponse, iterations });
          break;
        }

        default:
          toolResult = `Unknown tool type: "${toolCall.tool}". Use "mcp" or "done".`;
      }
    } catch (err) {
      toolResult = `Error: ${err.message}`;
      emit({ type: 'agent:tool_error', tool: toolCall.tool, name: toolCall.name, error: err.message });
    }

    if (!done) {
      messages.push({ role: 'user', content: `Tool result:\n${toolResult}` });
    }
  }

  if (!done) {
    emit({ type: 'agent:done', summary: 'Max iterations reached.', iterations });
  }
}
