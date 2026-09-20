import { test } from "node:test";
import assert from "node:assert/strict";
import { createFundQuotaSource, createIndexSource, createQuoteSources } from "./index.ts";

test("registro inclui AV só com chave e BCB como fonte de índices", () => {
  assert.deepEqual(createQuoteSources({}).map((source) => source.id), ["yahoo"]);
  assert.deepEqual(createQuoteSources({ alphaVantageApiKey: "chave" }).map((source) => source.id), ["yahoo", "alphavantage"]);
  assert.equal(createIndexSource({}).id, "bcb");
  assert.equal(createFundQuotaSource({}).id, "cvm-swb");
});
