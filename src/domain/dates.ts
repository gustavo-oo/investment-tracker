const BRT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

/** Data (YYYY-MM-DD) em America/Sao_Paulo. */
export function toBrDate(date: Date): string {
  return BRT.format(date);
}

/** Soma meses a um mês "YYYY-MM". */
export function addMonths(month: string, delta: number): string {
  const [year = 0, monthIndex = 1] = month.split("-").map(Number);
  const total = year * 12 + (monthIndex - 1) + delta;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12 + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Último dia do mês "YYYY-MM" como data ISO. */
export function monthEnd(month: string): string {
  const [year = 0, monthIndex = 1] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/** Meses inclusivos de `from` a `to`, ambos "YYYY-MM". */
export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let current = from;
  while (current <= to) {
    months.push(current);
    current = addMonths(current, 1);
  }
  return months;
}
