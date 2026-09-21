import { test } from "node:test";
import assert from "node:assert/strict";
import { createFundQuotaSource, createIndexSource, createMonthlyQuoteSource, createQuoteSources } from "./index.ts";

test("registro inclui AV só com chave e BCB como fonte de índices", async () => {
  assert.deepEqual(createQuoteSources({}).map((source) => source.id), ["yahoo"]);
  assert.deepEqual(createQuoteSources({ alphaVantageApiKey: "chave" }).map((source) => source.id), ["yahoo", "alphavantage"]);
  assert.equal(createIndexSource({}).id, "bcb");
  assert.equal(createFundQuotaSource({}).id, "cvm-swb");
  assert.equal(createMonthlyQuoteSource({}).id, "alphavantage");
  assert.equal(await createMonthlyQuoteSource({}).available(), false);
});

test("createFundQuotaSource reusa o singleton sem deps e cria instância nova com fetchImpl injetado", () => {
  const primeira = createFundQuotaSource({});
  assert.equal(createFundQuotaSource({}), primeira);
  assert.equal(primeira.id, "cvm-swb");
  const injetada = createFundQuotaSource({ fetchImpl: async () => new Response("") });
  assert.notEqual(injetada, primeira);
  assert.equal(injetada.id, "cvm-swb");
});
