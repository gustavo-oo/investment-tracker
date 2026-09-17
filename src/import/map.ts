import { CENTS, MULTIPLIER_SCALE, SHARES_SCALE, parseDecimal } from "../domain/money.ts";
import type { InstrumentKind, TransactionKind } from "../domain/model.ts";
import type { InstrumentRow, TransactionRow } from "../db/repos.ts";
import { categoryFromLegacy, kindFromLegacy, normalizeLegacyId, slugify } from "./catalog.ts";

const clean = (value: string | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" || trimmed === "-" ? null : trimmed;
};

const isoDate = (value: string): string => value.trim().slice(0, 10);

export function mapInstrumentRow(row: string[]): InstrumentRow {
  const [id = "", name = "", type = "", subtype = "", ticker, broker, maturity,
    benchmark, rate, liquidity, investor, objective] = row;
  const kind = kindFromLegacy(type);
  const category = categoryFromLegacy(subtype);
  const legacyKey = normalizeLegacyId(id);
  const benchmarkValue = clean(benchmark);
  return {
    id: slugify(legacyKey),
    legacyKey,
    name: name.trim(),
    kind,
    category,
    ticker: kind === "equity" ? clean(ticker) : null,
    quoteSource: kind === "equity" ? "yahoo" : kind === "pension" ? "cvm-swb" : null,
    quoteSymbol: kind === "pension" && clean(ticker) !== null ? normalizeLegacyId(clean(ticker) ?? "") : null,
    currency: "BRL",
    benchmark: benchmarkValue === null || benchmarkValue === "Nenhum" ? null : benchmarkValue.toUpperCase(),
    rateE6: clean(rate) === null ? null : parseDecimal(rate ?? "0", MULTIPLIER_SCALE),
    maturityDate: clean(maturity) === null ? null : isoDate(maturity ?? ""),
    liquidity: clean(liquidity),
    broker: clean(broker),
    objective: clean(objective),
    investor: clean(investor),
  };
}

const TRANSACTION_KIND_BY_LEGACY: Record<string, TransactionKind> = {
  Compra: "BUY",
  Resgate: "SELL",
};

export function mapTransactionRow(row: string[], instrumentKind: InstrumentKind, rowIndex: number): TransactionRow {
  const [assetId = "", legacyKind = "", date = "", _cost = "0", taxes = "0", result = "0", quantity] = row;
  const kind = TRANSACTION_KIND_BY_LEGACY[legacyKind.trim()];
  if (!kind) throw new Error(`operação desconhecida na linha ${rowIndex}: ${JSON.stringify(legacyKind)}`);
  const hasQuantity = instrumentKind !== "fixed_income" && clean(quantity) !== null;
  const magnitude = hasQuantity ? parseDecimal(quantity ?? "0", SHARES_SCALE) : null;
  return {
    instrumentId: slugify(normalizeLegacyId(assetId)),
    tradeDate: isoDate(date),
    kind,
    quantityE8: magnitude === null ? null : kind === "SELL" ? -magnitude : magnitude,
    grossCents: parseDecimal(result, CENTS),
    feesCents: parseDecimal(taxes || "0", CENTS),
    note: null,
    legacyRow: rowIndex,
  };
}
