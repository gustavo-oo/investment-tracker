import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_MONTHS, projectPatrimony, projectionPremise } from "./projection.ts";

test("projectionPremise usa media geometrica, desvio amostral e aporte medio", () => {
  const premise = projectionPremise([2, -1, 2, -1, 2, -1], [100n, 200n, 300n, 400n, 500n, 600n]);
  assert.ok(premise !== null);
  assert.equal(MIN_MONTHS, 6);
  assert.equal(premise.monthsUsed, 6);
  assert.equal(premise.monthlyRatePct, 0.4888); // sqrt(1,02 × 0,99) − 1; a média aritmética daria 0,5
  assert.equal(premise.bandPp, 1.6432); // desvio amostral de [2, −1, 2, −1, 2, −1]
  assert.equal(premise.contributionCents, 350n); // (100 + … + 600) ÷ 6
  assert.equal(premise.pessimisticMonthlyPct, -1.1544);
  assert.equal(premise.optimisticMonthlyPct, 2.132);
});

test("projectionPremise ignora null, exige 6 validos e clampa o pessimista em −99", () => {
  assert.equal(projectionPremise([1, 1, null, 1, 1, 1], [0n]), null); // 5 válidos
  assert.equal(projectionPremise([1, 1, null, 1, 1, 1, 1, null], [0n])?.monthsUsed, 6);
  const clamp = projectionPremise([-100, 0, 0, 0, 0, 0], [0n, 0n, 0n, 0n, 0n, 0n]);
  assert.ok(clamp !== null);
  assert.equal(clamp.monthlyRatePct, -100);
  assert.equal(clamp.bandPp, 40.8248);
  assert.equal(clamp.pessimisticMonthlyPct, -99);
  assert.equal(clamp.optimisticMonthlyPct, -59.1752);
});

test("projectionPremise arredonda o aporte half-up e aceita aporte negativo", () => {
  assert.equal(projectionPremise([0, 0, 0, 0, 0, 0], [1n, 0n])?.contributionCents, 1n);
  assert.equal(projectionPremise([0, 0, 0, 0, 0, 0], [-100n, -201n])?.contributionCents, -151n);
});

test("projectPatrimony compoe aporte e taxa por cenario", () => {
  const premise = { contributionCents: 1_000n, monthlyRatePct: 1, pessimisticMonthlyPct: 0.5, optimisticMonthlyPct: 1.5 };
  assert.deepEqual(projectPatrimony(100_000n, premise, 2), [
    { baseCents: 102_010n, pessimisticCents: 101_505n, optimisticCents: 102_515n },
    { baseCents: 104_040n, pessimisticCents: 103_018n, optimisticCents: 105_068n },
  ]);
  assert.equal(projectPatrimony(100_000n, premise, 24).length, 24);
});

test("projectPatrimony aceita aporte negativo e meses = 0", () => {
  const premise = { contributionCents: -3_000n, monthlyRatePct: 0, pessimisticMonthlyPct: 0, optimisticMonthlyPct: 0 };
  assert.deepEqual(projectPatrimony(10_000n, premise, 2).map((ponto) => ponto.baseCents), [7_000n, 4_000n]);
  assert.deepEqual(projectPatrimony(10_000n, premise, 0), []);
});
