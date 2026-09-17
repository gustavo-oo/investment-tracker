import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SUPERPOWERS_PLUGIN = 'superpowers@git+https://github.com/obra/superpowers.git';
export const PONYTAIL_PLUGIN = '@dietrichgebert/ponytail';
export const OUTPUT_STYLE_INSTRUCTIONS = '.opencode/instructions/i-have-adhd.md';

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pluginLabel(pluginId) {
  if (pluginId.startsWith('@')) return pluginId.slice(pluginId.lastIndexOf('/') + 1);
  const at = pluginId.indexOf('@');
  return at === -1 ? pluginId : pluginId.slice(0, at);
}

function entryRe(entry, exact = false) {
  if (exact) return new RegExp(`"${escapeRe(entry)}"[,\\s]*`);
  return new RegExp(`"${escapeRe(entry)}[^"]*"[,\\s]*`);
}

function entryRemoveRe(entry, exact = false) {
  if (exact) return new RegExp(`"${escapeRe(entry)}"[,\\s]*(?:\\s*(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/))?[,\\s]*`, 'g');
  return new RegExp(`"${escapeRe(entry)}[^"]*"[,\\s]*(?:\\s*(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/))?[,\\s]*`, 'g');
}

function maskComments(raw) {
  const out = raw.split('');
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '"') {
      i += 1;
      while (i < raw.length) {
        if (raw[i] === '\\') {
          i += 2;
        } else if (raw[i] === '"') {
          i += 1;
          break;
        } else {
          i += 1;
        }
      }
      continue;
    }
    if (raw[i] === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (raw[i] === '/' && raw[i + 1] === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) {
        if (raw[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < raw.length) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

function configPath(projectRoot) {
  const json = join(projectRoot, 'opencode.json');
  if (existsSync(json)) return json;
  const jsonc = join(projectRoot, 'opencode.jsonc');
  if (existsSync(jsonc)) return jsonc;
  return json;
}

function freshObject(key, entry) {
  return `{\n  "${key}": ["${entry}"]\n}\n`;
}

function addArrayEntry(projectRoot, key, entry, label, exact = false) {
  const path = configPath(projectRoot);
  let raw = null;
  if (existsSync(path)) {
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      console.error(`warning: could not read ${path}: ${label} skipped.`);
      return null;
    }
  }
  if (raw === null || raw.trim() === '') {
    writeFileSync(path, freshObject(key, entry));
    return { changed: entry, path };
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    if (!path.endsWith('.jsonc')) {
      console.error(`warning: opencode.json is not a valid JSON object: ${label} skipped.`);
      return null;
    }
    return addJsoncText(path, raw, key, entry, label, exact);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    console.error(`warning: opencode.json is not a JSON object: ${label} skipped.`);
    return null;
  }
  let list = obj[key];
  if (list === undefined) list = [];
  else if (typeof list === 'string') list = [list];
  else if (!Array.isArray(list)) {
    console.error(`warning: "${key}" in opencode.json is not an array: ${label} skipped.`);
    return null;
  }
  if (list.some((p) => typeof p === 'string' && (exact ? p === entry : p.startsWith(entry)))) return null;
  obj[key] = [...list, entry];
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
  return { changed: entry, path };
}

export function addPlugin(projectRoot, pluginId) {
  return addArrayEntry(projectRoot, 'plugin', pluginId, pluginLabel(pluginId));
}

export function addInstructionsEntry(projectRoot, entry = OUTPUT_STYLE_INSTRUCTIONS) {
  return addArrayEntry(projectRoot, 'instructions', entry, entry, true);
}

function skipString(raw, i) {
  i += 1;
  while (i < raw.length) {
    if (raw[i] === '\\') i += 2;
    else if (raw[i] === '"') return i + 1;
    else i += 1;
  }
  return i;
}

function arrayEnd(raw, open, skipComments = true) {
  let depth = 0;
  let i = open;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') {
      i = skipString(raw, i);
      continue;
    }
    if (skipComments && ch === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i += 1;
      continue;
    }
    if (skipComments && ch === '/' && raw[i + 1] === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function arrayMatch(raw, masked, key) {
  const m = new RegExp(`"${escapeRe(key)}"\\s*:\\s*\\[`, 'm').exec(masked);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let end = arrayEnd(raw, open);
  if (end === -1) end = arrayEnd(raw, open, false);
  if (end === -1) return null;
  return { index: m.index, 0: raw.slice(m.index, end + 1) };
}

function addJsoncText(path, raw, key, entry, label, exact = false) {
  const masked = maskComments(raw);
  if (new RegExp(`"${escapeRe(key)}"\\s*:`, 'm').test(masked)) {
    const array = arrayMatch(raw, masked, key);
    if (!array) {
      console.error(`warning: "${key}" in opencode.json is not an array: ${label} skipped.`);
      return null;
    }
    const open = array[0].indexOf('[');
    const inside = raw.slice(array.index + open + 1, array.index + array[0].length - 1);
    if (entryRe(entry, exact).test(inside)) return null;
    const hasEntries = inside.trim() !== '';
    const rebuilt = `"${key}": [${inside}${hasEntries ? '\n  ,' : ''}\n    "${entry}"\n  ]`;
    writeFileSync(path, raw.slice(0, array.index) + rebuilt + raw.slice(array.index + array[0].length));
    return { changed: entry, path };
  }
  const brace = masked.indexOf('{');
  const lastBrace = masked.lastIndexOf('}');
  if (brace === -1 || lastBrace <= brace) {
    console.error(`warning: opencode.json does not look like a JSON object: ${label} skipped.`);
    return null;
  }
  const middle = raw.slice(brace + 1, lastBrace);
  const updated = raw.slice(0, brace + 1) + `\n  "${key}": ["${entry}"]` + (middle.trim() ? ',' : '\n') + middle + raw.slice(lastBrace);
  writeFileSync(path, updated);
  return { changed: entry, path };
}

function removeArrayEntry(projectRoot, key, entry, label, exact = false) {
  const path = configPath(projectRoot);
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error(`warning: could not read ${path}: ${label} skipped.`);
    return null;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    if (!path.endsWith('.jsonc')) {
      console.error(`warning: opencode.json is not a valid JSON object: ${label} skipped.`);
      return null;
    }
    return removeJsoncText(path, raw, key, entry, label, exact);
  }
  if (obj === null || typeof obj !== 'object') return null;
  const list = obj[key];
  if (list === undefined) return null;
  if (typeof list !== 'string' && !Array.isArray(list)) {
    console.error(`warning: "${key}" in opencode.json is not an array: ${label} skipped.`);
    return null;
  }
  const items = Array.isArray(list) ? list : [list];
  const kept = items.filter((p) => !(typeof p === 'string' && (exact ? p === entry : p.startsWith(entry))));
  if (kept.length === items.length) return null;
  if (kept.length === 0) {
    delete obj[key];
    if (Object.keys(obj).length === 0) {
      if (path.endsWith('.jsonc')) {
        writeFileSync(path, '{}\n');
      } else {
        rmSync(path, { force: true });
      }
      return { removed: entry, path };
    }
  } else {
    obj[key] = kept;
  }
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
  return { removed: entry, path };
}

export function removePlugin(projectRoot, pluginId) {
  return removeArrayEntry(projectRoot, 'plugin', pluginId, pluginLabel(pluginId));
}

export function removeInstructionsEntry(projectRoot, entry = OUTPUT_STYLE_INSTRUCTIONS) {
  return removeArrayEntry(projectRoot, 'instructions', entry, entry, true);
}

function removeJsoncText(path, raw, key, entry, label, exact = false) {
  const masked = maskComments(raw);
  if (!new RegExp(`"${escapeRe(key)}"\\s*:`, 'm').test(masked)) {
    const brace = masked.indexOf('{');
    const lastBrace = masked.lastIndexOf('}');
    if (brace === -1 || lastBrace <= brace) {
      console.error(`warning: opencode.json does not look like a JSON object: ${label} skipped.`);
    }
    return null;
  }
  const array = arrayMatch(raw, masked, key);
  if (!array) {
    console.error(`warning: "${key}" in opencode.json is not an array: ${label} skipped.`);
    return null;
  }
  const open = array[0].indexOf('[');
  const inside = raw.slice(array.index + open + 1, array.index + array[0].length - 1);
  if (!entryRe(entry, exact).test(inside)) return null;
  const newInside = inside.replace(entryRemoveRe(entry, exact), '').replace(/,\s*$/, '').trim();
  if (newInside === '') {
    const prefix = raw.slice(0, array.index);
    const suffix = raw.slice(array.index + array[0].length);
    const suffixHadComma = /^,/.test(suffix);
    const after = suffix.replace(/^,\s*/, '');
    const prefixClean = suffixHadComma
      ? prefix
      : prefix.replace(/,\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/)?\s*$/, (_m, comment) => (comment ? ` ${comment}` : ''));
    writeFileSync(path, prefixClean + after);
  } else {
    writeFileSync(path, raw.slice(0, array.index) + `"${key}": [${newInside}\n  ]` + raw.slice(array.index + array[0].length));
  }
  return { removed: entry, path };
}

export function addSuperpowersPlugin(projectRoot) {
  return addPlugin(projectRoot, SUPERPOWERS_PLUGIN);
}

export function removeSuperpowersPlugin(projectRoot) {
  return removePlugin(projectRoot, SUPERPOWERS_PLUGIN);
}

export function addPonytailPlugin(projectRoot) {
  return addPlugin(projectRoot, PONYTAIL_PLUGIN);
}

export function removePonytailPlugin(projectRoot) {
  return removePlugin(projectRoot, PONYTAIL_PLUGIN);
}

export const BENTO_DEFAULT_AGENT = 'flash';

export function setDefaultAgentIfAbsent(projectRoot, name = BENTO_DEFAULT_AGENT) {
  const path = configPath(projectRoot);
  let raw = null;
  if (existsSync(path)) {
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      console.error(`warning: could not read ${path}: default_agent skipped.`);
      return null;
    }
  }
  if (raw === null || raw.trim() === '') {
    writeFileSync(path, `{\n  "default_agent": "${name}"\n}\n`);
    return { changed: 'default_agent', path };
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    if (!path.endsWith('.jsonc')) {
      console.error(`warning: opencode.json is not a valid JSON object: default_agent skipped.`);
      return null;
    }
    return setJsoncDefaultAgent(path, raw, name);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    console.error(`warning: opencode.json is not a JSON object: default_agent skipped.`);
    return null;
  }
  if (typeof obj.default_agent === 'string') {
    console.error(`warning: default_agent already set ("${obj.default_agent}"); preserved.`);
    return { skipped: true, value: obj.default_agent };
  }
  if (obj.default_agent !== undefined) {
    console.error(`warning: "default_agent" in opencode.json is not a string: default_agent skipped.`);
    return null;
  }
  obj.default_agent = name;
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
  return { changed: 'default_agent', path };
}

function setJsoncDefaultAgent(path, raw, name) {
  const masked = maskComments(raw);
  if (/"default_agent"\s*:/m.test(masked)) {
    const m = /"default_agent"\s*:\s*"([^"]*)"/m.exec(masked);
    const value = m ? m[1] : '';
    console.error(`warning: default_agent already set ("${value}"); preserved.`);
    return { skipped: true, value };
  }
  const brace = masked.indexOf('{');
  const lastBrace = masked.lastIndexOf('}');
  if (brace === -1 || lastBrace <= brace) {
    console.error('warning: opencode.json does not look like a JSON object: default_agent skipped.');
    return null;
  }
  const middle = raw.slice(brace + 1, lastBrace);
  const updated = raw.slice(0, brace + 1) + `\n  "default_agent": "${name}"` + (middle.trim() ? ',' : '\n') + middle + raw.slice(lastBrace);
  writeFileSync(path, updated);
  return { changed: 'default_agent', path };
}

export function removeDefaultAgentIf(projectRoot, name = BENTO_DEFAULT_AGENT) {
  const path = configPath(projectRoot);
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    console.error(`warning: could not read ${path}: default_agent skipped.`);
    return null;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    if (!path.endsWith('.jsonc')) {
      console.error(`warning: opencode.json is not a valid JSON object: default_agent skipped.`);
      return null;
    }
    return removeJsoncDefaultAgent(path, raw, name);
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (obj.default_agent !== name) return null;
  delete obj.default_agent;
  if (Object.keys(obj).length === 0) {
    if (path.endsWith('.jsonc')) {
      writeFileSync(path, '{}\n');
    } else {
      rmSync(path, { force: true });
    }
    return { removed: 'default_agent', path };
  }
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
  return { removed: 'default_agent', path };
}

function removeJsoncDefaultAgent(path, raw, name) {
  const m = /"default_agent"\s*:\s*"([^"]*)"/m.exec(maskComments(raw));
  if (!m || m[1] !== name) return null;
  const start = m.index;
  const end = m.index + m[0].length;
  const after = raw.slice(end);
  const commaAfter = /^\s*,/.exec(after);
  let before = raw.slice(0, start);
  let rest = raw.slice(end);
  if (commaAfter) {
    rest = after.slice(commaAfter[0].length);
  } else {
    before = before.replace(/,\s*$/, '\n');
  }
  const out = before + rest;
  const onlyIgnorable = out.replace(/[{}\s]/g, '') === '';
  writeFileSync(path, onlyIgnorable ? '{}\n' : out);
  return { removed: 'default_agent', path };
}
