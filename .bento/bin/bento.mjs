#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { runCheck, runEquivalence } from '../lib/validate.mjs';
import { install, uninstall } from '../lib/install.mjs';
import { hasBentoAgent } from '../lib/agents.mjs';
import { addPonytailPlugin, removePonytailPlugin, removeSuperpowersPlugin, setDefaultAgentIfAbsent, removeDefaultAgentIf, addInstructionsEntry, removeInstructionsEntry, OUTPUT_STYLE_INSTRUCTIONS } from '../lib/opencode-config.mjs';
import { addMcpServer, removeMcpServer, CODEGRAPH_MCP, AGENT_BROWSER_MCP } from '../lib/mcp-config.mjs';
import { ensureCodegraph, ensureAgentBrowser, initCodegraph } from '../lib/tools.mjs';
import { setupPrePushHook, removePrePushHook, bentoHooksActive } from '../lib/hooks.mjs';

const [, , cmd, ...args] = process.argv;

function ensureGhStack() {
  try {
    const list = execFileSync('gh', ['extension', 'list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (list.includes('gh-stack')) return true;
    execFileSync('gh', ['extension', 'install', 'github/gh-stack'], { stdio: 'inherit' });
    return true;
  } catch (err) {
    return false;
  }
}

function languageArg() {
  const withEquals = args.find((a) => a.startsWith('--language='));
  if (withEquals !== undefined) return withEquals.slice('--language='.length);
  const i = args.indexOf('--language');
  if (i === -1) return null;
  const value = args[i + 1];
  return value && !value.startsWith('--') ? value : '';
}

async function promptArtifactsLanguage() {
  if (existsSync(join(process.cwd(), '.bento.yaml'))) return null;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  if (languageArg() !== null) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Language for generated artifacts (PR bodies, commits, docs, specs, plans) [English]: ')).trim();
    return answer || null;
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

async function run() {
  const noAgents = args.includes('--no-agents');
  const noSuperpowers = args.includes('--no-superpowers');
  const noProfile = args.includes('--no-profile');
  const noPonytail = args.includes('--no-ponytail');
  const noHooks = args.includes('--no-hooks');
  const noCodegraph = args.includes('--no-codegraph');
  const noAgentBrowser = args.includes('--no-agent-browser');
  const noOutputStyle = args.includes('--no-output-style');
  const language = languageArg();
  if (language === '' && (cmd === 'install' || cmd === 'update')) {
    console.error('usage: --language requires a value (e.g. --language "Portuguese (pt-BR)")');
    process.exitCode = 2;
    return;
  }
  const noShim = args.includes('--no-shim');
  switch (cmd) {
    case 'install': {
      if (!ensureGhStack()) {
        console.error('gh-stack unavailable: install the GitHub CLI (gh) and try again.');
        process.exitCode = 1;
        return;
      }
      const artifactsLanguage = language ?? await promptArtifactsLanguage();
      const result = install(process.cwd(), { noAgents, noAgentBrowser, noHooks, noSuperpowers, noProfile, noCodegraph, noOutputStyle, noShim, artifactsLanguage });
      console.log('bento installed:');
      console.log(`  skill → ${result.skillDir}`);
      console.log(`  lib   → ${result.dotBento}`);
      if (result.bentoConfig.migrated) {
        console.log('  config → .pr-limits.yaml merged into .bento.yaml');
      }
      if (result.bentoConfig.changed) {
        console.log(`  artifacts language → ${result.bentoConfig.language} (.bento.yaml)`);
      }
      if (!noHooks) {
        const h = setupPrePushHook(process.cwd());
        if (h.status === 'installed') console.log('  pre-push → core.hooksPath (.bento/hooks)');
      } else if (bentoHooksActive(process.cwd())) {
        console.error('warning: pre-push still active from a previous install (core.hooksPath → .bento/hooks); run update without --no-hooks to refresh the hook, or uninstall to remove it.');
      }
      if (result.vendoredSkills.installed.length > 0) {
        console.log(`  superpowers → ${result.vendoredSkills.installed.length} vendored skills`);
      }
      if (result.agents.created.length > 0) {
        console.log(`  agents → ${result.agents.created.map((n) => `${n}.md`).join(', ')}`);
      }
      if (result.agents.obsolete.length > 0) {
        console.error(`warning: obsolete agents from an older install: ${result.agents.obsolete.map((n) => `${n}.md`).join(', ')}; delete them by hand.`);
      }
      if (!noProfile && hasBentoAgent(process.cwd(), 'flash')) {
        const da = setDefaultAgentIfAbsent(process.cwd());
        if (da && da.changed) console.log(`  default_agent → flash (${da.path})`);
      }
      if (!noSuperpowers) {
        const sp = removeSuperpowersPlugin(process.cwd());
        if (sp) console.log(`  superpowers → plugin removed (${sp.path})`);
      }
      if (!noPonytail) {
        const pt = addPonytailPlugin(process.cwd());
        if (pt) console.log(`  ponytail → ${pt.path}`);
      }
      if (!noOutputStyle) {
        const st = addInstructionsEntry(process.cwd());
        if (st) console.log(`  instructions → ${OUTPUT_STYLE_INSTRUCTIONS}`);
      }
      if (!noCodegraph) {
        ensureCodegraph();
        const cg = addMcpServer(process.cwd(), CODEGRAPH_MCP.name, CODEGRAPH_MCP.command);
        if (cg) console.log(`  codegraph → ${cg.path}`);
        if (initCodegraph(process.cwd())) console.log('  codegraph init → .codegraph/');
      }
      if (!noAgentBrowser) {
        ensureAgentBrowser();
        const ab = addMcpServer(process.cwd(), AGENT_BROWSER_MCP.name, AGENT_BROWSER_MCP.command);
        if (ab) console.log(`  agent-browser → ${ab.path}`);
      }
      return;
    }
    case 'update': {
      const result = install(process.cwd(), { noAgents, noAgentBrowser, noHooks, noSuperpowers, noProfile, noCodegraph, noOutputStyle, noShim, artifactsLanguage: language });
      if (result.bentoConfig.migrated) {
        console.log('  config → .pr-limits.yaml merged into .bento.yaml');
      }
      if (result.bentoConfig.changed) {
        console.log(`  artifacts language → ${result.bentoConfig.language} (.bento.yaml)`);
      }
      if (!noHooks) {
        const h = setupPrePushHook(process.cwd());
        if (h.status === 'installed') console.log('  pre-push → core.hooksPath (.bento/hooks)');
      } else if (bentoHooksActive(process.cwd())) {
        console.error('warning: pre-push still active from a previous install (core.hooksPath → .bento/hooks); run update without --no-hooks to refresh the hook, or uninstall to remove it.');
      }
      if (result.vendoredSkills.installed.length > 0) {
        console.log(`  superpowers → ${result.vendoredSkills.installed.length} vendored skills`);
      }
      if (result.agents.created.length > 0) {
        console.log(`  agents → ${result.agents.created.map((n) => `${n}.md`).join(', ')}`);
      }
      if (result.agents.obsolete.length > 0) {
        console.error(`warning: obsolete agents from an older install: ${result.agents.obsolete.map((n) => `${n}.md`).join(', ')}; delete them by hand.`);
      }
      if (!noProfile && hasBentoAgent(process.cwd(), 'flash')) {
        const da = setDefaultAgentIfAbsent(process.cwd());
        if (da && da.changed) console.log(`  default_agent → flash (${da.path})`);
      }
      if (!noSuperpowers) {
        const sp = removeSuperpowersPlugin(process.cwd());
        if (sp) console.log(`  superpowers → plugin removed (${sp.path})`);
      }
      if (!noPonytail) {
        const pt = addPonytailPlugin(process.cwd());
        if (pt) console.log(`  ponytail → ${pt.path}`);
      }
      if (!noOutputStyle) {
        const st = addInstructionsEntry(process.cwd());
        if (st) console.log(`  instructions → ${OUTPUT_STYLE_INSTRUCTIONS}`);
      }
      if (!noCodegraph) {
        const cg = addMcpServer(process.cwd(), CODEGRAPH_MCP.name, CODEGRAPH_MCP.command);
        if (cg) console.log(`  codegraph → ${cg.path}`);
      }
      if (!noAgentBrowser) {
        const ab = addMcpServer(process.cwd(), AGENT_BROWSER_MCP.name, AGENT_BROWSER_MCP.command);
        if (ab) console.log(`  agent-browser → ${ab.path}`);
      }
      console.log('bento updated.');
      return;
    }
    case 'uninstall': {
      const { removed } = uninstall(process.cwd());
      if (removed.includes('.opencode/agents/flash.md')) {
        const da = removeDefaultAgentIf(process.cwd());
        if (da) removed.push('default_agent');
      }
      const h = removePrePushHook(process.cwd());
      const sp = removeSuperpowersPlugin(process.cwd());
      const pt = removePonytailPlugin(process.cwd());
      const st = removeInstructionsEntry(process.cwd());
      const cg = removeMcpServer(process.cwd(), CODEGRAPH_MCP.name);
      const ab = removeMcpServer(process.cwd(), AGENT_BROWSER_MCP.name);
      const all = [...removed];
      if (sp) all.push(`superpowers (${sp.path})`);
      if (pt) all.push(`ponytail (${pt.path})`);
      if (st) all.push(`instructions (${st.path})`);
      if (cg) all.push(`codegraph (${cg.path})`);
      if (ab) all.push(`agent-browser (${ab.path})`);
      if (h) all.push('pre-push (core.hooksPath)');
      const cgIndex = join(process.cwd(), '.codegraph');
      if (existsSync(cgIndex)) {
        rmSync(cgIndex, { recursive: true, force: true });
        all.push('.codegraph');
      }
      if (all.length === 0) {
        console.log('bento: nothing to remove.');
      } else {
        console.log('bento uninstalled:');
        for (const path of all) console.log(`  removed: ${path}`);
      }
      console.log('  kept: global tools (gh-stack, codegraph, agent-browser) — remove manually if unused');
      return;
    }
    case 'check':
      process.exitCode = runCheck({ base: args[0] ?? 'main', head: args[1] ?? 'HEAD', cwd: process.cwd() });
      return;
    case 'equivalence':
      process.exitCode = runEquivalence({ base: args[0], head: args[1], layers: args.slice(2), cwd: process.cwd() });
      return;
    default:
      console.error(`usage: bento install|update|uninstall|check|equivalence
  install          installs the skill, scripts, config, pre-push hook, gh-stack, vendored superpowers skills, agents, ponytail, codegraph, agent-browser, and the output style (instructions) into the project
                   (.bento.yaml holds the PR limits and the artifact language; a legacy .pr-limits.yaml is merged into it;
                    --language "<value>" sets the artifact language in .bento.yaml; skips the interactive prompt; on a TTY, install asks for it when .bento.yaml is missing;
                    --no-agents skips AGENTS.md; --no-superpowers skips vendored skills (does not touch the plugin);
                    --no-profile skips bento profile agents and default_agent; --no-ponytail skips ponytail;
                    --no-hooks skips pre-push; --no-shim skips the scripts/pr-split-verify.mjs shim;
                    --no-codegraph skips codegraph; --no-agent-browser skips agent-browser;
                    --no-output-style skips the i-have-adhd skill and the instructions entry (does not revoke a previous install; use uninstall to remove))
  update           re-installs keeping .bento.yaml (does not touch gh-stack; does not reinstall CLIs or re-index codegraph; never prompts for the artifact language)
  uninstall        removes everything bento added to the project (.bento, skills, agents, shim, config, pre-push, plugins, output style, mcp, .codegraph, AGENTS.md section);
                   global tools (gh-stack, codegraph, agent-browser) are shared and stay installed
  check [base]     validates diff size (head = HEAD, base default = main)
  equivalence <base> <head> <layer1> [layer2 ...]
`);
      process.exitCode = 2;
  }
}

await run();
