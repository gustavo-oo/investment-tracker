import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { listImportRuns } from "../../db/repos.ts";
import { runImport, runImportFromDir, runImportFromWorkbook } from "../../import/run.ts";

type ImportBody = {
  assetsCsv?: string; transactionsCsv?: string; historyCsv?: string;
  workbookBase64?: string; dryRun?: boolean | string | number;
};

export function registerImportRoutes(app: FastifyInstance, db: Db, csvDir: string): void {
  app.post<{ Body: ImportBody }>("/api/import", async (request, reply) => {
    const body = request.body ?? {};
    const dryRun = body.dryRun === true || body.dryRun === "true" || body.dryRun === 1 || body.dryRun === "1";
    const summary = body.workbookBase64
      ? await runImportFromWorkbook(db, body.workbookBase64, { dryRun, source: "api" })
      : body.assetsCsv && body.transactionsCsv && body.historyCsv
        ? runImport(db, { assetsCsv: body.assetsCsv, transactionsCsv: body.transactionsCsv, historyCsv: body.historyCsv }, { dryRun, source: "api" })
        : runImportFromDir(db, csvDir, { dryRun, source: "api" });
    if (summary.errors.length > 0 && !dryRun) {
      reply.code(422);
    }
    return summary;
  });

  app.get("/api/import/runs", () => listImportRuns(db, 20));
}
