import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryFromLegacy, kindFromLegacy, normalizeLegacyId, slugify } from "./catalog.ts";

test("rótulos do legado viram slugs", () => {
  assert.equal(kindFromLegacy("Renda Fixa"), "fixed_income");
  assert.equal(kindFromLegacy("Renda Variável"), "equity");
  assert.equal(kindFromLegacy("Previdência PGBL"), "pension");
  assert.equal(categoryFromLegacy("CDB"), "cdb");
  assert.equal(categoryFromLegacy("LCA"), "lca");
  assert.equal(categoryFromLegacy("Selic"), "selic");
  assert.equal(categoryFromLegacy("ETF - Renda Fixa"), "etf_fixed");
  assert.equal(categoryFromLegacy("ETF - Renda Variável"), "etf_equity");
  assert.equal(categoryFromLegacy("IPCA - Previdência"), "pension_ipca");
  assert.throws(() => kindFromLegacy("Cripto"));
});

test("slugify gera id estável sem acento", () => {
  assert.equal(slugify("CDB Liquidez Diária 106%:  26-02"), "cdb-liquidez-diaria-106-26-02");
  assert.equal(slugify("B5P211"), "b5p211");
});

test("normalizeLegacyId remove sufixo numérico .0", () => {
  assert.equal(normalizeLegacyId("253210.0"), "253210");
  assert.equal(normalizeLegacyId("253210"), "253210");
  assert.equal(normalizeLegacyId("CDB X:  01-01-30"), "CDB X:  01-01-30");
});
