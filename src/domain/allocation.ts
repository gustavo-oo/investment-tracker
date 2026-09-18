export const ALLOCATION_BY = ["category", "broker", "objective"] as const;
export type AllocationBy = (typeof ALLOCATION_BY)[number];

export type AllocationPosition = {
  marketValueCents: bigint | null;
  category: string;
  broker: string | null;
  objective: string | null;
};

/** Soma o valor de mercado por critério (ignora posições sem valor). */
export function groupAllocation(positions: AllocationPosition[], by: AllocationBy): Array<{ key: string; marketValueCents: bigint }> {
  const totals = new Map<string, bigint>();
  for (const position of positions) {
    const value = position.marketValueCents;
    if (value === null) continue;
    const raw = position[by];
    const key = raw === null || raw === "" ? "—" : raw;
    totals.set(key, (totals.get(key) ?? 0n) + value);
  }
  return [...totals.entries()]
    .map(([key, marketValueCents]) => ({ key, marketValueCents }))
    .sort((a, b) => (b.marketValueCents > a.marketValueCents ? 1 : b.marketValueCents < a.marketValueCents ? -1 : a.key.localeCompare(b.key)));
}
