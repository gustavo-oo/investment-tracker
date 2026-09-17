import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { counts } from "../../db/repos.ts";

export function registerHealthRoutes(app: FastifyInstance, db: Db): void {
  app.get("/api/health", () => ({ ok: true, counts: counts(db) }));
}
