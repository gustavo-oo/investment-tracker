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

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | T
    | { message?: string; errors?: unknown }
    | null;
  if (body && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors)) {
    return body as T;
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
      ? String((body as { message: string }).message)
      : `erro HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function postImport(payload: ImportPayload): Promise<ImportSummary> {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<ImportSummary>(response);
}

export async function getImportRuns(): Promise<ImportRun[]> {
  const response = await fetch("/api/import/runs");
  return readJson<ImportRun[]>(response);
}
