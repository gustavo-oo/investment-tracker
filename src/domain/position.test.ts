import { test } from "node:test";
import assert from "node:assert/strict";
import { equityValueCents, instrumentValue, rfValueCents, type PositionInput } from "./position.ts";

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

test("instrumentValue consolida invested/redeemed/fees e PGBL fica pendente", () => {
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
