import { appendFileSync, chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAgents, isBentoAgent, removeAgents } from './agents.mjs';
import { loadArtifactsLanguage, parseArtifactsLanguage, parseLimitsYaml } from './config.mjs';
import { installVendoredSkills, removeVendoredSkills, VENDORED_SKILLS } from './vendored-skills.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function packageRoot() {
  return PKG_ROOT;
}

export function version() {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return readFileSync(join(PKG_ROOT, 'VERSION'), 'utf8').trim();
  }
}

const SHIM = `#!/usr/bin/env node
import { runCheck, runCheckPush, runEquivalence } from '../.bento/lib/validate.mjs';

const [, , cmd, ...args] = process.argv;
if (cmd === 'check') {
  process.exitCode = runCheck({ base: args[0] ?? 'main', head: args[1] ?? 'HEAD', cwd: process.cwd() });
} else if (cmd === 'check-push') {
  const refs = [];
  for (let i = 0; i + 1 < args.length; i += 2) refs.push({ branch: args[i], sha: args[i + 1] });
  process.exitCode = runCheckPush({ refs, cwd: process.cwd() });
} else if (cmd === 'equivalence') {
  process.exitCode = runEquivalence({ base: args[0], head: args[1], layers: args.slice(2), cwd: process.cwd() });
} else {
  console.error('usage: pr-split-verify check [base] | check-push <branch> <sha> ... | equivalence <base> <head> <layer1> [layer2 ...]');
  process.exitCode = 2;
}
`;

function setTopLevelKey(content, key, value) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (re.test(content)) return content.replace(re, `${key}: ${value}`);
  return `${content.replace(/\n*$/, '\n')}${key}: ${value}\n`;
}

function renderOverrides(overrides) {
  const lines = ['overrides:'];
  for (const o of overrides) {
    lines.push(`  - glob: "${o.glob}"`);
    lines.push(`    max_lines: ${o.maxLines}`);
  }
  return lines;
}

function replaceOverrides(content, block) {
  const lines = content.replace(/\n*$/, '').split('\n');
  const start = lines.findIndex((l) => l.startsWith('overrides:'));
  let next;
  if (start === -1) {
    next = [...lines, ...block];
  } else {
    let end = start + 1;
    while (end < lines.length && (lines[end].startsWith(' ') || lines[end].trim() === '')) end += 1;
    next = [...lines.slice(0, start), ...block, ...lines.slice(end)];
  }
  return `${next.join('\n')}\n`;
}

function mergeLegacyLimits(content, legacyText) {
  const legacy = parseLimitsYaml(legacyText);
  let next = setTopLevelKey(content, 'max_lines', legacy.maxLines);
  next = setTopLevelKey(next, 'max_files', legacy.maxFiles);
  if (legacy.overrides.length > 0) next = replaceOverrides(next, renderOverrides(legacy.overrides));
  return next;
}

function writeBentoConfig(projectRoot, artifactsLanguage) {
  const bentoConfigPath = join(projectRoot, '.bento.yaml');
  const legacyPath = join(projectRoot, '.pr-limits.yaml');
  const legacyText = existsSync(legacyPath) ? readFileSync(legacyPath, 'utf8') : null;
  const current = existsSync(bentoConfigPath) ? readFileSync(bentoConfigPath, 'utf8') : null;
  let content = current ?? readFileSync(join(PKG_ROOT, 'templates', 'bento.yaml'), 'utf8');
  let changed = current === null;
  if (artifactsLanguage) {
    const next = content.replace(/^(artifacts_language:).*$/m, `$1 ${artifactsLanguage}`);
    if (next !== content) {
      content = next;
      changed = true;
    }
  }
  if (legacyText !== null) {
    content = mergeLegacyLimits(content, legacyText);
    changed = true;
    rmSync(legacyPath, { force: true });
  }
  if (changed) writeFileSync(bentoConfigPath, content);
  return { path: bentoConfigPath, language: parseArtifactsLanguage(content), changed, migrated: legacyText !== null };
}

export function install(projectRoot, { noAgents = false, noAgentBrowser = false, noHooks = false, noSuperpowers = false, noProfile = false, noCodegraph = false, noOutputStyle = false, noShim = false, artifactsLanguage = null } = {}) {
  const dotBento = join(projectRoot, '.bento');
  mkdirSync(dotBento, { recursive: true });
  const previousSkillsRoot = join(dotBento, 'skills');
  const vendoredSkills = noSuperpowers
    ? { installed: [], skipped: [] }
    : installVendoredSkills(projectRoot, join(PKG_ROOT, 'skills'), VENDORED_SKILLS, previousSkillsRoot);
  for (const sub of ['lib', 'bin', 'templates']) {
    const src = join(PKG_ROOT, sub);
    const dest = join(dotBento, sub);
    if (src === dest) continue;
    cpSync(src, dest, { recursive: true });
  }
  const legacyTemplate = join(dotBento, 'templates', 'pr-limits.yaml');
  if (existsSync(legacyTemplate)) rmSync(legacyTemplate, { force: true });
  if (!noSuperpowers) {
    const src = join(PKG_ROOT, 'skills');
    const dest = join(dotBento, 'skills');
    if (src !== dest) {
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
    }
  }
  writeFileSync(join(dotBento, 'VERSION'), `${version()}\n`);

  if (!noHooks) {
    const hooksDir = join(dotBento, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, 'pre-push');
    copyFileSync(join(PKG_ROOT, 'templates', 'hooks', 'pre-push'), hookPath);
    chmodSync(hookPath, 0o755);
  }

  const skillDir = join(projectRoot, '.opencode', 'skills', 'small-prs');
  mkdirSync(skillDir, { recursive: true });
  cpSync(join(PKG_ROOT, 'skills', 'small-prs'), skillDir, { recursive: true });
if (!noAgentBrowser) {
    const abSkillDir = join(projectRoot, '.opencode', 'skills', 'agent-browser');
    mkdirSync(abSkillDir, { recursive: true });
    cpSync(join(PKG_ROOT, 'skills', 'agent-browser'), abSkillDir, { recursive: true });
  }
  const tasteSkillDir = join(projectRoot, '.opencode', 'skills', 'taste-skill');
  mkdirSync(tasteSkillDir, { recursive: true });
  cpSync(join(PKG_ROOT, 'skills', 'taste-skill'), tasteSkillDir, { recursive: true });
  const selfReviewDir = join(projectRoot, '.opencode', 'skills', 'self-review');
  mkdirSync(selfReviewDir, { recursive: true });
  cpSync(join(PKG_ROOT, 'skills', 'self-review'), selfReviewDir, { recursive: true });

  if (!noOutputStyle) {
    const styleSkillDir = join(projectRoot, '.opencode', 'skills', 'i-have-adhd');
    mkdirSync(styleSkillDir, { recursive: true });
    cpSync(join(PKG_ROOT, 'skills', 'i-have-adhd'), styleSkillDir, { recursive: true });

    const instructionsDir = join(projectRoot, '.opencode', 'instructions');
    mkdirSync(instructionsDir, { recursive: true });
    copyFileSync(join(PKG_ROOT, 'templates', 'instructions', 'i-have-adhd.md'), join(instructionsDir, 'i-have-adhd.md'));
  }

  mkdirSync(join(projectRoot, '.opencode', 'commands'), { recursive: true });

  if (!noShim) {
    mkdirSync(join(projectRoot, 'scripts'), { recursive: true });
    writeFileSync(join(projectRoot, 'scripts', 'pr-split-verify.mjs'), SHIM);
  }

  const bentoConfig = writeBentoConfig(projectRoot, artifactsLanguage);

  if (!noAgents) {
    const agentsPath = join(projectRoot, 'AGENTS.md');
    const content = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
    if (!/^## Bento\b/m.test(content)) {
      const section = readFileSync(join(PKG_ROOT, 'templates', 'agents-section.md'), 'utf8');
      appendFileSync(agentsPath, `\n${section}\n`);
    } else if (!content.includes('self-review')) {
      console.error('warning: existing ## Bento section does not mention self-review; update AGENTS.md by hand to get the gate.');
    }
  }

  const agents = installAgents(projectRoot, {
    profile: !noProfile,
    codegraph: !noCodegraph,
    agentBrowser: !noAgentBrowser,
  });

  const flashPath = join(projectRoot, '.opencode', 'agents', 'flash.md');
  if (existsSync(flashPath) && isBentoAgent(flashPath) && !readFileSync(flashPath, 'utf8').includes('self-review')) {
    console.error('warning: flash.md does not mention the self-review gate (older install); edit or remove it and run update again.');
  }

  return { dotBento, skillDir, vendoredSkills, agents, bentoConfig };
}

function stripBentoSection(content) {
  const m = /^## Bento \(small-prs\)\s*$/m.exec(content);
  if (!m) return null;
  let from = m.index;
  if (from > 0 && content[from - 1] === '\n' && (from === 1 || content[from - 2] === '\n')) from -= 1;
  const next = /^## /gm;
  next.lastIndex = m.index + m[0].length;
  const n = next.exec(content);
  const to = n ? n.index : content.length;
  return content.slice(0, from) + content.slice(to);
}

export function uninstall(projectRoot) {
  const removed = [];

  const agentsResult = removeAgents(projectRoot);
  removed.push(...agentsResult.removed);

  const vendored = removeVendoredSkills(projectRoot, join(projectRoot, '.bento', 'skills'));
  removed.push(...vendored.removed);

  const dotBento = join(projectRoot, '.bento');
  if (existsSync(dotBento)) {
    rmSync(dotBento, { recursive: true, force: true });
    removed.push('.bento');
  }

  const skillDir = join(projectRoot, '.opencode', 'skills', 'small-prs');
  if (existsSync(skillDir)) {
    rmSync(skillDir, { recursive: true, force: true });
    removed.push('.opencode/skills/small-prs');
  }

const abSkillDir = join(projectRoot, '.opencode', 'skills', 'agent-browser');
  if (existsSync(abSkillDir)) {
    rmSync(abSkillDir, { recursive: true, force: true });
    removed.push('.opencode/skills/agent-browser');
  }
  const tasteSkillDir = join(projectRoot, '.opencode', 'skills', 'taste-skill');
  if (existsSync(tasteSkillDir)) {
    rmSync(tasteSkillDir, { recursive: true, force: true });
    removed.push('.opencode/skills/taste-skill');
  }
  const selfReviewDir = join(projectRoot, '.opencode', 'skills', 'self-review');
  if (existsSync(selfReviewDir)) {
    rmSync(selfReviewDir, { recursive: true, force: true });
    removed.push('.opencode/skills/self-review');
  }

  const styleSkillDir = join(projectRoot, '.opencode', 'skills', 'i-have-adhd');
  if (existsSync(styleSkillDir)) {
    rmSync(styleSkillDir, { recursive: true, force: true });
    removed.push('.opencode/skills/i-have-adhd');
  }

  const styleInstructions = join(projectRoot, '.opencode', 'instructions', 'i-have-adhd.md');
  if (existsSync(styleInstructions)) {
    rmSync(styleInstructions, { force: true });
    removed.push('.opencode/instructions/i-have-adhd.md');
  }

  const shimPath = join(projectRoot, 'scripts', 'pr-split-verify.mjs');
  if (existsSync(shimPath) && readFileSync(shimPath, 'utf8').includes('../.bento/lib/validate.mjs')) {
    rmSync(shimPath, { force: true });
    removed.push('scripts/pr-split-verify.mjs');
  }

  const configPath = join(projectRoot, '.pr-limits.yaml');
  if (existsSync(configPath)) {
    rmSync(configPath, { force: true });
    removed.push('.pr-limits.yaml');
  }

  const bentoConfigPath = join(projectRoot, '.bento.yaml');
  if (existsSync(bentoConfigPath)) {
    rmSync(bentoConfigPath, { force: true });
    removed.push('.bento.yaml');
  }

  const agentsPath = join(projectRoot, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const content = readFileSync(agentsPath, 'utf8');
    const rest = stripBentoSection(content);
    if (rest !== null) {
      if (rest.trim() === '') {
        rmSync(agentsPath, { force: true });
      } else {
        writeFileSync(agentsPath, rest);
      }
      removed.push('AGENTS.md');
    }
  }

  return { removed };
}
