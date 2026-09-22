export type ImportSummary = {
  dryRun: boolean;
  instruments: number;
  transactions: number;
  historyRows: number;
  latestMonth: string | null;
  latestTotalCents: number;
  warnings: string[];
  errors: string[];
};

export type ImportRun = {
  id: number;
  importedAt: string;
  source: string;
  instruments: number;
  transactions: number;
  historyRows: number;
  status: "ok" | "error";
  message: string | null;
};

export type ImportPayload = {
  workbookBase64?: string;
  assetsCsv?: string;
  transactionsCsv?: string;
  historyCsv?: string;
  dryRun: boolean;
};

async function errorMessage(response: Response, body: unknown): Promise<string> {
  if (body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string") {
    return String((body as { message: string }).message);
  }
  return `erro HTTP ${response.status}`;
}

export async function postImport(payload: ImportPayload): Promise<ImportSummary> {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as ImportSummary | { message?: string } | null;
  if (body && Array.isArray((body as ImportSummary).errors)) {
    return body as ImportSummary;
  }
  if (!response.ok || body === null) {
    throw new Error(await errorMessage(response, body));
  }
  return body as ImportSummary;
}

export async function getImportRuns(): Promise<ImportRun[]> {
  const response = await fetch("/api/import/runs");
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(await errorMessage(response, body));
  }
  const body = await response.json();
  if (!Array.isArray(body)) {
    throw new Error("resposta inválida do servidor");
  }
  return body as ImportRun[];
}

export type SourceSummary = {
  id: string; lastAttemptAt: string | null; lastSuccessAt: string | null;
  lastErrorAt: string | null; lastError: string | null; stale: boolean;
};

export type Health = { ok: boolean; counts: { instruments: number; transactions: number; legacySnapshots: number; importRuns: number }; sources: SourceSummary[] };

export type PortfolioPosition = {
  instrumentId: string; name: string; kind: "fixed_income" | "equity" | "pension"; category: string;
  broker: string | null; objective: string | null; benchmark: string | null; rateE6: number | null;
  quantityE8: number | null; priceCents: number | null; priceDate: string | null; priceSource: string | null;
  marketValueCents: number | null; investedCents: number; redeemedCents: number; feesCents: number; stale: boolean;
};

export type Portfolio = {
  asOf: string;
  totals: { investedCents: number; redeemedCents: number; feesCents: number; marketValueCents: number };
  positions: PortfolioPosition[];
  sources: SourceSummary[];
};

export type HistoryPoint = {
  month: string; marketValueCents: number; investedCents: number; redeemedCents: number;
  cdiPct: number | null; ipcaPct: number | null;
};

export type AllocationBy = "category" | "broker" | "objective";
export type Allocation = { by: AllocationBy; groups: Array<{ key: string; marketValueCents: number; pct: number }> };

export type ReconciliationCause =
  | "residuo-zerado" | "transacao-fora-da-janela"
  | "legado-snapshot-maio-2025" | "legado-sem-cdi-maio-2026" | "legado-sem-selic-junho-2026"
  | "fonte-yahoo-corrompida" | "data-de-referencia" | "cotacao-fora-da-janela" | "nao-explicada";

export type Reconciliation = {
  month: string; asOf: string;
  totals: { legacyCents: number; referenceCents: number; ourCents: number; diffCents: number };
  divergences: Array<{
    instrumentId: string; name: string; kind: string; benchmark: string | null;
    legacyCents: number; ourCents: number; diffCents: number; cause: ReconciliationCause;
  }>;
  unexplained: number;
};

export type RefreshResult = {
  sources: Array<{ id: string; fetched: number; inserted: number; updated: number; skipped: number; errors: string[] }>;
  repairs: Array<{ ticker: string; from: string; to: string; deleted: number; inserted: number; skipped?: boolean; error?: string }>;
};

export type PerformanceMonth = {
  month: string; portfolioPct: number | null; cdiPct: number | null; ipcaPct: number | null; realPct: number | null;
  diffCdiPp: number | null; rendimentoCents: number; investedCents: number; redeemedCents: number;
};

export type Performance = {
  from: string; to: string; months: PerformanceMonth[];
  accumulated: { portfolioPct: number; cdiPct: number; ipcaPct: number; diffCdiPp: number; diffIpcaPp: number; realPct: number };
  monthsBeaten: number; monthsTotal: number; mwr: { periodPct: number | null; months: number };
};

export type Transaction = {
  tradeDate: string; kind: string; quantityE8: number | null;
  grossCents: number; feesCents: number; note: string | null; legacyRow: number | null;
};

async function apiErrorMessage(response: Response, body: unknown): Promise<string> {
  if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
    return String((body as { error: string }).error);
  }
  return errorMessage(response, body);
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(await apiErrorMessage(response, body));
  }
  return (await response.json()) as T;
}

export const getPortfolio = (signal?: AbortSignal): Promise<Portfolio> => getJson("/api/portfolio", signal);
export const getHealth = (signal?: AbortSignal): Promise<Health> => getJson("/api/health", signal);
export const getAllocation = (by: AllocationBy, signal?: AbortSignal): Promise<Allocation> => getJson(`/api/allocation?by=${by}`, signal);
export const getReconciliation = (month: string, signal?: AbortSignal): Promise<Reconciliation> => getJson(`/api/reconciliation?month=${month}`, signal);
export const getHistory = (from: string, to: string, signal?: AbortSignal): Promise<HistoryPoint[]> => getJson(`/api/history?from=${from}&to=${to}`, signal);
export const getPerformance = (from: string, to: string, signal?: AbortSignal): Promise<Performance> => getJson(`/api/performance?from=${from}&to=${to}`, signal);
export const getTransactions = (id: string, signal?: AbortSignal): Promise<Transaction[]> =>
  getJson(`/api/instruments/${encodeURIComponent(id)}/transactions`, signal);

export async function postRefresh(): Promise<RefreshResult> {
  const response = await fetch("/api/refresh", { method: "POST" });
  const body = (await response.json().catch(() => null)) as RefreshResult | { error?: string } | null;
  if (!response.ok) throw new Error(await apiErrorMessage(response, body));
  return body as RefreshResult;
}
