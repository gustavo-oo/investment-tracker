import { execFileSync } from 'node:child_process';

export function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}

export function parseNumstat(text) {
  const files = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    files.push({
      path: m[3],
      added: m[1] === '-' ? 0 : Number(m[1]),
      deleted: m[2] === '-' ? 0 : Number(m[2]),
    });
  }
  return files;
}

export function getDiffStats(base, head, cwd, mergeBase = false) {
  const args = mergeBase
    ? ['-c', 'core.quotepath=false', 'diff', '--numstat', `${base}...${head}`]
    : ['-c', 'core.quotepath=false', 'diff', '--numstat', base, head];
  const text = runGit(args, cwd);
  return parseNumstat(text);
}

export function summarize(files) {
  let lines = 0;
  const byDir = new Map();
  for (const f of files) {
    lines += f.added + f.deleted;
    const dir = f.path.includes('/') ? f.path.split('/')[0] : '(raiz)';
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  return { lines, files: files.length, byDir: [...byDir.entries()].sort((a, b) => b[1] - a[1]) };
}
