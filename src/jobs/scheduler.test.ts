import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import type { RefreshOptions } from "../services/refresh.ts";
import { CRON_DAILY, CRON_QUOTES, startScheduler, type CronLike } from "./scheduler.ts";

test("scheduler registra os dois cron e dispara o refresh certo", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const scheduled: Array<{ expression: string; callback: () => void | Promise<void>; timezone: string }> = [];
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

  assert.deepEqual(scheduled.map((task) => task.expression), [CRON_QUOTES, CRON_DAILY]);
  assert.equal(scheduled[0]?.expression, "*/10 10-17 * * 1-5");
  assert.equal(scheduled[1]?.expression, "0 7 * * *");
  assert.equal(scheduled.every((task) => task.timezone === "America/Sao_Paulo"), true);

  scheduled[0]?.callback();
  await scheduled[1]?.callback();
  assert.deepEqual(calls, [{ quotesOnly: true }, { source: "bcb" }, { source: "cvm-swb" }]);

  scheduler.stop();
  assert.equal(stops, 2);
});

test("tarefa diária roda bcb e cvm-swb em sequência", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const callbacks: Array<() => void | Promise<void>> = [];
  const cron: CronLike = {
    schedule: (_expression, callback) => {
      callbacks.push(callback);
      return { stop: () => {} };
    },
  };
  let active = 0;
  let maxActive = 0;
  startScheduler(db, {
    cron,
    refreshFn: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    },
    onError: () => {},
  });

  await callbacks[1]?.();
  assert.equal(maxActive, 1);
});
