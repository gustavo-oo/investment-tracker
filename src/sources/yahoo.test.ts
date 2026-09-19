import { test } from "node:test";
import assert from "node:assert/strict";
import { createYahooSource, type YahooChartResponse } from "./yahoo.ts";

const fixture: YahooChartResponse = {
  chart: {
    result: [{
      timestamp: [1758114000, 1758200400, 1758286800],
      indicators: { quote: [{ close: [10.5, null, 11.25] }] },
    }],
    error: null,
  },
};

test("yahoo converte timestamps em data BRT e ignora close nulo", async () => {
  const source = createYahooSource({
    fetchImpl: async (url) => {
      assert.match(url, /WRLD11\.SA/);
      assert.match(url, /interval=1d/);
      return new Response(JSON.stringify(fixture), { status: 200 });
    },
  });
  const quotes = await source.fetchDaily(["WRLD11"], "2025-09-01", "2025-09-30");
  assert.deepEqual(quotes, [
    { ticker: "WRLD11", date: "2025-09-17", closeCents: 1050n },
    { ticker: "WRLD11", date: "2025-09-19", closeCents: 1125n },
  ]);
});

test("yahoo rejeita HTTP ruim e chart.error", async () => {
  const bad = createYahooSource({ fetchImpl: async () => new Response("nope", { status: 502 }) });
  await assert.rejects(() => bad.fetchDaily(["WRLD11"], "2025-09-01", "2025-09-30"), /yahoo HTTP 502/);

  const errored = createYahooSource({
    fetchImpl: async () => new Response(JSON.stringify({ chart: { result: null, error: { description: "No data found" } } }), { status: 200 }),
  });
  await assert.rejects(() => errored.fetchDaily(["WRLD11"], "2025-09-01", "2025-09-30"), /yahoo erro para WRLD11: No data found/);
});
