import { test } from "node:test";
import assert from "node:assert/strict";
import { accumulatePct, gapPp, monthlyPortfolioPct, monthsBeaten, mwrPct } from "./performance.ts";

test("monthlyPortfolioPct desconta aporte e resgate e devolve null com base 0", () => {
  // (103000 − 100000 − 2000 + 0) / 100000 = 1%
  assert.equal(monthlyPortfolioPct(100_000n, 103_000n, 2_000n, 0n), 1);
  // (97500 − 100000 − 0 + 500) / 100000 = −2%
  assert.equal(monthlyPortfolioPct(100_000n, 97_500n, 0n, 500n), -2);
  assert.equal(monthlyPortfolioPct(0n, 10_000n, 0n, 0n), null);
});

test("accumulatePct compõe, ignora null e devolve 0 vazio", () => {
  assert.equal(accumulatePct([1, 1]), 2.01);
  assert.equal(accumulatePct([null, 1, null]), 1);
  assert.equal(accumulatePct([]), 0);
  assert.equal(accumulatePct([10, -10]), -1);
});

test("mwrPct acha a TIR mensal e devolve null sem fluxo", () => {
  // −100000 + 110000/(1+r) = 0 → r = 10% no mês
  assert.equal(mwrPct([-100_000n, 110_000n]), 10);
  // −100000 + 0/(1+r) + 105000/(1+r)² ... fluxo no período 1 → 5%
  assert.equal(mwrPct([-100_000n, 105_000n, 0n]), 5);
  assert.equal(mwrPct([0n, 0n]), null);
  assert.equal(mwrPct([]), null);
});

test("monthsBeaten ignora empate e nulos; gapPp desconta", () => {
  assert.equal(monthsBeaten([
    { portfolioPct: 1.2, cdiPct: 1.0 },
    { portfolioPct: 1.0, cdiPct: 1.0 },
    { portfolioPct: null, cdiPct: 1.0 },
    { portfolioPct: 0.9, cdiPct: 1.0 },
  ]), 1);
  assert.equal(gapPp(14.14, 14.01), 0.13);
  assert.equal(gapPp(1, 1.5), -0.5);
});
