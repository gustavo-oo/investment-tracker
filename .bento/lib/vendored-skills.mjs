import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const VENDORED_SKILLS = [
  'brainstorming',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
];

function listFiles(root, base = root, acc = []) {
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) listFiles(abs, base, acc);
    else acc.push(abs.slice(base.length + 1));
  }
  return acc;
}

export function sameTree(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false;
  const filesA = listFiles(a);
  const filesB = listFiles(b);
  if (filesA.length !== filesB.length) return false;
  for (let i = 0; i < filesA.length; i += 1) {
    if (filesA[i] !== filesB[i]) return false;
    if (!readFileSync(join(a, filesA[i])).equals(readFileSync(join(b, filesB[i])))) return false;
  }
  return true;
}

export function installVendoredSkills(projectRoot, sourceSkillsRoot, names = VENDORED_SKILLS, referenceSkillsRoot = null) {
  const installed = [];
  const skipped = [];
  for (const name of names) {
    const src = join(sourceSkillsRoot, name);
    const dest = join(projectRoot, '.opencode', 'skills', name);
    if (!existsSync(src)) {
      console.error(`warning: source skill missing (${name}); skipped.`);
      skipped.push(name);
      continue;
    }
    if (existsSync(dest) && !sameTree(src, dest)) {
      const reference = referenceSkillsRoot === null ? null : join(referenceSkillsRoot, name);
      const outdatedOurs = reference !== null && existsSync(reference) && sameTree(dest, reference);
      if (!outdatedOurs) {
        console.error(`warning: skill ${name} already exists with different content; preserved.`);
        skipped.push(name);
        continue;
      }
    }
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
    installed.push(name);
  }
  return { installed, skipped };
}

export function removeVendoredSkills(projectRoot, referenceSkillsRoot, names = VENDORED_SKILLS) {
  const removed = [];
  const preserved = [];
  for (const name of names) {
    const dest = join(projectRoot, '.opencode', 'skills', name);
    if (!existsSync(dest)) continue;
    const ref = join(referenceSkillsRoot, name);
    if (existsSync(ref) && sameTree(dest, ref)) {
      rmSync(dest, { recursive: true, force: true });
      removed.push(`.opencode/skills/${name}`);
    } else if (existsSync(ref)) {
      console.error(`warning: skill ${name} was modified; preserved.`);
      preserved.push(name);
    } else {
      console.error(`warning: skill ${name} has no reference in .bento; preserved.`);
      preserved.push(name);
    }
  }
  return { removed, preserved };
}
