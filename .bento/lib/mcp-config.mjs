import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CODEGRAPH_MCP = { name: 'codegraph', command: ['codegraph', 'serve', '--mcp'] };
export const AGENT_BROWSER_MCP = { name: 'agent-browser', command: ['agent-browser', 'mcp'] };

function configPath(projectRoot) {
  const json = join(projectRoot, 'opencode.json');
  if (existsSync(json)) return json;
  const jsonc = join(projectRoot, 'opencode.jsonc');
  if (existsSync(jsonc)) return jsonc;
  return json;
}

function entryText(name, command) {
  const cmd = JSON.stringify(command);
  return `"${name}": {\n      "type": "local",\n      "command": ${cmd},\n      "enabled": true\n    }`;
}

function freshObject(name, command) {
  return `{\n  "mcp": {\n    ${entryText(name, command)}\n  }\n}\n`;
}

function mcpBlockOpen(raw, keyMatch) {
  const rest = raw.slice(keyMatch.index + keyMatch[0].length);
  if (!/^\s*\{/.test(rest)) return -1;
  return keyMatch.index + keyMatch[0].length + /^\s*/.exec(rest)[0].length;
}

function matchingBrace(raw, openIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function addMcpServer(projectRoot, name, command) {
  const path = configPath(projectRoot);
  let raw = null;
  if (existsSync(path)) {
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      console.error(`warning: could not read ${path}: mcp ${name} skipped.`);
      return null;
    }
  }
  const server = { type: 'local', command, enabled: true };
  if (raw === null || raw.trim() === '') {
    writeFileSync(path, freshObject(name, command));
    return { changed: name, path };
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    if (!path.endsWith('.jsonc')) {
      console.error('warning: opencode.json is not a valid JSON object: mcp skipped.');
      return null;
    }
    return addJsoncText(path, raw, name, server);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    console.error('warning: opencode.json is not a JSON object: mcp skipped.');
    return null;
  }
  let mcp = obj.mcp;
  if (mcp === undefined) mcp = obj.mcp = {};
  else if (typeof mcp !== 'object' || Array.isArray(mcp)) {
    console.error('warning: "mcp" in opencode.json is not an object: mcp skipped.');
    return null;
  }
  if (mcp[name] !== undefined) return null;
  mcp[name] = server;
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
  return { changed: name, path };
}

function addJsoncText(path, raw, name, server) {
  const entry = entryText(name, server.command);
  const keyMatch = /"mcp"\s*:/m.exec(raw);
  if (!keyMatch) {
    const brace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (brace === -1 || lastBrace <= brace) {
      console.error('warning: opencode.json does not look like a JSON object: mcp skipped.');
      return null;
    }
    const middle = raw.slice(brace + 1, lastBrace);
    const block = `\n  "mcp": {\n    ${entry}\n  }`;
    const updated = raw.slice(0, brace + 1) + block + (middle.trim() ? ',' : '\n') + middle + raw.slice(lastBrace);
    writeFileSync(path, updated);
    return { changed: name, path };
  }
  const open = mcpBlockOpen(raw, keyMatch);
  if (open === -1) {
    console.error('warning: "mcp" in opencode.json is not an object: mcp skipped.');
    return null;
  }
  const close = matchingBrace(raw, open);
  if (close === -1) {
    console.error('warning: "mcp" in opencode.json does not close the block: mcp skipped.');
    return null;
  }
  const inside = raw.slice(open + 1, close);
  if (new RegExp(`"${name}"\\s*:`).test(inside)) return null;
  const rebuilt = `"mcp": {${inside}${inside.trim() !== '' ? ',' : ''}\n    ${entry}\n  }`;
  writeFileSync(path, raw.slice(0, keyMatch.index) + rebuilt + raw.slice(close + 1));
  return { changed: name, path };
}

export function removeMcpServer(projectRoot, name) {
  const path = configPath(projectRoot);
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error(`warning: could not read ${path}: mcp ${name} skipped.`);
    return null;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    if (!path.endsWith('.jsonc')) {
      console.error('warning: opencode.json is not a valid JSON object: mcp skipped.');
      return null;
    }
    return removeJsoncText(path, raw, name);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const mcp = obj.mcp;
  if (mcp === undefined) return null;
  if (typeof mcp !== 'object' || Array.isArray(mcp)) {
    console.error('warning: "mcp" in opencode.json is not an object: mcp skipped.');
    return null;
  }
  if (mcp[name] === undefined) return null;
  delete mcp[name];
  if (Object.keys(mcp).length === 0) delete obj.mcp;
  if (Object.keys(obj).length === 0) {
    if (path.endsWith('.jsonc')) {
      writeFileSync(path, '{}\n');
    } else {
      rmSync(path, { force: true });
    }
  } else {
    writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
  }
  return { removed: name, path };
}

function removeJsoncText(path, raw, name) {
  const keyMatch = /"mcp"\s*:/m.exec(raw);
  if (!keyMatch) {
    const brace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (brace === -1 || lastBrace <= brace) {
      console.error('warning: opencode.json does not look like a JSON object: mcp skipped.');
    }
    return null;
  }
  const open = mcpBlockOpen(raw, keyMatch);
  if (open === -1) {
    console.error('warning: "mcp" in opencode.json is not an object: mcp skipped.');
    return null;
  }
  const close = matchingBrace(raw, open);
  if (close === -1) {
    console.error('warning: "mcp" in opencode.json does not close the block: mcp skipped.');
    return null;
  }
  const inside = raw.slice(open + 1, close);
  const entryStart = new RegExp(`"${name}"\\s*:`).exec(inside);
  if (!entryStart) return null;
  const afterKey = inside.slice(entryStart.index + entryStart[0].length);
  const entryOpen = entryStart.index + entryStart[0].length + /^\s*/.exec(afterKey)[0].length;
  if (inside[entryOpen] !== '{') return null;
  const entryClose = matchingBrace(inside, entryOpen);
  if (entryClose === -1) return null;
  let removeEnd = entryClose + 1;
  const trailing = /^(\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)?\s*[,\s]*)/.exec(inside.slice(removeEnd));
  if (trailing) removeEnd += trailing[1].length;
  const newInside = (inside.slice(0, entryStart.index) + inside.slice(removeEnd)).replace(/,\s*$/, '').trim();
  if (newInside === '') {
    const prefix = raw.slice(0, keyMatch.index);
    const suffix = raw.slice(close + 1);
    const suffixHadComma = /^,/.test(suffix);
    const after = suffix.replace(/^,\s*/, '');
    const prefixClean = suffixHadComma
      ? prefix
      : prefix.replace(/,\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)?\s*$/, (_m, comment) => (comment ? ` ${comment}` : ''));
    writeFileSync(path, prefixClean + after);
  } else {
    writeFileSync(path, raw.slice(0, keyMatch.index) + `"mcp": {${newInside}\n  }` + raw.slice(close + 1));
  }
  return { removed: name, path };
}
