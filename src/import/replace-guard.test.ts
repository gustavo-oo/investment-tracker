import { test } from "node:test";
import assert from "node:assert/strict";
import { replaceGuardError } from "./replace-guard.ts";

test("sem --replace e com transações: bloqueia", () => {
  const erro = replaceGuardError([], { transactions: 119 });
  assert.match(erro ?? "", /--replace/);
  assert.match(erro ?? "", /119/);
});

test("com --replace: libera", () => {
  assert.equal(replaceGuardError(["--replace"], { transactions: 119 }), null);
});

test("banco sem transações: libera sem flag", () => {
  assert.equal(replaceGuardError([], { transactions: 0 }), null);
});
