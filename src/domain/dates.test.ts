import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, monthEnd, monthRange, toBrDate } from "./dates.ts";

test("toBrDate devolve a data em America/Sao_Paulo", () => {
  assert.equal(toBrDate(new Date("2026-09-18T02:00:00Z")), "2026-09-17");
  assert.equal(toBrDate(new Date("2026-09-18T14:00:00Z")), "2026-09-18");
});

test("addMonths anda nos dois sentidos", () => {
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-01", -12), "2025-01");
});

test("monthEnd respeita bissexto e monthRange é inclusivo", () => {
  assert.equal(monthEnd("2026-02"), "2026-02-28");
  assert.equal(monthEnd("2028-02"), "2028-02-29");
  assert.deepEqual(monthRange("2026-08", "2026-10"), ["2026-08", "2026-09", "2026-10"]);
});
