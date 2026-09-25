import { test } from "node:test";
import assert from "node:assert/strict";
import { rebalance } from "./rebalance.ts";

const METAS_80_20 = { rf: 800_000, rv: 200_000 };

test("investe a demanda dos dois grupos quando ambos estao abaixo da meta", () => {
  const result = rebalance({
    valuesCents: { rf: 100_000n, rv: 0n },
    targetsE6: METAS_80_20,
    amountCents: 100_000n,
  });
  assert.equal(result.baseCents, 100_000n);
  assert.equal(result.totalCents, 200_000n);
  const [rf, rv] = result.groups;
  assert.equal(rf?.suggestedCents, 60_000n);
  assert.equal(rv?.suggestedCents, 40_000n);
  assert.equal(rf?.afterValueCents, 160_000n);
  assert.equal(rv?.afterValueCents, 40_000n);
  assert.equal(rf?.pctAfter, 80);
  assert.equal(rv?.pctAfter, 20);
  assert.equal(rf?.aboveTarget, false);
  assert.equal(rv?.aboveTarget, false);
});

test("grupo acima da meta recebe zero e o aporte inteiro vai para o outro (RF acima)", () => {
  const result = rebalance({
    valuesCents: { rf: 180_000n, rv: 20_000n },
    targetsE6: METAS_80_20,
    amountCents: 10_000n,
  });
  const [rf, rv] = result.groups;
  assert.equal(rf?.aboveTarget, true);
  assert.equal(rf?.suggestedCents, 0n);
  assert.equal(rv?.aboveTarget, false);
  assert.equal(rv?.suggestedCents, 10_000n);
  assert.equal(rf?.pctAfter, 85.71);
  assert.equal(rv?.pctAfter, 14.29);
});

test("grupo acima da meta recebe zero e o aporte inteiro vai para o outro (RV acima)", () => {
  const result = rebalance({
    valuesCents: { rf: 20_000n, rv: 180_000n },
    targetsE6: METAS_80_20,
    amountCents: 10_000n,
  });
  const [rf, rv] = result.groups;
  assert.equal(rf?.suggestedCents, 10_000n);
  assert.equal(rv?.suggestedCents, 0n);
  assert.equal(rv?.aboveTarget, true);
});

test("carteira vazia investe conforme as metas", () => {
  const result = rebalance({
    valuesCents: { rf: 0n, rv: 0n },
    targetsE6: { rf: 700_000, rv: 300_000 },
    amountCents: 50_000n,
  });
  assert.equal(result.baseCents, 0n);
  const [rf, rv] = result.groups;
  assert.equal(rf?.suggestedCents, 35_000n);
  assert.equal(rv?.suggestedCents, 15_000n);
  assert.equal(rf?.pctBefore, 0);
  assert.equal(rf?.pctAfter, 70);
  assert.equal(rv?.pctAfter, 30);
});

test("aporte zero nao sugere nada e preserva os percentuais", () => {
  const result = rebalance({
    valuesCents: { rf: 50_000n, rv: 50_000n },
    targetsE6: { rf: 700_000, rv: 300_000 },
    amountCents: 0n,
  });
  const [rf, rv] = result.groups;
  assert.equal(rf?.suggestedCents, 0n);
  assert.equal(rv?.suggestedCents, 0n);
  assert.equal(rf?.pctAfter, 50);
  assert.equal(rv?.pctAfter, 50);
  assert.equal(rf?.aboveTarget, false);
  assert.equal(rv?.aboveTarget, true); // RV 50% > meta de 30%
});

test("meta 100/0 zera o grupo acima e concentra o aporte", () => {
  const result = rebalance({
    valuesCents: { rf: 50_000n, rv: 50_000n },
    targetsE6: { rf: 1_000_000, rv: 0 },
    amountCents: 10_000n,
  });
  const [rf, rv] = result.groups;
  assert.equal(rf?.suggestedCents, 10_000n);
  assert.equal(rv?.suggestedCents, 0n);
  assert.equal(rv?.aboveTarget, true);
});

test("arredonda o alvo da RF half-up e fecha o aporte no centavo", () => {
  const result = rebalance({
    valuesCents: { rf: 33_333n, rv: 66_667n },
    targetsE6: { rf: 333_333, rv: 666_667 },
    amountCents: 100_000n,
  });
  const [rf, rv] = result.groups;
  assert.equal(rf?.afterValueCents, 66_667n);
  assert.equal(rv?.afterValueCents, 133_333n);
  assert.equal((rf?.suggestedCents ?? 0n) + (rv?.suggestedCents ?? 0n), 100_000n);
  assert.equal(rf?.pctAfter, 33.33);
  assert.equal(rv?.pctAfter, 66.67);
});
