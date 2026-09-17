import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CENTS, RATE_SCALE, SHARES_SCALE,
  divRoundHalfUp, formatCents, mulScaled, parseDecimal, toNumberSafe,
} from "./money.ts";

test("divRoundHalfUp arredonda metade para longe do zero", () => {
  assert.equal(divRoundHalfUp(1n, 2n), 1n);
  assert.equal(divRoundHalfUp(1n, 3n), 0n);
  assert.equal(divRoundHalfUp(2n, 3n), 1n);
  assert.equal(divRoundHalfUp(-1n, 2n), -1n);
  assert.equal(divRoundHalfUp(-1n, 3n), 0n);
});

test("parseDecimal converte decimal exato (vírgula ou ponto)", () => {
  assert.equal(parseDecimal("7074.84", CENTS), 707484n);
  assert.equal(parseDecimal("0,00053678", RATE_SCALE), 536780000n);
  assert.equal(parseDecimal("-35.19622208182556", CENTS), -3520n);
  assert.equal(parseDecimal("930.14877553", SHARES_SCALE), 93014877553n);
  assert.equal(parseDecimal("1.005", CENTS), 101n);
});

test("parseDecimal entende pt-BR com milhar (1.234,56)", () => {
  assert.equal(parseDecimal("1.234,56", CENTS), 123456n);
  assert.equal(parseDecimal("1.234.567,89", CENTS), 123456789n);
  assert.equal(parseDecimal("-1.000,00", CENTS), -100000n);
});

test("mulScaled multiplica mantendo a escala", () => {
  assert.equal(mulScaled(93014877553n, 1075n, SHARES_SCALE), 999910n);
});

test("formatCents formata pt-BR e nunca produz -0,00", () => {
  assert.equal(formatCents(707484n), "R$ 7.074,84");
  assert.equal(formatCents(-3520n), "-R$ 35,20");
  assert.equal(formatCents(0n), "R$ 0,00");
});

test("toNumberSafe converte cents para JSON e barra acima de 2^53", () => {
  assert.equal(toNumberSafe(707484n), 707484);
  assert.throws(() => toNumberSafe(9007199254740993n));
});
