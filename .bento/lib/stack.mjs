import { runGit } from './diff.mjs';

export function isAncestor(cwd, ancestor, descendant) {
  try {
    runGit(['merge-base', '--is-ancestor', ancestor, descendant], cwd);
    return true;
  } catch {
    return false;
  }
}

export function resolveStackBases(cwd, refs) {
  const bases = new Map();
  for (const ref of refs) {
    let base = 'main';
    let closest = Infinity;
    for (const candidate of refs) {
      if (candidate.branch === ref.branch) continue;
      if (candidate.sha === ref.sha) continue;
      if (!isAncestor(cwd, candidate.sha, ref.sha)) continue;
      const distance = Number(runGit(['rev-list', '--count', `${candidate.sha}..${ref.sha}`], cwd).trim());
      if (distance < closest) {
        closest = distance;
        base = candidate.branch;
      }
    }
    bases.set(ref.branch, base);
  }
  return bases;
}
