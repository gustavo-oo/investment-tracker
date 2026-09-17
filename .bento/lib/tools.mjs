import { execFileSync } from 'node:child_process';

function run(cmd, args, label) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', encoding: 'utf8' });
    return true;
  } catch (err) {
    console.error(`warning: ${label}: ${err.message}`);
    return false;
  }
}

export function ensureCodegraph({ npmBin = 'npm' } = {}) {
  return run(npmBin, ['i', '-g', '@colbymchenry/codegraph'], 'codegraph CLI could not be installed');
}

export function ensureAgentBrowser({ npmBin = 'npm' } = {}) {
  if (!run(npmBin, ['i', '-g', 'agent-browser'], 'agent-browser CLI could not be installed')) return false;
  return run('agent-browser', ['install'], 'agent-browser Chrome could not be installed');
}

export function initCodegraph(cwd, { codegraphBin = 'codegraph' } = {}) {
  try {
    execFileSync(codegraphBin, ['init'], { cwd, stdio: 'ignore', encoding: 'utf8' });
    return true;
  } catch (err) {
    console.error(`warning: codegraph init failed: ${err.message}`);
    return false;
  }
}

