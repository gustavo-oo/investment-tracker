import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

export const HOOKS_DIR = '.bento/hooks';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function hooksPathPointsToBento(cwd, value) {
  const v = String(value).trim();
  if (v === '') return false;
  if (v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v)) {
    return resolve(v) === resolve(cwd, HOOKS_DIR);
  }
  return normalize(v).replace(/[\\/]+$/, '') === normalize(HOOKS_DIR);
}

export function setupPrePushHook(cwd) {
  let commonDir;
  try {
    commonDir = git(['rev-parse', '--git-common-dir'], cwd).trim();
  } catch {
    console.error('warning: pre-push skipped: directory is not a git repository.');
    return { status: 'skipped', reason: 'no-git' };
  }
  let current = '';
  try {
    current = git(['config', '--get', 'core.hooksPath'], cwd).trim();
  } catch {
    current = '';
  }
  if (current !== '' && !hooksPathPointsToBento(cwd, current)) {
    console.error(`warning: pre-push skipped: core.hooksPath already points to "${current}" (husky/lefthook?).`);
    return { status: 'skipped', reason: 'hooks-path' };
  }
  const hooksDir = resolve(cwd, commonDir, 'hooks');
  if (existsSync(hooksDir)) {
    const manual = readdirSync(hooksDir).filter((f) => !f.endsWith('.sample') && !f.startsWith('README'));
    if (manual.length > 0) {
      console.error(`warning: pre-push skipped: manual hooks in ${commonDir}/hooks (${manual.join(', ')}); core.hooksPath would disable them.`);
      return { status: 'skipped', reason: 'manual-hooks' };
    }
  }
  if (current === '' || !hooksPathPointsToBento(cwd, current)) {
    try {
      git(['config', '--local', 'core.hooksPath', HOOKS_DIR], cwd);
    } catch {
      console.error('warning: pre-push skipped: failed to write core.hooksPath to git config.');
      return { status: 'skipped', reason: 'config-write' };
    }
  }
  return { status: 'installed' };
}

export function bentoHooksActive(cwd) {
  let current = '';
  try {
    current = git(['config', '--get', 'core.hooksPath'], cwd).trim();
  } catch {
    return null;
  }
  if (current === '' || !hooksPathPointsToBento(cwd, current)) return null;
  return { active: true, value: current };
}

export function removePrePushHook(cwd) {
  const active = bentoHooksActive(cwd);
  if (!active) return null;
  try {
    git(['config', '--local', '--unset', 'core.hooksPath'], cwd);
  } catch {
    console.error('warning: pre-push not unset: failed to remove core.hooksPath from git config.');
    return null;
  }
  return { removed: true };
}