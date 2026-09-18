import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv } from "./csv.ts";

test("parseCsv lida com aspas, vírgula dentro de campo e CRLF", () => {
  const rows = parseCsv('a,b\r\n"linha, com vírgula",2\r\n"aspas ""internas""",3');
  assert.deepEqual(rows, [["a", "b"], ["linha, com vírgula", "2"], ['aspas "internas"', "3"]]);
});

test("parseCsv ignora linha final vazia", () => {
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
});

test("parseCsv rejeita aspas não fechadas", () => {
  assert.throws(() => parseCsv('a,b\n"sem fim,2'), /aspas não fechadas/);
});

test("toCsv escapa aspas, vírgulas e quebras de linha", () => {
  assert.equal(toCsv([["a", "b,c"], ['d"e', "f\ng"]]), 'a,"b,c"\n"d""e","f\ng"');
});
