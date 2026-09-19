import { test } from "node:test";
import assert from "node:assert/strict";
import { createAlphaVantageSource } from "./alphavantage.ts";

const fixture = {
  "Time Series (Daily)": {
    "2025-09-19": { "4. close": "11.2500" },
    "2025-09-17": { "4. close": "10.5000" },
  },
};

test("alphavantage converte close string e filtra a janela", async () => {
  const source = createAlphaVantageSource({
    apiKey: "chave",
    fetchImpl: async (url) => {
      assert.match(url, /WRLD11\.SAO/);
      assert.match(url, /outputsize=full/);
      return new Response(JSON.stringify(fixture), { status: 200 });
    },
  });
  assert.equal(await source.available(), true);
  const quotes = await source.fetchDaily(["WRLD11"], "2025-09-18", "2025-09-30");
  assert.deepEqual(quotes, [{ ticker: "WRLD11", date: "2025-09-19", closeCents: 1125n }]);
});

test("alphavantage sem chave não está disponível e recusa fetch", async () => {
  const source = createAlphaVantageSource({ apiKey: "" });
  assert.equal(await source.available(), false);
  await assert.rejects(() => source.fetchDaily(["WRLD11"], "2025-09-01", "2025-09-30"), /sem chave/);
});

test("alphavantage trata Note/Information como erro", async () => {
  const source = createAlphaVantageSource({
    apiKey: "chave",
    fetchImpl: async () => new Response(JSON.stringify({ Note: "Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day." }), { status: 200 }),
  });
  await assert.rejects(() => source.fetchDaily(["WRLD11"], "2025-09-01", "2025-09-30"), /alphavantage recusou WRLD11/);
});
