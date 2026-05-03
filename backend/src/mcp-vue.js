import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { parse as parseTS } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default ?? _traverse;

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolvePath(projectRoot, filePath) {
  return path.resolve(projectRoot, filePath);
}

function readSFC(projectRoot, filePath) {
  const source = fs.readFileSync(resolvePath(projectRoot, filePath), 'utf-8');
  const { descriptor } = parseSFC(source);
  return { descriptor, source };
}

function reconstructSFC(descriptor, overrides = {}) {
  const template = overrides.template ?? descriptor.template?.content ?? '';
  const script = overrides.script ?? (descriptor.scriptSetup ?? descriptor.script)?.content ?? '';
  const isSetup = !!descriptor.scriptSetup;
  const scriptLang = (descriptor.scriptSetup ?? descriptor.script)?.lang;
  const scriptTag = isSetup ? 'script setup' : 'script';

  const parts = [];
  if (template) parts.push(`<template>\n${template.trim()}\n</template>`);
  if (script) {
    const langAttr = scriptLang ? ` lang="${scriptLang}"` : '';
    parts.push(`<${scriptTag}${langAttr}>\n${script.trim()}\n</${scriptTag.split(' ')[0]}>`);
  }
  descriptor.styles.forEach((s, i) => {
    const attrs = [s.scoped ? 'scoped' : '', s.lang ? `lang="${s.lang}"` : ''].filter(Boolean).join(' ');
    const content = overrides.styles?.[i] ?? s.content;
    parts.push(`<style${attrs ? ' ' + attrs : ''}>\n${content.trim()}\n</style>`);
  });

  return parts.join('\n\n');
}

function analyzeScript(content) {
  if (!content?.trim()) {
    return { stores: [], functions: [], computeds: [], props: [], emits: [], watchers: [], events: [] };
  }

  const ast = parseTS(content, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  const stores = [], functions = [], computeds = [], props = [], emits = [], watchers = [], events = [];

  traverse(ast, {
    VariableDeclarator(nodePath) {
      const init = nodePath.node.init;
      if (!init) return;

      if (
        init.type === 'CallExpression' &&
        init.callee.name?.startsWith('use') &&
        init.callee.name.endsWith('Store')
      ) {
        stores.push({ variable: nodePath.node.id.name, store: init.callee.name });
      }

      if (init.type === 'CallExpression' && init.callee.name === 'computed') {
        computeds.push(nodePath.node.id.name);
      }

      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
        functions.push(nodePath.node.id.name);
      }
    },

    FunctionDeclaration(nodePath) {
      if (nodePath.node.id?.name) functions.push(nodePath.node.id.name);
    },

    ExpressionStatement(nodePath) {
      const expr = nodePath.node.expression;
      if (expr.type !== 'CallExpression') return;

      if (expr.callee.name === 'watch' || expr.callee.name === 'watchEffect') {
        const target = expr.arguments[0];
        const label =
          target?.type === 'ArrowFunctionExpression'
            ? content.slice(target.start, target.end).substring(0, 40)
            : target?.name ?? '?';
        watchers.push(label);
      }

      if (
        expr.callee?.type === 'MemberExpression' &&
        expr.callee.property.name === 'addEventListener'
      ) {
        const eventName = expr.arguments[0];
        if (eventName?.type === 'StringLiteral') events.push(eventName.value);
      }
    },

    CallExpression(nodePath) {
      if (nodePath.node.callee.name === 'defineProps') {
        const arg = nodePath.node.arguments[0];
        if (arg?.type === 'ObjectExpression') {
          arg.properties.forEach(p => props.push(p.key?.name));
        }
      }
      if (nodePath.node.callee.name === 'defineEmits') {
        const arg = nodePath.node.arguments[0];
        if (arg?.type === 'ArrayExpression') {
          arg.elements.forEach(e => emits.push(e?.value));
        }
      }
    },
  });

  return { stores, functions, computeds, props, emits, watchers, events };
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Register all Vue-aware MCP tools against the provided server instance.
 *
 * @param {object} server      - MCP server instance with a registerTool method
 * @param {object} options
 * @param {string} options.projectRoot  - Absolute path to the project root
 * @param {function} options.rawWrite   - async (relativePath, content) => void
 */
export function registerVueTools(server, { getProjectRoot, rawWrite }) {

  server.registerTool('describe_vue_component', {
    title: 'Describe Vue Component',
    description: `Analyse a .vue file and return a structural summary without returning raw source.
Use this as your FIRST call on any .vue file to understand what it contains before reading or editing.
Returns: props, emits, stores, functions, computeds, watchers, child components, global events, style info.`,
    inputSchema: {
      path: z.string().describe('Relative path to the .vue file'),
    },
  }, async ({ path: filePath }) => {
    const projectRoot = getProjectRoot();
    const { descriptor } = readSFC(projectRoot, filePath);
    const script = descriptor.scriptSetup ?? descriptor.script;
    const analysis = analyzeScript(script?.content);

    const templateContent = descriptor.template?.content ?? '';
    const componentRefs = [...templateContent.matchAll(/<([A-Z][a-zA-Z]+)/g)].map(m => m[1]);
    const uniqueComponents = [...new Set(componentRefs)];

    const summary = {
      scriptType: descriptor.scriptSetup ? 'setup' : 'options',
      scriptLang: script?.lang ?? 'js',
      style: {
        count: descriptor.styles.length,
        scoped: descriptor.styles.some(s => s.scoped),
        langs: descriptor.styles.map(s => s.lang ?? 'css'),
      },
      ...analysis,
      childComponents: uniqueComponents,
      templateLines: templateContent.split('\n').length,
      scriptLines: script?.content.split('\n').length ?? 0,
    };

    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  });


  server.registerTool('read_vue_section', {
    title: 'Read Vue Section',
    description: `Read a single section of a .vue SFC: 'template', 'script', or 'style'.
Always prefer this over reading the full file. Only fetch what you need for the task:
- Bug in the UI layout? → template
- Adding a prop or function? → script
- Styling issue? → style
Call describe_vue_component first if you haven't already.`,
    inputSchema: {
      path: z.string().describe('Relative path to the .vue file'),
      section: z.enum(['template', 'script', 'style']).describe('Which section to read'),
    },
  }, async ({ path: filePath, section }) => {
    const projectRoot = getProjectRoot();
    const { descriptor } = readSFC(projectRoot, filePath);

    let content;
    if (section === 'template') content = descriptor.template?.content ?? '';
    if (section === 'script') content = (descriptor.scriptSetup ?? descriptor.script)?.content ?? '';
    if (section === 'style') {
      content = descriptor.styles
        .map((s, i) => `/* style[${i}]${s.scoped ? ' scoped' : ''} */\n${s.content}`)
        .join('\n\n');
    }

    if (!content?.trim()) {
      return { content: [{ type: 'text', text: `No ${section} section found.` }] };
    }

    return { content: [{ type: 'text', text: content }] };
  });


  server.registerTool('write_vue_section', {
    title: 'Write Vue Section',
    description: `Replace the content of a single section in a .vue file (template, script, or style).
Preserves all other sections exactly. Use this instead of write_file for .vue files —
it prevents accidentally overwriting sections you haven't read.
Provide the complete new content for the section, not a diff.`,
    inputSchema: {
      path: z.string().describe('Relative path to the .vue file'),
      section: z.enum(['template', 'script', 'style']).describe('Which section to replace'),
      content: z.string().describe('Full replacement content for this section (without the wrapping tag)'),
    },
  }, async ({ path: filePath, section, content }) => {
    const projectRoot = getProjectRoot();
    const { descriptor } = readSFC(projectRoot, filePath);

    const overrides = {};
    if (section === 'template') overrides.template = content;
    if (section === 'script') overrides.script = content;
    if (section === 'style') overrides.styles = [content];

    const newSource = reconstructSFC(descriptor, overrides);
    await rawWrite(filePath, newSource);

    return { content: [{ type: 'text', text: `Updated <${section}> in ${filePath}` }] };
  });


  server.registerTool('add_vue_function', {
    title: 'Add Function to Vue Component',
    description: `Append a new function to the script section of a .vue component.
Use when adding new behaviour without needing to read or rewrite the entire script.
The function will be appended at the end of the script block.`,
    inputSchema: {
      path: z.string().describe('Relative path to the .vue file'),
      functionCode: z.string().describe('Complete function code to append, e.g. "async function save() { ... }"'),
    },
  }, async ({ path: filePath, functionCode }) => {
    const projectRoot = getProjectRoot();
    const { descriptor } = readSFC(projectRoot, filePath);
    const script = descriptor.scriptSetup ?? descriptor.script;
    const existing = script?.content ?? '';
    const updated = `${existing.trimEnd()}\n\n${functionCode.trim()}`;

    const newSource = reconstructSFC(descriptor, { script: updated });
    await rawWrite(filePath, newSource);

    return { content: [{ type: 'text', text: `Function appended to script in ${filePath}` }] };
  });


  server.registerTool('add_vue_prop', {
    title: 'Add Prop to Vue Component',
    description: `Add a new prop to a Vue component's defineProps() call.
Only works with <script setup> components using object-style defineProps.
Reads the current props, merges in the new one, and writes back only the script section.`,
    inputSchema: {
      path: z.string().describe('Relative path to the .vue file'),
      propName: z.string().describe('Name of the new prop'),
      propDefinition: z.string().describe('Prop definition value, e.g. "String" or "{ type: Number, required: true }"'),
    },
  }, async ({ path: filePath, propName, propDefinition }) => {
    const projectRoot = getProjectRoot();
    const { descriptor } = readSFC(projectRoot, filePath);
    const script = descriptor.scriptSetup;
    if (!script) throw new Error('add_vue_prop only supports <script setup> components');

    const updated = script.content.replace(
      /defineProps\(\{([\s\S]*?)\}\)/,
      (_, inner) => `defineProps({\n${inner.trimEnd()},\n  ${propName}: ${propDefinition},\n})`
    );

    const newSource = reconstructSFC(descriptor, { script: updated });
    await rawWrite(filePath, newSource);

    return { content: [{ type: 'text', text: `Added prop '${propName}' to ${filePath}` }] };
  });


  server.registerTool('create_vue_component', {
    title: 'Create Vue Component',
    description: `Scaffold a new .vue file with empty template, script setup, and optional scoped styles.
Use this instead of write_file when creating a new component from scratch.`,
    inputSchema: {
      path: z.string().describe('Relative path for the new component, e.g. "components/MyWidget.vue"'),
      withStyle: z.boolean().default(true).describe('Include an empty scoped <style> block'),
      lang: z.enum(['js', 'ts']).default('js').describe('Script language'),
    },
  }, async ({ path: filePath, withStyle, lang }) => {
    const langAttr = lang === 'ts' ? ' lang="ts"' : '';
    const parts = [
      `<template>\n  <div></div>\n</template>`,
      `<script setup${langAttr}>\n</script>`,
    ];
    if (withStyle) parts.push(`<style scoped>\n</style>`);

    await rawWrite(filePath, parts.join('\n\n'));

    return { content: [{ type: 'text', text: `Created component at ${filePath}` }] };
  });

}