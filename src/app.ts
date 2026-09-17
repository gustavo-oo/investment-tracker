import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "./db/index.ts";
import { registerHealthRoutes } from "./api/routes/health.ts";
import { registerImportRoutes } from "./api/routes/import.ts";
import { registerInstrumentsRoutes } from "./api/routes/instruments.ts";

export function buildApp(options: { db: Db; csvDir: string; logger?: boolean }): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  registerInstrumentsRoutes(app, options.db);
  registerImportRoutes(app, options.db, options.csvDir);
  registerHealthRoutes(app, options.db);
  return app;
}
