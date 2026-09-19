import type { SourceStatusRow } from "../db/repos.ts";

export type SourceSummary = {
  id: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  stale: boolean;
};

/** `stale` = a última tentativa falhou e é mais recente que o último sucesso. */
export function sourceSummary(row: SourceStatusRow): SourceSummary {
  const stale = row.lastAttemptAt !== null && row.lastErrorAt !== null && (row.lastSuccessAt === null || row.lastErrorAt > row.lastSuccessAt);
  return {
    id: row.source, lastAttemptAt: row.lastAttemptAt, lastSuccessAt: row.lastSuccessAt,
    lastErrorAt: row.lastErrorAt, lastError: row.lastError, stale,
  };
}
