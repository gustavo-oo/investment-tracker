import { test } from "node:test";
import assert from "node:assert/strict";
import { cdiMonthPct, ipcaMonthPct } from "./evolution.ts";

test("cdiMonthPct acumula os fatores do mês e devolve null sem dado", () => {
  const rates = [
    { date: "2026-01-02", valueE12: 1_000_000_000n },
    { date: "2026-01-05", valueE12: 1_000_000_000n },
    { date: "2026-02-02", valueE12: 500_000_000n },
  ];
  assert.equal(cdiMonthPct(rates, "2026-01"), 0.2001);
  assert.equal(cdiMonthPct(rates, "2026-02"), 0.05);
  assert.equal(cdiMonthPct(rates, "2026-03"), null);
});

test("ipcaMonthPct converte a fração do mês em %", () => {
  const rates = [{ date: "2026-01-01", valueE12: 4_200_000_000n }];
  assert.equal(ipcaMonthPct(rates, "2026-01"), 0.42);
  assert.equal(ipcaMonthPct(rates, "2026-02"), null);
});
