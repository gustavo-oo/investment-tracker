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
