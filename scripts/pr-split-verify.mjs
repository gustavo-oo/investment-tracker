#!/usr/bin/env node
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
