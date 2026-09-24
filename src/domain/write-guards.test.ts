import { test } from "node:test";
import assert from "node:assert/strict";
import { validateChange, type GuardInput, type GuardTransaction } from "./write-guards.ts";
import type { PositionTransaction } from "./position.ts";

const rate = { date: "2026-09-17", valueE12: 1_000_000_000n };
const buy: PositionTransaction = { tradeDate: "2026-09-17", kind: "BUY", quantityE8: null, grossCents: 100_000n, feesCents: 0n };
const buy10: PositionTransaction = { tradeDate: "2026-09-17", kind: "BUY", quantityE8: 10_00000000n, grossCents: 9_000n, feesCents: 0n };
const g = (transaction: PositionTransaction, id: number): GuardTransaction => ({ id, ...transaction });
const rf = (transactions: GuardTransaction[], extra: Partial<GuardInput> = {}): GuardInput => ({
  kind: "fixed_income", rateE6: 1_000_000n, maturityDate: null, rates: [rate], transactions, ...extra,
});

test("RF: resgate até o saldo capitalizado passa; acima falha", () => {
  const input = rf([g(buy, 1)]);
  assert.equal(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_100n } }), null);
  assert.match(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_102n } }) ?? "", /maior que o saldo/);
});

test("RF: tolerância de 1¢ do vencimento", () => {
  const input = rf([g(buy, 1)]);
  assert.equal(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_101n } }), null);
  assert.match(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_102n } }) ?? "", /maior que o saldo/);
});

test("RF sem índice: saldo é a soma dos aportes", () => {
  const input = rf([g(buy, 1)], { rateE6: null, rates: [] });
  assert.equal(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_000n } }), null);
  assert.match(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_002n } }) ?? "", /maior que o saldo/);
});

test("RF: vencimento congela a capitalização no dia anterior", () => {
  const input = rf([g(buy, 1)], {
    maturityDate: "2026-09-18",
    rates: [rate, { date: "2026-09-18", valueE12: 1_000_000_000n }],
  });
  assert.equal(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 100_100n } }), null);
});

test("RF: resgate sem nenhum aporte falha", () => {
  const input = rf([]);
  assert.match(validateChange(input, { action: "create", transaction: { ...buy, kind: "SELL", grossCents: 2n } }) ?? "", /maior que o saldo/);
});

test("RV: resgate maior que as cotas disponíveis falha", () => {
  const input: GuardInput = { kind: "equity", rateE6: null, maturityDate: null, rates: [], transactions: [g(buy10, 1)] };
  assert.equal(validateChange(input, { action: "create", transaction: { ...buy10, kind: "SELL", quantityE8: -10_00000000n } }), null);
  assert.match(validateChange(input, { action: "create", transaction: { ...buy10, kind: "SELL", quantityE8: -11_00000000n } }) ?? "", /negativa/);
});

test("edição que cria oversell retroativo falha", () => {
  const sell: PositionTransaction = { tradeDate: "2026-09-18", kind: "SELL", quantityE8: -10_00000000n, grossCents: 9_000n, feesCents: 0n };
  const input: GuardInput = { kind: "equity", rateE6: null, maturityDate: null, rates: [], transactions: [g(buy10, 1), g(sell, 2)] };
  assert.equal(validateChange(input, { action: "update", transactionId: 2, transaction: sell }), null);
  assert.match(validateChange(input, { action: "update", transactionId: 2, transaction: { ...sell, quantityE8: -11_00000000n } }) ?? "", /negativa/);
});

test("exclusão de compra que sustenta resgate falha; exclusão do resgate passa", () => {
  const sell: PositionTransaction = { tradeDate: "2026-09-18", kind: "SELL", quantityE8: -10_00000000n, grossCents: 9_000n, feesCents: 0n };
  const input: GuardInput = { kind: "equity", rateE6: null, maturityDate: null, rates: [], transactions: [g(buy10, 1), g(sell, 2)] };
  assert.match(validateChange(input, { action: "delete", transactionId: 1 }) ?? "", /negativa/);
  assert.equal(validateChange(input, { action: "delete", transactionId: 2 }), null);
});

test("instrumento RF: parâmetros novos validam as transações existentes", () => {
  const sell = g({ tradeDate: "2026-09-17", kind: "SELL", quantityE8: null, grossCents: 100_100n, feesCents: 0n }, 2);
  const semTaxa = rf([g(buy, 1), sell], { rateE6: null, rates: [] });
  assert.match(validateChange(semTaxa, { action: "none" }) ?? "", /maior que o saldo/);
  assert.equal(validateChange(rf([g(buy, 1), sell]), { action: "none" }), null);
});
