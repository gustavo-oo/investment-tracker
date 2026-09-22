import { test } from "node:test";
import assert from "node:assert/strict";
import { accumulatePct, gapPp, monthlyPortfolioPct, monthsBeaten, realReturnPct, xirrPct } from "./performance.ts";

test("monthlyPortfolioPct desconta fluxos e devolve null sem base", () => {
  // sem fluxos: (103000 − 100000) / 100000 = 3%
  assert.equal(monthlyPortfolioPct(100_000n, "2025-04-30", 103_000n, "2025-05-31", []), 3);
  // aporte no último dia do mês pesa 0: (103000 − 100000 − 2000) / 100000 = 1%
  assert.equal(monthlyPortfolioPct(100_000n, "2025-04-30", 103_000n, "2025-05-31", [{ date: "2025-05-31", cents: 2_000n }]), 1);
  // resgate no último dia do mês: (97500 − 100000 + 500) / 100000 = −2%
  assert.equal(monthlyPortfolioPct(100_000n, "2025-04-30", 97_500n, "2025-05-31", [{ date: "2025-05-31", cents: -500n }]), -2);
  assert.equal(monthlyPortfolioPct(0n, "2025-04-30", 10_000n, "2025-05-31", []), null);
});

test("monthlyPortfolioPct pondera o fluxo pelos dias investidos", () => {
  // caso real de mai/2025: base 5761702, aportes em 05/05 (729476), 06/05 (708391) e 07/05 (3470542)
  assert.equal(monthlyPortfolioPct(5_761_702n, "2025-04-30", 10_786_488n, "2025-05-31", [
    { date: "2025-05-05", cents: 729_476n },
    { date: "2025-05-06", cents: 708_391n },
    { date: "2025-05-07", cents: 3_470_542n },
  ]), 1.2083); // era 2.0198 no método antigo
  // resgate no meio do mês reduz o denominador
  assert.equal(monthlyPortfolioPct(100_000n, "2025-04-30", 98_000n, "2025-05-31", [{ date: "2025-05-10", cents: -5_000n }]), 3.1052);
  // mês corrente parcial: base 31/08, valor em 22/09, aporte em 17/09 (5 de 22 dias)
  assert.equal(monthlyPortfolioPct(100_000n, "2025-08-31", 112_000n, "2025-09-22", [{ date: "2025-09-17", cents: 10_000n }]), 1.9556);
  // resgate que zera a base no meio do mês → null
  assert.equal(monthlyPortfolioPct(100_000n, "2025-04-30", 0n, "2025-05-31", [{ date: "2025-05-02", cents: -110_000n }]), null);
});

test("accumulatePct compõe, ignora null e devolve 0 vazio", () => {
  assert.equal(accumulatePct([1, 1]), 2.01);
  assert.equal(accumulatePct([null, 1, null]), 1);
  assert.equal(accumulatePct([]), 0);
  assert.equal(accumulatePct([10, -10]), -1);
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

test("realReturnPct desconta a inflação composta", () => {
  assert.equal(realReturnPct(10, 10), 0);
  assert.equal(realReturnPct(0, 5), -4.7619);      // 1 ÷ 1,05 − 1
  assert.equal(realReturnPct(10, -10), 22.2222);   // 1,1 ÷ 0,9 − 1
  assert.equal(realReturnPct(19.3138, 4.63), 14.034); // janela real jun/2025–set/2026
});

test("xirrPct acha a TIR anual (ACT/365) e devolve null sem raiz", () => {
  // 100000 → 110000 em 365 dias = 10% a.a.
  assert.equal(xirrPct(100_000n, "2025-01-01", [], 110_000n, "2026-01-01"), 10);
  // aporte de 50000 em 01/07 pesa no meio do caminho
  assert.equal(xirrPct(100_000n, "2025-01-01", [{ date: "2025-07-01", cents: 50_000n }], 165_000n, "2026-01-01"), 12.0487);
  // perda extrema fica fora do intervalo [−0,9; 10] → null
  assert.equal(xirrPct(100_000n, "2025-01-01", [], 5_000n, "2026-01-01"), null);
  // nada investido → null
  assert.equal(xirrPct(0n, "2025-01-01", [], 0n, "2026-01-01"), null);
  // resgate no meio do caminho (fluxo negativo): 100k −20k em 01/07 → 90k em 01/01
  assert.equal(xirrPct(100_000n, "2025-01-01", [{ date: "2025-07-01", cents: -20_000n }], 90_000n, "2026-01-01"), 11.0889);
  // perda simples em 365 dias
  assert.equal(xirrPct(100_000n, "2025-01-01", [], 90_000n, "2026-01-01"), -10);
});
