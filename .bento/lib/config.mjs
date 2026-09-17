import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULTS = { maxLines: 400, maxFiles: 10, overrides: [] };

export function parseLimitsYaml(text) {
  const result = { maxLines: DEFAULTS.maxLines, maxFiles: DEFAULTS.maxFiles, overrides: [] };
  for (const line of text.split('\n')) {
    const top = line.match(/^([a-z_]+):\s*(\d+)/);
    if (top && (top[1] === 'max_lines' || top[1] === 'max_files')) {
      result[top[1] === 'max_lines' ? 'maxLines' : 'maxFiles'] = Number(top[2]);
    }
  }
  let current = null;
  for (const line of text.split('\n')) {
    const item = line.match(/^\s*-\s+glob:\s*["']?([^"'\s]+)["']?\s*$/);
    if (item) {
      current = { glob: item[1], maxLines: null };
      result.overrides.push(current);
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^\s+max_lines:\s*(\d+)/);
    if (kv) current.maxLines = Number(kv[1]);
  }
  return result;
}

export function parseArtifactsLanguage(text) {
  const m = /^artifacts_language:\s*(.+?)\s*$/m.exec(text);
  return m ? m[1] : null;
}

export function loadArtifactsLanguage(projectRoot) {
  const file = join(projectRoot, '.bento.yaml');
  if (!existsSync(file)) return null;
  return parseArtifactsLanguage(readFileSync(file, 'utf8'));
}

export function loadLimits(projectRoot) {
  const file = join(projectRoot, '.bento.yaml');
  const legacy = join(projectRoot, '.pr-limits.yaml');
  const chosen = existsSync(file) ? file : legacy;
  if (!existsSync(chosen)) return { ...DEFAULTS, overrides: [] };
  return parseLimitsYaml(readFileSync(chosen, 'utf8'));
}

export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = escaped.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]');
  return new RegExp(`^${re}$`);
}

export function matchesOverride(path, override) {
  return globToRegExp(override.glob).test(path);
}
