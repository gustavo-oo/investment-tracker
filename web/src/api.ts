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

export async function postImport(payload: ImportPayload): Promise<ImportSummary> {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await response.json()) as ImportSummary;
}

export async function getImportRuns(): Promise<ImportRun[]> {
  const response = await fetch("/api/import/runs");
  return (await response.json()) as ImportRun[];
}
