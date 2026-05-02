/**
 * Forge IDE — Shared FS / Git / Shell utilities
 *
 * Single source of truth for:
 *   - Project root (one variable, one setter, one getter)
 *   - Path safety / traversal prevention
 *   - Raw file operations (read, write, list, create, delete, rename, search, grep)
 *   - Git operations (status, diff, log, stage, unstage, commit, push, pull, branches)
 *   - Shell execution
 *
 * All other backend modules import from here.
 * Response shaping (MCP envelope, WS envelope, etc.) is done by the caller.
 */

import { readFile, writeFile, readdir, stat, mkdir, unlink, rmdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join, relative, dirname, extname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import fg from 'fast-glob';

export const execAsync = promisify(exec);

// ─── Project root (single source of truth) ───────────────────────────────────
let _root = process.env.PROJECT_ROOT || process.cwd();

export function setProjectRoot(path) { _root = path; }
export function getProjectRoot()     { return _root; }

// ─── Path safety ──────────────────────────────────────────────────────────────
// All callers use this. Prevents traversal, resolves relative paths.
export function safePath(relPath) {
  if (!relPath || relPath === '') return _root;
  const abs = join(_root, relPath);
  // Ensure the resolved path is still inside the project root
  if (!abs.startsWith(_root + '/') && abs !== _root) {
    throw new Error(`Path traversal denied: ${relPath}`);
  }
  return abs;
}

// ─── Raw file operations ──────────────────────────────────────────────────────

export async function rawRead(relPath) {
  const abs = safePath(relPath);
  return readFile(abs, 'utf-8');
}

export async function rawWrite(relPath, content) {
  const abs = safePath(relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf-8');
}

export async function rawList(relPath = '') {
  const abs = safePath(relPath);
  const entries = await readdir(abs, { withFileTypes: true });
  const result = await Promise.all(entries.map(async (e) => {
    const rel = join(relPath, e.name);
    const s = await stat(join(abs, e.name));
    return {
      name: e.name,
      path: rel,
      type: e.isDirectory() ? 'dir' : 'file',
      size: s.size,
      mtime: s.mtimeMs,
      ext: e.isFile() ? extname(e.name) : null,
    };
  }));
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function rawCreate(relPath, type = 'file') {
  const abs = safePath(relPath);
  if (type === 'dir') {
    await mkdir(abs, { recursive: true });
  } else {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, '', 'utf-8');
  }
}

export async function rawDelete(relPath) {
  const abs = safePath(relPath);
  const s = await stat(abs);
  if (s.isDirectory()) await rmdir(abs, { recursive: true });
  else await unlink(abs);
}

export async function rawRename(oldRel, newRel) {
  await rename(safePath(oldRel), safePath(newRel));
}

export async function rawSearch(query, relPath = '') {
  const base = safePath(relPath);
  const files = await fg('**/*', {
    cwd: base,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/.forge/**'],
  });
  const q = query.toLowerCase();
  return files.filter(f => f.toLowerCase().includes(q)).slice(0, 100);
}

export async function rawGrep(query, relPath = '', caseSensitive = false) {
  const base = safePath(relPath);
  const flag = caseSensitive ? '' : '-i';
  try {
    const { stdout } = await execAsync(
      `grep -r ${flag} -n -l --exclude-dir=".git" --exclude-dir="node_modules" --exclude-dir=".forge" "${query}" .`,
      { cwd: base }
    );
    const files = stdout.trim().split('\n').filter(Boolean);
    const results = await Promise.all(files.slice(0, 30).map(async (file) => {
      try {
        const { stdout: lines } = await execAsync(`grep ${flag} -n "${query}" "${file}"`, { cwd: base });
        return {
          file: file.startsWith('./') ? file.slice(2) : file,
          matches: lines.trim().split('\n').filter(Boolean).slice(0, 15).map(l => {
            const idx = l.indexOf(':');
            return { line: parseInt(l.slice(0, idx)), text: l.slice(idx + 1).trim() };
          }),
        };
      } catch { return null; }
    }));
    return results.filter(Boolean);
  } catch {
    return [];
  }
}

// ─── Git operations ───────────────────────────────────────────────────────────

async function git(args, opts = {}) {
  return execAsync(`git ${args}`, { cwd: _root, timeout: 60000, ...opts });
}

export async function rawGitStatus() {
  const { stdout: st } = await git('status --porcelain=v1');
  const { stdout: br } = await git('branch --show-current');
  let ahead = 0, behind = 0;
  try {
    const { stdout: ab } = await git('rev-list --left-right --count HEAD...@{u}');
    [ahead, behind] = ab.trim().split('\t').map(Number);
  } catch {}
  const files = st.split('\n').filter(Boolean).map(line => {
    const xy = line.substring(0, 2);
    const filePath = line.substring(3).trim().split(' -> ').pop();
    return { xy, path: filePath, staged: xy[0] !== ' ' && xy[0] !== '?', unstaged: xy[1] !== ' ' };
  });
  return { branch: br.trim() || 'HEAD', files, ahead, behind };
}

export async function rawGitDiff(relPath, staged = false) {
  const target = relPath ? `-- "${relPath}"` : '';
  const { stdout } = await git(`diff ${staged ? '--cached' : ''} ${target}`);
  return stdout;
}

export async function rawGitLog(limit = 30) {
  const { stdout } = await git(`log -${limit} --pretty=format:"%H|%s|%an|%ar"`);
  return stdout.split('\n').filter(Boolean).map(l => {
    const [hash, subject, author, date] = l.split('|');
    return { hash, subject, author, date };
  });
}

export async function rawGitStage(relPath)   { await git(`add -- "${relPath}"`); }
export async function rawGitStageAll()        { await git('add -A'); }
export async function rawGitUnstage(relPath) {
  try { await git(`restore --staged -- "${relPath}"`); }
  catch { await git(`reset HEAD -- "${relPath}"`); }
}
export async function rawGitCommit(message) {
  if (!message?.trim()) throw new Error('Commit message required');
  const { stdout } = await git(`commit -m "${message.replace(/"/g, '\\"')}"`);
  return stdout;
}
export async function rawGitPush(remote = 'origin', branch = '') {
  const { stdout, stderr } = await git(`push ${remote} ${branch}`);
  return stdout || stderr;
}
export async function rawGitPull() {
  const { stdout, stderr } = await git('pull --rebase');
  return stdout || stderr;
}
export async function rawGitBranches() {
  const { stdout: local }   = await git('branch --format=%(refname:short)');
  const { stdout: current } = await git('branch --show-current');
  const { stdout: remote }  = await git('branch -r --format=%(refname:short)').catch(() => ({ stdout: '' }));
  return {
    current: current.trim(),
    local: local.split('\n').filter(Boolean),
    remote: remote.split('\n').filter(Boolean),
  };
}
export async function rawGitCheckout(branch) {
  const { stdout, stderr } = await git(`checkout "${branch}"`);
  return stdout || stderr;
}
export async function rawGitNewBranch(name, base = '') {
  await git(`checkout -b "${name}" ${base}`.trim());
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export async function rawShell(command, relCwd = '') {
  const workDir = relCwd ? safePath(relCwd) : _root;
  const { stdout, stderr } = await execAsync(command, { cwd: workDir, timeout: 30000 });
  return { stdout, stderr };
}
