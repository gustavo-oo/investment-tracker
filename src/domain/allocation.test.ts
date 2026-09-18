import { test } from "node:test";
import assert from "node:assert/strict";
import { groupAllocation } from "./allocation.ts";

test("groupAllocation soma por critério, ignora null e ordena por valor", () => {
  const positions = [
    { marketValueCents: 100n, category: "cdb", broker: "PagBank", objective: "Reserva" },
    { marketValueCents: 300n, category: "cdb", broker: "XP", objective: "Aposentadoria" },
    { marketValueCents: null, category: "pension_ipca", broker: null, objective: null },
  ];
  assert.deepEqual(groupAllocation(positions, "category"), [{ key: "cdb", marketValueCents: 400n }]);
  assert.deepEqual(groupAllocation(positions, "broker"), [
    { key: "XP", marketValueCents: 300n },
    { key: "PagBank", marketValueCents: 100n },
  ]);
  assert.deepEqual(groupAllocation(positions, "objective"), [
    { key: "Aposentadoria", marketValueCents: 300n },
    { key: "Reserva", marketValueCents: 100n },
  ]);
});
