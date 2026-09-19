import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { counts, listSourceStatus } from "../../db/repos.ts";
import { sourceSummary } from "../../services/status.ts";

export function registerHealthRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/health", () => ({ ok: true, counts: counts(db), sources: listSourceStatus(db).map(sourceSummary) }));
}
