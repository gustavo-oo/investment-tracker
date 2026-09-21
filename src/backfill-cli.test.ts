import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const run = (args: string[]) =>
  spawnSync(process.execPath, ["src/backfill-cli.ts", ...args], { encoding: "utf8" });

test("backfill-cli sem args mostra o uso", () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /uso: npm run backfill/);
});

test("backfill-cli valida formato das datas com erro de uma linha", () => {
  const result = run(["--ticker", "B5P211", "--from", "2025-4-1", "--to", "2025-05-01"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "from/to devem ser YYYY-MM-DD");
});

test("backfill-cli rejeita ticker inválido", () => {
  const result = run(["--ticker", "B5 P211", "--from", "2025-04-01", "--to", "2025-05-01"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "ticker inválido: B5 P211");
});
