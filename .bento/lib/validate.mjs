import { loadLimits, matchesOverride } from './config.mjs';
import { getDiffStats, runGit, summarize } from './diff.mjs';
import { resolveStackBases } from './stack.mjs';

export function evaluate(limits, files) {
  const global = { lines: 0, files: 0 };
  const groups = new Map();
  for (const f of files) {
    global.lines += f.added + f.deleted;
    global.files += 1;
    for (const o of limits.overrides) {
      if (matchesOverride(f.path, o)) {
        const g = groups.get(o.glob) ?? { lines: 0, files: 0 };
        g.lines += f.added + f.deleted;
        g.files += 1;
        groups.set(o.glob, g);
      }
    }
  }
  const violations = [];
  if (global.lines > limits.maxLines) {
    violations.push(`total de linhas ${global.lines} > ${limits.maxLines}`);
  }
  if (global.files > limits.maxFiles) {
    violations.push(`total de arquivos ${global.files} > ${limits.maxFiles}`);
  }
  for (const [glob, g] of groups) {
    const override = limits.overrides.find((o) => o.glob === glob);
    const max = override?.maxLines ?? limits.maxLines;
    if (g.lines > max) {
      violations.push(`grupo "${glob}": ${g.lines} linhas > ${max}`);
    }
  }
  return { global, groups: [...groups.entries()], violations };
}

export function runCheck({ base, head, cwd }) {
  const limits = loadLimits(cwd);
  const files = getDiffStats(base, head, cwd, true);
  const summary = summarize(files);
  const result = evaluate(limits, files);
  console.log(`Diff ${base}...${head} (merge-base): ${summary.lines} lines, ${summary.files} files`);
  for (const [dir, count] of summary.byDir) {
    console.log(`  ${dir}: ${count} file(s)`);
  }
  if (result.violations.length > 0) {
    console.error('OVERSIZED PR:');
    for (const v of result.violations) {
      console.error(`  - ${v}`);
    }
    return 1;
  }
  console.log('PR within limits.');
  return 0;
}

export function runCheckPush({ refs, cwd }) {
  const limits = loadLimits(cwd);
  const bases = resolveStackBases(cwd, refs);
  let failed = false;
  for (const { branch, sha } of refs) {
    const base = bases.get(branch);
    const files = getDiffStats(base, sha, cwd, true);
    const summary = summarize(files);
    const result = evaluate(limits, files);
    console.log(`[${branch}] diff ${base}...${sha} (merge-base): ${summary.lines} lines, ${summary.files} files`);
    if (result.violations.length > 0) {
      console.error(`OVERSIZED PR (${branch}):`);
      for (const v of result.violations) {
        console.error(`  - ${v}`);
      }
      failed = true;
    }
  }
  if (failed) return 1;
  console.log('PR(s) within limits.');
  return 0;
}

export function runEquivalence({ base, head, layers, cwd }) {
  if (!layers.length) {
    console.error('usage: equivalence <base> <head> <layer1> [layer2 …]');
    return 2;
  }
  let prev = base;
  for (const layer of layers) {
    try {
      runGit(['merge-base', '--is-ancestor', prev, layer], cwd);
    } catch (err) {
      console.error(`layers do not form a chain: ${layer} is not a descendant of ${prev}`);
      return 1;
    }
    prev = layer;
  }
  const last = layers[layers.length - 1];
  let stats;
  try {
    stats = getDiffStats(head, last, cwd);
  } catch (err) {
    console.error(err.stderr ?? err.message);
    return 1;
  }
  if (stats.length === 0) {
    console.log('EQUIVALENT: final state of the layers matches the original.');
    return 0;
  }
  console.error('DIVERGENT:');
  for (const f of stats) {
    console.error(`  divergence in ${f.path}: ${f.added}+/${f.deleted}-`);
  }
  return 1;
}
