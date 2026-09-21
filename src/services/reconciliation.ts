import type { Db } from "../db/index.ts";
import { listAllTransactions, listInstruments, listLegacySnapshotByMonth } from "../db/repos.ts";
import type { InstrumentRow } from "../db/repos.ts";
import { monthEnd, toBrDate } from "../domain/dates.ts";
import type { InstrumentKind } from "../domain/model.ts";
import { buildPortfolio } from "./portfolio.ts";

export const RECONCILIATION_CAUSES = [
  "residuo-zerado",
  "transacao-fora-da-janela",
  "legado-snapshot-maio-2025",
  "legado-sem-cdi-maio-2026",
  "legado-sem-selic-junho-2026",
  "fonte-yahoo-corrompida",
  "data-de-referencia",
  "cotacao-fora-da-janela",
  "nao-explicada",
] as const;
export type ReconciliationCause = (typeof RECONCILIATION_CAUSES)[number];

export type ReconciliationDivergence = {
  instrumentId: string; name: string; kind: InstrumentKind; benchmark: string | null;
  legacyCents: bigint; ourCents: bigint; diffCents: bigint; cause: ReconciliationCause;
};

export type ReconciliationResult = {
  month: string; asOf: string;
  totals: { legacyCents: bigint; referenceCents: bigint; ourCents: bigint; diffCents: bigint };
  divergences: ReconciliationDivergence[];
  unexplained: number;
};

export type ReconciliationOptions = { month?: string; asOf?: string };
export type ReconciliationDeps = { now?: () => Date };

const BALANCE_KINDS = new Set(["BUY", "SELL", "AMORTIZATION"]);
const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/** Primeira regra que casar define a causa; regras de bug conhecido do legado vêm antes das genéricas. */
export function classifyDivergence(input: {
  instrument: InstrumentRow; month: string; legacyCents: bigint; ourCents: bigint; diffCents: bigint;
  transactionAfterAsOf: boolean; currentMonth: string;
}): ReconciliationCause {
  const { instrument, month, legacyCents, ourCents, diffCents } = input;
  if (ourCents === 0n && legacyCents !== 0n && legacyCents <= 1n) return "residuo-zerado";
  if (input.transactionAfterAsOf) return "transacao-fora-da-janela";
  if (instrument.id === "cdb-di-01-12-28" && month >= "2025-05") return "legado-snapshot-maio-2025";
  if (instrument.benchmark === "CDI" && month >= "2026-05" && diffCents > 0n) return "legado-sem-cdi-maio-2026";
  if (instrument.benchmark === "SELIC" && month >= "2026-06" && diffCents > 0n) return "legado-sem-selic-junho-2026";
  if (instrument.ticker === "B5P211" && month <= "2026-01") return "fonte-yahoo-corrompida";
  if (legacyCents !== 0n && abs(diffCents) * 200n <= abs(legacyCents)) return "data-de-referencia";
  if ((instrument.kind === "equity" || instrument.kind === "pension") && month === input.currentMonth
    && legacyCents !== 0n && abs(diffCents) * 20n <= abs(legacyCents)) return "cotacao-fora-da-janela";
  return "nao-explicada";
}

export function buildReconciliation(
  db: Db,
  options: ReconciliationOptions,
  deps: ReconciliationDeps = {},
): ReconciliationResult {
  const today = toBrDate((deps.now ?? (() => new Date()))());
  const month = options.month ?? today.slice(0, 7);
  const asOf = options.asOf ?? (month === today.slice(0, 7) ? today : monthEnd(month));
  const end = monthEnd(month);
  const legacy = listLegacySnapshotByMonth(db, `${month}-01`);
  const legacyByInstrument = new Map(legacy.map((row) => [row.instrumentId, row.valueCents]));
  const portfolio = buildPortfolio(db, { asOf });
  const oursByInstrument = new Map(portfolio.positions.map((position) => [position.instrumentId, position.marketValueCents ?? 0n]));
  const transactions = listAllTransactions(db);
  const hasTransactionAfter = (instrumentId: string): boolean =>
    transactions.some((transaction) =>
      transaction.instrumentId === instrumentId && BALANCE_KINDS.has(transaction.kind)
      && transaction.tradeDate > asOf && transaction.tradeDate <= end);

  let legacyTotal = 0n;
  let referenceTotal = 0n;
  let ourTotal = 0n;
  const divergences: ReconciliationDivergence[] = [];
  for (const instrument of listInstruments(db)) {
    const legacyCents = legacyByInstrument.get(instrument.id) ?? 0n;
    const ourCents = oursByInstrument.get(instrument.id) ?? 0n;
    legacyTotal += legacyCents;
    referenceTotal += legacyCents > 0n ? legacyCents : 0n;
    ourTotal += ourCents;
    if (legacyCents === ourCents) continue;
    const diffCents = ourCents - legacyCents;
    divergences.push({
      instrumentId: instrument.id, name: instrument.name, kind: instrument.kind, benchmark: instrument.benchmark,
      legacyCents, ourCents, diffCents,
      cause: classifyDivergence({
        instrument, month, legacyCents, ourCents, diffCents, transactionAfterAsOf: hasTransactionAfter(instrument.id),
        currentMonth: today.slice(0, 7),
      }),
    });
  }

  return {
    month, asOf,
    totals: { legacyCents: legacyTotal, referenceCents: referenceTotal, ourCents: ourTotal, diffCents: ourTotal - legacyTotal },
    divergences,
    unexplained: divergences.filter((divergence) => divergence.cause === "nao-explicada").length,
  };
}
