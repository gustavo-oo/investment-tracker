import { test } from "node:test";
import assert from "node:assert/strict";
import { findConstantRuns } from "./quote-runs.ts";

const flat = (count: number, closeCents = 10n, start = 1) =>
  Array.from({ length: count }, (_, index) => ({
    date: `2026-01-${String(start + index).padStart(2, "0")}`,
    closeCents,
  }));

test("findConstantRuns detecta trecho >= 7 encerrado antes de hoje", () => {
  const quotes = [
    { date: "2025-12-31", closeCents: 5n },
    ...flat(7, 10n),
    { date: "2026-01-08", closeCents: 30n },
  ];
  assert.deepEqual(findConstantRuns(quotes, { today: "2026-01-09" }), [{ from: "2026-01-01", to: "2026-01-07" }]);
});

test("findConstantRuns ignora trecho curto, trecho que termina hoje e encontra múltiplos", () => {
  assert.deepEqual(findConstantRuns(flat(6), { today: "2026-02-01" }), []);
  assert.deepEqual(findConstantRuns(flat(7), { today: "2026-01-07" }), []);
  const quotes = [...flat(7, 10n), { date: "2026-01-08", closeCents: 30n }, ...flat(8, 20n, 9)];
  assert.deepEqual(findConstantRuns(quotes, { today: "2026-02-01" }), [
    { from: "2026-01-01", to: "2026-01-07" },
    { from: "2026-01-09", to: "2026-01-16" },
  ]);
  assert.deepEqual(findConstantRuns([], { today: "2026-01-09" }), []);
});
