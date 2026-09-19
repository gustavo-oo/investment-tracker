import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { RefreshOptions } from "../services/refresh.ts";
import { CRON_INDICES, CRON_QUOTES, startScheduler, type CronLike } from "./scheduler.ts";

test("scheduler registra os dois cron e dispara o refresh certo", () => {
  const db = openDb(":memory:");
  migrate(db);
  const scheduled: Array<{ expression: string; callback: () => void; timezone: string }> = [];
  let stops = 0;
  const cron: CronLike = {
    schedule: (expression, callback, options) => {
      scheduled.push({ expression, callback, timezone: options.timezone });
      return { stop: () => { stops++; } };
    },
  };
  const calls: Array<RefreshOptions | undefined> = [];
  const scheduler = startScheduler(db, {
    cron,
    refreshFn: async (_db, options) => { calls.push(options); },
    onError: () => {},
  });

  assert.deepEqual(scheduled.map((task) => task.expression), [CRON_QUOTES, CRON_INDICES]);
  assert.equal(scheduled[0]?.expression, "*/10 10-17 * * 1-5");
  assert.equal(scheduled[1]?.expression, "0 7 * * *");
  assert.equal(scheduled.every((task) => task.timezone === "America/Sao_Paulo"), true);

  scheduled[0]?.callback();
  scheduled[1]?.callback();
  assert.deepEqual(calls, [{}, { source: "bcb" }]);

  scheduler.stop();
  assert.equal(stops, 2);
});
