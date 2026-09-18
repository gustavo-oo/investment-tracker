import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { insertImportRun, listImportRuns } from "../../db/repos.ts";
import { runImport, runImportFromDir, runImportFromWorkbook, type ImportSummary } from "../../import/run.ts";

type ImportBody = {
  assetsCsv?: string; transactionsCsv?: string; historyCsv?: string;
  workbookBase64?: string; dryRun?: boolean | string | number;
};

function summaryWithError(dryRun: boolean, message: string): ImportSummary {
  return {
    dryRun, instruments: 0, transactions: 0, historyRows: 0,
    latestMonth: null, latestTotalCents: 0, warnings: [], errors: [message],
  };
}

export function registerImportRoutes(app: FastifyInstance, db: Db, csvDir: string): void {
  app.post<{ Body: ImportBody }>("/api/import", async (request, reply) => {
    const body = request.body ?? {};
    const dryRun = body.dryRun === true || body.dryRun === "true" || body.dryRun === 1 || body.dryRun === "1";
    const hasWorkbook = typeof body.workbookBase64 === "string";
    const csvValues = [body.assetsCsv, body.transactionsCsv, body.historyCsv];
    const anyCsvKey = csvValues.some((value) => typeof value === "string");
    const filledCsvs = csvValues.filter((value) => typeof value === "string" && value.trim() !== "").length;
    const hasCsvs = filledCsvs === 3;

    let summary: ImportSummary;
    if (hasWorkbook) {
      summary = await runImportFromWorkbook(db, body.workbookBase64 ?? "", { dryRun, source: "api" });
    } else if (hasCsvs) {
      summary = runImport(db, { assetsCsv: body.assetsCsv ?? "", transactionsCsv: body.transactionsCsv ?? "", historyCsv: body.historyCsv ?? "" }, { dryRun, source: "api" });
    } else if (anyCsvKey) {
      summary = summaryWithError(dryRun, "envie os 3 CSVs (Lista de Ativos, Investimentos, Evolução)");
      if (!dryRun) {
        insertImportRun(db, { source: "api", instruments: 0, transactions: 0, historyRows: 0, status: "error", message: summary.errors[0] ?? null });
      }
    } else {
      summary = runImportFromDir(db, csvDir, { dryRun, source: "api" });
    }

    if (summary.errors.length > 0 && !dryRun) {
      reply.code(422);
    }
    return summary;
  });

  app.get("/api/import/runs", () => listImportRuns(db, 20));
}
