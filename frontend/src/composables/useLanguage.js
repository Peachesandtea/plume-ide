import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { go } from '@codemirror/lang-go';

const EXT_MAP = {
  js: () => javascript({ jsx: true }),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  py: () => python(),
  html: () => html(),
  htm: () => html(),
  css: () => css(),
  scss: () => css(),
  less: () => css(),
  md: () => markdown(),
  markdown: () => markdown(),
  go: () => go(),
};

export function getLanguageExtension(filename) {
  if (!filename) return [];
  const ext = filename.split('.').pop()?.toLowerCase();
  const factory = EXT_MAP[ext];
  return factory ? [factory()] : [];
}

export function getLanguageName(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase();
  const names = {
    js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX',
    py: 'Python', html: 'HTML', htm: 'HTML', css: 'CSS',
    scss: 'SCSS', less: 'LESS', md: 'Markdown', go: 'Go',
    json: 'JSON', yaml: 'YAML', yml: 'YAML', sh: 'Shell',
    txt: 'Plain Text',
  };
  return names[ext] || ext?.toUpperCase() || 'Text';
}
