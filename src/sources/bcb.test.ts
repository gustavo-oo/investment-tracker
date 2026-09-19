import { test } from "node:test";
import assert from "node:assert/strict";
import { createBcbSource } from "./bcb.ts";

test("bcb converte dd/mm/yyyy e % em fração e12", async () => {
  const source = createBcbSource({
    fetchImpl: async (url) => {
      assert.match(url, /bcdata\.sgs\.12/);
      assert.match(url, /dataInicial=01\/01\/2026/);
      return new Response(JSON.stringify([
        { data: "02/01/2026", valor: "0.0524" },
        { data: "05/01/2026", valor: "0.0525" },
      ]), { status: 200 });
    },
  });
  const rates = await source.fetchSeries("CDI", "2026-01-01", "2026-01-31");
  assert.deepEqual(rates, [
    { series: "CDI", date: "2026-01-02", valueE12: 524_000_000n },
    { series: "CDI", date: "2026-01-05", valueE12: 525_000_000n },
  ]);
});

test("bcb rejeita resposta que não é lista", async () => {
  const source = createBcbSource({ fetchImpl: async () => new Response(JSON.stringify({ erro: true }), { status: 200 }) });
  await assert.rejects(() => source.fetchSeries("IPCA", "2026-01-01", "2026-01-31"), /bcb resposta inesperada para IPCA/);
});
