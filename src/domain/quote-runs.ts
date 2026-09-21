export type ConstantRunQuote = { date: string; closeCents: bigint };

/** Trechos de fechamentos idênticos consecutivos com >= minDays linhas, encerrados antes de `today`. */
export function findConstantRuns(
  quotes: ConstantRunQuote[],
  options: { minDays?: number; today: string },
): Array<{ from: string; to: string }> {
  const minDays = options.minDays ?? 7;
  const runs: Array<{ from: string; to: string }> = [];
  let start = 0;
  for (let index = 1; index <= quotes.length; index++) {
    const same = index < quotes.length && quotes[index]!.closeCents === quotes[index - 1]!.closeCents;
    if (same) continue;
    const length = index - start;
    const from = quotes[start]!.date;
    const to = quotes[index - 1]!.date;
    if (length >= minDays && to < options.today) runs.push({ from, to });
    start = index;
  }
  return runs;
}
