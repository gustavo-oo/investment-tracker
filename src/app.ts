import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { Db } from "./db/index.ts";
import { registerHealthRoutes } from "./api/routes/health.ts";
import { registerImportRoutes } from "./api/routes/import.ts";
import { registerInstrumentsRoutes } from "./api/routes/instruments.ts";

export function buildApp(options: { db: Db; csvDir: string; logger?: boolean; webDir?: string }): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  registerInstrumentsRoutes(app, options.db);
  registerImportRoutes(app, options.db, options.csvDir);
  registerHealthRoutes(app, options.db);

  if (options.webDir && existsSync(options.webDir)) {
    app.register(fastifyStatic, { root: options.webDir });
    app.setNotFoundHandler((request, reply) => {
      if ((request.raw.url ?? "").startsWith("/api")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
