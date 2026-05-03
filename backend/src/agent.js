import { rawRead } from './fs-utils.js';
import { fetchContext7Snippet } from './context7.js';

const MAX_ITERATIONS = 20;

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
  const { getAllMcpTools } = await import('./mcp-client.js');
  const allTools = getAllMcpTools();

  // Convert MCP tools to Anthropic native tool format
  const nativeTools = allTools.map(t => ({
    name: `${t.serverId}__${t.name}`,
    description: `[${t.serverId}] ${t.description || t.name}`,
    input_schema: t.inputSchema || { type: 'object', properties: {}, required: [] },
  }));

  // Add a "done" tool to signal completion
  nativeTools.push({
    name: 'done',
    description: 'Signal that the task is complete.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'What was accomplished' },
      },
      required: ['summary'],
    },
  });

  const systemPrompt = `You are Forge, an expert AI coding agent running inside a mobile IDE.

Rules:
- Always read a file before modifying it
- Check shell output before continuing
- Self-correct on errors
- End every task by calling the done tool${context7Snippet}`;

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

    let responseContent;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          cache_control: { type: "ephemeral" },
          system: systemPrompt,
          tools: nativeTools,
          messages,
        }),
      });
      if (!response.ok) throw new Error(`API error ${response.status}`);
      const data = await response.json();
      responseContent = data.content;
    } catch (err) {
      emit({ type: 'agent:error', error: err.message });
      return;
    }

    // Emit any text blocks (reasoning/commentary from the model)
    for (const block of responseContent) {
      if (block.type === 'text' && block.text) {
        emit({ type: 'agent:delta', delta: block.text });
      }
    }

    // Append assistant turn to history
    messages.push({ role: 'assistant', content: responseContent });

    // Find tool_use blocks
    const toolUseBlocks = responseContent.filter(b => b.type === 'tool_use');

    if (toolUseBlocks.length === 0) {
      // No tool call — model gave a final text response
      const summary = responseContent.filter(b => b.type === 'text').map(b => b.text).join('\n');
      emit({ type: 'agent:done', summary, iterations });
      return;
    }

    // Execute each tool and collect results
    const toolResults = [];

    for (const toolUse of toolUseBlocks) {
      const { id, name, input } = toolUse;
      emit({ type: 'agent:action', tool: name, input });

      let toolResult = '';

      try {
        if (name === 'done') {
          done = true;
          toolResult = 'Task complete.';
          emit({ type: 'agent:done', summary: input.summary, iterations });

        } else {
          // Parse serverId and tool name back out from "serverId__toolName"
          const separatorIndex = name.indexOf('__');
          const serverId = name.slice(0, separatorIndex);
          const toolName = name.slice(separatorIndex + 2);

          const result = await callMcpTool(serverId, toolName, input || {});
          toolResult = result?.content?.map(c => c.text || '').join('\n') || JSON.stringify(result);

          // Truncate with a marker so the model knows the file was cut
          const LIMIT = 15000;
          if (toolResult.length > LIMIT) {
            const lines = toolResult.split('\n').length;
            toolResult = `${toolResult.slice(0, LIMIT)}\n\n[... truncated — ${toolResult.length} chars, ${lines} lines]`;
          }

          console.log(toolResult);

          // Typed thought-stream events for the UI
          if (toolName === 'shell_exec') {
            emit({ type: 'agent:shell', command: input?.command, output: toolResult });
          } else if (['write_file', 'create_file'].includes(toolName)) {
            emit({ type: 'agent:write', path: input?.path, content: input?.content });
          } else if (toolName === 'read_file') {
            emit({ type: 'agent:read', path: input?.path });
          } else {
            emit({ type: 'agent:mcp', serverId, tool: toolName, output: toolResult });
          }
        }
      } catch (err) {
        toolResult = `Error: ${err.message}`;
        emit({ type: 'agent:tool_error', tool: name, error: err.message });
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: id,
        content: toolResult,
      });
    }

    if (!done) {
      messages.push({ role: 'user', content: toolResults });
    }
  }

  if (!done) {
    emit({ type: 'agent:done', summary: 'Max iterations reached.', iterations });
  }
}
