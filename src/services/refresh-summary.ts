export type RefreshSourceSummary = {
  id: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export function emptySummary(id: string): RefreshSourceSummary {
  return { id, fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: [] };
}
