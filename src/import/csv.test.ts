import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "./csv.ts";

test("parseCsv lida com aspas, vírgula dentro de campo e CRLF", () => {
  const rows = parseCsv('a,b\r\n"linha, com vírgula",2\r\n"aspas ""internas""",3');
  assert.deepEqual(rows, [["a", "b"], ["linha, com vírgula", "2"], ['aspas "internas"', "3"]]);
});

test("parseCsv ignora linha final vazia", () => {
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
});
