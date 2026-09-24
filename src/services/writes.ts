import type { Db } from "../db/index.ts";
import {
  countLegacySnapshots, countTransactions, deleteInstrument, deleteTransaction, getInstrument, getTransaction, insertInstrument,
  insertTransaction, listAllIndexRates, listTransactionsByInstrument, updateInstrument, updateTransaction,
  type InstrumentRow, type TransactionRow, type TransactionWithId,
} from "../db/repos.ts";
import { isDate, toBrDate } from "../domain/dates.ts";
import type { InstrumentCategory, InstrumentKind } from "../domain/model.ts";
import { validateChange, type GuardChange } from "../domain/write-guards.ts";
import { slugify } from "../import/catalog.ts";

export type WriteFailure = { status: 400 | 404 | 409; message: string };
export type WriteResult<T> = { ok: true; value: T } | { ok: false; failure: WriteFailure };

export type InstrumentInput = {
  name: string; kind: InstrumentKind; category: InstrumentCategory;
  ticker: string | null; quoteSymbol: string | null;
  benchmark: string | null; rateE6: bigint | null; maturityDate: string | null;
  liquidity: string | null; broker: string | null; objective: string | null; investor: string | null;
};

export type TransactionInput = {
  tradeDate: string; kind: "BUY" | "SELL"; grossCents: bigint; feesCents: bigint;
  quantityE8: bigint | null; note: string | null;
};

const INVESTORS = new Set(["Ana", "Beto"]);
const CATEGORY_KINDS: Record<InstrumentCategory, InstrumentKind> = {
  cdb: "fixed_income", lca: "fixed_income", selic: "fixed_income",
  etf_fixed: "equity", etf_equity: "equity", pension_ipca: "pension",
};

const clean = (value: string | null): string | null => {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

function validateInvestor(investor: string | null): string | null {
  return investor !== null && !INVESTORS.has(investor) ? "investidor deve ser Ana ou Beto" : null;
}

function validateInstrument(input: InstrumentInput): string | null {
  if (input.name.trim() === "") return "nome obrigatório";
  if (CATEGORY_KINDS[input.category] !== input.kind) return "classe e categoria não combinam";
  if (input.maturityDate !== null && !isDate(input.maturityDate)) return "vencimento inválido";
  if (input.kind === "fixed_income") {
    if (input.benchmark !== "CDI" && input.benchmark !== "SELIC") return "renda fixa usa CDI ou SELIC";
    if (input.rateE6 === null || input.rateE6 <= 0n) return "renda fixa exige rentabilidade positiva";
  }
  if (input.kind === "equity" && clean(input.ticker) === null) return "ticker obrigatório";
  if (input.kind === "pension" && clean(input.quoteSymbol) === null) return "código CVM obrigatório";
  return null;
}

function validateTransaction(input: TransactionInput, kind: InstrumentKind, today: string): string | null {
  if (!isDate(input.tradeDate)) return "data inválida";
  if (input.tradeDate > today) return "data não pode ser futura";
  if (input.kind !== "BUY" && input.kind !== "SELL") return "tipo deve ser Compra ou Resgate";
  if (input.grossCents <= 0n) return "valor deve ser maior que zero";
  if (input.feesCents < 0n) return "taxas não podem ser negativas";
  if (kind === "fixed_income") {
    if (input.quantityE8 !== null) return "renda fixa não usa quantidade";
  } else if (input.quantityE8 === null || input.quantityE8 <= 0n) {
    return "quantidade obrigatória";
  }
  if (input.note !== null && input.note.length > 200) return "nota deve ter até 200 caracteres";
  return null;
}

function runGuard(
  db: Db,
  instrument: Pick<InstrumentRow, "id" | "kind" | "benchmark" | "rateE6" | "maturityDate">,
  change: GuardChange,
): string | null {
  const series = instrument.benchmark === "SELIC" ? "SELIC" : instrument.benchmark === "CDI" ? "CDI" : null;
  const rates = series === null
    ? []
    : listAllIndexRates(db).filter((rate) => rate.series === series).map((rate) => ({ date: rate.date, valueE12: rate.valueE12 }));
  return validateChange({
    kind: instrument.kind, rateE6: instrument.rateE6, maturityDate: instrument.maturityDate,
    transactions: listTransactionsByInstrument(db, instrument.id), rates,
  }, change);
}

const failure = (status: 400 | 404 | 409, message: string): WriteResult<never> => ({ ok: false, failure: { status, message } });

export function createInstrument(db: Db, input: InstrumentInput): WriteResult<InstrumentRow> {
  const invalid = validateInstrument(input) ?? validateInvestor(input.investor);
  if (invalid !== null) return failure(400, invalid);
  let id: string;
  try {
    id = slugify(input.name);
  } catch {
    return failure(400, "nome precisa ter letras ou números");
  }
  if (getInstrument(db, id) !== undefined) return failure(409, `já existe um ativo com o id ${id}; ajuste o nome`);
  insertInstrument(db, {
    id, legacyKey: `ui:${id}`, name: input.name.trim(), kind: input.kind, category: input.category,
    ticker: input.kind === "equity" ? clean(input.ticker) : null,
    quoteSource: input.kind === "equity" ? "yahoo" : input.kind === "pension" ? "cvm-swb" : null,
    quoteSymbol: input.kind === "pension" ? clean(input.quoteSymbol) : null,
    currency: "BRL",
    benchmark: input.kind === "fixed_income" ? input.benchmark : null,
    rateE6: input.kind === "fixed_income" ? input.rateE6 : null,
    maturityDate: input.kind === "fixed_income" ? input.maturityDate : null,
    liquidity: clean(input.liquidity), broker: clean(input.broker), objective: clean(input.objective),
    investor: input.investor,
  });
  const created = getInstrument(db, id);
  return created === undefined ? failure(404, "instrumento não encontrado") : { ok: true, value: created };
}

export function patchInstrument(db: Db, id: string, patch: Partial<InstrumentInput>): WriteResult<InstrumentRow> {
  const current = getInstrument(db, id);
  if (current === undefined) return failure(404, "instrumento não encontrado");
  const hasTransactions = countTransactions(db, id) > 0;
  if (hasTransactions && ((patch.kind !== undefined && patch.kind !== current.kind) || (patch.category !== undefined && patch.category !== current.category))) {
    return failure(400, "não é possível mudar classe/categoria com transações");
  }
  const merged: InstrumentInput = {
    name: patch.name ?? current.name,
    kind: patch.kind ?? current.kind,
    category: patch.category ?? current.category,
    ticker: patch.ticker !== undefined ? patch.ticker : current.ticker,
    quoteSymbol: patch.quoteSymbol !== undefined ? patch.quoteSymbol : current.quoteSymbol,
    benchmark: patch.benchmark !== undefined ? patch.benchmark : current.benchmark,
    rateE6: patch.rateE6 !== undefined ? patch.rateE6 : current.rateE6,
    maturityDate: patch.maturityDate !== undefined ? patch.maturityDate : current.maturityDate,
    liquidity: patch.liquidity !== undefined ? patch.liquidity : current.liquidity,
    broker: patch.broker !== undefined ? patch.broker : current.broker,
    objective: patch.objective !== undefined ? patch.objective : current.objective,
    investor: patch.investor !== undefined ? patch.investor : current.investor,
  };
  const invalid = validateInstrument(merged) ?? (patch.investor !== undefined ? validateInvestor(merged.investor) : null);
  if (invalid !== null) return failure(400, invalid);
  const mudaRF = patch.benchmark !== undefined || patch.rateE6 !== undefined || patch.maturityDate !== undefined;
  if (hasTransactions && merged.kind === "fixed_income" && mudaRF) {
    const guardError = runGuard(db, { ...current, ...merged }, { action: "none" });
    if (guardError !== null) return failure(400, guardError);
  }
  const updated: InstrumentRow = {
    ...current, name: merged.name.trim(), kind: merged.kind, category: merged.category,
    ticker: merged.kind === "equity" ? clean(merged.ticker) : null,
    quoteSource: merged.kind === "equity" ? "yahoo" : merged.kind === "pension" ? "cvm-swb" : null,
    quoteSymbol: merged.kind === "pension" ? clean(merged.quoteSymbol) : null,
    benchmark: merged.kind === "fixed_income" ? merged.benchmark : null,
    rateE6: merged.kind === "fixed_income" ? merged.rateE6 : null,
    maturityDate: merged.kind === "fixed_income" ? merged.maturityDate : null,
    liquidity: clean(merged.liquidity), broker: clean(merged.broker), objective: clean(merged.objective),
    investor: merged.investor,
  };
  updateInstrument(db, updated);
  return { ok: true, value: updated };
}

export function removeInstrument(db: Db, id: string): WriteResult<null> {
  const current = getInstrument(db, id);
  if (current === undefined) return failure(404, "instrumento não encontrado");
  const total = countTransactions(db, id);
  if (total > 0) return failure(409, `não é possível excluir: ${total} transações lançadas`);
  const snapshots = countLegacySnapshots(db, id);
  if (snapshots > 0) return failure(409, `não é possível excluir: ${snapshots} registros de histórico`);
  deleteInstrument(db, id);
  return { ok: true, value: null };
}

function toRow(instrument: InstrumentRow, input: TransactionInput): TransactionRow {
  const quantityE8 = instrument.kind === "fixed_income"
    ? null
    : input.kind === "SELL" ? -(input.quantityE8 ?? 0n) : input.quantityE8;
  return {
    instrumentId: instrument.id, tradeDate: input.tradeDate, kind: input.kind, quantityE8,
    grossCents: input.grossCents, feesCents: input.feesCents, note: input.note, legacyRow: null,
  };
}

export function addTransaction(
  db: Db, instrumentId: string, input: TransactionInput, today = toBrDate(new Date()),
): WriteResult<TransactionWithId> {
  const instrument = getInstrument(db, instrumentId);
  if (instrument === undefined) return failure(404, "instrumento não encontrado");
  const invalid = validateTransaction(input, instrument.kind, today);
  if (invalid !== null) return failure(400, invalid);
  const row = toRow(instrument, input);
  const guardError = runGuard(db, instrument, { action: "create", transaction: row });
  if (guardError !== null) return failure(400, guardError);
  const id = insertTransaction(db, row);
  const created = getTransaction(db, id);
  return created === undefined ? failure(404, "transação não encontrada") : { ok: true, value: created };
}

export function editTransaction(
  db: Db, id: number, patch: Partial<TransactionInput>, today = toBrDate(new Date()),
): WriteResult<TransactionWithId> {
  const current = getTransaction(db, id);
  if (current === undefined) return failure(404, "transação não encontrada");
  if (current.kind !== "BUY" && current.kind !== "SELL") return failure(400, "tipo de transação não editável");
  const instrument = getInstrument(db, current.instrumentId);
  if (instrument === undefined) return failure(404, "instrumento não encontrado");
  const merged: TransactionInput = {
    tradeDate: patch.tradeDate ?? current.tradeDate,
    kind: patch.kind ?? current.kind,
    grossCents: patch.grossCents ?? current.grossCents,
    feesCents: patch.feesCents ?? current.feesCents,
    quantityE8: patch.quantityE8 !== undefined
      ? patch.quantityE8
      : current.quantityE8 === null ? null : current.quantityE8 < 0n ? -current.quantityE8 : current.quantityE8,
    note: patch.note !== undefined ? patch.note : current.note,
  };
  const invalid = validateTransaction(merged, instrument.kind, today);
  if (invalid !== null) return failure(400, invalid);
  const row = toRow(instrument, merged);
  const guardError = runGuard(db, instrument, { action: "update", transactionId: id, transaction: row });
  if (guardError !== null) return failure(400, guardError);
  updateTransaction(db, id, row);
  const updated = getTransaction(db, id);
  return updated === undefined ? failure(404, "transação não encontrada") : { ok: true, value: updated };
}

export function removeTransaction(db: Db, id: number): WriteResult<null> {
  const current = getTransaction(db, id);
  if (current === undefined) return failure(404, "transação não encontrada");
  const instrument = getInstrument(db, current.instrumentId);
  if (instrument === undefined) return failure(404, "instrumento não encontrado");
  const guardError = runGuard(db, instrument, { action: "delete", transactionId: id });
  if (guardError !== null) return failure(400, guardError);
  deleteTransaction(db, id);
  return { ok: true, value: null };
}
