import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { listImportRuns } from "../../db/repos.ts";
import { buildImportInputFromDir, runImport, type ImportInput } from "../../import/run.ts";

type ImportBody = { assetsCsv?: string; transactionsCsv?: string; historyCsv?: string; dryRun?: boolean };

export function registerImportRoutes(app: FastifyInstance, db: Db, csvDir: string): void {
  app.post<{ Body: ImportBody }>("/api/import", (request, reply) => {
    const body = request.body ?? {};
    const input: ImportInput = body.assetsCsv && body.transactionsCsv && body.historyCsv
      ? { assetsCsv: body.assetsCsv, transactionsCsv: body.transactionsCsv, historyCsv: body.historyCsv }
      : buildImportInputFromDir(csvDir);
    const summary = runImport(db, input, { dryRun: body.dryRun === true, source: "api" });
    if (summary.errors.length > 0 && body.dryRun !== true) {
      reply.code(422);
    }
    return summary;
  });

  app.get("/api/import/runs", () => listImportRuns(db, 20));
}
