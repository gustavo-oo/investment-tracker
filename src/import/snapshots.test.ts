import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { decodeLegacySnapshot, parseLegacyHistory } from "./snapshots.ts";

test("decodeLegacySnapshot descomprime GZIP+Base64 do legado", () => {
  const original = [{ id: "CDB X", value: -35.19622208182556 }, { id: "WRLD11", value: 100.5, nShares: 12 }];
  const base64 = gzipSync(Buffer.from(JSON.stringify(original))).toString("base64");
  assert.deepEqual(decodeLegacySnapshot(base64), original);
  assert.deepEqual(decodeLegacySnapshot(""), []);
});

test("parseLegacyHistory converte cada mês para centavos e ignora linhas vazias", () => {
  const gzip = gzipSync(Buffer.from(JSON.stringify([
    { id: "CDB X", value: -35.19622208182556 },
    { id: "WRLD11", value: 100.5, nShares: 12.3 },
  ]))).toString("base64");
  const csv = `Mês/Ano,Investimentos acumulados (GZIP + Base64)\n2026-09-01 00:00:00,"${gzip}"\n2027-01-01 00:00:00,\n`;
  const rows = parseLegacyHistory(csv);
  assert.deepEqual(rows, [
    { month: "2026-09-01", legacyKey: "CDB X", valueCents: -3520n, sharesE8: null },
    { month: "2026-09-01", legacyKey: "WRLD11", valueCents: 10050n, sharesE8: 1230000000n },
  ]);
});
