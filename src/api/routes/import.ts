import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { listImportRuns } from "../../db/repos.ts";
import { buildImportInputFromDir, runImport, type ImportInput } from "../../import/run.ts";

type ImportBody = { assetsCsv?: string; transactionsCsv?: string; historyCsv?: string; dryRun?: boolean | string | number };

export function registerImportRoutes(app: FastifyInstance, db: Db, csvDir: string): void {
  app.post<{ Body: ImportBody }>("/api/import", (request, reply) => {
    const body = request.body ?? {};
    const dryRun = body.dryRun === true || body.dryRun === "true" || body.dryRun === 1 || body.dryRun === "1";
    const input: ImportInput = body.assetsCsv && body.transactionsCsv && body.historyCsv
      ? { assetsCsv: body.assetsCsv, transactionsCsv: body.transactionsCsv, historyCsv: body.historyCsv }
      : buildImportInputFromDir(csvDir);
    const summary = runImport(db, input, { dryRun, source: "api" });
    if (summary.errors.length > 0 && !dryRun) {
      reply.code(422);
    }
    return summary;
  });

  app.get("/api/import/runs", () => listImportRuns(db, 20));
}
