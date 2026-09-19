import cron from "node-cron";
import type { Db } from "../db/index.ts";
import { refresh, type RefreshOptions } from "../services/refresh.ts";

export const CRON_QUOTES = "*/10 10-17 * * 1-5";
export const CRON_INDICES = "0 7 * * *";

export type CronTask = { stop: () => void };
export type CronLike = {
  schedule: (expression: string, callback: () => void, options: { timezone: string }) => CronTask;
};

export type SchedulerOptions = {
  timezone?: string;
  cron?: CronLike;
  refreshFn?: (db: Db, options?: RefreshOptions) => Promise<unknown>;
  onError?: (error: unknown) => void;
};

export function startScheduler(db: Db, options: SchedulerOptions = {}): { stop: () => void; runNow: () => void } {
  const timezone = options.timezone ?? "America/Sao_Paulo";
  const cronImpl = (options.cron ?? cron) as CronLike;
  const refreshFn = options.refreshFn ?? refresh;
  const onError = options.onError ?? ((error: unknown) => { console.error(error); });
  const run = (refreshOptions: RefreshOptions) => { void refreshFn(db, refreshOptions).catch(onError); };

  const quotesTask = cronImpl.schedule(CRON_QUOTES, () => run({}), { timezone });
  const indicesTask = cronImpl.schedule(CRON_INDICES, () => run({ source: "bcb" }), { timezone });

  return {
    stop: () => { quotesTask.stop(); indicesTask.stop(); },
    runNow: () => run({}),
  };
}
