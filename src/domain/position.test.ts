import { test } from "node:test";
import assert from "node:assert/strict";
import { equityValueCents, instrumentValue, pensionValueCents, rfValueCents, type PositionInput } from "./position.ts";

const rate = (date: string) => ({ date, valueE12: 1_000_000_000n }); // 0,1% ao dia

test("RF capitaliza compra D+0 até o asOf", () => {
  const { valueCents } = rfValueCents([{ date: "2026-01-02", grossCents: 100_000n }], [rate("2026-01-02"), rate("2026-01-05")], 1_000_000n, "2026-01-05");
  assert.equal(valueCents, 100_200n); // 100000 × 1,001 × 1,001
});

test("RF venda D−1 zera a posição exatamente", () => {
  const { valueCents } = rfValueCents(
    [{ date: "2026-01-02", grossCents: 100_000n }, { date: "2026-01-05", grossCents: -100_100n }],
    [rate("2026-01-02"), rate("2026-01-05")],
    1_000_000n,
    "2026-01-05",
  );
  assert.equal(valueCents, 0n);
});

test("RF sábado cai na próxima taxa e 106% aplica o multiplicador", () => {
  assert.equal(rfValueCents([{ date: "2026-01-03", grossCents: 100_000n }], [rate("2026-01-05")], 1_000_000n, "2026-01-05").valueCents, 100_100n);
  assert.equal(rfValueCents([{ date: "2026-01-02", grossCents: 100_000n }], [rate("2026-01-02")], 1_060_000n, "2026-01-02").valueCents, 100_106n);
});

test("RV usa último fechamento ≤ asOf e devolve null sem cota", () => {
  const quotes = [{ date: "2026-01-02", closeCents: 1_000n }, { date: "2026-01-05", closeCents: 1_100n }];
  assert.deepEqual(equityValueCents(10_00000000n, quotes, "2026-01-04"), { valueCents: 10_000n, priceCents: 1_000n, priceDate: "2026-01-02" });
  assert.deepEqual(equityValueCents(10_00000000n, quotes, "2026-01-05"), { valueCents: 11_000n, priceCents: 1_100n, priceDate: "2026-01-05" });
  assert.deepEqual(equityValueCents(10_00000000n, [], "2026-01-05"), { valueCents: null, priceCents: null, priceDate: null });
});

test("instrumentValue consolida invested/redeemed/fees e PGBL fica pendente sem cota", () => {
  const rf: PositionInput = {
    kind: "fixed_income", benchmark: "CDI", rateE6: 1_000_000n,
    transactions: [
      { tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 5_000n },
      { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 40_000n, feesCents: 0n },
    ],
    quotes: [], rates: [rate("2026-01-02")],
  };
  const value = instrumentValue(rf, "2026-01-05");
  assert.equal(value.investedCents, 105_000n);
  assert.equal(value.redeemedCents, 40_000n);
  assert.equal(value.feesCents, 5_000n);
  assert.equal(value.quantityE8, null);

  const pension = instrumentValue({ ...rf, kind: "pension", benchmark: null, rateE6: null }, "2026-01-05");
  assert.equal(pension.marketValueCents, null);
  assert.equal(pension.quantityE8, null);
});

test("PGBL: cotas × última cota ≤ asOf, com precisão e12", () => {
  const quotas = [
    { date: "2026-08-31", quotaE12: 1_203_709_189_955n },
    { date: "2026-09-17", quotaE12: 1_220_696_672_715n },
  ];
  assert.deepEqual(pensionValueCents(11_754_09886092n, quotas, "2026-09-17"), {
    valueCents: 1_434_819n, priceCents: 122n, priceDate: "2026-09-17",
  });
  assert.deepEqual(pensionValueCents(11_754_09886092n, quotas, "2026-09-16"), {
    valueCents: 1_414_852n, priceCents: 120n, priceDate: "2026-08-31",
  });
  assert.deepEqual(pensionValueCents(11_754_09886092n, quotas, "2026-08-30"), { valueCents: null, priceCents: null, priceDate: null });
  assert.deepEqual(pensionValueCents(11_754_09886092n, [], "2026-09-17"), { valueCents: null, priceCents: null, priceDate: null });
});

test("instrumentValue: PGBL usa pensionQuotes e fica pendente sem cota", () => {
  const input: PositionInput = {
    kind: "pension", benchmark: null, rateE6: null,
    transactions: [{ tradeDate: "2026-01-02", kind: "BUY", quantityE8: 5_00000000n, grossCents: 50_000n, feesCents: 0n }],
    quotes: [], rates: [],
    pensionQuotes: [{ date: "2026-01-02", quotaE12: 1_200_000_000_000n }],
  };
  const value = instrumentValue(input, "2026-01-05");
  assert.equal(value.marketValueCents, 600n); // 5 cotas × R$ 1,20
  assert.equal(value.priceCents, 120n);
  assert.equal(value.priceDate, "2026-01-02");
  assert.equal(value.quantityE8, 5_00000000n);
  assert.equal(instrumentValue({ ...input, pensionQuotes: [] }, "2026-01-05").marketValueCents, null);
});

test("RF encerrada zera resíduo (≤ R$ 0,01) e resgate parcial fica intacto", () => {
  const rates = [rate("2026-01-02"), rate("2026-01-05")];
  const base: PositionInput = {
    kind: "fixed_income", benchmark: "CDI", rateE6: 1_000_000n,
    transactions: [
      { tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n },
      { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 100_400n, feesCents: 0n },
    ],
    quotes: [], rates,
  };
  // compra capitalizada: 100000 × 1,001 × 1,001 = 100200; venda D+0: 100400 × 1,001 = 100500 → resíduo −300
  assert.equal(instrumentValue(base, "2026-01-05").marketValueCents, 0n);

  const tiny: PositionInput = {
    ...base,
    transactions: [base.transactions[0]!, { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 100_099n, feesCents: 0n }],
  };
  // venda 100099 × 1,001 = 100199,099 → 100199 → resíduo +1
  assert.equal(instrumentValue(tiny, "2026-01-05").marketValueCents, 0n);

  const amortized: PositionInput = {
    ...base,
    rates: [rate("2026-01-05")],
    transactions: [
      { tradeDate: "2026-01-02", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n },
      { tradeDate: "2026-01-05", kind: "AMORTIZATION", quantityE8: null, grossCents: -99_999n, feesCents: 0n },
    ],
  };
  // compra 100000 × 1,001 = 100100; amortização −99999 × 1,001 = −100098,999 → resíduo +1,001 → 1¢ → 0
  assert.equal(instrumentValue(amortized, "2026-01-05").marketValueCents, 0n);

  const partial: PositionInput = {
    ...base,
    transactions: [base.transactions[0]!, { tradeDate: "2026-01-05", kind: "SELL", quantityE8: null, grossCents: 40_000n, feesCents: 0n }],
  };
  // 100200 − 40040 = 60160 (posição segue aberta)
  assert.equal(instrumentValue(partial, "2026-01-05").marketValueCents, 60_160n);
});

test("RV/PGBL com quantidade zero valem 0 mesmo sem cotação; posição aberta sem cotação fica null", () => {
  const equity: PositionInput = {
    kind: "equity", benchmark: null, rateE6: null,
    transactions: [
      { tradeDate: "2026-01-02", kind: "BUY", quantityE8: 10_00000000n, grossCents: 1_000n, feesCents: 0n },
      { tradeDate: "2026-01-05", kind: "SELL", quantityE8: -10_00000000n, grossCents: 1_100n, feesCents: 0n },
    ],
    quotes: [], rates: [],
  };
  assert.equal(instrumentValue(equity, "2026-01-05").marketValueCents, 0n);
  assert.equal(instrumentValue({ ...equity, kind: "pension" }, "2026-01-05").marketValueCents, 0n);
  assert.equal(instrumentValue({ ...equity, transactions: [equity.transactions[0]!] }, "2026-01-05").marketValueCents, null);
});
