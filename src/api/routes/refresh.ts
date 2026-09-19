import type { FastifyInstance } from "fastify";
import type { Db } from "../../db/index.ts";
import { refresh, RefreshBusyError, RefreshRequestError, type RefreshDeps } from "../../services/refresh.ts";

export function registerRefreshRoutes(app: FastifyInstance, db: Db, deps: RefreshDeps = {}): void {
  app.post<{ Querystring: { full?: string; source?: string } }>("/api/refresh", async (request, reply) => {
    const full = request.query.full === "1" || request.query.full === "true";
    try {
      const result = await refresh(db, { full, source: request.query.source }, deps);
      return {
        sources: result.sources.map((summary) => ({
          id: summary.id, fetched: summary.fetched, inserted: summary.inserted,
          updated: summary.updated, skipped: summary.skipped, errors: summary.errors,
        })),
      };
    } catch (error) {
      if (error instanceof RefreshBusyError) return reply.code(409).send({ error: error.message });
      if (error instanceof RefreshRequestError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });
}
