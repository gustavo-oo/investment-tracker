import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, isDate, isMonth, monthEnd, monthRange, toBrDate } from "./dates.ts";

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

test("isMonth e isDate validam formato e calendário", () => {
  assert.equal(isMonth("2026-09"), true);
  assert.equal(isMonth("2026-13"), false);
  assert.equal(isMonth("26-09"), false);
  assert.equal(isMonth("2026-9"), false);
  assert.equal(isMonth(202609), false);

  assert.equal(isDate("2026-09-21"), true);
  assert.equal(isDate("2028-02-29"), true);
  assert.equal(isDate("2026-02-29"), false);
  assert.equal(isDate("2026-09-31"), false);
  assert.equal(isDate("2026-09-00"), false);
  assert.equal(isDate("2026-1-01"), false);
  assert.equal(isDate(null), false);
});
